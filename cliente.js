(function () {
  var WA = "573146836097";
  var PAGOS = ["Efectivo", "Transferencia"];
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function hoyLocal() { return SmashExt.localDay(new Date().toISOString()); }

  var prods = [], Z = {}, zone = "", pm = "", qty = {}, LM = "", cupo = null;

  function item(p) {
    var star = p.id === "toci", big = p.categoria === "hamburguesa" || p.categoria === "combo";
    var btns = '<div class="qty"><button type="button" class="qb" data-id="' + esc(p.id) + '" data-d="-1" aria-label="Quitar">−</button>' +
      '<output id="q_' + esc(p.id) + '">0</output>' +
      '<button type="button" class="qb plus" data-id="' + esc(p.id) + '" data-d="1" aria-label="Agregar">+</button></div>';
    if (big) {
      return '<div class="pcard' + (star ? " star" : "") + '">' +
        (p.img ? '<img class="pimg" src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" onerror="smashImgFallback(this)">' : "") +
        '<div class="pbody"><div class="prow"><span class="nm">' + esc(p.name) + (star ? '<span class="tag">INSIGNIA</span>' : "") + '</span><span class="pr">' + fmt(p.price) + "</span></div>" +
        (p.desc ? '<p class="ing">' + (p.categoria === "hamburguesa" ? "<b>Ingredientes:</b> " : "") + esc(p.desc) + "</p>" : "") + "</div>" +
        '<div class="pfoot">' + btns + "</div></div>";
    }
    return '<div class="item"><div class="bd"><div class="nm">' + esc(p.name) + '</div>' + (p.desc ? '<p class="ds">' + esc(p.desc) + "</p>" : "") +
      '<div class="pr">' + fmt(p.price) + "</div></div>" + btns + "</div>";
  }

  function render() {
    var principales = prods.filter(function (p) { return p.categoria === "hamburguesa" || p.categoria === "combo"; });
    var adicionales = prods.filter(function (p) { return p.categoria === "adicional"; });
    $("burgers").innerHTML = principales.length ? '<div class="grid">' + principales.map(item).join("") + "</div>" : '<p class="sub">No hay productos disponibles por ahora.</p>';
    $("extras").innerHTML = adicionales.map(item).join("");
    $("zones").innerHTML = Object.keys(Z).map(function (k) {
      return '<button type="button" class="chip" data-z="' + esc(k) + '">' + esc(Z[k].nombre) + "<small>" + (Z[k].variable ? "valor por confirmar" : fmt(Z[k].fee)) + "</small></button>";
    }).join("");
    $("pays").innerHTML = PAGOS.map(function (p) { return '<button type="button" class="chip" data-p="' + p + '">' + p + "</button>"; }).join("");
    if (cupo) {
      var rest = Math.max(0, cupo.total - cupo.vendidas), el = $("cupo");
      el.hidden = false;
      el.className = "cupo" + (rest <= 0 ? " out" : "");
      el.innerHTML = rest <= 0 ? "Cupo de hoy agotado" : "🍔 Quedan <b>" + rest + "</b> de " + cupo.total + " hamburguesas hoy" +
        (cupo.hora ? " <small>· actualizado " + esc(cupo.hora) + "</small>" : "");
    }
  }

  function restantes() { return cupo ? Math.max(0, cupo.total - cupo.vendidas) : Infinity; }
  function burgersEnCarrito() {
    var n = 0;
    prods.forEach(function (p) { if (p.categoria === "hamburguesa") n += qty[p.id] || 0; });
    return n;
  }

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("button") : null;
    if (!b) return;
    if (b.classList.contains("qb")) {
      var id = b.getAttribute("data-id"), d = Number(b.getAttribute("data-d"));
      var p = prods.filter(function (x) { return x.id === id; })[0];
      if (d > 0 && p && p.categoria === "hamburguesa" && burgersEnCarrito() >= restantes()) {
        $("err").textContent = restantes() <= 0 ? "⚠ Hoy se agotaron las hamburguesas" : "⚠ Solo quedan " + restantes() + " hamburguesas hoy";
        return;
      }
      qty[id] = Math.max(0, (qty[id] || 0) + d);
      $("q_" + id).textContent = qty[id];
    } else if (b.hasAttribute("data-z")) {
      zone = b.getAttribute("data-z"); mark("z", zone);
    } else if (b.hasAttribute("data-p")) {
      pm = b.getAttribute("data-p"); mark("p", pm);
    } else return;
    upd();
  });
  ["fn", "fp", "fa", "fo"].forEach(function (i) { $(i).addEventListener("input", upd); });
  function mark(a, v) { document.querySelectorAll(".chip[data-" + a + "]").forEach(function (c) { c.classList.toggle("on", c.getAttribute("data-" + a) === v); }); }
  function val(i) { return $(i).value.trim(); }

  function lines() {
    var out = [];
    prods.forEach(function (p) { if (qty[p.id]) out.push({ id: p.id, name: p.name, price: p.price, qty: qty[p.id] }); });
    return out;
  }
  function miss() {
    var m = [];
    if (!lines().length) m.push("tu pedido");
    if (!val("fn")) m.push("nombre");
    if (val("fp").replace(/\D/g, "").length < 10) m.push("teléfono válido");
    if (!zone) m.push("zona");
    if (!val("fa")) m.push("dirección");
    if (!pm) m.push("medio de pago");
    return m;
  }
  function upd() {
    var L = lines(), t = 0, n = 0, txt = [];
    L.forEach(function (it) { t += it.price * it.qty; n += it.qty; txt.push("- " + it.qty + " x " + it.name + " (" + fmt(it.price * it.qty) + ")"); });
    var vz = !!(zone && Z[zone].variable), d = zone && !vz ? Z[zone].fee : 0, T = t + d;
    $("tot").textContent = fmt(T);
    $("cnt").textContent = n ? n + (n == 1 ? " producto" : " productos") + " · " + fmt(t) : "Tu pedido está vacío";
    $("dl").textContent = !zone ? "Elige tu zona para ver el domicilio" : vz ? "Domicilio por confirmar (se suma al total)" : "Incluye domicilio " + fmt(d);
    LM = "*NUEVO PEDIDO - SMASH*\n*Pedido N°:* @@\n\n*Cliente:* " + val("fn") + "\n*Teléfono:* " + val("fp") + "\n*Zona:* " + (zone ? Z[zone].nombre : "") +
      "\n*Dirección:* " + val("fa") + "\n*Medio de pago:* " + pm + "\n\n*Pedido:*\n" + txt.join("\n") + "\n\n*Subtotal:* " + fmt(t) +
      "\n*Domicilio:* " + (vz ? "Por confirmar (agencia)" : fmt(d)) + "\n*TOTAL A PAGAR:* " + fmt(T) + (vz ? " + domicilio" : "") + (val("fo") ? "\n\n*Notas:* " + val("fo") : "");
    $("go").href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(LM);
    if (!miss().length) $("err").textContent = "";
  }

  $("go").addEventListener("click", function (e) {
    if (cupo && restantes() <= 0 && burgersEnCarrito() > 0) { e.preventDefault(); $("err").textContent = "⚠ Hoy se agotaron las hamburguesas"; return; }
    var m = miss();
    if (m.length) { e.preventDefault(); $("err").textContent = "⚠ Falta: " + m.join(", "); return; }
    $("err").textContent = "";
    var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    var z = function (x) { return ("0" + x).slice(-2); }, a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    var code = "#" + z(d.getDate()) + z(d.getMonth() + 1) + "-" + z(d.getHours()) + z(d.getMinutes()) + a[Math.floor(Math.random() * a.length)] + Math.floor(Math.random() * 10);
    $("go").href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(LM.replace("@@", code));
    try {
      SmashExt.addOrder({ cliente: val("fn"), telefono: val("fp"), direccion: val("fa"), zona: Z[zone].nombre, domicilio: Z[zone].variable ? 0 : Z[zone].fee, domicilioPendiente: !!Z[zone].variable, pago: pm, notas: val("fo"), items: lines(), ref: code, origen: "web" });
    } catch (x) { /* si falla el guardado local, igual se envía por WhatsApp */ }
  });

  function est() {
    try {
      var p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":");
      var m = +p[0] * 60 + +p[1], o = m >= 1050 && m < 1320;
      $("st").classList.toggle("open", o);
      $("stt").textContent = o ? "Abierto ahora · hasta las 10:00 pm" : (m < 1050 ? "Abrimos hoy a las 5:30 pm" : "Cerrado · abrimos mañana 5:30 pm");
    } catch (e) {}
  }

  /* Menú: usa menu.json (publicado desde cocina) y, si no existe, los datos locales */
  SmashExt.loadMenu().then(function (menu) {
    if (menu) {
      prods = menu.productos.filter(function (p) { return p && p.id && p.name; });
      var zs = menu.zonas || {};
      Z = Object.keys(zs).length ? zs : SmashExt.getZones();
      if (menu.cupo && menu.dia === hoyLocal()) {
        cupo = { total: menu.cupo.total, vendidas: menu.cupo.vendidas };
        try { cupo.hora = new Date(menu.generado).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }).replace(/[\u00a0\u202f]/g, " "); } catch (e) {}
      }
    } else {
      prods = SmashDB.getProducts({ soloActivos: true });
      Z = SmashExt.getZones();
      var c = SmashExt.cupoHoy();
      if (c) cupo = c;
    }
    render(); est(); setInterval(est, 60000); upd();
  });
})();
