/* ============================================================
   SMASH · auditoria-ui.js (solo panel de dueños)
   Consulta del registro de auditoría y cambio de la clave de caja.
   ============================================================ */
(function () {
  const root = document.querySelector('#section-auditoria .aud-root');
  if (!root || typeof SmashAudit === 'undefined') return;
  const A = SmashAudit, esc = SmashUI.esc, S = SmashStore;
  const $ = (id) => document.getElementById(id);
  const fechaH = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'medium' });
  const val = (v) => (v == null ? '' : typeof v === 'object' ? Object.keys(v).map((k) => k + ': ' + (v[k] == null ? '-' : String(v[k]))).join(' · ') : String(v));

  root.innerHTML = `
    <p class="hint">Cada operación importante queda anotada con quién la hizo, cuándo, sobre qué y los valores antes y después. Este registro no se puede editar desde el sistema.</p>
    <div class="date-row">
      <label class="mod-inline" style="margin:0">Desde<input type="date" id="auD1"></label>
      <label class="mod-inline" style="margin:0">Hasta<input type="date" id="auD2"></label>
      <label class="mod-inline" style="margin:0">Acción<select id="auAcc"><option value="">Todas</option></select></label>
      <label class="mod-inline" style="margin:0">Panel<select id="auPanel"><option value="">Ambos</option><option value="caja">Caja</option><option value="dueños">Dueños</option></select></label>
      <input type="search" id="auBuscar" placeholder="Buscar (pedido, producto, usuario...)">
      <button type="button" class="btn-secondary" id="auCsv">Exportar CSV</button>
    </div>
    <div id="auAviso"></div>
    <div id="auLista"></div>`;
  $('auD1').value = S.today().slice(0, 8) + '01'; $('auD2').value = S.today();

  function filtrados() {
    const d1 = $('auD1').value || '0000', d2 = $('auD2').value || '9999', acc = $('auAcc').value, pn = $('auPanel').value, t = $('auBuscar').value.trim().toLowerCase();
    return A.getLog().filter((e) => {
      const d = SmashExt.localDay(e.en);
      if (d < d1 || d > d2 || (acc && e.accion !== acc) || (pn && e.panel !== pn)) return false;
      return !t || JSON.stringify(e).toLowerCase().includes(t);
    }).reverse();
  }
  function render() {
    if ($('dashboardSection').hidden || $('section-auditoria').hidden) return;
    const log = A.getLog(), cur = $('auAcc').value;
    const acciones = [...new Set(log.map((e) => e.accion))].sort();
    $('auAcc').innerHTML = '<option value="">Todas</option>' + acciones.map((a) => `<option${a === cur ? ' selected' : ''}>${esc(a)}</option>`).join('');
    $('auAviso').innerHTML = log.length > 3500 ? `<div class="banner yellow">El registro tiene ${log.length} anotaciones. Se guardan las últimas 4.000: exporta el CSV o descarga un respaldo para conservar las más antiguas.</div>` : '';
    const l = filtrados();
    $('auLista').innerHTML = `<p class="hint">${l.length} anotaciones en el filtro.</p><table class="rtable"><thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th>Registro</th><th>Antes</th><th>Después</th></tr></thead><tbody>` +
      (l.slice(0, 400).map((e) => `<tr><td class="first">${esc(fechaH(e.en))}</td><td data-l="Usuario">${esc(e.usuario)}</td><td data-l="Acción"><b>${esc(e.accion)}</b></td>
        <td data-l="Registro">${esc(e.registro)}</td><td data-l="Antes" class="au-v">${esc(val(e.antes)) || '-'}</td><td data-l="Después" class="au-v">${esc(val(e.despues)) || '-'}</td></tr>`).join('') ||
        '<tr><td colspan="6" class="empty">Sin anotaciones en este filtro.</td></tr>') + '</tbody></table>' + (l.length > 400 ? '<p class="hint">Se muestran las 400 más recientes; el CSV trae todas.</p>' : '');
  }
  ['auD1', 'auD2', 'auAcc', 'auPanel'].forEach((id) => $(id).addEventListener('change', render));
  $('auBuscar').addEventListener('input', render);
  $('auCsv').addEventListener('click', () => {
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = filtrados().map((e) => [e.en, e.usuario, e.panel, e.accion, e.registro, val(e.antes), val(e.despues)]);
    S.descargar('auditoria_smash_' + S.today() + '.csv', '﻿' + [['fecha', 'usuario', 'panel', 'accion', 'registro', 'antes', 'despues'], ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  });

  /* ---------------- Clave de caja (Configuración) ---------------- */
  function renderClave() {
    $('ccEstado').innerHTML = A.tieneClaveCaja() ? '✓ La caja usa una clave definida por los dueños.'
      : '<span class="neg">⚠ La caja todavía usa la clave inicial, que está escrita en el código. Cámbiala aquí.</span>';
  }
  $('ccForm').addEventListener('submit', (e) => {
    e.preventDefault();
    try { A.cambiarClaveCaja($('ccNueva').value, $('ccNueva2').value); } catch (x) { $('ccMsg').className = 'error'; $('ccMsg').textContent = x.message; return; }
    e.target.reset(); $('ccMsg').className = 'ok-msg'; $('ccMsg').textContent = '✓ Clave de caja cambiada. Compártela solo con el personal de caja.'; renderClave();
  });

  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { render(); renderClave(); }));
  render(); renderClave();
})();
