/* ============================================================
   SMASH · caja-ui.js (caja y dueños)
   - Ventana de cobro de un pedido (pagos combinados, cuenta receptora).
   - Caja (panel operativo): apertura, movimientos, pendientes y cierre.
   - Caja y cierres (dueños): turnos, medios de pago y cuentas bancarias.
   ============================================================ */
const SmashCajaUI = (function () {
  const SC = SmashCaja, esc = SmashUI.esc, fmt = SmashUI.fmt;
  const $ = (id) => document.getElementById(id);
  const dash = () => $('dashboardSection') && !$('dashboardSection').hidden;
  const shown = (id) => dash() && $(id) && !$(id).hidden;
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '-');
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  const esDueno = () => SmashUI.who() !== 'cocina';
  const por = () => { const t = SC.turnoAbierto(); return esDueno() ? 'dueño' : t ? t.cajero : 'caja'; };
  const metodoOpts = (cur) => Object.keys(SC.METODOS).map((k) => `<option value="${k}"${k === cur ? ' selected' : ''}>${SC.METODOS[k]}</option>`).join('');
  const cuentaOpts = (cur) => '<option value="">— Cuenta que recibió —</option>' + SC.getCuentas().filter((c) => c.activa !== false)
    .map((c) => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(SC.cuentaNombre(c))}</option>`).join('');
  const difHtml = (d) => `<span class="${d < 0 ? 'neg' : d > 0 ? 'pos' : ''}">${d > 0 ? '+' : ''}${fmt(d)}</span>`;
  function refreshAll() { SmashUI.refresh(); render(); }

  /* ================= COBRO DE UN PEDIDO =================
     op.entregar: se llama desde "Entregado". El pedido solo se marca entregado al registrar
     el pago (o si alguien elige a propósito "Entregar sin cobrar"), para que no se olvide cobrar. */
  const sinCobroHtml = '<p class="pg-sincobro"><button type="button" class="btn-link" id="pgSinCobro">Entregar sin cobrar ahora (queda "Por cobrar" en Caja)</button></p>';
  function enlazarSinCobro(m, op) {
    const b = m && m.querySelector('#pgSinCobro');
    if (!b) return;
    b.addEventListener('click', () => {
      if (!confirm('¿Marcar el pedido como entregado SIN registrar el pago?\nQuedará en la lista "Por cobrar" de Caja hasta que se cobre.')) return;
      SmashUI.closeModal();
      op.entregar();
    });
  }
  function openPago(o, op) {
    op = op || {};
    const ep = SC.estadoPago(o), num = o.numeroDia || o.id;
    if (ep.k === 'pagado' || ep.k === 'devolver') {
      const p = ep.pago, t = SC.turnoAbierto(), puedeAnular = t && p.turnoId === t.id;
      const m = SmashUI.modal(`Pago del pedido #${esc(num)}`,
        `<div class="simple-table">${p.lineas.map((l) => `<div class="row"><span>${esc(SC.METODOS[l.metodo])}${l.cuenta ? ' · ' + esc(l.cuenta) : ''}${l.ref ? ' · ref ' + esc(l.ref) : ''}</span><b>${fmt(l.monto)}</b></div>`).join('')}
          <div class="row"><span>Total cobrado${p.domicilio ? ` (incluye ${fmt(p.domicilio)} de domicilio)` : ''}</span><b>${fmt(p.total)}</b></div></div>
        <p class="hint">Registrado ${esc(fecha(p.en))} por ${esc(p.por)}.</p>
        ${ep.k === 'devolver' ? '<p class="error">El pedido fue cancelado después de cobrarse: registra la devolución en Caja.</p>' : ''}
        ${puedeAnular ? '<label class="ed-wide">Motivo para anular el pago (solo si se registró mal)<input id="anMot" maxlength="150"></label><p class="error" id="anErr"></p>'
          : '<p class="hint">Este pago es de un turno cerrado. Si hay que devolver dinero, registra una devolución en Caja.</p>'}`,
        (mm) => {
          if (!puedeAnular) return;
          try { SC.anularPago(p.id, mm.querySelector('#anMot').value, por()); } catch (e) { mm.querySelector('#anErr').textContent = e.message; return false; }
          refreshAll();
        }, puedeAnular ? 'Anular pago' : 'Cerrar');
      if (!puedeAnular) m.querySelector('.sm-cancel').hidden = true;
      return;
    }
    if (!SC.turnoAbierto()) {
      const m = SmashUI.modal('Caja cerrada', '<p>Para registrar pagos primero hay que <b>abrir la caja</b> con el dinero inicial.</p>' +
        (op.entregar ? '<p class="hint">El pedido se marca como entregado cuando quede cobrado.</p>' + sinCobroHtml : ''), () => {
        const b = document.querySelector('.nav-btn[data-section="caja"]'); if (b) b.click();
      }, document.querySelector('.nav-btn[data-section="caja"]') ? 'Ir a Caja' : 'Entendido');
      if (op.entregar) enlazarSinCobro(m, op);
      return m;
    }
    const conDom = (o.domicilio || 0) > 0 && !o.domicilioPendiente;
    const d = SmashComandas.desglose(o);
    const metodo0 = /transf/i.test(o.pago) ? 'transferencia' : /efect/i.test(o.pago) ? 'efectivo' : 'efectivo';
    let lineas = [{ metodo: metodo0, monto: SC.montoACobrar(o, false), cuentaId: '', ref: '' }];
    const m = SmashUI.modal(`${op.entregar ? 'Cobrar y entregar' : 'Cobrar'} pedido #${esc(num)}`, '<div id="pgBody"></div>' + (op.entregar ? sinCobroHtml : ''), (mm) => {
      try {
        SC.registrarPago(o.id, { lineas, incluyeDomicilio: conDom && mm.querySelector('#pgDom').checked }, por());
      } catch (e) { mm.querySelector('#pgErr').textContent = e.message; return false; }
      refreshAll();
      if (op.entregar) op.entregar();
    }, op.entregar ? '💰 Cobrar y entregar' : '💰 Registrar pago');
    m.querySelector('.sm-box').classList.add('wide');
    if (op.entregar) enlazarSinCobro(m, op);
    const body = m.querySelector('#pgBody');
    const debe = () => SC.montoACobrar(o, conDom && body.querySelector('#pgDom') && body.querySelector('#pgDom').checked);
    function draw() {
      const inclDom = body.querySelector('#pgDom') ? body.querySelector('#pgDom').checked : false;
      body.innerHTML = `
        <div class="desg" style="margin-top:0"><span>Productos ${fmt(d.productos)}</span>${d.adicionales ? `<span>Adicionales ${fmt(d.adicionales)}</span>` : ''}${d.descuento ? `<span>Descuento −${fmt(d.descuento)}</span>` : ''}<span>Domicilio ${o.domicilioPendiente ? 'por confirmar' : fmt(d.domicilio)}</span></div>
        ${conDom ? `<label class="chk"><input type="checkbox" id="pgDom"${inclDom ? ' checked' : ''}> El cliente también le pagó el domicilio (${fmt(o.domicilio)}) a SMASH</label>
          <p class="hint">Márcalo si, por ejemplo, transfirió el total. Ese dinero es del domiciliario: cuando se lo entregues regístralo en Caja como "Pago a domiciliario".</p>` : '<p class="hint">El domicilio lo cobra el domiciliario directamente.</p>'}
        <div class="pg-debe">Valor a cobrar: <b id="pgDebe"></b></div>
        <div class="pg-lineas">${lineas.map((l, i) => `
          <div class="pg-linea">
            <select data-pi="${i}" data-pf="metodo">${metodoOpts(l.metodo)}</select>
            <input type="number" min="0" step="100" inputmode="numeric" data-pi="${i}" data-pf="monto" value="${esc(l.monto)}" placeholder="Valor">
            ${l.metodo === 'transferencia' ? `<select data-pi="${i}" data-pf="cuentaId" class="pg-wide">${cuentaOpts(l.cuentaId)}</select>
              <input data-pi="${i}" data-pf="ref" maxlength="60" class="pg-wide" placeholder="Referencia o comprobante (opcional)" value="${esc(l.ref)}">` : ''}
            ${l.metodo === 'efectivo' ? `<input type="number" min="0" step="1000" inputmode="numeric" data-pi="${i}" data-pf="recibe" class="pg-wide" placeholder="¿Con cuánto paga?" title="Para calcular el cambio" value="${esc(l.recibe || '')}"><span class="hint pg-wide pg-cambio" data-ci="${i}"></span>` : ''}
            ${lineas.length > 1 ? `<button type="button" class="btn-x" data-prm="${i}" aria-label="Quitar">✕</button>` : ''}
          </div>`).join('')}</div>
        ${SC.getCuentas().some((c) => c.activa !== false) ? '' : '<p class="hint">No hay cuentas bancarias registradas: los dueños las agregan en "Caja y cierres".</p>'}
        <button type="button" class="btn-secondary" id="pgAdd">+ Pago combinado (otro medio)</button>
        <p class="hint" id="pgSuma"></p><p class="error" id="pgErr"></p>`;
      suma();
    }
    function suma() {
      const s = lineas.reduce((a, l) => a + (Math.round(Number(l.monto)) || 0), 0), dd = debe();
      body.querySelector('#pgDebe').textContent = fmt(dd);
      body.querySelector('#pgSuma').innerHTML = s === dd ? '✓ Los pagos cubren el valor a cobrar.' : s < dd ? `<span class="neg">Faltan ${fmt(dd - s)}</span>` : `<span class="neg">Sobran ${fmt(s - dd)}</span>`;
      body.querySelectorAll('.pg-cambio').forEach((el) => {
        const l = lineas[+el.dataset.ci], rec = Number(l.recibe) || 0, mon = Number(l.monto) || 0;
        el.textContent = rec ? (rec >= mon ? 'Cambio a devolver: ' + fmt(rec - mon) : 'El dinero recibido no alcanza') : '';
      });
    }
    body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.id === 'pgDom') {
        if (lineas.length === 1) lineas[0].monto = debe();
        draw(); return;
      }
      if (t.dataset.pf == null) return;
      lineas[+t.dataset.pi][t.dataset.pf] = t.value;
      if (t.dataset.pf === 'metodo') draw(); else suma();
    });
    body.addEventListener('click', (e) => {
      if (e.target.id === 'pgAdd') {
        const falta = Math.max(0, debe() - lineas.reduce((a, l) => a + (Number(l.monto) || 0), 0));
        lineas.push({ metodo: lineas[0].metodo === 'efectivo' ? 'transferencia' : 'efectivo', monto: falta, cuentaId: '', ref: '' });
        draw();
      } else if (e.target.dataset.prm != null) { lineas.splice(+e.target.dataset.prm, 1); draw(); }
    });
    draw();
  }

  /* ================= CAJA (panel operativo) ================= */
  const root = document.querySelector('#section-caja .caja-root');
  // Huella de los datos de caja: si no cambió, no se redibuja (no se pierde lo que se está escribiendo)
  const firma = () => [SC.K.TURNOS, SC.K.PAGOS, SC.K.MOVS, SC.K.CUENTAS, SmashDB.KEYS.ORDERS].map((k) => (SmashLS.getItem(k) || '').length).join('|');
  let ultimaFirma = '';
  function renderCaja(forzar) {
    if (!root || !shown('section-caja')) return;
    const a = document.activeElement;
    if (a && root.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return; // no borrar lo que se está escribiendo
    const f = firma();
    if (!forzar && f === ultimaFirma && root.innerHTML) return;
    ultimaFirma = f;
    const t = SC.turnoAbierto(), turnos = SC.getTurnos();
    const ultimos = turnos.filter((x) => x.estado === 'cerrado').slice(-5).reverse();
    const histCierres = ultimos.length ? `<h3 class="section-title">Últimos cierres</h3><table class="rtable"><thead><tr><th>Cierre</th><th>Cajero</th><th class="num">Esperado</th><th class="num">Contado</th><th class="num">Diferencia</th></tr></thead><tbody>` +
      ultimos.map((x) => `<tr><td class="first">${esc(fecha(x.cierre.en))}</td><td data-l="Cajero">${esc(x.cajero)}</td><td class="num" data-l="Esperado">${fmt(x.cierre.esperado)}</td><td class="num" data-l="Contado">${fmt(x.cierre.contado)}</td><td class="num" data-l="Diferencia">${difHtml(x.cierre.diferencia)}</td></tr>`).join('') + '</tbody></table>' : '';
    if (!t) {
      const last = turnos[turnos.length - 1];
      root.innerHTML = `<div class="mod-box"><h3 style="margin-top:0">🔒 La caja está cerrada</h3>
        <p class="hint">Ábrela al iniciar el turno. Sin caja abierta no se pueden registrar pagos ni movimientos.</p>
        <div class="mod-form">
          <label>Quién abre la caja<input id="cjCajero" maxlength="60" value="${esc(last ? last.cajero : '')}"></label>
          <label>Dinero inicial en efectivo (base)<input id="cjBase" type="number" min="0" step="1000" inputmode="numeric" placeholder="Ej: 100000"></label>
          <div class="mod-actions wide"><button type="button" class="btn-primary" id="cjAbrir">🔓 Abrir caja</button></div>
          <p class="error wide" id="cjMsg"></p>
        </div></div>${histCierres}`;
      return;
    }
    const res = SC.resumenTurno(t), pend = SC.pendientes(), devolver = SC.canceladosConPago();
    const pagosT = SC.getPagos().filter((p) => p.turnoId === t.id), movsT = SC.getMovs().filter((m) => m.turnoId === t.id);
    const egresos = Object.keys(SC.MOV_TIPOS).filter((k) => SC.MOV_TIPOS[k].signo < 0);
    root.innerHTML = `
      <div class="banner green">🔓 Caja abierta por <b>${esc(t.cajero)}</b> desde ${esc(fecha(t.abierto))} · base ${fmt(t.base)}</div>
      <div class="summary-grid" style="margin-top:12px">
        <div class="summary-box"><div class="label">💵 Efectivo cobrado</div><div class="value">${fmt(res.porMetodo.efectivo)}</div></div>
        <div class="summary-box"><div class="label">🏦 Transferencias</div><div class="value">${fmt(res.porMetodo.transferencia)}</div></div>
        <div class="summary-box"><div class="label">Otros medios</div><div class="value">${fmt(res.porMetodo.otro)}</div></div>
        <div class="summary-box"><div class="label">Pagos registrados</div><div class="value">${res.nPagos}</div></div>
        <div class="summary-box"><div class="label">Ingresos adicionales (efectivo)</div><div class="value">${fmt(res.porTipo.ingreso.efectivo)}</div></div>
        <div class="summary-box"><div class="label">Salidas de efectivo</div><div class="value">${fmt(res.egresosEf)}</div></div>
        <div class="summary-box"><div class="label">Efectivo esperado en caja</div><div class="value">${fmt(res.esperado)}</div><div class="sub">base + entradas − salidas</div></div>
        ${res.domicilios ? `<div class="summary-box"><div class="label">Domicilios cobrados por SMASH</div><div class="value">${fmt(res.domicilios)}</div><div class="sub">entregados: ${fmt(res.porTipo.pago_domiciliario.efectivo + res.porTipo.pago_domiciliario.otros)}</div></div>` : ''}
      </div>
      ${Object.keys(res.porCuenta).length ? `<div class="simple-table">${Object.keys(res.porCuenta).map((k) => `<div class="row"><span>🏦 ${esc(res.porCuenta[k].nombre)}</span><span>${fmt(res.porCuenta[k].v)} · ${res.porCuenta[k].n}</span></div>`).join('')}</div>` : ''}
      ${devolver.length ? `<div class="banner danger" style="text-align:left">⚠ Pedidos cancelados que ya estaban pagados: ${devolver.map((o) => '#' + esc(o.numeroDia || o.id) + ' ' + esc(o.cliente)).join(', ')}. Registra la devolución abajo (tipo "Devolución a cliente").</div>` : ''}

      <h3 class="section-title">Pendientes de pago (${pend.length})</h3>
      ${pend.length ? `<div class="pend-list">${pend.sort((x, y) => x.id - y.id).map((o) => `<div class="pend-item"><div><b>#${esc(o.numeroDia || o.id)}</b> ${esc(o.cliente)} <span class="st-badge st-${esc(o.status)}">${esc(SmashComandas.NOMBRE[o.status])}</span><br>
        <small class="hint">${esc(o.pago || 'sin medio indicado')} · comanda ${esc(SmashComandas.codigo(o))}</small></div><b>${fmt(SC.montoACobrar(o, false))}</b>
        <button type="button" class="btn-primary" data-act="pay" data-id="${esc(o.id)}">💰 Cobrar</button></div>`).join('')}</div>` : '<p class="hint">No hay pedidos pendientes de pago.</p>'}

      <h3 class="section-title">Registrar movimiento de caja</h3>
      <div class="mod-form mod-box">
        <label>Tipo<select id="cmTipo">${Object.keys(SC.MOV_TIPOS).map((k) => `<option value="${k}">${SC.MOV_TIPOS[k].n}</option>`).join('')}</select></label>
        <label>Medio<select id="cmMetodo">${metodoOpts('efectivo')}</select></label>
        <label>Valor<input id="cmMonto" type="number" min="0" step="100" inputmode="numeric"></label>
        <label id="cmCuentaW" hidden>Cuenta<select id="cmCuenta">${cuentaOpts('')}</select></label>
        <label>Pedido # (opcional)<input id="cmPedido" maxlength="20" placeholder="Ej: 12"></label>
        <label class="wide">Concepto / motivo<input id="cmConcepto" maxlength="150" placeholder="Ej: hielo, cambio para el domiciliario, devolución pedido 12"></label>
        <div class="mod-actions wide"><button type="button" class="btn-primary" id="cmGuardar">Registrar movimiento</button></div>
        <p class="error wide" id="cmMsg"></p>
      </div>

      <h3 class="section-title">Movimientos del turno</h3>
      <table class="rtable"><thead><tr><th>Hora</th><th>Tipo</th><th>Detalle</th><th>Medio</th><th class="num">Valor</th><th>Por</th></tr></thead><tbody>
      ${pagosT.map((p) => ({ en: p.en, html: `<tr${p.anulado ? ' class="row-cancel"' : ''}><td class="first">${esc(hora(p.en))}</td><td data-l="Tipo">Pago pedido #${esc(p.num)}${p.anulado ? ' (anulado)' : ''}</td><td data-l="Detalle">${esc(p.cliente)}${p.domicilio ? ' · incl. domicilio ' + fmt(p.domicilio) : ''}${p.anulado ? ' · ' + esc(p.anulado.motivo) : ''}</td>
        <td data-l="Medio">${esc(p.lineas.map((l) => SC.METODOS[l.metodo] + (l.cuenta ? ' (' + l.cuenta + ')' : '')).join(' + '))}</td><td class="num pos" data-l="Valor">+${fmt(p.total)}</td><td data-l="Por">${esc(p.por)}</td></tr>` }))
        .concat(movsT.map((m) => ({ en: m.en, html: `<tr><td class="first">${esc(hora(m.en))}</td><td data-l="Tipo">${esc(SC.MOV_TIPOS[m.tipo].n)}</td><td data-l="Detalle">${esc(m.concepto)}${m.pedidoNum ? ' · pedido #' + esc(m.pedidoNum) : ''}</td>
        <td data-l="Medio">${esc(SC.METODOS[m.metodo])}${m.cuenta ? ' (' + esc(m.cuenta) + ')' : ''}</td><td class="num ${SC.MOV_TIPOS[m.tipo].signo < 0 ? 'neg' : 'pos'}" data-l="Valor">${SC.MOV_TIPOS[m.tipo].signo < 0 ? '−' : '+'}${fmt(m.monto)}</td><td data-l="Por">${esc(m.por)}</td></tr>` })))
        .sort((x, y) => y.en.localeCompare(x.en)).map((x) => x.html).join('') || '<tr><td colspan="6" class="empty">Todavía no hay movimientos.</td></tr>'}
      </tbody></table>

      <h3 class="section-title">Cierre de caja</h3>
      <div class="mod-box">
        <div class="simple-table">
          <div class="row"><span>Base inicial</span><b>${fmt(t.base)}</b></div>
          <div class="row"><span>+ Ventas en efectivo</span><b>${fmt(res.porMetodo.efectivo)}</b></div>
          <div class="row"><span>+ Ingresos adicionales en efectivo</span><b>${fmt(res.porTipo.ingreso.efectivo)}</b></div>
          ${egresos.map((k) => res.porTipo[k].efectivo ? `<div class="row"><span>− ${esc(SC.MOV_TIPOS[k].n)}</span><b>${fmt(res.porTipo[k].efectivo)}</b></div>` : '').join('')}
          <div class="row"><span><b>Dinero esperado</b></span><b>${fmt(res.esperado)}</b></div>
        </div>
        <div class="mod-form" style="margin-top:10px">
          <label>Dinero contado físicamente<input id="ciContado" type="number" min="0" step="100" inputmode="numeric"></label>
          <label>Observaciones del cierre<input id="ciNota" maxlength="200"></label>
          <p class="wide" id="ciDif"></p>
          ${pend.length ? `<p class="hint wide">⚠ Quedan ${pend.length} pedidos pendientes de pago. Puedes cerrar igual; seguirán pendientes en el próximo turno.</p>` : ''}
          <div class="mod-actions wide"><button type="button" class="btn-primary" id="ciCerrar">🔒 Cerrar caja</button></div>
          <p class="error wide" id="ciMsg"></p>
        </div>
      </div>${histCierres}`;
    root.dataset.esperado = res.esperado;
  }
  if (root) {
    root.addEventListener('click', (e) => {
      const id = e.target.id;
      if (id === 'cjAbrir') {
        try { SC.abrirTurno({ cajero: $('cjCajero').value, base: $('cjBase').value }, esDueno() ? 'dueño' : 'caja'); } catch (x) { $('cjMsg').textContent = x.message; return; }
        document.activeElement.blur(); refreshAll();
      } else if (id === 'cmGuardar') {
        try {
          SC.registrarMovimiento({ tipo: $('cmTipo').value, metodo: $('cmMetodo').value, monto: $('cmMonto').value, concepto: $('cmConcepto').value, pedidoNum: $('cmPedido').value, cuentaId: $('cmCuenta').value }, por());
        } catch (x) { $('cmMsg').className = 'error wide'; $('cmMsg').textContent = x.message; return; }
        document.activeElement.blur(); render();
      } else if (id === 'ciCerrar') {
        const contado = $('ciContado').value;
        if (contado === '') { $('ciMsg').textContent = 'Escribe el dinero contado físicamente.'; return; }
        const dif = Math.round(Number(contado)) - Number(root.dataset.esperado);
        if (!confirm('¿Cerrar la caja?\n\nEsperado: ' + fmt(Number(root.dataset.esperado)) + '\nContado: ' + fmt(Number(contado)) + '\nDiferencia: ' + fmt(dif) + '\n\nUn cierre no se puede deshacer.')) return;
        try { SC.cerrarTurno({ contado, nota: $('ciNota').value }, por()); } catch (x) { $('ciMsg').textContent = x.message; return; }
        document.activeElement.blur(); refreshAll();
      }
    });
    root.addEventListener('input', (e) => {
      if (e.target.id === 'cmMetodo') $('cmCuentaW').hidden = e.target.value !== 'transferencia';
      if (e.target.id === 'ciContado') {
        const v = e.target.value;
        $('ciDif').innerHTML = v === '' ? '' : 'Diferencia de caja (contado − esperado): <b>' + difHtml(Math.round(Number(v)) - Number(root.dataset.esperado)) + '</b>';
      }
    });
  }

  /* ================= CAJA Y CIERRES (dueños) ================= */
  const droot = document.querySelector('#section-cierres .cierres-root');
  let dtab = 'turnos';
  function renderDueno() {
    if (!droot || !shown('section-cierres')) return;
    const a = document.activeElement;
    if (a && droot.contains(a) && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    const tabs = [['turnos', 'Turnos y cierres'], ['medios', 'Ventas por medio de pago'], ['cuentas', 'Cuentas bancarias']];
    let html = `<div class="period-tabs mod-tabs">${tabs.map((t) => `<button type="button" data-dt="${t[0]}"${t[0] === dtab ? ' class="active"' : ''}>${t[1]}</button>`).join('')}</div>`;
    if (dtab === 'turnos') {
      const turnos = SC.getTurnos().slice().reverse();
      const cerr = turnos.filter((t) => t.cierre), sumDif = cerr.reduce((s, t) => s + t.cierre.diferencia, 0);
      html += `<div class="summary-grid"><div class="summary-box"><div class="label">Turnos cerrados</div><div class="value">${cerr.length}</div></div>
        <div class="summary-box"><div class="label">Con diferencia</div><div class="value ${cerr.some((t) => t.cierre.diferencia) ? 'neg' : ''}">${cerr.filter((t) => t.cierre.diferencia).length}</div></div>
        <div class="summary-box"><div class="label">Diferencia acumulada</div><div class="value">${difHtml(sumDif)}</div></div>
        <div class="summary-box"><div class="label">Caja ahora</div><div class="value" style="font-size:.95rem">${SC.turnoAbierto() ? 'Abierta (' + esc(SC.turnoAbierto().cajero) + ')' : 'Cerrada'}</div></div></div>` +
        (turnos.map((t) => {
          const res = t.cierre ? t.cierre.resumen : SC.resumenTurno(t);
          return `<details class="mod-box"><summary>${esc(fecha(t.abierto))} · ${esc(t.cajero)} · ${t.cierre ? 'cerrado, diferencia&nbsp;' + difHtml(t.cierre.diferencia) : '<span class="pos">abierto</span>'}</summary>
            <div class="simple-table">
              <div class="row"><span>Base inicial</span><b>${fmt(t.base)}</b></div>
              <div class="row"><span>Ventas en efectivo</span><b>${fmt(res.porMetodo.efectivo)}</b></div>
              <div class="row"><span>Transferencias</span><b>${fmt(res.porMetodo.transferencia)}</b></div>
              <div class="row"><span>Otros medios</span><b>${fmt(res.porMetodo.otro)}</b></div>
              ${Object.keys(res.porTipo).map((k) => res.porTipo[k].efectivo + res.porTipo[k].otros ? `<div class="row"><span>${esc(SC.MOV_TIPOS[k].n)}</span><b>${fmt(res.porTipo[k].efectivo + res.porTipo[k].otros)}</b></div>` : '').join('')}
              ${res.domicilios ? `<div class="row"><span>Domicilios cobrados por SMASH (del domiciliario)</span><b>${fmt(res.domicilios)}</b></div>` : ''}
              <div class="row"><span>Efectivo esperado</span><b>${fmt(res.esperado)}</b></div>
              ${t.cierre ? `<div class="row"><span>Efectivo contado</span><b>${fmt(t.cierre.contado)}</b></div><div class="row"><span>Diferencia</span><b>${difHtml(t.cierre.diferencia)}</b></div>
              <div class="row"><span>Cerrado</span><span>${esc(fecha(t.cierre.en))} por ${esc(t.cierre.por)}${t.cierre.pendientes ? ' · ' + t.cierre.pendientes + ' pedidos sin pagar' : ''}</span></div>` : ''}
            </div>${t.cierre && t.cierre.nota ? `<p class="hint">Nota: ${esc(t.cierre.nota)}</p>` : ''}</details>`;
        }).join('') || '<p class="hint">Todavía no se ha abierto ninguna caja.</p>');
    } else if (dtab === 'medios') {
      const d1 = droot.dataset.d1 || SmashStore.today(), d2 = droot.dataset.d2 || d1, res = SC.resumenPeriodo(d1, d2);
      html += `<div class="date-row"><label class="mod-inline" style="margin:0">Desde<input type="date" id="mdD1" value="${d1}"></label><label class="mod-inline" style="margin:0">Hasta<input type="date" id="mdD2" value="${d2}"></label></div>
        <div class="summary-grid">
          <div class="summary-box"><div class="label">💵 Efectivo</div><div class="value">${fmt(res.porMetodo.efectivo)}</div></div>
          <div class="summary-box"><div class="label">🏦 Transferencias</div><div class="value">${fmt(res.porMetodo.transferencia)}</div></div>
          <div class="summary-box"><div class="label">Otros medios</div><div class="value">${fmt(res.porMetodo.otro)}</div></div>
          <div class="summary-box"><div class="label">Total cobrado</div><div class="value">${fmt(res.porMetodo.efectivo + res.porMetodo.transferencia + res.porMetodo.otro)}</div><div class="sub">${res.nPagos} pagos</div></div>
        </div>
        <h3 class="section-title">Transferencias por cuenta receptora</h3>
        ${Object.keys(res.porCuenta).length ? `<table class="rtable"><thead><tr><th>Cuenta</th><th class="num">Pagos</th><th class="num">Valor</th></tr></thead><tbody>${Object.keys(res.porCuenta).map((k) => `<tr><td class="first">${esc(res.porCuenta[k].nombre)}</td><td class="num" data-l="Pagos">${res.porCuenta[k].n}</td><td class="num" data-l="Valor">${fmt(res.porCuenta[k].v)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Sin transferencias en este periodo.</p>'}
        <h3 class="section-title">Movimientos de caja</h3>
        <table class="rtable"><thead><tr><th>Tipo</th><th class="num">Efectivo</th><th class="num">Otros medios</th></tr></thead><tbody>
        ${Object.keys(SC.MOV_TIPOS).map((k) => `<tr><td class="first">${esc(SC.MOV_TIPOS[k].n)}</td><td class="num" data-l="Efectivo">${fmt(res.porTipo[k].efectivo)}</td><td class="num" data-l="Otros">${fmt(res.porTipo[k].otros)}</td></tr>`).join('')}</tbody></table>
        <p class="hint">${res.domicilios ? `Incluye ${fmt(res.domicilios)} de domicilios que los clientes pagaron a SMASH (son de los domiciliarios). ` : ''}Los valores son del día en que se registró cada pago o movimiento.</p>`;
    } else {
      const cuentas = SC.getCuentas(), uso = SC.resumenPeriodo('0000-00-00', '9999-12-31').porCuenta, hist = SC.getCuentasHist().slice().reverse().slice(0, 50);
      const edit = droot.dataset.edit ? SC.getCuenta(droot.dataset.edit) : null;
      html += `<p class="hint">Cuentas donde los clientes transfieren. Solo se guardan datos para identificarlas: nunca contraseñas, claves ni códigos de acceso.</p>
        <div class="mod-form mod-box">
          <label>Nombre corto<input id="cbAlias" maxlength="50" placeholder="Ej: Nequi principal" value="${esc(edit ? edit.alias : '')}"></label>
          <label>Banco / billetera<input id="cbBanco" maxlength="50" list="cbBancos" value="${esc(edit ? edit.banco : '')}"></label>
          <label>Tipo<select id="cbTipo">${['Ahorros', 'Corriente', 'Billetera digital', 'Otro'].map((x) => `<option${edit && edit.tipo === x ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          <label>Número (opcional)<input id="cbNumero" maxlength="30" inputmode="numeric" value="${esc(edit ? edit.numero : '')}"></label>
          <label class="wide">Titular (opcional)<input id="cbTitular" maxlength="80" value="${esc(edit ? edit.titular : '')}"></label>
          <datalist id="cbBancos"><option>Nequi</option><option>Daviplata</option><option>Bancolombia</option><option>Davivienda</option><option>Banco de Bogotá</option><option>BBVA</option></datalist>
          <div class="mod-actions wide"><button type="button" class="btn-primary" id="cbGuardar">${edit ? 'Guardar cambios' : '+ Agregar cuenta'}</button>${edit ? '<button type="button" class="btn-secondary" id="cbCancelar">Cancelar</button>' : ''}</div>
          <p class="error wide" id="cbMsg"></p>
        </div>
        <table class="rtable"><thead><tr><th>Cuenta</th><th>Tipo</th><th>Estado</th><th class="num">Recibido (histórico)</th><th></th></tr></thead><tbody>
        ${cuentas.map((c) => `<tr><td class="first">${esc(SC.cuentaNombre(c))}${c.titular ? `<br><small class="hint">${esc(c.titular)}</small>` : ''}</td><td data-l="Tipo">${esc(c.tipo || '-')}</td>
          <td data-l="Estado"><span class="badge ${c.activa === false ? 'inactivo' : ''}">${c.activa === false ? 'Inactiva' : 'Activa'}</span></td>
          <td class="num" data-l="Recibido">${uso[c.id] ? fmt(uso[c.id].v) + ' · ' + uso[c.id].n : '-'}</td>
          <td><div class="mod-actions" style="margin:0"><button type="button" class="btn-secondary" data-cbe="${esc(c.id)}">Editar</button><button type="button" class="btn-secondary" data-cbt="${esc(c.id)}">${c.activa === false ? 'Activar' : 'Desactivar'}</button></div></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin cuentas registradas.</td></tr>'}
        </tbody></table>
        <h3 class="section-title">Historial de cambios de cuentas</h3>
        <table class="rtable"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Cambio</th><th>Por</th></tr></thead><tbody>
        ${hist.map((h) => { const c = SC.getCuenta(h.cuentaId); const det = h.antes && h.despues ? Object.keys(h.despues).filter((k) => h.antes[k] !== h.despues[k]).map((k) => k + ': ' + (h.antes[k] || '-') + ' → ' + (h.despues[k] || '-')).join(' · ') : ''; return `<tr><td class="first">${esc(fecha(h.en))}</td><td data-l="Cuenta">${esc(c ? c.alias : '?')}</td><td data-l="Cambio">${esc(h.accion)}${det ? ': ' + esc(det) : ''}</td><td data-l="Por">${esc(h.por || '-')}</td></tr>`; }).join('') || '<tr><td colspan="4" class="empty">Sin cambios.</td></tr>'}
        </tbody></table>`;
    }
    droot.innerHTML = html;
  }
  if (droot) {
    droot.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.dt) { dtab = b.dataset.dt; delete droot.dataset.edit; renderDueno(); }
      else if (b.id === 'cbGuardar') {
        try {
          SC.guardarCuenta({ id: droot.dataset.edit || null, alias: $('cbAlias').value, banco: $('cbBanco').value, tipo: $('cbTipo').value, numero: $('cbNumero').value, titular: $('cbTitular').value }, 'dueño');
        } catch (x) { $('cbMsg').textContent = x.message; return; }
        delete droot.dataset.edit; document.activeElement.blur(); renderDueno();
      } else if (b.id === 'cbCancelar') { delete droot.dataset.edit; renderDueno(); }
      else if (b.dataset.cbe) { droot.dataset.edit = b.dataset.cbe; renderDueno(); $('cbAlias').focus(); }
      else if (b.dataset.cbt) { const c = SC.getCuenta(b.dataset.cbt); SC.setCuentaActiva(c.id, c.activa === false, 'dueño'); renderDueno(); }
    });
    droot.addEventListener('change', (e) => {
      if (e.target.id === 'mdD1' || e.target.id === 'mdD2') { droot.dataset.d1 = $('mdD1').value; droot.dataset.d2 = $('mdD2').value; e.target.blur(); renderDueno(); }
    });
  }

  function render() { renderCaja(true); renderDueno(); }
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', render));
  window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('smash_') === 0) { renderCaja(false); renderDueno(); } });
  setInterval(() => renderCaja(false), 5000);
  render();
  return { openPago, render };
})();
