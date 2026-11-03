/* ============================================================
   SMASH · comandas-ui.js (caja y dueños)
   Historial de comandas: estados, horas de cada paso, tiempos
   promedio, cancelaciones y novedades. En caja no se muestra la
   pérdida en dinero (información financiera de los dueños).
   ============================================================ */
(function () {
  const root = document.querySelector('#section-historial .hist-root');
  if (!root) return;
  const esc = SmashUI.esc, fmt = SmashUI.fmt, C = SmashComandas;
  const esDueno = !!document.getElementById('section-costos');
  const hoy = () => SmashStore.today();
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '-');

  root.innerHTML = `
    <div class="date-row">
      <label class="mod-inline" style="margin:0">Desde<input type="date" id="hDesde"></label>
      <label class="mod-inline" style="margin:0">Hasta<input type="date" id="hHasta"></label>
      <label class="mod-inline" style="margin:0">Estado<select id="hEstado"><option value="">Todos</option>${C.ESTADOS.map((e) => `<option value="${e.k}">${esc(e.n)}</option>`).join('')}</select></label>
    </div>
    <div class="summary-grid" id="hResumen"></div>
    <h3 class="section-title">Tiempos promedio</h3>
    <div class="summary-grid" id="hTiempos"></div>
    <div id="hLista"></div>`;
  const $ = (id) => document.getElementById(id);
  $('hDesde').value = $('hHasta').value = hoy();

  function render() {
    if (document.getElementById('dashboardSection').hidden || document.getElementById('section-historial').hidden) return;
    const d1 = $('hDesde').value || hoy(), d2 = $('hHasta').value || d1, fe = $('hEstado').value;
    const enRango = SmashDB.getOrders().filter((o) => { const d = SmashExt.localDay(o.creado); return d >= d1 && d <= d2; });
    const lista = enRango.filter((o) => !fe || o.status === fe).sort((a, b) => b.creado.localeCompare(a.creado));
    const can = enRango.filter((o) => o.status === 'cancelado');
    const antes = can.filter((o) => C.YA_EN_COCINA.indexOf(o.cancelacion && o.cancelacion.etapa) < 0).length;
    const perdida = can.reduce((s, o) => s + ((o.cancelacion && o.cancelacion.perdida) || 0), 0);
    const abiertos = enRango.filter((o) => ['entregado', 'cancelado'].indexOf(o.status) < 0).length;
    $('hResumen').innerHTML = `
      <div class="summary-box"><div class="label">Comandas</div><div class="value">${enRango.length}</div></div>
      <div class="summary-box"><div class="label">Entregadas</div><div class="value">${enRango.filter((o) => o.status === 'entregado').length}</div></div>
      <div class="summary-box"><div class="label">En curso</div><div class="value">${abiertos}</div></div>
      <div class="summary-box"><div class="label">Canceladas</div><div class="value ${can.length ? 'neg' : ''}">${can.length}</div><div class="sub">${antes} antes de cocina · ${can.length - antes} después${esDueno && perdida ? ' · pérdida ' + fmt(perdida) : ''}</div></div>`;
    const p = C.promedios(enRango), box = (label, x) => `<div class="summary-box"><div class="label">${label}</div><div class="value">${x ? C.dur(x.prom) : '-'}</div><div class="sub">${x ? x.n + ' pedidos' : 'sin datos'}</div></div>`;
    $('hTiempos').innerHTML = box('Recibido → confirmado', p.confirmacion) + box('Preparación', p.preparacion) + box('Entrega (salida → entregado)', p.entrega) + box('Total del pedido', p.total);
    $('hLista').innerHTML = `<table class="rtable"><thead><tr><th>Comanda</th><th>Cliente</th><th>Estado</th><th class="num">Total</th><th>Horas</th><th>Domiciliario</th><th>Detalle</th></tr></thead><tbody>` +
      (lista.slice(0, 300).map((o) => {
        const t = C.tiempos(o), c = o.cancelacion;
        const det = [];
        if (c) det.push(`<b>Cancelado</b> (${esc(C.NOMBRE[c.etapa] || c.etapa)}) ${esc(hora(c.en))}: ${esc(c.motivo)} · resp. ${esc(c.responsable)} · ${c.preparado ? 'se preparó' : 'no se preparó'}${esDueno && c.perdida ? ' · pérdida ' + fmt(c.perdida) : ''}${c.reintegrado ? ' · insumos reintegrados' : ''}`);
        (o.novedades || []).forEach((n) => det.push('⚠ ' + esc(hora(n.en)) + ' ' + esc(n.texto)));
        if (t.preparacion != null) det.push('prep. ' + C.dur(t.preparacion));
        if (t.total != null) det.push('total ' + C.dur(t.total));
        return `<tr${o.status === 'cancelado' ? ' class="row-cancel"' : ''}><td class="first">#${esc(o.numeroDia || o.id)} <small class="hint">${esc(C.codigo(o))}</small></td>
          <td data-l="Cliente">${esc(o.cliente)}</td><td data-l="Estado"><span class="st-badge st-${esc(o.status)}">${esc(C.NOMBRE[o.status] || o.status)}</span></td>
          <td class="num" data-l="Total">${fmt(o.total)}</td>
          <td data-l="Horas" class="h-horas">${[['Recibido', o.creado], ['Confirmado', o.confirmadoEn], ['Preparación', o.preparandoEn], ['Listo', o.listoEn], ['Salió', o.salioEn], ['Entregado', o.entregadoEn]].filter((x) => x[1]).map((x) => `<span>${x[0]} ${esc(hora(x[1]))}</span>`).join('')}</td>
          <td data-l="Domiciliario">${esc(o.repartidor || '-')}</td>
          <td class="full" data-l="">${det.join('<br>') || '-'}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">Sin comandas en este periodo.</td></tr>') + '</tbody></table>';
  }
  ['hDesde', 'hHasta', 'hEstado'].forEach((id) => $(id).addEventListener('change', render));
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', render));
  window.addEventListener('storage', (e) => { if (e.key === SmashDB.KEYS.ORDERS) render(); });
  setInterval(render, 10000);
})();
