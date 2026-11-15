/* ============================================================
   SMASH · domicilios-nube.js  (paneles y página del domiciliario)
   Conexión con la nube para domiciliarios y entregas
   (supabase/domiciliarios.sql).
   - Paneles: usan la sesión de nube del panel (token "nube_panel").
   - Domiciliario: usa su propia sesión (token "domi_sesion").
   - En localhost (copia de prueba) todo se simula en este navegador,
     así se puede probar sin tocar la nube real.
   ============================================================ */
const SmashDomiNube = (function () {
  const URL_NUBE = 'https://boatydzqlrtgxzptpehb.supabase.co';
  const CLAVE_PUBLICA = 'sb_publishable_42zIQuywLHMa4T3loUPQGA_ziFXnU0G';
  const PRUEBA = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const LS_DOMI = 'domi_sesion';
  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } };
  const tokPanel = () => { const s = lsGet('nube_panel', null); return s && s.token; };
  const sesion = () => lsGet(LS_DOMI, null);
  const tokDomi = () => { const s = sesion(); return s && s.token; };

  let sb = null;
  if (!PRUEBA && typeof supabase !== 'undefined' && supabase.createClient) {
    try { sb = supabase.createClient(URL_NUBE, CLAVE_PUBLICA, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'smash-domi' } }); } catch (e) { sb = null; }
  }
  const errTxt = (e) => {
    const m = String((e && e.message) || e || '');
    if (/fetch|network|Failed/i.test(m)) return 'Sin conexión. Revisa el internet e intenta de nuevo.';
    if (/domi_|panel_.*entregas|panel_domiciliarios|schema cache/i.test(m)) return 'Falta ejecutar supabase/domiciliarios.sql en Supabase.';
    return m || 'No se pudo completar.';
  };
  async function rpc(fn, args) {
    if (PRUEBA) return SIM[fn](args);
    if (!sb) return { ok: false, error: 'Sin conexión con la nube.' };
    try {
      const { data, error } = await sb.rpc(fn, args);
      if (error) return { ok: false, error: errTxt(error), falta: /schema cache|does not exist/i.test(error.message || '') };
      return data || { ok: true };
    } catch (e) { return { ok: false, error: errTxt(e) }; }
  }

  /* ---------------- Paneles ---------------- */
  const panel = {
    listo: () => !!(PRUEBA || (sb && tokPanel())),
    listar: () => rpc('panel_domiciliarios', { p_token: tokPanel() }),
    guardar: (p) => rpc('panel_guardar_domiciliario', { p_token: tokPanel(), p }),
    publicar: (lista) => rpc('panel_publicar_entregas', { p_token: tokPanel(), p_lista: lista }),
    cambios: (desde) => rpc('panel_entregas', { p_token: tokPanel(), p_desde: desde || null }),
    ubicaciones: () => rpc('panel_ubicaciones', { p_token: tokPanel() }),
  };

  /* ---------------- Domiciliario ---------------- */
  const domi = {
    sesion,
    async entrar(usuario, clave) {
      const r = await rpc('domi_entrar', { p_usuario: String(usuario || ''), p_clave: String(clave || '') });
      if (r && r.ok) lsSet(LS_DOMI, { token: r.token, nombre: r.nombre, usuario: r.usuario, en: new Date().toISOString() });
      return r;
    },
    async salir() { const t = tokDomi(); lsSet(LS_DOMI, null); if (t) await rpc('domi_salir', { p_token: t }); },
    async mias() {
      const r = await rpc('domi_mis_entregas', { p_token: tokDomi() });
      if (r && !r.ok && r.error === 'sesion') lsSet(LS_DOMI, null);
      return r;
    },
    estado: (pedido, estado) => rpc('domi_estado', { p_token: tokDomi(), p_pedido: String(pedido), p_estado: estado }),
    // p: {lat, lng, precision, rumbo, velocidad}
    ubicar: (p) => rpc('domi_ubicar', { p_token: tokDomi(), p_lat: p.lat, p_lng: p.lng, p_precision: p.precision ?? null, p_rumbo: p.rumbo ?? null, p_velocidad: p.velocidad ?? null, p_fondo: false }),
    // Avisa que salió de la página / apagó la pantalla (el navegador deja de dar la ubicación)
    fondo: () => rpc('domi_ubicar', { p_token: tokDomi(), p_lat: 0, p_lng: 0, p_fondo: true }),
    ocultar: () => rpc('domi_ocultar', { p_token: tokDomi() }),
    cuentas: () => rpc('domi_cuentas', { p_token: tokDomi() }),
  };

  /* ============================================================
     SIMULADOR (solo localhost): las mismas respuestas que el SQL,
     guardadas en localStorage para que paneles y página del
     domiciliario se vean entre pestañas del mismo navegador.
     ============================================================ */
  const SK = 'domi_simulador';
  const db = () => lsGet(SK, { domis: [], ses: {}, ent: {} });
  const save = (d) => lsSet(SK, d);
  const now = () => new Date().toISOString();
  const rango = (e) => ({ asignado: 1, en_camino: 2, entregado: 3 })[e] || 0;
  const rid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
  const domiDe = (d, t) => { const s = d.ses[t]; const x = s && d.domis.find((z) => z.id === s); return x && x.activo ? x : null; };
  const SIM = {
    panel_domiciliarios: () => ({ ok: true, lista: db().domis.map(({ id, nombre, usuario, telefono, activo }) => ({ id, nombre, usuario, telefono, activo })) }),
    panel_guardar_domiciliario({ p }) {
      const d = db(), u = String(p.usuario || '').trim().toLowerCase(), n = String(p.nombre || '').trim(), cl = String(p.clave || '');
      if (n.length < 3) return { ok: false, error: 'Escribe el nombre del domiciliario.' };
      if (!/^[a-z0-9._-]{3,30}$/.test(u)) return { ok: false, error: 'El usuario debe tener de 3 a 30 letras o números, sin espacios.' };
      if (cl && cl.length < 6) return { ok: false, error: 'La clave debe tener al menos 6 caracteres.' };
      if (d.domis.some((x) => x.usuario === u && x.id !== p.id)) return { ok: false, error: 'Ese usuario ya existe. Elige otro.' };
      let x = p.id && d.domis.find((z) => z.id === p.id);
      if (!x) { if (!cl) return { ok: false, error: 'Ponle una clave.' }; x = { id: rid(), activo: true }; d.domis.push(x); }
      Object.assign(x, { nombre: n, usuario: u, telefono: String(p.telefono || '').slice(0, 20), activo: p.activo !== false });
      if (cl) { x.clave = cl; Object.keys(d.ses).forEach((t) => { if (d.ses[t] === x.id) delete d.ses[t]; }); }
      save(d); return { ok: true, id: x.id };
    },
    panel_publicar_entregas({ p_lista }) {
      const d = db(); let n = 0;
      (p_lista || []).forEach((x) => {
        const v = d.ent[x.pedido], est = x.estado || 'asignado';
        if (!v) { d.ent[x.pedido] = Object.assign({}, x, { estado: est, asignado_en: x.asignado_en || now(), por: 'panel', actualizado: now() }); n++; return; }
        const nv = Object.assign({}, v, x);
        if (v.domiciliario !== x.domiciliario || est === 'cancelado' || v.estado === 'cancelado') { nv.estado = est; nv.asignado_en = x.asignado_en || now(); nv.salio_en = x.salio_en || null; nv.entregado_en = x.entregado_en || null; }
        else { nv.estado = rango(est) > rango(v.estado) ? est : v.estado; nv.asignado_en = v.asignado_en; nv.salio_en = v.salio_en || x.salio_en || null; nv.entregado_en = v.entregado_en || x.entregado_en || null; }
        if (nv.estado === 'entregado' && !nv.entregado_en) nv.entregado_en = now();
        if ((nv.estado === 'en_camino' || nv.estado === 'entregado') && !nv.salio_en) nv.salio_en = nv.entregado_en || now();
        const firma = (o) => JSON.stringify([o.estado, o.domiciliario, o.asignado_en, o.salio_en, o.entregado_en, o.cliente, o.direccion, o.items, o.cobrar, o.notas, o.ruta, o.ruta_en, o.pago_domi, o.dia]);
        if (firma(nv) !== firma(v)) { nv.por = 'panel'; nv.actualizado = now(); d.ent[x.pedido] = nv; n++; }
      });
      save(d); return { ok: true, cambiados: n };
    },
    panel_entregas({ p_desde }) {
      const desde = p_desde || new Date(Date.now() - 2 * 864e5).toISOString();
      return { ok: true, ahora: now(), lista: Object.values(db().ent).filter((e) => e.actualizado > desde).sort((a, b) => (a.actualizado > b.actualizado ? 1 : -1)) };
    },
    domi_entrar({ p_usuario, p_clave }) {
      const d = db(), x = d.domis.find((z) => z.usuario === String(p_usuario).trim().toLowerCase());
      if (!x || x.clave !== p_clave) return { ok: false, error: 'Usuario o clave incorrectos.' };
      if (!x.activo) return { ok: false, error: 'Tu cuenta está desactivada. Habla con el negocio.' };
      const t = rid(); d.ses[t] = x.id; save(d);
      return { ok: true, token: t, nombre: x.nombre, usuario: x.usuario };
    },
    domi_salir({ p_token }) { const d = db(), x = domiDe(d, p_token); if (x && d.ubi) delete d.ubi[x.id]; delete d.ses[p_token]; save(d); return { ok: true }; },
    domi_cuentas({ p_token }) {
      const d = db(), x = domiDe(d, p_token);
      if (!x) return { ok: false, error: 'sesion' };
      const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
      const h = new Date(hoy + 'T12:00:00'), lun = new Date(h); lun.setDate(h.getDate() - ((h.getDay() + 6) % 7));
      const semana = lun.toISOString().slice(0, 10), mes = hoy.slice(0, 8) + '01';
      const mias = Object.values(d.ent).filter((e) => e.domiciliario === x.id && e.estado === 'entregado' && e.dia);
      const suma = (f) => { const l = mias.filter(f); return { n: l.length, pago: l.reduce((s, e) => s + (Number(e.pago_domi) || 0), 0) }; };
      const dias = {};
      mias.forEach((e) => { const z = dias[e.dia] || (dias[e.dia] = { dia: e.dia, n: 0, pago: 0 }); z.n++; z.pago += Number(e.pago_domi) || 0; });
      return { ok: true, hoy_dia: hoy, hoy: suma((e) => e.dia === hoy), semana: suma((e) => e.dia >= semana && e.dia <= hoy), mes: suma((e) => e.dia >= mes && e.dia <= hoy),
        dias: Object.values(dias).sort((a, b) => (a.dia < b.dia ? 1 : -1)) };
    },
    domi_ubicar({ p_token, p_lat, p_lng, p_precision, p_rumbo, p_velocidad, p_fondo }) {
      const d = db(), x = domiDe(d, p_token);
      if (!x) return { ok: false, error: 'sesion' };
      d.ubi = d.ubi || {};
      if (p_fondo) { if (d.ubi[x.id]) { d.ubi[x.id].fondo = true; save(d); } return { ok: true }; }
      const u = d.ubi[x.id], t = Date.now();
      const rastro = (u && t - new Date(u.en).getTime() < 2 * 36e5 ? u.rastro : []).concat([[+p_lat.toFixed(6), +p_lng.toFixed(6), Math.floor(t / 1000)]]).slice(-40);
      d.ubi[x.id] = { lat: p_lat, lng: p_lng, precision: p_precision, rumbo: p_rumbo, velocidad: p_velocidad, rastro, en: now(), fondo: false };
      save(d); return { ok: true };
    },
    domi_ocultar({ p_token }) { const d = db(), x = domiDe(d, p_token); if (x && d.ubi) { delete d.ubi[x.id]; save(d); } return { ok: true }; },
    panel_ubicaciones() {
      const d = db(), lim = Date.now() - 3 * 36e5;
      return { ok: true, ahora: now(), lista: Object.keys(d.ubi || {}).filter((id) => new Date(d.ubi[id].en).getTime() > lim).map((id) => {
        const x = d.domis.find((z) => z.id === id) || {};
        return Object.assign({ domiciliario: id, nombre: x.nombre || '' }, d.ubi[id], {
          pedidos: Object.values(d.ent).filter((e) => e.domiciliario === id && ['asignado', 'en_camino'].includes(e.estado))
            .map((e) => ({ pedido: e.pedido, numero: e.numero, cliente: e.cliente, zona: e.zona, direccion: e.direccion, estado: e.estado, asignado_en: e.asignado_en, salio_en: e.salio_en })),
        });
      }) };
    },
    domi_mis_entregas({ p_token }) {
      const d = db(), x = domiDe(d, p_token);
      if (!x) return { ok: false, error: 'sesion' };
      const lim = Date.now() - 18 * 36e5;
      return { ok: true, nombre: x.nombre, ahora: now(), lista: Object.values(d.ent).filter((e) => e.domiciliario === x.id && (['asignado', 'en_camino'].includes(e.estado) || (e.estado === 'entregado' && new Date(e.entregado_en).getTime() > lim))).sort((a, b) => (a.asignado_en > b.asignado_en ? 1 : -1)) };
    },
    domi_estado({ p_token, p_pedido, p_estado }) {
      const d = db(), x = domiDe(d, p_token);
      if (!x) return { ok: false, error: 'sesion' };
      const v = d.ent[p_pedido];
      if (!v || v.domiciliario !== x.id) return { ok: false, error: 'Este pedido ya no está asignado a ti.' };
      if (v.estado === 'cancelado') return { ok: false, error: 'Este pedido fue cancelado.' };
      if (rango(p_estado) <= rango(v.estado)) return { ok: true, entrega: v };
      v.estado = p_estado; v.salio_en = v.salio_en || now();
      if (p_estado === 'entregado') v.entregado_en = v.entregado_en || now();
      v.por = 'domiciliario'; v.actualizado = now(); save(d);
      return { ok: true, entrega: v };
    },
  };

  return { PRUEBA, panel, domi };
})();
