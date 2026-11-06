/* ============================================================
   SMASH · data-ext.js
   Extensión de data.js (que queda SIN modificar). Agrega:
   - tarifas de domicilio por zona
   - pedidos con zona, medio de pago, referencia y # de pedido del día
   - evita duplicar un pedido (por referencia)
   Usa las mismas llaves de SmashLS que data.js.
   ============================================================ */
const SmashExt = (function () {
  const ZK = 'smash_zones';
  const DEF = {
    norte:   { nombre: 'Norte', fee: 8000 },
    norte19: { nombre: 'Norte, Después de la Calle 19', fee: 9000 },
    centro:  { nombre: 'Centro', fee: 7000 },
    sur:     { nombre: 'Sur', fee: 7000 },
    otros:   { nombre: 'Otros (fuera de la ciudad y pueblos)', fee: 0, variable: true },
  };
  const rd = (k, f) => { try { const r = SmashLS.getItem(k); return r ? JSON.parse(r) : f; } catch (e) { return f; } };
  const wr = (k, v) => SmashLS.setItem(k, JSON.stringify(v));

  /* Zonas configurables por los dueños (smash_zonas_cfg). La primera vez se arma con las zonas
     de siempre y las tarifas que ya estaban guardadas en smash_zones. "Otros" es de valor variable. */
  const ZCFG = 'smash_zonas_cfg';
  function getZonasCfg() {
    const cfg = rd(ZCFG, null);
    if (Array.isArray(cfg) && cfg.length) return cfg;
    const saved = rd(ZK, {});
    return Object.keys(DEF).map((k) => ({ k, nombre: DEF[k].nombre, fee: DEF[k].variable ? 0 : saved[k] != null ? Number(saved[k]) : DEF[k].fee, variable: !!DEF[k].variable, activa: true }));
  }
  function saveZonasCfg(list) {
    const usadas = {};
    const clean = list.map((z) => {
      const nombre = String(z.nombre || '').trim().slice(0, 60);
      if (!nombre) throw new Error('Cada zona necesita un nombre.');
      let k = z.k || nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'zona';
      while (usadas[k]) k += '1';
      usadas[k] = true;
      return { k, nombre, fee: z.variable ? 0 : Math.max(0, Math.round(Number(z.fee) || 0)), variable: !!z.variable, activa: z.activa !== false };
    });
    if (!clean.some((z) => z.activa)) throw new Error('Debe quedar al menos una zona activa.');
    wr(ZCFG, clean);
    return clean;
  }
  function getZones() {
    const out = {};
    getZonasCfg().forEach((z) => { if (z.activa !== false) out[z.k] = z.variable ? { nombre: z.nombre, fee: 0, variable: true } : { nombre: z.nombre, fee: Number(z.fee) || 0 }; });
    return out;
  }
  function setZoneFees(fees) {
    saveZonasCfg(getZonasCfg().map((z) => (fees[z.k] != null && !z.variable ? Object.assign({}, z, { fee: fees[z.k] }) : z)));
  }
  function localDay(iso) {
    const d = new Date(iso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }
  /* ---- Día de servicio de un pedido ----
     Normalmente es el día en que se creó. Una reserva hecha DESPUÉS del cierre
     (ej. a las 22:30) es para despachar al día siguiente: pertenece a ese día,
     lleva su numeración y su cronómetro arranca a la hora de apertura. */
  const minHora = (s) => { const p = String(s || '').split(':'); return (+p[0] || 0) * 60 + (+p[1] || 0); };
  const sumarDia = (dia, n) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d.toISOString()); };
  function diaServicio(o) {
    if (!o || !o.creado) return '';
    if (o.diaServicio) return o.diaServicio;
    const dia = localDay(o.creado);
    if (!o.reserva) return dia;
    const h = getHorario();
    if (minHora(h.cierra) <= minHora(h.abre)) return dia;          // cierra después de medianoche
    const c = new Date(o.creado);
    return c.getHours() * 60 + c.getMinutes() >= minHora(h.cierra) ? sumarDia(dia, 1) : dia;
  }
  // Desde cuándo corre el cronómetro: una reserva cuenta desde que abre la cocina
  function inicioPedido(o) {
    if (!o || !o.creado || !o.reserva) return o ? o.creado : '';
    const dia = diaServicio(o), a = minHora(getHorario().abre);
    const abre = new Date(dia + 'T00:00:00');
    abre.setHours(Math.floor(a / 60), a % 60, 0, 0);
    return abre.getTime() > new Date(o.creado).getTime() ? abre.toISOString() : o.creado;
  }
  function nextDayNumber(orders, dia) {
    dia = dia || localDay(new Date().toISOString());
    const del = orders.filter((o) => diaServicio(o) === dia);
    const max = del.reduce((m, o) => Math.max(m, Number(o.numeroDia) || 0), 0);
    return Math.max(del.length, max) + 1;
  }
  /* El mismo pedido web guardado dos veces (mismo N° de la página, "ref").
     Pasaba cuando el pedido llegaba al mismo tiempo a cocina y a dueños.
     Se queda el que va más avanzado (o el primero que llegó). La copia sobrante se
     borra sola SOLO si no tiene pago, ni insumos descontados, ni está entregada;
     si no, se deja y la lista la marca como "repetido" para cancelarla a mano. */
  const RANGO = { nuevo: 1, confirmado: 2, preparando: 3, listo: 4, en_camino: 5, entregado: 6, cancelado: 0 };
  function pedidosRepetidos(orders) {
    const g = {};
    (orders || rd(SmashDB.KEYS.ORDERS, [])).forEach((o) => { if (o && o.ref && o.origen !== 'local') (g[o.ref] = g[o.ref] || []).push(o); });
    return Object.keys(g).filter((k) => g[k].length > 1).map((k) => g[k]);
  }
  function arreglarRepetidosPorRef() {
    const K = SmashDB.KEYS;
    const orders = rd(K.ORDERS, []);
    const grupos = pedidosRepetidos(orders);
    if (!grupos.length) return 0;
    const pagos = rd('smash_pagos', []), movs = rd('smash_inv_movs', []);
    const llave = (o) => o.id + '|' + o.creado;
    const tienePago = (o) => pagos.some((p) => p.pedidoKey === llave(o) && !p.anulado);
    const tieneInv = (o) => movs.some((m) => m.pedidoKey === llave(o) && m.tipo === 'venta');
    const peso = (o) => (RANGO[o.status] || 0) * 10 + (tienePago(o) ? 5 : 0) + (tieneInv(o) ? 3 : 0) + (o.impresa ? 1 : 0);
    const quitar = new Set();
    grupos.forEach((g) => {
      g.sort((a, b) => peso(b) - peso(a) || new Date(a.creado) - new Date(b.creado) || a.id - b.id);
      g.slice(1).forEach((o) => {
        if (o.status !== 'entregado' && (RANGO[o.status] || 0) <= 2 && !tienePago(o) && !tieneInv(o)) quitar.add(o);
      });
    });
    if (!quitar.size) return 0;
    wr(K.ORDERS, orders.filter((o) => !quitar.has(o)));
    return quitar.size;
  }

  /* Corrige números de pedido mal puestos en el día de hoy:
     - reservas de anoche que conservaban el número de ayer (ej. #29)
     - números fuera de serie que dejó la sincronización entre dos equipos
     No toca otros días. Devuelve cuántos pedidos se corrigieron. */
  /* Dos pedidos distintos con el mismo número interno (id): al tocar uno se abría el otro.
     Pasaba cuando dos equipos creaban pedidos a la vez con su propio contador.
     - Copias idénticas del mismo pedido (mismo id y misma hora de creación): queda una.
     - Pedidos distintos con el mismo id: el más antiguo conserva el id; los demás reciben
       uno nuevo, y sus pagos, inventario y costos se mueven con él. */
  /* IMPORTANTE: todo lo que se repara aquí corre en TODOS los equipos a la vez, así que
     cada decisión debe salir igual en todos (no puede depender de qué otros pedidos tenga
     cada equipo). Si no, cada equipo le pone un número distinto al mismo pedido, la
     sincronización los toma como dos pedidos y se multiplican. */
  // "Huella" de un pedido: no cambia aunque cambie su número interno ni su estado
  const huellaPed = (o) => [o.creado || '', o.ref || '', o.cliente || '', o.telefono || ''].join('|');
  // Número interno fijo sacado de la huella: el mismo pedido recibe el mismo número en todos los equipos.
  // Es negativo para no chocar con la numeración normal (1, 2, 3…).
  function idFijo(o) {
    const s = huellaPed(o);
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return -(1000000 + (h % 900000000));
  }
  const llaveDe = (o) => o.id + '|' + o.creado;
  // Cambia la llave de un pedido en pagos, inventario, costos y puntos
  function moverLlave(viejo, nuevo, idNuevo) {
    for (let i = 0; i < SmashLS.length; i++) {
      const key = SmashLS.key(i);
      if (!key || !/^smash_/.test(key) || key === SmashDB.KEYS.ORDERS) continue;
      const txt = SmashLS.getItem(key);
      if (!txt || txt.indexOf(viejo) < 0) continue;
      let val;
      try { val = JSON.parse(txt.split(JSON.stringify(viejo)).join(JSON.stringify(nuevo))); } catch (e) { continue; }
      if (key === 'smash_pagos' && Array.isArray(val)) val.forEach((p) => { if (p.pedidoKey === nuevo) p.pedidoId = idNuevo; });
      wr(key, val);
    }
  }
  /* Copias del MISMO pedido (misma huella) con distinto número interno: queda una sola,
     la más avanzada. Si la copia que sobra tenía pago o insumos descontados y la que queda
     también, el pago repetido se anula y los insumos repetidos se reintegran. */
  function unirCopias(orders) {
    const g = {};
    orders.forEach((o) => { if (o && o.creado) (g[huellaPed(o)] = g[huellaPed(o)] || []).push(o); });
    const grupos = Object.keys(g).map((k) => g[k]).filter((x) => x.length > 1);
    if (!grupos.length) return null;
    const pagos = rd('smash_pagos', []), movs = rd('smash_inv_movs', []), ings = rd('smash_ingredientes', []);
    const tienePago = (o) => pagos.some((p) => p.pedidoKey === llaveDe(o) && !p.anulado);
    const tieneInv = (o) => movs.some((m) => m.pedidoKey === llaveDe(o) && m.tipo === 'venta');
    const peso = (o) => (RANGO[o.status] || 0) * 10 + (tienePago(o) ? 5 : 0) + (tieneInv(o) ? 3 : 0) + (o.impresa ? 1 : 0);
    const quitar = new Set(), mover = [];
    let cambioPagos = false, cambioInv = false;
    grupos.forEach((gr) => {
      gr.sort((a, b) => peso(b) - peso(a) || String(a.id).localeCompare(String(b.id)));
      const queda = gr[0], kq = llaveDe(queda);
      gr.slice(1).forEach((o) => {
        quitar.add(o);
        const ko = llaveDe(o);
        if (ko === kq) return;
        if (tienePago(o)) {
          if (tienePago(queda)) { pagos.forEach((p) => { if (p.pedidoKey === ko && !p.anulado) { p.anulado = true; p.anuladoMotivo = 'Copia repetida del pedido'; p.anuladoEn = new Date().toISOString(); cambioPagos = true; } }); }
          else { pagos.forEach((p) => { if (p.pedidoKey === ko) { p.pedidoKey = kq; p.pedidoId = queda.id; cambioPagos = true; } }); }
        }
        if (tieneInv(o)) {
          if (tieneInv(queda)) {
            movs.filter((m) => m.pedidoKey === ko && m.tipo === 'venta' && m.ingId && m.cant).forEach((m) => {
              const i = ings.find((x) => x.id === m.ingId);
              if (i) i.stock = Math.round(((Number(i.stock) || 0) - m.cant) * 1000) / 1000;
              movs.push({ id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ingId: m.ingId, ingNombre: m.ingNombre, tipo: 'reintegro', cant: -m.cant, costo: m.costo, valor: m.valor,
                fecha: localDay(new Date().toISOString()), pedidoKey: ko, pedidoNum: m.pedidoNum, motivo: 'Copia repetida del pedido #' + m.pedidoNum, por: 'sistema', creado: new Date().toISOString() });
              cambioInv = true;
            });
          } else mover.push([ko, kq, queda.id]);
        }
      });
    });
    if (cambioPagos) wr('smash_pagos', pagos);
    if (cambioInv) { wr('smash_ingredientes', ings); wr('smash_inv_movs', movs); }
    mover.forEach((x) => moverLlave(x[0], x[1], x[2]));
    return orders.filter((o) => !quitar.has(o));
  }
  function arreglarIdsRepetidos() {
    const K = SmashDB.KEYS;
    let orders = rd(K.ORDERS, []);
    let cambio = false;
    const unidos = unirCopias(orders);
    if (unidos) { orders = unidos; cambio = true; }
    // Pedidos DISTINTOS con el mismo número interno: el más antiguo lo conserva y los demás
    // reciben su número fijo (igual en todos los equipos)
    const grupos = {};
    orders.forEach((o) => { if (o && o.id != null) (grupos[o.id] = grupos[o.id] || []).push(o); });
    const usados = new Set(orders.map((o) => o.id));
    const mover = [];
    Object.keys(grupos).forEach((id) => {
      const g = grupos[id];
      if (g.length < 2) return;
      g.sort((a, b) => new Date(a.creado) - new Date(b.creado) || huellaPed(a).localeCompare(huellaPed(b)));
      g.slice(1).forEach((o) => {
        const viejo = llaveDe(o);
        let n = idFijo(o);
        while (usados.has(n)) n--;
        usados.add(n);
        o.id = n;
        mover.push([viejo, llaveDe(o), o.id]);
      });
    });
    if (!cambio && !mover.length) return 0;
    wr(K.ORDERS, orders);
    mover.forEach((x) => moverLlave(x[0], x[1], x[2]));
    return mover.length + (cambio ? 1 : 0);
  }
  function arreglarNumerosHoy() {
    try { arreglarIdsRepetidos(); } catch (e) { /* sigue */ }
    try { arreglarRepetidosPorRef(); } catch (e) { /* sigue con los números */ }
    const K = SmashDB.KEYS;
    const orders = rd(K.ORDERS, []);
    const hoyD = localDay(new Date().toISOString());
    const del = orders.filter((o) => diaServicio(o) === hoyD)
      .sort((a, b) => new Date(a.creado) - new Date(b.creado) || huellaPed(a).localeCompare(huellaPed(b)));
    if (!del.length) return 0;
    const vistos = new Set();
    const malos = del.filter((o) => {
      if (o.reserva && localDay(o.creado) !== hoyD && !o.diaServicio) return true;      // reserva de anoche con número de ayer
      const n = Number(o.numeroDia);
      if (!(n >= 1) || n > del.length + 2) return true;                                  // número fuera de serie
      if (vistos.has(n)) return true;                                                    // dos pedidos de hoy con el mismo #: el más nuevo cambia
      vistos.add(n);
      return false;
    });
    if (!malos.length) return 0;
    const usados = new Set(del.filter((o) => malos.indexOf(o) < 0).map((o) => Number(o.numeroDia)));
    let n = 1;
    malos.forEach((o) => {
      while (usados.has(n)) n++;
      o.numeroDia = n; usados.add(n);
      if (localDay(o.creado) !== hoyD) o.diaServicio = hoyD;
    });
    wr(K.ORDERS, orders);
    return malos.length;
  }
  function addOrder(d) {
    const K = SmashDB.KEYS;
    const orders = rd(K.ORDERS, []);
    if (d.ref) {
      const dup = orders.find((o) => o.ref === d.ref);
      if (dup) return { ok: false, dup: true, order: dup };
    }
    // nunca repite un número interno ya usado (otro equipo pudo crear pedidos con su propio contador)
    const seq = Math.max(rd(K.ORDER_SEQ, 0) || 0, orders.reduce((m, o) => (typeof o.id === "number" && o.id > m ? o.id : m), 0)) + 1;
    wr(K.ORDER_SEQ, seq);
    const subtotal = d.items.reduce((s, it) => s + it.price * it.qty, 0);
    const domicilio = Number(d.domicilio) || 0;
    // descuento de cliente leal (promociones de la nube); nunca más que el subtotal
    const descuento = Math.min(subtotal, Math.max(0, Math.round(Number(d.descuento) || 0)));
    const order = {
      id: seq,
      numeroDia: 0,
      clienteUsuario: '',
      cliente: d.cliente,
      telefono: d.telefono || '',
      direccion: d.direccion || '',
      zona: d.zona || '',
      pago: d.pago || '',
      ref: d.ref || '',
      origen: d.origen || 'web',
      items: d.items.map((it) => {
        const p = SmashDB.getProductById(it.id);
        const line = { id: it.id, name: it.name, price: it.price, qty: it.qty, cat: it.cat || (p ? p.categoria : '') };
        if (it.nota) line.nota = String(it.nota).slice(0, 200);
        return line;
      }),
      notas: d.notas || '',
      reserva: !!d.reserva,
      domicilioPendiente: !!d.domicilioPendiente,
      impresa: false,
      subtotal,
      domicilio,
      total: subtotal - descuento + domicilio,
      status: 'nuevo',
      creado: new Date().toISOString(),
    };
    if (d.telefono2) order.telefono2 = String(d.telefono2).slice(0, 20);
    if (d.horaEntrega) order.horaEntrega = String(d.horaEntrega).slice(0, 40);
    if (descuento) { order.descuento = descuento; order.descuentos = (d.descuentos || []).map((x) => ({ motivo: 'Promo cliente leal: ' + String(x.titulo || x.motivo || '').slice(0, 80), valor: Math.round(Number(x.valor) || 0) })); }
    if (d.cuenta && d.cuenta.correo) order.cuenta = { usuario: String(d.cuenta.usuario || '').slice(0, 30), correo: String(d.cuenta.correo).toLowerCase().slice(0, 120) };
    if (Array.isArray(d.canjes) && d.canjes.length) order.canjes = d.canjes.slice(0, 10).map((x) => ({ promo: x.promo || 0, titulo: String(x.titulo || "").slice(0, 80), puntos: Math.max(0, Math.round(Number(x.puntos) || 0)), valor: Math.max(0, Math.round(Number(x.valor) || 0)) }));
    if (d.canjeRechazado) order.canjeRechazado = String(d.canjeRechazado).slice(0, 160);
    { const dia = diaServicio(order); if (dia !== localDay(order.creado)) order.diaServicio = dia; order.numeroDia = nextDayNumber(orders, dia); }
    orders.push(order);
    wr(K.ORDERS, orders);
    return { ok: true, order };
  }

  /* ---- Productos de un mensaje de WhatsApp ("- 2 x Nombre ($00.000)") ----
     Un combo llega como "- 1 x Combo (papas + gaseosa) para Smash Toci ($6.900)": se reconoce
     el combo y la hamburguesa queda como nota de la línea. */
  function leerItems(texto) {
    const products = SmashDB.getProducts(), mny = (s) => parseInt(String(s).replace(/\D/g, ''), 10) || 0;
    const porNombre = (n) => products.find((p) => p.name.toLowerCase() === n.toLowerCase());
    const out = [];
    String(texto).split(/\r?\n/).forEach((l) => {
      const m = l.match(/^\s*-\s*(\d+)\s*x\s*(.+?)\s*\(\$?\s*([\d.,]+)\)\s*$/i);
      if (!m) return;
      const q = +m[1], n = m[2], total = mny(m[3]);
      let pr = porNombre(n), nota = '';
      if (!pr) {
        const c = n.match(/^(.+?)\s+para\s+(.+)$/i), base = c && porNombre(c[1]);
        if (base && base.categoria === 'combo') { pr = base; nota = 'Para ' + c[2]; }
      }
      if (!pr) {
        // adicional con sabor: "- 2 x Gaseosa Postobón (Uva) ($6.000)"
        const s = n.match(/^(.+?)\s*\(([^()]+)\)$/), base = s && porNombre(s[1]);
        if (base) { pr = base; nota = 'Sabor: ' + s[2].trim(); }
      }
      const it = pr ? { id: pr.id, name: pr.name, price: pr.price, qty: q }
        : { id: 'x-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: n, price: Math.round(total / q), qty: q };
      if (nota) it.nota = nota;
      out.push(it);
    });
    return out;
  }

  /* ---- Datos de cliente leal en un mensaje de WhatsApp ----
     "*Cuenta SMASH:* juan (juan@correo.com)", "*Tel. referencia:* 300…",
     "*Descuento cliente leal:* -$4.380 (Promo A; Promo B)". Caja verifica la cuenta y el descuento antes de sumar puntos. */
  function leerLeal(t) {
    const linea = (l) => { const m = String(t).match(new RegExp('\\*?' + l + ':\\*?[ \\t]*(.*)', 'i')); return m ? m[1].replace(/\*/g, '').trim() : ''; };
    const out = {}, c = linea('Cuenta SMASH').match(/^(\S*)\s*\(([^()\s]+@[^()\s]+)\)/), tel2 = linea('Tel\\. referencia'), ds = linea('Descuento cliente leal');
    if (c) out.cuenta = { usuario: c[1], correo: c[2] };
    if (tel2) out.telefono2 = tel2;
    if (ds) {
      const v = parseInt(ds.replace(/\(.*$/, '').replace(/\D/g, ''), 10) || 0, p = ds.match(/\((.*)\)/);
      if (v) { out.descuento = v; out.descuentos = [{ titulo: p ? p[1] : 'Promoción', valor: v }]; }
    }
    return out;
  }

  /* ---- Catálogo v2: ingredientes reales y nombre nuevo (se aplica una sola vez) ---- */
  const ING = {
    smash: 'Pan brioche, queso cheddar, salsa smash, cebolla caramelizada, 2 carnes smash de 100 g, pepinillos y salsa de la casa.',
    toci: 'Pan brioche, queso cheddar, salsa smash, 2 tocinetas, cebolla caramelizada, 2 carnes smash de 100 g, pepinillos y salsa de la casa.',
    american: 'Pan brioche, queso cheddar, salsa smash, cebolla caramelizada, lechuga y tomate, 2 carnes smash de 100 g, pepinillos y salsa de la casa.',
  };
  (function migrateCatalog() {
    if ((rd('smash_catalog_v', 0) || 0) >= 2) return;
    const list = rd(SmashDB.KEYS.PRODUCTS, null);
    if (!list) return;
    list.forEach((p) => { if (ING[p.id]) p.desc = ING[p.id]; if (p.id === 'american') p.name = 'American Toci'; });
    wr(SmashDB.KEYS.PRODUCTS, list);
    wr('smash_catalog_v', 2);
  })();

  /* ---- Sabores / tipos de un adicional (ej. gaseosas): el cliente elige uno por unidad ---- */
  // "Uva, Manzana,uva" → ['Uva', 'Manzana'] (sin vacíos ni repetidos)
  function leerSabores(v) {
    const vistos = {}, out = [];
    (Array.isArray(v) ? v : String(v || '').split(/[,\n]/)).forEach((s) => {
      s = String(s).trim().replace(/\s+/g, ' ').slice(0, 40);
      if (s && !vistos[s.toLowerCase()] && out.length < 30) { vistos[s.toLowerCase()] = 1; out.push(s); }
    });
    return out;
  }
  // Catálogo v3: las dos gaseosas como adicional. Quedan ocultas y sin precio hasta que el dueño ponga el precio.
  (function migrateGaseosas() {
    if ((rd('smash_catalog_v', 0) || 0) >= 3) return;
    const list = rd(SmashDB.KEYS.PRODUCTS, null);
    if (!list) return;
    [{ id: 'gaseosaPostobon', name: 'Gaseosa Postobón', sabores: ['Uva', 'Manzana', 'Colombiana', 'Naranja', 'Pepsi'] },
      { id: 'cocaColaZero', name: 'Coca-Cola Zero', sabores: [] }].forEach((g) => {
      if (!list.some((p) => p.id === g.id)) list.push({ id: g.id, name: g.name, desc: '', price: 0, cost: 0, img: '', categoria: 'adicional', activo: false, sabores: g.sabores });
    });
    wr(SmashDB.KEYS.PRODUCTS, list);
    wr('smash_catalog_v', 3);
  })();

  /* ---- Cupo diario de hamburguesas ---- */
  const CK = 'smash_cupo';
  const hoy = () => localDay(new Date().toISOString());
  const getCupoRaw = () => rd(CK, null);
  function setCupo(total) { wr(CK, { dia: hoy(), total: Math.max(0, parseInt(total, 10) || 0) }); }
  function vendidasHoy() {
    const d = hoy();
    let n = 0;
    rd(SmashDB.KEYS.ORDERS, []).forEach((o) => {
      if (localDay(o.creado) !== d || o.status === 'cancelado') return;
      (o.items || []).forEach((it) => { const p = SmashDB.getProductById(it.id); if (p && p.categoria === 'hamburguesa') n += it.qty; });
    });
    return n;
  }
  function cupoHoy() {
    const c = getCupoRaw();
    if (!c || c.dia !== hoy()) return null;
    return { total: c.total, vendidas: vendidasHoy() };
  }

  /* ---- Horario de atención (lo cambian los dueños) ----
     Hora de Colombia. Si cierra antes de abrir (ej. 18:00 a 02:00) se entiende que cierra al día siguiente.
     Fuera del horario los pedidos de la página quedan como reserva. */
  const HK = 'smash_horario', HDEF = { abre: '17:30', cierra: '22:00' };
  const esHora = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s));
  function getHorario() { const h = rd(HK, null); return h && esHora(h.abre) && esHora(h.cierra) ? { abre: h.abre, cierra: h.cierra } : Object.assign({}, HDEF); }
  function setHorario(abre, cierra) {
    if (!esHora(abre) || !esHora(cierra)) return { ok: false, error: 'Escribe la hora de apertura y la de cierre.' };
    if (abre === cierra) return { ok: false, error: 'La hora de apertura y la de cierre no pueden ser iguales.' };
    wr(HK, { abre, cierra }); return { ok: true };
  }
  function horaTexto(hhmm) {
    const p = String(hhmm).split(':'), h = +p[0], m = p[1];
    return (h % 12 || 12) + ':' + m + (h < 12 ? ' am' : ' pm');
  }
  function estadoHorario(h, fecha) {
    h = h && esHora(h.abre) && esHora(h.cierra) ? h : HDEF;
    const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha || new Date()).split(':');
    const ahora = (+p[0] % 24) * 60 + +p[1], min = (s) => +s.slice(0, 2) * 60 + +s.slice(3);
    const a = min(h.abre), c = min(h.cierra);
    const abierto = a < c ? ahora >= a && ahora < c : ahora >= a || ahora < c;
    // fuera de horario: abre hoy si aún no llega la hora de apertura; si no, mañana
    return { abierto, abreHoy: !abierto && ahora < a, abre: horaTexto(h.abre), cierra: horaTexto(h.cierra) };
  }

  /* ---- Menú publicable para clientes (menu.json) ---- */
  function buildMenu() {
    const c = cupoHoy();
    return {
      version: 1,
      generado: new Date().toISOString(),
      dia: hoy(),
      productos: SmashDB.getProducts({ soloActivos: true }).map((p) => ({ id: p.id, name: p.name, desc: p.desc || '', price: p.price, img: p.img || '', categoria: p.categoria, sabores: p.sabores || [] })),
      zonas: getZones(),
      cupo: c,
      horario: getHorario(),
    };
  }
  async function loadMenu() {
    try {
      const r = await fetch('menu.json?' + Date.now(), { cache: 'no-store' });
      if (!r.ok) return null;
      const m = await r.json();
      return m && Array.isArray(m.productos) && m.productos.length ? m : null;
    } catch (e) { return null; }
  }

  /* ---- Estados con hora (para cronómetro y tiempos de entrega) ---- */
  function setStatus(id, status) {
    const K = SmashDB.KEYS, orders = rd(K.ORDERS, []);
    const o = orders.find((x) => x.id === id);
    if (!o) return false;
    o.status = status;
    const ahora = new Date().toISOString();
    if (status === 'confirmado' && !o.confirmadoEn) o.confirmadoEn = ahora;
    if (status === 'preparando' && !o.preparandoEn) o.preparandoEn = ahora;
    if (status === 'listo' && !o.listoEn) o.listoEn = ahora;
    if (status === 'en_camino' && !o.salioEn) o.salioEn = ahora;
    if (status === 'entregado' && !o.entregadoEn) o.entregadoEn = ahora;
    wr(K.ORDERS, orders);
    return true;
  }
  // Edita un pedido; recalcula subtotal y total si cambian los productos o el domicilio
  function updateOrder(id, patch) {
    const K = SmashDB.KEYS, orders = rd(K.ORDERS, []);
    const o = orders.find((x) => x.id === id);
    if (!o) return null;
    Object.assign(o, patch);
    if (patch.items) o.subtotal = o.items.reduce((s, it) => s + it.price * it.qty, 0);
    if (patch.domicilio != null) { o.domicilio = Number(patch.domicilio) || 0; o.domicilioPendiente = false; }
    if (patch.items || patch.domicilio != null) o.total = o.subtotal - (Number(o.descuento) || 0) + (Number(o.domicilio) || 0);
    wr(K.ORDERS, orders);
    return o;
  }
  const REP = 'smash_repartidores';
  const getRepartidores = () => rd(REP, []);
  function rememberRepartidor(n) {
    n = String(n || '').trim();
    if (!n) return;
    const l = getRepartidores().filter((x) => x.toLowerCase() !== n.toLowerCase());
    l.unshift(n);
    wr(REP, l.slice(0, 30));
  }

  /* ---- Sonido de aviso (se activa con el primer clic en la página) ---- */
  let actx = null;
  const soundOn = () => rd('smash_sound_on', true) !== false;
  const setSound = (v) => wr('smash_sound_on', !!v);
  function audioCtx() {
    try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    return actx;
  }
  function unlockAudio() {
    const a = audioCtx();
    if (a && a.state === 'suspended') a.resume();
    return !!a && a.state === 'running';
  }
  const audioReady = () => !!actx && actx.state === 'running';
  function chime(force) {
    if (!force && !soundOn()) return;
    const a = audioCtx();
    if (!a) return;
    if (a.state === 'suspended') a.resume();
    const notes = [880, 1175, 1568], t0 = a.currentTime + 0.02;
    for (let rep = 0; rep < 3; rep++) {
      notes.forEach((f, i) => {
        const o = a.createOscillator(), g = a.createGain(), t = t0 + rep * 0.9 + i * 0.22;
        o.type = 'triangle'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.35, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        o.connect(g); g.connect(a.destination); o.start(t); o.stop(t + 0.22);
      });
    }
  }

  /* ---- Registro de hamburguesas vendidas (diario/semanal/mensual/anual) ---- */
  const LED = 'smash_ledger_burgers';
  function refreshLedger() {
    const led = {};
    rd(SmashDB.KEYS.ORDERS, []).forEach((o) => {
      if (o.status === 'cancelado') return;
      const day = localDay(o.creado);
      (o.items || []).forEach((it) => {
        const p = SmashDB.getProductById(it.id);
        const cat = it.cat || (p ? p.categoria : '');
        if (cat !== 'hamburguesa') return;
        led[day] = led[day] || {};
        const r = led[day][it.id] = led[day][it.id] || { n: it.name, q: 0 };
        r.n = it.name; r.q += it.qty;
      });
    });
    wr(LED, led);
    return led;
  }
  const getLedger = () => rd(LED, null) || refreshLedger();

  /* ---- Pedidos eliminados (con registro de quién y cuándo) ---- */
  const DEL = 'smash_deleted_orders';
  function deleteOrder(id, quien) {
    const K = SmashDB.KEYS;
    const orders = rd(K.ORDERS, []);
    const i = orders.findIndex((o) => o.id === id);
    if (i < 0) return false;
    const removed = orders.splice(i, 1)[0];
    wr(K.ORDERS, orders);
    const log = rd(DEL, []);
    log.push({ orden: removed, por: quien || '', cuando: new Date().toISOString() });
    wr(DEL, log.slice(-300));
    return true;
  }
  const getDeletedOrders = () => rd(DEL, []);

  /* ---- Personal del negocio ---- */
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const PERS = 'smash_personal';
  const getPersonal = () => rd(PERS, []);
  function addPersonal(p) {
    const list = getPersonal();
    const x = {
      id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      nombre: String(p.nombre || '').trim().slice(0, 80),
      cargo: String(p.cargo || '').trim().slice(0, 60),
      telefono: String(p.telefono || '').trim().slice(0, 20),
      pago: Math.max(0, Math.round(Number(p.pago) || 0)),
      dias: (Array.isArray(p.dias) ? p.dias : []).filter((d) => DIAS.indexOf(d) > -1),
      registro: new Date().toISOString(),
    };
    list.push(x);
    wr(PERS, list);
    return x;
  }
  function deletePersonal(id) { wr(PERS, getPersonal().filter((p) => p.id !== id)); }
  function antiguedad(iso) {
    const a = new Date(iso), b = new Date();
    let y = b.getFullYear() - a.getFullYear(), m = b.getMonth() - a.getMonth(), d = b.getDate() - a.getDate();
    if (d < 0) { m--; d += new Date(b.getFullYear(), b.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    const parts = [];
    if (y > 0) parts.push(y + (y === 1 ? ' año' : ' años'));
    if (m > 0) parts.push(m + (m === 1 ? ' mes' : ' meses'));
    parts.push(d + (d === 1 ? ' día' : ' días'));
    return parts.join(', ');
  }

  /* ---- Acceso de dueños ----
     La contraseña NO está escrita en el código: solo su huella (SHA-256 repetida 20.000 veces con sal).
     Aun así, en una página sin servidor esto es una barrera de uso, no seguridad real. */
  const SHA = (function () {
    const K = [], H0 = [];
    for (let c = 2; K.length < 64; c++) {
      let prime = true;
      for (let i = 2; i * i <= c; i++) if (c % i === 0) { prime = false; break; }
      if (!prime) continue;
      if (H0.length < 8) H0.push(Math.floor((Math.pow(c, 1 / 2) % 1) * 4294967296));
      K.push(Math.floor((Math.pow(c, 1 / 3) % 1) * 4294967296));
    }
    const rotr = (x, n) => (x >>> n) | (x << (32 - n));
    return function (str) {
      const m = Array.from(new TextEncoder().encode(str)), bits = m.length * 8;
      m.push(0x80);
      while (m.length % 64 !== 56) m.push(0);
      const hi = Math.floor(bits / 4294967296), lo = bits >>> 0;
      for (let i = 3; i >= 0; i--) m.push((hi >>> (i * 8)) & 255);
      for (let i = 3; i >= 0; i--) m.push((lo >>> (i * 8)) & 255);
      const H = H0.slice(), w = new Array(64);
      for (let off = 0; off < m.length; off += 64) {
        for (let i = 0; i < 16; i++) w[i] = (m[off + 4 * i] << 24) | (m[off + 4 * i + 1] << 16) | (m[off + 4 * i + 2] << 8) | m[off + 4 * i + 3];
        for (let i = 16; i < 64; i++) {
          const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
          const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
          w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
        }
        let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
        for (let i = 0; i < 64; i++) {
          const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
          const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
          h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
        }
        H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
        H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
      }
      return H.map((x) => ('00000000' + (x >>> 0).toString(16)).slice(-8)).join('');
    };
  })();
  function hashPassword(pw, salt) {
    let h = SHA(salt + ':' + pw);
    for (let i = 0; i < 20000; i++) h = SHA(h + salt);
    return h;
  }
  const OWNER_EMAIL = 'jefersoncamilo12@hotmail.com';
  const OWNER_DEF = { salt: 'smash-dueno-2026-a1', hash: '8176e0968258e112c8bbca30b8bb027e323c24eb53ecc6f7585dde79e8a0ccfe' };
  const ownerCred = () => rd('smash_owner_cred', null) || OWNER_DEF;
  function loginOwner(email, pw) {
    const lock = rd('smash_owner_lock', { n: 0, until: 0 });
    if (Date.now() < lock.until) return { ok: false, error: 'Demasiados intentos. Espera ' + Math.ceil((lock.until - Date.now()) / 1000) + ' segundos.' };
    const c = ownerCred(), em = String(email).trim().toLowerCase();
    const extra = rd(DK, []).find((u) => u.correo === em);
    if ((em === OWNER_EMAIL && hashPassword(String(pw), c.salt) === c.hash) || (extra && hashPassword(String(pw), extra.salt) === extra.hash)) {
      wr('smash_owner_lock', { n: 0, until: 0 });
      sessionStorage.setItem('smash_session_owner', em);
      return { ok: true, email: em };
    }
    const n = lock.n + 1;
    wr('smash_owner_lock', { n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 30000 : 0 });
    return { ok: false, error: 'Correo o contraseña incorrectos.' };
  }
  // Un dueño eliminado pierde la sesión aunque la tuviera abierta
  const currentOwner = () => { const s = sessionStorage.getItem('smash_session_owner'); return s && (s === OWNER_EMAIL || rd(DK, []).some((u) => u.correo === s)) ? s : null; };
  const logoutOwner = () => sessionStorage.removeItem('smash_session_owner');
  function changeOwnerPassword(actual, nueva, nueva2) {
    const yo = currentOwner(), l = rd(DK, []), extra = l.find((u) => u.correo === yo);
    const c = extra || ownerCred();
    if (hashPassword(String(actual), c.salt) !== c.hash) return { ok: false, error: 'La contraseña actual no es correcta.' };
    if (String(nueva).length < 10) return { ok: false, error: 'La nueva contraseña debe tener al menos 10 caracteres.' };
    if (nueva !== nueva2) return { ok: false, error: 'Las contraseñas nuevas no coinciden.' };
    if (extra) { Object.assign(extra, huella(nueva)); wr(DK, l); } else wr('smash_owner_cred', huella(nueva));
    return { ok: true };
  }

  /* ---- Usuarios creados por los dueños ----
     Caja: se agregan a smash_staff con su propia clave (solo la huella, nunca la clave).
     Dueños: smash_duenos, entran con su correo. El dueño principal no se puede eliminar. */
  const DK = 'smash_duenos', SK = 'smash_staff';
  function huella(pw) { const salt = 'u' + Math.random().toString(36).slice(2) + Date.now().toString(36); return { salt, hash: hashPassword(String(pw), salt) }; }
  function getUsuarios() {
    return {
      caja: rd(SK, []).map((u) => ({ usuario: u.usuario, nombre: u.nombre, propio: !!u.propio })),
      duenos: [{ correo: OWNER_EMAIL, nombre: 'Dueño principal', principal: true }].concat(rd(DK, []).map((u) => ({ correo: u.correo, nombre: u.nombre }))),
    };
  }
  function crearUsuario(tipo, usuario, nombre, clave, clave2) {
    usuario = String(usuario || '').trim().toLowerCase(); nombre = String(nombre || '').trim();
    if (!usuario || !nombre) return { ok: false, error: 'Escribe el usuario y el nombre.' };
    if (String(clave).length < 8) return { ok: false, error: 'La clave debe tener al menos 8 caracteres.' };
    if (clave !== clave2) return { ok: false, error: 'Las claves no coinciden.' };
    const nuevo = Object.assign({ nombre, creado: new Date().toISOString() }, huella(clave));
    if (tipo === 'dueno') {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(usuario)) return { ok: false, error: 'Los dueños entran con su correo: escribe un correo válido.' };
      const l = rd(DK, []);
      if (usuario === OWNER_EMAIL || l.some((u) => u.correo === usuario)) return { ok: false, error: 'Ya existe un dueño con ese correo.' };
      l.push(Object.assign({ correo: usuario }, nuevo)); wr(DK, l);
    } else {
      if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { ok: false, error: 'El usuario de caja: de 3 a 30 letras o números, sin espacios.' };
      const l = rd(SK, []);
      if (l.some((u) => String(u.usuario).toLowerCase() === usuario)) return { ok: false, error: 'Ya existe un usuario de caja con ese nombre.' };
      l.push(Object.assign({ usuario, propio: true }, nuevo)); wr(SK, l);
    }
    return { ok: true };
  }
  function eliminarUsuario(tipo, usuario) {
    if (tipo === 'dueno') {
      if (usuario === OWNER_EMAIL) return { ok: false, error: 'El dueño principal no se puede eliminar.' };
      if (usuario === currentOwner()) return { ok: false, error: 'No puedes eliminar tu propio usuario mientras estás conectado.' };
      wr(DK, rd(DK, []).filter((u) => u.correo !== usuario));
    } else {
      const l = rd(SK, []);
      if (l.length <= 1) return { ok: false, error: 'Debe quedar al menos un usuario de caja.' };
      wr(SK, l.filter((u) => u.usuario !== usuario));
    }
    return { ok: true };
  }

  return {
    getZones, setZoneFees, getZonasCfg, saveZonasCfg, addOrder, localDay, pedidosRepetidos, diaServicio, inicioPedido, nextDayNumber, arreglarNumerosHoy, getCupoRaw, setCupo, cupoHoy, buildMenu, loadMenu,
    setStatus, updateOrder, getRepartidores, rememberRepartidor, soundOn, setSound, unlockAudio, audioReady, chime,
    refreshLedger, getLedger, deleteOrder, getDeletedOrders, DIAS, getPersonal, addPersonal, deletePersonal, antiguedad,
    hashPassword, loginOwner, currentOwner, logoutOwner, changeOwnerPassword, OWNER_DEF,
    getUsuarios, crearUsuario, eliminarUsuario, leerItems, leerLeal, leerSabores, getHorario, setHorario, horaTexto, estadoHorario,
  };
})();

/* Si una foto .jpg no existe, prueba .jpeg, .png y .webp antes de ocultarla */
function smashImgFallback(im) {
  const s = im.getAttribute('src') || '';
  if (s.indexOf('data:') === 0) { im.remove(); return; }
  const ex = ['.jpg', '.jpeg', '.png', '.webp'];
  const base = s.replace(/\.(jpe?g|png|webp)(\?.*)?$/i, '');
  let t = parseInt(im.dataset.t || '0', 10);
  while (t < ex.length && base + ex[t] === s) t++;
  if (t >= ex.length) { im.remove(); return; }
  im.dataset.t = t + 1;
  im.src = base + ex[t];
}
