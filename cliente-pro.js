/* ============================================================
   SMASH · cliente-pro.js — experiencia de la página de clientes
   Se carga después de cliente.js y no cambia cómo se arma ni se
   envía el pedido. Solo agrega:
   - Barra superior que se vuelve sólida al bajar.
   - Botones "Agregar" que se vuelven − n + y tarjeta resaltada.
   - Aviso al agregar y contador en el botón del pedido.
   - En celular: barra fija "Ver tu pedido" y el pedido como hoja
     que sube desde abajo.
   - Recordar los datos del cliente (nombre, teléfono, dirección,
     zona y pago) en este dispositivo.
   - "Pedir lo mismo": repite el último pedido con un toque.
   ============================================================ */
(function () {
  var $ = function (i) { return document.getElementById(i); };
  var LS_DATOS = "cli_datos", LS_ULT = "cli_ultimo";
  function lsGet(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  var movil = window.matchMedia("(max-width:1023px)");

  /* ---------- Barra superior ---------- */
  var tb = $("topbar");
  function barra() { tb.classList.toggle("solid", window.scrollY > 40); }
  window.addEventListener("scroll", barra, { passive: true }); barra();

  /* ---------- Cantidades: "Agregar" con 0, − n + con más ---------- */
  function sync() {
    document.querySelectorAll(".qty").forEach(function (q) {
      var o = q.querySelector("output"); q.setAttribute("data-q", o ? o.textContent.trim() : "0");
    });
    document.querySelectorAll(".pcard,.item").forEach(function (c) {
      var o = c.querySelector(".pfoot output, :scope > .qty output");
      c.classList.toggle("in", !!o && Number(o.textContent) > 0);
    });
  }
  var mo = new MutationObserver(sync);
  ["burgers", "extras"].forEach(function (id) { var el = $(id); if (el) mo.observe(el, { childList: true, subtree: true, characterData: true }); });
  sync();

  /* ---------- Aviso al agregar ---------- */
  var toastT = null;
  function toast(t) {
    var el = $("toast"); el.textContent = t; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, 1700);
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button.plus") : null;
    if (!b || reproduciendo) return;
    setTimeout(function () {
      if ($("err").textContent.indexOf("⚠") === 0 && /agot|quedan|máximo/i.test($("err").textContent)) { toast($("err").textContent.replace("⚠ ", "")); return; }
      var q = b.closest(".qty"); if (q) { q.classList.remove("bump"); void q.offsetWidth; q.classList.add("bump"); }
      if (b.classList.contains("cbq")) toast("🍟 Combo agregado");
      else if (b.classList.contains("sbq")) toast("🥤 Sabor agregado");
      else { var c = b.closest(".pcard,.item"), n = c && c.querySelector(".nm"); toast("✓ " + (n ? n.textContent : "Agregado") + " al pedido"); }
    }, 0);
  });

  /* ---------- Contador y barra del pedido ---------- */
  var antesN = 0;
  function totales() {
    var m = ($("cnt").textContent || "").match(/^(\d+)/), n = m ? Number(m[1]) : 0;
    var bd = $("cartBadge");
    bd.hidden = !n; bd.textContent = n;
    if (n > antesN) { bd.classList.remove("pop"); void bd.offsetWidth; bd.classList.add("pop"); }
    antesN = n;
    $("cbN").textContent = n; $("cbTot").textContent = $("tot").textContent;
    var cb = $("cartBar"); cb.hidden = !n; cb.classList.toggle("show", !!n);
  }
  new MutationObserver(totales).observe($("cnt"), { childList: true, characterData: true, subtree: true });
  new MutationObserver(totales).observe($("tot"), { childList: true, characterData: true, subtree: true });
  totales();

  /* ---------- Pedido como hoja (celular) ---------- */
  document.body.classList.add("has-sheet");
  function abrir() { if (!movil.matches) { $("pedido").scrollIntoView({ behavior: "smooth", block: "start" }); return; } document.body.classList.add("sheet-open"); $("sheetBg").hidden = false; }
  function cerrar() { document.body.classList.remove("sheet-open"); }
  $("cartBar").addEventListener("click", abrir);
  $("sheetX").addEventListener("click", cerrar);
  $("sheetBg").addEventListener("click", cerrar);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrar(); });
  document.querySelectorAll('a[href="#pedido"]').forEach(function (a) {
    a.addEventListener("click", function (e) { if (movil.matches) { e.preventDefault(); abrir(); } });
  });
  movil.addEventListener && movil.addEventListener("change", function () { if (!movil.matches) cerrar(); });

  /* ---------- Categoría activa ---------- */
  var links = document.querySelectorAll(".catnav a[href^='#']:not(.catnav-cart)");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (en) {
        if (en.isIntersecting) links.forEach(function (a) { a.classList.toggle("on", a.getAttribute("href") === "#" + en.target.id); });
      });
    }, { rootMargin: "-40% 0px -55% 0px" });
    ["menu", "adicionales"].forEach(function (id) { if ($(id)) io.observe($(id)); });
    // Aparición suave
    var rv = new IntersectionObserver(function (es) { es.forEach(function (en) { if (en.isIntersecting) { en.target.classList.add("vis"); rv.unobserve(en.target); } }); }, { rootMargin: "0px 0px -8% 0px" });
    document.querySelectorAll(".block-h, .why-card, .steps li, .club-in, .foot-in").forEach(function (el) { el.classList.add("rv"); rv.observe(el); });
  }

  /* ---------- Recordar los datos del cliente ---------- */
  var CAMPOS = ["fn", "fp", "fp2", "fa"];
  function guardarDatos() {
    var d = lsGet(LS_DATOS) || {};
    CAMPOS.forEach(function (id) { d[id] = $(id).value.trim(); });
    var z = document.querySelector(".chip.on[data-z]"), p = document.querySelector(".chip.on[data-p]");
    if (z) d.zona = z.getAttribute("data-z");
    if (p) d.pago = p.getAttribute("data-p");
    lsSet(LS_DATOS, d);
  }
  CAMPOS.forEach(function (id) { $(id).addEventListener("change", guardarDatos); });
  document.addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".chip")) setTimeout(guardarDatos, 0); });

  function cuandoListo(fn) {
    var n = 0, t = setInterval(function () {
      if (document.querySelector("#zones .chip") || ++n > 60) { clearInterval(t); fn(); }
    }, 100);
  }
  cuandoListo(function () {
    var d = lsGet(LS_DATOS);
    if (d) {
      CAMPOS.forEach(function (id) { if (d[id] && !$(id).value) { $(id).value = d[id]; $(id).dispatchEvent(new Event("input", { bubbles: true })); } });
      var z = d.zona && document.querySelector('.chip[data-z="' + d.zona + '"]'), p = d.pago && document.querySelector('.chip[data-p="' + d.pago + '"]');
      if (z && !document.querySelector(".chip.on[data-z]")) z.click();
      if (p && !document.querySelector(".chip.on[data-p]")) p.click();
    }
    pintarVolver();
    sync();
  });

  /* ---------- Pedir lo mismo de la última vez ---------- */
  var reproduciendo = false;
  function foto() {
    var items = [], combos = [], sabores = [];
    document.querySelectorAll('output[id^="q_"]').forEach(function (o) { var n = Number(o.textContent); if (n) items.push({ id: o.id.slice(2), n: n }); });
    document.querySelectorAll(".cbx").forEach(function (c) { var b = c.querySelector(".cbq.plus"), n = Number((c.querySelector("output") || {}).textContent || 0); if (b && n) combos.push({ b: b.getAttribute("data-b"), c: b.getAttribute("data-c"), n: n }); });
    document.querySelectorAll(".sbr").forEach(function (r) { var b = r.querySelector(".sbq.plus"), n = Number((r.querySelector("output") || {}).textContent || 0); if (b && n) sabores.push({ s: b.getAttribute("data-s"), i: b.getAttribute("data-i"), n: n }); });
    var resumen = Array.prototype.map.call(document.querySelectorAll("#lst .li:not(.sub):not(.promo) span"), function (s) { return s.textContent; });
    return { en: new Date().toISOString(), items: items, combos: combos, sabores: sabores, resumen: resumen, total: $("tot").textContent };
  }
  $("go").addEventListener("click", function (e) {
    if (e.defaultPrevented) return;          // faltaban datos: cliente.js ya avisó
    guardarDatos();
    var f = foto(); if (f.items.length || f.sabores.length) lsSet(LS_ULT, f);
  });
  function clicks(sel, n) { var b = document.querySelector(sel); for (var i = 0; b && i < n; i++) b.click(); }
  function repetir() {
    var u = lsGet(LS_ULT); if (!u) return;
    reproduciendo = true;
    // Primero las cantidades (así aparecen los botones de sabor), luego combos y sabores
    (u.items || []).forEach(function (it) {
      var o = $("q_" + it.id), ya = o ? Number(o.textContent) : 0;
      clicks('.qb.plus[data-id="' + it.id + '"]', Math.max(0, it.n - ya));
    });
    (u.combos || []).forEach(function (c) { clicks('.cbq.plus[data-b="' + c.b + '"][data-c="' + c.c + '"]', c.n); });
    (u.sabores || []).forEach(function (s) { clicks('.sbq.plus[data-s="' + s.s + '"][data-i="' + s.i + '"]', s.n); });
    reproduciendo = false;
    sync();
    var err = $("err").textContent;
    toast(/agot|quedan/i.test(err) ? err.replace("⚠ ", "") : "🔁 Listo: agregamos tu pedido de la última vez");
    setTimeout(abrir, 400);
  }
  function pintarVolver() {
    var u = lsGet(LS_ULT), d = lsGet(LS_DATOS) || {}, box = $("volver");
    if (!u || !(u.items || []).length && !(u.sabores || []).length) { box.hidden = true; return; }
    var nombre = String(d.fn || "").split(" ")[0];
    var cuando = "";
    try { cuando = new Date(u.en).toLocaleDateString("es-CO", { day: "numeric", month: "long" }); } catch (x) {}
    box.innerHTML = '<div class="volver-t"><b>' + (nombre ? "¡Hola de nuevo, " + esc(nombre) + "! 👋" : "¡Qué bueno verte de nuevo! 👋") + "</b>" +
      "<small>Tu último pedido" + (cuando ? " (" + esc(cuando) + ")" : "") + ": " + esc((u.resumen || []).slice(0, 3).join(", ")) + ((u.resumen || []).length > 3 ? "…" : "") + "</small></div>" +
      '<button type="button" class="btn btn-red" id="repetir">🔁 Pedir lo mismo</button>';
    box.hidden = false;
    $("repetir").addEventListener("click", repetir);
  }
})();
