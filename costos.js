/* ============================================================
   SMASH · costos.js
   Costo de producción por producto (desde la receta), costo
   congelado de cada pedido y historial de precios de venta.
   Requiere data.js, data-ext.js, store.js e inventario.js.
   - Nunca cambia el precio de venta (product.price).
   - Cada pedido queda "sellado" con el costo vigente cuando se vio
     por primera vez; así los informes no cambian si después sube
     un ingrediente. El sello se guarda en una llave aparte para no
     reescribir la lista de pedidos.
   - Pedidos anteriores a esta versión usan el costo manual que
     tenía cada producto el día en que se activó el módulo.
   ============================================================ */
const SmashCostos = (function () {
  const S = SmashStore, I = SmashInv;
  const K = {
    BASE: 'smash_costos_base',       // { activado, productos: {id: costo manual de ese momento} }
    PEDIDOS: 'smash_costos_pedidos', // { "id|creado": { c: {prodId: costoUnit}, en } }
    PRECIOS_ULT: 'smash_precios_ult',
    PRECIOS_HIST: 'smash_precios_hist',
  };
  const pedidoKey = (o) => o.id + '|' + o.creado;

  (function activar() {
    if (S.read(K.BASE, null)) return;
    const productos = {};
    SmashDB.getProducts().forEach((p) => { productos[p.id] = Number(p.cost) || 0; });
    try { S.save(K.BASE, { activado: S.nowISO(), productos }); } catch (e) { /* se reintenta en la próxima carga */ }
  })();

  /* ---------------- Costo de un producto ---------------- */
  function lineaCosto(l) {
    const i = I.getIngrediente(l.ingId);
    if (!i || !I.compatibles(i.unidad, l.unidad)) return { i, costo: 0, ok: false };
    const cant = I.aBase(l.cant, l.unidad);
    return { i, cant, costoU: i.costo || 0, costo: cant * (i.costo || 0), ok: (i.costo || 0) > 0 };
  }
  // fuente: 'receta' (calculado), 'manual' (campo Costo del producto) o 'sin' (no hay dato)
  function costoProducto(prodId, lineas) {
    const p = SmashDB.getProductById(prodId);
    const rec = lineas || I.getReceta(prodId);
    if (rec.length) {
      const det = rec.map(lineaCosto);
      return { costo: det.reduce((s, d) => s + d.costo, 0), fuente: 'receta', det, incompleto: det.some((d) => !d.ok) };
    }
    const m = p ? Number(p.cost) || 0 : 0;
    return { costo: m, fuente: m > 0 ? 'manual' : 'sin', det: [], incompleto: m <= 0 };
  }
  function resumenProducto(p) {
    const c = costoProducto(p.id), precio = Number(p.price) || 0;
    const ganancia = precio - c.costo;
    return Object.assign(c, { precio, ganancia, margen: precio > 0 ? (ganancia / precio) * 100 : null });
  }
  // Productos cuya receta usa un ingrediente (para avisar qué costos cambiaron)
  function productosConIngrediente(ingId) {
    const rec = I.getRecetas();
    return SmashDB.getProducts().filter((p) => (rec[p.id] || []).some((l) => l.ingId === ingId));
  }

  /* ---------------- Costo congelado de los pedidos ---------------- */
  function sellarPedidos() {
    const base = S.read(K.BASE, null);
    if (!base) return 0;
    const sellos = S.read(K.PEDIDOS, {}), cache = {};
    let n = 0;
    SmashDB.getOrders().forEach((o) => {
      const k = pedidoKey(o);
      if (sellos[k]) return;
      const antiguo = o.creado < base.activado, c = {};
      (o.items || []).forEach((it) => {
        if (c[it.id] != null) return;
        if (antiguo) c[it.id] = base.productos[it.id] || 0;
        else c[it.id] = cache[it.id] != null ? cache[it.id] : (cache[it.id] = costoProducto(it.id).costo);
      });
      sellos[k] = { c, en: S.nowISO(), antiguo };
      n++;
    });
    if (n) S.save(K.PEDIDOS, sellos);
    return n;
  }
  // Costo de producción de un pedido: con el costo sellado de cada producto.
  // Si el pedido se editó y tiene un producto nuevo, ese usa el costo actual.
  function costoPedido(o, sellos) {
    const s = (sellos || S.read(K.PEDIDOS, {}))[pedidoKey(o)];
    return (o.items || []).reduce((sum, it) => {
      const cu = s && s.c[it.id] != null ? s.c[it.id] : costoProducto(it.id).costo;
      return sum + cu * it.qty;
    }, 0);
  }
  const getSellos = () => S.read(K.PEDIDOS, {});

  /* ---------------- Historial de precios de venta ---------------- */
  // Compara los precios actuales con los últimos conocidos y anota los cambios.
  function registrarPrecios(por) {
    const ult = S.read(K.PRECIOS_ULT, null), hist = S.read(K.PRECIOS_HIST, []), nuevo = {};
    let cambios = 0;
    SmashDB.getProducts().forEach((p) => {
      const precio = Number(p.price) || 0;
      nuevo[p.id] = precio;
      const antes = ult ? ult[p.id] : undefined;
      if (antes === precio) return;
      hist.push({ prodId: p.id, nombre: p.name, antes: antes == null ? null : antes, despues: precio, origen: !ult ? 'inicial' : antes == null ? 'producto nuevo' : 'cambio', por: por || '', cuando: S.nowISO() });
      cambios++;
    });
    if (cambios || !ult) S.tx({ [K.PRECIOS_ULT]: nuevo, [K.PRECIOS_HIST]: hist.slice(-2000) });
    return cambios;
  }
  const getPreciosHist = () => S.read(K.PRECIOS_HIST, []);

  function mantener(por) {
    try { registrarPrecios(por); sellarPedidos(); } catch (e) { console.error('SmashCostos:', e.message); }
  }
  mantener('');
  setInterval(() => mantener(''), 5000);
  window.addEventListener('storage', (e) => { if (e.key === SmashDB.KEYS.ORDERS || e.key === SmashDB.KEYS.PRODUCTS) mantener(''); });

  return { K, costoProducto, resumenProducto, lineaCosto, productosConIngrediente, sellarPedidos, costoPedido, getSellos, registrarPrecios, getPreciosHist, mantener };
})();
