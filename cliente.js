(function () {
  var WA = "573146836097";
  var PAGOS = ["Efectivo", "Transferencia"];
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function fmt(n) { return "$" + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function hoyLocal() { return SmashExt.localDay(new Date().toISOString()); }

  var prods = [], Z = {}, zone = "", pm = "", qty = {}, LM = "", cupo = null;
  // Cada hamburguesa gasta 2 del cupo del día
  var POR_BURGER = (window.SmashExt && SmashExt.CUPO_POR_BURGER) || 2;
  // Horario de atención (menu.json o local). Fuera de horario el pedido se envía como reserva.
  var H = null, EH = { abierto: true };
  function reservaTxt() { return (EH.proxTexto || (EH.abreHoy ? "hoy" : "mañana")) + " a las " + EH.abre; }
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

  /* Cliente leal: sesión, promociones y puntos (nube.js). Sin sesión no se ve ni se aplica ninguna promoción. */
  var yo = null, promos = [], PR = { descuento: 0, usadas: [], canjes: [], faltan: [], opcionales: [] };
  var hayNube = typeof SmashNube !== "undefined" && SmashNube.ok;
  function prodDe(id) { return prods.filter(function (x) { return x.id === id; })[0] || null; }

  /* Promociones con precio en puntos: se aplican solas si al cliente le alcanzan los puntos
     (puede tocar "No usar mis puntos"). Si no le alcanzan, compra normal y al final se le
     explica cómo juntar los puntos. La nube revisa y descuenta los puntos al recibir el pedido. */
  var usarPts = {};
  var cuestaPts = function (p) { return Math.max(0, Number(p && p.puntos) || 0); };
  function gratis() { return promos.filter(function (p) { return !cuestaPts(p); }); }
  function calcularPromos(L) {
    var vacio = { descuento: 0, usadas: [], canjes: [], faltan: [], opcionales: [], regalos: [] };
    if (!yo || !hayNube) return vacio;
    var base = gratis(), saldo = Number(yo.puntos) || 0, elegidas = [], faltan = [], opcionales = [];
    // Regalo con puntos: cuenta desde que el pedido tiene las burgers, aunque el regalo aún no esté
    // en el carrito (antes no aparecía hasta que el cliente agregaba las papas a mano).
    var regDe = function (r, p) { return (r.regalos || []).filter(function (g) { return g.p.id === p.id; })[0] || null; };
    var precioRegalo = function (p) { return SmashNube.regalosDe(p).map(prodDe).filter(Boolean).reduce(function (m, x) { return Math.min(m, x.price); }, Infinity); };
    promos.filter(cuestaPts).map(function (p) {
      var r = SmashNube.aplicarPromos(L, base.concat([p]));
      var u = r.usadas.filter(function (x) { return x.id === p.id; })[0], g = p.tipo === "regalo" ? regDe(r, p) : null;
      var v = u ? u.valor : 0, activa = v > 0 || !!(g && g.gana > 0);
      return { p: p, v: v || (activa ? g.gana * (isFinite(precioRegalo(p)) ? precioRegalo(p) : 1) : 0), activa: activa, aviso: !!g };
    }).filter(function (c) { return c.activa || c.aviso; }).sort(function (a, b) { return b.v - a.v; }).forEach(function (c) {
      if (c.activa) opcionales.push(c.p);
      if (usarPts[c.p.id] === false) return;
      if (cuestaPts(c.p) > saldo) { if (c.activa) faltan.push({ p: c.p, faltan: cuestaPts(c.p) - saldo }); return; }
      // aún no le alcanzan las burgers: solo se muestra "agrega 1 más y te regalamos…", sin gastar puntos
      if (!c.activa) { elegidas.push(c.p); return; }
      var r = SmashNube.aplicarPromos(L, base.concat(elegidas, [c.p])), g = regDe(r, c.p);
      if (r.usadas.some(function (x) { return x.id === c.p.id; }) || (g && g.gana > 0)) { elegidas.push(c.p); saldo -= cuestaPts(c.p); }
    });
    var R = SmashNube.aplicarPromos(L, base.concat(elegidas));
    R.canjes = R.usadas.filter(function (u) { return u.puntos > 0; }).map(function (u) { return { promo: u.id, titulo: u.titulo, puntos: u.puntos, valor: u.valor }; });
    R.faltan = faltan; R.opcionales = opcionales;
    return R;
  }

  /* Regalos automáticos: cuando el pedido gana un regalo (ej. LUNES DE PAPAS: 2 burgers → papas
     gratis) el producto se agrega solo, y si quita burgers se quita lo que se había agregado solo.
     Si el cliente quita el regalo a mano, no se vuelve a poner hasta que gane uno más.
     Con varias opciones de regalo se pone la primera; el cliente puede cambiarla por otra. */
  var regAuto = {}, regGana = {};
  function ponerUno(id, p) {
    if (esCombo(id)) {
      // el combo de regalo va a una burger de la promo que aún no tenga combo
      var bs = Object.keys(qty).filter(function (k) { var x = prodDe(k); return x && x.categoria === "hamburguesa" && qty[k] > enCombo(k); });
      var bid = bs.filter(function (k) { return SmashNube.prodsDe(p).indexOf(k) > -1; })[0] || bs[0];
      if (!bid) return false;
      cq[bid] = cq[bid] || {}; cq[bid][id] = (cq[bid][id] || 0) + 1; pintarCombo(bid);
      return true;
    }
    if (!prodDe(id)) return false;
    qty[id] = (qty[id] || 0) + 1;
    if ($("q_" + id)) $("q_" + id).textContent = qty[id];
    pintarSab(id);
    return true;
  }
  function quitarUno(id) {
    if (esCombo(id)) {
      var bid = Object.keys(cq).filter(function (k) { return (cq[k][id] || 0) > 0; })[0];
      if (!bid) return false;
      cq[bid][id]--; pintarCombo(bid);
      return true;
    }
    if (!qty[id]) return false;
    qty[id]--;
    if ($("q_" + id)) $("q_" + id).textContent = qty[id];
    var ms = sq[id] || {}, sobra = elegidas(id) - qty[id];
    Object.keys(ms).reverse().forEach(function (k) { var r = Math.min(ms[k], Math.max(0, sobra)); ms[k] -= r; sobra -= r; });
    pintarSab(id);
    return true;
  }
  function sacarAuto(a, n) {
    Object.keys(a).forEach(function (id) {
      if (!esCombo(id)) a[id] = Math.min(a[id], qty[id] || 0);   // lo que el cliente ya quitó a mano
      while (n > 0 && a[id] > 0) { a[id]--; n--; if (!quitarUno(id)) a[id] = 0; }
    });
  }
  function regalosSolos() {
    var R = calcularPromos(lines()), vistos = {}, cambio = false;
    (R.regalos || []).forEach(function (g) {
      var k = String(g.p.id), antes = regGana[k] || 0, a = regAuto[k] = regAuto[k] || {};
      vistos[k] = 1;
      if (g.gana > antes) {
        var id = SmashNube.regalosDe(g.p).filter(prodDe)[0], n = Math.min(g.faltan, g.gana - antes);
        for (var i = 0; id && i < n; i++) if (ponerUno(id, g.p)) a[id] = (a[id] || 0) + 1;
      } else if (g.gana < antes) sacarAuto(a, antes - g.gana);
      if (g.gana !== antes) cambio = true;
      regGana[k] = g.gana;
    });
    // promo que ya no aplica (quitó las burgers, cerró sesión, no usa sus puntos): se quita su regalo
    Object.keys(regGana).forEach(function (k) { if (!vistos[k] && regGana[k]) { sacarAuto(regAuto[k] || {}, Infinity); regGana[k] = 0; cambio = true; } });
    return cambio;
  }
  /* Las unidades regaladas van en su propia línea a $0 con la nota "GRATIS · NOMBRE DE LA PROMO"
     (así salen en la comanda y en el panel). No se suman al subtotal ni se restan en el descuento:
     el cliente ve "Gratis", nunca un cobro que luego se descuenta. */
  function sinPrecioRegalos(L, R) {
    var G = SmashExt.regalosSinPrecio(L, R);
    R.usadasRegalo = (R.usadas || []).filter(function (u) { return G.regaloIds[String(u.id)] && u.puntos > 0; });
    R.usadasTodas = R.usadas || []; R.items = G.items; R.descuento = G.descuento; R.usadas = G.usadas;
    // canje de puntos por un regalo: los puntos sí se gastan, pero no hay pesos que descontar
    R.canjes = (R.canjes || []).map(function (c) { return G.regaloIds[String(c.promo)] ? Object.assign({}, c, { valor: 0 }) : c; });
    return R;
  }
  // Etiqueta corta del beneficio de una promoción
  /* Paquetes (tipo "paquete"): se ven como una burger más, solo a clientes con sesión y solo el día
     de la promo. pq = { idPromo: cuántos paquetes }. En el pedido van como sus burgers (y combos) reales. */
  var pq = {};
  function paquetes() {
    if (!yo || !hayNube) return [];
    return promos.filter(function (p) { return p.tipo === "paquete" && SmashNube.vigente(p) && SmashNube.precioNormalPaquete(p, prodDe) > 0; });
  }
  function paqDe(id) { return paquetes().filter(function (p) { return String(p.id) === String(id); })[0] || null; }
  function paqQueTrae(p) {
    var c = SmashNube.regalosDe(p).some(esCombo);
    return nombres(SmashNube.prodsDe(p), " + ") + (c ? (SmashNube.prodsDe(p).length > 1 ? ", cada una en combo (papas + gaseosa)" : " en combo (papas + gaseosa)") : "");
  }
  function paqCard(p) {
    var n = pq[p.id] || 0, normal = SmashNube.precioNormalPaquete(p, prodDe), b = prodDe(SmashNube.prodsDe(p)[0]);
    return '<article class="pcard paq">' +
      '<div class="pmedia"><span class="ph" aria-hidden="true">🏆</span>' +
      (b && b.img ? '<img class="pimg" src="' + esc(b.img) + '" alt="' + esc(p.titulo) + '" loading="lazy" onload="this.dataset.ok=1" onerror="smashImgFallback(this)">' : "") +
      '<span class="tag">🏆 Solo hoy · Club SMASH</span></div>' +
      '<div class="pbody"><h3 class="nm">' + esc(p.titulo) + "</h3>" +
      '<p class="ing">' + esc(p.descripcion || paqQueTrae(p)) + "</p>" +
      (p.descripcion ? '<p class="paq-trae">Trae: ' + esc(paqQueTrae(p)) + "</p>" : "") +
      '<div class="pfoot"><span class="pr">' + (normal > p.valor ? '<s class="pold">' + fmt(normal) + "</s> " : "") + fmt(p.valor) + "</span>" +
      '<div class="qty"><button type="button" class="qb pqb" data-paq="' + esc(p.id) + '" data-d="-1" aria-label="Quitar ' + esc(p.titulo) + '">−</button>' +
      '<output id="pq_' + esc(p.id) + '" aria-live="polite">' + n + "</output>" +
      '<button type="button" class="qb pqb plus" data-paq="' + esc(p.id) + '" data-d="1" aria-label="Agregar ' + esc(p.titulo) + '">+</button></div></div></div></article>';
  }
  function burgersEnPaquetes() {
    return paquetes().reduce(function (s, p) { return s + (pq[p.id] || 0) * SmashNube.prodsDe(p).length; }, 0);
  }

  function beneficio(p) {
    var ids = SmashNube.prodsDe(p), pr = ids.length === 1 ? prodDe(ids[0]) : null;
    if (p.tipo === "paquete") return "🏆 " + fmt(p.valor);
    if (p.tipo === "regalo") return "🎁 Regalo";
    if (p.tipo === "porcentaje") return "−" + p.valor + "%";
    if (p.tipo === "valor") return "−" + fmt(p.valor);
    if (p.tipo === "precio") return pr ? fmt(Math.max(0, pr.price - p.valor)) : "Precio especial";
    return "Beneficio";
  }
  // Pedidos enviados desde este navegador (para mostrar los puntos pendientes en el historial)
  var MIS = "smash_mis_pedidos_web";
  function misPedidos() { try { return JSON.parse(localStorage.getItem(MIS) || "[]"); } catch (e) { return []; } }
  function guardarMiPedido(x) {
    try { var l = misPedidos().filter(function (y) { return y.ref !== x.ref && Date.now() - new Date(y.en).getTime() < 15 * 864e5; }); l.unshift(x); localStorage.setItem(MIS, JSON.stringify(l.slice(0, 30))); } catch (e) { /* sin espacio */ }
  }

  // Mejor promoción gratuita de un producto, por unidad (para mostrar el precio especial en la tarjeta)
  function promoDe(p) {
    if (!yo || !promos.length) return null;
    var r = SmashNube.aplicarPromos([{ id: p.id, price: p.price, qty: 1 }], gratis().filter(function (x) { return x.tipo !== "regalo" && SmashNube.prodsDe(x).indexOf(p.id) > -1; }));
    return r.porProducto[p.id] ? { precio: p.price - r.porProducto[p.id].v, promo: r.porProducto[p.id].p } : null;
  }
  // Nombres de una lista de productos: "Smash, Toci o Bacon Royal"
  function nombres(ids, y) {
    var l = ids.map(function (id) { var x = prodDe(id); return x ? x.name : ""; }).filter(Boolean);
    return l.length < 2 ? l.join("") : l.slice(0, -1).join(", ") + (y || " y ") + l[l.length - 1];
  }
  function esCombo(id) { var x = prodDe(id); return !!x && x.categoria === "combo"; }
  // Texto del regalo: "Combo (papas + gaseosa)" · "1 a elegir: Papas o Gaseosa"
  function regaloTxt(p) {
    var ids = SmashNube.regalosDe(p);
    return (ids.length > 1 ? "1 a elegir: " : "") + nombres(ids, " o ");
  }
  function sinComboTxt(p) { return p.sin_combo !== false && !SmashNube.regalosDe(p).some(esCombo) ? " (sin combo)" : ""; }
  /* Promos de hoy encima de cada producto (solo clientes con sesión): la burger que entra
     en la promo y el producto que se regala muestran la promo con su descripción. */
  function promoTags(p) {
    if (!yo || !promos.length) return "";
    var h = promos.filter(function (x) { return SmashNube.tocaProducto(x, p.id); }).map(function (x) {
      var esRegalo = x.tipo === "regalo" && SmashNube.prodsDe(x).indexOf(p.id) < 0;
      var cada = Math.max(1, Number(x.valor) || 1);
      var txt = x.tipo === "regalo"
        ? (esRegalo ? "Gratis por cada " + (cada > 1 ? cada + " burgers" : "burger") + " que pidas"
          : "Te regalamos " + regaloTxt(x) + (cada > 1 ? " por cada " + cada + " burgers" : " por cada burger") + sinComboTxt(x))
        : (x.descripcion || "");
      return '<div class="ppromo' + (x.tipo === "regalo" ? " gift" : "") + '"><b>' + (x.tipo === "regalo" ? "🎁 " : "⭐ ") + esc(x.titulo) + (cuestaPts(x) ? " · " + cuestaPts(x) + " pts" : "") + "</b>" +
        (txt ? "<span>" + esc(txt) + "</span>" : "") + "</div>";
    }).join("");
    return h ? '<div class="ppromos">' + h + "</div>" : "";
  }
  /* ---------------- Promos de la semana (vitrina para todos) ----------------
     Muestra las promos de hoy y de los próximos 6 días. Sin cuenta invita a registrarse;
     con cuenta, las de hoy se agregan al pedido (las de otros días dicen cuándo aplican). */
  var SEM = { lista: [], sel: "", cargada: false };
  var DIA_CORTO = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  function ymdMas(ymd, n) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function semDias() {
    var hoy = SmashNube.hoyCO(), out = [];
    for (var i = 0; i < 7; i++) {
      var d = ymdMas(hoy, i), dw = new Date(d + "T12:00:00Z").getUTCDay();
      out.push({ d: d, i: i, dw: dw, corto: i === 0 ? "Hoy" : i === 1 ? "Mañana" : DIA_CORTO[dw], largo: i === 0 ? "hoy" : i === 1 ? "mañana" : "el " + SmashExt.DIA_LARGO[dw],
        cierre: SmashExt.cierreDe ? SmashExt.cierreDe(H, d) : null,
        promos: SEM.lista.filter(function (p) { return SmashNube.aplicaEl(p, d); }) });
    }
    return out;
  }
  function semTexto(p) {
    var ids = SmashNube.prodsDe(p), cada = Math.max(1, Number(p.valor) || 1);
    if (p.descripcion) return p.descripcion;
    if (p.tipo === "regalo") return regaloTxt(p) + " gratis por cada " + (cada > 1 ? cada + " burgers" : "burger") + sinComboTxt(p) + ".";
    if (p.tipo === "paquete") return paqQueTrae(p) + ".";
    if (p.tipo === "incentivo") return "Beneficio para clientes del club.";
    return ids.length ? "En " + nombres(ids, " y ") + "." : "En todo tu pedido.";
  }
  function semBeneficio(p) {
    if (p.tipo === "incentivo") return "⭐ Beneficio";
    if (p.tipo === "valor") return "−" + fmt(p.valor);
    return beneficio(p);
  }
  function semCta(p, dia) {
    if (!yo) return '<button type="button" class="sem-btn" data-acc="registro">Únete y recibe 15 pts 🎁</button>';
    if (dia.i > 0) return '<span class="sem-cuando">Disponible ' + esc(dia.largo) + "</span>";
    var ids = SmashNube.prodsDe(p), dentro = (PR.usadasTodas || PR.usadas).some(function (u) { return String(u.id) === String(p.id); });
    if (dentro) return '<span class="sem-ok">✓ Ya está en tu pedido</span>';
    if (p.tipo === "paquete" && paqDe(p.id)) return '<button type="button" class="sem-btn" data-addpaq="' + esc(p.id) + '">Agregar al pedido</button>';
    if (p.tipo !== "regalo" && ids.length === 1 && prodDe(ids[0])) return '<button type="button" class="sem-btn" data-addpromo="' + esc(ids[0]) + '">Agregar ' + esc(prodDe(ids[0]).name) + "</button>";
    return '<span class="sem-cuando">Se aplica sola en tu pedido</span>';
  }
  function pintarSemana() {
    var sec = $("promos"); if (!sec) return;
    var dias = semDias(), hay = dias.some(function (x) { return x.promos.length; });
    sec.hidden = !hay; if ($("catPromos")) $("catPromos").hidden = !hay;
    if (!hay) return;
    if (!dias.some(function (x) { return x.d === SEM.sel; })) {
      var primero = dias.filter(function (x) { return x.promos.length && !x.cierre; })[0];
      SEM.sel = (dias[0].promos.length && !dias[0].cierre ? dias[0] : primero || dias[0]).d;
    }
    $("semSub").textContent = yo ? "Las de hoy se aplican solas al agregar los productos. Elige un día para ver qué viene."
      : "Exclusivas para clientes registrados. Regístrate gratis y te regalamos 15 puntos para usarlas.";
    var tira = $("semDias"), sl = tira.scrollLeft;
    tira.innerHTML = dias.map(function (x) {
      var on = x.d === SEM.sel;
      return '<button type="button" role="tab" aria-selected="' + on + '" class="sem-dia' + (on ? " on" : "") + (x.cierre ? " cerr" : x.promos.length ? " con" : "") + '" data-semdia="' + x.d + '">' +
        "<b>" + x.corto + "</b><small>" + (x.cierre ? "Descanso" : x.promos.length ? x.promos.length + (x.promos.length > 1 ? " promos" : " promo") : "—") + "</small></button>";
    }).join("");
    // la tira conserva su posición al redibujar y siempre deja a la vista el día elegido
    tira.scrollLeft = sl;
    var on = tira.querySelector(".on");
    if (on && tira.scrollWidth > tira.clientWidth && (on.offsetLeft < tira.scrollLeft || on.offsetLeft + on.offsetWidth > tira.scrollLeft + tira.clientWidth)) tira.scrollLeft = on.offsetLeft - 16;
    var dia = dias.filter(function (x) { return x.d === SEM.sel; })[0];
    if (dia.cierre) { $("semList").innerHTML = '<p class="sem-vacio">🛠️ ' + esc(dia.largo.charAt(0).toUpperCase() + dia.largo.slice(1)) + " no abrimos (" + esc(dia.cierre.toLowerCase()) + "). ¡Te esperamos el día siguiente!</p>"; return; }
    if (!dia.promos.length) { $("semList").innerHTML = '<p class="sem-vacio">Ese día no hay promos. Mira los otros días de la semana.</p>'; return; }
    $("semList").innerHTML = dia.promos.map(function (p) {
      var c = cuestaPts(p);
      return '<article class="sem-card t-' + esc(p.tipo) + '">' +
        '<div class="sem-top"><span class="sem-ben">' + esc(semBeneficio(p)) + "</span>" +
        '<span class="sem-cost' + (c ? "" : " free") + '">' + (c ? "⭐ " + c + " pts" : "Gratis con tu cuenta") + "</span></div>" +
        "<h3>" + esc(p.titulo) + "</h3>" +
        '<p class="sem-d">' + esc(semTexto(p)) + "</p>" +
        '<small class="sem-dias-txt">📅 ' + esc(SmashNube.textoDias(p)) + "</small>" +
        '<div class="sem-foot">' + semCta(p, dia) + "</div></article>";
    }).join("");
  }
  function cargarSemana() {
    if (!hayNube || !SmashNube.promosSemana) return;
    SmashNube.promosSemana().then(function (l) { SEM.lista = (l || []).filter(function (p) { return p && p.activa !== false; }); SEM.cargada = true; pintarSemana(); pintarClub(); }, function () {});
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-semdia]") : null;
    if (!b) return;
    SEM.sel = b.getAttribute("data-semdia"); pintarSemana();
  });

  function precioHtml(p) {
    var pr = promoDe(p);
    var canje = yo && promos.some(function (x) { return cuestaPts(x) && x.tipo !== "regalo" && SmashNube.prodsDe(x).indexOf(p.id) > -1; }) ? ' <span class="ptag pts">⭐ Canjeable</span>' : "";
    if (!pr) return fmt(p.price) + canje;
    var et = pr.promo.tipo === "porcentaje" ? "−" + pr.promo.valor + "%" : "Promo";
    return '<s class="pold">' + fmt(p.price) + "</s> " + fmt(pr.precio) + ' <span class="ptag">⭐ ' + esc(et) + "</span>" + canje;
  }

  /* Zona del Club SMASH: solo la ven los clientes con sesión iniciada */
  var REGLAS_TXT = "hamburguesa 10 · combo +5 · papas 2 · gaseosa 2 · salsa 1";
  /* Meta de puntos: la promo con puntos más cercana de esta semana (o "ya te alcanza para todas") */
  function metaPts(saldo) {
    var vistas = {}, todas = (SEM.lista || []).concat(promos).filter(function (p) {
      if (!p || !(cuestaPts(p) > 0) || vistas[p.id]) return false; vistas[p.id] = true; return true;
    });
    if (!todas.length) return "";
    var sig = null;
    todas.forEach(function (p) { var c = cuestaPts(p); if (c > saldo && (!sig || c < cuestaPts(sig))) sig = p; });
    if (!sig) return '<div class="cz-meta done"><span class="czm-ico" aria-hidden="true">🏆</span><div><b>¡Tus puntos ya alcanzan para todas las promos con puntos!</b><small>Úsalos el día de cada promo; se aplican solos.</small></div></div>';
    var c = cuestaPts(sig), pct = Math.round(Math.min(100, (saldo / c) * 100)), falta = c - saldo;
    var burgers = Math.ceil(falta / 10);
    return '<div class="cz-meta"><span class="czm-ico" aria-hidden="true">🎯</span><div class="czm-in"><b>Próxima meta: ' + esc(sig.titulo) + "</b>" +
      '<div class="czm-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + c + '" aria-valuenow="' + saldo + '"><i style="--p:' + pct + '%"></i></div>' +
      "<small>Te faltan <b>" + falta + " pts</b> · más o menos " + burgers + " burger" + (burgers > 1 ? "s" : "") + " · " + esc(SmashNube.textoDias(sig)) + "</small></div></div>";
  }
  function pintarClub() {
    var z = $("club"); if (!z) return;
    z.hidden = !yo || !hayNube;
    if (z.hidden) { z.innerHTML = ""; return; }
    var saldo = Number(yo.puntos) || 0, enPedido = {};
    (PR.usadasTodas || PR.usadas).forEach(function (u) { if (u.id != null) enPedido[u.id] = true; });
    var lista = promos.slice().sort(function (a, b) { return cuestaPts(a) - cuestaPts(b); });
    var tarjetas = lista.map(function (p) {
      var ids = SmashNube.prodsDe(p), c = cuestaPts(p), falta = Math.max(0, c - saldo), pr = ids.length === 1 ? prodDe(ids[0]) : null, dentro = !!enPedido[p.id];
      var off = c && usarPts[p.id] === false;
      var estado = dentro ? '<span class="czc-ok">✓ En tu pedido' + (c ? " · usa " + c + " pts" : "") + "</span>"
        : falta ? '<div class="czc-bar" aria-hidden="true"><i style="width:' + Math.round(Math.min(100, (saldo / c) * 100)) + '%"></i></div><small class="czc-falta">Te faltan <b>' + falta + " pts</b> · tienes " + saldo + "</small>"
        : off ? '<small class="czc-falta">No vas a usar tus puntos en esta promo</small>'
        : "";
      var btn = p.tipo === "paquete" ? (!dentro && paqDe(p.id) ? '<button type="button" class="czc-btn" data-addpaq="' + esc(p.id) + '">Agregar al pedido</button>' : "")
        : pr && !dentro ? '<button type="button" class="czc-btn" data-addpromo="' + esc(pr.id) + '">' + (falta ? "Agregar igual" : "Agregar al pedido") + "</button>"
        : off ? '<button type="button" class="czc-btn ghost" data-sipts="' + esc(p.id) + '">Usar mis puntos</button>' : "";
      return '<article class="czc' + (falta ? " lock" : "") + (dentro ? " in" : "") + '">' +
        '<div class="czc-top"><span class="czc-b">' + esc(beneficio(p)) + '</span><span class="czc-cost' + (c ? "" : " free") + '">' + (c ? "⭐ " + c + " pts" : "Gratis") + "</span></div>" +
        '<b class="czc-t">' + esc(p.titulo) + "</b>" +
        (p.descripcion ? '<p class="czc-d">' + esc(p.descripcion) + "</p>" : "") +
        '<small class="czc-p">' + (p.tipo === "paquete" ? "🏆 " + esc(paqQueTrae(p)) : p.tipo === "regalo" ? "🎁 " + esc(regaloTxt(p)) + " gratis con " + esc(nombres(ids, ", ")) : ids.length ? "🍔 " + esc(nombres(ids)) : "🧾 En todo tu pedido") + "</small>" +
        estado + btn + "</article>";
    }).join("");
    z.innerHTML = '<div class="cz-head"><div><span class="eyebrow gold">Club SMASH</span><h3>Tus promos de hoy</h3></div>' +
      '<div class="cz-pts"><b data-pts="' + saldo + '">' + saldo + "</b><small>tus puntos</small></div></div>" + metaPts(saldo) +
      (tarjetas ? '<div class="cz-list">' + tarjetas + "</div>" : '<p class="cz-empty">Hoy no hay promociones. Sigue sumando puntos: pronto llegan nuevas.</p>') +
      '<p class="cz-how">Ganas puntos cuando entregamos tu pedido: ' + REGLAS_TXT + '. <button type="button" class="lnk" data-acc="cuenta">Ver mi historial</button></p>';
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-addpromo],[data-nopts],[data-sipts],[data-addpaq]") : null;
    if (!b) return;
    if (b.hasAttribute("data-addpaq")) {
      var pb = document.querySelector('.pqb.plus[data-paq="' + b.getAttribute("data-addpaq") + '"]');
      if (pb) { pb.click(); var pc = pb.closest(".pcard"); if (pc) pc.scrollIntoView({ behavior: "smooth", block: "center" }); }
      return;
    }
    if (b.hasAttribute("data-nopts")) { usarPts[b.getAttribute("data-nopts")] = false; upd(); return; }
    if (b.hasAttribute("data-sipts")) { delete usarPts[b.getAttribute("data-sipts")]; upd(); return; }
    var id = b.getAttribute("data-addpromo");
    if (esCombo(id)) {
      // el combo de regalo va a una burger del pedido que aún no tenga combo
      var bid = Object.keys(qty).filter(function (k) { var x = prodDe(k); return x && x.categoria === "hamburguesa" && qty[k] > enCombo(k); })[0];
      if (!bid) return;
      cq[bid] = cq[bid] || {}; cq[bid][id] = (cq[bid][id] || 0) + 1;
      pintarCombo(bid); upd();
      var cb = $("cb_" + bid); if (cb) cb.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    var plus = document.querySelector('.qb.plus[data-id="' + id + '"]');
    if (plus) { plus.click(); var card = plus.closest(".pcard,.item"); if (card) card.scrollIntoView({ behavior: "smooth", block: "center" }); }
  });

  function item(p) {
    var star = p.id === "toci", big = p.categoria === "hamburguesa";
    var btns = '<div class="qty"><button type="button" class="qb" data-id="' + esc(p.id) + '" data-d="-1" aria-label="Quitar ' + esc(p.name) + '">−</button>' +
      '<output id="q_' + esc(p.id) + '" aria-live="polite">' + (qty[p.id] || 0) + "</output>" +
      '<button type="button" class="qb plus" data-id="' + esc(p.id) + '" data-d="1" aria-label="Agregar ' + esc(p.name) + '">+</button></div>';
    if (big) {
      return '<article class="pcard' + (star ? " star" : "") + '">' +
        '<div class="pmedia"><span class="ph" aria-hidden="true">🍔</span>' +
        (p.img ? '<img class="pimg" src="' + esc(p.img) + '" alt="' + esc(p.name) + '" loading="lazy" onload="this.dataset.ok=1" onerror="smashImgFallback(this)">' : "") +
        (star ? '<span class="tag">La insignia</span>' : "") + "</div>" +
        '<div class="pbody">' + promoTags(p) + '<h3 class="nm">' + esc(p.name) + "</h3>" +
        (p.desc ? '<p class="ing">' + esc(p.desc) + "</p>" : "") +
        '<div class="pfoot"><span class="pr">' + precioHtml(p) + "</span>" + btns + "</div></div>" +
        '<div class="pcombo" id="cb_' + esc(p.id) + '">' + comboBox(p) + "</div></article>";
    }
    return '<div class="item"><div class="bd">' + promoTags(p) + '<div class="nm">' + esc(p.name) + '</div>' + (p.desc ? '<p class="ds">' + esc(p.desc) + "</p>" : "") +
      '<div class="pr">' + precioHtml(p) + "</div></div>" + btns +
      (sabores(p).length ? '<div class="psab" id="sb_' + esc(p.id) + '">' + sabBox(p) + "</div>" : "") + "</div>";
  }

  function render() {
    var principales = prods.filter(function (p) { return p.categoria === "hamburguesa"; });
    var adicionales = prods.filter(function (p) { return p.categoria === "adicional"; });
    var pqs = paquetes();
    Object.keys(pq).forEach(function (k) { if (!paqDe(k)) delete pq[k]; });   // paquetes que ya no aplican (salió, cambió el día)
    $("burgers").innerHTML = principales.length ? '<div class="grid">' + pqs.map(paqCard).join("") + principales.map(item).join("") + "</div>" : '<p class="sub">No hay productos disponibles por ahora.</p>';
    $("extras").innerHTML = adicionales.map(item).join("");
    $("zones").innerHTML = Object.keys(Z).map(function (k) {
      return '<button type="button" class="chip" data-z="' + esc(k) + '">' + esc(Z[k].nombre) + "<small>" + (Z[k].variable ? "valor por confirmar" : fmt(Z[k].fee)) + "</small></button>";
    }).join("");
    $("pays").innerHTML = PAGOS.map(function (p) { return '<button type="button" class="chip" data-p="' + p + '">' + p + "</button>"; }).join("");
    mark("z", zone); mark("p", pm);
    pintarCupo();
  }
  function pintarCupo() {
    if (cupo) {
      var rest = Math.max(0, cupo.total - cupo.vendidas), el = $("cupo");
      if (rest < POR_BURGER) rest = 0;   // lo que sobra no alcanza para otra hamburguesa
      el.hidden = false;
      var pct = cupo.total > 0 ? Math.round((rest / cupo.total) * 100) : 0, poco = rest > 0 && pct <= 25;
      el.className = "cupo" + (rest <= 0 ? " out" : poco ? " low" : "");
      el.innerHTML = '<div class="cupo-top"><span>' + (rest <= 0 ? "Cupo de hoy agotado" : "🍔 Quedan hoy") + "</span><b>" + rest + "<small> / " + cupo.total + "</small></b></div>" +
        '<span class="cupo-bar"><i style="width:' + pct + '%"></i></span>' +
        '<small class="cupo-msg">' + (rest <= 0 ? "Vuelve mañana o déjanos tu reserva." : poco ? "🔥 ¡Quedan pocas! Asegura la tuya." : "Hechas por tandas: cuando se acaban, se acaban.") +
        (cupo.hora ? " · actualizado " + esc(cupo.hora) : "") + "</small>";
    } else $("cupo").hidden = true;
  }

  /* Cupo en línea: cocina lo publica en la nube y aquí se ve al instante
     (si la nube no tiene cupo de hoy, queda el de menu.json, si lo hay). */
  var cupoMenu = null;
  function horaCorta(iso) {
    try { return new Date(iso).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }).replace(/[  ]/g, " "); } catch (e) { return ""; }
  }
  function seguirCupoNube() {
    if (!hayNube || !SmashNube.seguirCupo) return;
    SmashNube.seguirCupo(function (c) {
      cupo = c ? { total: c.total, vendidas: c.vendidas, hora: horaCorta(c.actualizado) } : cupoMenu;
      pintarCupo(); upd();
    });
  }

  function restantes() { return cupo ? Math.max(0, cupo.total - cupo.vendidas) : Infinity; }
  // Lo que gasta del cupo lo que hay en el carrito: cada hamburguesa gasta POR_BURGER
  function burgersEnCarrito() {
    var n = 0;
    prods.forEach(function (p) { if (p.categoria === "hamburguesa") n += qty[p.id] || 0; });
    return (n + burgersEnPaquetes()) * POR_BURGER;
  }
  // Cuántas hamburguesas más alcanzan con lo que queda del cupo
  function alcanzan() { return Math.max(0, Math.floor((restantes() - burgersEnCarrito()) / POR_BURGER)); }

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
    } else if (b.classList.contains("pqb")) {
      var pk = b.getAttribute("data-paq"), pp = paqDe(pk), pd = Number(b.getAttribute("data-d"));
      if (!pp) return;
      if (pd > 0 && alcanzan() < SmashNube.prodsDe(pp).length) {
        $("err").textContent = restantes() < POR_BURGER ? "⚠ Hoy se agotaron las hamburguesas" : "⚠ Lo que queda del cupo de hoy no alcanza para otro paquete";
        return;
      }
      pq[pp.id] = Math.max(0, Math.min(20, (pq[pp.id] || 0) + pd));
      if (!pq[pp.id]) delete pq[pp.id];
      $("pq_" + pp.id).textContent = pq[pp.id] || 0;
      if ($("err").textContent.indexOf("paquete") > -1) $("err").textContent = "";
    } else if (b.classList.contains("qb")) {
      var id = b.getAttribute("data-id"), d = Number(b.getAttribute("data-d"));
      var p = prods.filter(function (x) { return x.id === id; })[0];
      if (d > 0 && p && p.categoria === "hamburguesa" && alcanzan() < 1) {
        $("err").textContent = restantes() < POR_BURGER ? "⚠ Hoy se agotaron las hamburguesas" : "⚠ Ya tienes en tu pedido todas las hamburguesas que quedan hoy";
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
  ["fn", "fp", "fp2", "fa", "fo"].forEach(function (i) { var e = $(i); if (e) e.addEventListener("input", upd); });
  if ($("fh")) $("fh").addEventListener("change", upd);
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
        if (n) out.push({ id: c.id, name: c.name, price: c.price, qty: n, nota: "Para " + p.name, para: p.name, paraId: p.id });
      });
    });
    // paquetes: sus burgers y combos reales (así cocina, el cupo y los puntos los cuentan normal)
    paquetes().forEach(function (p) { if (pq[p.id]) out = out.concat(SmashNube.lineasPaquete(p, pq[p.id], prodDe)); });
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
    // un regalo puede cambiar otra promo (ej. el combo regalado ya trae gaseosa): se repite hasta que quede quieto
    for (var vuelta = 0; vuelta < 4 && regalosSolos(); vuelta++) { /* otra vuelta */ }
    // promociones y puntos: solo con sesión de cliente leal
    var L0 = lines();
    PR = sinPrecioRegalos(L0, calcularPromos(L0));
    var L = PR.items, t = 0, n = 0, txt = [];
    L.forEach(function (it) {
      t += it.price * it.qty; if (!it.para) n += it.qty;
      // regalo: primero el nombre de la promo en grande y debajo la adición gratis, sin precio
      if (it.regalo) { txt.push("🎁 *GRATIS · " + it.regalo + "*\n- " + it.qty + " x " + (it.para ? "Combo para " + it.para : it.name) + (it.sabor ? " (" + it.sabor + ")" : "") + " (gratis)"); return; }
      txt.push("- " + it.qty + " x " + it.name + (it.para ? " para " + it.para : "") + (it.sabor ? " (" + it.sabor + ")" : "") + (it.paqT ? " [" + it.paqT + "]" : "") + " (" + fmt(it.price * it.qty) + ")");
    });
    // en el carrito cada paquete se ve como una sola línea
    var paqVisto = {};
    var filas = L.map(function (it) {
      if (it.regalo) return '<div class="li gift-li' + (it.para ? " sub" : "") + '"><span>' + it.qty + "× " + esc(it.para ? "Combo para " + it.para : it.name + (it.sabor ? " · " + it.sabor : "")) +
        ' <small class="li-gift">🎁 Gratis · ' + esc(it.regalo) + "</small></span><b>Gratis</b></div>";
      if (it.paq == null) return '<div class="li' + (it.para ? " sub" : "") + '"><span>' + it.qty + "× " + esc(it.para ? "Combo para " + it.para : it.name + (it.sabor ? " · " + it.sabor : "")) + "</span><b>" + fmt(it.price * it.qty) + "</b></div>";
      var k = String(it.paq); if (paqVisto[k]) return ""; paqVisto[k] = 1;
      var s = L.filter(function (x) { return String(x.paq) === k; }).reduce(function (a, x) { return a + x.price * x.qty; }, 0);
      return '<div class="li paq"><span>' + it.paqN + "× 🏆 " + esc(it.paqT) + "</span><b>" + fmt(s) + "</b></div>";
    }).join("");
    var desc = PR.descuento, puntos = hayNube ? SmashNube.puntosPedido(L, prodDe) : 0;
    var vz = !!(zone && Z[zone].variable), d = zone && !vz ? Z[zone].fee : 0, T = t - desc + d;
    $("tot").textContent = fmt(T);
    $("lst").innerHTML = L.length ? filas + (PR.usadasRegalo || []).map(function (u) {
      return '<div class="li promo"><span>🎁 ' + esc(u.titulo) + ' <small class="li-pts">usa ' + u.puntos + ' pts · <button type="button" class="lnk" data-nopts="' + esc(u.id) + '">No usar mis puntos</button></small></span><b>Gratis</b></div>';
    }).join("") + PR.usadas.map(function (u) {
      return '<div class="li promo"><span>⭐ ' + esc(u.titulo) + (u.puntos ? ' <small class="li-pts">usa ' + u.puntos + ' pts · <button type="button" class="lnk" data-nopts="' + esc(u.id) + '">No usar mis puntos</button></small>' : "") + "</span><b>−" + fmt(u.valor) + "</b></div>";
    }).join("") + PR.faltan.map(function (f) {
      return '<div class="li promo lock"><span>🔒 ' + esc(f.p.titulo) + ' <small class="li-pts">te faltan ' + f.faltan + " pts</small></span><b>—</b></div>";
    }).join("") + PR.opcionales.filter(function (p) { return usarPts[p.id] === false; }).map(function (p) {
      return '<div class="li promo off"><span>⭐ ' + esc(p.titulo) + ' <small class="li-pts"><button type="button" class="lnk" data-sipts="' + esc(p.id) + '">Usar ' + cuestaPts(p) + " pts</button></small></span><b>—</b></div>";
    }).join("") + PR.regalos.filter(function (g) { return g.faltan > 0 || g.siguiente > 0; }).map(function (g) {
      // Regalo ganado que aún no está en el pedido: botones para agregarlo (el cliente elige cuál)
      var ops = SmashNube.regalosDe(g.p).filter(prodDe);
      if (g.faltan > 0) return '<div class="li promo gift"><span>🎁 <b>' + esc(g.p.titulo) + ":</b> te " + (g.faltan > 1 ? "regalamos " + g.faltan : "regalamos 1") + (ops.length > 1 ? ". Elige " + (g.faltan > 1 ? "" : "solo 1") + ": " : ". Agrégalo: ") +
        ops.map(function (id) { return '<button type="button" class="lnk gift-add" data-addpromo="' + esc(id) + '">+ ' + esc(prodDe(id).name) + "</button>"; }).join(" ") + "</span><b>Gratis</b></div>";
      return '<div class="li promo gift off"><span>🎁 <b>' + esc(g.p.titulo) + ":</b> agrega " + g.siguiente + " burger" + (g.siguiente > 1 ? "s" : "") + " más y te regalamos " + esc(nombres(ops, " o ")) + "</span><b>—</b></div>";
    }).join("")
      : '<p class="li-empty">Aún no has agregado productos.</p>';
    $("cnt").textContent = n ? n + (n == 1 ? " producto" : " productos") + " · " + fmt(t) : "Tu pedido está vacío";
    $("desc").hidden = !desc;
    $("desc").textContent = desc ? "⭐ Descuento cliente: −" + fmt(desc) : "";
    $("dl").textContent = !zone ? "Elige tu zona para ver el domicilio" : vz ? "Domicilio por confirmar (se suma al total)" : "Incluye domicilio " + fmt(d);
    $("pts").hidden = !puntos;
    var usaPts = PR.canjes.reduce(function (s, c) { return s + c.puntos; }, 0);
    $("pts").textContent = !puntos ? "" : yo ? "⭐ Ganas " + puntos + " puntos al recibir este pedido" + (usaPts ? " · usas " + usaPts : "") : "Regístrate y gana " + puntos + " puntos con este pedido";
    LM = "*NUEVO PEDIDO - SMASH*\n" + (EH.abierto ? "" : "*RESERVA:* se despacha al abrir cocina, " + reservaTxt() + "\n") + "*Pedido N°:* @@\n" +
      (yo ? "*Cuenta SMASH:* " + (yo.usuario || "") + " (" + yo.correo + ")\n" : "") +
      "\n*Cliente:* " + val("fn") + "\n*Teléfono:* " + val("fp") + (val("fp2") ? "\n*Tel. referencia:* " + val("fp2") : "") + "\n*Zona:* " + (zone ? Z[zone].nombre : "") +
      "\n*Dirección:* " + val("fa") + "\n*Medio de pago:* " + pm + (horaSel() ? "\n*Hora de entrega:* " + horaSel() : "") + "\n\n" +
      PR.usadas.map(function (u) { return "*PROMO: " + u.titulo + "*\n"; }).join("") + "*Pedido:*\n" + txt.join("\n") + "\n\n*Subtotal:* " + fmt(t) +
      (desc ? "\n*Descuento cliente leal:* -" + fmt(desc) + " (" + PR.usadas.map(function (u) { return u.titulo + (u.puntos ? " con " + u.puntos + " pts" : ""); }).join("; ") + ")" : "") +
      "\n*Domicilio:* " + (vz ? "Por confirmar (agencia)" : fmt(d)) + "\n*TOTAL A PAGAR:* " + fmt(T) + (vz ? " + domicilio" : "") +
      (yo && puntos ? "\n*Puntos a sumar:* " + puntos : "") + (val("fo") ? "\n\n*Notas:* " + val("fo") : "");
    $("go").href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(LM);
    if (!miss().length) $("err").textContent = "";
    pintarClub();
    if (SEM.cargada) pintarSemana();
  }

  $("go").addEventListener("click", function (e) {
    if (cupo && burgersEnCarrito() > restantes()) { e.preventDefault(); var cab = Math.floor(restantes() / POR_BURGER); $("err").textContent = cab < 1 ? "⚠ Hoy se agotaron las hamburguesas" : "⚠ Hoy solo alcanzan " + cab + " hamburguesa" + (cab > 1 ? "s" : "") + " más: quita algunas de tu pedido"; return; }
    var m = miss();
    if (m.length) { e.preventDefault(); $("err").textContent = "⚠ Falta: " + m.join(", "); return; }
    $("err").textContent = "";
    var d = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
    var z = function (x) { return ("0" + x).slice(-2); }, a = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    var code = "#" + z(d.getDate()) + z(d.getMonth() + 1) + "-" + z(d.getHours()) + z(d.getMinutes()) + a[Math.floor(Math.random() * a.length)] + Math.floor(Math.random() * 10);
    $("go").href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(LM.replace("@@", code));
    var pedido = { cliente: val("fn"), telefono: val("fp"), telefono2: val("fp2"), direccion: val("fa"), zona: Z[zone].nombre, domicilio: Z[zone].variable ? 0 : Z[zone].fee, domicilioPendiente: !!Z[zone].variable, pago: pm, horaEntrega: horaSel(), notas: val("fo"), items: PR.items || lines(), ref: code, origen: "web", reserva: !EH.abierto,
      descuento: PR.descuento, descuentos: PR.usadas, cuenta: yo ? { usuario: yo.usuario || "", correo: yo.correo } : null };
    if (yo && PR.canjes.length) pedido.canjes = PR.canjes;
    var ptsGana = yo && hayNube ? SmashNube.puntosPedido(pedido.items, prodDe) : 0, ptsUsa = PR.canjes.reduce(function (s, c) { return s + c.puntos; }, 0);
    var faltaron = PR.faltan.slice(), saldoAntes = yo ? Number(yo.puntos) || 0 : 0;
    if (yo) guardarMiPedido({ ref: code, en: new Date().toISOString(), puntos: ptsGana, usa: ptsUsa });
    pintarGraciasLeal(ptsGana, PR.canjes.slice(), faltaron, saldoAntes, null);
    try { SmashExt.addOrder(pedido); } catch (x) { /* si falla el guardado local, igual se envía por WhatsApp */ }
    // Pedido directo a caja (en tiempo real). WhatsApp queda como confirmación del cliente.
    var gn = $("graciasNube");
    if (!gn) { gn = document.createElement("p"); gn.id = "graciasNube"; gn.className = "gsub"; $("graciasSub").insertAdjacentElement("afterend", gn); }
    gn.textContent = "⏳ Enviando tu pedido a la cocina…";
    var nubeMal = function (x) { console.warn("Pedido web no enviado:", x); gn.textContent = "⚠ No pudimos pasarlo directo a la cocina. Envía el mensaje de WhatsApp para que lo recibamos."; };
    if (typeof SmashNube !== "undefined" && SmashNube.enviarPedido) {
      try {
        SmashNube.enviarPedido(code, pedido).then(function (r) {
          if (r.ok) gn.textContent = "✓ Tu pedido " + code + " ya llegó a la cocina."; else nubeMal(r.error);
          // puntos al día: si había canje, se confirma que la nube los descontó
          if (r.ok && yo) SmashNube.perfil(true).then(function (p) {
            if (!p) return;
            var canjeOk = !ptsUsa || (Number(p.puntos) || 0) <= saldoAntes - ptsUsa;
            yo = p; pintarCuenta(); upd();
            pintarGraciasLeal(ptsGana, canjeOk ? pedido.canjes || [] : [], faltaron, saldoAntes, canjeOk ? null : "no");
          }, function () {});
        }, nubeMal);
      } catch (x) { nubeMal(x); }
    } else nubeMal("sin conexión");
    $("graciasSub").textContent = EH.abierto ? "Termina de enviar el mensaje en WhatsApp para confirmar tu pedido."
      : "Tu pedido quedó como reserva: lo despachamos al abrir cocina, " + reservaTxt() + ". Termina de enviar el mensaje en WhatsApp.";
    $("gracias").hidden = false;
    // cliente-vivo.js: seguimiento del pedido y celebración
    try { document.dispatchEvent(new CustomEvent("smash:pedido", { detail: { ref: code, total: $("tot").textContent, n: pedido.items.reduce(function (s, it) { return s + (Number(it.qty) || 0); }, 0), reserva: pedido.reserva, pts: ptsGana } })); } catch (x) { /* navegador viejo */ }
  });
  /* Mensaje de puntos al enviar el pedido (solo clientes con cuenta) */
  function pintarGraciasLeal(gana, canjes, faltaron, saldoAntes, canjeFallo) {
    var box = $("graciasLeal");
    if (!box) { box = document.createElement("div"); box.id = "graciasLeal"; box.className = "gleal"; $("graciasOk").insertAdjacentElement("beforebegin", box); }
    if (!yo) { box.hidden = true; box.innerHTML = ""; return; }
    var usa = canjes.reduce(function (s, c) { return s + c.puntos; }, 0), h = "";
    if (gana) h += '<div class="gl-row"><span class="gl-ico">⭐</span><div><b>+' + gana + " puntos</b> cuando entreguemos tu pedido.<small>Los verás en tu historial de puntos.</small></div></div>";
    if (usa) h += '<div class="gl-row"><span class="gl-ico">🎟️</span><div><b>Canjeaste ' + usa + " puntos</b> en " + canjes.map(function (c) { return esc(c.titulo); }).join(", ") + ".<small>Te quedan " + Math.max(0, saldoAntes - usa) + " puntos.</small></div></div>";
    if (canjeFallo) h += '<div class="gl-row warn"><span class="gl-ico">⚠️</span><div><b>No pudimos aplicar tu promo con puntos.</b><small>Tu pedido sigue con el precio normal y tus puntos quedan intactos.</small></div></div>';
    if (faltaron.length) {
      var f = faltaron[0], despues = saldoAntes - usa + gana;
      h += '<div class="gl-how"><b>🔒 Te faltaron ' + f.faltan + " puntos para «" + esc(f.p.titulo) + "»</b>" +
        "<p>Así funcionan tus puntos: con cada pedido entregado sumas " + REGLAS_TXT + ". Las promos con puntos se aplican solas cuando te alcanzan.</p>" +
        "<p>Con este pedido llegarás a <b>" + despues + " de " + cuestaPts(f.p) + " puntos</b>" + (despues >= cuestaPts(f.p) ? ": ¡en tu próximo pedido ya la puedes usar!" : ".") + "</p></div>";
    }
    box.hidden = !h; box.innerHTML = h;
  }
  $("graciasOk").addEventListener("click", function () { $("gracias").hidden = true; });
  $("gracias").addEventListener("click", function (e) { if (e.target === this) this.hidden = true; });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") $("gracias").hidden = true; });

  /* Hora de entrega (opcional): intervalos de 15 min dentro del horario, desde 30 min después de ahora */
  var H_MARGEN = 30, H_PASO = 15;
  function minCO() {
    var p = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()).split(":");
    return (+p[0] % 24) * 60 + +p[1];
  }
  function hhmm(m) { m = ((m % 1440) + 1440) % 1440; return ("0" + Math.floor(m / 60)).slice(-2) + ":" + ("0" + (m % 60)).slice(-2); }
  function horasEntrega() {
    var h = H && H.abre && H.cierra ? H : SmashExt.getHorario();
    var mm = function (s) { return +s.slice(0, 2) * 60 + +s.slice(3); };
    var a = mm(h.abre), c = mm(h.cierra), ahora = minCO(), dia, desde;
    if (c <= a) c += 1440;                       // horario que pasa de medianoche
    if (EH.abierto) { dia = "Hoy"; desde = (ahora < a ? ahora + 1440 : ahora) + H_MARGEN; }
    else { dia = EH.abreHoy ? "Hoy" : EH.proxTexto ? EH.proxTexto.replace(/^el /, "").replace(/^./, function (x) { return x.toUpperCase(); }) : "Mañana"; desde = a + H_MARGEN; }
    desde = Math.ceil(desde / H_PASO) * H_PASO;
    var out = [];
    for (var m = desde; m <= c; m += H_PASO) out.push({ v: dia + " " + hhmm(m), t: dia + " " + SmashExt.horaTexto(hhmm(m)) });
    return out;
  }
  function pintarHoras() {
    var s = $("fh"); if (!s) return;
    var antes = s.value, l = horasEntrega(), firma = (EH.abierto ? 1 : 0) + JSON.stringify(l);
    if (s.dataset.firma === firma) return;   // sin cambios: no se cierra la lista si el cliente la tiene abierta
    s.dataset.firma = firma;
    s.innerHTML = '<option value="">' + (EH.abierto ? "Lo antes posible" : "Apenas abramos") + "</option>" +
      l.map(function (o) { return '<option value="' + esc(o.v) + '">' + esc(o.t) + "</option>"; }).join("");
    s.value = l.some(function (o) { return o.v === antes; }) ? antes : "";
    if (antes && s.value !== antes) upd();      // la hora elegida ya pasó
  }
  function horaSel() { var s = $("fh"); return s && s.value ? s.options[s.selectedIndex].text : ""; }
  function est() {
    try {
      var antes = EH.abierto;
      EH = SmashExt.estadoHorario(H);
      $("st").classList.toggle("open", EH.abierto);
      $("stt").textContent = EH.abierto ? "Abierto ahora · hasta las " + EH.cierra
        : EH.abreHoy ? "Abrimos hoy a las " + EH.abre
        : EH.cerradoHoy ? "Hoy no abrimos · " + EH.motivoHoy.toLowerCase() + " · volvemos " + reservaTxt()
        : "Cerrado · abrimos " + reservaTxt();
      $("hft").textContent = EH.abre + " a " + EH.cierra;
      if ($("hfd")) $("hfd").textContent = !EH.dias || EH.dias === "Todos los días" ? "Todos los días " : EH.dias + " · ";
      $("resv").hidden = EH.abierto;
      $("resv").innerHTML = EH.abierto ? ""
        : EH.cerradoHoy && !EH.abreHoy ? "🛠️ <b>Hoy no abrimos (" + esc(EH.motivoHoy.toLowerCase()) + ").</b> Tu pedido quedará como <b>reserva</b> y lo despachamos <b>" + esc(reservaTxt()) + "</b>."
        : "🕐 <b>Ahora estamos cerrados.</b> Tu pedido quedará como <b>reserva</b> y lo despachamos al abrir cocina, <b>" + esc(reservaTxt()) + "</b>.";
      $("go").textContent = EH.abierto ? "Enviar pedido" : "Reservar pedido";
      pintarHoras();
      if (antes !== EH.abierto) upd();
    } catch (e) {}
  }

  /* ---------------- Cuenta de cliente leal ---------------- */
  var acc = $("acc");
  function abrirAcc(tab) {
    acc.hidden = false;
    var dentro = !!yo;
    $("accTabs").hidden = dentro; $("vCuenta").hidden = !dentro;
    $("accT").textContent = dentro ? "Mi cuenta SMASH ⭐" : "Clientes SMASH ⭐";
    $("accSub").hidden = dentro; $("accRegalo").hidden = dentro;
    if (!dentro) verTab(tab === "registro" ? "registro" : "entrar");
    else { $("fEntrar").hidden = true; $("fRegistro").hidden = true; pintarMiCuenta(); }
    acc.querySelectorAll(".amsg").forEach(function (m) { m.textContent = ""; m.className = "amsg" + (m.classList.contains("wide") ? " wide" : ""); });
  }
  function cerrarAcc() { acc.hidden = true; }
  function verTab(t) {
    acc.querySelectorAll("[data-tab]").forEach(function (b) { b.classList.toggle("on", b.getAttribute("data-tab") === t); });
    $("fEntrar").hidden = t !== "entrar"; $("fRegistro").hidden = t !== "registro";
    var f = t === "entrar" ? $("fEntrar") : $("fRegistro"), i = f.querySelector("input");
    if (i) setTimeout(function () { i.focus(); }, 50);
  }
  function msg(form, ok, t) { var m = form.querySelector(".amsg"); m.textContent = t; m.classList.toggle("ok", !!ok); }
  function datos(form) { var o = {}; Array.prototype.forEach.call(form.elements, function (e) { if (e.name) o[e.name] = e.type === "checkbox" ? e.checked : e.value; }); return o; }
  function ocupado(form, si, txt) { var b = form.querySelector(".abtn"); if (!b.dataset.t) b.dataset.t = b.textContent; b.disabled = si; b.textContent = si ? txt : b.dataset.t; }

  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest("[data-acc]") : null;
    if (b) { e.preventDefault(); abrirAcc(b.getAttribute("data-acc")); }
  });
  acc.querySelectorAll("[data-tab]").forEach(function (b) { b.addEventListener("click", function () { verTab(b.getAttribute("data-tab")); }); });
  $("accX").addEventListener("click", cerrarAcc);
  acc.addEventListener("click", function (e) { if (e.target === acc) cerrarAcc(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") cerrarAcc(); });

  $("fEntrar").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = this, d = datos(f);
    if (!d.correo || !d.clave) { msg(f, false, "Escribe tu correo y tu contraseña."); return; }
    ocupado(f, true, "Entrando…");
    SmashNube.entrar(d.correo, d.clave).then(function (r) {
      ocupado(f, false);
      if (!r.ok) { msg(f, false, r.error); return; }
      f.reset(); entro(r.perfil, true);
    });
  });
  $("fRegistro").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = this;
    ocupado(f, true, "Creando tu cuenta…");
    SmashNube.registrar(datos(f)).then(function (r) {
      ocupado(f, false);
      if (!r.ok) { msg(f, false, r.error); return; }
      if (r.confirmar) { msg(f, true, "✓ Cuenta creada. Te enviamos un correo: confírmalo e inicia sesión. Tus 15 puntos de regalo ya te estarán esperando 🎁"); if (window.SmashConfeti) window.SmashConfeti(); return; }
      f.reset(); entro(r.perfil, true);
    });
  });
  $("olvide").addEventListener("click", function () {
    var f = $("fEntrar"), c = f.elements.correo.value.trim();
    if (!c) { msg(f, false, "Escribe tu correo arriba y vuelve a pulsar \"Olvidé mi contraseña\"."); return; }
    SmashNube.recuperarClave(c).then(function (r) { msg(f, r.ok, r.ok ? "✓ Te enviamos un correo con el enlace para crear una contraseña nueva." : r.error); });
  });
  $("fDatos").addEventListener("submit", function (e) {
    e.preventDefault();
    var f = this;
    ocupado(f, true, "Guardando…");
    SmashNube.guardarPerfil(datos(f)).then(function (r) {
      ocupado(f, false);
      msg(f, r.ok, r.ok ? "✓ Datos guardados." : r.error);
      if (r.ok) { yo = r.perfil; pintarCuenta(); }
    });
  });
  $("salir").addEventListener("click", function () { SmashNube.salir().then(function () { yo = null; promos = []; cerrarAcc(); pintarCuenta(); render(); upd(); }); });
  $("cAvisoSi").addEventListener("click", function () {
    var b = this; b.disabled = true; b.textContent = "Guardando…";
    SmashNube.guardarPerfil({ acepta_promos: true }).then(function (r) {
      b.disabled = false; b.textContent = "Sí, avisarme";
      if (!r.ok) { alert(r.error); return; }
      yo = r.perfil; $("cAviso").hidden = true; $("fDatos").elements.acepta_promos.checked = true;
      msg($("fDatos"), true, "✓ Listo, te avisaremos las promos por WhatsApp.");
    });
  });
  $("usaDir").addEventListener("click", function () { if (yo) { $("fa").value = yo.direccion; upd(); } });

  function pintarMiCuenta() {
    if (!yo) return;
    $("cNombre").textContent = yo.nombre || yo.usuario;
    $("cCorreo").textContent = (yo.usuario ? "@" + yo.usuario + " · " : "") + yo.correo;
    $("cPuntos").textContent = yo.puntos || 0;
    $("cPromos").innerHTML = promos.length ? promos.map(function (p) {
      return '<div class="apromo"><b>⭐ ' + esc(p.titulo) + (cuestaPts(p) ? ' <span class="ptag pts">' + cuestaPts(p) + " pts</span>" : "") + "</b>" + (p.descripcion ? "<span>" + esc(p.descripcion) + "</span>" : "") + "<small>📅 " + esc(SmashNube.textoDias(p)) + " · hasta el " + esc(p.hasta) + "</small></div>";
    }).join("") : '<p class="anote">Hoy no hay promociones activas. Sigue sumando puntos.</p>';
    pintarHistorial();
    var f = $("fDatos");
    f.elements.nombre.value = yo.nombre || ""; f.elements.telefono.value = yo.telefono || "";
    f.elements.telefono2.value = yo.telefono2 || ""; f.elements.direccion.value = yo.direccion || "";
    f.elements.acepta_promos.checked = !!yo.acepta_promos;
    $("cAviso").hidden = !!yo.acepta_promos || !("acepta_promos" in yo);   // sin el SQL nuevo no se ofrece
  }
  /* Historial de puntos: lo que ya está en la nube + los pedidos enviados que aún no se entregan */
  function fechaCorta(iso) {
    try { return new Date(iso).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" }).replace(/[  ]/g, " "); } catch (e) { return ""; }
  }
  function pintarHistorial() {
    var el = $("cHist"); if (!el || !yo) return;
    el.innerHTML = '<p class="anote">Cargando tu historial…</p>';
    var mios = misPedidos();
    (SmashNube.movimientos ? SmashNube.movimientos(yo.id) : Promise.resolve([])).then(function (movs) {
      movs = movs || [];
      var hechos = {}; movs.forEach(function (m) { if (m.pedido && m.puntos > 0) hechos[m.pedido] = true; });
      var pend = mios.filter(function (x) { return x.puntos > 0 && !hechos[x.ref] && Date.now() - new Date(x.en).getTime() < 3 * 864e5; });
      var filas = pend.map(function (x) {
        return '<li class="hp pend"><span class="hp-n">+' + x.puntos + '</span><div><b>Pedido ' + esc(x.ref) + "</b><small>Pendiente · se suman cuando entreguemos tu pedido · " + esc(fechaCorta(x.en)) + "</small></div></li>";
      }).concat(movs.slice(0, 30).map(function (m) {
        var mas = m.puntos > 0;
        return '<li class="hp ' + (mas ? "mas" : "menos") + '"><span class="hp-n">' + (mas ? "+" : "−") + Math.abs(m.puntos) + "</span><div><b>" + esc(m.motivo || (mas ? "Puntos ganados" : "Canje")) + "</b><small>" + esc(fechaCorta(m.creado)) + "</small></div></li>";
      }));
      el.innerHTML = filas.length ? '<ul class="hist">' + filas.join("") + "</ul>" : '<p class="anote">Aún no tienes movimientos. Tus puntos aparecen aquí cuando entregamos tu primer pedido.</p>';
    }, function () { el.innerHTML = '<p class="anote">No pudimos cargar tu historial. Intenta de nuevo en un momento.</p>'; });
  }
  function pintarCuenta() {
    $("tbAcc").hidden = !!yo || !hayNube;
    $("tbYo").hidden = !yo;
    document.body.classList.toggle("invita-club", hayNube && !yo);   // anuncios del regalo de 15 pts (club-regalo.js)
    document.body.classList.toggle("en-club", !!yo);
    if (yo) $("tbYo").textContent = "⭐ " + String(yo.nombre || yo.usuario || "").split(" ")[0] + " · " + (yo.puntos || 0) + " pts";
    var lb = $("leal");
    lb.hidden = !hayNube || !!yo;          // con sesión se ve la zona del Club SMASH en su lugar
    pintarClub();
    lb.innerHTML = yo
      ? (promos.length ? "⭐ <b>Tus promociones de hoy:</b> " + promos.map(function (p) { return esc(p.titulo); }).join(" · ") + ' <button type="button" class="lnk" data-acc="cuenta">Ver detalles</button>'
        : "⭐ Hola <b>" + esc(String(yo.nombre || "").split(" ")[0]) + "</b>, tienes <b>" + (yo.puntos || 0) + " puntos</b>. Hoy no hay promociones; sigue sumando.")
      : '⭐ <b>¿Quieres descuentos y promociones cada día?</b> Regístrate gratis y <b>te regalamos 15 puntos</b> para la promo del día. <span class="lbtns"><button type="button" class="lnk" data-acc="registro">Registrarme</button><button type="button" class="lnk" data-acc="entrar">Ya tengo cuenta</button></span>';
    $("usaDir").hidden = !(yo && yo.direccion);
    $("usaDir").textContent = yo ? "📍 Usar mi dirección guardada: " + yo.direccion : "";
    try { document.dispatchEvent(new CustomEvent("smash:yo", { detail: { yo: yo } })); } catch (x) { /* navegador viejo */ }
  }
  // Al iniciar sesión: datos que casi nunca cambian (nombre y teléfono) se llenan solos
  function entro(p, cerrar) {
    yo = p;
    if (!yo) { pintarCuenta(); return; }
    if (!val("fn")) $("fn").value = yo.nombre || "";
    if (!val("fp")) $("fp").value = yo.telefono || "";
    if (!val("fp2") && yo.telefono2) $("fp2").value = yo.telefono2;
    SmashNube.promociones().then(function (l) {
      promos = l.filter(SmashNube.vigente); diaPromos = SmashNube.hoyCO();
      pintarCuenta(); render(); upd();
      if (cerrar) cerrarAcc();
    });
  }
  // Si la página queda abierta al cambiar el día, carga las promociones del nuevo día
  var diaPromos = "";
  if (hayNube) setInterval(function () { if (yo && diaPromos && SmashNube.hoyCO() !== diaPromos) entro(yo, false); }, 60000);
  if (hayNube) {
    SmashNube.alCambiar(function (p) { if (!p && yo) { yo = null; promos = []; pintarCuenta(); render(); upd(); } });
    SmashNube.enRecuperacion(function () {
      var c = prompt("Escribe tu contraseña nueva (mínimo 8 caracteres):");
      if (c) SmashNube.nuevaClave(c).then(function (r) { alert(r.ok ? "✓ Contraseña cambiada." : r.error); });
    });
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
    cupoMenu = cupo;
    render(); est(); setInterval(est, 60000); upd();
    // Horario y días cerrados en línea (lo guarda el dueño en el panel); manda sobre el de menu.json
    if (hayNube && SmashNube.leerHorario) {
      var horNube = function () { SmashNube.leerHorario().then(function (v) { if (v && v.abre && v.cierra) { H = v; est(); if (SEM.cargada) pintarSemana(); } }, function () {}); };
      horNube(); setInterval(horNube, 300000);
      document.addEventListener("visibilitychange", function () { if (document.visibilityState !== "hidden") horNube(); });
    }
    cargarSemana(); setInterval(cargarSemana, 600000);
    seguirCupoNube();
    pintarCuenta();
    if (hayNube) SmashNube.perfil().then(function (p) { if (p) entro(p, false); }, function () {});
  });
})();
