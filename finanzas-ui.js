/* ============================================================
   SMASH · finanzas-ui.js (solo panel de dueños)
   "Informes": indicadores por día, semana, mes o periodo libre,
   estado de resultados, ventas por día y análisis de productos.
   "Gastos": registro de gastos y conceptos editables.
   ============================================================ */
(function () {
  const iroot = document.querySelector('#section-informes .inf-root'), groot = document.querySelector('#section-gastos .gas-root');
  if (!iroot || !groot) return;
  const F = SmashFinanzas, esc = SmashUI.esc, fmt = SmashUI.fmt, S = SmashStore;
  const $ = (id) => document.getElementById(id);
  const shown = (id) => !$('dashboardSection').hidden && !$(id).hidden;
  const pct = (v) => (v == null ? '-' : v.toFixed(1) + '%');
  const fechaC = (d) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
  const neg = (v) => (v < 0 ? ' neg' : '');
  function delta(a, b) {
    if (!b) return '<div class="sub">sin datos del periodo anterior</div>';
    const p = ((a - b) / Math.abs(b)) * 100;
    return `<div class="sub ${p < 0 ? 'neg' : 'pos'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p).toFixed(0)}% vs periodo anterior</div>`;
  }

  /* ================= INFORMES ================= */
  let tipo = 'mes', tabla = false;
  iroot.innerHTML = `
    <div class="period-tabs mod-tabs" id="infTabs">
      <button type="button" data-p="dia">Día</button><button type="button" data-p="semana">Semana</button>
      <button type="button" data-p="mes" class="active">Mes</button><button type="button" data-p="libre">Personalizado</button>
    </div>
    <div class="date-row">
      <label class="mod-inline" style="margin:0" id="infRefW">Fecha de referencia<input type="date" id="infRef"></label>
      <label class="mod-inline" style="margin:0" id="infD1W" hidden>Desde<input type="date" id="infD1"></label>
      <label class="mod-inline" style="margin:0" id="infD2W" hidden>Hasta<input type="date" id="infD2"></label>
      <span class="hint" id="infRango" style="margin:0"></span>
    </div>
    <div id="infCuerpo"></div>`;
  $('infRef').value = S.today(); $('infD1').value = S.today().slice(0, 8) + '01'; $('infD2').value = S.today();
  $('infTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-p]'); if (!b) return;
    tipo = b.dataset.p;
    $('infTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    $('infRefW').hidden = tipo === 'libre'; $('infD1W').hidden = $('infD2W').hidden = tipo !== 'libre';
    renderInformes();
  });
  ['infRef', 'infD1', 'infD2'].forEach((id) => $(id).addEventListener('change', renderInformes));

  function rango() {
    if (tipo === 'libre') { const a = $('infD1').value || S.today(), b = $('infD2').value || a; return a <= b ? [a, b] : [b, a]; }
    return F.periodo(tipo, $('infRef').value || S.today());
  }
  function renderInformes() {
    if (!shown('section-informes')) return;
    const [d1, d2] = rango(), R = F.calcular(d1, d2), [p1, p2] = F.anterior(d1, d2), P = F.calcular(p1, p2);
    $('infRango').textContent = d1 === d2 ? fechaC(d1) : fechaC(d1) + ' → ' + fechaC(d2) + ' (' + R.serie.length + ' días)';
    const box = (label, v, extra, cls) => `<div class="summary-box"><div class="label">${label}</div><div class="value${cls || ''}">${v}</div>${extra || ''}</div>`;
    const g = R.gastos, prods = F.productos(d1, d2);
    $('infCuerpo').innerHTML = `
      <div class="kpi-hero">
        ${box('Ventas netas', fmt(R.netas), delta(R.netas, P.netas))}
        ${box('Utilidad operativa estimada', fmt(R.utilidad), `<div class="sub">${pct(R.utilidadPct)} de las ventas netas</div>` + delta(R.utilidad, P.utilidad), neg(R.utilidad))}
      </div>
      <h3 class="section-title">Ventas</h3>
      <div class="summary-grid">
        ${box('Ventas brutas', fmt(R.brutas))}${box('Descuentos', fmt(R.descuentos))}${box('Devoluciones', fmt(R.devoluciones), R.reembolsosCancelados ? `<div class="sub">+ ${fmt(R.reembolsosCancelados)} reembolsos de cancelados (ya fuera de ventas)</div>` : '')}
        ${box('Ventas netas', fmt(R.netas))}${box('Pedidos', R.nPedidos, `${delta(R.nPedidos, P.nPedidos)}${R.cancelados ? `<div class="sub">${R.cancelados} cancelados aparte</div>` : ''}`)}${box('Ticket promedio', fmt(R.ticket))}
      </div>
      <h3 class="section-title">Cobrado por medio de pago</h3>
      <div class="summary-grid">
        ${box('💵 Efectivo', fmt(R.medios.efectivo))}${box('🏦 Transferencia', fmt(R.medios.transferencia))}${box('Otros medios', fmt(R.medios.otro))}
      </div>
      <p class="hint">Cobrado por productos en el periodo según los pagos registrados en caja. No incluye domicilios${R.domiciliosCobrados ? ` (aparte: ${fmt(R.domiciliosCobrados)} de domicilios que el cliente pagó a SMASH y son del domiciliario)` : ''}.</p>
      <h3 class="section-title">Estado de resultados</h3>
      <div class="simple-table pyg">
        <div class="row"><span>Ventas brutas</span><b>${fmt(R.brutas)}</b></div>
        <div class="row"><span>− Descuentos</span><span>${fmt(R.descuentos)}</span></div>
        <div class="row"><span>− Devoluciones</span><span>${fmt(R.devoluciones)}</span></div>
        <div class="row tot"><span>Ventas netas</span><b>${fmt(R.netas)}</b></div>
        <div class="row"><span>− Costo de productos vendidos${R.perdidas ? ` <small class="hint">(incluye ${fmt(R.perdidas)} de cancelaciones)</small>` : ''}</span><span>${fmt(R.costoVendido)}</span></div>
        <div class="row tot"><span>Margen bruto <small class="hint">${pct(R.margenPct)}</small></span><b class="${neg(R.margenBruto)}">${fmt(R.margenBruto)}</b></div>
        <div class="row"><span>− Gastos operativos</span><span>${fmt(g.operativo)}</span></div>
        <div class="row"><span>− Costos fijos</span><span>${fmt(g.fijo)}</span></div>
        <div class="row"><span>− Nómina</span><span>${fmt(g.nomina)}</span></div>
        <div class="row"><span>− Otros egresos</span><span>${fmt(g.otro)}</span></div>
        <div class="row tot"><span>Utilidad operativa estimada</span><b class="${neg(R.utilidad)}">${fmt(R.utilidad)}</b></div>
      </div>
      <p class="hint">Solo como dato (no se resta): compras de insumos ${fmt(R.compras)} (ya entran como costo cuando se vende lo producido) · domicilios de los pedidos ${fmt(R.domicilios)} (son de los domiciliarios) · nómina estimada según Personal ${fmt(R.nominaEstimada)}${R.nominaEstimada && !g.nomina ? ' — aún no hay nómina registrada en este periodo' : ''}.</p>
      ${R.detalleGastos.length ? `<details class="mod-box"><summary>Detalle de gastos</summary><table class="rtable"><thead><tr><th>Concepto</th><th>Clase</th><th class="num">Valor</th></tr></thead><tbody>
        ${R.detalleGastos.sort((a, b) => b.v - a.v).map((x) => `<tr><td class="first">${esc(x.concepto)}</td><td data-l="Clase">${esc(F.CLASES[x.clase])}</td><td class="num" data-l="Valor">${fmt(x.v)}</td></tr>`).join('')}</tbody></table></details>` : ''}
      ${R.serie.length > 1 ? grafico(R.serie) : ''}
      <h3 class="section-title">Productos</h3>
      ${productosHtml(prods)}`;
  }

  // Ventas netas por día: una sola serie (sin leyenda), barras finas, detalle al pasar o tocar, y tabla equivalente.
  function grafico(serie) {
    const max = Math.max(1, ...serie.map((x) => x.ventas)), n = serie.length, marcas = [0, Math.floor((n - 1) / 2), n - 1];
    return `<h3 class="section-title">Ventas netas por día</h3>
      <div class="chart-box">
        <div class="chart-max">${fmt(max)}</div>
        <div class="chart" role="img" aria-label="Ventas netas por día, máximo ${fmt(max)}">
          ${serie.map((x, i) => `<button type="button" class="bar-hit" data-i="${i}" aria-label="${esc(fechaC(x.d))}: ${fmt(x.ventas)}, ${x.pedidos} pedidos"><span class="bar" style="height:${x.ventas ? Math.max(2, (x.ventas / max) * 100) : 0}%"></span></button>`).join('')}
        </div>
        <div class="chart-x">${marcas.map((i) => `<span>${esc(fechaC(serie[i].d))}</span>`).join('')}</div>
        <div class="chart-tip" id="chartTip" hidden></div>
      </div>
      <button type="button" class="btn-secondary" id="chartTabla">${tabla ? 'Ocultar tabla' : 'Ver como tabla'}</button>
      ${tabla ? `<table class="rtable" style="margin-top:8px"><thead><tr><th>Día</th><th class="num">Pedidos</th><th class="num">Ventas netas</th><th class="num">Costo</th></tr></thead><tbody>
        ${serie.map((x) => `<tr><td class="first">${esc(x.d)}</td><td class="num" data-l="Pedidos">${x.pedidos}</td><td class="num" data-l="Ventas netas">${fmt(x.ventas)}</td><td class="num" data-l="Costo">${fmt(x.costo)}</td></tr>`).join('')}</tbody></table>` : ''}`;
  }
  let serieActual = [];
  iroot.addEventListener('click', (e) => {
    if (e.target.id === 'chartTabla') { tabla = !tabla; renderInformes(); }
  });
  function tip(e) {
    const b = e.target.closest('.bar-hit'), t = $('chartTip');
    if (!t) return;
    if (!b) { t.hidden = true; return; }
    const [d1, d2] = rango(); serieActual = F.calcular(d1, d2).serie;
    const x = serieActual[+b.dataset.i]; if (!x) return;
    t.innerHTML = `<b>${esc(fechaC(x.d))}</b><br>${fmt(x.ventas)} · ${x.pedidos} ${x.pedidos === 1 ? 'pedido' : 'pedidos'}`;
    t.hidden = false;
    const box = b.closest('.chart-box').getBoundingClientRect(), r = b.getBoundingClientRect();
    t.style.left = Math.min(box.width - 150, Math.max(0, r.left - box.left + r.width / 2 - 75)) + 'px';
  }
  iroot.addEventListener('mouseover', tip);
  iroot.addEventListener('focusin', tip);
  iroot.addEventListener('mouseleave', () => { const t = $('chartTip'); if (t) t.hidden = true; });

  function productosHtml(list) {
    if (!list.length) return '<p class="hint">Sin ventas en este periodo.</p>';
    const porQ = list.slice().sort((a, b) => b.q - a.q), porG = list.slice().sort((a, b) => b.ganancia - a.ganancia);
    const card = (t, p, v) => `<div class="summary-box"><div class="label">${t}</div><div class="value" style="font-size:1rem">${esc(p.nombre)}</div><div class="sub">${v}</div></div>`;
    return `<div class="summary-grid">
        ${card('Más vendido', porQ[0], porQ[0].q + ' unidades')}${card('Menos vendido', porQ[porQ.length - 1], porQ[porQ.length - 1].q + ' unidades')}
        ${card('Más rentable', porG[0], fmt(porG[0].ganancia) + ' de ganancia')}${card('Menos rentable', porG[porG.length - 1], fmt(porG[porG.length - 1].ganancia) + ' de ganancia')}
      </div>
      <table class="rtable"><thead><tr><th>Producto</th><th class="num">Cantidad</th><th class="num">Ventas</th><th class="num">Costo</th><th class="num">Ganancia bruta</th><th class="num">Margen</th><th>Clasificación</th></tr></thead><tbody>
      ${porQ.map((p) => `<tr><td class="first">${esc(p.nombre)}</td><td class="num" data-l="Cantidad">${p.q}</td><td class="num" data-l="Ventas">${fmt(p.ventas)}</td><td class="num" data-l="Costo">${fmt(p.costo)}</td>
        <td class="num${neg(p.ganancia)}" data-l="Ganancia bruta">${fmt(p.ganancia)}</td><td class="num" data-l="Margen">${pct(p.margen)}</td><td data-l="Clasificación"><span class="clase-badge c-${p.clase}">${esc(F.CLASIF[p.clase].n)}</span></td></tr>`).join('')}
      </tbody></table>
      <div class="clasif-grid">${Object.keys(F.CLASIF).map((k) => { const ps = list.filter((p) => p.clase === k); return `<div class="mod-box"><span class="clase-badge c-${k}">${esc(F.CLASIF[k].n)}</span><p class="hint" style="margin:6px 0">${esc(F.CLASIF[k].d)}</p><b>${ps.length ? ps.map((p) => esc(p.nombre)).join(', ') : '—'}</b></div>`; }).join('')}</div>
      <p class="hint">Ventas por producto a precio de lista (sin repartir descuentos). Alto volumen = unidades sobre el promedio de los productos vendidos; buena ganancia = ganancia por unidad sobre el promedio. Los adicionales y combos se comparan junto con las hamburguesas.</p>`;
  }

  /* ================= GASTOS ================= */
  let catsDraft = null;
  groot.innerHTML = `
    <p class="hint">Registra aquí los gastos del negocio. Para no contar dos veces: las compras de carne, pan y demás insumos van en <b>Inventario → Registrar compra</b>; lo que caja anota como "Gasto de caja" ya se suma solo; y los gastos del día de Contabilidad también se suman. Usa un solo lugar para cada gasto.</p>
    <div class="mod-form mod-box" id="gasForm">
      <label>Fecha<input type="date" id="gasFecha"></label>
      <label>Concepto<select id="gasCat"></select></label>
      <label>Valor (COP)<input type="number" id="gasMonto" min="0" step="1000" inputmode="numeric"></label>
      <label>Frecuencia<select id="gasFrec"><option value="unico">Gasto de ese día</option><option value="mensual">Mensual (se reparte en los días del mes)</option></select></label>
      <label class="wide">Descripción (opcional)<input id="gasDesc" maxlength="150"></label>
      <p class="hint wide" id="gasClase" style="margin:0"></p>
      <div class="mod-actions wide"><button type="button" class="btn-primary" id="gasGuardar">Registrar gasto</button></div>
      <p class="error wide" id="gasMsg"></p>
    </div>
    <div class="date-row"><label class="mod-inline" style="margin:0">Mes<input type="month" id="gasMes"></label></div>
    <div id="gasLista"></div>
    <details class="mod-box" style="margin-top:14px"><summary>Conceptos de gasto</summary>
      <p class="hint">Cambia nombres o la clase de cada concepto, o agrega nuevos. "Compra de insumos" no se resta en los informes (va por Inventario).</p>
      <div id="catLista"></div>
      <div class="mod-actions"><button type="button" class="btn-secondary" id="catAdd">+ Agregar concepto</button><button type="button" class="btn-primary" id="catGuardar">Guardar conceptos</button></div>
      <p class="error" id="catMsg"></p>
    </details>`;
  $('gasFecha').value = S.today(); $('gasMes').value = S.today().slice(0, 7);
  function renderGastos() {
    if (!shown('section-gastos')) return;
    const cats = F.getCats(), cur = $('gasCat').value;
    $('gasCat').innerHTML = cats.filter((c) => c.activa !== false).map((c) => `<option value="${esc(c.k)}"${c.k === cur ? ' selected' : ''}>${esc(c.nombre)}</option>`).join('');
    claseHint();
    const mes = $('gasMes').value || S.today().slice(0, 7);
    const list = F.getGastos().filter((g) => g.fecha.slice(0, 7) === mes).sort((a, b) => b.fecha.localeCompare(a.fecha) || b.en.localeCompare(a.en));
    const tot = list.filter((g) => !g.anulado).reduce((s, g) => s + g.monto, 0);
    $('gasLista').innerHTML = `<table class="rtable"><thead><tr><th>Fecha</th><th>Concepto</th><th>Clase</th><th>Descripción</th><th class="num">Valor</th><th></th></tr></thead><tbody>
      ${list.map((g) => `<tr${g.anulado ? ' class="row-cancel"' : ''}><td class="first">${esc(g.fecha)}${g.frecuencia === 'mensual' ? ' <small class="hint">mensual</small>' : ''}</td><td data-l="Concepto">${esc(g.catNombre)}</td>
        <td data-l="Clase">${esc(F.CLASES[g.clase])}</td><td data-l="Descripción">${esc(g.descripcion || '-')}${g.anulado ? `<br><small class="hint">Anulado: ${esc(g.anulado.motivo)}</small>` : ''}</td>
        <td class="num" data-l="Valor">${fmt(g.monto)}</td><td>${g.anulado ? '' : `<button type="button" class="btn-sm" data-ganular="${esc(g.id)}">Anular</button>`}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Sin gastos registrados este mes.</td></tr>'}
      </tbody></table><p class="hint">Total registrado del mes (sin anulados): <b>${fmt(tot)}</b></p>`;
    if (!$('catLista').contains(document.activeElement)) { catsDraft = cats.map((c) => Object.assign({}, c)); renderCats(); }
  }
  function claseHint() {
    const c = F.getCats().find((x) => x.k === $('gasCat').value);
    $('gasClase').textContent = c ? 'Clase: ' + F.CLASES[c.clase] + (c.clase === 'insumos' ? '. Ojo: no se resta en los informes; si es para recetas, regístralo en Inventario.' : '') : '';
  }
  function renderCats() {
    $('catLista').innerHTML = `<table class="rtable"><thead><tr><th>Concepto</th><th>Clase</th><th>Activo</th></tr></thead><tbody>` +
      catsDraft.map((c, i) => `<tr><td class="first"><input data-ci="${i}" data-cf="nombre" maxlength="50" value="${esc(c.nombre)}"></td>
        <td data-l="Clase"><select data-ci="${i}" data-cf="clase">${Object.keys(F.CLASES).map((k) => `<option value="${k}"${k === c.clase ? ' selected' : ''}>${esc(F.CLASES[k])}</option>`).join('')}</select></td>
        <td data-l="Activo"><input type="checkbox" data-ci="${i}" data-cf="activa"${c.activa !== false ? ' checked' : ''} style="min-width:0;width:24px;min-height:24px"></td></tr>`).join('') + '</tbody></table>';
  }
  $('gasCat').addEventListener('change', claseHint);
  $('gasMes').addEventListener('change', renderGastos);
  $('gasGuardar').addEventListener('click', () => {
    try { F.registrarGasto({ fecha: $('gasFecha').value, cat: $('gasCat').value, monto: $('gasMonto').value, frecuencia: $('gasFrec').value, descripcion: $('gasDesc').value }, 'dueño'); }
    catch (x) { $('gasMsg').className = 'error wide'; $('gasMsg').textContent = x.message; return; }
    $('gasMonto').value = ''; $('gasDesc').value = '';
    $('gasMsg').className = 'ok-msg wide'; $('gasMsg').textContent = '✓ Gasto registrado.';
    $('gasMes').value = $('gasFecha').value.slice(0, 7); renderGastos();
  });
  $('gasLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ganular]'); if (!b) return;
    const m = prompt('¿Por qué se anula este gasto? (queda en el historial)');
    if (!m) return;
    try { F.anularGasto(b.dataset.ganular, m, 'dueño'); } catch (x) { alert(x.message); }
    renderGastos();
  });
  $('catLista').addEventListener('input', (e) => { const t = e.target; if (t.dataset.cf) catsDraft[+t.dataset.ci][t.dataset.cf] = t.type === 'checkbox' ? t.checked : t.value; });
  $('catAdd').addEventListener('click', () => { catsDraft.push({ k: '', nombre: '', clase: 'operativo', activa: true }); renderCats(); });
  $('catGuardar').addEventListener('click', () => {
    try { F.guardarCats(catsDraft); } catch (x) { $('catMsg').className = 'error'; $('catMsg').textContent = x.message; return; }
    document.activeElement.blur(); $('catMsg').className = 'ok-msg'; $('catMsg').textContent = '✓ Conceptos guardados.'; renderGastos();
  });

  const render = () => { renderInformes(); renderGastos(); };
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', render));
  window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('smash_') === 0 && !groot.contains(document.activeElement)) render(); });
  render();
})();
