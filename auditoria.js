/* ============================================================
   SMASH · auditoria.js (caja y dueños; se carga de último)
   - Registro de auditoría: quién, cuándo, qué acción, sobre qué
     registro, valor anterior y valor nuevo. Se arma "envolviendo" las
     funciones de los módulos, así su lógica no cambia: solo se anota la
     operación cuando terminó bien.
   - Validaciones: pedidos repetidos, cambios grandes de precio,
     verificación de guardado en data.js, reajuste de inventario al
     editar un pedido ya preparado.
   - Seguridad: clave de caja con huella (cambiable por los dueños),
     bloqueo por intentos fallidos y cierre por inactividad de dueños.
   ============================================================ */
const SmashAudit = (function () {
  const S = SmashStore;
  const K = { LOG: 'smash_auditoria', STAFF_CRED: 'smash_staff_cred', STAFF_LOCK: 'smash_staff_lock' };
  const MAX = 4000;
  const esDueno = !!document.getElementById('section-costos');
  const panel = esDueno ? 'dueños' : 'caja';

  function usuario() {
    if (esDueno) return 'Dueño (' + (SmashExt.currentOwner() || 'sin sesión') + ')';
    const t = typeof SmashCaja !== 'undefined' ? SmashCaja.turnoAbierto() : null, st = SmashDB.currentStaff();
    return 'Caja: ' + (t ? t.cajero : st ? st.nombre : 'sin sesión');
  }
  const getLog = () => S.read(K.LOG, []);
  function log(accion, registro, antes, despues) {
    try {
      const l = getLog();
      l.push({ id: S.uid('a'), en: S.nowISO(), usuario: usuario(), panel, accion, registro: String(registro || '').slice(0, 120), antes: antes == null ? null : antes, despues: despues == null ? null : despues });
      S.save(K.LOG, l.length > MAX ? l.slice(-MAX) : l);
    } catch (e) { console.warn('Auditoría: no se pudo anotar', accion, e.message); }
  }

  /* ---------------- Utilidades ---------------- */
  const corto = (v) => (typeof v === 'string' && v.indexOf('data:') === 0 ? '[foto]' : v);
  function diff(a, b, campos) {
    const antes = {}, despues = {};
    campos.forEach((c) => { const x = a ? corto(a[c]) : undefined, y = b ? corto(b[c]) : undefined; if (JSON.stringify(x) !== JSON.stringify(y)) { antes[c] = x; despues[c] = y; } });
    return Object.keys(despues).length ? { antes, despues } : null;
  }
  const items = (o) => (o && o.items ? o.items.map((i) => i.qty + 'x ' + i.name).join(', ') : '');
  const pedidoRef = (o) => (o ? 'Pedido #' + (o.numeroDia || o.id) + (typeof SmashComandas !== 'undefined' ? ' (' + SmashComandas.codigo(o) + ')' : '') : 'Pedido');
  const clon = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  // Envuelve obj[name]: antes(args) → contexto; despues(resultado, contexto, args) → anota
  function wrap(obj, name, antes, despues) {
    if (!obj || typeof obj[name] !== 'function') return;
    const orig = obj[name];
    obj[name] = function () {
      const args = Array.prototype.slice.call(arguments);
      const ctx = antes ? antes.apply(null, args) : null;
      if (ctx && ctx.cancelar) return ctx.devolver;
      const res = orig.apply(this, args);
      try { despues(res, ctx, args); } catch (e) { console.warn('Auditoría:', name, e.message); }
      return res;
    };
  }

  /* ---------------- Productos y precios ---------------- */
  const PCAMPOS = ['name', 'price', 'cost', 'categoria', 'activo', 'desc', 'img'];
  wrap(SmashDB, 'addProduct', null, (p) => {
    if (!SmashDB.getProductById(p.id)) { alert('⚠ No se pudo guardar el producto (almacenamiento lleno). Descarga un respaldo y libera espacio.'); return; }
    log('Producto creado', p.name, null, { precio: p.price, costo: p.cost, categoria: p.categoria });
  });
  wrap(SmashDB, 'updateProduct', (id, fields) => {
    const p = clon(SmashDB.getProductById(id));
    // Cambio de precio grande: confirmación para evitar errores de digitación
    if (p && fields.price != null && p.price > 0 && Math.abs(fields.price - p.price) / p.price > 0.3 &&
      !confirm(`El precio de "${p.name}" pasa de $${p.price.toLocaleString('es-CO')} a $${Number(fields.price).toLocaleString('es-CO')} (cambio mayor al 30%). ¿Es correcto?`)) return { cancelar: true, devolver: false };
    return { p };
  }, (ok, ctx, args) => {
    const after = SmashDB.getProductById(args[0]);
    if (ok && args[1].price != null && after && after.price !== Number(args[1].price)) { alert('⚠ No se pudo guardar el cambio (almacenamiento lleno). El producto quedó como estaba.'); return; }
    const d = diff(ctx.p, after, PCAMPOS);
    if (d) log(d.despues.price != null ? 'Cambio de precio / producto' : 'Producto editado', after ? after.name : args[0], d.antes, d.despues);
  });
  wrap(SmashDB, 'deleteProduct', (id) => ({ p: clon(SmashDB.getProductById(id)) }), (r, ctx) => {
    if (ctx.p) log('Producto eliminado', ctx.p.name, { precio: ctx.p.price, costo: ctx.p.cost, categoria: ctx.p.categoria }, null);
  });
  // Un producto con ventas no se elimina (se oculta): así el historial queda completo
  const productoVendido = (id) => SmashDB.getOrders().some((o) => (o.items || []).some((i) => i.id === id));

  /* ---------------- Pedidos ---------------- */
  const firma = (d) => (d.items || []).map((i) => i.id + ':' + i.qty).sort().join('|');
  const tel = (t) => String(t || '').replace(/\D/g, '').slice(-10);
  wrap(SmashExt, 'addOrder', (d) => {
    // Pedido repetido: mismo cliente (teléfono o nombre) y mismos productos en los últimos 3 minutos
    if (d.ref) return null; // los que traen referencia ya se controlan por referencia
    const hace = Date.now() - 3 * 60000;
    const dup = SmashDB.getOrders().find((o) => o.status !== 'cancelado' && new Date(o.creado).getTime() > hace && firma(o) === firma(d) &&
      ((tel(d.telefono) && tel(o.telefono) === tel(d.telefono)) || String(o.cliente || '').trim().toLowerCase() === String(d.cliente || '').trim().toLowerCase()));
    if (dup && !confirm(`Parece repetido: el pedido #${dup.numeroDia || dup.id} de ${dup.cliente} tiene los mismos productos y se creó hace menos de 3 minutos.\n\n¿Crear otro pedido igual de todas formas?`)) return { cancelar: true, devolver: { ok: false, dup: true, order: dup } };
    return null;
  }, (res) => {
    if (res && res.ok) log('Pedido creado', pedidoRef(res.order), null, { cliente: res.order.cliente, productos: items(res.order), total: res.order.total, origen: res.order.origen });
  });
  wrap(SmashExt, 'setStatus', (id) => ({ o: clon(SmashDB.getOrderById(id)) }), (ok, ctx, args) => {
    if (ok && ctx.o) log('Cambio de estado', pedidoRef(ctx.o), { estado: ctx.o.status }, { estado: args[1] });
  });
  wrap(SmashExt, 'updateOrder', (id) => ({ o: clon(SmashDB.getOrderById(id)) }), (o, ctx, args) => {
    if (!o || !ctx.o) return;
    const a = Object.assign({}, ctx.o, { items: items(ctx.o) }), b = Object.assign({}, o, { items: items(o) });
    const d = diff(a, b, ['items', 'subtotal', 'descuento', 'domicilio', 'total', 'cliente', 'telefono', 'direccion', 'notas', 'repartidor']);
    if (d) log(args[1].repartidor != null && Object.keys(d.despues).length === 1 ? 'Domiciliario asignado' : 'Pedido editado', pedidoRef(o), d.antes, d.despues);
    // Si ya se había descontado el inventario, se ajusta la diferencia
    if (args[1].items && typeof SmashInv !== 'undefined') { try { SmashInv.reajustarPedido(o, usuario()); } catch (e) { alert('El pedido se editó, pero no se pudo ajustar el inventario: ' + e.message); } }
  });
  wrap(SmashExt, 'deleteOrder', (id) => ({ o: clon(SmashDB.getOrderById(id)) }), (ok, ctx) => { if (ok) log('Pedido eliminado', pedidoRef(ctx.o), { total: ctx.o.total, estado: ctx.o.status }, null); });
  wrap(SmashExt, 'setCupo', () => ({ c: SmashExt.getCupoRaw() }), (r, ctx, args) => log('Cupo del día', 'Cupo de hamburguesas', ctx.c ? { total: ctx.c.total, dia: ctx.c.dia } : null, { total: parseInt(args[0], 10) || 0 }));
  wrap(SmashExt, 'saveZonasCfg', () => ({ z: SmashExt.getZonasCfg() }), (r, ctx) => {
    const m = (l) => l.map((z) => z.nombre + ': ' + (z.variable ? 'variable' : z.fee) + (z.activa === false ? ' (inactiva)' : '')).join(' · ');
    if (m(ctx.z) !== m(r)) log('Zonas y tarifas', 'Domicilios', m(ctx.z), m(r));
  });
  wrap(SmashExt, 'addPersonal', null, (p) => log('Personal agregado', p.nombre, null, { cargo: p.cargo, pago: p.pago, dias: p.dias.join(', ') }));
  wrap(SmashExt, 'deletePersonal', (id) => ({ p: clon(SmashExt.getPersonal().find((x) => x.id === id)) }), (r, ctx) => {
    if (ctx.p) log('Personal eliminado', ctx.p.nombre, { cargo: ctx.p.cargo, telefono: ctx.p.telefono, pago: ctx.p.pago, dias: (ctx.p.dias || []).join(', '), registro: ctx.p.registro }, null);
  });
  const tipoU = (t) => (t === 'dueno' ? 'dueño' : 'caja');
  wrap(SmashExt, 'crearUsuario', null, (r, c, a) => { if (r && r.ok) log('Usuario creado', tipoU(a[0]) + ': ' + String(a[1]).trim().toLowerCase(), null, { nombre: a[2] }); });
  wrap(SmashExt, 'eliminarUsuario', null, (r, c, a) => { if (r && r.ok) log('Usuario eliminado', tipoU(a[0]) + ': ' + a[1], null, null); });
  wrap(SmashExt, 'changeOwnerPassword', null, (r) => log(r && r.ok ? 'Contraseña de dueños cambiada' : 'Intento fallido de cambiar contraseña de dueños', 'Acceso de dueños', null, null));
  wrap(SmashExt, 'loginOwner', null, (r, c, args) => log(r && r.ok ? 'Inicio de sesión de dueños' : 'Inicio de sesión fallido (dueños)', String(args[0] || '').slice(0, 60), null, null));
  wrap(SmashDB, 'setGastosDia', (f) => ({ g: clon(S.read(SmashDB.KEYS.GASTOS_DIA, {})[f]) }), (r, ctx, args) => {
    const d = diff(ctx.g || {}, args[1], ['nomina', 'publicidad', 'servicios', 'otros']);
    if (d) log('Gastos del día (Contabilidad)', args[0], d.antes, d.despues);
  });

  /* ---------------- Inventario y recetas ---------------- */
  if (typeof SmashInv !== 'undefined') {
    wrap(SmashInv, 'guardarIngrediente', (d) => ({ i: d.id ? clon(SmashInv.getIngrediente(d.id)) : null }), (i, ctx) => {
      if (!ctx.i) { log('Ingrediente creado', i.nombre, null, { unidad: i.unidad, costo: i.costo, existencia: i.stock }); return; }
      const d = diff(ctx.i, i, ['nombre', 'categoria', 'unidad', 'costo', 'minimo', 'proveedor', 'activo']);
      if (d) log('Ingrediente editado', i.nombre, d.antes, d.despues);
    });
    wrap(SmashInv, 'setActivo', (id) => ({ i: clon(SmashInv.getIngrediente(id)) }), (r, ctx, args) => { if (ctx.i) log(args[1] ? 'Ingrediente activado' : 'Ingrediente desactivado', ctx.i.nombre, null, null); });
    wrap(SmashInv, 'eliminarIngrediente', (id) => ({ i: clon(SmashInv.getIngrediente(id)) }), (r, ctx) => { if (ctx.i) log('Ingrediente eliminado', ctx.i.nombre, { unidad: ctx.i.unidad }, null); });
    wrap(SmashInv, 'registrarCompra', null, (m) => log('Compra de inventario', m.ingNombre, null, { cantidad: m.cantOrig + ' ' + m.unidadOrig, total: m.precioTotal, proveedor: m.proveedor }));
    wrap(SmashInv, 'registrarSalida', null, (m) => log('Salida de inventario', m.ingNombre, null, { tipo: SmashInv.TIPOS[m.tipo].n, cantidad: m.cantOrig + ' ' + m.unidadOrig, valor: m.valor, motivo: m.motivo }));
    wrap(SmashInv, 'guardarConteo', null, (c) => log('Conteo físico', c.lineas.length + ' ingredientes', null, { diferencia: c.valorDif, nota: c.nota }));
    wrap(SmashInv, 'setReceta', (p) => ({ r: SmashInv.getReceta(p) }), (r, ctx, args) => {
      const t = (ls) => ls.map((l) => { const i = SmashInv.getIngrediente(l.ingId); return (i ? i.nombre : '?') + ' ' + l.cant + l.unidad; }).join(', ');
      const p = SmashDB.getProductById(args[0]);
      if (t(ctx.r) !== t(r)) log('Receta modificada', p ? p.name : args[0], t(ctx.r) || 'sin receta', t(r) || 'sin receta');
    });
  }

  /* ---------------- Comandas ---------------- */
  if (typeof SmashComandas !== 'undefined') {
    wrap(SmashComandas, 'cancelar', (id) => ({ o: clon(SmashDB.getOrderById(id)) }), (o, ctx) => {
      const c = o.cancelacion;
      log('Pedido cancelado', pedidoRef(o), { estado: ctx.o.status, total: ctx.o.total }, { motivo: c.motivo, responsable: c.responsable, preparado: c.preparado, perdida: c.perdida, insumos_reintegrados: c.reintegrado });
    });
    wrap(SmashComandas, 'agregarNovedad', null, (o, c, args) => log('Novedad', pedidoRef(o), null, { texto: String(args[1]).slice(0, 120) }));
  }

  /* ---------------- Caja ---------------- */
  if (typeof SmashCaja !== 'undefined') {
    wrap(SmashCaja, 'abrirTurno', null, (t) => log('Apertura de caja', t.cajero, null, { base: t.base }));
    wrap(SmashCaja, 'cerrarTurno', null, (t) => log('Cierre de caja', t.cajero, null, { esperado: t.cierre.esperado, contado: t.cierre.contado, diferencia: t.cierre.diferencia }));
    wrap(SmashCaja, 'registrarPago', null, (p) => log('Pago registrado', 'Pedido #' + p.num + ' (' + p.comanda + ')', null, { total: p.total, medios: p.lineas.map((l) => SmashCaja.METODOS[l.metodo] + ' ' + l.monto + (l.cuenta ? ' → ' + l.cuenta : '')).join(' + ') }));
    wrap(SmashCaja, 'anularPago', (id) => ({ p: clon(SmashCaja.getPagos().find((x) => x.id === id)) }), (r, ctx, args) => {
      if (ctx.p) log('Pago anulado', 'Pedido #' + ctx.p.num, { total: ctx.p.total }, { motivo: args[1] });
    });
    wrap(SmashCaja, 'registrarMovimiento', null, (m) => log('Movimiento de caja', SmashCaja.MOV_TIPOS[m.tipo].n, null, { valor: m.monto, medio: SmashCaja.METODOS[m.metodo], concepto: m.concepto }));
    wrap(SmashCaja, 'guardarCuenta', (d) => ({ c: d.id ? clon(SmashCaja.getCuenta(d.id)) : null }), (c, ctx) => {
      const d = diff(ctx.c, c, ['alias', 'banco', 'tipo', 'numero', 'titular']);
      if (d) log(ctx.c ? 'Cuenta bancaria editada' : 'Cuenta bancaria creada', c.alias, d.antes, d.despues);
    });
    wrap(SmashCaja, 'setCuentaActiva', (id) => ({ c: clon(SmashCaja.getCuenta(id)) }), (r, ctx, args) => { if (ctx.c) log(args[1] ? 'Cuenta activada' : 'Cuenta desactivada', ctx.c.alias, null, null); });
  }

  /* ---------------- Clientes y puntos ---------------- */
  if (typeof SmashClientes !== 'undefined') {
    wrap(SmashClientes, 'guardarCfg', () => ({ c: SmashClientes.getCfg() }), (c, ctx) => {
      const r = (x) => ({ activo: x.activo, regla: x.monto + ' COP = ' + x.puntos + ' pts', vence: x.venceDias, recompensas: x.recompensas.map((y) => y.nombre + ' ' + y.puntos + 'pts' + (y.valor ? ' -' + y.valor : '')).join(', ') });
      const d = diff(r(ctx.c), r(c), ['activo', 'regla', 'vence', 'recompensas']);
      if (d) log('Programa de puntos', 'Fidelización', d.antes, d.despues);
    });
    wrap(SmashClientes, 'canjear', null, (e) => log('Canje de puntos', 'Cliente ' + String(e.cliente).slice(-4).padStart(10, '·'), null, { recompensa: e.recompensa, puntos: e.puntos, pedido: e.pedidoNum || '', descuento: e.descuento || 0 }));
    wrap(SmashClientes, 'fusionar', null, (r, c, args) => log('Clientes unidos', '···' + String(args[1]).slice(-4), { telefono: '···' + String(args[0]).slice(-4) }, null));
    wrap(SmashClientes, 'exportarDatos', null, () => log('Exportación de datos de cliente', 'Solicitud de datos personales', null, null));
    // Al anonimizar también se borran del registro de auditoría el nombre, teléfono y dirección del cliente
    wrap(SmashClientes, 'anonimizar', (key) => {
      const c = SmashClientes.lista().find((x) => x.key === key);
      return { datos: c ? [c.nombre, c.direccion].concat(c.telefonos).filter((x) => x && String(x).length >= 4) : [] };
    }, (n, ctx) => {
      const l = getLog();
      l.forEach((e) => {
        let s = JSON.stringify(e);
        ctx.datos.forEach((x) => { s = s.split(JSON.stringify(String(x)).slice(1, -1)).join('[anonimizado]'); });
        Object.assign(e, JSON.parse(s));
      });
      try { S.save(K.LOG, l); } catch (x) { /* se anota igual abajo */ }
      log('Cliente anonimizado', n + ' pedidos', null, null);
    });
  }

  /* ---------------- Gastos y respaldos ---------------- */
  if (typeof SmashFinanzas !== 'undefined') {
    wrap(SmashFinanzas, 'registrarGasto', null, (g) => log('Gasto registrado', g.catNombre, null, { fecha: g.fecha, valor: g.monto, frecuencia: g.frecuencia, descripcion: g.descripcion }));
    wrap(SmashFinanzas, 'anularGasto', (id) => ({ g: clon(SmashFinanzas.getGastos().find((x) => x.id === id)) }), (r, ctx, args) => { if (ctx.g) log('Gasto anulado', ctx.g.catNombre, { fecha: ctx.g.fecha, valor: ctx.g.monto }, { motivo: args[1] }); });
    wrap(SmashFinanzas, 'guardarCats', () => ({ c: SmashFinanzas.getCats() }), (c, ctx) => {
      const t = (l) => l.map((x) => x.nombre + ' (' + x.clase + ')' + (x.activa === false ? ' inactivo' : '')).join(', ');
      if (t(ctx.c) !== t(c)) log('Conceptos de gasto', 'Gastos', t(ctx.c), t(c));
    });
  }
  wrap(S, 'downloadBackup', null, () => log('Respaldo descargado', 'Todos los datos', null, null));
  wrap(S, 'importAll', null, (n) => log('Respaldo restaurado', n + ' grupos de datos', null, null));

  /* ---------------- Clave de caja ----------------
     data.js trae la clave de caja escrita en el código. Si los dueños definen una nueva, se guarda
     solo su huella y la escrita en el código deja de servir. Tras 5 intentos fallidos se bloquea 30 s. */
  const staffCred = () => S.read(K.STAFF_CRED, null);
  if (SmashDB.loginStaff) {
    const origLogin = SmashDB.loginStaff;
    SmashDB.loginStaff = function (usuarioIn, pw) {
      const lock = S.read(K.STAFF_LOCK, { n: 0, until: 0 });
      if (Date.now() < lock.until) return { ok: false, error: 'Demasiados intentos. Espera ' + Math.ceil((lock.until - Date.now()) / 1000) + ' segundos.' };
      const cred = staffCred(), staff = S.read(SmashDB.KEYS.STAFF, []), quien = String(usuarioIn).trim().toLowerCase();
      const propio = staff.find((x) => x.propio && x.usuario.toLowerCase() === quien);
      let res;
      if (propio) {
        // Usuario creado por los dueños: entra solo con su propia clave
        if (SmashExt.hashPassword(String(pw), propio.salt) === propio.hash) { localStorage.setItem(SmashDB.KEYS.SESSION_STAFF, propio.usuario); res = { ok: true, user: propio }; }
        else res = { ok: false, error: 'Usuario o contraseña de caja incorrectos.' };
      } else if (cred) {
        const u = staff.find((x) => !x.propio && x.usuario.toLowerCase() === quien);
        if (u && SmashExt.hashPassword(String(pw), cred.salt) === cred.hash) { localStorage.setItem(SmashDB.KEYS.SESSION_STAFF, u.usuario); res = { ok: true, user: u }; }
        else res = { ok: false, error: 'Usuario o contraseña de caja incorrectos.' };
      } else res = origLogin.call(this, usuarioIn, pw);
      const n = res.ok ? 0 : lock.n + 1;
      try { localStorage.setItem(K.STAFF_LOCK, JSON.stringify({ n: n >= 5 ? 0 : n, until: n >= 5 ? Date.now() + 30000 : 0 })); } catch (e) { /* opcional */ }
      log(res.ok ? 'Inicio de sesión de caja' : 'Inicio de sesión fallido (caja)', String(usuarioIn || '').slice(0, 40), null, null);
      return res;
    };
  }
  function cambiarClaveCaja(nueva, nueva2) {
    if (String(nueva).length < 8) throw new Error('La clave de caja debe tener al menos 8 caracteres.');
    if (nueva !== nueva2) throw new Error('Las claves no coinciden.');
    const salt = 'c' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    S.save(K.STAFF_CRED, { salt, hash: SmashExt.hashPassword(String(nueva), salt), en: S.nowISO() });
    log('Clave de caja cambiada', 'Acceso de caja', null, null);
  }

  /* ---------------- Inactividad (solo dueños) ---------------- */
  if (esDueno) {
    const LIM = 30 * 60000;
    let ultima = Date.now();
    ['pointerdown', 'keydown', 'scroll'].forEach((ev) => document.addEventListener(ev, () => { ultima = Date.now(); }, { passive: true }));
    setInterval(() => {
      if (SmashExt.currentOwner() && Date.now() - ultima > LIM) {
        log('Sesión cerrada por inactividad', 'Acceso de dueños', null, null);
        SmashExt.logoutOwner();
        alert('Por seguridad se cerró la sesión de dueños tras 30 minutos sin actividad.');
        location.reload();
      }
    }, 60000);
  }

  return { K, getLog, log, productoVendido, cambiarClaveCaja, tieneClaveCaja: () => !!staffCred(), usuario };
})();
