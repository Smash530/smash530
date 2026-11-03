/* ============================================================
   SMASH · comandas.js
   Estados de la comanda, tiempos, cancelaciones y novedades.
   Requiere data.js, data-ext.js y store.js. Si están cargados,
   usa inventario.js (reintegro de insumos) y costos.js (pérdida).
   Los pedidos NO se borran: un pedido cancelado queda guardado con
   su motivo, responsable y pérdida, y sale de ventas e informes.
   ============================================================ */
const SmashComandas = (function () {
  const S = SmashStore;
  const ESTADOS = [
    { k: 'nuevo', n: 'Pedido recibido' },
    { k: 'confirmado', n: 'Pedido confirmado' },
    { k: 'preparando', n: 'En preparación' },
    { k: 'listo', n: 'Listo para despacho' },
    { k: 'en_camino', n: 'En camino' },
    { k: 'entregado', n: 'Entregado' },
    { k: 'cancelado', n: 'Cancelado' },
  ];
  const NOMBRE = {};
  ESTADOS.forEach((e) => { NOMBRE[e.k] = e.n; });
  const NEXT = { nuevo: 'confirmado', confirmado: 'preparando', preparando: 'listo', listo: 'en_camino', en_camino: 'entregado' };
  const NEXT_LABEL = { nuevo: '✔ Confirmar pedido', confirmado: '🔥 Iniciar preparación', preparando: '✅ Marcar listo', listo: '🛵 Marcar en camino', en_camino: '📦 Marcar entregado' };
  const YA_EN_COCINA = ['preparando', 'listo', 'en_camino', 'entregado'];
  const RESP = 'smash_ultimo_responsable';

  const valido = (o) => o.status !== 'cancelado';
  const vigentes = (orders) => orders.filter(valido);
  // Número de comanda único: AAMMDD-NN (fecha local + número del día)
  const codigo = (o) => SmashExt.localDay(o.creado).replace(/-/g, '').slice(2) + '-' + String(o.numeroDia || o.id).padStart(2, '0');

  // Valor de productos, adicionales, descuentos y domicilio, siempre por separado
  function desglose(o) {
    let productos = 0, adicionales = 0;
    (o.items || []).forEach((it) => {
      const p = SmashDB.getProductById(it.id), cat = it.cat || (p ? p.categoria : '');
      if (cat === 'adicional') adicionales += it.price * it.qty; else productos += it.price * it.qty;
    });
    const descuento = Number(o.descuento) || 0, domicilio = Number(o.domicilio) || 0;
    return { productos, adicionales, descuento, domicilio, total: Number(o.total) || 0 };
  }

  /* ---------------- Tiempos ---------------- */
  const ms = (a, b) => (a && b ? new Date(b).getTime() - new Date(a).getTime() : null);
  function tiempos(o) {
    return {
      confirmacion: ms(o.creado, o.confirmadoEn),
      preparacion: ms(o.preparandoEn, o.listoEn),
      entrega: ms(o.salioEn, o.entregadoEn),
      total: ms(o.creado, o.entregadoEn),
    };
  }
  function promedios(orders) {
    const acc = { confirmacion: [], preparacion: [], entrega: [], total: [] };
    vigentes(orders).forEach((o) => {
      const t = tiempos(o);
      Object.keys(acc).forEach((k) => { if (t[k] != null && t[k] >= 0) acc[k].push(t[k]); });
    });
    const out = {};
    Object.keys(acc).forEach((k) => { out[k] = acc[k].length ? { prom: acc[k].reduce((s, x) => s + x, 0) / acc[k].length, n: acc[k].length } : null; });
    return out;
  }
  function dur(v) {
    if (v == null) return '-';
    const m = Math.round(v / 60000);
    return m < 60 ? m + ' min' : Math.floor(m / 60) + ' h ' + (m % 60) + ' min';
  }

  /* ---------------- Cancelación ----------------
     - Antes de cocina (recibido/confirmado): sin pérdida y sin tocar el inventario.
     - Desde "En preparación": si se alcanzó a preparar, los insumos se pierden y la
       pérdida es el costo de producción. Si NO se preparó, se reintegran los insumos.
     Pedido e inventario se guardan juntos (todo o nada). */
  function infoCancelacion(o) {
    const enCocina = YA_EN_COCINA.indexOf(o.status) > -1;
    let consumos = [];
    if (typeof SmashInv !== 'undefined') {
      const k = SmashInv.pedidoKey(o);
      consumos = SmashInv.getMovimientos().filter((m) => m.tipo === 'venta' && m.pedidoKey === k && m.ingId);
    }
    const costo = typeof SmashCostos !== 'undefined' ? SmashCostos.costoPedido(o) : 0;
    return { enCocina, consumos, costo };
  }
  function cancelar(id, d, por) {
    const K = SmashDB.KEYS, orders = S.read(K.ORDERS, []), o = orders.find((x) => x.id === id);
    if (!o) throw new Error('El pedido ya no existe.');
    if (o.status === 'cancelado') throw new Error('Este pedido ya estaba cancelado.');
    if (o.status === 'entregado') throw new Error('Un pedido entregado no se cancela; registra una devolución en caja.');
    const motivo = String(d.motivo || '').trim().slice(0, 200), responsable = String(d.responsable || '').trim().slice(0, 60);
    if (!motivo) throw new Error('Escribe el motivo de la cancelación.');
    if (!responsable) throw new Error('Escribe quién es el responsable.');
    const info = infoCancelacion(o);
    const preparado = info.enCocina && d.preparado !== false;
    const changes = {};
    if (info.consumos.length && !preparado) {
      const ings = SmashInv.getIngredientes(), movs = SmashInv.getMovimientos();
      info.consumos.forEach((m) => {
        const i = ings.find((x) => x.id === m.ingId);
        if (!i) return;
        i.stock = Math.round((i.stock - m.cant) * 1000) / 1000;
        movs.push({ id: S.uid('m'), ingId: i.id, ingNombre: i.nombre, tipo: 'reintegro', cant: -m.cant, costo: m.costo, valor: m.valor, fecha: S.today(),
          pedidoKey: m.pedidoKey, pedidoNum: m.pedidoNum, motivo: 'Pedido #' + m.pedidoNum + ' cancelado sin preparar', por: por || '', creado: S.nowISO() });
      });
      changes[SmashInv.K.ING] = ings;
      changes[SmashInv.K.MOV] = movs;
    }
    o.cancelacion = {
      motivo, responsable, etapa: o.status, preparado, perdida: preparado ? Math.round(info.costo) : 0,
      ingredientes: preparado ? info.consumos.map((m) => ({ ingId: m.ingId, nombre: m.ingNombre, cant: -m.cant, valor: m.valor })) : [],
      reintegrado: !preparado && info.consumos.length > 0, por: por || '', en: S.nowISO(),
    };
    o.status = 'cancelado';
    o.canceladoEn = o.cancelacion.en;
    changes[K.ORDERS] = orders;
    S.tx(changes);
    try { localStorage.setItem(RESP, JSON.stringify(responsable)); } catch (e) { /* opcional */ }
    return o;
  }
  const ultimoResponsable = () => S.read(RESP, '');

  /* ---------------- Novedades ---------------- */
  function agregarNovedad(id, texto, por) {
    const K = SmashDB.KEYS, orders = S.read(K.ORDERS, []), o = orders.find((x) => x.id === id);
    if (!o) throw new Error('El pedido ya no existe.');
    const t = String(texto || '').trim().slice(0, 300);
    if (!t) throw new Error('Escribe la novedad.');
    (o.novedades = o.novedades || []).push({ texto: t, por: por || '', en: S.nowISO() });
    S.save(K.ORDERS, orders);
    return o;
  }

  return { ESTADOS, NOMBRE, NEXT, NEXT_LABEL, YA_EN_COCINA, valido, vigentes, codigo, desglose, tiempos, promedios, dur, infoCancelacion, cancelar, ultimoResponsable, agregarNovedad };
})();
