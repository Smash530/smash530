/* ============================================================
   SMASH · cliente-vivo.js — página de clientes más viva (celular)
   Se carga después de cliente.js y cliente-pro.js. No cambia cómo se
   arma ni se envía el pedido. Agrega:
   1. Seguimiento del pedido en vivo: recibido → en cocina → en camino
      → entregado (lo publica la caja; supabase/seguimiento-pedidos.sql).
   2. Celebraciones: al sumar puntos y al enviar o recibir el pedido.
   3. Micro-animaciones: la burger "vuela" a tu pedido y el celular
      vibra suave al tocar.
   4. Barra inferior tipo app (Menú · Promos · Pedido · Cuenta) y
      aviso para agregar SMASH a la pantalla de inicio.
   Respeta "reducir movimiento" del celular.
   ============================================================ */
(function () {
  var $ = function (i) { return document.getElementById(i); };
  var N = typeof SmashNube !== "undefined" && SmashNube.ok ? SmashNube : null;
  var movil = window.matchMedia("(max-width:1023px)");
  var quieto = window.matchMedia("(prefers-reduced-motion: reduce)");
  function lsGet(k, d) { try { var v = JSON.parse(localStorage.getItem(k) || "null"); return v == null ? d : v; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* modo privado */ } }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function vibrar(p) { try { if (navigator.vibrate && !quieto.matches) navigator.vibrate(p || 10); } catch (e) { /* sin vibración */ } }
  var toastT = null;
  function aviso(t, ms) {
    var el = $("toast"); if (!el) return;
    el.textContent = t; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(function () { el.classList.remove("show"); }, ms || 2600);
  }

  /* ================= Confeti (canvas, 1,4 s) ================= */
  function confeti(origen) {
    if (quieto.matches) return;
    var c = document.createElement("canvas"), x = c.getContext && c.getContext("2d"); if (!x) return;
    var W = c.width = innerWidth, H = c.height = innerHeight, dpr = 1;
    c.className = "confeti"; document.body.appendChild(c);
    var ox = origen ? origen.x : W / 2, oy = origen ? origen.y : H * 0.42;
    var col = ["#ffb627", "#e63946", "#fff3d6", "#ffd166", "#ff7a59"], ps = [];
    for (var i = 0; i < 90; i++) {
      var a = Math.random() * Math.PI * 2, v = 4 + Math.random() * 7;
      ps.push({ x: ox, y: oy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 6, r: 3 + Math.random() * 4, g: Math.random() * 6, c: col[i % col.length], s: Math.random() < 0.5 });
    }
    var t0 = performance.now();
    (function paso(t) {
      var k = (t - t0) / 1400; x.clearRect(0, 0, W, H);
      ps.forEach(function (p) {
        p.vy += 0.32; p.vx *= 0.985; p.x += p.vx; p.y += p.vy; p.g += 0.2;
        x.globalAlpha = Math.max(0, 1 - k); x.fillStyle = p.c;
        x.save(); x.translate(p.x * dpr, p.y * dpr); x.rotate(p.g);
        if (p.s) x.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); else { x.beginPath(); x.arc(0, 0, p.r / 1.4, 0, 6.29); x.fill(); }
        x.restore();
      });
      if (k < 1) requestAnimationFrame(paso); else c.remove();
    })(t0);
  }
  window.SmashConfeti = confeti;   // lo usa club-regalo.js

  /* ================= 3. Micro-animaciones ================= */
  function destinoPedido() {
    var t = movil.matches ? document.querySelector('#tabbar [data-tab="pedido"] .tab-ico') : $("tbCart");
    if (!t || !t.getBoundingClientRect().width) t = $("tbCart");
    return t;
  }
  function volar(desde) {
    var dst = destinoPedido(); if (!desde || !dst || quieto.matches) return;
    var a = desde.getBoundingClientRect(), b = dst.getBoundingClientRect();
    if (!a.width || !b.width) return;
    var img = desde.querySelector ? desde.querySelector(".pimg") : null, f;
    if (img && img.dataset.ok) { f = img.cloneNode(); f.removeAttribute("onerror"); f.removeAttribute("onload"); }
    else { f = document.createElement("span"); f.textContent = "🍔"; }
    f.className = "vuela"; f.removeAttribute("id");
    var s = Math.min(a.width, 120);
    f.style.cssText = "left:" + (a.left + a.width / 2 - s / 2) + "px;top:" + (a.top + Math.min(a.height, 120) / 2 - s / 2) + "px;width:" + s + "px;height:" + s + "px";
    document.body.appendChild(f);
    var dx = b.left + b.width / 2 - (a.left + a.width / 2), dy = b.top + b.height / 2 - (a.top + Math.min(a.height, 120) / 2);
    var an = f.animate([
      { transform: "translate(0,0) scale(1)", opacity: 1 },
      { transform: "translate(" + dx * 0.5 + "px," + (dy * 0.5 - 90) + "px) scale(.55)", opacity: 1, offset: 0.55 },
      { transform: "translate(" + dx + "px," + dy + "px) scale(.12)", opacity: 0.4 }
    ], { duration: 650, easing: "cubic-bezier(.45,0,.25,1)" });
    an.onfinish = function () { f.remove(); dst.classList.remove("hop"); void dst.offsetWidth; dst.classList.add("hop"); };
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button.plus, .czc-btn, [data-addpromo], [data-addpaq], .pqb") : null;
    if (b) vibrar(8);
    if (!b || !b.classList.contains("plus") || b.classList.contains("cbq") || b.classList.contains("sbq")) return;
    var q = b.closest(".qty"), o = q && q.querySelector("output"), antes = o ? Number(o.textContent) || 0 : 0;
    setTimeout(function () {
      var o2 = q && q.querySelector("output");
      if (o2 && (Number(o2.textContent) || 0) > antes) volar(b.closest(".pcard,.item") || b);
    }, 0);
  }, true);

  /* ================= 2. Puntos que se celebran ================= */
  var LS_PTS = "cli_pts_visto";
  document.addEventListener("smash:yo", function (e) {
    var yo = e.detail && e.detail.yo; if (!yo) return;
    var id = yo.id || yo.correo || "", vis = lsGet(LS_PTS, {}), pts = Number(yo.puntos) || 0;
    if (vis[id] != null && pts > vis[id]) {
      var mas = pts - vis[id];
      setTimeout(function () {
        aviso("⭐ +" + mas + " puntos · ahora tienes " + pts, 3200); confeti(); vibrar([12, 60, 12]);
        var b = document.querySelector("#club .cz-pts b"); if (b) { b.classList.remove("sube"); void b.offsetWidth; b.classList.add("sube"); }
      }, 600);
    }
    vis[id] = pts; lsSet(LS_PTS, vis);
  });

  /* ================= 1. Seguimiento del pedido ================= */
  var LS_SEG = "cli_seguir";
  var PASOS = [
    { k: "recibido", t: "Recibido", i: "🧾", d: "Tu pedido ya está en la caja." },
    { k: "cocina", t: "En cocina", i: "🔥", d: "Estamos aplastando tus burgers en la plancha." },
    { k: "camino", t: "En camino", i: "🛵", d: "Tu pedido ya salió. ¡Ten el celular a la mano!" },
    { k: "entregado", t: "Entregado", i: "😋", d: "¡Que lo disfrutes! Gracias por pedir en SMASH." }
  ];
  function paso(s) {
    if (!s) return -1;
    if (s.estado === "cancelado") return -2;
    if (s.estado === "entregado") return 3;
    if (s.estado === "en_camino" || s.estado === "listo") return 2;
    if (s.estado === "preparando") return 1;
    if (s.estado || s.recibido) return 0;
    return -1;   // aún no lo toma la caja
  }
  var seg = lsGet(LS_SEG, []).filter(function (x) { return x && x.ref && Date.now() - new Date(x.en).getTime() < 20 * 3600e3; });
  var reloj = null, abierto = false;
  function guardarSeg() { lsSet(LS_SEG, seg); }
  function activos() {
    return seg.filter(function (x) {
      var p = paso(x.s), hace = Date.now() - new Date(x.cambio || x.en).getTime();
      if (p === 3 || p === -2) return hace < 90 * 60e3;          // entregado/cancelado: se ve un rato
      if (p === -1) return Date.now() - new Date(x.en).getTime() < 3 * 3600e3;
      return true;
    });
  }
  document.addEventListener("smash:pedido", function (e) {
    var d = e.detail || {}; if (!d.ref) return;
    seg = seg.filter(function (x) { return x.ref !== d.ref; });
    seg.unshift({ ref: d.ref, en: new Date().toISOString(), total: d.total, n: d.n, reserva: !!d.reserva, pts: d.pts || 0, s: null, cambio: null });
    seg = seg.slice(0, 3); guardarSeg();
    setTimeout(function () { confeti(); vibrar([15, 70, 15]); }, 250);
    pintarSeg(); programar(4000);
  });
  function programar(ms) {
    clearTimeout(reloj);
    if (!N || !N.pedidoEstado || !activos().some(function (x) { var p = paso(x.s); return p !== 3 && p !== -2; })) return;
    reloj = setTimeout(revisarSeg, ms || 15000);
  }
  function revisarSeg() {
    if (document.visibilityState === "hidden") { programar(30000); return; }
    var refs = activos().filter(function (x) { var p = paso(x.s); return p !== 3 && p !== -2; }).map(function (x) { return x.ref; });
    if (!refs.length) return;
    N.pedidoEstado(refs).then(function (r) {
      (r.lista || []).forEach(function (f) {
        var x = seg.find(function (y) { return y.ref === f.ref; }); if (!x) return;
        var antes = paso(x.s), ahora = paso(f);
        x.s = { estado: f.estado, recibido: f.recibido };
        if (ahora !== antes) { x.cambio = new Date().toISOString(); celebrarPaso(x, ahora); }
      });
      guardarSeg(); pintarSeg(); programar();
    }, function () { programar(30000); });
  }
  function celebrarPaso(x, p) {
    vibrar([12, 50, 12]);
    if (p === 1) aviso("🔥 ¡Tu pedido ya está en la plancha!");
    else if (p === 2) aviso("🛵 ¡Tu pedido va en camino!");
    else if (p === 3) { aviso("😋 ¡Entregado! Que lo disfrutes" + (x.pts ? " · +" + x.pts + " pts" : ""), 3600); confeti(); }
    else if (p === -2) aviso("Tu pedido fue cancelado. Escríbenos si tienes dudas.", 3600);
    else if (p === 0) aviso("🧾 ¡La caja ya recibió tu pedido!");
  }
  function textoEstado(x) {
    var p = paso(x.s);
    if (p === -2) return "Cancelado";
    if (p === -1) return x.reserva ? "Reserva enviada" : "Enviado · esperando a la caja";
    return PASOS[p].t;
  }
  function pintarSeg() {
    var lista = activos(), pill = $("segPill");
    if (!lista.length) { if (pill) pill.hidden = true; document.body.classList.remove("con-seg"); cerrarSeg(); return; }
    if (!pill) {
      pill = document.createElement("button"); pill.type = "button"; pill.id = "segPill"; pill.className = "seg-pill";
      pill.addEventListener("click", abrirSeg); document.body.appendChild(pill);
    }
    var x = lista[0], p = paso(x.s);
    pill.hidden = false; document.body.classList.add("con-seg");
    pill.className = "seg-pill" + (p === 3 ? " ok" : p === -2 ? " mal" : "");
    pill.innerHTML = '<span class="sp-ico" aria-hidden="true">' + (p >= 0 ? PASOS[p].i : p === -2 ? "✖" : "⏳") + "</span>" +
      '<span class="sp-t"><small>Tu pedido ' + esc(x.ref) + "</small><b>" + esc(textoEstado(x)) + "</b></span>" +
      '<span class="sp-dots" aria-hidden="true">' + PASOS.map(function (_, i) { return '<i class="' + (i <= p ? "on" : "") + (i === p && p < 3 ? " now" : "") + '"></i>'; }).join("") + "</span>" +
      '<span class="sp-go" aria-hidden="true">›</span>';
    pill.setAttribute("aria-label", "Ver en qué va tu pedido " + x.ref + ": " + textoEstado(x));
    if (abierto) pintarSheet();
  }
  function abrirSeg() {
    var s = $("segSheet");
    if (!s) {
      s = document.createElement("div"); s.id = "segSheet"; s.className = "seg-sheet"; s.setAttribute("role", "dialog"); s.setAttribute("aria-modal", "true"); s.setAttribute("aria-label", "Seguimiento de tu pedido");
      s.innerHTML = '<div class="ss-bg" data-segx></div><div class="ss-box"><div class="sheet-grip" style="display:block"></div><button type="button" class="ss-x" data-segx aria-label="Cerrar">×</button><div id="segIn"></div></div>';
      s.addEventListener("click", function (e) { if (e.target.closest("[data-segx]")) cerrarSeg(); });
      document.body.appendChild(s);
    }
    abierto = true; pintarSheet(); s.hidden = false;
    requestAnimationFrame(function () { s.classList.add("open"); });
    if (N && N.pedidoEstado) revisarSeg();
  }
  function cerrarSeg() { var s = $("segSheet"); abierto = false; if (!s) return; s.classList.remove("open"); setTimeout(function () { if (!abierto) s.hidden = true; }, 300); }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && abierto) cerrarSeg(); });
  function horaDe(iso) { try { return new Date(iso).toLocaleTimeString("es-CO", { hour: "numeric", minute: "2-digit", timeZone: "America/Bogota" }).replace(/[  ]/g, " "); } catch (e) { return ""; } }
  function pintarSheet() {
    var box = $("segIn"); if (!box) return;
    var lista = activos(); if (!lista.length) { cerrarSeg(); return; }
    box.innerHTML = lista.map(function (x, k) {
      var p = paso(x.s);
      var cab = '<div class="ss-head"><span class="eyebrow gold">' + (k ? "Otro pedido" : "En vivo") + "</span><h3>" + esc(textoEstado(x)) + "</h3>" +
        "<small>Pedido " + esc(x.ref) + " · " + (x.n ? x.n + " producto" + (x.n > 1 ? "s" : "") + " · " : "") + esc(x.total || "") + " · " + horaDe(x.en) + "</small></div>";
      if (p === -2) return '<section class="ss-ped">' + cab + '<p class="ss-msg">La caja canceló este pedido. Si tienes dudas, escríbenos por WhatsApp.</p></section>';
      var linea = '<ol class="ss-line">' + PASOS.map(function (s, i) {
        return '<li class="' + (i < p ? "done" : i === p ? "now" : "") + '"><span class="ssl-ico">' + s.i + '</span><div><b>' + s.t + "</b>" + (i === p ? "<small>" + s.d + "</small>" : "") + "</div></li>";
      }).join("") + "</ol>";
      var msg = p === -1 ? '<p class="ss-msg">' + (x.reserva ? "Quedó como reserva: lo preparamos cuando abramos la cocina. Aquí verás cuando empiece." : "La caja lo verá en un momento. Si no enviaste el mensaje de WhatsApp, envíalo para confirmarlo.") + "</p>" : "";
      return '<section class="ss-ped">' + cab + msg + linea + "</section>";
    }).join("") + '<p class="ss-nota">Se actualiza solo. Puedes cerrar esto y seguir mirando el menú.</p>';
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { pintarSeg(); programar(1500); });
  else { pintarSeg(); programar(1500); }
  document.addEventListener("visibilitychange", function () { if (document.visibilityState === "visible") programar(500); });

  /* ================= 4. Barra inferior tipo app ================= */
  var TABS = [
    { k: "menu", t: "Menú", svg: '<path d="M4 7h16M4 12h16M4 17h10" />' },
    { k: "promos", t: "Promos", svg: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z" />' },
    { k: "pedido", t: "Pedido", svg: '<path d="M6 6h15l-1.5 9h-12L6 6zm0 0L5 3H2" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" />' },
    { k: "cuenta", t: "Cuenta", svg: '<circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />' }
  ];
  var bar = document.createElement("nav");
  bar.id = "tabbar"; bar.className = "tabbar"; bar.setAttribute("aria-label", "Navegación");
  bar.innerHTML = TABS.map(function (t) {
    return '<button type="button" data-tab="' + t.k + '"><span class="tab-ico"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + t.svg + "</svg>" +
      (t.k === "pedido" ? '<em class="tab-n" id="tabN" hidden>0</em>' : "") + "</span><span>" + t.t + "</span></button>";
  }).join("");
  document.body.appendChild(bar);
  document.body.classList.add("con-tabbar");
  function ir(id) { var el = $(id); if (!el || el.hidden) return false; el.scrollIntoView({ behavior: quieto.matches ? "auto" : "smooth", block: "start" }); return true; }
  bar.addEventListener("click", function (e) {
    var b = e.target.closest("button[data-tab]"); if (!b) return;
    vibrar(6);
    var k = b.getAttribute("data-tab");
    if (k === "menu") ir("menu");
    else if (k === "promos") { if (!ir("promos") && !ir("club")) { ir("menu"); aviso("Esta semana no hay promos publicadas"); } }
    else if (k === "pedido") { var c = document.querySelector("a.catnav-cart, #tbCart"); if (c) c.click(); }
    else if (k === "cuenta") {
      var yoB = $("tbYo"), reg = document.querySelector('#tbAcc [data-acc="registro"]');
      if (yoB && !yoB.hidden) yoB.click();
      else if (reg && !$("tbAcc").hidden) reg.click();
      else aviso("Las cuentas no están disponibles en este momento");
    }
  });
  // número de productos en el pedido
  function contar() {
    var m = (($("cnt") || {}).textContent || "").match(/^(\d+)/), n = m ? Number(m[1]) : 0, t = $("tabN");
    if (!t) return;
    if (n > Number(t.textContent || 0)) { t.classList.remove("pop"); void t.offsetWidth; t.classList.add("pop"); }
    t.hidden = !n; t.textContent = n;
  }
  if ($("cnt")) new MutationObserver(contar).observe($("cnt"), { childList: true, characterData: true, subtree: true });
  contar();
  // pestaña activa según dónde va el cliente
  var zonas = [["promos", "promos"], ["club", "promos"], ["menu", "menu"], ["adicionales", "menu"]];
  function marcarTab() {
    var k = "menu", y = innerHeight * 0.4;
    zonas.forEach(function (z) { var el = $(z[0]); if (el && !el.hidden) { var r = el.getBoundingClientRect(); if (r.top < y && r.bottom > y) k = z[1]; } });
    if (document.body.classList.contains("sheet-open")) k = "pedido";
    var acc = $("acc"); if (acc && !acc.hidden) k = "cuenta";
    bar.querySelectorAll("button").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === k); });
  }
  window.addEventListener("scroll", function () { requestAnimationFrame(marcarTab); }, { passive: true });
  new MutationObserver(marcarTab).observe(document.body, { attributes: true, attributeFilter: ["class"] });
  if ($("acc")) new MutationObserver(marcarTab).observe($("acc"), { attributes: true, attributeFilter: ["hidden"] });
  marcarTab();

  /* ---- Agregar a la pantalla de inicio ---- */
  var LS_INST = "cli_instalar_no";
  var instalada = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
  var ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
  var evento = null;
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); evento = e; });
  function ofrecer() {
    if (instalada || !movil.matches || $("instBox")) return;
    if (Date.now() - lsGet(LS_INST, 0) < 14 * 864e5) return;
    if (!evento && !ios) return;
    var box = document.createElement("div"); box.id = "instBox"; box.className = "inst";
    box.innerHTML = '<img src="apple-touch-icon.png" alt="" width="40" height="40"><div><b>Ten SMASH en tu pantalla</b><small>' +
      (evento ? "Pide más rápido, como una app." : "Toca <b>Compartir</b> <span aria-hidden=\"true\">⬆️</span> y luego <b>Agregar a inicio</b>.") + "</small></div>" +
      (evento ? '<button type="button" class="inst-si">Agregar</button>' : "") + '<button type="button" class="inst-x" aria-label="Ahora no">×</button>';
    document.body.appendChild(box);
    requestAnimationFrame(function () { box.classList.add("show"); });
    box.addEventListener("click", function (e) {
      if (e.target.closest(".inst-x")) { lsSet(LS_INST, Date.now()); quitar(); }
      else if (e.target.closest(".inst-si") && evento) { evento.prompt(); evento.userChoice.then(function () { evento = null; lsSet(LS_INST, Date.now()); quitar(); }, quitar); }
    });
    function quitar() { box.classList.remove("show"); setTimeout(function () { box.remove(); }, 300); }
  }
  // se ofrece después de un rato mirando, o justo después de pedir
  setTimeout(ofrecer, 25000);
  document.addEventListener("smash:pedido", function () { setTimeout(ofrecer, 4000); });
  window.addEventListener("appinstalled", function () { instalada = true; var b = $("instBox"); if (b) b.remove(); });
})();
