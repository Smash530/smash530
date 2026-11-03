/* ============================================================
   SMASH · costos-ui.js (solo panel de dueños)
   Sección "Costos por producto": costo, ganancia y margen bruto
   de cada producto, más el historial de precios, costos y recetas.
   ============================================================ */
(function () {
  if (!document.getElementById('section-costos')) return;
  const $ = (id) => document.getElementById(id);
  const esc = SmashUI.esc, fmt = SmashUI.fmt, C = SmashCostos, I = SmashInv;
  const shown = (id) => !$('dashboardSection').hidden && !$(id).hidden;
  const money = (n) => (Math.abs(n) < 100 && Math.round(n) !== n ? '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 }) : fmt(n));
  const pct = (m) => (m == null ? '-' : m.toFixed(1) + '%');
  const FUENTE = { receta: 'Receta', manual: 'Costo manual', sin: 'Sin costo' };
  const GRUPOS = [['hamburguesa', 'Hamburguesas'], ['combo', 'Combos'], ['adicional', 'Adicionales']];

  let tab = 'tabla';
  $('cosTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    tab = b.dataset.t;
    $('cosTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.cos-pane').forEach((p) => { p.hidden = p.id !== 'cos-' + tab; });
    render();
  });
  $('histTipo').addEventListener('change', render);

  function render() {
    if (!shown('section-costos')) return;
    C.mantener('');
    const prods = SmashDB.getProducts().map((p) => Object.assign({ p }, C.resumenProducto(p)));
    const conCosto = prods.filter((x) => x.fuente !== 'sin');
    const burgers = conCosto.filter((x) => x.p.categoria === 'hamburguesa' && x.margen != null);
    $('cosResumen').innerHTML = `
      <div class="summary-box"><div class="label">Con receta</div><div class="value">${prods.filter((x) => x.fuente === 'receta').length}</div></div>
      <div class="summary-box"><div class="label">Con costo manual</div><div class="value">${prods.filter((x) => x.fuente === 'manual').length}</div></div>
      <div class="summary-box"><div class="label">Sin costo</div><div class="value ${prods.length - conCosto.length ? 'neg' : ''}">${prods.length - conCosto.length}</div></div>
      <div class="summary-box"><div class="label">Margen promedio hamburguesas</div><div class="value">${burgers.length ? pct(burgers.reduce((s, x) => s + x.margen, 0) / burgers.length) : '-'}</div></div>`;
    if (tab === 'tabla') renderTabla(prods); else renderHist();
  }

  function renderTabla(prods) {
    const grupos = GRUPOS.concat([['', 'Otros']]);
    $('cos-tabla').innerHTML = grupos.map(([cat, titulo]) => {
      const list = prods.filter((x) => (cat ? x.p.categoria === cat : !GRUPOS.some((g) => g[0] === x.p.categoria)));
      if (!list.length) return '';
      return `<h3 class="section-title">${esc(titulo)}</h3><table class="rtable"><thead><tr><th>Producto</th><th class="num">Precio de venta</th><th class="num">Costo de producción</th><th>Origen del costo</th><th class="num">Ganancia bruta</th><th class="num">Margen bruto</th></tr></thead><tbody>` +
        list.map((x) => `<tr><td class="first">${esc(x.p.name)}${x.p.activo === false ? ' <small class="hint">(oculto)</small>' : ''}</td>
          <td class="num" data-l="Precio de venta">${fmt(x.precio)}</td>
          <td class="num" data-l="Costo">${x.fuente === 'sin' ? '-' : money(x.costo)}</td>
          <td data-l="Origen"><span class="badge ${x.fuente === 'receta' ? (x.incompleto ? 'bajo' : '') : x.fuente === 'manual' ? 'inactivo' : 'agotado'}">${FUENTE[x.fuente]}${x.fuente === 'receta' && x.incompleto ? ' incompleta' : ''}</span></td>
          <td class="num ${x.ganancia < 0 ? 'neg' : ''}" data-l="Ganancia bruta">${x.fuente === 'sin' ? '-' : fmt(x.ganancia)}</td>
          <td class="num ${x.margen != null && x.margen < 0 ? 'neg' : ''}" data-l="Margen bruto">${x.fuente === 'sin' ? '-' : pct(x.margen)}</td></tr>`).join('') + '</tbody></table>';
    }).join('') + `<p class="hint">Margen bruto = (precio de venta − costo de producción) ÷ precio de venta. “Receta incompleta” significa que algún ingrediente aún no tiene costo registrado.</p>`;
  }

  function renderHist() {
    const f = $('histTipo').value, ev = [];
    if (!f || f === 'precio') C.getPreciosHist().forEach((h) => ev.push({ cuando: h.cuando, tipo: 'Precio de venta', que: h.nombre, antes: h.antes == null ? '-' : fmt(h.antes), despues: fmt(h.despues), nota: h.origen, por: h.por }));
    if (!f || f === 'costo') I.getCostosHist().forEach((h) => {
      const i = I.getIngrediente(h.ingId), u = i ? i.unidad : 'und', fx = I.UNIDADES[u].f;
      ev.push({ cuando: h.cuando, tipo: 'Costo de ingrediente', que: h.ingNombre, antes: h.antes == null ? '-' : money(h.antes * fx) + ' / ' + u, despues: money(h.despues * fx) + ' / ' + u, nota: h.origen, por: h.por });
    });
    if (!f || f === 'receta') {
      const resumen = (ls) => (ls.length ? ls.map((l) => { const i = I.getIngrediente(l.ingId); return (i ? i.nombre : '?') + ' ' + l.cant + ' ' + l.unidad; }).join(', ') : 'sin receta');
      I.getRecetasHist().forEach((h) => { const p = SmashDB.getProductById(h.prodId); ev.push({ cuando: h.cuando, tipo: 'Receta', que: p ? p.name : h.prodId, antes: resumen(h.antes), despues: resumen(h.despues), nota: '', por: h.por }); });
    }
    ev.sort((a, b) => b.cuando.localeCompare(a.cuando));
    $('histLista').innerHTML = `<table class="rtable"><thead><tr><th>Fecha</th><th>Cambio</th><th>Elemento</th><th>Antes</th><th>Después</th><th>Detalle</th><th>Por</th></tr></thead><tbody>` +
      (ev.slice(0, 300).map((e) => `<tr><td class="first">${esc(new Date(e.cuando).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }))}</td>
        <td data-l="Cambio">${esc(e.tipo)}</td><td data-l="Elemento">${esc(e.que)}</td><td data-l="Antes">${esc(e.antes)}</td><td data-l="Después">${esc(e.despues)}</td>
        <td data-l="Detalle">${esc(e.nota || '-')}</td><td data-l="Por">${esc(e.por || 'panel de dueños')}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Sin cambios registrados.</td></tr>') +
      '</tbody></table>';
  }

  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', render));
  window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('smash_') === 0) render(); });
  render();
})();
