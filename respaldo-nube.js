/* ============================================================
   SMASH · respaldo-nube.js (cocina y dueños)
   Respaldo automático de TODOS los datos del negocio en la nube
   (Supabase, tabla "respaldos"), para no perder nada si se borra
   el navegador o se daña el PC, y para poder cargarlos en otro
   equipo.
   - Cualquier equipo con la cuenta de caja o dueño conectada en
     "⭐ Clientes leales" sube solo una copia cuando hay cambios
     (revisa cada 5 minutos; como mucho una copia cada 10 minutos).
   - En el panel de dueños se ven los respaldos de todos los
     equipos, se revisa qué tiene cada uno y se puede cargar en
     este equipo.
   ============================================================ */
const SmashRespaldoNube = (function () {
  const N = typeof SmashNube !== 'undefined' ? SmashNube : null;
  const S = SmashStore, esc = SmashUI.esc, fmt = SmashUI.fmt;
  const ES_DUENO = !!document.querySelector('#section-config .bkn-root[data-dueno]');
  const LS_EST = 'nube_respaldo_estado', LS_EQ = 'nube_equipo';
  const CADA = 5 * 60 * 1000, MIN_ENTRE = 10 * 60 * 1000;
  // No cuentan como cambio (se mueven solo con entrar al panel)
  const SIN_HUELLA = /^smash_(auditoria|staff_lock|ultimo_respaldo)$/;

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio: no es grave */ } };
  const estado = () => lsGet(LS_EST, {});
  const equipo = () => lsGet(LS_EQ, '') || (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Celular' : 'PC') + ' · ' + (ES_DUENO ? 'dueños' : 'cocina');

  /* ---------------- Armar el respaldo ---------------- */
  function hash(t) { let h1 = 0x811c9dc5, h2 = 5381; for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = (Math.imul(h2, 33) + c) | 0; } return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36) + t.length.toString(36); }
  const parse = (v, d) => { try { return JSON.parse(v); } catch (e) { return d; } };
  function resumenDe(datos) {
    const arr = (k) => { const v = parse(datos[k] || 'null', null); return Array.isArray(v) ? v : []; };
    const ped = arr('smash_orders');
    const ult = ped.reduce((m, o) => (o.creado && o.creado > m ? o.creado : m), '');
    return {
      pedidos: ped.length, insumos: arr('smash_ingredientes').length, productos: arr('smash_products').length,
      gastos: arr('smash_gastos').filter((g) => !g.anulado).length, movInv: arr('smash_inv_movs').length, ultimoPedido: ult || null,
    };
  }
  function armar() {
    const b = S.exportAll();
    const firma = Object.keys(b.datos).filter((k) => !SIN_HUELLA.test(k)).sort().map((k) => k + '=' + b.datos[k]).join('\n');
    return { datos: JSON.stringify(b), huella: hash(firma), resumen: resumenDe(b.datos) };
  }

  /* ---------------- Subir ---------------- */
  let subiendo = false;
  async function subir(motivo, forzar) {
    if (!N || !N.ok) return { ok: false, error: 'sin conexión con la nube' };
    if (subiendo) return { ok: false, error: 'ya se está subiendo un respaldo' };
    const e = estado(), r = armar();
    if (!forzar && e.huella === r.huella) return { ok: true, igual: true };
    if (!forzar && e.en && Date.now() - new Date(e.en).getTime() < MIN_ENTRE) return { ok: true, espera: true };
    subiendo = true; pintar();
    try {
      const res = await N.subirRespaldo({ equipo: equipo(), motivo: motivo || 'auto', resumen: r.resumen, huella: r.huella, datos: r.datos });
      if (res.ok) lsSet(LS_EST, { huella: r.huella, en: res.creado || new Date().toISOString(), id: res.id, error: '' });
      else lsSet(LS_EST, Object.assign(e, { error: res.error, errorEn: new Date().toISOString() }));
      return res;
    } finally { subiendo = false; pintar(); }
  }
  async function revisar() { try { await subir('auto'); } catch (x) { /* se intenta en la próxima vuelta */ } }

  /* ---------------- Pantalla ---------------- */
  const root = document.querySelector('#section-config .bkn-root');
  const hace = (iso) => {
    if (!iso) return 'nunca';
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 1) return 'hace un momento'; if (m < 60) return 'hace ' + m + ' min';
    const h = Math.round(m / 60); if (h < 24) return 'hace ' + h + (h === 1 ? ' hora' : ' horas');
    return new Date(iso).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  };
  const fechaH = (iso) => new Date(iso).toLocaleString('es-CO', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  let lista = null, listaErr = '', cargando = false;

  if (root) {
    root.innerHTML = `
      <div class="bkn-card">
        <div class="bkn-head">
          <div class="bkn-ico">☁️</div>
          <div class="bkn-tit"><b>Respaldo en la nube</b><span id="bknSub"></span></div>
          <span class="bkn-pill" id="bknPill"></span>
        </div>
        <div class="bkn-row">
          <label class="bkn-eq">Nombre de este equipo<input id="bknEquipo" maxlength="60" placeholder="Ej: PC del negocio"></label>
          <div class="bkn-acts">
            <button type="button" class="btn-primary" id="bknSubir">☁️ Subir respaldo ahora</button>
            ${ES_DUENO ? '<button type="button" class="btn-secondary" id="bknVer">🔄 Ver respaldos en la nube</button>' : ''}
          </div>
        </div>
        <p class="bkn-msg" id="bknMsg" role="status"></p>
        ${ES_DUENO ? '<div id="bknLista"></div>' : ''}
      </div>`;
    const inp = root.querySelector('#bknEquipo');
    inp.value = lsGet(LS_EQ, '');
    inp.placeholder = equipo();
    inp.addEventListener('change', () => { lsSet(LS_EQ, inp.value.trim().slice(0, 60)); pintar(); });
    root.addEventListener('click', async (e) => {
      if (e.target.closest('#bknSubir')) {
        msg('Subiendo respaldo…');
        const r = await subir('manual', true);
        msg(r.ok ? '✓ Respaldo guardado en la nube.' : '⚠️ No se pudo subir: ' + r.error, !r.ok);
        if (r.ok && lista) cargarLista();
        return;
      }
      if (e.target.closest('#bknVer')) { cargarLista(); return; }
      const v = e.target.closest('[data-bkn-ver]'); if (v) { verRespaldo(+v.dataset.bknVer); return; }
      const c = e.target.closest('[data-bkn-cargar]'); if (c) { confirmarCarga(+c.dataset.bknCargar); }
    });
  }
  function msg(t, err) { const p = root && root.querySelector('#bknMsg'); if (p) { p.textContent = t; p.classList.toggle('err', !!err); } }

  function pintar() {
    if (!root) return;
    const e = estado(), pill = root.querySelector('#bknPill'), sub = root.querySelector('#bknSub');
    let k = 'ok', t = 'Activo';
    if (!N || !N.ok) { k = 'off'; t = 'Sin conexión'; }
    else if (subiendo) { k = 'run'; t = 'Subiendo…'; }
    else if (e.error && (!e.en || e.errorEn > e.en)) { k = 'err'; t = 'Revisar'; }
    else if (!e.en) { k = 'off'; t = 'Sin respaldos'; }
    pill.className = 'bkn-pill ' + k; pill.textContent = t;
    sub.textContent = !N || !N.ok ? 'Este equipo no está conectado a la nube.'
      : k === 'err' ? 'Último intento falló: ' + e.error
      : 'Se guarda solo cuando hay cambios. Último de este equipo: ' + hace(e.en) + '.';
    root.querySelector('#bknEquipo').placeholder = equipo();
    if (ES_DUENO) pintarLista();
  }

  async function cargarLista() {
    if (!N || !N.ok) { listaErr = 'Este equipo no está conectado a la nube.'; pintarLista(); return; }
    cargando = true; pintarLista();
    const r = await N.listarRespaldos(30);
    cargando = false;
    if (r.ok) { lista = r.lista; listaErr = ''; } else { listaErr = r.error; }
    pintarLista();
  }
  function chips(rs) {
    rs = rs || {};
    return `<span>📦 ${rs.pedidos || 0} pedidos</span><span>🥩 ${rs.insumos || 0} insumos</span><span>🍔 ${rs.productos || 0} productos</span><span>💸 ${rs.gastos || 0} gastos</span>`;
  }
  function pintarLista() {
    const box = root && root.querySelector('#bknLista'); if (!box) return;
    if (cargando) { box.innerHTML = '<p class="bkn-empty">Buscando respaldos…</p>'; return; }
    if (listaErr) { box.innerHTML = `<p class="bkn-empty err">⚠️ ${esc(listaErr)}</p>`; return; }
    if (!lista) { box.innerHTML = ''; return; }
    if (!lista.length) { box.innerHTML = '<p class="bkn-empty">Todavía no hay respaldos en la nube.</p>'; return; }
    box.innerHTML = `<div class="bkn-list">${lista.map((b, i) => `
      <div class="bkn-item">
        <div class="bkn-when"><b>${esc(fechaH(b.creado))}</b><small>${esc(b.equipo || 'Equipo sin nombre')}${b.por_nombre ? ' · ' + esc(b.por_nombre) : ''}${b.motivo !== 'auto' ? ' · ' + esc(b.motivo) : ''}</small></div>
        ${i === 0 ? '<span class="bkn-tag">Más reciente</span>' : ''}
        <div class="bkn-chips">${chips(b.resumen)}</div>
        <div class="bkn-item-acts"><button type="button" class="btn-sm" data-bkn-ver="${b.id}">Ver</button><button type="button" class="btn-sm" data-bkn-cargar="${b.id}">Cargar aquí</button></div>
      </div>`).join('')}</div>
      <p class="bkn-note">Se guardan los 30 más recientes y el último de cada día de los últimos 3 meses.</p>`;
  }

  async function traer(id) {
    const r = await N.leerRespaldo(id);
    if (!r.ok) throw new Error(r.error);
    const obj = parse(r.respaldo.datos, null);
    if (!obj || obj.app !== 'smash' || !obj.datos) throw new Error('El respaldo está dañado.');
    return { obj, meta: r.respaldo };
  }
  async function verRespaldo(id) {
    msg('Abriendo respaldo…');
    let R;
    try { R = await traer(id); } catch (x) { msg('⚠️ ' + x.message, true); return; }
    msg('');
    const d = R.obj.datos, arr = (k) => { const v = parse(d[k] || 'null', null); return Array.isArray(v) ? v : []; };
    const ped = arr('smash_orders').slice().sort((a, b) => String(b.creado).localeCompare(String(a.creado))).slice(0, 8);
    const ins = arr('smash_ingredientes');
    SmashUI.modal(`Respaldo del ${esc(fechaH(R.meta.creado))}`,
      `<p class="hint">Equipo: <b>${esc(R.meta.equipo || 'sin nombre')}</b>. Esto es solo para revisar: no cambia nada en este equipo.</p>
       <div class="bkn-chips" style="margin:8px 0 12px">${chips(resumenDe(d))}</div>
       <h4 class="bkn-h4">Últimos pedidos</h4>
       ${ped.length ? `<ul class="bkn-ul">${ped.map((o) => `<li><span>#${esc(o.numeroDia || o.id)} · ${esc(o.cliente || '')}</span><small>${esc(o.creado ? fechaH(o.creado) : '')}</small><b>${fmt(o.total || 0)}</b></li>`).join('')}</ul>` : '<p class="hint">Sin pedidos.</p>'}
       <h4 class="bkn-h4">Inventario (${ins.length} insumos)</h4>
       ${ins.length ? `<div class="bkn-tags">${ins.map((i) => `<span>${esc(i.nombre)}</span>`).join('')}</div>` : '<p class="hint">Sin insumos.</p>'}`,
      () => true, 'Cerrar');
  }
  function confirmarCarga(id) {
    const b = (lista || []).find((x) => x.id === id);
    SmashUI.modal('Cargar respaldo en este equipo',
      `<p>Los datos de este equipo se reemplazan por los del respaldo del <b>${esc(b ? fechaH(b.creado) : '')}</b>${b && b.equipo ? ` (${esc(b.equipo)})` : ''}.</p>
       ${b ? `<div class="bkn-chips" style="margin:8px 0">${chips(b.resumen)}</div>` : ''}
       <p class="hint">Antes de cargarlo, lo que hay ahora en este equipo se guarda en la nube como "antes de restaurar" (y si no se puede, se descarga como archivo). Así nada se pierde.</p>
       <p class="error" id="bknErr"></p>`,
      (m) => { cargar(id, m); return false; }, 'Cargar respaldo');
  }
  async function cargar(id, m) {
    const btn = m.querySelector('.sm-save'), err = m.querySelector('#bknErr');
    btn.disabled = true; btn.textContent = 'Cargando…';
    try {
      const R = await traer(id);
      const seguro = await subir('antes de restaurar', true);
      if (!seguro.ok) S.downloadBackup('respaldo_antes_de_cargar_');
      S.importAll(R.obj);
      lsSet(LS_EST, { huella: armar().huella, en: new Date().toISOString(), id: R.meta.id, error: '' });
      SmashUI.closeModal();
      msg('✓ Respaldo cargado. Recargando…');
      setTimeout(() => location.reload(), 900);
    } catch (x) {
      err.textContent = x.message; btn.disabled = false; btn.textContent = 'Cargar respaldo';
    }
  }

  /* ---------------- Arranque ---------------- */
  pintar();
  setTimeout(revisar, 20000);
  setInterval(revisar, CADA);
  setInterval(pintar, 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') revisar(); });
  if (N && N.alCambiar) N.alCambiar(() => { pintar(); });

  return { subir, armar, estado };
})();
