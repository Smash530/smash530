(function () {
  var WA = "573146836097";
  var PAGOS = ["Efectivo", "Transferencia"];
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function hoyLocal() { return SmashExt.localDay(new Date().toISOString()); }

  var prods = [], Z = {}, zone = "", pm = "", qty = {}, LM = "", cupo = null;
  // Horario de atención (menu.json o local). Fuera de horario el pedido se envía como reserva.
  var H = null, EH = { abierto: true };
  function reservaTxt() { return (EH.abreHoy ? "hoy" : "mañana") + " a las " + EH.abre; }
  // Los combos ya no se piden sueltos: son una opción dentro de cada hamburguesa (máximo uno por hamburguesa)
  var cq = {};
  function combos() { return prods.filter(function (p) { return p.categoria === "combo"; }); }
  function enCombo(bid) { var n = 0, m = cq[bid] || {}; Object.keys(m).forEach(function (k) { n += m[k]; }); return n; }
  function comboBox(p) {
    var q = qty[p.id] || 0, cs = combos();
    if (!q || !cs.length) return "";
    return cs.map(function (c) {
      var n = (cq[p.id] || {})[c.id] || 0;
      return '<div class="cbx' + (n ? " on" : "") + '"><div class="cbt"><b>🍟 ¿En combo?</b><small>' + esc(c.desc || c.name) + " · +" + fmt(c.price) + " c/u</small>" +
        '<small class="cbn">' + n + " de " + q + " en combo</small></div>" +
        '<div class="qty"><button type="button" class="qb cbq" data-b="' + esc(p.id) + '" data-c="' + esc(c.id) + '" data-d="-1" aria-label="Quitar combo">−</button>' +
        "<output>" + n + "</output>" +
        '<button type="button" class="qb cbq plus" data-b="' + esc(p.id) + '" data-c="' + esc(c.id) + '" data-d="1" aria-label="Agregar combo">+</button></div></div>';
    }).join("");
  }
  function pintarCombo(bid) { var el = $("cb_" + bid); if (el) el.innerHTML = comboBox(prods.filter(function (x) { return x.id === bid; })[0]); }

  // Adicionales con sabores (ej. gaseosas): el cliente elige el sabor de cada unidad. sq[producto][sabor] = unidades
  var sq = {};
  function sabores(p) { return p && Array.isArray(p.sabores) ? p.sabores : []; }
  function elegidas(id) { var n = 0, m = sq[id] || {}; Object.keys(m).forEach(function (k) { n += m[k]; }); return n; }
  function sabBox(p) {
    var q = qty[p.id] || 0, ss = sabores(p);
    if (!q || !ss.length) return "";
    var e = elegidas(p.id), m = sq[p.id] || {};
    return '<div class="sbx ' + (e >= q ? "ok" : "falta") + '"><div class="sbh"><b>🥤 ¿De cuál la quieres?</b><small>' +
      (e >= q ? "✓ Listo" : (q - e) + " por elegir") + " · " + e + " de " + q + "</small></div>" +
      '<div class="sbl">' + ss.map(function (s, i) {
        var n = m[s] || 0;
        return '<div class="sbr' + (n ? " on" : "") + '"><span>' + esc(s) + "</span>" +
          '<div class="qty"><button type="button" class="qb sbq" data-s="' + esc(p.id) + '" data-i="' + i + '" data-d="-1" aria-label="Quitar ' + esc(s) + '">−</button>' +
          "<output>" + n + "</output>" +
          '<button type="button" class="qb sbq plus" data-s="' + esc(p.id) + '" data-i="' + i + '" data-d="1" aria-label="Agregar ' + esc(s) + '">+</button></div></div>';
      }).join("") + "</div></div>";
  }
  function pintarSab(id) { var el = $("sb_" + id); if (el) el.innerHTML = sabBox(prods.filter(function (x) { return x.id === id; })[0]); }
  function sinSabor() {
    return prods.filter(function (p) { return sabores(p).length && (qty[p.id] || 0) > elegidas(p.id); }).map(function (p) { return p.name; });
  }

  function item(p) {
    var star = p.id === "toci", big = p.categoria === "hamburguesa";
    var btns = '<div class="qty"><button type="button" class="qb" data-id="' + esc(p.id) + '" data-d="-1" aria-label="Quitar ' + esc(p.name) + '">−</button>' +
      '<output id="q_' + esc(p.id) + '" aria-live="polite">0</output>' +
      '<button type="button" class="qb plus" data-id="' + esc(p.id) + '" data-d="1" aria-label="Agregar ' + esc(p.name) + '">+</button></div>';
    if (big) {
      return '<article class="pcard' + (star ? " star" : "") + '">' +
        '<div class="pmedia"><span class="ph" aria-hidden="true">🍔</span>' +
        (p.img ? '<img class="pimg" src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" onload="this.dataset.ok=1" onerror="smashImgFallback(this)">' : "") +
        (star ? '<span class="tag">La insignia</span>' : "") + "</div>" +
        '<div class="pbody"><h3 class="nm">' + esc(p.name) + "</h3>" +
        (p.desc ? '<p class="ing">' + esc(p.desc) + "</p>" : "") +
        '<div class="pfoot"><span class="pr">' + fmt(p.price) + "</span>" + btns + "</div></div>" +
        '<div class="pcombo" id="cb_' + esc(p.id) + '">' + comboBox(p) + "</div></article>";
    }
    return '<div class="item"><div class="bd"><div class="nm">' + esc(p.name) + '</div>' + (p.desc ? '<p class="ds">' + esc(p.desc) + "</p>" : "") +
      '<div class="pr">' + fmt(p.price) + "</div></div>" + btns +
      (sabores(p).length ? '<div class="psab" id="sb_' + esc(p.id) + '">' + sabBox(p) + "</div>" : "") + "</div>";
  }

  function render() {
    var principales = prods.filter(function (p) { return p.categoria === "hamburguesa"; });
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
    if (b.classList.contains("cbq")) {
      var bid = b.getAttribute("data-b"), cid = b.getAttribute("data-c"), dc = Number(b.getAttribute("data-d"));
      cq[bid] = cq[bid] || {};
      var cur = cq[bid][cid] || 0;
      if (dc > 0 && enCombo(bid) >= (qty[bid] || 0)) { $("err").textContent = "⚠ Máximo un combo por hamburguesa"; return; }
      cq[bid][cid] = Math.max(0, cur + dc);
      $("err").textContent = "";
      pintarCombo(bid);
    } else if (b.classList.contains("sbq")) {
      var sid = b.getAttribute("data-s"), sp = prods.filter(function (x) { return x.id === sid; })[0];
      var sab = sabores(sp)[Number(b.getAttribute("data-i"))], ds = Number(b.getAttribute("data-d"));
      if (!sab) return;
      sq[sid] = sq[sid] || {};
      if (ds > 0) {
        // si ya eligió el sabor de todas, el + de un sabor suma una unidad más
        if (elegidas(sid) >= (qty[sid] || 0)) { qty[sid] = (qty[sid] || 0) + 1; $("q_" + sid).textContent = qty[sid]; }
        sq[sid][sab] = (sq[sid][sab] || 0) + 1;
      } else sq[sid][sab] = Math.max(0, (sq[sid][sab] || 0) - 1);
      if ($("err").textContent.indexOf("sabor") > -1) $("err").textContent = "";
      pintarSab(sid);
    } else if (b.classList.contains("qb")) {
      var id = b.getAttribute("data-id"), d = Number(b.getAttribute("data-d"));
      var p = prods.filter(function (x) { return x.id === id; })[0];
      if (d > 0 && p && p.categoria === "hamburguesa" && burgersEnCarrito() >= restantes()) {
        $("err").textContent = restantes() <= 0 ? "⚠ Hoy se agotaron las hamburguesas" : "⚠ Solo quedan " + restantes() + " hamburguesas hoy";
        return;
      }
      qty[id] = Math.max(0, (qty[id] || 0) + d);
      $("q_" + id).textContent = qty[id];
      // si quita hamburguesas, los combos de esa hamburguesa bajan con ellas
      var m = cq[id] || {}, sobra = enCombo(id) - qty[id];
      Object.keys(m).forEach(function (k) { var r = Math.min(m[k], Math.max(0, sobra)); m[k] -= r; sobra -= r; });
      pintarCombo(id);
      // igual con los sabores: si baja la cantidad, se quitan primero los últimos sabores elegidos
      var ms = sq[id] || {}, sobraS = elegidas(id) - qty[id];
      Object.keys(ms).reverse().forEach(function (k) { var r = Math.min(ms[k], Math.max(0, sobraS)); ms[k] -= r; sobraS -= r; });
      pintarSab(id);
      if ($("err").textContent.indexOf("combo") > -1) $("err").textContent = "";
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
    prods.forEach(function (p) {
      if (p.categoria === "combo" || !qty[p.id]) return;
      if (sabores(p).length) {
        // una línea por sabor; lo que falte por elegir queda en una línea sin sabor
        var m = sq[p.id] || {}, resto = qty[p.id];
        sabores(p).forEach(function (s) {
          var n = Math.min(m[s] || 0, resto);
          if (n) { out.push({ id: p.id, name: p.name, price: p.price, qty: n, nota: "Sabor: " + s, sabor: s }); resto -= n; }
        });
        if (resto) out.push({ id: p.id, name: p.name, price: p.price, qty: resto });
        return;
      }
      out.push({ id: p.id, name: p.name, price: p.price, qty: qty[p.id] });
      if (p.categoria === "hamburguesa") combos().forEach(function (c) {
        var n = (cq[p.id] || {})[c.id] || 0;
        if (n) out.push({ id: c.id, name: c.name, price: c.price, qty: n, nota: "Para " + p.name, para: p.name });
      });
    });
    return out;
  }
  function miss() {
    var m = [];
    if (!lines().length) m.push("tu pedido");
    sinSabor().forEach(function (n) { m.push("elegir el sabor de " + n); });
    if (!val("fn")) m.push("nombre");
    if (val("fp").replace(/\D/g, "").length < 10) m.push("teléfono válido");
    if (!zone) m.push("zona");
    if (!val("fa")) m.push("dirección");
    if (!pm) m.push("medio de pago");
    return m;
  }
  function upd() {
    var L = lines(), t = 0, n = 0, txt = [];
    L.forEach(function (it) {
      t += it.price * it.qty; if (!it.para) n += it.qty;
      txt.push("- " + it.qty + " x " + it.name + (it.para ? " para " + it.para : "") + (it.sabor ? " (" + it.sabor + ")" : "") + " (" + fmt(it.price * it.qty) + ")");
    });
    var vz = !!(zone && Z[zone].variable), d = zone && !vz ? Z[zone].fee : 0, T = t + d;
    $("tot").textContent = fmt(T);
    $("lst").innerHTML = L.length ? L.map(function (it) {
      return '<div class="li' + (it.para ? " sub" : "") + '"><span>' + it.qty + "× " + esc(it.para ? "Combo para " + it.para : it.name + (it.sabor ? " · " + it.sabor : "")) + "</span><b>" + fmt(it.price * it.qty) + "</b></div>";
    }).join("") : '<p class="li-empty">Aún no has agregado productos.</p>';
    $("cnt").textContent = n ? n + (n == 1 ? " producto" : " productos") + " · " + fmt(t) : "Tu pedido está vacío";
    $("dl").textContent = !zone ? "Elige tu zona para ver el domicilio" : vz ? "Domicilio por confirmar (se suma al total)" : "Incluye domicilio " + fmt(d);
    LM = "*NUEVO PEDIDO - SMASH*\n" + (EH.abierto ? "" : "*RESERVA:* se despacha al abrir cocina, " + reservaTxt() + "\n") + "*Pedido N°:* @@\n\n*Cliente:* " + val("fn") + "\n*Teléfono:* " + val("fp") + "\n*Zona:* " + (zone ? Z[zone].nombre : "") +
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
      SmashExt.addOrder({ cliente: val("fn"), telefono: val("fp"), direccion: val("fa"), zona: Z[zone].nombre, domicilio: Z[zone].variable ? 0 : Z[zone].fee, domicilioPendiente: !!Z[zone].variable, pago: pm, notas: val("fo"), items: lines(), ref: code, origen: "web", reserva: !EH.abierto });
    } catch (x) { /* si falla el guardado local, igual se envía por WhatsApp */ }
    $("graciasSub").textContent = EH.abierto ? "Termina de enviar el mensaje en WhatsApp para confirmar tu pedido."
      : "Tu pedido quedó como reserva: lo despachamos al abrir cocina, " + reservaTxt() + ". Termina de enviar el mensaje en WhatsApp.";
    $("gracias").hidden = false;
  });
  $("graciasOk").addEventListener("click", function () { $("gracias").hidden = true; });
  $("gracias").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("gracias").hidden = true; });

  function est() {
    try {
      var antes = EH.abierto;
      EH = SmashExt.estadoHorario(H);
      $("st").classList.toggle("open", EH.abierto);
      $("stt").textContent = EH.abierto ? "Abierto ahora · hasta las " + EH.cierra : (EH.abreHoy ? "Abrimos hoy a las " + EH.abre : "Cerrado · abrimos mañana " + EH.abre);
      $("hft").textContent = EH.abre + " a " + EH.cierra;
      $("resv").hidden = EH.abierto;
      $("resv").innerHTML = EH.abierto ? "" : "🕐 <b>Ahora estamos cerrados.</b> Puedes pedir igual: tu pedido quedará como <b>reserva</b> y lo despachamos al abrir cocina, <b>" + esc(reservaTxt()) + "</b>.";
      $("go").textContent = EH.abierto ? "Enviar pedido" : "Reservar pedido";
      if (antes !== EH.abierto) upd();
    } catch (e) {}
  }

  // Foto de portada opcional (images/portada.jpg|jpeg|png|webp): se pide cuando smashImgFallback ya existe
  var portada = document.querySelector(".hero-img[data-src]");
  if (portada) portada.src = portada.getAttribute("data-src");

  /* Menú: usa menu.json (publicado desde cocina) y, si no existe, los datos locales */
  SmashExt.loadMenu().then(function (menu) {
    if (menu) {
      prods = menu.productos.filter(function (p) { return p && p.id && p.name; });
      H = menu.horario || null;
      var zs = menu.zonas || {};
      Z = Object.keys(zs).length ? zs : SmashExt.getZones();
      if (menu.cupo && menu.dia === hoyLocal()) {
        cupo = { total: menu.cupo.total, vendidas: menu.cupo.vendidas };
        try { cupo.hora = new Date(menu.generado).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }).replace(/[\u00a0\u202f]/g, " "); } catch (e) {}
      }
    } else {
      prods = SmashDB.getProducts({ soloActivos: true });
      H = SmashExt.getHorario();
      Z = SmashExt.getZones();
      var c = SmashExt.cupoHoy();
      if (c) cupo = c;
    }
    render(); est(); setInterval(est, 60000); upd();
  });
})();
