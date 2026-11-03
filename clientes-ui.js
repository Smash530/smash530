/* ============================================================
   SMASH · clientes-ui.js (caja y dueños)
   Sección "Clientes y fidelidad": lista (tarjetas en celular),
   ficha completa, puntos y canjes. Solo dueños: programa de puntos,
   posibles duplicados y solicitudes sobre datos personales.
   Reemplaza la lista de clientes que estaba repetida en cocina.js y
   dueno.js, con las mismas funciones (buscar, ordenar, CSV, WhatsApp).
   ============================================================ */
const SmashClientesUI = (function () {
  const root = document.querySelector('#section-clientes .cli-root');
  if (!root) return { render() {} };
  const C = SmashClientes, esc = SmashUI.esc, fmt = SmashUI.fmt, S = SmashStore;
  const esDueno = !!document.getElementById('section-costos');
  const POR = () => (esDueno ? 'dueño' : (typeof SmashCaja !== 'undefined' && SmashCaja.turnoAbierto() ? SmashCaja.turnoAbierto().cajero : 'caja'));
  const $ = (id) => document.getElementById(id);
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO') : '-');
  const fechaH = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  const TIPO_PT = { ganado: 'Ganados', canjeado: 'Canjeados', vencido: 'Vencidos' };
  let lista = [], abierto = null;

  root.innerHTML = `
    <div class="summary-grid" id="cliResumen"></div>
    ${esDueno ? `<details class="mod-box" id="fidBox"><summary>⭐ Programa de puntos</summary><div id="fidCfg"></div></details>
      <div id="cliDups"></div>` : ''}
    <div class="date-row">
      <input type="search" id="cliSearch" placeholder="Buscar por nombre o teléfono">
      <select id="cliSort">
        <option value="spent">Más gastado</option><option value="orders">Más pedidos</option>
        <option value="month">Más pedidos este mes</option><option value="recent">Pedido más reciente</option>
        <option value="points">Más puntos</option>
      </select>
      <button id="cliExport" class="btn-secondary" type="button">Exportar CSV</button>
    </div>
    <div id="cliLista"></div>
    <div id="cliDetalle" class="detail-box" hidden></div>
    ${esDueno ? '<details class="mod-box" style="margin-top:14px"><summary>🔐 Solicitudes sobre datos personales</summary><div id="cliSol"></div></details>' : ''}`;

  function render() {
    if ($('dashboardSection').hidden || $('section-clientes').hidden) return;
    try { C.sincronizar(); } catch (e) { /* se reintenta en la próxima apertura */ }
    lista = C.lista();
    const cfg = C.getCfg(), conPuntos = cfg.activo || C.getPuntos().length > 0;
    const rec = lista.filter((c) => c.n >= 2).length, vendido = lista.reduce((a, c) => a + c.total, 0), pedidos = lista.reduce((a, c) => a + c.n, 0);
    $('cliResumen').innerHTML = `
      <div class="summary-box"><div class="label">Clientes</div><div class="value">${lista.length}</div></div>
      <div class="summary-box"><div class="label">Recurrentes (2+ pedidos)</div><div class="value">${rec} <small>${lista.length ? Math.round((rec * 100) / lista.length) : 0}%</small></div></div>
      <div class="summary-box"><div class="label">Total vendido</div><div class="value">${fmt(vendido)}</div><div class="sub">en productos</div></div>
      <div class="summary-box"><div class="label">Ticket promedio</div><div class="value">${fmt(pedidos ? vendido / pedidos : 0)}</div></div>
      ${conPuntos ? `<div class="summary-box"><div class="label">Puntos vigentes</div><div class="value">${lista.reduce((a, c) => a + (c.puntos || 0), 0)}</div><div class="sub">${cfg.activo ? 'programa activo' : 'programa apagado'}</div></div>` : ''}`;
    renderLista(conPuntos);
    if (esDueno) { renderDups(); if (!$('fidCfg').contains(document.activeElement)) renderCfg(); renderSol(); }
    if (abierto) renderFicha(abierto);
  }

  /* ---------------- Lista ---------------- */
  function filtrados() {
    const t = ($('cliSearch').value || '').trim().toLowerCase(), s = $('cliSort').value;
    const sorters = {
      spent: (a, b) => b.total - a.total, orders: (a, b) => b.n - a.n,
      month: (a, b) => b.esteMes - a.esteMes || b.total - a.total, recent: (a, b) => b.ultimo.localeCompare(a.ultimo),
      points: (a, b) => (b.puntos || 0) - (a.puntos || 0),
    };
    return lista.filter((c) => !t || c.nombre.toLowerCase().includes(t) || c.telefonos.some((x) => x.includes(t.replace(/\D/g, '') || '§'))).sort(sorters[s]);
  }
  function renderLista(conPuntos) {
    const fl = filtrados();
    $('cliLista').innerHTML = `<table class="rtable"><thead><tr><th>Cliente</th><th>Teléfono</th><th class="num">Pedidos</th><th class="num">Gastado</th><th class="num">Este mes</th><th class="num">Promedio/mes</th><th>Último pedido</th>${conPuntos ? '<th class="num">Puntos</th>' : ''}</tr></thead><tbody>` +
      (fl.slice(0, 500).map((c) => `<tr class="cli-row" data-ckey="${esc(c.key)}"><td class="first">${esc(c.nombre)}</td><td data-l="Teléfono">${esc(c.telefono || '-')}</td>
        <td class="num" data-l="Pedidos">${c.n}</td><td class="num" data-l="Gastado">${fmt(c.total)}</td><td class="num" data-l="Este mes">${c.esteMes}</td>
        <td class="num" data-l="Promedio/mes">${c.promMes.toFixed(1)}</td><td data-l="Último pedido">${esc(fechaH(c.ultimo))}</td>
        ${conPuntos ? `<td class="num" data-l="Puntos">${c.puntos == null ? '-' : c.puntos}</td>` : ''}</tr>`).join('') ||
        `<tr><td colspan="8" class="empty">${lista.length ? 'Ningún cliente coincide con la búsqueda.' : 'Aún no hay clientes.'}</td></tr>`) + '</tbody></table>';
  }
  $('cliSearch').addEventListener('input', () => renderLista(C.getCfg().activo || C.getPuntos().length > 0));
  $('cliSort').addEventListener('change', () => renderLista(C.getCfg().activo || C.getPuntos().length > 0));
  $('cliLista').addEventListener('click', (e) => {
    const tr = e.target.closest('tr[data-ckey]'); if (!tr) return;
    abierto = tr.dataset.ckey; renderFicha(abierto);
    $('cliDetalle').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  $('cliExport').addEventListener('click', () => {
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const header = ['nombre', 'telefono', 'direccion', 'pedidos', 'total_gastado', 'gasto_semana', 'gasto_mes', 'ticket_promedio', 'pedidos_este_mes', 'promedio_mes', 'cada_cuantos_dias', 'primer_pedido', 'ultimo_pedido', 'puntos'];
    const rows = filtrados().map((c) => [c.nombre, c.telefono, c.direccion, c.n, c.total, c.semana, c.esteMesV, Math.round(c.ticket), c.esteMes, c.promMes.toFixed(2), c.cadaDias == null ? '' : c.cadaDias.toFixed(1), c.primero, c.ultimo, c.puntos == null ? '' : c.puntos]);
    S.descargar('clientes_smash.csv', '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  });

  /* ---------------- Ficha ---------------- */
  function renderFicha(key) {
    const c = lista.find((x) => x.key === key), box = $('cliDetalle');
    if (!c) { box.hidden = true; abierto = null; return; }
    if (box.contains(document.activeElement) && /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
    const cfg = C.getCfg(), movs = c.telefono ? C.movimientosPuntos(c.key) : [];
    const wa = c.telefono ? 'https://wa.me/57' + c.telefono : '';
    const abiertos = c.pedidos.filter((o) => ['entregado', 'cancelado'].indexOf(o.status) < 0 && !(typeof SmashCaja !== 'undefined' && SmashCaja.pagoDe(o)));
    const recs = cfg.recompensas.filter((r) => r.activa);
    box.hidden = false;
    box.innerHTML = `
      <div class="ficha-head"><div><h3 style="margin:0 0 4px">${esc(c.nombre)}</h3>
        <p class="hint" style="margin:0">${c.telefonos.length ? c.telefonos.map((t) => `<a class="otel" href="tel:${esc(t)}">📞 ${esc(t)}</a>`).join(' ') : 'sin teléfono'}${wa ? ` · <a href="${esc(wa)}" target="_blank" rel="noopener noreferrer">Escribir por WhatsApp</a>` : ''}</p>
        <p class="hint" style="margin:4px 0 0">📍 ${esc(c.direccion || 'sin dirección')}${c.zona ? ' (' + esc(c.zona) + ')' : ''}</p></div>
        <button type="button" class="btn-x" id="cliCerrar" aria-label="Cerrar ficha">✕</button></div>
      <div class="summary-grid" style="margin-top:10px">
        <div class="summary-box"><div class="label">Pedidos</div><div class="value">${c.n}</div></div>
        <div class="summary-box"><div class="label">Gasto histórico</div><div class="value">${fmt(c.total)}</div></div>
        <div class="summary-box"><div class="label">Gasto este mes</div><div class="value">${fmt(c.esteMesV)}</div></div>
        <div class="summary-box"><div class="label">Gasto últimos 7 días</div><div class="value">${fmt(c.semana)}</div></div>
        <div class="summary-box"><div class="label">Ticket promedio</div><div class="value">${fmt(c.ticket)}</div></div>
        <div class="summary-box"><div class="label">Frecuencia</div><div class="value" style="font-size:.95rem">${c.cadaDias == null ? 'Un solo pedido' : 'Cada ' + (c.cadaDias < 1 ? 'menos de 1 día' : Math.round(c.cadaDias) + ' días')}</div><div class="sub">${c.promMes.toFixed(1)} pedidos/mes</div></div>
        <div class="summary-box"><div class="label">Primera compra</div><div class="value" style="font-size:.95rem">${esc(fecha(c.primero))}</div></div>
        <div class="summary-box"><div class="label">Última compra</div><div class="value" style="font-size:.95rem">${esc(fecha(c.ultimo))}</div></div>
      </div>
      <h4>Productos más pedidos</h4>
      <div class="simple-table">${c.top.map((p) => `<div class="row"><span>${esc(p.n)}</span><b>${p.q}</b></div>`).join('')}</div>
      <h4>Por mes</h4>
      <div class="simple-table"><div class="row"><b>Mes</b><b>Pedidos · Gastado</b></div>
        ${Object.keys(c.meses).sort().reverse().map((k) => `<div class="row"><span>${esc(k)}</span><span>${c.meses[k].n} · ${fmt(c.meses[k].t)}</span></div>`).join('')}</div>
      ${cfg.activo || movs.length ? `<h4>⭐ Puntos: <span class="pts">${c.puntos == null ? '-' : c.puntos}</span></h4>
        ${!c.telefono ? '<p class="hint">Sin teléfono no acumula puntos.</p>' : ''}
        ${cfg.activo && c.telefono ? (recs.length ? `<div class="mod-form mod-box">
          <label>Recompensa<select id="canjeRec">${recs.map((r) => `<option value="${esc(r.id)}"${r.puntos > c.puntos ? ' disabled' : ''}>${esc(r.nombre)} · ${r.puntos} pts${r.valor ? ' · −' + fmt(r.valor) : ''}</option>`).join('')}</select></label>
          <label>Aplicar al pedido (opcional)<select id="canjePed"><option value="">— Solo registrar el canje —</option>${abiertos.map((o) => `<option value="${esc(o.id)}">#${esc(o.numeroDia || o.id)} · ${esc(SmashComandas.NOMBRE[o.status])} · ${fmt(o.total)}</option>`).join('')}</select></label>
          <p class="hint wide" style="margin:0">Si la recompensa tiene valor, se descuenta del pedido elegido (antes de cobrarlo).</p>
          <div class="mod-actions wide"><button type="button" class="btn-primary" id="canjeBtn">Canjear puntos</button></div><p class="error wide" id="canjeMsg"></p></div>`
          : '<p class="hint">Los dueños aún no han creado recompensas.</p>') : ''}
        ${movs.length ? `<table class="rtable"><thead><tr><th>Fecha</th><th>Movimiento</th><th>Detalle</th><th class="num">Puntos</th></tr></thead><tbody>
          ${movs.slice(0, 50).map((m) => `<tr><td class="first">${esc(fechaH(m.en))}</td><td data-l="Movimiento">${esc(TIPO_PT[m.tipo] || m.tipo)}</td>
            <td data-l="Detalle">${m.pedidoNum ? 'Pedido #' + esc(m.pedidoNum) : ''}${m.recompensa ? ' ' + esc(m.recompensa) : ''}${m.descuento ? ' (−' + fmt(m.descuento) + ')' : ''}${m.vence && m.tipo === 'ganado' ? ' · vence ' + esc(fecha(m.vence)) : ''}</td>
            <td class="num ${m.puntos < 0 ? 'neg' : 'pos'}" data-l="Puntos">${m.puntos > 0 ? '+' : ''}${m.puntos}</td></tr>`).join('')}</tbody></table>` : ''}` : ''}
      ${esDueno && c.telefono ? `<h4>🔐 Datos personales</h4>
        <p class="hint">Para atender solicitudes del cliente sobre su información (consulta o supresión).</p>
        <div class="mod-actions"><button type="button" class="btn-secondary" id="cliExportar">⬇️ Exportar sus datos</button><button type="button" class="btn-secondary danger-btn" id="cliAnonimizar">Anonimizar cliente</button></div>
        <p class="error" id="cliDatosMsg"></p>` : ''}`;
  }
  $('cliDetalle').addEventListener('click', (e) => {
    const id = e.target.id, c = lista.find((x) => x.key === abierto);
    if (id === 'cliCerrar') { abierto = null; $('cliDetalle').hidden = true; return; }
    if (!c) return;
    if (id === 'canjeBtn') {
      const r = C.getCfg().recompensas.find((x) => x.id === $('canjeRec').value);
      if (r && !confirm('¿Canjear "' + r.nombre + '" por ' + r.puntos + ' puntos para ' + c.nombre + '?')) return;
      try { C.canjear(c.key, $('canjeRec').value, parseInt($('canjePed').value, 10) || null, POR()); }
      catch (x) { $('canjeMsg').textContent = x.message; return; }
      document.activeElement.blur(); SmashUI.refresh(); render();
    } else if (id === 'cliExportar') {
      try {
        const d = C.exportarDatos(c.key, POR());
        S.descargar('datos_cliente_' + (c.telefono || 'sin_tel') + '_' + S.today() + '.json', JSON.stringify(d, null, 2));
        $('cliDatosMsg').className = 'ok-msg'; $('cliDatosMsg').textContent = '✓ Archivo descargado. Entrégaselo al cliente si lo solicitó.';
      } catch (x) { $('cliDatosMsg').textContent = x.message; }
    } else if (id === 'cliAnonimizar') {
      const nota = prompt('Esto borra nombre, teléfono, dirección y notas de ' + c.nombre + ' en TODOS sus pedidos (las ventas se conservan). No se puede deshacer.\n\nEscribe el motivo (ej: solicitud del cliente por WhatsApp):');
      if (!nota) return;
      try { const n = C.anonimizar(c.key, nota, POR()); alert('✓ Cliente anonimizado en ' + n + ' pedidos.'); }
      catch (x) { $('cliDatosMsg').textContent = x.message; return; }
      abierto = null; $('cliDetalle').hidden = true; SmashUI.refresh(); render();
    }
  });

  /* ---------------- Duplicados (dueños) ---------------- */
  function renderDups() {
    const d = C.duplicados(lista);
    $('cliDups').innerHTML = d.length ? `<details class="mod-box"${d.length ? '' : ''}><summary>⚠ Posibles clientes duplicados (${d.length})</summary>
      <p class="hint">Revisa si son la misma persona (por ejemplo, un teléfono mal escrito). Al unirlos, los pedidos y puntos quedan en un solo cliente.</p>
      ${d.slice(0, 30).map((x) => `<div class="dup-item"><div><b>${esc(x.a.nombre)}</b> ${esc(x.a.telefono)} · ${x.a.n} pedidos<br><b>${esc(x.b.nombre)}</b> ${esc(x.b.telefono)} · ${x.b.n} pedidos<br><small class="hint">${esc(x.motivo)}</small></div>
        <div class="mod-actions"><button type="button" class="btn-secondary" data-unir="${esc(x.b.key)}" data-en="${esc(x.a.key)}">Unir en ${esc(x.a.telefono)}</button>
        <button type="button" class="btn-secondary" data-unir="${esc(x.a.key)}" data-en="${esc(x.b.key)}">Unir en ${esc(x.b.telefono)}</button>
        <button type="button" class="btn-secondary" data-nodup="${esc(x.par)}">No son la misma persona</button></div></div>`).join('')}</details>` : '';
  }
  if (esDueno) {
    $('cliDups').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.unir) {
        if (!confirm('¿Unir el teléfono ' + b.dataset.unir + ' dentro de ' + b.dataset.en + '? Sus pedidos y puntos se verán como un solo cliente.')) return;
        try { C.fusionar(b.dataset.unir, b.dataset.en, 'dueño'); } catch (x) { alert(x.message); return; }
      } else if (b.dataset.nodup) C.noEsDuplicado(b.dataset.nodup);
      render();
    });
  }

  /* ---------------- Programa de puntos (dueños) ---------------- */
  let draft = null;
  function renderCfg() {
    const cfg = C.getCfg();
    draft = JSON.parse(JSON.stringify(cfg));
    $('fidCfg').innerHTML = `
      <p class="hint">Tú defines las reglas y puedes cambiarlas cuando quieras. Los cambios aplican a los pedidos que se entreguen desde ese momento; los puntos ya ganados se conservan. Los puntos se calculan sobre el valor de los productos (sin domicilio).</p>
      <div class="mod-form">
        <label class="chk wide"><input type="checkbox" id="fidAct"${cfg.activo ? ' checked' : ''}> Programa activo</label>
        <label>Por cada (COP en productos)<input type="number" id="fidMonto" min="0" step="1000" inputmode="numeric" value="${cfg.monto || ''}" placeholder="Ej: 10000"></label>
        <label>Gana (puntos)<input type="number" id="fidPts" min="0" step="1" inputmode="numeric" value="${cfg.puntos || ''}" placeholder="Ej: 1"></label>
        <label>Los puntos vencen a los (días)<input type="number" id="fidVence" min="0" step="1" inputmode="numeric" value="${cfg.venceDias || 0}"><small class="hint">0 = no vencen</small></label>
      </div>
      <h4>Recompensas</h4>
      <div id="fidRecs"></div>
      <div class="mod-actions"><button type="button" class="btn-secondary" id="fidAddRec">+ Agregar recompensa</button><button type="button" class="btn-primary" id="fidGuardar">Guardar programa</button></div>
      <p class="error" id="fidMsg"></p>
      ${cfg.desde ? `<p class="hint">Activo desde ${esc(fechaH(cfg.desde))}. Cambios registrados: ${C.getCfgHist().length}.</p>` : ''}`;
    renderRecs();
  }
  function renderRecs() {
    $('fidRecs').innerHTML = `<table class="rtable"><thead><tr><th>Recompensa</th><th>Puntos</th><th>Descuento (COP)</th><th>Activa</th><th></th></tr></thead><tbody>` +
      (draft.recompensas.map((r, i) => `<tr><td class="first"><input data-ri="${i}" data-rf="nombre" maxlength="60" value="${esc(r.nombre)}" placeholder="Ej: Hamburguesa Smash gratis"></td>
        <td data-l="Puntos"><input type="number" min="1" data-ri="${i}" data-rf="puntos" value="${esc(r.puntos || '')}"></td>
        <td data-l="Descuento"><input type="number" min="0" step="100" data-ri="${i}" data-rf="valor" value="${esc(r.valor || '')}" placeholder="0 = sin descuento"></td>
        <td data-l="Activa"><input type="checkbox" data-ri="${i}" data-rf="activa"${r.activa !== false ? ' checked' : ''} style="min-width:0;width:24px;min-height:24px"></td>
        <td><button type="button" class="btn-x" data-rdel="${i}" aria-label="Quitar">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Sin recompensas.</td></tr>') + '</tbody></table>';
  }
  if (esDueno) {
    $('fidCfg').addEventListener('input', (e) => {
      const t = e.target; if (t.dataset.rf == null) return;
      draft.recompensas[+t.dataset.ri][t.dataset.rf] = t.type === 'checkbox' ? t.checked : t.value;
    });
    $('fidCfg').addEventListener('click', (e) => {
      const b = e.target;
      if (b.id === 'fidAddRec') { draft.recompensas.push({ nombre: '', puntos: '', valor: '', activa: true }); renderRecs(); }
      else if (b.dataset.rdel != null) { draft.recompensas.splice(+b.dataset.rdel, 1); renderRecs(); }
      else if (b.id === 'fidGuardar') {
        try {
          C.guardarCfg({ activo: $('fidAct').checked, monto: $('fidMonto').value, puntos: $('fidPts').value, venceDias: $('fidVence').value, recompensas: draft.recompensas }, 'dueño');
        } catch (x) { $('fidMsg').className = 'error'; $('fidMsg').textContent = x.message; return; }
        document.activeElement.blur(); render(); renderCfg();
        $('fidMsg').className = 'ok-msg'; $('fidMsg').textContent = '✓ Programa de puntos guardado.';
      }
    });
  }

  /* ---------------- Solicitudes (dueños) ---------------- */
  function renderSol() {
    const s = C.getSolicitudes().slice().reverse().slice(0, 100);
    $('cliSol').innerHTML = `<p class="hint">Registro de exportaciones de datos, anonimizaciones y uniones de clientes.</p>
      <table class="rtable"><thead><tr><th>Fecha</th><th>Tipo</th><th>Detalle</th><th>Por</th></tr></thead><tbody>
      ${s.map((x) => `<tr><td class="first">${esc(fechaH(x.en))}</td><td data-l="Tipo">${esc(x.tipo)}</td><td data-l="Detalle">${esc(x.tipo === 'anonimización' ? x.nota : (x.key || '') + (x.nota ? ' · ' + x.nota : ''))}</td><td data-l="Por">${esc(x.por || '-')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Sin solicitudes.</td></tr>'}
      </tbody></table>`;
  }

  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', render));
  window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('smash_') === 0 && !root.contains(document.activeElement)) render(); });
  // Los puntos de pedidos entregados se suman aunque nadie abra la sección
  setInterval(() => { try { C.sincronizar(); } catch (e) { /* sin espacio: se reintenta */ } }, 15000);
  render();
  return { render };
})();
