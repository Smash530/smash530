/* ============================================================
   SMASH · data-ext.js
   Extensión de data.js (que queda SIN modificar). Agrega:
   - tarifas de domicilio por zona
   - pedidos con zona, medio de pago, referencia y # de pedido del día
   - evita duplicar un pedido (por referencia)
   Usa las mismas llaves de localStorage que data.js.
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
  const rd = (k, f) => { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : f; } catch (e) { return f; } };
  const wr = (k, v) => localStorage.setItem(k, JSON.stringify(v));

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
  function nextDayNumber(orders) {
    const hoy = localDay(new Date().toISOString());
    const del = orders.filter((o) => localDay(o.creado) === hoy);
    const max = del.reduce((m, o) => Math.max(m, o.numeroDia || 0), 0);
    return Math.max(del.length, max) + 1;
  }
  function addOrder(d) {
    const K = SmashDB.KEYS;
    const orders = rd(K.ORDERS, []);
    if (d.ref) {
      const dup = orders.find((o) => o.ref === d.ref);
      if (dup) return { ok: false, dup: true, order: dup };
    }
    const seq = (rd(K.ORDER_SEQ, 0) || 0) + 1;
    wr(K.ORDER_SEQ, seq);
    const subtotal = d.items.reduce((s, it) => s + it.price * it.qty, 0);
    const domicilio = Number(d.domicilio) || 0;
    const order = {
      id: seq,
      numeroDia: nextDayNumber(orders),
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
      total: subtotal + domicilio,
      status: 'nuevo',
      creado: new Date().toISOString(),
    };
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
    getZones, setZoneFees, getZonasCfg, saveZonasCfg, addOrder, localDay, getCupoRaw, setCupo, cupoHoy, buildMenu, loadMenu,
    setStatus, updateOrder, getRepartidores, rememberRepartidor, soundOn, setSound, unlockAudio, audioReady, chime,
    refreshLedger, getLedger, deleteOrder, getDeletedOrders, DIAS, getPersonal, addPersonal, deletePersonal, antiguedad,
    hashPassword, loginOwner, currentOwner, logoutOwner, changeOwnerPassword, OWNER_DEF,
    getUsuarios, crearUsuario, eliminarUsuario, leerItems, leerSabores, getHorario, setHorario, horaTexto, estadoHorario,
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
