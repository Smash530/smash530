/* ============================================================
   SMASH · inventario.js
   Materias primas, compras, salidas, conteo físico y recetas.
   Requiere data.js, data-ext.js y store.js. No modifica pedidos
   ni productos: solo lee los pedidos para descontar insumos.
   Cantidades y costos se guardan en la unidad base del grupo
   (g, ml o und); la pantalla los muestra en la unidad elegida.
   ============================================================ */
const SmashInv = (function () {
  const S = SmashStore;
  const K = {
    ING: 'smash_ingredientes',
    MOV: 'smash_inv_movs',
    REC: 'smash_recetas',
    REC_HIST: 'smash_recetas_hist',
    COSTO_HIST: 'smash_costos_hist',
    CONTEOS: 'smash_inv_conteos',
    DESDE: 'smash_inv_desde', // desde cuándo se descuentan las ventas (no es retroactivo)
  };

  /* ---------------- Unidades ---------------- */
  const UNIDADES = {
    g: { base: 'g', f: 1, n: 'Gramos' },
    kg: { base: 'g', f: 1000, n: 'Kilogramos' },
    ml: { base: 'ml', f: 1, n: 'Mililitros' },
    l: { base: 'ml', f: 1000, n: 'Litros' },
    und: { base: 'und', f: 1, n: 'Unidades' },
  };
  const okUnidad = (u) => Object.prototype.hasOwnProperty.call(UNIDADES, u);
  const compatibles = (a, b) => okUnidad(a) && okUnidad(b) && UNIDADES[a].base === UNIDADES[b].base;
  const unidadesDe = (u) => Object.keys(UNIDADES).filter((x) => compatibles(x, u));
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const aBase = (cant, u) => r3((Number(cant) || 0) * UNIDADES[u].f);
  const deBase = (cant, u) => (Number(cant) || 0) / UNIDADES[u].f;

  const TIPOS = {
    inicial: { n: 'Inventario inicial', signo: 1 },
    compra: { n: 'Compra', signo: 1 },
    venta: { n: 'Consumo por venta', signo: -1 },
    desperdicio: { n: 'Desperdicio', signo: -1 },
    danado: { n: 'Producto dañado', signo: -1 },
    consumo: { n: 'Consumo interno', signo: -1 },
    error: { n: 'Pérdida por error de preparación', signo: -1 },
    ajuste_menos: { n: 'Ajuste (resta)', signo: -1 },
    ajuste_mas: { n: 'Ajuste (suma)', signo: 1 },
    conteo: { n: 'Ajuste por conteo físico', signo: 0 },
    reintegro: { n: 'Reintegro por cancelación', signo: 1 },
  };
  const SALIDAS = ['desperdicio', 'danado', 'consumo', 'error', 'ajuste_menos', 'ajuste_mas'];

  if (!S.read(K.DESDE, null)) { try { S.save(K.DESDE, S.nowISO()); } catch (e) { /* se reintenta en la próxima carga */ } }

  /* ---------------- Materias primas ---------------- */
  const getIngredientes = () => S.read(K.ING, []);
  const getIngrediente = (id) => getIngredientes().find((i) => i.id === id) || null;
  const getMovimientos = () => S.read(K.MOV, []);

  function estado(i) {
    if (i.activo === false) return { k: 'inactivo', n: 'Inactivo' };
    if (i.stock <= 0) return { k: 'agotado', n: 'Agotado' };
    if (i.minimo > 0 && i.stock <= i.minimo) return { k: 'bajo', n: 'Bajo mínimo' };
    return { k: 'ok', n: 'Disponible' };
  }
  const valor = (i) => Math.max(0, i.stock) * (i.costo || 0);

  function txt(v, max) { return String(v == null ? '' : v).trim().slice(0, max); }
  function mov(i, tipo, cantBase, extra) {
    return Object.assign({
      id: S.uid('m'), ingId: i.id, ingNombre: i.nombre, tipo, cant: r3(cantBase), costo: i.costo || 0,
      valor: Math.round(Math.abs(cantBase) * (i.costo || 0)), fecha: S.today(), motivo: '', por: '', creado: S.nowISO(),
    }, extra || {});
  }
  function costoHist(hist, i, antes, despues, origen, por) {
    if (antes === despues) return;
    hist.push({ ingId: i.id, ingNombre: i.nombre, antes, despues, origen, por: por || '', cuando: S.nowISO() });
  }

  // Crea o edita una materia prima. La existencia NO se edita aquí: se mueve con compras, salidas o conteos.
  function guardarIngrediente(d, por) {
    const list = getIngredientes();
    const nombre = txt(d.nombre, 80);
    if (!nombre) throw new Error('Escribe el nombre del ingrediente.');
    if (list.some((x) => x.id !== d.id && x.nombre.toLowerCase() === nombre.toLowerCase())) throw new Error('Ya existe un ingrediente con ese nombre.');
    const unidad = d.unidad;
    if (!okUnidad(unidad)) throw new Error('Elige una unidad de medida.');
    const costoU = Number(d.costo);
    if (!(costoU >= 0)) throw new Error('El costo debe ser un número igual o mayor a 0.');
    const costo = costoU / UNIDADES[unidad].f; // por unidad base
    const minimo = Math.max(0, aBase(d.minimo, unidad));
    const movs = getMovimientos(), hist = S.read(K.COSTO_HIST, []);
    let ing;
    if (d.id) {
      ing = list.find((x) => x.id === d.id);
      if (!ing) throw new Error('El ingrediente ya no existe.');
      if (!compatibles(ing.unidad, unidad)) throw new Error('Solo puedes cambiar a una unidad compatible (' + unidadesDe(ing.unidad).join(', ') + ').');
      costoHist(hist, ing, ing.costo, costo, 'edición', por);
      Object.assign(ing, { nombre, categoria: txt(d.categoria, 40), unidad, costo, minimo, proveedor: txt(d.proveedor, 80), activo: d.activo !== false, actualizado: S.nowISO() });
    } else {
      const inicial = Number(d.inicial) || 0;
      if (inicial < 0) throw new Error('La cantidad inicial no puede ser negativa.');
      ing = { id: S.uid('i'), nombre, categoria: txt(d.categoria, 40), unidad, stock: 0, costo, minimo, proveedor: txt(d.proveedor, 80), activo: true, creado: S.nowISO(), actualizado: S.nowISO() };
      list.push(ing);
      if (inicial > 0) {
        ing.stock = aBase(inicial, unidad);
        movs.push(mov(ing, 'inicial', ing.stock, { motivo: 'Registro del ingrediente', por: por || '' }));
      }
      costoHist(hist, ing, null, costo, 'registro', por);
    }
    S.tx({ [K.ING]: list, [K.MOV]: movs, [K.COSTO_HIST]: hist });
    return ing;
  }
  function setActivo(id, activo) {
    const list = getIngredientes(), i = list.find((x) => x.id === id);
    if (!i) return;
    i.activo = !!activo; i.actualizado = S.nowISO();
    S.save(K.ING, list);
  }
  // Solo se puede borrar si nunca tuvo movimientos ni está en una receta; si no, se desactiva.
  function enUso(id) {
    if (getMovimientos().some((m) => m.ingId === id)) return true;
    const rec = S.read(K.REC, {});
    return Object.keys(rec).some((p) => (rec[p] || []).some((l) => l.ingId === id));
  }
  function eliminarIngrediente(id) {
    if (enUso(id)) throw new Error('Este ingrediente tiene historial o está en una receta. Desactívalo en lugar de eliminarlo.');
    S.save(K.ING, getIngredientes().filter((x) => x.id !== id));
  }

  /* ---------------- Compras (entradas) ---------------- */
  // El costo del ingrediente pasa a ser el de la última compra (precio total / cantidad).
  function registrarCompra(d, por) {
    const list = getIngredientes(), i = list.find((x) => x.id === d.ingId);
    if (!i) throw new Error('Elige el ingrediente.');
    if (!compatibles(i.unidad, d.unidad)) throw new Error('La unidad no es compatible con ' + i.nombre + '.');
    const cant = aBase(d.cantidad, d.unidad), total = Number(d.precioTotal);
    if (!(cant > 0)) throw new Error('La cantidad comprada debe ser mayor a 0.');
    if (!(total >= 0)) throw new Error('Escribe el precio total pagado.');
    const hist = S.read(K.COSTO_HIST, []), movs = getMovimientos();
    const nuevo = total / cant;
    costoHist(hist, i, i.costo, nuevo, 'compra', por);
    i.costo = nuevo;
    i.stock = r3(i.stock + cant);
    if (d.proveedor) i.proveedor = txt(d.proveedor, 80);
    i.actualizado = S.nowISO();
    const m = mov(i, 'compra', cant, {
      valor: Math.round(total), precioTotal: Math.round(total), cantOrig: Number(d.cantidad), unidadOrig: d.unidad,
      fecha: d.fecha || S.today(), proveedor: txt(d.proveedor, 80), motivo: txt(d.obs, 200), por: por || '',
    });
    movs.push(m);
    S.tx({ [K.ING]: list, [K.MOV]: movs, [K.COSTO_HIST]: hist });
    return m;
  }

  /* ---------------- Salidas manuales ---------------- */
  function registrarSalida(d, por) {
    if (SALIDAS.indexOf(d.tipo) < 0) throw new Error('Elige el tipo de movimiento.');
    const list = getIngredientes(), i = list.find((x) => x.id === d.ingId);
    if (!i) throw new Error('Elige el ingrediente.');
    if (!compatibles(i.unidad, d.unidad)) throw new Error('La unidad no es compatible con ' + i.nombre + '.');
    const cant = aBase(d.cantidad, d.unidad);
    if (!(cant > 0)) throw new Error('La cantidad debe ser mayor a 0.');
    const motivo = txt(d.motivo, 200);
    if (!motivo) throw new Error('Escribe el motivo.');
    const signed = cant * TIPOS[d.tipo].signo;
    i.stock = r3(i.stock + signed);
    i.actualizado = S.nowISO();
    const movs = getMovimientos();
    const m = mov(i, d.tipo, signed, { fecha: d.fecha || S.today(), motivo, por: por || '', cantOrig: Number(d.cantidad), unidadOrig: d.unidad });
    movs.push(m);
    S.tx({ [K.ING]: list, [K.MOV]: movs });
    return m;
  }

  /* ---------------- Recetas (ficha técnica por producto) ---------------- */
  const getRecetas = () => S.read(K.REC, {});
  const getReceta = (prodId) => (getRecetas()[prodId] || []).slice();
  function setReceta(prodId, lineas, por) {
    if (!SmashDB.getProductById(prodId)) throw new Error('El producto no existe.');
    const ings = getIngredientes();
    const clean = [];
    (lineas || []).forEach((l) => {
      const i = ings.find((x) => x.id === l.ingId);
      if (!i) throw new Error('Hay una línea sin ingrediente.');
      if (!compatibles(i.unidad, l.unidad)) throw new Error('Unidad no compatible para ' + i.nombre + '.');
      const c = Number(l.cant);
      if (!(c > 0)) throw new Error('La cantidad de ' + i.nombre + ' debe ser mayor a 0.');
      clean.push({ ingId: i.id, cant: c, unidad: l.unidad });
    });
    const rec = getRecetas(), hist = S.read(K.REC_HIST, []);
    const antes = rec[prodId] || [];
    if (JSON.stringify(antes) === JSON.stringify(clean)) return clean;
    hist.push({ prodId, antes, despues: clean, por: por || '', cuando: S.nowISO() });
    if (clean.length) rec[prodId] = clean; else delete rec[prodId];
    S.tx({ [K.REC]: rec, [K.REC_HIST]: hist.slice(-1000) });
    return clean;
  }
  const getRecetasHist = () => S.read(K.REC_HIST, []);
  const getCostosHist = () => S.read(K.COSTO_HIST, []);

  /* ---------------- Consumo por ventas ----------------
     Se descuenta UNA sola vez por pedido, cuando pasa a "En preparación".
     La marca del pedido (id + fecha de creación) queda en el movimiento,
     así un segundo intento (otra pestaña, doble clic) no descuenta de nuevo. */
  const pedidoKey = (o) => o.id + '|' + o.creado;
  function yaDescontado(o, movs) {
    const k = pedidoKey(o);
    return (movs || getMovimientos()).some((m) => m.tipo === 'venta' && m.pedidoKey === k);
  }
  function consumirPedido(o, por) {
    if (!o || !o.items) return { ok: false, motivo: 'sin pedido' };
    const movs = getMovimientos();
    if (yaDescontado(o, movs)) return { ok: true, repetido: true };
    const list = getIngredientes(), rec = getRecetas(), porIng = {}, sinReceta = [];
    o.items.forEach((it) => {
      const lineas = rec[it.id];
      if (!lineas || !lineas.length) { sinReceta.push(it.name); return; }
      lineas.forEach((l) => {
        const i = list.find((x) => x.id === l.ingId);
        if (!i || !compatibles(i.unidad, l.unidad)) return;
        porIng[i.id] = r3((porIng[i.id] || 0) + aBase(l.cant, l.unidad) * it.qty);
      });
    });
    const k = pedidoKey(o), num = o.numeroDia || o.id;
    Object.keys(porIng).forEach((id) => {
      const i = list.find((x) => x.id === id);
      i.stock = r3(i.stock - porIng[id]);
      movs.push(mov(i, 'venta', -porIng[id], { pedidoKey: k, pedidoNum: num, fecha: SmashExt.localDay(o.creado), motivo: 'Pedido #' + num, por: por || '' }));
    });
    // Aunque ningún producto tenga receta, se deja constancia para no reintentar.
    if (!Object.keys(porIng).length) {
      movs.push({ id: S.uid('m'), ingId: '', ingNombre: '', tipo: 'venta', cant: 0, costo: 0, valor: 0, pedidoKey: k, pedidoNum: num, fecha: SmashExt.localDay(o.creado), motivo: 'Pedido #' + num + ' sin recetas registradas', por: por || '', creado: S.nowISO() });
    }
    S.tx({ [K.ING]: list, [K.MOV]: movs });
    return { ok: true, sinReceta };
  }
  // Si un pedido ya descontado se edita (cambian productos o cantidades), se descuenta o devuelve
  // solo la diferencia frente a lo que ya se había descontado.
  function reajustarPedido(o, por) {
    if (!o || !o.items) return 0;
    const movs = getMovimientos(), k = pedidoKey(o);
    if (!movs.some((m) => m.tipo === 'venta' && m.pedidoKey === k)) return 0;
    const list = getIngredientes(), rec = getRecetas(), esperado = {}, actual = {};
    o.items.forEach((it) => (rec[it.id] || []).forEach((l) => {
      const i = list.find((x) => x.id === l.ingId);
      if (i && compatibles(i.unidad, l.unidad)) esperado[i.id] = r3((esperado[i.id] || 0) + aBase(l.cant, l.unidad) * it.qty);
    }));
    movs.filter((m) => m.pedidoKey === k && m.ingId && (m.tipo === 'venta' || m.tipo === 'reintegro')).forEach((m) => { actual[m.ingId] = r3((actual[m.ingId] || 0) - m.cant); });
    const num = o.numeroDia || o.id;
    let n = 0;
    Object.keys(Object.assign({}, esperado, actual)).forEach((id) => {
      const dif = r3((esperado[id] || 0) - (actual[id] || 0)), i = list.find((x) => x.id === id);
      if (!i || !dif) return;
      i.stock = r3(i.stock - dif);
      movs.push(mov(i, 'venta', -dif, { pedidoKey: k, pedidoNum: num, fecha: SmashExt.localDay(o.creado), motivo: 'Pedido #' + num + ' editado (ajuste)', por: por || '' }));
      n++;
    });
    if (n) S.tx({ [K.ING]: list, [K.MOV]: movs });
    return n;
  }
  // Repasa pedidos ya en preparación (o después) que no se descontaron, por ejemplo
  // si se avanzaron en otra pestaña sin este módulo. Solo desde la activación del módulo.
  function sincronizarPedidos(por) {
    const desde = S.read(K.DESDE, null);
    if (!desde) return 0;
    const movs = getMovimientos();
    let n = 0;
    SmashDB.getOrders().forEach((o) => {
      if (!o.preparandoEn || o.preparandoEn < desde) return;
      if (['preparando', 'listo', 'en_camino', 'entregado'].indexOf(o.status) < 0) return;
      if (yaDescontado(o, movs)) return;
      consumirPedido(o, por);
      n++;
    });
    return n;
  }

  /* ---------------- Conteo físico ---------------- */
  // lineas: [{ ingId, fisico, unidad }] → ajusta existencias y guarda el comparativo.
  function guardarConteo(lineas, por, nota) {
    const list = getIngredientes(), movs = getMovimientos(), conteos = S.read(K.CONTEOS, []);
    const det = [];
    (lineas || []).forEach((l) => {
      if (l.fisico === '' || l.fisico == null) return;
      const i = list.find((x) => x.id === l.ingId);
      if (!i) return;
      const fisico = aBase(l.fisico, l.unidad || i.unidad);
      if (fisico < 0) throw new Error('La cantidad física de ' + i.nombre + ' no puede ser negativa.');
      const dif = r3(fisico - i.stock);
      det.push({ ingId: i.id, ingNombre: i.nombre, unidad: i.unidad, sistema: i.stock, fisico, dif, costo: i.costo || 0, valorDif: Math.round(dif * (i.costo || 0)) });
      if (dif !== 0) {
        movs.push(mov(i, 'conteo', dif, { motivo: 'Conteo físico' + (nota ? ': ' + txt(nota, 120) : ''), por: por || '' }));
        i.stock = fisico;
        i.actualizado = S.nowISO();
      }
    });
    if (!det.length) throw new Error('Escribe al menos una cantidad encontrada.');
    const c = { id: S.uid('c'), fecha: S.today(), creado: S.nowISO(), por: por || '', nota: txt(nota, 120), lineas: det, valorDif: det.reduce((s, x) => s + x.valorDif, 0) };
    conteos.push(c);
    S.tx({ [K.ING]: list, [K.MOV]: movs, [K.CONTEOS]: conteos });
    return c;
  }
  const getConteos = () => S.read(K.CONTEOS, []);

  return {
    K, UNIDADES, TIPOS, pedidoKey, SALIDAS, compatibles, unidadesDe, aBase, deBase, estado, valor,
    getIngredientes, getIngrediente, guardarIngrediente, setActivo, eliminarIngrediente, enUso,
    registrarCompra, registrarSalida, getMovimientos,
    getRecetas, getReceta, setReceta, getRecetasHist, getCostosHist,
    consumirPedido, reajustarPedido, sincronizarPedidos, yaDescontado, guardarConteo, getConteos,
  };
})();
