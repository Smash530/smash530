/* ============================================================
   SMASH · nube.js
   Conexión con Supabase (base de datos en la nube) para las
   cuentas de clientes leales, sus puntos y las promociones.
   - Las tablas y reglas de seguridad están en supabase/esquema.sql.
   - La clave de aquí es la PÚBLICA (publishable): está hecha para ir
     en la página. Lo que cada cuenta puede ver o cambiar lo decide
     la base de datos según su rol (cliente, caja o dueño).
   - Las contraseñas las guarda Supabase cifradas; nunca pasan por
     nuestros datos locales.
   - Si no hay internet o la librería no carga, la página sigue
     funcionando sin cuentas (SmashNube.ok === false).
   ============================================================ */
const SmashNube = (function () {
  const URL_NUBE = 'https://boatydzqlrtgxzptpehb.supabase.co';
  const CLAVE_PUBLICA = 'sb_publishable_42zIQuywLHMa4T3loUPQGA_ziFXnU0G';
  const ok = typeof supabase !== 'undefined' && !!supabase.createClient;
  const sb = ok ? supabase.createClient(URL_NUBE, CLAVE_PUBLICA, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'smash-nube-sesion' } }) : null;

  let perfilCache = null;
  const oyentes = [];
  const avisar = () => oyentes.forEach((f) => { try { f(perfilCache); } catch (e) { console.warn(e); } });
  function sinNube() { return Promise.resolve({ ok: false, error: 'No hay conexión con el sistema de cuentas. Revisa tu internet e intenta de nuevo.' }); }

  // Mensajes de Supabase traducidos a algo que el cliente entienda
  function errorTxt(e) {
    const m = String((e && (e.message || e.error_description)) || e || '');
    if (/invalid login credentials/i.test(m)) return 'Correo o contraseña incorrectos.';
    if (/already registered|already been registered|user_already_exists/i.test(m)) return 'Ese correo ya tiene una cuenta. Inicia sesión.';
    if (/email not confirmed/i.test(m)) return 'Tu correo aún no está confirmado. Revisa tu bandeja de entrada.';
    if (/password.*(at least|short|characters)/i.test(m)) return 'La contraseña debe tener al menos 8 caracteres.';
    if (/rate limit|too many/i.test(m)) return 'Demasiados intentos. Espera un momento e intenta de nuevo.';
    if (/database error saving new user/i.test(m)) return 'Ese usuario ya está en uso. Elige otro.';
    if (/failed to fetch|network/i.test(m)) return 'Sin conexión. Revisa tu internet e intenta de nuevo.';
    if (/sin permiso|solo los dueños|permission denied|row-level security/i.test(m)) return 'Tu cuenta no tiene permiso para esto.';
    if (/duplicate key.*puntos_mov_un_pedido/i.test(m)) return 'Los puntos de este pedido ya se habían sumado.';
    if (/column.*dias|dias.*column|schema cache/i.test(m)) return 'Falta preparar la base para los días de la semana: ejecuta supabase/promos-por-dia.sql en el SQL Editor de Supabase.';
    return m || 'Algo salió mal. Intenta de nuevo.';
  }
  const limpioTel = (t) => String(t || '').replace(/\D/g, '').slice(-15);

  /* ---------------- Sesión ---------------- */
  async function perfil(forzar) {
    if (!ok) return null;
    if (perfilCache && !forzar) return perfilCache;
    const { data: s } = await sb.auth.getSession();
    if (!s || !s.session) { perfilCache = null; return null; }
    const { data, error } = await sb.from('perfiles').select('*').eq('id', s.session.user.id).maybeSingle();
    perfilCache = error ? null : data;
    return perfilCache;
  }
  function alCambiar(f) { oyentes.push(f); }
  // Al abrir el enlace de "Olvidé mi contraseña" llega este evento: la página pide la clave nueva
  let alRecuperar = null;
  const enRecuperacion = (f) => { alRecuperar = f; };
  if (ok) sb.auth.onAuthStateChange((ev) => {
    if (ev === 'PASSWORD_RECOVERY' && alRecuperar) setTimeout(alRecuperar, 0);
    if (ev === 'SIGNED_OUT') { perfilCache = null; avisar(); }
    else if (ev === 'SIGNED_IN' || ev === 'USER_UPDATED') setTimeout(() => perfil(true).then(avisar), 0);
  });

  async function usuarioLibre(u) {
    if (!ok) return true;
    const { data, error } = await sb.rpc('usuario_libre', { u });
    return error ? true : !!data;
  }
  async function registrar(d) {
    if (!ok) return sinNube();
    const usuario = String(d.usuario || '').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { ok: false, error: 'El usuario debe tener de 3 a 30 letras o números, sin espacios.' };
    if (String(d.nombre || '').trim().length < 3) return { ok: false, error: 'Escribe tu nombre.' };
    if (limpioTel(d.telefono).length < 10) return { ok: false, error: 'Escribe un teléfono válido (10 dígitos).' };
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.correo || '').trim())) return { ok: false, error: 'Escribe un correo válido.' };
    if (String(d.direccion || '').trim().length < 5) return { ok: false, error: 'Escribe tu dirección de entrega.' };
    if (String(d.clave || '').length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
    if (d.clave !== d.clave2) return { ok: false, error: 'Las contraseñas no coinciden.' };
    if (!(await usuarioLibre(usuario))) return { ok: false, error: 'Ese usuario ya está en uso. Elige otro.' };
    try {
      const { data, error } = await sb.auth.signUp({
        email: String(d.correo).trim().toLowerCase(), password: d.clave,
        options: { data: { usuario, nombre: String(d.nombre).trim(), telefono: limpioTel(d.telefono), telefono2: limpioTel(d.telefono2), direccion: String(d.direccion).trim() } },
      });
      if (error) return { ok: false, error: errorTxt(error) };
      // Si en Supabase quedó activado "Confirm email", la cuenta existe pero aún no hay sesión
      if (!data.session) return { ok: true, confirmar: true };
      return { ok: true, perfil: await perfil(true) };
    } catch (e) { return { ok: false, error: errorTxt(e) }; }
  }
  async function entrar(correo, clave) {
    if (!ok) return sinNube();
    try {
      const { error } = await sb.auth.signInWithPassword({ email: String(correo || '').trim().toLowerCase(), password: String(clave || '') });
      if (error) return { ok: false, error: errorTxt(error) };
      const p = await perfil(true);
      if (!p) return { ok: false, error: 'La cuenta existe pero no tiene perfil. Escríbenos por WhatsApp.' };
      return { ok: true, perfil: p };
    } catch (e) { return { ok: false, error: errorTxt(e) }; }
  }
  async function salir() { if (ok) await sb.auth.signOut(); perfilCache = null; avisar(); }
  async function recuperarClave(correo) {
    if (!ok) return sinNube();
    const { error } = await sb.auth.resetPasswordForEmail(String(correo || '').trim().toLowerCase(), { redirectTo: location.origin + location.pathname });
    return error ? { ok: false, error: errorTxt(error) } : { ok: true };
  }
  async function nuevaClave(clave) {
    if (!ok) return sinNube();
    if (String(clave || '').length < 8) return { ok: false, error: 'La contraseña debe tener al menos 8 caracteres.' };
    const { error } = await sb.auth.updateUser({ password: clave });
    return error ? { ok: false, error: errorTxt(error) } : { ok: true };
  }
  async function guardarPerfil(campos) {
    const p = await perfil();
    if (!p) return { ok: false, error: 'Inicia sesión de nuevo.' };
    const f = {};
    if (campos.nombre != null) f.nombre = String(campos.nombre).trim().slice(0, 80);
    if (campos.telefono != null) f.telefono = limpioTel(campos.telefono);
    if (campos.telefono2 != null) f.telefono2 = limpioTel(campos.telefono2);
    if (campos.direccion != null) f.direccion = String(campos.direccion).trim().slice(0, 200);
    const { error } = await sb.from('perfiles').update(f).eq('id', p.id);
    if (error) return { ok: false, error: errorTxt(error) };
    return { ok: true, perfil: await perfil(true) };
  }

  /* ---------------- Promociones ---------------- */
  // Para clientes: solo las vigentes (la base no muestra las demás). Para dueños: todas.
  async function promociones(todas) {
    if (!ok) return [];
    let q = sb.from('promociones').select('*').order('creado', { ascending: false });
    if (!todas) q = q.eq('activa', true);
    const { data, error } = await q;
    return error ? [] : data || [];
  }
  async function guardarPromo(d) {
    if (!ok) return sinNube();
    const f = {
      titulo: String(d.titulo || '').trim().slice(0, 80), descripcion: String(d.descripcion || '').trim().slice(0, 300),
      tipo: d.tipo, producto: d.producto || '', valor: Math.max(0, Number(d.valor) || 0),
      desde: d.desde, hasta: d.hasta, activa: d.activa !== false,
      dias: leerDias(d.dias),
    };
    if (!f.titulo) return { ok: false, error: 'Ponle un nombre a la promoción.' };
    if (!['porcentaje', 'valor', 'precio', 'incentivo'].includes(f.tipo)) return { ok: false, error: 'Elige el tipo de promoción.' };
    if (f.tipo === 'porcentaje' && (f.valor <= 0 || f.valor > 100)) return { ok: false, error: 'El porcentaje debe estar entre 1 y 100.' };
    if ((f.tipo === 'valor' || f.tipo === 'precio') && f.valor <= 0) return { ok: false, error: 'Escribe el valor en pesos.' };
    if (f.tipo === 'precio' && !f.producto) return { ok: false, error: 'El precio especial necesita un producto.' };
    if (!f.desde || !f.hasta || f.hasta < f.desde) return { ok: false, error: 'Revisa las fechas: "hasta" debe ser igual o posterior a "desde".' };
    const r = d.id ? await sb.from('promociones').update(f).eq('id', d.id) : await sb.from('promociones').insert(f);
    return r.error ? { ok: false, error: errorTxt(r.error) } : { ok: true };
  }
  async function activarPromo(id, activa) {
    const { error } = await sb.from('promociones').update({ activa }).eq('id', id);
    return error ? { ok: false, error: errorTxt(error) } : { ok: true };
  }
  async function borrarPromo(id) {
    const { error } = await sb.from('promociones').delete().eq('id', id);
    return error ? { ok: false, error: errorTxt(error) } : { ok: true };
  }

  const hoyCO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
  // Día de la semana en Colombia: 0 = domingo … 6 = sábado
  const diaCO = () => new Date(hoyCO() + 'T12:00:00Z').getUTCDay();
  const DIAS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
  // Vacío = todos los días
  const leerDias = (v) => [...new Set((Array.isArray(v) ? v : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const tocaHoy = (p) => { const d = leerDias(p.dias); return !d.length || d.includes(diaCO()); };
  // "Todos los días" · "Los martes" · "Lunes, miércoles y viernes"
  function textoDias(p) {
    const d = leerDias(p.dias);
    if (!d.length || d.length === 7) return 'Todos los días';
    if (d.length === 1) return 'Los ' + DIAS[d[0]].toLowerCase() + (d[0] === 0 || d[0] === 6 ? 's' : '');
    const n = d.slice().sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((i) => DIAS[i].toLowerCase());
    return (n.slice(0, -1).join(', ') + ' y ' + n[n.length - 1]).replace(/^./, (c) => c.toUpperCase());
  }
  const vigente = (p) => p.activa && p.desde <= hoyCO() && hoyCO() <= p.hasta && tocaHoy(p);

  /* Descuento de las promociones sobre un pedido.
     - Con producto: se aplica a cada unidad de ese producto (si hay varias, la mejor).
     - Sin producto (todo el pedido): % o valor sobre el resto del subtotal (la mejor).
     - "Incentivo" no descuenta: es un beneficio que se muestra al cliente. */
  function aplicarPromos(items, promos) {
    const vig = (promos || []).filter(vigente), porId = {};
    let subtotal = 0;
    (items || []).forEach((it) => { subtotal += it.price * it.qty; const x = porId[it.id] = porId[it.id] || { qty: 0, price: it.price }; x.qty += it.qty; });
    const usadas = [], mejor = {};
    vig.filter((p) => p.producto && porId[p.producto]).forEach((p) => {
      const x = porId[p.producto], u = p.tipo === 'porcentaje' ? x.price * p.valor / 100 : p.tipo === 'valor' ? Math.min(p.valor, x.price) : p.tipo === 'precio' ? Math.max(0, x.price - p.valor) : 0;
      const v = Math.round(u * x.qty);
      if (v > 0 && (!mejor[p.producto] || v > mejor[p.producto].v)) mejor[p.producto] = { v, p };
    });
    let desc = 0;
    Object.keys(mejor).forEach((k) => { desc += mejor[k].v; usadas.push({ titulo: mejor[k].p.titulo, valor: mejor[k].v }); });
    let gen = null;
    vig.filter((p) => !p.producto && (p.tipo === 'porcentaje' || p.tipo === 'valor')).forEach((p) => {
      const resto = subtotal - desc, v = Math.round(p.tipo === 'porcentaje' ? resto * p.valor / 100 : Math.min(p.valor, resto));
      if (v > 0 && (!gen || v > gen.v)) gen = { v, p };
    });
    if (gen) { desc += gen.v; usadas.push({ titulo: gen.p.titulo, valor: gen.v }); }
    return { descuento: Math.min(desc, subtotal), usadas, incentivos: vig.filter((p) => p.tipo === 'incentivo'), porProducto: mejor };
  }

  /* Puntos de un pedido: burger 10 · burger en combo 15 (el combo suma 5 más) ·
     papas 2 · gaseosa 2 · salsa 1. Los demás adicionales no suman. */
  const REGLAS = { hamburguesa: 10, combo: 5, papas: 2, gaseosa: 2, salsa: 1 };
  function tipoPunto(it, prod) {
    const cat = it.cat || (prod && prod.categoria) || '', n = (it.name + ' ' + it.id).toLowerCase();
    if (cat === 'hamburguesa') return 'hamburguesa';
    if (cat === 'combo') return 'combo';
    if (/papa/.test(n)) return 'papas';
    if (/gaseosa|coca|pepsi|postob|soda/.test(n) || (prod && prod.sabores && prod.sabores.length)) return 'gaseosa';
    if (/salsa/.test(n)) return 'salsa';
    return '';
  }
  function puntosPedido(items, buscarProd) {
    return (items || []).reduce((s, it) => s + (REGLAS[tipoPunto(it, buscarProd ? buscarProd(it.id) : null)] || 0) * it.qty, 0);
  }

  /* ---------------- Caja y dueños ---------------- */
  async function clientes() {
    if (!ok) return { ok: false, error: 'Sin conexión con la nube.' };
    const { data, error } = await sb.from('perfiles').select('*').order('creado', { ascending: false });
    return error ? { ok: false, error: errorTxt(error) } : { ok: true, lista: data || [] };
  }
  async function movimientos(id) {
    const { data, error } = await sb.from('puntos_mov').select('*').eq('cliente', id).order('creado', { ascending: false }).limit(100);
    return error ? [] : data || [];
  }
  async function sumarPuntos(id, puntos, motivo, pedido) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('sumar_puntos', { p_cliente: id, p_puntos: Math.round(puntos), p_motivo: motivo || '', p_pedido: pedido || '' });
    return error ? { ok: false, error: errorTxt(error) } : { ok: true, total: data };
  }
  async function cambiarRol(id, rol) {
    const { error } = await sb.rpc('cambiar_rol', { p_id: id, p_rol: rol });
    return error ? { ok: false, error: errorTxt(error) } : { ok: true };
  }
  async function buscarPorCorreo(correo) {
    const { data, error } = await sb.from('perfiles').select('*').eq('correo', String(correo || '').trim().toLowerCase()).maybeSingle();
    return error ? null : data;
  }


  /* ---------------- Pedidos web en tiempo real ----------------
     La página de clientes deja cada pedido en la tabla pedidos_web
     (supabase/pedidos-en-linea.sql). Caja y dueños los reciben al
     instante y se guardan solos en el panel, listos para la comanda. */
  // keepalive: el envío termina aunque el celular salte a WhatsApp
  async function enviarPedido(ref, datos) {
    let token = CLAVE_PUBLICA;
    try { if (ok) { const { data: s } = await sb.auth.getSession(); if (s && s.session) token = s.session.access_token; } } catch (e) {}
    const r = await fetch(URL_NUBE + '/rest/v1/pedidos_web', {
      method: 'POST', keepalive: true,
      headers: { apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ref, datos }),
    });
    if (r.ok || r.status === 409) return { ok: true };   // 409: ya estaba (se envió dos veces)
    let m = ''; try { m = (await r.json()).message; } catch (e) {}
    return { ok: false, error: m || 'HTTP ' + r.status };
  }
  // Para caja y dueños: entrega cada pedido nuevo a alPedido(fila). Devuelve una función para detener.
  function recibirPedidos(alPedido, alEstado) {
    if (!ok) { if (alEstado) alEstado('sin-nube'); return () => {}; }
    // al volver a la pestaña o al recuperar internet se revisa de inmediato
    const alVolver = () => { if (document.visibilityState !== 'hidden') revisar(); };
    let canal = null, reloj = null, activo = true;
    const estado = (e, info) => { if (alEstado) try { alEstado(e, info); } catch (x) {} };
    const entregar = (f) => { if (f && f.ref && f.datos) try { alPedido(f); } catch (e) { console.warn(e); } };
    async function revisar() {
      const desde = new Date(Date.now() - 36 * 3600 * 1000).toISOString();
      const { data, error } = await sb.from('pedidos_web').select('*').gte('creado', desde).order('creado', { ascending: true });
      if (error) { estado(/does not exist|schema cache/i.test(error.message) ? 'sin-tabla' : 'error', { error: error.message }); return; }
      (data || []).forEach(entregar);
      estado('revisado', { total: (data || []).length, hora: new Date() });
    }
    async function arrancar() {
      const p = await perfil(true);
      if (!activo) return;
      if (!p || (p.rol !== 'caja' && p.rol !== 'dueno')) { estado('sin-sesion'); return; }
      await revisar();
      canal = sb.channel('pedidos-web-' + Date.now())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'pedidos_web' }, (m) => entregar(m.new))
        .subscribe((s) => estado(s === 'SUBSCRIBED' ? 'en-vivo' : s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' ? 'respaldo' : 'conectando'));
      reloj = setInterval(revisar, 15000);   // respaldo por si se cae la conexión en vivo
      document.addEventListener('visibilitychange', alVolver); window.addEventListener('online', alVolver);
    }
    arrancar();
    return () => { activo = false; if (reloj) clearInterval(reloj); if (canal) sb.removeChannel(canal); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('online', alVolver); };
  }
  async function marcarRecibido(ref) {
    if (!ok) return;
    await sb.from('pedidos_web').update({ recibido: new Date().toISOString() }).eq('ref', ref).is('recibido', null);
  }
  return {
    ok, perfil, alCambiar, enRecuperacion, registrar, entrar, salir, recuperarClave, nuevaClave, guardarPerfil, usuarioLibre,
    promociones, guardarPromo, activarPromo, borrarPromo, aplicarPromos, vigente, hoyCO, diaCO, tocaHoy, textoDias, DIAS,
    puntosPedido, REGLAS, clientes, movimientos, sumarPuntos, cambiarRol, buscarPorCorreo,
    enviarPedido, recibirPedidos, marcarRecibido,
  };
})();
