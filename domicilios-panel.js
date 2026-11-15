/* ============================================================
   SMASH · domicilios-panel.js  (cocina y dueños)
   Domiciliarios con cuenta, rutas, tiempos y contaduría.
   - Los domicilios salen en RUTA: se eligen los pedidos de un
     domiciliario y se despachan juntos. Durante 6 minutos se pueden
     agregar o quitar destinos; después la ruta queda fija.
   - Cada pedido de la ruta se publica en la nube (tabla entregas) y le
     aparece al domiciliario en su celular (domiciliario.html).
   - Lo que marca el domiciliario (salí / entregado) vuelve a los
     paneles con la hora real, y lo que se marque aquí le llega a él.
   - Cuando entrega todos los destinos, la ruta sale del panel y queda
     en el registro.
   - Contaduría: cada domicilio se le paga según la zona (los dueños lo
     configuran; Sur: $6.000 aunque al cliente se le cobren $7.000).
   Necesita supabase/domiciliarios.sql. Usa SmashDomiNube.
   ============================================================ */
const SmashDomi = (function () {
  'use strict';
  const N = typeof SmashDomiNube !== 'undefined' ? SmashDomiNube.panel : null;
  const ES_DUENO = /dueno/i.test(location.pathname);
  const LS_LISTA = 'domi_lista', LS_PUB = 'domi_publicado', LS_DESDE = 'domi_desde';
  const K_PAGO = 'smash_pago_domi';          // { claveZona: pago al domiciliario } (se sincroniza)
  const PAGO_DEF = { sur: 6000 };
  const EDITABLE = 6 * 60000;                // minutos para modificar una ruta
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } };
  const rd = (k, d) => { try { const v = SmashLS.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const ms = (a, b) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);
  const dur = (m) => {
    if (m == null || m < 0) return '—';
    const min = Math.round(m / 60000);
    return min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  };
  const mmss = (m) => { const s = Math.max(0, Math.ceil(m / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const RANGO = { asignado: 1, en_camino: 2, entregado: 3 };
  const estadoDe = (o) => (o.status === 'cancelado' ? 'cancelado' : o.status === 'entregado' ? 'entregado' : o.status === 'en_camino' ? 'en_camino' : 'asignado');
  const ini = (n) => esc(String(n || '?').trim().charAt(0).toUpperCase() || '?');
  const num = (o) => esc(o.numeroDia || o.id);

  /* ---------------- Lista de domiciliarios (con copia en este equipo) ---------------- */
  let lista = lsGet(LS_LISTA, []);
  let errLista = '';
  async function cargarLista() {
    if (!N || !N.listo()) return;
    const r = await N.listar();
    if (r && r.ok) { lista = r.lista || []; lsSet(LS_LISTA, lista); errLista = ''; }
    else errLista = (r && r.error) || '';
    pintar();
  }
  const activos = () => lista.filter((d) => d.activo);
  const domiDe = (id) => lista.find((x) => x.id === id);
  const nombreDe = (id) => { const d = domiDe(id); return d ? d.nombre : ''; };

  /* ---------------- Pago al domiciliario por zona ---------------- */
  const pagos = () => Object.assign({}, PAGO_DEF, rd(K_PAGO, {}));
  const zonas = () => { try { return SmashExt.getZonasCfg(); } catch (e) { return []; } };
  function zonaDe(o) {
    const n = String(o.zona || '').trim().toLowerCase();
    return zonas().find((z) => z.nombre.trim().toLowerCase() === n) || null;
  }
  // Lo que se le paga al domiciliario por este pedido. Una vez entregado queda fijo (o.pagoDomi).
  function pagoDomi(o) {
    if (o.pagoDomi != null) return Number(o.pagoDomi) || 0;
    const z = zonaDe(o), p = pagos();
    if (z && p[z.k] != null && p[z.k] !== '') return Number(p[z.k]) || 0;
    return Math.round(Number(o.domicilio) || 0);
  }
  const diaDe = (o) => { try { return SmashExt.diaServicio(o) || SmashExt.localDay(o.entregadoEn || o.creado); } catch (e) { return String(o.creado || '').slice(0, 10); } };

  /* ---------------- Rutas ---------------- */
  const terminado = (o) => o.status === 'entregado' || o.status === 'cancelado';
  const deDomi = (id) => SmashDB.getOrders().filter((o) => o.repartidorId === id);
  // Ruta en curso del domiciliario: la más reciente con algún destino sin entregar
  function rutaActiva(id) {
    const porRuta = {};
    deDomi(id).forEach((o) => {
      const k = o.rutaId || 'p' + o.id;
      (porRuta[k] = porRuta[k] || { id: o.rutaId || null, en: o.rutaEn || o.asignadoEn, pedidos: [] }).pedidos.push(o);
    });
    const vivas = Object.values(porRuta).filter((r) => r.pedidos.some((o) => !terminado(o)) && Date.now() - new Date(r.en).getTime() < 864e5);
    vivas.sort((a, b) => (a.en < b.en ? 1 : -1));
    const r = vivas[0];
    if (!r) return null;
    r.pedidos = r.pedidos.filter((o) => o.status !== 'cancelado').sort((a, b) => (Number(a.numeroDia) || 0) - (Number(b.numeroDia) || 0));
    r.restante = EDITABLE - (Date.now() - new Date(r.en).getTime());
    r.editable = r.restante > 0;
    r.salio = r.pedidos.map((o) => o.salioEn).filter(Boolean).sort()[0] || null;
    r.hechos = r.pedidos.filter((o) => o.status === 'entregado').length;
    return r;
  }
  // Pedidos sin domiciliario que se pueden despachar (del día, aún no entregados)
  function porDespachar() {
    const lim = Date.now() - 864e5, orden = { listo: 0, preparando: 1, confirmado: 2, nuevo: 3 };
    return SmashDB.getOrders().filter((o) => !o.repartidor && orden[o.status] != null && new Date(o.creado || 0).getTime() > lim)
      .sort((a, b) => orden[a.status] - orden[b.status] || (Number(a.numeroDia) || 0) - (Number(b.numeroDia) || 0));
  }
  // Asigna pedidos a un domiciliario con cuenta: entran a su ruta abierta (si aún es editable) o arman una nueva
  function asignar(ids, domiId) {
    const d = domiDe(domiId);
    if (!d) return { ok: false, error: 'Ese domiciliario no tiene cuenta activa.' };
    const r = rutaActiva(domiId);
    if (r && !r.editable && r.pedidos.some((o) => !ids.includes(o.id))) return { ok: false, error: `${d.nombre} tiene una ruta en curso que ya no se puede modificar (pasaron 6 minutos). Espera a que la termine.` };
    const rutaId = r && r.editable && r.id ? r.id : 'R' + Date.now().toString(36).toUpperCase();
    const rutaEn = r && r.editable && r.id ? r.en : new Date().toISOString();
    const ahora = new Date().toISOString();
    ids.forEach((id) => {
      const o = SmashDB.getOrderById(id);
      if (!o || terminado(o)) return;
      const patch = { repartidor: d.nombre, repartidorId: d.id, rutaId, rutaEn };
      if (o.repartidorId !== d.id || !o.asignadoEn) patch.asignadoEn = ahora;
      SmashExt.updateOrder(id, patch);
    });
    try { SmashExt.rememberRepartidor(d.nombre); } catch (e) { /* sin recordar */ }
    publicarPronto(); pintar();
    return { ok: true, rutaId };
  }
  // Quita un destino de la ruta (solo en los primeros 6 minutos)
  function quitar(id) {
    const o = SmashDB.getOrderById(id);
    if (!o || o.status === 'entregado') return { ok: false, error: 'Ese pedido ya fue entregado.' };
    const r = o.repartidorId && rutaActiva(o.repartidorId);
    if (r && !r.editable) return { ok: false, error: 'La ruta ya no se puede modificar (pasaron 6 minutos).' };
    const patch = { repartidor: '', repartidorId: null, rutaId: null, rutaEn: null, asignadoEn: null };
    if (o.status === 'en_camino') Object.assign(patch, { status: 'listo', salioEn: null });
    SmashExt.updateOrder(id, patch);
    publicarPronto(); pintar();
    return { ok: true };
  }

  /* ---------------- Publicar en la nube ---------------- */
  const items = (o) => (o.items || []).map((it) => `${it.qty || 1}× ${it.name || it.nombre || ''}${it.nota ? ' (' + it.nota + ')' : ''}`).join('\n');
  function cobrar(o) {
    if (typeof SmashCaja === 'undefined') return 0;
    // Pagos por transferencia: el domiciliario no cobra en la puerta
    if (/transfer|nequi|daviplata|bancolombia|llave|qr/i.test(String(o.pago || ''))) return 0;
    try { return SmashCaja.estadoPago(o).k === 'pendiente' ? SmashCaja.montoACobrar(o, true) : 0; } catch (e) { return 0; }
  }
  function entregaDe(o) {
    return {
      pedido: String(o.id), numero: Number(o.numeroDia || o.id) || null, domiciliario: o.repartidorId,
      cliente: o.cliente || '', telefono: o.telefono || '', direccion: o.direccion || '', zona: o.zona || '',
      notas: [o.horaEntrega ? 'Entregar: ' + o.horaEntrega : '', o.notas || ''].filter(Boolean).join(' · '),
      items: items(o), pago: o.pago || '', total: Math.round(o.total || 0), domicilio: Math.round(o.domicilio || 0), cobrar: cobrar(o),
      estado: estadoDe(o), asignado_en: o.asignadoEn || o.salioEn || o.creado, salio_en: o.salioEn || null, entregado_en: o.entregadoEn || null,
      ruta: o.rutaId || '', ruta_en: o.rutaEn || null, pago_domi: pagoDomi(o), dia: diaDe(o),
    };
  }
  const recientes = () => { const lim = Date.now() - 2 * 864e5; return SmashDB.getOrders().filter((o) => new Date(o.asignadoEn || o.creado || 0).getTime() > lim); };
  /* El pago al domiciliario de un domicilio entregado queda fijo (o.pagoDomi), aunque luego cambie la
     tarifa. Con eso Informes/Contabilidad/Socios suman la diferencia como ganancia de SMASH.
     Solo desde que empezó esta regla (smash_domi_regla_desde): los días pasados no cambian. */
  const K_DESDE = 'smash_domi_regla_desde';
  function fijarPagos() {
    let desde = rd(K_DESDE, null);
    if (!desde) { desde = new Date().toISOString(); SmashLS.setItem(K_DESDE, JSON.stringify(desde)); }
    recientes().forEach((o) => {
      if (o.status === 'entregado' && o.pagoDomi == null && Number(o.domicilio) > 0 && (o.entregadoEn || '') >= desde) SmashExt.updateOrder(o.id, { pagoDomi: pagoDomi(o) });
    });
  }
  let publicando = false, otraVez = false;
  async function publicar() {
    try { fijarPagos(); } catch (e) { /* se reintenta */ }
    if (!N || !N.listo()) return;
    if (publicando) { otraVez = true; return; }
    const pub = lsGet(LS_PUB, {}), cambios = [];
    recientes().forEach((o) => {
      // Se publica si tiene domiciliario con cuenta, o si lo tuvo (para retirarlo de su celular)
      if (!o.repartidorId && !pub[o.id]) return;
      const e = o.repartidorId ? entregaDe(o) : Object.assign(entregaDe(o), { estado: 'cancelado', domiciliario: pub[o.id].d });
      const firma = JSON.stringify(e);
      if (!pub[o.id] || pub[o.id].f !== firma) cambios.push({ id: o.id, e, firma });
    });
    if (!cambios.length) return;
    publicando = true;
    try {
      const r = await N.publicar(cambios.slice(0, 80).map((c) => c.e));
      if (r && r.ok) {
        const m = lsGet(LS_PUB, {});
        const porId = {}; SmashDB.getOrders().forEach((o) => { porId[String(o.id)] = o; });
        cambios.slice(0, 80).forEach((c) => { const ox = porId[String(c.id)]; if (c.e.estado === 'cancelado' && !(ox && ox.repartidorId)) delete m[c.id]; else m[c.id] = { f: c.firma, d: c.e.domiciliario }; });
        const lim = Date.now() - 3 * 864e5;
        Object.keys(m).forEach((k) => { const o = porId[k]; if (!o || new Date(o.asignadoEn || o.creado || 0).getTime() < lim) delete m[k]; });
        lsSet(LS_PUB, m);
      }
    } catch (e) { /* sin internet: se reintenta */ }
    publicando = false;
    if (otraVez) { otraVez = false; setTimeout(publicar, 200); }
  }
  let tPub = null;
  const publicarPronto = () => { clearTimeout(tPub); tPub = setTimeout(publicar, 400); };

  /* ---------------- Traer lo que marcó el domiciliario ---------------- */
  let trayendo = false;
  async function traer() {
    if (!N || !N.listo() || trayendo) return;
    trayendo = true;
    try {
      const r = await N.cambios(lsGet(LS_DESDE, null));
      if (r && r.ok) {
        let cambio = false;
        (r.lista || []).forEach((e) => { if (aplicar(e)) cambio = true; });
        // margen de 5 s por relojes distintos; aplicar es idempotente
        if (r.ahora) lsSet(LS_DESDE, new Date(new Date(r.ahora).getTime() - 5000).toISOString());
        if (cambio) { window.dispatchEvent(new CustomEvent('smash:domi')); pintar(); }
      }
    } catch (e) { /* sin internet */ }
    trayendo = false;
  }
  function aplicar(e) {
    const o = SmashDB.getOrders().find((x) => String(x.id) === String(e.pedido));
    if (!o || !o.repartidorId || o.repartidorId !== e.domiciliario) return false;
    if (o.status === 'cancelado' || !RANGO[e.estado]) return false;
    const local = RANGO[estadoDe(o)] || 1;
    if (RANGO[e.estado] <= local) return false;
    SmashExt.setStatus(o.id, e.estado);
    const patch = {};
    if (e.salio_en) patch.salioEn = e.salio_en;
    if (e.estado === 'entregado' && e.entregado_en) patch.entregadoEn = e.entregado_en;
    // Mismo resultado en todos los equipos (no se agregan registros): solo estado, horas y quién lo marcó
    if (e.por === 'domiciliario') patch.marcoDomi = true;
    SmashExt.updateOrder(o.id, patch);
    return true;
  }

  /* ---------------- Tiempos de un pedido (ficha) ---------------- */
  function tiemposHtml(o) {
    const a = o.asignadoEn, s = o.salioEn, en = o.entregadoEn;
    if (!a && !s) return '';
    const paso = (t, n, v, on) => `<span class="dt-paso${on ? ' on' : ''}"><i></i><b>${n}</b><small>${v ? hora(v) : '—'}</small></span>`;
    const total = en ? ms(a || s, en) : ms(a || s, new Date().toISOString());
    return `<div class="dt-line">${paso(1, 'Asignado', a, !!a)}<em>${a && s ? dur(ms(a, s)) : ''}</em>${paso(2, 'Salió', s, !!s)}<em>${s && en ? dur(ms(s, en)) : ''}</em>${paso(3, 'Entregado', en, !!en)}
      <span class="dt-total${en ? '' : ' vivo'}">${en ? 'Total' : 'Van'} <b>${dur(total)}</b></span>
      ${o.repartidorId && !en ? `<button type="button" class="dt-mapa" data-ver-mapa="${esc(o.repartidorId)}">📍 Ver en el mapa</button>` : ''}</div>`;
  }

  /* ---------------- Contaduría (hoy / semana / mes) ---------------- */
  const hoyISO = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  function limites() {
    const hoy = hoyISO(), h = new Date(hoy + 'T12:00:00'), lun = new Date(h);
    lun.setDate(h.getDate() - ((h.getDay() + 6) % 7));
    const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    return { hoy, semana: iso(lun), mes: hoy.slice(0, 8) + '01' };
  }
  const entregados = () => SmashDB.getOrders().filter((o) => o.repartidor && o.status === 'entregado' && o.entregadoEn);
  function cuentas() {
    const L = limites(), por = {};
    entregados().forEach((o) => {
      const dia = diaDe(o);
      if (dia < L.mes && dia < L.semana) return;
      const k = o.repartidorId || 'n:' + o.repartidor.toLowerCase();
      const c = por[k] || (por[k] = { k, id: o.repartidorId || null, n: o.repartidorId ? nombreDe(o.repartidorId) || o.repartidor : o.repartidor, hoy: { n: 0, p: 0 }, semana: { n: 0, p: 0 }, mes: { n: 0, p: 0 }, tiempos: [] });
      const p = pagoDomi(o);
      if (dia === L.hoy) { c.hoy.n++; c.hoy.p += p; const t = ms(o.asignadoEn || o.salioEn, o.entregadoEn); if (t >= 0) c.tiempos.push(t); }
      if (dia >= L.semana && dia <= L.hoy) { c.semana.n++; c.semana.p += p; }
      if (dia >= L.mes && dia <= L.hoy) { c.mes.n++; c.mes.p += p; }
    });
    return por;
  }

  /* ============================================================
     SECCIÓN DOMICILIOS
     Izquierda: mapa en vivo (domicilios-mapa.js).
     Derecha: domiciliarios; al tocar uno se despliega su ruta.
     Abajo: registro y contaduría.
     ============================================================ */
  const cont = () => document.getElementById('domiSec');
  const visible = () => { const el = cont(); return el && !el.closest('.panel-section').hidden; };
  let abierto = null;                 // domiciliario desplegado
  let armando = null, marcados = [];  // armando ruta: id del domiciliario y pedidos elegidos
  let periodo = 'hoy', verDetalle = false;
  const ubic = (id) => (typeof SmashDomiMapa !== 'undefined' ? SmashDomiMapa.ubicacion(id) : null);

  function senal(id) {
    const u = ubic(id);
    if (!u) return { k: 'nada', t: 'Sin ubicación' };
    const seg = (Date.now() - new Date(u.en).getTime()) / 1000;
    if (u.fondo) return { k: 'fondo', t: 'Salió de la página · ' + (typeof SmashMapa !== 'undefined' ? SmashMapa.hace(u.en) : '') };
    if (seg > 120) return { k: 'vieja', t: 'Sin señal · ' + (typeof SmashMapa !== 'undefined' ? SmashMapa.hace(u.en) : '') };
    return { k: 'vivo', t: 'En vivo' + (u.velocidad != null ? ' · ' + u.velocidad + ' km/h' : '') };
  }

  function pintar() {
    const el = cont();
    if (!el || !visible()) return;
    if (!el.querySelector('#dmA')) {
      el.innerHTML = `<div id="dmA"></div>
        <div class="dm-main"><div class="dm-main-mapa" id="dmMapaSlot"></div><aside class="dm-lado" id="dmLado"></aside></div>
        <div id="dmB"></div>`;
      el.addEventListener('click', alClic);
      el.addEventListener('change', alCambio);
    }
    pintarCabeza(); pintarLado(); pintarAbajo();
    window.dispatchEvent(new CustomEvent('smash:domi-pintado'));
  }

  function pintarCabeza() {
    const C = Object.values(cuentas());
    const hoyN = C.reduce((s, c) => s + c.hoy.n, 0), hoyP = C.reduce((s, c) => s + c.hoy.p, 0);
    const t = C.reduce((a, c) => a.concat(c.tiempos), []);
    const prom = t.length ? t.reduce((s, x) => s + x, 0) / t.length : null;
    const rutas = activos().map((d) => rutaActiva(d.id)).filter(Boolean);
    const sinNube = !N || !N.listo();
    document.getElementById('dmA').innerHTML = `
      <div class="page-head dm-head"><div><h2 class="page-title">Domicilios</h2><p class="page-sub">Rutas en vivo, tiempos de entrega y cuentas de los domiciliarios.</p></div>
        <div class="dm-chips-k">
          <span><b>${rutas.length}</b> en ruta</span><span><b>${porDespachar().length}</b> por despachar</span>
          <span><b>${hoyN}</b> entregados hoy</span><span><b>${dur(prom)}</b> promedio</span><span><b>${fmt(hoyP)}</b> a pagar hoy</span>
        </div></div>
      ${sinNube ? '<div class="dm-aviso">⚠ Este equipo no está conectado a la nube: las rutas no llegan al celular del domiciliario.</div>' : errLista ? `<div class="dm-aviso">⚠ ${esc(errLista)}</div>` : ''}`;
  }

  function pintarLado() {
    const lado = document.getElementById('dmLado');
    if (!lado) return;
    const C = cuentas(), pend = porDespachar();
    const domis = activos().map((d) => ({ d, r: rutaActiva(d.id), s: senal(d.id), c: C[d.id] }))
      .sort((a, b) => (!!b.r - !!a.r) || a.d.nombre.localeCompare(b.d.nombre));
    lado.innerHTML = `
      <div class="dl-tit"><h3>Domiciliarios</h3><span class="dm-n">${domis.length}</span></div>
      ${domis.length ? domis.map(itemDomi).join('') : `<div class="dm-ml-vacio"><b>Aún no hay domiciliarios con cuenta</b><span>${ES_DUENO ? 'Créalos abajo, en "Cuentas de domiciliarios".' : 'Los crea un dueño en su panel.'}</span></div>`}
      <details class="dl-pend"${pend.length && !armando ? '' : ''}><summary>Por despachar <span class="dm-n">${pend.length}</span></summary>
        ${pend.length ? `<ul>${pend.map((o) => `<li><b>#${num(o)}</b><span>${esc(o.cliente || '')}<small>${esc(o.zona || o.direccion || '')}</small></span><em class="st-${esc(o.status)}">${esc(estadoTxt(o.status))}</em></li>`).join('')}</ul>` : '<p class="dm-vacio">No hay pedidos esperando domiciliario.</p>'}
      </details>`;
    tic();
  }
  const estadoTxt = (s) => ({ nuevo: 'Recibido', confirmado: 'Confirmado', preparando: 'Preparando', listo: 'Listo', en_camino: 'En camino', entregado: 'Entregado' }[s] || s);

  function itemDomi({ d, r, s, c }) {
    const on = abierto === d.id;
    const est = r ? (r.pedidos.some((o) => o.status === 'en_camino') ? 'cam' : 'asg') : 'libre';
    const sub = r ? `${est === 'cam' ? 'En ruta' : 'Ruta asignada'} · ${r.hechos}/${r.pedidos.length} entregados` : 'Disponible';
    return `<div class="dl${on ? ' on' : ''} dl-${est}" data-dl="${esc(d.id)}">
      <button type="button" class="dl-h" data-abrir="${esc(d.id)}" aria-expanded="${on}">
        <span class="dl-av ${est} s-${s.k}">${ini(d.nombre)}</span>
        <span class="dl-t"><b>${esc(d.nombre)}</b><small>${esc(sub)}</small>${r || s.k !== 'nada' ? `<small class="dl-s s-${s.k}">${esc(s.t)}</small>` : ''}</span>
        <span class="dl-hoy"><b>${fmt(c ? c.hoy.p : 0)}</b><small>${c ? c.hoy.n : 0} hoy</small></span>
        <svg class="dl-chev" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      ${on ? cuerpoDomi(d, r, c) : ''}
    </div>`;
  }

  function cuerpoDomi(d, r, c) {
    const elegir = armando === d.id;
    let h = '<div class="dl-b">';
    if (r) {
      h += `<div class="dl-ruta-h"><span>Ruta · asignada ${hora(r.en)}${r.salio ? ' · salió ' + hora(r.salio) : ''}</span>
        ${r.editable ? `<span class="dl-edit" data-hasta="${new Date(new Date(r.en).getTime() + EDITABLE).toISOString()}">✏️ Editable <b>${mmss(r.restante)}</b></span>` : '<span class="dl-lock">🔒 Ruta fija</span>'}</div>
        <ol class="dl-peds">${r.pedidos.map((o) => {
          const st = o.status === 'entregado' ? 'ok' : o.status === 'en_camino' ? 'cam' : 'pend';
          return `<li class="${st}"><i></i><div><b>#${num(o)} ${esc(o.cliente || '')}</b><small>${esc(o.direccion || '')}${o.zona ? ' · ' + esc(o.zona) : ''}</small></div>
            <span class="dl-st">${st === 'ok' ? '✓ ' + hora(o.entregadoEn) : st === 'cam' ? 'En camino' : 'Por salir'}</span>
            ${r.editable && st !== 'ok' ? `<button type="button" class="dl-x" data-quitar="${esc(o.id)}" title="Quitar de la ruta" aria-label="Quitar pedido #${num(o)} de la ruta">✕</button>` : ''}</li>`;
        }).join('')}</ol>`;
    } else if (!elegir) {
      h += '<p class="dl-libre">Sin ruta. Elige los pedidos que va a llevar y despáchalos juntos.</p>';
    }
    if (elegir) {
      const pend = porDespachar();
      h += `<div class="dl-armar"><b>${r ? 'Agregar destinos a la ruta' : 'Armar ruta'}</b>
        ${pend.length ? `<ul>${pend.map((o) => `<li><label><input type="checkbox" data-marcar="${esc(o.id)}"${marcados.includes(o.id) ? ' checked' : ''}><b>#${num(o)}</b><span>${esc(o.cliente || '')}<small>${esc(o.zona || o.direccion || '')}</small></span><em class="st-${esc(o.status)}">${esc(estadoTxt(o.status))}</em></label></li>`).join('')}</ul>` : '<p class="dm-vacio">No hay pedidos por despachar.</p>'}
        <div class="dl-acc"><button type="button" class="btn-primary" data-despachar="${esc(d.id)}"${marcados.length ? '' : ' disabled'}>${r ? 'Agregar' : 'Despachar ruta'}${marcados.length ? ' (' + marcados.length + ')' : ''}</button><button type="button" class="btn-secondary" data-cancelar-armar>Cancelar</button></div></div>`;
    } else if (!r || r.editable) {
      h += `<button type="button" class="dl-btn" data-armar="${esc(d.id)}">${r ? '+ Agregar destinos' : '🛵 Armar ruta'}</button>`;
    }
    h += `<div class="dl-pie"><span>Hoy <b>${c ? c.hoy.n : 0}</b> · ${fmt(c ? c.hoy.p : 0)}</span><span>Semana <b>${c ? c.semana.n : 0}</b> · ${fmt(c ? c.semana.p : 0)}</span>
      ${ubic(d.id) ? `<button type="button" class="dm-mini" data-ver-mapa="${esc(d.id)}">📍 Ver</button>` : ''}</div>`;
    return h + '</div>';
  }

  // Cuenta regresiva de los 6 minutos sin volver a dibujar todo
  function tic() {
    document.querySelectorAll('.dl-edit[data-hasta]').forEach((s) => {
      const r = new Date(s.dataset.hasta).getTime() - Date.now();
      if (r <= 0) { pintarLado(); return; }
      s.querySelector('b').textContent = mmss(r);
    });
  }

  function pintarAbajo() {
    const b = document.getElementById('dmB');
    if (!b) return;
    const C = Object.values(cuentas()).sort((x, y) => y[periodo].n - x[periodo].n);
    const tot = C.reduce((s, c) => ({ n: s.n + c[periodo].n, p: s.p + c[periodo].p }), { n: 0, p: 0 });
    const L = limites();
    const lista = entregados().filter((o) => { const dd = diaDe(o); return periodo === 'hoy' ? dd === L.hoy : periodo === 'semana' ? dd >= L.semana && dd <= L.hoy : dd >= L.mes && dd <= L.hoy; })
      .sort((x, y) => (x.entregadoEn < y.entregadoEn ? 1 : -1));
    b.innerHTML = `
      <div class="dm-card">
        <div class="dm-card-h"><h3>Registro y cuentas</h3>
          <div class="dm-rango">${[['hoy', 'Hoy'], ['semana', 'Semana'], ['mes', 'Mes']].map(([k, n]) => `<button type="button" data-periodo="${k}" class="${periodo === k ? 'on' : ''}">${n}</button>`).join('')}</div></div>
        ${C.some((c) => c[periodo].n) ? `<div class="table-wrap"><table class="rtable dm-tabla"><thead><tr><th>Domiciliario</th><th class="num">Domicilios</th><th class="num">A pagar</th><th class="num">Hoy</th><th class="num">Semana</th><th class="num">Mes</th></tr></thead><tbody>
          ${C.filter((c) => c[periodo].n || c.mes.n).map((c) => `<tr><td data-l="Domiciliario"><span class="dm-av">${ini(c.n)}</span>${esc(c.n)}${c.id ? ' 📱' : ''}</td>
            <td class="num" data-l="Domicilios"><b>${c[periodo].n}</b></td><td class="num" data-l="A pagar"><b>${fmt(c[periodo].p)}</b></td>
            <td class="num" data-l="Hoy">${c.hoy.n} · ${fmt(c.hoy.p)}</td><td class="num" data-l="Semana">${c.semana.n} · ${fmt(c.semana.p)}</td><td class="num" data-l="Mes">${c.mes.n} · ${fmt(c.mes.p)}</td></tr>`).join('')}
          </tbody><tfoot><tr><td>Total</td><td class="num"><b>${tot.n}</b></td><td class="num"><b>${fmt(tot.p)}</b></td><td colspan="3"></td></tr></tfoot></table></div>` : '<p class="dm-vacio">Todavía no hay domicilios entregados en este periodo.</p>'}
        <p class="hint">El pago de cada domicilio sale de la tarifa por zona${ES_DUENO ? ' (abajo, en "Pago al domiciliario por zona")' : ''}; una vez entregado, queda fijo.</p>
        <button type="button" class="dm-mini" data-detalle>${verDetalle ? 'Ocultar' : 'Ver'} detalle de entregas (${lista.length})</button>
        ${verDetalle ? (lista.length ? `<div class="table-wrap" style="margin-top:10px"><table class="rtable dm-tabla"><thead><tr><th>#</th><th>Cliente</th><th>Domiciliario</th><th>Asignado</th><th>Salió</th><th>Entregado</th><th class="num">Total</th><th class="num">Pago</th></tr></thead><tbody>
          ${lista.map((o) => { const t = ms(o.asignadoEn || o.salioEn, o.entregadoEn); return `<tr><td data-l="#"><b>#${num(o)}</b></td><td data-l="Cliente">${esc(o.cliente || '')}<small class="dm-sub">${esc(o.zona || '')}</small></td><td data-l="Domiciliario">${esc(o.repartidor)}</td>
            <td data-l="Asignado">${o.asignadoEn ? hora(o.asignadoEn) : '—'}</td><td data-l="Salió">${o.salioEn ? hora(o.salioEn) : '—'}</td><td data-l="Entregado">${hora(o.entregadoEn)}</td>
            <td class="num${t > 45 * 60000 ? ' dm-mal' : ''}" data-l="Total">${dur(t)}</td><td class="num" data-l="Pago">${fmt(pagoDomi(o))}</td></tr>`; }).join('')}
          </tbody></table></div>` : '<p class="dm-vacio">Sin entregas.</p>') : ''}
      </div>
      ${ES_DUENO ? pagosHtml() + cuentasHtml() : `<p class="hint">Página del domiciliario: <a href="domiciliario.html" target="_blank" rel="noopener">${esc(linkPagina())}</a></p>`}`;
    if (ES_DUENO) conectarCuentas(b);
  }

  /* ---------------- Pago al domiciliario por zona (solo dueños) ---------------- */
  function pagosHtml() {
    const p = pagos();
    return `<div class="dm-card"><div class="dm-card-h"><h3>Pago al domiciliario por zona</h3></div>
      <p class="hint">Lo que se le paga al domiciliario por cada domicilio. Si lo dejas vacío, se le paga lo mismo que se le cobra al cliente.</p>
      <div class="dm-zonas">${zonas().filter((z) => z.activa !== false).map((z) => `<label class="dm-zona"><span><b>${esc(z.nombre)}</b><small>Cliente paga ${z.variable ? 'valor variable' : fmt(z.fee)}</small></span>
        <span class="dm-zona-in">$<input type="number" min="0" step="500" inputmode="numeric" data-pago-zona="${esc(z.k)}" value="${p[z.k] != null ? esc(p[z.k]) : ''}" placeholder="${z.variable ? 'igual' : esc(z.fee)}"></span></label>`).join('')}</div>
      <div class="dl-acc"><button type="button" class="btn-primary" data-guardar-pagos>Guardar pagos</button><span class="hint" id="dmPagoOk"></span></div></div>`;
  }

  /* ---------------- Cuentas de domiciliarios (solo dueños) ---------------- */
  const linkPagina = () => location.origin + location.pathname.replace(/[^/]*$/, '') + 'domiciliario.html';
  let editando = null;
  function cuentasHtml() {
    const d = editando && lista.find((x) => x.id === editando);
    return `<div class="dm-card" id="dmCuentas">
      <div class="dm-card-h"><h3>Cuentas de domiciliarios</h3><span class="dm-n">${lista.length}</span></div>
      <p class="hint">Cada domiciliario entra con su usuario y clave en <a href="domiciliario.html" target="_blank" rel="noopener">${esc(linkPagina())}</a> <button type="button" class="dm-mini" data-copiar>Copiar enlace</button></p>
      ${lista.length ? `<div class="dm-cuentas">${lista.map((x) => `<div class="dm-cta${x.activo ? '' : ' off'}"><span class="dm-av">${ini(x.nombre)}</span>
          <div><b>${esc(x.nombre)}</b><small>@${esc(x.usuario)}${x.telefono ? ' · ' + esc(x.telefono) : ''}${x.activo ? '' : ' · desactivado'}</small></div>
          <button type="button" class="dm-mini" data-editar="${esc(x.id)}">Editar</button></div>`).join('')}</div>` : '<p class="dm-vacio">Aún no hay cuentas. Crea la primera abajo.</p>'}
      <form class="dm-form" id="dmForm" autocomplete="off">
        <h4>${d ? 'Editar a ' + esc(d.nombre) : 'Nuevo domiciliario'}</h4>
        <label>Nombre<input name="nombre" maxlength="60" required value="${esc(d ? d.nombre : '')}" placeholder="Ej: Carlos Pérez"></label>
        <label>Usuario<input name="usuario" maxlength="30" required value="${esc(d ? d.usuario : '')}" placeholder="ej: carlos" autocapitalize="none"></label>
        <label>Teléfono<input name="telefono" type="tel" maxlength="20" value="${esc(d ? d.telefono : '')}" placeholder="300 000 0000"></label>
        <label>${d ? 'Clave nueva (opcional)' : 'Clave'}<input name="clave" type="text" minlength="6" maxlength="40" ${d ? '' : 'required'} placeholder="Mínimo 6 caracteres"></label>
        ${d ? `<label class="dm-chk"><input type="checkbox" name="activo" ${d.activo ? 'checked' : ''}> Cuenta activa (si la desactivas, ya no puede entrar)</label>` : ''}
        <p class="error" id="dmErr"></p>
        <div class="dm-form-acc"><button type="submit" class="btn-primary">${d ? 'Guardar cambios' : 'Crear domiciliario'}</button>${d ? '<button type="button" class="btn-secondary" data-cancelar-edit>Cancelar</button>' : ''}</div>
      </form></div>`;
  }
  function conectarCuentas(el) {
    const f = el.querySelector('#dmForm');
    if (!f) return;
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f), err = f.querySelector('#dmErr'), btn = f.querySelector('[type=submit]');
      if (!N || !N.listo()) { err.textContent = 'Este equipo no está conectado a la nube.'; return; }
      const p = { id: editando || '', nombre: fd.get('nombre'), usuario: String(fd.get('usuario') || '').trim().toLowerCase(), telefono: fd.get('telefono'), clave: fd.get('clave') || '', activo: editando ? fd.get('activo') === 'on' : true };
      btn.disabled = true; err.textContent = '';
      const r = await N.guardar(p);
      btn.disabled = false;
      if (!r || !r.ok) { err.textContent = (r && r.error) || 'No se pudo guardar.'; return; }
      editando = null;
      await cargarLista();
    });
  }

  /* ---------------- Clics de la sección ---------------- */
  function alClic(e) {
    const t = e.target.closest('button, [data-abrir]');
    if (!t) return;
    const ds = t.dataset;
    if (ds.abrir) { abierto = abierto === ds.abrir ? null : ds.abrir; if (armando && armando !== abierto) { armando = null; marcados = []; } pintarLado(); if (abierto && ubic(abierto) && typeof SmashDomiMapa !== 'undefined') SmashDomiMapa.enfocar(abierto); return; }
    if (ds.armar) { armando = ds.armar; marcados = []; pintarLado(); return; }
    if (t.hasAttribute('data-cancelar-armar')) { armando = null; marcados = []; pintarLado(); return; }
    if (ds.despachar) {
      const r = asignar(marcados.slice(), ds.despachar);
      if (!r.ok) { alert(r.error); return; }
      armando = null; marcados = []; pintar(); return;
    }
    if (ds.quitar) {
      const o = SmashDB.getOrderById(isNaN(ds.quitar) ? ds.quitar : Number(ds.quitar));
      if (!o || !confirm(`¿Quitar el pedido #${o.numeroDia || o.id} de la ruta? Vuelve a "Por despachar".`)) return;
      const r = quitar(o.id); if (!r.ok) alert(r.error); return;
    }
    if (ds.periodo) { periodo = ds.periodo; pintarAbajo(); return; }
    if (t.hasAttribute('data-detalle')) { verDetalle = !verDetalle; pintarAbajo(); return; }
    if (t.hasAttribute('data-guardar-pagos')) {
      const p = {};
      document.querySelectorAll('[data-pago-zona]').forEach((i) => { if (i.value !== '') p[i.dataset.pagoZona] = Math.max(0, Math.round(Number(i.value) || 0)); });
      // Sur sin valor vuelve a lo de siempre ($6.000) solo si nunca se cambió; un vacío explícito = lo que paga el cliente
      zonas().forEach((z) => { if (p[z.k] == null && PAGO_DEF[z.k] != null) p[z.k] = ''; });
      SmashLS.setItem(K_PAGO, JSON.stringify(p));
      pintar();
      const ok = document.getElementById('dmPagoOk'); if (ok) ok.textContent = '✓ Guardado';
      publicarPronto(); return;
    }
    if (ds.editar) { editando = ds.editar; pintarAbajo(); const f = document.getElementById('dmForm'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    if (t.hasAttribute('data-cancelar-edit')) { editando = null; pintarAbajo(); return; }
    if (t.hasAttribute('data-copiar')) { try { navigator.clipboard.writeText(linkPagina()); t.textContent = '¡Copiado!'; } catch (err) { /* sin portapapeles */ } }
  }
  function alCambio(e) {
    const c = e.target.closest('[data-marcar]');
    if (!c) return;
    const id = isNaN(c.dataset.marcar) ? c.dataset.marcar : Number(c.dataset.marcar);
    marcados = c.checked ? marcados.concat([id]) : marcados.filter((x) => x !== id);
    const b = document.querySelector('[data-despachar]');
    if (b) { b.disabled = !marcados.length; b.textContent = (b.textContent.startsWith('Agregar') ? 'Agregar' : 'Despachar ruta') + (marcados.length ? ' (' + marcados.length + ')' : ''); }
  }

  /* ---------------- Arranque ---------------- */
  if (typeof SmashExt !== 'undefined') {
    ['setStatus', 'updateOrder'].forEach((fn) => {
      const antes = SmashExt[fn];
      if (antes) SmashExt[fn] = function () { const r = antes.apply(this, arguments); publicarPronto(); return r; };
    });
  }
  document.querySelectorAll('.nav-btn[data-section="domicilios"]').forEach((b) => b.addEventListener('click', () => { setTimeout(pintar, 0); cargarLista(); }));
  window.addEventListener('storage', (e) => { if (e.key === SmashDB.KEYS.ORDERS) publicarPronto(); if (e.key === K_PAGO) pintar(); });
  window.addEventListener('smash:domi-ubic', () => { if (visible() && !armando) pintarLado(); });
  cargarLista();
  setTimeout(publicar, 2500);
  setInterval(publicar, 15000);
  setInterval(traer, 8000);
  setTimeout(traer, 3000);
  setInterval(tic, 1000);
  // Se vuelve a dibujar cada 10 s, salvo mientras se arma una ruta o se escribe en un formulario
  setInterval(() => {
    const el = cont(), a = document.activeElement;
    const escribiendo = el && a && el.contains(a) && a.matches('input, textarea, select');
    if (visible() && !armando && !escribiendo) { pintarCabeza(); pintarLado(); }
  }, 10000);
  setInterval(cargarLista, 120000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { traer(); publicar(); } });

  return { activos, lista: () => lista, asignar, quitar, rutaActiva, pagoDomi, publicarPronto, tiemposHtml, traer, pintar };
})();
