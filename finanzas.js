/* ============================================================
   SMASH · finanzas.js
   Registro de gastos (conceptos editables) e indicadores financieros
   por periodo. Requiere data.js, data-ext.js, store.js, comandas.js,
   costos.js, inventario.js y caja.js.

   Cómo se evita contar dos veces:
   - Ventas = pedidos no cancelados (productos − descuentos − devoluciones).
     El reembolso de un pedido YA cancelado no se resta otra vez.
   - Costo de lo vendido = costo congelado de cada pedido + pérdidas por
     cancelación. Las compras de insumos NO son gasto aquí: entran como
     costo cuando se vende lo producido (se muestran solo como dato).
   - Mermas = salidas manuales y ajustes de conteo del inventario (no
     incluye el consumo por ventas, que ya está en el costo de lo vendido).
   - Gastos: registro de gastos + gastos del día de Contabilidad + gastos
     de caja. Cada uno en una sola clase: fijo, operativo, nómina u otro.
   - Domicilios: dinero del domiciliario, fuera de ventas y gastos.
   ============================================================ */
const SmashFinanzas = (function () {
  const S = SmashStore;
  const K = { GASTOS: 'smash_gastos', CATS: 'smash_gastos_cats' };
  const CLASES = {
    fijo: 'Costo fijo', operativo: 'Gasto operativo', nomina: 'Nómina', otro: 'Otro egreso',
    insumos: 'Compra de insumos (solo informativo)',
  };
  // Conceptos iniciales (solo nombres, sin valores). Se pueden renombrar, cambiar de clase o agregar.
  const CATS0 = [
    ['arriendo', 'Arriendo', 'fijo'], ['servicios', 'Servicios públicos', 'fijo'], ['internet', 'Internet', 'fijo'],
    ['nomina', 'Nómina', 'nomina'], ['publicidad', 'Publicidad', 'operativo'], ['empaques', 'Empaques', 'operativo'],
    ['transporte', 'Transporte', 'operativo'], ['compras', 'Compras', 'insumos'], ['otros', 'Otros gastos', 'otro'],
  ].map(([k, nombre, clase]) => ({ k, nombre, clase, activa: true }));
  const r = (n) => Math.round(Number(n) || 0);
  const txt = (v, m) => String(v == null ? '' : v).trim().slice(0, m);

  /* ---------------- Conceptos y registro de gastos ---------------- */
  const getCats = () => { const c = S.read(K.CATS, null); return Array.isArray(c) && c.length ? c : CATS0.map((x) => Object.assign({}, x)); };
  function guardarCats(list) {
    const usadas = {};
    const clean = list.map((c) => {
      const nombre = txt(c.nombre, 50);
      if (!nombre) throw new Error('Cada concepto necesita un nombre.');
      if (!CLASES[c.clase]) throw new Error('Elige la clase de "' + nombre + '".');
      let k = c.k || nombre.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'gasto';
      while (usadas[k]) k += '1';
      usadas[k] = true;
      return { k, nombre, clase: c.clase, activa: c.activa !== false };
    });
    S.save(K.CATS, clean);
    return clean;
  }
  const getGastos = () => S.read(K.GASTOS, []);
  // frecuencia "mensual": el valor se reparte por igual en los días de ese mes (arriendo, internet...)
  function registrarGasto(d, por) {
    const cat = getCats().find((c) => c.k === d.cat);
    if (!cat) throw new Error('Elige el concepto.');
    const monto = r(d.monto);
    if (!(monto > 0)) throw new Error('Escribe el valor.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) throw new Error('Elige la fecha.');
    const g = {
      id: S.uid('g'), fecha: d.fecha, cat: cat.k, catNombre: cat.nombre, clase: cat.clase, descripcion: txt(d.descripcion, 150),
      monto, frecuencia: d.frecuencia === 'mensual' ? 'mensual' : 'unico', por: por || '', en: S.nowISO(),
    };
    const list = getGastos(); list.push(g); S.save(K.GASTOS, list);
    return g;
  }
  // Los gastos no se borran: se anulan con motivo (queda el historial)
  function anularGasto(id, motivo, por) {
    const list = getGastos(), g = list.find((x) => x.id === id);
    if (!g || g.anulado) throw new Error('El gasto no existe o ya estaba anulado.');
    const m = txt(motivo, 150);
    if (!m) throw new Error('Escribe por qué se anula.');
    g.anulado = { motivo: m, por: por || '', en: S.nowISO() };
    S.save(K.GASTOS, list);
  }

  /* ---------------- Fechas ---------------- */
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function dias(d1, d2) { const out = []; for (let d = d1; d <= d2 && out.length < 1000; d = addDays(d, 1)) out.push(d); return out; }
  const diasDelMes = (ym) => new Date(+ym.slice(0, 4), +ym.slice(5, 7), 0).getDate();
  function periodo(tipo, ref) {
    const d = new Date(ref + 'T12:00:00'), ymd = (x) => new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (tipo === 'semana') { const a = new Date(d); a.setDate(d.getDate() - ((d.getDay() + 6) % 7)); const b = new Date(a); b.setDate(a.getDate() + 6); return [ymd(a), ymd(b)]; }
    if (tipo === 'mes') return [ymd(new Date(d.getFullYear(), d.getMonth(), 1, 12)), ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12))];
    return [ref, ref];
  }
  // Periodo anterior de la misma duración (para comparar)
  function anterior(d1, d2) { const n = dias(d1, d2).length; return [addDays(d1, -n), addDays(d1, -1)]; }

  /* ---------------- Indicadores ---------------- */
  function calcular(d1, d2) {
    const enR = (day) => day >= d1 && day <= d2, ld = SmashExt.localDay;
    const orders = SmashDB.getOrders();
    const validos = orders.filter((o) => SmashComandas.valido(o) && enR(ld(o.creado)));
    const sellos = SmashCostos.getSellos();
    const brutas = validos.reduce((s, o) => s + (o.subtotal || 0), 0);
    const descuentos = validos.reduce((s, o) => s + (o.descuento || 0), 0);

    // Devoluciones: movimientos de caja. Si apuntan a un pedido cancelado, ya no estaba en ventas.
    const movs = SmashCaja.getMovs().filter((m) => enR(ld(m.en)));
    let devoluciones = 0, reembolsosCancelados = 0;
    const devDia = {};
    movs.filter((m) => m.tipo === 'devolucion').forEach((m) => {
      const md = ld(m.en), prev = addDays(md, -1);
      const o = m.pedidoNum ? orders.find((x) => String(x.numeroDia || x.id) === String(m.pedidoNum).replace('#', '') && [md, prev].indexOf(ld(x.creado)) > -1) : null;
      if (o && o.status === 'cancelado') reembolsosCancelados += m.monto;
      else { devoluciones += m.monto; devDia[md] = (devDia[md] || 0) + m.monto; }
    });
    const netas = brutas - descuentos - devoluciones;
    const nPedidos = validos.length;
    const perdidas = orders.filter((o) => o.status === 'cancelado' && enR(ld(o.creado))).reduce((s, o) => s + ((o.cancelacion && o.cancelacion.perdida) || 0), 0);
    const costoVendido = validos.reduce((s, o) => s + SmashCostos.costoPedido(o, sellos), 0) + perdidas;
    const margenBruto = netas - costoVendido;

    // Mermas de inventario (salidas manuales y conteos; positivo = pérdida)
    const MERMA = ['desperdicio', 'danado', 'consumo', 'error', 'ajuste_menos', 'ajuste_mas', 'conteo'];
    const invMovs = SmashInv.getMovimientos().filter((m) => MERMA.indexOf(m.tipo) > -1 && enR(m.fecha));
    const mermas = Math.round(invMovs.reduce((s, m) => s - m.cant * (m.costo || 0), 0));
    const compras = SmashInv.getMovimientos().filter((m) => m.tipo === 'compra' && enR(m.fecha)).reduce((s, m) => s + (m.precioTotal || 0), 0);

    // Gastos por clase
    const g = { fijo: 0, operativo: 0, nomina: 0, otro: 0, insumos: 0 }, detalle = {};
    const sumar = (clase, concepto, v) => { if (!v) return; g[clase] += v; const k = clase + '|' + concepto; detalle[k] = (detalle[k] || { clase, concepto, v: 0 }); detalle[k].v += v; };
    const diasR = dias(d1, d2);
    getGastos().filter((x) => !x.anulado).forEach((x) => {
      if (x.frecuencia === 'mensual') {
        const ym = x.fecha.slice(0, 7), dm = diasDelMes(ym), n = diasR.filter((d) => d.slice(0, 7) === ym).length;
        sumar(x.clase, x.catNombre, Math.round((x.monto * n) / dm));
      } else if (enR(x.fecha)) sumar(x.clase, x.catNombre, x.monto);
    });
    const gd = S.read(SmashDB.KEYS.GASTOS_DIA, {});
    Object.keys(gd).filter(enR).forEach((d) => {
      const v = gd[d] || {};
      sumar('nomina', 'Nómina (Contabilidad)', r(v.nomina)); sumar('operativo', 'Publicidad (Contabilidad)', r(v.publicidad));
      sumar('fijo', 'Servicios (Contabilidad)', r(v.servicios)); sumar('otro', 'Otros (Contabilidad)', r(v.otros));
    });
    sumar('operativo', 'Gastos de caja', movs.filter((m) => m.tipo === 'gasto').reduce((s, m) => s + m.monto, 0));
    sumar('operativo', 'Mermas de inventario', Math.max(0, mermas));
    if (mermas < 0) sumar('otro', 'Ajustes de inventario a favor', mermas);

    const utilidad = margenBruto - g.operativo - g.fijo - g.nomina - g.otro;

    // Cobrado por medio de pago (solo productos, sin domicilios aunque el cliente los haya pagado a SMASH)
    // por fecha del pago + pedidos antiguos por el medio anunciado
    const caja = SmashCaja.resumenPeriodo(d1, d2), pagos = SmashCaja.getPagos();
    const medios = Object.assign({}, caja.ventasPorMetodo);
    validos.forEach((o) => { if (SmashCaja.estadoPago(o, pagos).k === 'antiguo') { const k = /transf/i.test(o.pago) ? 'transferencia' : /efect/i.test(o.pago) ? 'efectivo' : 'otro'; medios[k] += (o.subtotal || 0) - (o.descuento || 0); } });

    // Nómina estimada con el personal registrado (solo referencia, no se suma)
    const DI = SmashExt.DIAS;
    const nominaEstimada = diasR.reduce((s, d) => { const dia = DI[(new Date(d + 'T12:00:00').getDay() + 6) % 7]; return s + SmashExt.getPersonal().filter((p) => (p.dias || []).indexOf(dia) > -1).reduce((a, p) => a + (p.pago || 0), 0); }, 0);

    // Serie diaria para el gráfico
    const serie = diasR.map((d) => {
      const os = validos.filter((o) => ld(o.creado) === d);
      const v = os.reduce((s, o) => s + (o.subtotal || 0) - (o.descuento || 0), 0) - (devDia[d] || 0);
      return { d, ventas: v, pedidos: os.length, costo: Math.round(os.reduce((s, o) => s + SmashCostos.costoPedido(o, sellos), 0)) };
    });

    return {
      d1, d2, brutas, descuentos, devoluciones, reembolsosCancelados, netas, nPedidos, ticket: nPedidos ? (brutas - descuentos) / nPedidos : 0,
      costoVendido: Math.round(costoVendido), perdidas, margenBruto: Math.round(margenBruto), margenPct: netas > 0 ? (margenBruto / netas) * 100 : null,
      gastos: g, detalleGastos: Object.values(detalle), utilidad: Math.round(utilidad), utilidadPct: netas > 0 ? (utilidad / netas) * 100 : null,
      medios, domiciliosCobrados: caja.domicilios, domicilios: validos.reduce((s, o) => s + (o.domicilio || 0), 0),
      compras, mermas, nominaEstimada, serie, cancelados: orders.filter((o) => o.status === 'cancelado' && enR(ld(o.creado))).length,
    };
  }

  /* ---------------- Análisis de productos ----------------
     Clasificación por volumen (unidades) y ganancia por unidad, comparando con el promedio
     de los productos vendidos en el periodo (método de ingeniería de menú). */
  const CLASIF = {
    estrella: { n: 'Estrella', d: 'Se vende mucho y deja buena ganancia: mantenla y destácala.' },
    caballo: { n: 'Caballo de batalla', d: 'Se vende mucho pero deja poca ganancia por unidad: revisa costo o precio.' },
    enigma: { n: 'Rompecabezas', d: 'Deja buena ganancia pero se vende poco: promociónala o cámbiale la presentación.' },
    perro: { n: 'Bajo rendimiento', d: 'Se vende poco y deja poca ganancia: evalúa si vale la pena mantenerla.' },
  };
  function productos(d1, d2) {
    const ld = SmashExt.localDay, sellos = SmashCostos.getSellos(), map = {};
    SmashDB.getOrders().filter((o) => SmashComandas.valido(o) && ld(o.creado) >= d1 && ld(o.creado) <= d2).forEach((o) => {
      const s = sellos[o.id + '|' + o.creado];
      (o.items || []).forEach((it) => {
        const p = SmashDB.getProductById(it.id);
        const m = map[it.id] = map[it.id] || { id: it.id, nombre: it.name, cat: it.cat || (p ? p.categoria : ''), q: 0, ventas: 0, costo: 0 };
        const cu = s && s.c[it.id] != null ? s.c[it.id] : SmashCostos.costoProducto(it.id).costo;
        m.q += it.qty; m.ventas += it.price * it.qty; m.costo += cu * it.qty; m.nombre = it.name;
      });
    });
    const list = Object.values(map).map((m) => Object.assign(m, { ganancia: m.ventas - m.costo, margen: m.ventas ? ((m.ventas - m.costo) / m.ventas) * 100 : null, gu: m.q ? (m.ventas - m.costo) / m.q : 0 }));
    if (list.length) {
      const qProm = list.reduce((s, m) => s + m.q, 0) / list.length;
      const guProm = list.reduce((s, m) => s + m.ganancia, 0) / Math.max(1, list.reduce((s, m) => s + m.q, 0));
      list.forEach((m) => { const alto = m.q >= qProm, rent = m.gu >= guProm; m.clase = alto && rent ? 'estrella' : alto ? 'caballo' : rent ? 'enigma' : 'perro'; });
    }
    return list;
  }

  return { K, CLASES, CLASIF, getCats, guardarCats, getGastos, registrarGasto, anularGasto, periodo, anterior, dias, calcular, productos };
})();
