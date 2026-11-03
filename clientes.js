/* ============================================================
   SMASH · clientes.js
   Fichas de clientes (a partir de los pedidos, como siempre),
   duplicados por teléfono, programa de puntos configurable y
   solicitudes sobre datos personales (exportar / anonimizar).
   Requiere data.js, data-ext.js, store.js y comandas.js.
   - Un cliente se identifica por su teléfono normalizado (10 dígitos,
     sin +57). Los dueños pueden unir dos teléfonos del mismo cliente.
   - El gasto del cliente es lo que pagó en productos (sin domicilio).
   - El programa de puntos arranca APAGADO y sin reglas: los dueños
     definen cuánto hay que gastar, cuántos puntos se ganan, las
     recompensas y si los puntos vencen.
   ============================================================ */
const SmashClientes = (function () {
  const S = SmashStore;
  const K = {
    ALIAS: 'smash_clientes_alias',        // { telefonoUnido: telefonoPrincipal }
    NODUP: 'smash_clientes_nodup',        // pares marcados como "no son el mismo cliente"
    SOL: 'smash_clientes_solicitudes',    // registro de fusiones, exportaciones y anonimizaciones
    CFG: 'smash_fidel_cfg',
    CFG_HIST: 'smash_fidel_hist',
    PUNTOS: 'smash_puntos',               // movimientos de puntos (ganados, canjeados, vencidos)
  };
  const DIA = 86400000;

  /* ---------------- Identidad del cliente ---------------- */
  function normTel(t) {
    let d = String(t || '').replace(/\D/g, '');
    if (d.length > 10 && d.indexOf('57') === 0) d = d.slice(2);
    return d.slice(-10);
  }
  const normNombre = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  function canon(tel, alias) {
    const a = alias || S.read(K.ALIAS, {});
    let k = tel, n = 0;
    while (a[k] && n++ < 10) k = a[k];
    return k;
  }
  function claveDe(o, alias) {
    const t = normTel(o.telefono);
    return t ? canon(t, alias) : 'n:' + normNombre(o.cliente);
  }
  const neto = (o) => (Number(o.subtotal) || 0) - (Number(o.descuento) || 0);

  /* ---------------- Fichas ---------------- */
  function lista() {
    const alias = S.read(K.ALIAS, {}), map = {};
    SmashComandas.vigentes(SmashDB.getOrders()).forEach((o) => {
      if (o.anonimizado) return;
      const k = claveDe(o, alias);
      (map[k] = map[k] || { key: k, telefono: k.indexOf('n:') === 0 ? '' : k, pedidos: [], telefonos: {} }).pedidos.push(o);
      const t = normTel(o.telefono); if (t) map[k].telefonos[t] = true;
    });
    const ahora = Date.now(), hoy = S.today(), mes = hoy.slice(0, 7), saldos = saldosPuntos();
    return Object.values(map).map((c) => {
      const ps = c.pedidos.slice().sort((a, b) => a.creado.localeCompare(b.creado));
      const ult = ps[ps.length - 1], meses = {}, prods = {};
      ps.forEach((o) => {
        const m = SmashExt.localDay(o.creado).slice(0, 7);
        meses[m] = meses[m] || { n: 0, t: 0 }; meses[m].n++; meses[m].t += neto(o);
        (o.items || []).forEach((it) => { prods[it.name] = (prods[it.name] || 0) + it.qty; });
      });
      const total = ps.reduce((s, o) => s + neto(o), 0);
      const first = new Date(ps[0].creado), last = new Date(ult.creado);
      const nMeses = Math.max(1, (new Date().getFullYear() - first.getFullYear()) * 12 + new Date().getMonth() - first.getMonth() + 1);
      return {
        key: c.key, telefono: c.telefono, telefonos: Object.keys(c.telefonos),
        nombre: ult.cliente || ps[0].cliente, direccion: ult.direccion || '', zona: ult.zona || '',
        n: ps.length, total, ticket: total / ps.length,
        semana: ps.filter((o) => ahora - new Date(o.creado).getTime() <= 7 * DIA).reduce((s, o) => s + neto(o), 0),
        esteMesV: (meses[mes] || { t: 0 }).t, esteMes: (meses[mes] || { n: 0 }).n,
        promMes: ps.length / nMeses,
        cadaDias: ps.length > 1 ? (last - first) / DIA / (ps.length - 1) : null,
        primero: ps[0].creado, ultimo: ult.creado, meses,
        top: Object.keys(prods).map((n) => ({ n, q: prods[n] })).sort((a, b) => b.q - a.q).slice(0, 5),
        puntos: c.telefono ? saldos[c.key] || 0 : null, pedidos: ps,
      };
    });
  }

  /* ---------------- Duplicados ---------------- */
  // Teléfonos que difieren en un dígito (o al que le falta uno) o el mismo nombre completo con otro teléfono
  function parecidos(a, b) {
    if (a === b) return false;
    if (a.length === b.length) { let d = 0; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && ++d > 1) return false; return d === 1; }
    if (Math.abs(a.length - b.length) !== 1) return false;
    const [l, s] = a.length > b.length ? [a, b] : [b, a];
    for (let i = 0; i < l.length; i++) if (l.slice(0, i) + l.slice(i + 1) === s) return true;
    return false;
  }
  function duplicados(list) {
    const nodup = S.read(K.NODUP, []), out = [], cl = (list || lista()).filter((c) => c.telefono);
    for (let i = 0; i < cl.length; i++) {
      for (let j = i + 1; j < cl.length; j++) {
        const a = cl[i], b = cl[j], par = [a.key, b.key].sort().join('~');
        if (nodup.indexOf(par) > -1) continue;
        const nom = normNombre(a.nombre), mismoNombre = nom.split(' ').length >= 2 && nom === normNombre(b.nombre);
        if (parecidos(a.telefono, b.telefono) || mismoNombre) out.push({ a, b, par, motivo: mismoNombre ? 'mismo nombre' : 'teléfono casi igual' });
      }
    }
    return out;
  }
  function registrarSolicitud(tipo, key, nota, por) {
    const sol = S.read(K.SOL, []);
    sol.push({ tipo, key, nota: nota || '', por: por || '', en: S.nowISO() });
    return sol;
  }
  // Une el cliente "desde" dentro de "hacia" (el teléfono de "desde" pasa a ser un alias)
  function fusionar(desde, hacia, por) {
    if (!desde || !hacia || desde === hacia || desde.indexOf('n:') === 0 || hacia.indexOf('n:') === 0) throw new Error('Solo se unen clientes con teléfono.');
    const alias = S.read(K.ALIAS, {});
    if (canon(hacia, alias) === desde) throw new Error('Esa unión haría un ciclo.');
    alias[desde] = hacia;
    S.tx({ [K.ALIAS]: alias, [K.SOL]: registrarSolicitud('fusión', hacia, desde + ' unido a ' + hacia, por) });
  }
  function noEsDuplicado(par) {
    const nodup = S.read(K.NODUP, []);
    if (nodup.indexOf(par) < 0) nodup.push(par);
    S.save(K.NODUP, nodup);
  }

  /* ---------------- Datos personales ---------------- */
  function exportarDatos(key, por) {
    const c = lista().find((x) => x.key === key);
    if (!c) throw new Error('Cliente no encontrado.');
    const datos = {
      generado: S.nowISO(), cliente: { nombre: c.nombre, telefonos: c.telefonos, direccion: c.direccion },
      pedidos: c.pedidos.map((o) => ({ fecha: o.creado, comanda: SmashComandas.codigo(o), direccion: o.direccion, zona: o.zona, items: o.items.map((i) => i.qty + ' x ' + i.name), productos: neto(o), domicilio: o.domicilio, total: o.total, estado: o.status })),
      puntos: movimientosPuntos(key),
    };
    S.save(K.SOL, registrarSolicitud('exportación', key, '', por));
    return datos;
  }
  // Borra nombre, teléfono, dirección y notas en todos los registros del cliente. Los valores de venta se conservan.
  function anonimizar(key, nota, por) {
    const alias = S.read(K.ALIAS, {}), KO = SmashDB.KEYS.ORDERS, orders = S.read(KO, []);
    const ids = {};
    let n = 0;
    orders.forEach((o) => {
      if (o.anonimizado || claveDe(o, alias) !== key) return;
      ids[o.id + '|' + o.creado] = true;
      Object.assign(o, { cliente: 'Cliente anonimizado', telefono: '', direccion: '', notas: '', anonimizado: true });
      n++;
    });
    if (!n) throw new Error('No se encontraron pedidos de este cliente.');
    const changes = { [KO]: orders };
    if (typeof SmashCaja !== 'undefined') {
      const pagos = S.read(SmashCaja.K.PAGOS, []);
      pagos.forEach((p) => { if (ids[p.pedidoKey]) p.cliente = 'Cliente anonimizado'; });
      changes[SmashCaja.K.PAGOS] = pagos;
    }
    const del = S.read('smash_deleted_orders', []);
    del.forEach((d) => { if (d.orden && claveDe(d.orden, alias) === key) Object.assign(d.orden, { cliente: 'Cliente anonimizado', telefono: '', direccion: '', notas: '' }); });
    changes.smash_deleted_orders = del;
    const pts = S.read(K.PUNTOS, []);
    pts.forEach((p) => { if (canon(p.cliente, alias) === key) p.cliente = 'anon'; });
    changes[K.PUNTOS] = pts;
    Object.keys(alias).forEach((t) => { if (canon(t, alias) === key) delete alias[t]; });
    changes[K.ALIAS] = alias;
    changes[K.SOL] = registrarSolicitud('anonimización', 'anon', (nota || '') + ' · ' + n + ' pedidos', por);
    S.tx(changes);
    return n;
  }
  const getSolicitudes = () => S.read(K.SOL, []);

  /* ---------------- Programa de puntos ---------------- */
  const CFG0 = { activo: false, monto: 0, puntos: 0, venceDias: 0, recompensas: [], desde: null };
  const getCfg = () => Object.assign({}, CFG0, S.read(K.CFG, {}));
  function guardarCfg(d, por) {
    const antes = getCfg();
    const cfg = {
      activo: !!d.activo, monto: Math.round(Number(d.monto) || 0), puntos: Math.round(Number(d.puntos) || 0),
      venceDias: Math.max(0, Math.round(Number(d.venceDias) || 0)), desde: antes.desde,
      recompensas: (d.recompensas || []).map((r) => ({
        id: r.id || S.uid('rw'), nombre: String(r.nombre || '').trim().slice(0, 60), puntos: Math.round(Number(r.puntos) || 0),
        valor: Math.max(0, Math.round(Number(r.valor) || 0)), activa: r.activa !== false,
      })),
    };
    if (cfg.activo && !(cfg.monto > 0 && cfg.puntos > 0)) throw new Error('Para activar el programa escribe cuánto hay que gastar y cuántos puntos se ganan.');
    if (cfg.recompensas.some((r) => !r.nombre || !(r.puntos > 0))) throw new Error('Cada recompensa necesita nombre y cuántos puntos cuesta.');
    if (cfg.activo && !cfg.desde) cfg.desde = S.nowISO(); // solo ganan puntos los pedidos entregados desde que se activa
    const hist = S.read(K.CFG_HIST, []);
    hist.push({ antes, despues: cfg, por: por || '', en: S.nowISO() });
    S.tx({ [K.CFG]: cfg, [K.CFG_HIST]: hist });
    return cfg;
  }
  const getCfgHist = () => S.read(K.CFG_HIST, []);
  const getPuntos = () => S.read(K.PUNTOS, []);

  // Lotes de puntos por cliente (los canjes gastan primero los más antiguos)
  function lotes(entries) {
    const ls = [];
    entries.slice().sort((a, b) => a.en.localeCompare(b.en)).forEach((e) => {
      if (e.puntos > 0) ls.push({ id: e.id, rest: e.puntos, vence: e.vence || null });
      else if (e.tipo === 'vencido') { const l = ls.find((x) => x.id === e.lote); if (l) l.rest += e.puntos; }
      else {
        let falta = -e.puntos;
        ls.forEach((l) => { if (falta <= 0 || l.rest <= 0 || (l.vence && l.vence <= e.en)) return; const u = Math.min(l.rest, falta); l.rest -= u; falta -= u; });
      }
    });
    return ls;
  }
  function saldosPuntos() {
    const alias = S.read(K.ALIAS, {}), por = {}, ahora = S.nowISO(), out = {};
    getPuntos().forEach((e) => { if (e.cliente === 'anon') return; const k = canon(e.cliente, alias); (por[k] = por[k] || []).push(e); });
    Object.keys(por).forEach((k) => { out[k] = lotes(por[k]).reduce((s, l) => s + (l.rest > 0 && !(l.vence && l.vence <= ahora) ? l.rest : 0), 0); });
    return out;
  }
  const saldo = (key) => saldosPuntos()[key] || 0;
  function movimientosPuntos(key) {
    const alias = S.read(K.ALIAS, {});
    return getPuntos().filter((e) => e.cliente !== 'anon' && canon(e.cliente, alias) === key).sort((a, b) => b.en.localeCompare(a.en));
  }
  // Puntos ganados por pedidos entregados (una vez por pedido) y puntos vencidos. Solo escribe en smash_puntos.
  function sincronizar() {
    const cfg = getCfg();
    const pts = getPuntos(), hechos = {};
    pts.forEach((e) => { if (e.pedidoKey && e.tipo === 'ganado') hechos[e.pedidoKey] = true; });
    let cambios = 0;
    if (cfg.activo && cfg.desde && cfg.monto > 0 && cfg.puntos > 0) {
      SmashDB.getOrders().forEach((o) => {
        if (o.status !== 'entregado' || !o.entregadoEn || o.entregadoEn < cfg.desde || o.anonimizado) return;
        const tel = normTel(o.telefono), k = o.id + '|' + o.creado;
        if (!tel || hechos[k]) return;
        const p = Math.floor(neto(o) / cfg.monto) * cfg.puntos;
        if (p <= 0) return;
        const e = { id: S.uid('pt'), cliente: tel, tipo: 'ganado', puntos: p, pedidoKey: k, pedidoNum: o.numeroDia || o.id, regla: cfg.monto + ':' + cfg.puntos, en: o.entregadoEn };
        if (cfg.venceDias > 0) e.vence = new Date(new Date(o.entregadoEn).getTime() + cfg.venceDias * DIA).toISOString();
        pts.push(e); hechos[k] = true; cambios++;
      });
    }
    // Vencimientos: lo que quede de un lote vencido se registra como "vencido"
    const ahora = S.nowISO(), porCli = {}, alias = S.read(K.ALIAS, {});
    pts.forEach((e) => { if (e.cliente !== 'anon') { const c = canon(e.cliente, alias); (porCli[c] = porCli[c] || []).push(e); } });
    Object.keys(porCli).forEach((c) => {
      lotes(porCli[c]).forEach((l) => {
        if (l.vence && l.vence <= ahora && l.rest > 0) { pts.push({ id: S.uid('pt'), cliente: c, tipo: 'vencido', puntos: -l.rest, lote: l.id, en: l.vence }); cambios++; }
      });
    });
    if (cambios) S.save(K.PUNTOS, pts);
    return cambios;
  }
  // Canje: descuenta los puntos y, si la recompensa tiene valor, lo aplica como descuento a un pedido sin pagar
  function canjear(key, recompensaId, pedidoId, por) {
    const cfg = getCfg();
    if (!cfg.activo) throw new Error('El programa de puntos no está activo.');
    const r = cfg.recompensas.find((x) => x.id === recompensaId && x.activa);
    if (!r) throw new Error('Elige una recompensa disponible.');
    if (key.indexOf('n:') === 0) throw new Error('El cliente necesita teléfono para usar puntos.');
    if (saldo(key) < r.puntos) throw new Error('Puntos insuficientes: tiene ' + saldo(key) + ' y la recompensa cuesta ' + r.puntos + '.');
    const changes = {}, e = { id: S.uid('pt'), cliente: key, tipo: 'canjeado', puntos: -r.puntos, recompensa: r.nombre, por: por || '', en: S.nowISO() };
    if (pedidoId) {
      const KO = SmashDB.KEYS.ORDERS, orders = S.read(KO, []), o = orders.find((x) => x.id === pedidoId);
      if (!o || claveDe(o) !== key) throw new Error('El pedido no es de este cliente.');
      if (['entregado', 'cancelado'].indexOf(o.status) > -1) throw new Error('El pedido ya está cerrado.');
      if (typeof SmashCaja !== 'undefined' && SmashCaja.pagoDe(o)) throw new Error('El pedido ya está pagado; aplica la recompensa antes de cobrar.');
      const valor = Math.min(r.valor, neto(o));
      if (valor > 0) {
        (o.descuentos = o.descuentos || []).push({ motivo: 'Canje de puntos: ' + r.nombre, valor, en: e.en });
        o.descuento = (Number(o.descuento) || 0) + valor;
        o.total = (Number(o.subtotal) || 0) - o.descuento + (Number(o.domicilio) || 0);
      }
      e.pedidoNum = o.numeroDia || o.id; e.descuento = valor;
      changes[KO] = orders;
    }
    const pts = getPuntos(); pts.push(e); changes[K.PUNTOS] = pts;
    S.tx(changes);
    return e;
  }

  return {
    K, normTel, claveDe, neto, lista, duplicados, fusionar, noEsDuplicado, exportarDatos, anonimizar, getSolicitudes,
    getCfg, guardarCfg, getCfgHist, getPuntos, saldo, saldosPuntos, movimientosPuntos, sincronizar, canjear,
  };
})();
