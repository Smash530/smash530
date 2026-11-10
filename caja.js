/* ============================================================
   SMASH · caja.js
   Turnos de caja (apertura, arqueo y cierre), pagos de pedidos
   (también combinados), movimientos de caja y cuentas bancarias
   receptoras. Requiere data.js, data-ext.js, store.js y comandas.js.
   - Solo puede haber un turno abierto; un turno cerrado no se reabre.
   - Un pedido tiene a lo sumo un pago vigente (no se cobra dos veces).
   - El domicilio no es de SMASH: si el cliente lo pagó a SMASH queda
     marcado, y lo que se le entrega al domiciliario es un movimiento
     "Pago a domiciliario" (sale del efectivo, no es gasto de SMASH).
   - No se guardan contraseñas ni claves bancarias, solo datos para
     identificar la cuenta.
   ============================================================ */
const SmashCaja = (function () {
  const S = SmashStore;
  const K = {
    TURNOS: 'smash_caja_turnos',
    MOVS: 'smash_caja_movs',
    PAGOS: 'smash_pagos',
    CUENTAS: 'smash_cuentas',
    CUENTAS_HIST: 'smash_cuentas_hist',
    DESDE: 'smash_pagos_desde', // pedidos anteriores usan el medio de pago anunciado por el cliente
  };
  if (!S.read(K.DESDE, null)) { try { S.save(K.DESDE, S.nowISO()); } catch (e) { /* se reintenta en la próxima carga */ } }

  const METODOS = { efectivo: 'Efectivo', transferencia: 'Transferencia', otro: 'Otro medio' };
  const MOV_TIPOS = {
    ingreso: { n: 'Ingreso adicional', signo: 1 },
    gasto: { n: 'Gasto de caja', signo: -1 },
    retiro: { n: 'Retiro de dinero', signo: -1 },
    devolucion: { n: 'Devolución a cliente', signo: -1 },
    pago_domiciliario: { n: 'Pago a domiciliario', signo: -1 },
  };
  const r = (n) => Math.round(Number(n) || 0);
  const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const pedidoKey = (o) => o.id + '|' + o.creado;

  /* ---------------- Cuentas bancarias receptoras ---------------- */
  const getCuentas = () => S.read(K.CUENTAS, []);
  const getCuenta = (id) => getCuentas().find((c) => c.id === id) || null;
  const cuentaNombre = (c) => (c ? c.alias + (c.banco ? ' · ' + c.banco : '') + (c.numero ? ' ···' + String(c.numero).slice(-4) : '') : '');
  function guardarCuenta(d, por) {
    const list = getCuentas(), hist = S.read(K.CUENTAS_HIST, []);
    const datos = { alias: txt(d.alias, 50), banco: txt(d.banco, 50), tipo: txt(d.tipo, 30), numero: txt(d.numero, 30).replace(/[^\d\- ]/g, ''), titular: txt(d.titular, 80) };
    if (!datos.alias) throw new Error('Escribe un nombre corto para la cuenta (ej: Nequi principal).');
    if (list.some((c) => c.id !== d.id && c.alias.toLowerCase() === datos.alias.toLowerCase())) throw new Error('Ya existe una cuenta con ese nombre.');
    let c;
    if (d.id) {
      c = list.find((x) => x.id === d.id);
      if (!c) throw new Error('La cuenta ya no existe.');
      const antes = { alias: c.alias, banco: c.banco, tipo: c.tipo, numero: c.numero, titular: c.titular };
      Object.assign(c, datos, { actualizada: S.nowISO() });
      hist.push({ cuentaId: c.id, accion: 'edición', antes, despues: datos, por: por || '', en: S.nowISO() });
    } else {
      c = Object.assign({ id: S.uid('cb'), activa: true, creada: S.nowISO() }, datos);
      list.push(c);
      hist.push({ cuentaId: c.id, accion: 'creación', antes: null, despues: datos, por: por || '', en: S.nowISO() });
    }
    S.tx({ [K.CUENTAS]: list, [K.CUENTAS_HIST]: hist });
    return c;
  }
  function setCuentaActiva(id, activa, por) {
    const list = getCuentas(), hist = S.read(K.CUENTAS_HIST, []), c = list.find((x) => x.id === id);
    if (!c) return;
    c.activa = !!activa;
    hist.push({ cuentaId: id, accion: activa ? 'activada' : 'desactivada', antes: null, despues: null, por: por || '', en: S.nowISO() });
    S.tx({ [K.CUENTAS]: list, [K.CUENTAS_HIST]: hist });
  }
  const getCuentasHist = () => S.read(K.CUENTAS_HIST, []);

  /* ---------------- Turnos ---------------- */
  const getTurnos = () => S.read(K.TURNOS, []);
  const turnoAbierto = () => getTurnos().filter((t) => t.estado === 'abierto').pop() || null;
  function abrirTurno(d, por) {
    const turnos = getTurnos();
    if (turnos.some((t) => t.estado === 'abierto')) throw new Error('Ya hay una caja abierta. Ciérrala antes de abrir otra.');
    const cajero = txt(d.cajero, 60), base = Number(d.base);
    if (!cajero) throw new Error('Escribe el nombre de quien abre la caja.');
    if (d.base === '' || d.base == null || !(base >= 0)) throw new Error('Escribe el dinero inicial (base). Si no hay, escribe 0.');
    const t = { id: S.uid('t'), cajero, base: r(base), abierto: S.nowISO(), estado: 'abierto', por: por || '' };
    turnos.push(t);
    S.save(K.TURNOS, turnos);
    return t;
  }
  function exigirTurno() {
    const t = turnoAbierto();
    if (!t) throw new Error('La caja está cerrada. Ábrela en "Caja" con el dinero inicial.');
    return t;
  }

  /* ---------------- Pagos de pedidos ---------------- */
  const getPagos = () => S.read(K.PAGOS, []);
  const pagoDe = (o, pagos) => (pagos || getPagos()).find((p) => p.pedidoKey === pedidoKey(o) && !p.anulado) || null;
  const desde = () => S.read(K.DESDE, '');
  const esAntiguo = (o) => o.creado < desde();
  // Lo que SMASH cobra por el pedido: productos − descuento (+ domicilio si el cliente se lo pagó a SMASH)
  function montoACobrar(o, incluyeDomicilio) {
    const base = r(o.subtotal) - r(o.descuento);
    return base + (incluyeDomicilio ? r(o.domicilio) : 0);
  }
  function estadoPago(o, pagos) {
    if (o.status === 'cancelado') {
      const p = pagoDe(o, pagos);
      return p ? { k: 'devolver', n: 'Cancelado con pago', pago: p } : { k: 'na', n: '' };
    }
    const p = pagoDe(o, pagos);
    if (p) return { k: 'pagado', n: 'Pagado', pago: p };
    if (esAntiguo(o)) return { k: 'antiguo', n: o.pago || 'Sin registro' };
    return { k: 'pendiente', n: 'Pendiente de pago' };
  }
  function registrarPago(id, d, por) {
    const t = exigirTurno();
    const o = SmashDB.getOrderById(id);
    if (!o) throw new Error('El pedido ya no existe.');
    if (o.status === 'cancelado') throw new Error('El pedido está cancelado.');
    const pagos = getPagos();
    if (pagoDe(o, pagos)) throw new Error('Este pedido ya tiene un pago registrado.');
    const inclDom = !!d.incluyeDomicilio;
    if (inclDom && o.domicilioPendiente) throw new Error('Primero escribe el valor del domicilio del pedido.');
    const debe = montoACobrar(o, inclDom);
    const cuentas = getCuentas();
    const lineas = (d.lineas || []).filter((l) => r(l.monto) > 0).map((l) => {
      if (!METODOS[l.metodo]) throw new Error('Elige el medio de pago.');
      const x = { metodo: l.metodo, monto: r(l.monto) };
      if (l.metodo === 'transferencia') {
        const c = cuentas.find((cc) => cc.id === l.cuentaId);
        if (!c) throw new Error('Elige la cuenta que recibió la transferencia.');
        if (c.activa === false) throw new Error('La cuenta ' + c.alias + ' está desactivada.');
        x.cuentaId = c.id; x.cuenta = cuentaNombre(c);
      }
      if (l.ref) x.ref = txt(l.ref, 60);
      return x;
    });
    if (!lineas.length) throw new Error('Escribe el valor pagado.');
    const suma = lineas.reduce((s, l) => s + l.monto, 0);
    if (suma !== debe) throw new Error('Los pagos suman ' + suma.toLocaleString('es-CO') + ' y el valor a cobrar es ' + debe.toLocaleString('es-CO') + '.');
    const p = {
      id: S.uid('pg'), pedidoKey: pedidoKey(o), pedidoId: o.id, num: o.numeroDia || o.id, comanda: SmashComandas.codigo(o), cliente: o.cliente,
      turnoId: t.id, lineas, total: suma, domicilio: inclDom ? r(o.domicilio) : 0, por: por || t.cajero, en: S.nowISO(),
    };
    pagos.push(p);
    S.save(K.PAGOS, pagos);
    return p;
  }
  // Un pago solo se anula dentro del mismo turno; después del cierre se registra una devolución.
  function anularPago(pagoId, motivo, por) {
    const t = exigirTurno(), pagos = getPagos(), p = pagos.find((x) => x.id === pagoId);
    if (!p || p.anulado) throw new Error('El pago no existe o ya estaba anulado.');
    if (p.turnoId !== t.id) throw new Error('Ese pago es de un turno ya cerrado: registra una devolución.');
    const m = txt(motivo, 150);
    if (!m) throw new Error('Escribe por qué se anula el pago.');
    p.anulado = { motivo: m, por: por || t.cajero, en: S.nowISO() };
    S.save(K.PAGOS, pagos);
  }

  /* ---------------- Movimientos de caja ---------------- */
  const getMovs = () => S.read(K.MOVS, []);
  function registrarMovimiento(d, por) {
    const t = exigirTurno();
    if (!MOV_TIPOS[d.tipo]) throw new Error('Elige el tipo de movimiento.');
    const metodo = METODOS[d.metodo] ? d.metodo : 'efectivo';
    const monto = r(d.monto);
    if (!(monto > 0)) throw new Error('Escribe el valor.');
    const concepto = txt(d.concepto, 150);
    if (!concepto) throw new Error('Escribe el concepto o motivo.');
    const m = { id: S.uid('cm'), turnoId: t.id, tipo: d.tipo, metodo, monto, concepto, por: por || t.cajero, en: S.nowISO() };
    if (d.pedidoNum) m.pedidoNum = txt(d.pedidoNum, 20);
    if (metodo === 'transferencia') {
      const c = getCuenta(d.cuentaId);
      if (!c) throw new Error('Elige la cuenta.');
      m.cuentaId = c.id; m.cuenta = cuentaNombre(c);
    }
    const movs = getMovs();
    movs.push(m);
    S.save(K.MOVS, movs);
    return m;
  }

  /* ---------------- Arqueo ---------------- */
  // Dinero esperado = base + ingresos en efectivo − egresos en efectivo
  // porMetodo = todo lo que entró (incluye domicilios que el cliente pagó a SMASH): solo para el arqueo.
  // ventasPorMetodo = solo productos, sin ningún domicilio: es lo que va en informes, estadísticas y socios.
  // El domicilio de un pago combinado se reparte entre sus medios en proporción a cada valor.
  function resumen(pagos, movs, base) {
    const porMetodo = { efectivo: 0, transferencia: 0, otro: 0 }, domPorMetodo = { efectivo: 0, transferencia: 0, otro: 0 }, porCuenta = {};
    let domicilios = 0, nPagos = 0;
    pagos.forEach((p) => {
      nPagos++; domicilios += p.domicilio || 0;
      const dom = r(p.domicilio), tot = p.lineas.reduce((s, l) => s + l.monto, 0);
      let resta = dom;
      p.lineas.forEach((l, i) => {
        const parte = !dom || !tot ? 0 : i === p.lineas.length - 1 ? resta : Math.min(resta, r((dom * l.monto) / tot));
        resta -= parte; domPorMetodo[l.metodo] += parte;
      });
      p.lineas.forEach((l) => {
        porMetodo[l.metodo] += l.monto;
        if (l.metodo === 'transferencia') { const k = l.cuentaId || '?'; porCuenta[k] = porCuenta[k] || { nombre: l.cuenta || 'Sin cuenta', v: 0, n: 0 }; porCuenta[k].v += l.monto; porCuenta[k].n++; }
      });
    });
    const porTipo = {};
    Object.keys(MOV_TIPOS).forEach((k) => { porTipo[k] = { efectivo: 0, otros: 0 }; });
    movs.forEach((m) => { porTipo[m.tipo][m.metodo === 'efectivo' ? 'efectivo' : 'otros'] += m.monto; });
    const ingresosEf = porMetodo.efectivo + porTipo.ingreso.efectivo;
    const egresosEf = Object.keys(MOV_TIPOS).filter((k) => MOV_TIPOS[k].signo < 0).reduce((s, k) => s + porTipo[k].efectivo, 0);
    const ventasPorMetodo = {};
    Object.keys(porMetodo).forEach((k) => { ventasPorMetodo[k] = porMetodo[k] - domPorMetodo[k]; });
    return { base: base || 0, porMetodo, ventasPorMetodo, domPorMetodo, porCuenta, domicilios, nPagos, porTipo, ingresosEf, egresosEf, esperado: (base || 0) + ingresosEf - egresosEf };
  }
  function resumenTurno(t) {
    return resumen(getPagos().filter((p) => p.turnoId === t.id && !p.anulado), getMovs().filter((m) => m.turnoId === t.id), t.base);
  }
  // Cierre: guarda el arqueo y bloquea el turno. Se relee el turno justo antes de guardar para no cerrar dos veces.
  function cerrarTurno(d, por) {
    const turnos = getTurnos(), t = turnos.filter((x) => x.estado === 'abierto').pop();
    if (!t) throw new Error('No hay una caja abierta (¿ya se cerró en otra pestaña?).');
    if (d.contado === '' || d.contado == null || !(Number(d.contado) >= 0)) throw new Error('Escribe el dinero contado físicamente.');
    const res = resumenTurno(t), contado = r(d.contado);
    t.estado = 'cerrado';
    t.cierre = { en: S.nowISO(), por: por || t.cajero, contado, esperado: res.esperado, diferencia: contado - res.esperado, resumen: res, nota: txt(d.nota, 200),
      pendientes: pendientes().length };
    S.save(K.TURNOS, turnos);
    return t;
  }

  /* ---------------- Consultas ---------------- */
  // Pedidos vigentes sin pago (desde que existe este módulo)
  function pendientes() {
    const pagos = getPagos();
    return SmashDB.getOrders().filter((o) => estadoPago(o, pagos).k === 'pendiente');
  }
  const canceladosConPago = () => { const pagos = getPagos(); return SmashDB.getOrders().filter((o) => estadoPago(o, pagos).k === 'devolver'); };
  // Dinero recibido en un periodo de días locales [d1, d2] (por fecha del pago / movimiento)
  function resumenPeriodo(d1, d2) {
    const enR = (iso) => { const d = SmashExt.localDay(iso); return d >= d1 && d <= (d2 || d1); };
    return resumen(getPagos().filter((p) => !p.anulado && enR(p.en)), getMovs().filter((m) => enR(m.en)), 0);
  }

  return {
    K, METODOS, MOV_TIPOS, getCuentas, getCuenta, cuentaNombre, guardarCuenta, setCuentaActiva, getCuentasHist,
    getTurnos, turnoAbierto, abrirTurno, getPagos, pagoDe, montoACobrar, estadoPago, esAntiguo, registrarPago, anularPago,
    getMovs, registrarMovimiento, resumenTurno, cerrarTurno, pendientes, canceladosConPago, resumenPeriodo,
  };
})();
