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
    // Límite de correos del proyecto en Supabase (no es culpa del cliente): se dice tal cual
    if (/email rate limit|over_email_send_rate_limit/i.test(m)) return 'En este momento no podemos enviar el correo de confirmación porque hay muchos registros. Intenta de nuevo en un rato o escríbenos por WhatsApp y te ayudamos.';
    if (/for security purposes.*after (\d+) seconds/i.test(m)) return 'Espera ' + m.match(/after (\d+) seconds/i)[1] + ' segundos e intenta de nuevo.';
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
  // Token de la sesión a la mano: el pedido web sale al instante, sin esperar a leerlo
  let tokenSesion = null;
  if (ok) sb.auth.onAuthStateChange((ev, s) => {
    tokenSesion = s && s.access_token ? s.access_token : null;
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
        options: { data: { usuario, nombre: String(d.nombre).trim(), telefono: limpioTel(d.telefono), telefono2: limpioTel(d.telefono2), direccion: String(d.direccion).trim(), acepta_promos: d.acepta_promos === true } },
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
    // Casilla "Quiero recibir promos": solo se envía si cambió (supabase/avisos-promos.sql)
    if (campos.acepta_promos != null && !!campos.acepta_promos !== !!p.acepta_promos) f.acepta_promos = !!campos.acepta_promos;
    const { error } = await sb.from('perfiles').update(f).eq('id', p.id);
    if (error) return { ok: false, error: /acepta_promos/.test(error.message || '') ? 'Aún no podemos guardar esa opción. Intenta más tarde.' : errorTxt(error) };
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
  // Promos activas de los próximos 7 días, para todos (supabase/promos-semana.sql).
  // Si esa función aún no existe y hay sesión, se usan las promociones normales.
  async function promosSemana() {
    if (!ok) return [];
    const { data, error } = await sb.rpc('promos_semana');
    if (!error && Array.isArray(data)) return data;
    const l = await promociones();
    return Array.isArray(l) ? l : [];
  }
  async function guardarPromo(d) {
    if (!ok) return sinNube();
    const f = {
      titulo: String(d.titulo || '').trim().slice(0, 80), descripcion: String(d.descripcion || '').trim().slice(0, 300),
      tipo: d.tipo, producto: listaIds(d.producto).join(','), valor: Math.max(0, Number(d.valor) || 0),
      desde: d.desde, hasta: d.hasta, activa: d.activa !== false,
      dias: leerDias(d.dias),
    };
    if (!f.titulo) return { ok: false, error: 'Ponle un nombre a la promoción.' };
    if (!['porcentaje', 'valor', 'precio', 'incentivo', 'regalo', 'paquete'].includes(f.tipo)) return { ok: false, error: 'Elige el tipo de promoción.' };
    // Paquete: las burgers marcadas (una de cada una, con combo si regalo trae el combo) a un precio fijo.
    // Se muestra como una burger más, solo el día de la promo y solo a clientes registrados.
    if (f.tipo === 'paquete') {
      f.regalo = listaIds(d.regalo).join(','); f.valor = Math.round(f.valor);
      if (!f.producto) return { ok: false, error: 'Marca las burgers que trae el paquete.' };
      if (f.valor <= 0) return { ok: false, error: 'Escribe el precio del paquete.' };
      if (Number(d.puntos) > 0) return { ok: false, error: 'El paquete no puede costar puntos: deja el precio en puntos en 0.' };
    }
    // Regalo: por cada "valor" productos marcados, uno de los productos de regalo va gratis
    if (f.tipo === 'regalo') {
      f.regalo = listaIds(d.regalo).join(','); f.sin_combo = d.sin_combo !== false; f.valor = Math.max(1, Math.round(f.valor || 1));
      if (!f.producto) return { ok: false, error: 'Marca las burgers (o productos) que dan el regalo.' };
      if (!f.regalo) return { ok: false, error: 'Marca qué producto se regala.' };
    }
    if (f.tipo === 'porcentaje' && (f.valor <= 0 || f.valor > 100)) return { ok: false, error: 'El porcentaje debe estar entre 1 y 100.' };
    if ((f.tipo === 'valor' || f.tipo === 'precio') && f.valor <= 0) return { ok: false, error: 'Escribe el valor en pesos.' };
    if (f.tipo === 'precio' && !f.producto) return { ok: false, error: 'El precio especial necesita un producto.' };
    if (!f.desde || !f.hasta || f.hasta < f.desde) return { ok: false, error: 'Revisa las fechas: "hasta" debe ser igual o posterior a "desde".' };
    // Precio en puntos (0 = gratis para clientes registrados). Solo se manda si la base ya tiene la columna o si se usa.
    const pts = Math.max(0, Math.min(100000, Math.round(Number(d.puntos) || 0)));
    if (pts || d.conPuntos) f.puntos = pts;
    if (pts && f.tipo === 'incentivo') return { ok: false, error: 'Una promoción con precio en puntos debe dar un descuento (porcentaje, valor o precio especial).' };
    const r = d.id ? await sb.from('promociones').update(f).eq('id', d.id) : await sb.from('promociones').insert(f);
    if (r.error && /puntos/.test(r.error.message || '') && /column|schema cache/i.test(r.error.message || '')) return { ok: false, error: 'Falta ejecutar supabase/puntos-y-canjes.sql en Supabase para poner precio en puntos.' };
    if (r.error && f.tipo === 'paquete' && /promociones_tipo_check/.test(r.error.message || '')) return { ok: false, error: 'Falta ejecutar supabase/promos-paquete.sql en Supabase para las promos de paquete.' };
    if (r.error && (/regalo|sin_combo|promociones_tipo_check/.test(r.error.message || ''))) return { ok: false, error: 'Falta ejecutar supabase/promos-por-producto.sql en Supabase para las promos de regalo.' };
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
  // ¿La promo aplica ese día (YYYY-MM-DD)? Para la vitrina de la semana
  const aplicaEl = (p, ymd) => { if (!p || !p.activa || p.desde > ymd || ymd > p.hasta) return false; const d = leerDias(p.dias); return !d.length || d.includes(new Date(ymd + 'T12:00:00Z').getUTCDay()); };

  // "smash,toci" o ["smash","toci"] → ["smash","toci"]. Una promo puede marcar varios productos.
  const listaIds = (v) => [...new Set((Array.isArray(v) ? v : String(v || '').split(',')).map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 40);
  const prodsDe = (p) => listaIds(p && p.producto);
  const regalosDe = (p) => listaIds(p && p.regalo);
  // ¿La promoción toca este producto? (lo marca, o es el regalo)
  const tocaProducto = (p, id) => !!p && p.tipo !== 'paquete' && (prodsDe(p).includes(id) || (p.tipo === 'regalo' && regalosDe(p).includes(id)));
  /* Líneas de pedido de "n" paquetes: cada burger del paquete (una de cada) y, si el paquete
     trae combo, el combo de cada burger. prodDe(id) da el producto activo (o null). */
  function lineasPaquete(p, n, prodDe) {
    const bs = prodsDe(p).map(prodDe), c = regalosDe(p).map(prodDe).filter((x) => x && x.categoria === 'combo')[0];
    if (!n || !bs.length || bs.some((b) => !b)) return [];
    const out = [];
    bs.forEach((b) => {
      out.push({ id: b.id, name: b.name, price: b.price, qty: n, nota: p.titulo, paq: p.id, paqN: n, paqT: p.titulo });
      if (c) out.push({ id: c.id, name: c.name, price: c.price, qty: n, cat: 'combo', nota: 'Para ' + b.name + ' · ' + p.titulo, para: b.name, paraId: b.id, paq: p.id, paqN: n, paqT: p.titulo });
    });
    return out;
  }
  // Precio normal (sin promo) de un paquete, o 0 si algún producto ya no está activo
  function precioNormalPaquete(p, prodDe) { return lineasPaquete(p, 1, prodDe).reduce((s, it) => s + it.price, 0); }

  /* Descuento de las promociones sobre un pedido.
     - Con productos: se aplica a cada unidad de cada producto marcado (si hay varias, la mejor).
     - Sin producto (todo el pedido): % o valor sobre el resto del subtotal (la mejor).
     - Regalo: por cada "valor" unidades de los productos marcados, una unidad de un producto
       de regalo va gratis (si está en el pedido; el cliente elige cuál). Con sin_combo, las
       burgers pedidas en combo no cuentan. "regalos" dice cuántos le faltan por agregar.
     - "Incentivo" no descuenta: es un beneficio que se muestra al cliente.
     - Paquete: las líneas del pedido con "paq" (id de la promo) y "paqN" (cuántos paquetes)
       quedan al precio del paquete; esas líneas no entran en las demás promociones. */
  function aplicarPromos(items, promos) {
    const vig = (promos || []).filter(vigente), porId = {}, enCombo = {}, paqs = {};
    let subtotal = 0;
    (items || []).forEach((it) => {
      subtotal += it.price * it.qty;
      if (it.paq != null) {
        const k = String(it.paq), g = paqs[k] = paqs[k] || { suma: 0, n: 0 };
        g.suma += it.price * it.qty; g.n = Math.max(g.n, Number(it.paqN) || 0);
        return;
      }
      const x = porId[it.id] = porId[it.id] || { qty: 0, price: it.price }; x.qty += it.qty;
      if (it.paraId) { const m = enCombo[it.paraId] = enCombo[it.paraId] || {}; m[it.id] = (m[it.id] || 0) + it.qty; }
    });
    const usadas = [], mejor = {}, porPromo = {};
    const usar = (p, v) => {
      if (!porPromo[p.id]) { porPromo[p.id] = { id: p.id, titulo: p.titulo, valor: 0, puntos: Number(p.puntos) || 0 }; usadas.push(porPromo[p.id]); }
      porPromo[p.id].valor += v;
    };
    let desc = 0;
    vig.filter((p) => p.tipo === 'paquete' && paqs[String(p.id)]).forEach((p) => {
      const g = paqs[String(p.id)], v = Math.round(Math.max(0, g.suma - g.n * (Number(p.valor) || 0)));
      if (v > 0) { desc += v; usar(p, v); }
    });
    vig.filter((p) => p.tipo !== 'regalo' && p.tipo !== 'paquete').forEach((p) => prodsDe(p).filter((id) => porId[id]).forEach((id) => {
      const x = porId[id], u = p.tipo === 'porcentaje' ? x.price * p.valor / 100 : p.tipo === 'valor' ? Math.min(p.valor, x.price) : p.tipo === 'precio' ? Math.max(0, x.price - p.valor) : 0;
      const v = Math.round(u * x.qty);
      if (v > 0 && (!mejor[id] || v > mejor[id].v)) mejor[id] = { v, p };
    }));
    // lo que queda fuera de los paquetes (los descuentos de todo el pedido no tocan el paquete)
    const enPaq = Object.keys(paqs).reduce((s, k) => s + paqs[k].suma, 0), descPaq = desc;
    Object.keys(mejor).forEach((k) => { desc += mejor[k].v; usar(mejor[k].p, mejor[k].v); });
    // Regalos: cada unidad de regalo se usa una sola vez; primero las más caras (las eligió el cliente)
    const libres = {}, regalos = [];
    Object.keys(porId).forEach((id) => { libres[id] = porId[id].qty; });
    vig.filter((p) => p.tipo === 'regalo').forEach((p) => {
      const cada = Math.max(1, Math.round(Number(p.valor) || 1)), sinCombo = p.sin_combo !== false, regs = regalosDe(p);
      // con "sin combo" no cuentan las burgers en combo, salvo si ese combo es justamente el regalo
      const pagados = (id) => Object.keys(enCombo[id] || {}).reduce((s, c) => s + (regs.includes(c) ? 0 : enCombo[id][c]), 0);
      const cuentan = prodsDe(p).reduce((s, id) => s + Math.max(0, (porId[id] ? porId[id].qty : 0) - (sinCombo ? pagados(id) : 0)), 0);
      const gana = Math.floor(cuentan / cada);
      let usados = 0, v = 0; const por = {};   // por = { producto: unidades regaladas }
      regs.filter((id) => libres[id] > 0).sort((a, b) => porId[b].price - porId[a].price).forEach((id) => {
        const n = Math.min(libres[id], gana - usados); if (n <= 0) return;
        const unidad = porId[id].price - (mejor[id] ? mejor[id].v / porId[id].qty : 0);
        libres[id] -= n; usados += n; por[id] = n; v += Math.round(Math.max(0, unidad) * n);
      });
      if (v > 0) { desc += v; usar(p, v); }
      if (cuentan > 0) regalos.push({ p, gana, usados, faltan: gana - usados, cuentan, cada, siguiente: gana ? 0 : cada - cuentan, por });
    });
    let gen = null;
    vig.filter((p) => !p.producto && (p.tipo === 'porcentaje' || p.tipo === 'valor')).forEach((p) => {
      const resto = subtotal - enPaq - (desc - descPaq), v = Math.round(p.tipo === 'porcentaje' ? resto * p.valor / 100 : Math.min(p.valor, resto));
      if (v > 0 && (!gen || v > gen.v)) gen = { v, p };
    });
    if (gen) { desc += gen.v; usadas.push({ id: gen.p.id, titulo: gen.p.titulo, valor: gen.v, puntos: Number(gen.p.puntos) || 0 }); }
    return { descuento: Math.min(desc, subtotal), usadas, incentivos: vig.filter((p) => p.tipo === 'incentivo'), porProducto: mejor, regalos };
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
  // El envío arranca de inmediato (sin esperas antes del fetch): en el celular la
  // página puede quedar congelada en cuanto se abre WhatsApp.
  function postPedido(ref, datos, token) {
    return fetch(URL_NUBE + '/rest/v1/pedidos_web', {
      method: 'POST', keepalive: true,
      headers: { apikey: CLAVE_PUBLICA, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({ ref, datos }),
    });
  }
  async function enviarPedido(ref, datos) {
    const token = tokenSesion || CLAVE_PUBLICA;
    let r;
    try { r = await postPedido(ref, datos, token); }
    catch (e) {   // falla de red: un reintento a los 2 segundos
      await new Promise((listo) => setTimeout(listo, 2000));
      try { r = await postPedido(ref, datos, tokenSesion || CLAVE_PUBLICA); } catch (e2) { return { ok: false, error: errorTxt(e2) }; }
    }
    // sesión del cliente vencida: se envía igual como pedido sin cuenta, para que no se pierda
    if (r.status === 401 && token !== CLAVE_PUBLICA) { try { r = await postPedido(ref, datos, CLAVE_PUBLICA); } catch (e) {} }
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
      if (!p) { estado('sin-sesion'); return; }
      // hay sesión, pero la cuenta sigue con rol cliente: la base no le entrega los pedidos
      if (p.rol !== 'caja' && p.rol !== 'dueno') { estado('rol-cliente', { correo: p.correo }); return; }
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
  /* ---- Seguimiento del pedido en vivo (supabase/seguimiento-pedidos.sql) ---- */
  // Panel: publica el estado de varios pedidos web [{ref, estado}]
  async function panelEstadosPedidos(lista) {
    if (!ok || !tok() || !lista || !lista.length) return { ok: false };
    const { data, error } = await sb.rpc('panel_estados_pedidos', { p_token: tok(), p_lista: lista });
    if (error) return { ok: false, falta: /panel_estados_pedidos|schema cache/i.test(error.message || ''), error: errorTxt(error) };
    return data || { ok: false };
  }
  // Cliente: en qué va su pedido (por número). Devuelve [{ref, estado, estado_en, recibido, creado}]
  async function pedidoEstado(refs) {
    if (!ok || !refs || !refs.length) return { ok: false, lista: [] };
    const { data, error } = await sb.rpc('pedido_estado', { p_refs: refs.slice(0, 5) });
    return error ? { ok: false, lista: [], error: errorTxt(error) } : { ok: true, lista: data || [] };
  }

  /* ---------------- Cupo de hamburguesas en línea ----------------
     Cocina guarda el cupo de hoy y las vendidas en la tabla cupo_dia
     (supabase/cupo-en-linea.sql); la página de clientes lo ve al instante. */
  async function guardarCupo(total, vendidas) {
    if (!ok) return sinNube();
    const p = await perfil();
    if (!p) return { ok: false, error: 'falta conectar la cuenta de caja o dueño en "⭐ Clientes leales"' };
    if (p.rol !== 'caja' && p.rol !== 'dueno') return { ok: false, error: 'la cuenta conectada (' + p.correo + ') tiene rol Cliente; debe ser Caja o Dueño' };
    const fila = { dia: hoyCO(), total: Math.max(0, parseInt(total, 10) || 0), vendidas: Math.max(0, parseInt(vendidas, 10) || 0), actualizado: new Date().toISOString() };
    const { error } = await sb.from('cupo_dia').upsert(fila, { onConflict: 'dia' });
    if (!error) return { ok: true };
    if (/does not exist|schema cache/i.test(error.message)) return { ok: false, error: 'falta ejecutar supabase/cupo-en-linea.sql en Supabase' };
    return { ok: false, error: errorTxt(error) };
  }
  async function leerCupo() {
    if (!ok) return null;
    const { data, error } = await sb.from('cupo_dia').select('*').eq('dia', hoyCO()).maybeSingle();
    return error ? undefined : data;   // undefined = no se pudo leer; null = no hay cupo hoy
  }
  // Para la página de clientes: avisa cada cambio del cupo de hoy. Devuelve una función para detener.
  function seguirCupo(alCambio) {
    if (!ok) return () => {};
    const revisar = async () => { const c = await leerCupo(); if (c !== undefined) try { alCambio(c); } catch (e) { console.warn(e); } };
    const alVolver = () => { if (document.visibilityState !== 'hidden') revisar(); };
    const canal = sb.channel('cupo-' + Date.now())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cupo_dia' }, (m) => { if (m.new && m.new.dia === hoyCO()) alCambio(m.new); })
      .subscribe();
    const reloj = setInterval(revisar, 30000);   // respaldo por si se cae la conexión en vivo
    document.addEventListener('visibilitychange', alVolver); window.addEventListener('online', alVolver);
    revisar();
    return () => { clearInterval(reloj); sb.removeChannel(canal); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('online', alVolver); };
  }

  /* ---------------- Horario y días cerrados en línea ----------------
     Tabla ajustes_publicos (supabase/horario-en-linea.sql): la página de clientes
     lo lee sin sesión; solo el dueño lo guarda (token del panel o cuenta de dueño). */
  async function guardarHorario(h) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('panel_guardar_horario', { p_token: tok() || '', p_horario: h });
    if (error) return { ok: false, error: /does not exist|schema cache|function/i.test(error.message) ? 'falta ejecutar supabase/horario-en-linea.sql en Supabase' : errorTxt(error) };
    if (!data || !data.ok) return { ok: false, error: data && data.error === 'sin-acceso' ? 'el panel no está conectado a la nube como dueño' : 'no se pudo guardar' };
    return { ok: true };
  }
  async function leerHorario() {
    if (!ok) return null;
    const { data, error } = await sb.from('ajustes_publicos').select('valor').eq('clave', 'horario').maybeSingle();
    return error || !data ? null : data.valor;
  }

  /* ---------------- Impresión de comandas a distancia ----------------
     Cola en la tabla impresiones (supabase/impresion-remota.sql). Cualquier
     equipo de caja/dueño manda; el "equipo impresor" la toma y la imprime. */
  const faltaTablaImp = (m) => /does not exist|schema cache/i.test(m || '');
  async function staffOk() {
    const p = await perfil();
    if (!p) return { ok: false, error: 'falta conectar la cuenta de caja o dueño en "⭐ Clientes leales"' };
    if (p.rol !== 'caja' && p.rol !== 'dueno') return { ok: false, error: 'la cuenta conectada (' + p.correo + ') tiene rol Cliente; debe ser Caja o Dueño' };
    return { ok: true, p };
  }
  async function enviarImpresion(pedido, etiqueta) {
    if (!ok) return sinNube();
    const s = await staffOk(); if (!s.ok) return s;
    const { data, error } = await sb.from('impresiones').insert({ pedido: String(etiqueta).slice(0, 40), datos: pedido, por_nombre: String(s.p.nombre || s.p.correo || '').slice(0, 80) }).select('id').single();
    if (error) return { ok: false, error: faltaTablaImp(error.message) ? 'falta ejecutar supabase/impresion-remota.sql en Supabase' : errorTxt(error) };
    return { ok: true, id: data.id };
  }
  async function estadoImpresion(id) {
    if (!ok) return null;
    const { data } = await sb.from('impresiones').select('id,estado,equipo,detalle,actualizado').eq('id', id).maybeSingle();
    return data || null;
  }
  // El equipo impresor "toma" el trabajo: solo uno gana aunque haya dos equipos impresores
  async function tomarImpresion(id, equipo) {
    const { data, error } = await sb.from('impresiones').update({ estado: 'imprimiendo', equipo: String(equipo).slice(0, 60), actualizado: new Date().toISOString() })
      .eq('id', id).eq('estado', 'pendiente').select('id');
    return !error && data && data.length === 1;
  }
  async function marcarImpresion(id, estado, detalle) {
    await sb.from('impresiones').update({ estado, detalle: detalle ? String(detalle).slice(0, 200) : null, actualizado: new Date().toISOString() }).eq('id', id);
  }
  // Para el equipo impresor: entrega cada trabajo pendiente (de los últimos 30 min). Devuelve una función para detener.
  function seguirImpresiones(alTrabajo, alEstado) {
    if (!ok) { if (alEstado) alEstado('sin-nube'); return () => {}; }
    let canal = null, reloj = null, activo = true;
    const estado = (e, info) => { if (alEstado) try { alEstado(e, info); } catch (x) {} };
    const entregar = (f) => { if (f && f.id && f.estado === 'pendiente') try { alTrabajo(f); } catch (e) { console.warn(e); } };
    async function revisar() {
      const desde = new Date(Date.now() - 30 * 60000).toISOString();
      const { data, error } = await sb.from('impresiones').select('*').eq('estado', 'pendiente').gte('creado', desde).order('creado', { ascending: true });
      if (error) { estado(faltaTablaImp(error.message) ? 'sin-tabla' : 'error', { error: error.message }); return; }
      (data || []).forEach(entregar);
      estado('revisado', { hora: new Date() });
    }
    const alVolver = () => { if (document.visibilityState !== 'hidden') revisar(); };
    (async () => {
      const s = await staffOk();
      if (!activo) return;
      if (!s.ok) { estado('sin-sesion', { error: s.error }); return; }
      await revisar();
      canal = sb.channel('impresiones-' + Date.now())
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'impresiones' }, (m) => entregar(m.new))
        .subscribe((st) => estado(st === 'SUBSCRIBED' ? 'en-vivo' : st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' ? 'respaldo' : 'conectando'));
      reloj = setInterval(revisar, 10000);   // respaldo por si se cae la conexión en vivo
      document.addEventListener('visibilitychange', alVolver); window.addEventListener('online', alVolver);
    })();
    return () => { activo = false; if (reloj) clearInterval(reloj); if (canal) sb.removeChannel(canal); document.removeEventListener('visibilitychange', alVolver); window.removeEventListener('online', alVolver); };
  }

  /* ---------------- Respaldos en la nube ----------------
     Tabla "respaldos" (supabase/respaldos-en-la-nube.sql). Caja y dueño suben;
     solo los dueños listan y descargan. */
  const errRespaldo = (e) => (faltaTablaImp(e && e.message) ? 'falta ejecutar supabase/respaldos-en-la-nube.sql en Supabase' : errorTxt(e));
  async function subirRespaldo(r) {
    if (!ok) return sinNube();
    const s = await staffOk(); if (!s.ok) return s;
    const { data, error } = await sb.from('respaldos').insert({
      equipo: String(r.equipo || '').slice(0, 60), por_nombre: String(s.p.nombre || s.p.correo || '').slice(0, 80),
      motivo: r.motivo || 'auto', resumen: r.resumen || {}, huella: String(r.huella || '').slice(0, 40), datos: r.datos,
    }).select('id,creado').single();
    if (error) return { ok: false, error: errRespaldo(error) };
    return { ok: true, id: data.id, creado: data.creado };
  }
  async function listarRespaldos(n) {
    if (!ok) return sinNube();
    const p = await perfil();
    if (!p || p.rol !== 'dueno') return { ok: false, error: 'para ver los respaldos conecta una cuenta de Dueño en "⭐ Clientes leales"' };
    const { data, error } = await sb.from('respaldos').select('id,creado,equipo,por_nombre,motivo,resumen').order('creado', { ascending: false }).limit(n || 30);
    if (error) return { ok: false, error: errRespaldo(error) };
    return { ok: true, lista: data || [] };
  }
  async function leerRespaldo(id) {
    if (!ok) return sinNube();
    const { data, error } = await sb.from('respaldos').select('id,creado,equipo,datos').eq('id', id).maybeSingle();
    if (error) return { ok: false, error: errRespaldo(error) };
    if (!data) return { ok: false, error: 'Ese respaldo ya no existe o no tienes permiso para verlo.' };
    return { ok: true, respaldo: data };
  }

  /* ---------------- Datos del negocio en vivo ----------------
     Tablas "datos" y "datos_aviso" (supabase/datos-en-vivo.sql). Las usa sincronizar.js.
     Cada equipo entra a la nube con el mismo usuario y clave del panel: la nube le da
     una llave de acceso (60 días) que se guarda solo en este equipo. */
  const LS_PANEL = 'nube_panel';
  const panelSesion = () => { try { const v = JSON.parse(localStorage.getItem(LS_PANEL) || 'null'); return v && v.token ? v : null; } catch (e) { return null; } };
  const panelSalir = () => { const s = panelSesion(); try { localStorage.removeItem(LS_PANEL); } catch (e) { /* nada */ } if (ok && s) sb.rpc('panel_salir', { p_token: s.token }).then(() => {}, () => {}); };
  const tok = () => { const s = panelSesion(); return s ? s.token : null; };
  const errDatos = (e) => {
    const m = String((e && e.message) || '');
    if (/sin-acceso/.test(m)) return 'sin-acceso';
    if (faltaTablaImp(m) || /could not find the function|function .* does not exist/i.test(m)) return 'falta ejecutar supabase/datos-en-vivo.sql en Supabase';
    return errorTxt(e);
  };
  async function panelEntrar(tipo, usuario, clave, equipo) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('panel_entrar', { p_tipo: tipo, p_usuario: String(usuario || ''), p_clave: String(clave || ''), p_equipo: String(equipo || '').slice(0, 60) });
    if (error) return { ok: false, error: errDatos(error) };
    if (!data || !data.ok) return { ok: false, error: (data && data.error) || 'No se pudo entrar a la nube.' };
    try { localStorage.setItem(LS_PANEL, JSON.stringify({ token: data.token, rol: data.rol, usuario: String(usuario).trim().toLowerCase(), nombre: data.nombre, en: new Date().toISOString() })); } catch (e) { /* sin espacio */ }
    return { ok: true, rol: data.rol, nombre: data.nombre };
  }
  /* ---- Puntos y canjes desde el panel (supabase/puntos-y-canjes.sql) ----
     Usan la llave del panel, así no hace falta conectar otra cuenta de caja. */
  const faltaPuntosSql = (e) => /could not find the function|function .* does not exist|schema cache/i.test(String((e && e.message) || ''));
  async function panelSumarPuntos(correo, puntos, motivo, pedido) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('panel_sumar_puntos', { p_token: tok(), p_correo: String(correo || ''), p_puntos: Math.round(puntos), p_motivo: motivo || '', p_pedido: pedido || '' });
    if (error) return { ok: false, falta: faltaPuntosSql(error), error: faltaPuntosSql(error) ? 'falta ejecutar supabase/puntos-y-canjes.sql en Supabase' : errorTxt(error) };
    return data || { ok: false, error: 'sin respuesta' };
  }
  /* ---- Promociones y clientes del club desde "Crear pedido" (supabase/promos-por-producto.sql) ----
     Con la llave del panel; si falta el SQL, se usa la cuenta de caja/dueño conectada en "⭐ Clientes leales". */
  async function panelPromos() {
    if (!ok) return { ok: false, lista: [] };
    if (tok()) {
      const { data, error } = await sb.rpc('panel_promos', { p_token: tok() });
      if (!error) return { ok: true, lista: data || [] };
    }
    const p = await perfil();
    if (p && (p.rol === 'caja' || p.rol === 'dueno')) return { ok: true, lista: await promociones(true) };
    return { ok: false, lista: [], error: 'Para ver las promociones conecta el panel a la nube (o ejecuta supabase/promos-por-producto.sql).' };
  }
  async function panelBuscarCliente(texto) {
    if (!ok) return sinNube();
    if (tok()) {
      const { data, error } = await sb.rpc('panel_buscar_cliente', { p_token: tok(), p_texto: String(texto || '') });
      if (!error && data && data.ok) return { ok: true, lista: data.lista || [] };
    }
    // Forma anterior: cuenta de caja o dueño conectada
    const p = await perfil();
    if (p && (p.rol === 'caja' || p.rol === 'dueno')) {
      const r = await clientes(); if (!r.ok) return r;
      const t = String(texto || '').trim().toLowerCase(), d = limpioTel(texto).slice(-10);
      return { ok: true, lista: r.lista.filter((c) => (d.length >= 7 && [c.telefono, c.telefono2].some((x) => limpioTel(x).slice(-10) === d)) || c.correo === t || String(c.usuario || '').toLowerCase() === t.replace(/^@/, '')).slice(0, 6) };
    }
    return { ok: false, error: 'No se pudo buscar: falta ejecutar supabase/promos-por-producto.sql en Supabase (o conectar la cuenta de caja en "⭐ Clientes leales").' };
  }
  /* ---- Avisos de promos por WhatsApp (supabase/avisos-promos.sql) ---- */
  const faltaAvisosSql = (e) => /panel_clientes_promos|panel_baja_promos|acepta_promos|schema cache|does not exist/i.test((e && (e.message || e.details)) || '');
  async function panelClientesPromos() {
    if (!ok) return sinNube();
    if (!tok()) return { ok: false, error: 'Conecta el panel a la nube (entra con tu usuario del panel).' };
    const { data, error } = await sb.rpc('panel_clientes_promos', { p_token: tok() });
    if (error) return { ok: false, error: faltaAvisosSql(error) ? 'Falta ejecutar supabase/avisos-promos.sql en Supabase.' : errorTxt(error) };
    if (!data || !data.ok) return { ok: false, error: data && data.error === 'sin-acceso' ? 'La sesión del panel venció: sal y vuelve a entrar.' : 'No se pudo leer la lista.' };
    return { ok: true, lista: data.lista || [] };
  }
  async function panelBajaPromos(id) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('panel_baja_promos', { p_token: tok() || '', p_id: id });
    if (error) return { ok: false, error: faltaAvisosSql(error) ? 'Falta ejecutar supabase/avisos-promos.sql en Supabase.' : errorTxt(error) };
    return data && data.ok ? { ok: true } : { ok: false, error: 'No se pudo dar de baja.' };
  }
  async function panelDevolverCanje(ref) {
    if (!ok) return sinNube();
    const { data, error } = await sb.rpc('panel_devolver_canje', { p_token: tok(), p_ref: String(ref || '') });
    if (error) return { ok: false, falta: faltaPuntosSql(error), error: errorTxt(error) };
    return data || { ok: false };
  }
  // true = este equipo tomó el pedido web · false = ya lo tomó otro equipo · null = no se pudo saber
  async function tomarPedido(ref) {
    if (!ok) return null;
    const { data, error } = await sb.rpc('panel_tomar_pedido', { p_token: tok(), p_ref: String(ref || '') });
    return error || data == null ? null : !!data;
  }
  async function datosAvisos() {
    const { data, error } = await sb.rpc('datos_avisos', { p_token: tok() });
    if (error) return { ok: false, error: errDatos(error) };
    return { ok: true, lista: data || [] };
  }
  async function datosLeer(claves) {
    const { data, error } = await sb.rpc('datos_leer', { p_token: tok(), p_claves: claves });
    if (error) return { ok: false, error: errDatos(error) };
    return { ok: true, lista: data || [] };
  }
  async function guardarDato(clave, valor, base, equipo, soloDueno) {
    const { data, error } = await sb.rpc('guardar_dato', { p_token: tok(), p_clave: clave, p_valor: valor, p_base: base || 0, p_equipo: equipo || '', p_solo_dueno: !!soloDueno });
    if (error) return { ok: false, error: errDatos(error) };
    return data;   // {ok, version} o {ok:false, conflicto, version, valor}
  }
  // Escucha los avisos de cambio de otros equipos. Devuelve una función para dejar de escuchar.
  function seguirDatos(alAviso, alEstado) {
    const canal = sb.channel('datos-' + Math.random().toString(36).slice(2, 8))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'datos_aviso' }, (m) => { if (m.new && m.new.clave) alAviso(m.new); })
      .subscribe((st) => { if (alEstado) alEstado(st === 'SUBSCRIBED' ? 'en-vivo' : st === 'CHANNEL_ERROR' || st === 'TIMED_OUT' ? 'respaldo' : 'conectando'); });
    return () => sb.removeChannel(canal);
  }

  const API = {
    panelEntrar, panelSesion, panelSalir, panelSumarPuntos, panelDevolverCanje, panelPromos, panelBuscarCliente, panelClientesPromos, panelBajaPromos, tomarPedido, datosAvisos, datosLeer, guardarDato, seguirDatos,
    subirRespaldo, listarRespaldos, leerRespaldo,
    enviarImpresion, estadoImpresion, tomarImpresion, marcarImpresion, seguirImpresiones,
    guardarCupo, leerCupo, seguirCupo, guardarHorario, leerHorario,
    ok, perfil, alCambiar, enRecuperacion, registrar, entrar, salir, recuperarClave, nuevaClave, guardarPerfil, usuarioLibre,
    promociones, promosSemana, aplicaEl, guardarPromo, activarPromo, borrarPromo, aplicarPromos, vigente, listaIds, prodsDe, regalosDe, tocaProducto, lineasPaquete, precioNormalPaquete, hoyCO, diaCO, tocaHoy, textoDias, DIAS,
    puntosPedido, REGLAS, clientes, movimientos, sumarPuntos, cambiarRol, buscarPorCorreo,
    enviarPedido, recibirPedidos, marcarRecibido, panelEstadosPedidos, pedidoEstado,
  };
  return API;
})();
