/* ============================================================
   SMASH · inventario-ui.js (solo panel de dueños)
   Pantallas de Inventario, Recetas y Respaldo de datos.
   Se carga después de dueno.js y no cambia su funcionamiento.
   ============================================================ */
(function () {
  if (!document.getElementById('section-inventario')) return;
  const $ = (id) => document.getElementById(id);
  const esc = SmashUI.esc, fmt = SmashUI.fmt;
  const I = SmashInv, S = SmashStore, POR = 'dueño';
  const shown = (id) => !$('dashboardSection').hidden && !$(id).hidden;
  const nq = (n) => Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 3 });
  const q = (base, u) => nq(I.deBase(base, u)) + ' ' + u;
  // Dinero con decimales solo cuando el valor es pequeño (ej. costo por gramo)
  const money = (n) => (Math.abs(n) < 100 && Math.round(n) !== n ? '$' + Number(n).toLocaleString('es-CO', { maximumFractionDigits: 2 }) : fmt(n));
  const costoU = (i) => money(i.costo * I.UNIDADES[i.unidad].f) + ' / ' + i.unidad;
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  const opts = (list, cur) => list.map((x) => `<option value="${esc(x[0])}"${x[0] === cur ? ' selected' : ''}>${esc(x[1])}</option>`).join('');
  const unitOpts = (units, cur) => opts(units.map((u) => [u, I.UNIDADES[u].n + ' (' + u + ')']), cur);
  function flash(el, ok, text) {
    el.className = (ok ? 'ok-msg' : 'error') + (el.classList.contains('wide') ? ' wide' : '');
    el.textContent = text;
  }
  const tryDo = (el, fn) => { try { return fn(); } catch (e) { flash(el, false, '⚠ ' + e.message); return null; } };

  /* ================= INVENTARIO ================= */
  let tab = 'ings';
  $('invTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]'); if (!b) return;
    tab = b.dataset.t;
    $('invTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    document.querySelectorAll('.inv-pane').forEach((p) => { p.hidden = p.id !== 'inv-' + tab; });
    renderInv();
  });

  function renderInv() {
    if (!shown('section-inventario')) return;
    try { I.sincronizarPedidos(POR); } catch (e) { /* se reintenta en la próxima apertura */ }
    const ings = I.getIngredientes(), act = ings.filter((i) => i.activo !== false);
    const bajos = act.filter((i) => I.estado(i).k === 'bajo').length, agot = act.filter((i) => I.estado(i).k === 'agotado').length;
    $('invResumen').innerHTML = `
      <div class="summary-box"><div class="label">Ingredientes activos</div><div class="value">${act.length}</div></div>
      <div class="summary-box"><div class="label">Valor del inventario</div><div class="value">${fmt(act.reduce((s, i) => s + I.valor(i), 0))}</div></div>
      <div class="summary-box"><div class="label">Bajo mínimo</div><div class="value${bajos ? ' neg' : ''}">${bajos}</div></div>
      <div class="summary-box"><div class="label">Agotados</div><div class="value${agot ? ' neg' : ''}">${agot}</div></div>`;
    const cats = [...new Set(ings.map((i) => i.categoria).filter(Boolean))];
    $('ingCats').innerHTML = cats.map((c) => `<option value="${esc(c)}">`).join('');
    const provs = [...new Set(ings.map((i) => i.proveedor).concat(I.getMovimientos().map((m) => m.proveedor)).filter(Boolean))];
    $('provList').innerHTML = provs.map((p) => `<option value="${esc(p)}">`).join('');
    ({ ings: renderIngs, compra: renderCompra, salida: renderSalida, conteo: renderConteo, movs: renderMovs })[tab]();
  }

  /* ---- Materias primas ---- */
  function renderIngs() {
    if (!$('ingUnidad').options.length) { $('ingUnidad').innerHTML = unitOpts(Object.keys(I.UNIDADES), 'g'); $('ingUnidad').dataset.prev = 'g'; unitLabels(); }
    const t = $('ingBuscar').value.trim().toLowerCase(), f = $('ingFiltro').value;
    const list = I.getIngredientes().filter((i) => {
      const k = I.estado(i).k;
      if (f === 'bajo' ? k !== 'bajo' && k !== 'agotado' : f === 'inactivo' ? k !== 'inactivo' : false) return false;
      return !t || i.nombre.toLowerCase().includes(t) || (i.categoria || '').toLowerCase().includes(t);
    }).sort((a, b) => (a.activo === false) - (b.activo === false) || a.nombre.localeCompare(b.nombre));
    $('ingLista').innerHTML = list.map((i) => {
      const e = I.estado(i), uso = I.enUso(i.id);
      return `<div class="ing-card ${e.k}">
        <h4><span>${esc(i.nombre)}</span><span class="badge ${e.k}">${e.n}</span></h4>
        <div class="ing-stock${i.stock < 0 ? ' neg' : ''}">${q(i.stock, i.unidad)}</div>
        <div class="kv"><span>Categoría</span><span>${esc(i.categoria || '-')}</span></div>
        <div class="kv"><span>Mínimo</span><span>${i.minimo ? q(i.minimo, i.unidad) : '-'}</span></div>
        <div class="kv"><span>Costo</span><span>${costoU(i)}</span></div>
        <div class="kv"><span>Valor en inventario</span><span>${fmt(I.valor(i))}</span></div>
        <div class="kv"><span>Proveedor</span><span>${esc(i.proveedor || '-')}</span></div>
        <div class="kv"><span>Actualizado</span><span>${esc(fecha(i.actualizado))}</span></div>
        ${i.stock < 0 ? '<p class="hint neg" style="margin:0">Existencia negativa: registra la compra que falta o haz un conteo físico.</p>' : ''}
        <div class="mod-actions">
          <button type="button" data-ing="edit" data-id="${esc(i.id)}">✏️ Editar</button>
          <button type="button" data-ing="toggle" data-id="${esc(i.id)}">${i.activo === false ? 'Activar' : 'Desactivar'}</button>
          ${uso ? '' : `<button type="button" data-ing="del" data-id="${esc(i.id)}">🗑️</button>`}
        </div></div>`;
    }).join('') || `<p class="hint">${I.getIngredientes().length ? 'Ningún ingrediente coincide con el filtro.' : 'Todavía no hay materias primas. Registra la primera con “+ Nuevo ingrediente”.'}</p>`;
  }
  $('ingBuscar').addEventListener('input', renderIngs);
  $('ingFiltro').addEventListener('change', renderIngs);

  function unitLabels() {
    const u = $('ingUnidad').value;
    document.querySelectorAll('#ingForm .u-lbl').forEach((el) => { el.textContent = u; });
  }
  // Al cambiar a una unidad compatible se convierten los valores escritos (ej. $32.000/kg → $32/g)
  $('ingUnidad').addEventListener('change', () => {
    const prev = $('ingUnidad').dataset.prev, u = $('ingUnidad').value;
    if (prev && I.compatibles(prev, u)) {
      const r = I.UNIDADES[u].f / I.UNIDADES[prev].f;
      if ($('ingCosto').value !== '') $('ingCosto').value = +(parseFloat($('ingCosto').value) * r).toFixed(4);
      if ($('ingMin').value !== '') $('ingMin').value = +(parseFloat($('ingMin').value) / r).toFixed(4);
      if ($('ingIni').value !== '') $('ingIni').value = +(parseFloat($('ingIni').value) / r).toFixed(4);
    }
    $('ingUnidad').dataset.prev = u;
    unitLabels();
  });

  function resetIngForm() {
    $('ingForm').reset();
    $('ingId').value = '';
    $('ingTitulo').textContent = '+ Nuevo ingrediente';
    $('ingUnidad').innerHTML = unitOpts(Object.keys(I.UNIDADES), 'g');
    $('ingUnidad').dataset.prev = 'g';
    $('ingIniWrap').hidden = false; $('ingActWrap').hidden = true; $('ingAyuda').hidden = false;
    $('ingMsg').textContent = '';
    unitLabels();
  }
  $('ingCancelar').addEventListener('click', () => { resetIngForm(); $('ingBox').open = false; });

  $('ingLista').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ing]'); if (!b) return;
    const i = I.getIngrediente(b.dataset.id); if (!i) return;
    if (b.dataset.ing === 'edit') {
      resetIngForm();
      $('ingId').value = i.id;
      $('ingTitulo').textContent = 'Editar: ' + i.nombre;
      $('ingNombre').value = i.nombre; $('ingCat').value = i.categoria || ''; $('ingProv').value = i.proveedor || '';
      $('ingUnidad').innerHTML = unitOpts(I.unidadesDe(i.unidad), i.unidad);
      $('ingUnidad').dataset.prev = i.unidad;
      $('ingCosto').value = +(i.costo * I.UNIDADES[i.unidad].f).toFixed(4);
      $('ingMin').value = i.minimo ? +I.deBase(i.minimo, i.unidad).toFixed(4) : '';
      $('ingActivo').checked = i.activo !== false;
      $('ingIniWrap').hidden = true; $('ingActWrap').hidden = false; $('ingAyuda').hidden = true;
      unitLabels();
      $('ingBox').open = true;
      $('ingBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
      $('ingNombre').focus();
    } else if (b.dataset.ing === 'toggle') {
      tryDo($('ingMsg'), () => { I.setActivo(i.id, i.activo === false); renderInv(); });
    } else if (b.dataset.ing === 'del') {
      if (!confirm('¿Eliminar "' + i.nombre + '"? Solo es posible porque no tiene movimientos.')) return;
      tryDo($('ingMsg'), () => { I.eliminarIngrediente(i.id); renderInv(); });
    }
  });

  $('ingForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const editando = !!$('ingId').value;
    const res = tryDo($('ingMsg'), () => I.guardarIngrediente({
      id: $('ingId').value || null, nombre: $('ingNombre').value, categoria: $('ingCat').value, unidad: $('ingUnidad').value,
      costo: $('ingCosto').value, minimo: $('ingMin').value, proveedor: $('ingProv').value, inicial: $('ingIni').value,
      activo: $('ingActivo').checked,
    }, POR));
    if (!res) return;
    resetIngForm();
    if (editando) $('ingBox').open = false;
    flash($('ingMsg'), true, '✓ ' + res.nombre + (editando ? ' actualizado.' : ' registrado.'));
    renderInv();
  });

  /* ---- Selector de ingrediente + unidades compatibles ---- */
  function fillIngSelect(sel, unitSel) {
    const cur = sel.value, act = I.getIngredientes().filter((i) => i.activo !== false).sort((a, b) => a.nombre.localeCompare(b.nombre));
    sel.innerHTML = '<option value="">— Elige —</option>' + opts(act.map((i) => [i.id, i.nombre + ' (' + q(i.stock, i.unidad) + ')']), cur);
    fillUnits(sel, unitSel);
  }
  function fillUnits(sel, unitSel) {
    const i = I.getIngrediente(sel.value), cur = unitSel.value;
    if (!i) { unitSel.innerHTML = ''; return; }
    const us = I.unidadesDe(i.unidad);
    unitSel.innerHTML = unitOpts(us, us.indexOf(cur) > -1 ? cur : i.unidad);
  }

  /* ---- Compras ---- */
  function renderCompra() {
    fillIngSelect($('compIng'), $('compUnidad'));
    if (!$('compFecha').value) $('compFecha').value = S.today();
    compCalc();
    const movs = I.getMovimientos().filter((m) => m.tipo === 'compra').slice().reverse().slice(0, 100);
    $('compHist').innerHTML = `<table class="rtable"><thead><tr><th>Fecha</th><th>Ingrediente</th><th class="num">Cantidad</th><th class="num">Precio total</th><th class="num">Precio por unidad</th><th>Proveedor</th><th>Observaciones</th></tr></thead><tbody>` +
      (movs.map((m) => {
        const u = m.unidadOrig || 'und', cant = m.cantOrig != null ? m.cantOrig : m.cant;
        return `<tr><td class="first">${esc(m.fecha)}</td><td data-l="Ingrediente">${esc(m.ingNombre)}</td><td class="num" data-l="Cantidad">${nq(cant)} ${esc(u)}</td>
          <td class="num" data-l="Precio total">${fmt(m.precioTotal)}</td><td class="num" data-l="Por unidad">${cant ? money(m.precioTotal / cant) + ' / ' + esc(u) : '-'}</td>
          <td data-l="Proveedor">${esc(m.proveedor || '-')}</td><td data-l="Obs.">${esc(m.motivo || '-')}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">Sin compras registradas.</td></tr>') + '</tbody></table>';
  }
  function compCalc() {
    const i = I.getIngrediente($('compIng').value), c = parseFloat($('compCant').value), t = parseFloat($('compTotal').value), u = $('compUnidad').value;
    if (!i) { $('compCalc').textContent = ''; return; }
    const actual = 'Costo actual: ' + costoU(i) + '.';
    $('compCalc').textContent = c > 0 && t >= 0 ? `Precio por ${u}: ${money(t / c)}. ${actual} Al registrar, el costo del ingrediente pasa a ${money((t / I.aBase(c, u)) * I.UNIDADES[i.unidad].f)} / ${i.unidad}.` : actual;
  }
  $('compIng').addEventListener('change', () => {
    fillUnits($('compIng'), $('compUnidad'));
    const i = I.getIngrediente($('compIng').value);
    if (i && !$('compProv').value) $('compProv').value = i.proveedor || '';
    compCalc();
  });
  ['compCant', 'compTotal', 'compUnidad'].forEach((id) => $(id).addEventListener('input', compCalc));
  $('compForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = tryDo($('compMsg'), () => I.registrarCompra({
      ingId: $('compIng').value, cantidad: $('compCant').value, unidad: $('compUnidad').value, precioTotal: $('compTotal').value,
      fecha: $('compFecha').value, proveedor: $('compProv').value, obs: $('compObs').value,
    }, POR));
    if (!m) return;
    ['compCant', 'compTotal', 'compObs', 'compProv'].forEach((id) => { $(id).value = ''; });
    const afect = typeof SmashCostos !== 'undefined' ? SmashCostos.productosConIngrediente(m.ingId).map((p) => p.name) : [];
    flash($('compMsg'), true, '✓ Compra registrada: ' + nq(m.cantOrig) + ' ' + m.unidadOrig + ' de ' + m.ingNombre + ' por ' + fmt(m.precioTotal) + '.' +
      (afect.length ? ' Costo recalculado en: ' + afect.join(', ') + ' (los precios de venta no cambian).' : ''));
    renderInv();
  });

  /* ---- Salidas manuales ---- */
  function renderSalida() {
    fillIngSelect($('salIng'), $('salUnidad'));
    if (!$('salTipo').options.length) $('salTipo').innerHTML = opts(I.SALIDAS.map((k) => [k, I.TIPOS[k].n]));
    if (!$('salFecha').value) $('salFecha').value = S.today();
    salInfo();
  }
  function salInfo() {
    const i = I.getIngrediente($('salIng').value);
    $('salInfo').textContent = i ? 'Disponible: ' + q(i.stock, i.unidad) + ' · costo ' + costoU(i) : '';
  }
  $('salIng').addEventListener('change', () => { fillUnits($('salIng'), $('salUnidad')); salInfo(); });
  $('salForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const m = tryDo($('salMsg'), () => I.registrarSalida({
      ingId: $('salIng').value, tipo: $('salTipo').value, cantidad: $('salCant').value, unidad: $('salUnidad').value,
      fecha: $('salFecha').value, motivo: $('salMotivo').value,
    }, POR));
    if (!m) return;
    $('salCant').value = ''; $('salMotivo').value = '';
    flash($('salMsg'), true, '✓ ' + I.TIPOS[m.tipo].n + ' registrado: ' + nq(m.cantOrig) + ' ' + m.unidadOrig + ' de ' + m.ingNombre + ' (' + fmt(m.valor) + ').');
    renderInv();
  });

  /* ---- Conteo físico ---- */
  function renderConteo() {
    const act = I.getIngredientes().filter((i) => i.activo !== false).sort((a, b) => (a.categoria || '').localeCompare(b.categoria || '') || a.nombre.localeCompare(b.nombre));
    $('conteoLista').innerHTML = act.length ? `<table class="rtable"><thead><tr><th>Ingrediente</th><th class="num">En sistema</th><th>Encontrado</th><th class="num">Diferencia</th><th class="num">Valor diferencia</th></tr></thead><tbody>` +
      act.map((i) => `<tr data-cid="${esc(i.id)}"><td class="first">${esc(i.nombre)}</td><td class="num" data-l="En sistema">${q(i.stock, i.unidad)}</td>
        <td data-l="Encontrado (${esc(i.unidad)})"><input type="number" min="0" step="any" inputmode="decimal" class="cnt-in" placeholder="${esc(i.unidad)}"></td>
        <td class="num cnt-dif" data-l="Diferencia">-</td><td class="num cnt-val" data-l="Valor">-</td></tr>`).join('') + '</tbody></table>'
      : '<p class="hint">No hay materias primas activas para contar.</p>';
    conteoTotales();
    const hist = I.getConteos().slice().reverse().slice(0, 30);
    $('conteoHist').innerHTML = hist.map((c) => `<details class="mod-box"><summary>${esc(c.fecha)} · ${c.lineas.length} ingredientes · diferencia <span class="${c.valorDif < 0 ? 'neg' : 'pos'}">&nbsp;${fmt(c.valorDif)}</span></summary>
      <p class="hint">${esc(fecha(c.creado))} · por ${esc(c.por || '-')}${c.nota ? ' · ' + esc(c.nota) : ''}</p>
      <table class="rtable"><thead><tr><th>Ingrediente</th><th class="num">Sistema</th><th class="num">Físico</th><th class="num">Diferencia</th><th class="num">Valor</th></tr></thead><tbody>
      ${c.lineas.map((l) => `<tr><td class="first">${esc(l.ingNombre)}</td><td class="num" data-l="Sistema">${q(l.sistema, l.unidad)}</td><td class="num" data-l="Físico">${q(l.fisico, l.unidad)}</td>
        <td class="num ${l.dif < 0 ? 'neg' : ''}" data-l="Diferencia">${q(l.dif, l.unidad)}</td><td class="num ${l.valorDif < 0 ? 'neg' : ''}" data-l="Valor">${fmt(l.valorDif)}</td></tr>`).join('')}
      </tbody></table></details>`).join('') || '<p class="hint">Todavía no hay conteos guardados.</p>';
  }
  function conteoTotales() {
    let n = 0, val = 0;
    document.querySelectorAll('#conteoLista tr[data-cid]').forEach((tr) => {
      const i = I.getIngrediente(tr.dataset.cid), v = tr.querySelector('.cnt-in').value;
      if (!i || v === '') { tr.querySelector('.cnt-dif').textContent = '-'; tr.querySelector('.cnt-val').textContent = '-'; return; }
      const dif = I.aBase(v, i.unidad) - i.stock, vd = Math.round(dif * (i.costo || 0));
      n++; val += vd;
      tr.querySelector('.cnt-dif').innerHTML = `<span class="${dif < 0 ? 'neg' : dif > 0 ? 'pos' : ''}">${q(dif, i.unidad)}</span>`;
      tr.querySelector('.cnt-val').innerHTML = `<span class="${vd < 0 ? 'neg' : vd > 0 ? 'pos' : ''}">${fmt(vd)}</span>`;
    });
    $('conteoTot').innerHTML = `<div class="summary-box"><div class="label">Ingredientes contados</div><div class="value">${n}</div></div>
      <div class="summary-box"><div class="label">Valor de la diferencia</div><div class="value ${val < 0 ? 'neg' : ''}">${fmt(val)}</div></div>`;
  }
  $('conteoLista').addEventListener('input', (e) => { if (e.target.classList.contains('cnt-in')) conteoTotales(); });
  $('conteoGuardar').addEventListener('click', () => {
    const lineas = Array.from(document.querySelectorAll('#conteoLista tr[data-cid]')).map((tr) => ({ ingId: tr.dataset.cid, fisico: tr.querySelector('.cnt-in').value }));
    const n = lineas.filter((l) => l.fisico !== '').length;
    if (n && !confirm('¿Guardar el conteo de ' + n + ' ingredientes? Las existencias del sistema quedarán iguales a lo contado.')) return;
    const c = tryDo($('conteoMsg'), () => I.guardarConteo(lineas, POR, $('conteoNota').value));
    if (!c) return;
    $('conteoNota').value = '';
    flash($('conteoMsg'), true, '✓ Conteo guardado. Diferencia total: ' + fmt(c.valorDif) + '.');
    renderInv();
  });

  /* ---- Movimientos ---- */
  function movFiltrados() {
    const fi = $('movIng').value, ft = $('movTipo').value;
    return I.getMovimientos().filter((m) => m.ingId && (!fi || m.ingId === fi) && (!ft || m.tipo === ft)).reverse();
  }
  function renderMovs() {
    const fi = $('movIng').value, ft = $('movTipo').value;
    $('movIng').innerHTML = '<option value="">Todos los ingredientes</option>' + opts(I.getIngredientes().map((i) => [i.id, i.nombre]).sort((a, b) => a[1].localeCompare(b[1])), fi);
    $('movTipo').innerHTML = '<option value="">Todos los movimientos</option>' + opts(Object.keys(I.TIPOS).map((k) => [k, I.TIPOS[k].n]), ft);
    const list = movFiltrados().slice(0, 300);
    $('movLista').innerHTML = `<table class="rtable"><thead><tr><th>Fecha</th><th>Ingrediente</th><th>Movimiento</th><th class="num">Cantidad</th><th class="num">Valor</th><th>Motivo</th><th>Por</th></tr></thead><tbody>` +
      (list.map((m) => {
        const i = I.getIngrediente(m.ingId), u = i ? i.unidad : 'und';
        return `<tr><td class="first">${esc(m.fecha)} <small class="hint">${esc(new Date(m.creado).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }))}</small></td>
          <td data-l="Ingrediente">${esc(m.ingNombre)}</td><td data-l="Movimiento">${esc((I.TIPOS[m.tipo] || { n: m.tipo }).n)}</td>
          <td class="num ${m.cant < 0 ? 'neg' : 'pos'}" data-l="Cantidad">${m.cant > 0 ? '+' : ''}${q(m.cant, u)}</td><td class="num" data-l="Valor">${fmt(m.valor)}</td>
          <td data-l="Motivo">${esc(m.motivo || '-')}</td><td data-l="Por">${esc(m.por || '-')}</td></tr>`;
      }).join('') || '<tr><td colspan="7" class="empty">Sin movimientos.</td></tr>') + '</tbody></table>' +
      (movFiltrados().length > 300 ? '<p class="hint">Se muestran los 300 más recientes. Exporta el CSV para ver todos.</p>' : '');
  }
  $('movIng').addEventListener('change', renderMovs);
  $('movTipo').addEventListener('change', renderMovs);
  $('movExport').addEventListener('click', () => {
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const rows = movFiltrados().map((m) => {
      const i = I.getIngrediente(m.ingId), u = i ? i.unidad : 'und';
      return [m.fecha, m.creado, m.ingNombre, (I.TIPOS[m.tipo] || { n: m.tipo }).n, I.deBase(m.cant, u), u, m.valor, m.precioTotal || '', m.proveedor || '', m.motivo || '', m.pedidoNum || '', m.por || ''];
    });
    const head = ['fecha', 'registrado', 'ingrediente', 'movimiento', 'cantidad', 'unidad', 'valor', 'precio_total', 'proveedor', 'motivo', 'pedido', 'por'];
    S.descargar('movimientos_inventario_' + S.today() + '.csv', '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\n'), 'text/csv;charset=utf-8');
  });

  /* ================= RECETAS ================= */
  let draft = null; // { prodId, lineas, dirty }
  const CAT = { hamburguesa: 'Hamburguesa', combo: 'Combo', adicional: 'Adicional' };
  function renderRecetas() {
    if (!shown('section-recetas')) return;
    const prods = SmashDB.getProducts();
    const sel = $('recProd');
    if (!draft || !prods.some((p) => p.id === draft.prodId)) draft = prods.length ? { prodId: prods[0].id, lineas: I.getReceta(prods[0].id), dirty: false } : null;
    sel.innerHTML = opts(prods.map((p) => [p.id, p.name + ' · ' + (CAT[p.categoria] || p.categoria)]), draft && draft.prodId);
    renderRecEditor();
    const rec = I.getRecetas();
    $('recEstado').innerHTML = `<table class="rtable"><thead><tr><th>Producto</th><th>Categoría</th><th class="num">Ingredientes</th><th>Estado</th></tr></thead><tbody>` +
      (prods.map((p) => {
        const n = (rec[p.id] || []).length;
        return `<tr><td class="first">${esc(p.name)}${p.activo === false ? ' <small class="hint">(oculto)</small>' : ''}</td><td data-l="Categoría">${esc(CAT[p.categoria] || p.categoria)}</td>
          <td class="num" data-l="Ingredientes">${n}</td><td data-l="Estado"><span class="badge ${n ? '' : 'bajo'}">${n ? 'Con receta' : 'Sin receta'}</span></td></tr>`;
      }).join('') || '<tr><td colspan="4" class="empty">No hay productos.</td></tr>') + '</tbody></table>';
  }
  function renderRecEditor() {
    const box = $('recEditor');
    if (!draft) { box.innerHTML = '<p class="hint">No hay productos registrados.</p>'; return; }
    const ings = I.getIngredientes();
    if (!ings.length) { box.innerHTML = '<p class="hint">Primero registra las materias primas en <b>Inventario</b>. Luego vuelve aquí para armar la receta.</p>'; return; }
    const p = SmashDB.getProductById(draft.prodId);
    const disponibles = ings.filter((i) => i.activo !== false && !draft.lineas.some((l) => l.ingId === i.id)).sort((a, b) => a.nombre.localeCompare(b.nombre));
    box.innerHTML = `<h3 style="margin:0 0 4px">${esc(p.name)}</h3>
      <p class="hint">Cantidad usada para producir <b>una</b> unidad de este producto.</p>
      <table class="rtable"><thead><tr><th>Ingrediente</th><th>Cantidad</th><th>Unidad</th><th class="num">Costo unitario</th><th class="num">Costo</th><th></th></tr></thead><tbody>
      ${draft.lineas.map((l, k) => {
        const i = I.getIngrediente(l.ingId);
        return `<tr data-rrow="${k}"><td class="first">${esc(i ? i.nombre : '(ingrediente borrado)')}${i && i.activo === false ? ' <small class="hint">(inactivo)</small>' : ''}</td>
          <td data-l="Cantidad"><input type="number" min="0" step="any" inputmode="decimal" data-rk="${k}" data-rf="cant" value="${esc(l.cant)}"></td>
          <td data-l="Unidad"><select data-rk="${k}" data-rf="unidad">${i ? unitOpts(I.unidadesDe(i.unidad), l.unidad) : ''}</select></td>
          <td class="num" data-l="Costo unitario">${i ? costoU(i) : '-'}</td>
          <td class="num rc-sub" data-l="Costo">-</td>
          <td><button type="button" class="btn-x" data-rdel="${k}" aria-label="Quitar ingrediente">✕</button></td></tr>`;
      }).join('') || '<tr><td colspan="6" class="empty">Sin ingredientes en la receta.</td></tr>'}
      </tbody></table>
      <div class="summary-grid rec-tot" id="recTot"></div>
      <p class="hint" id="recAviso"></p>
      <div class="rec-add">${disponibles.length ? `<select id="recAddSel">${opts(disponibles.map((i) => [i.id, i.nombre + ' (' + i.unidad + ')']))}</select>
        <button type="button" class="btn-secondary" id="recAdd">+ Agregar ingrediente</button>` : '<p class="hint" style="margin:0">Todos los ingredientes activos ya están en la receta.</p>'}</div>
      <div class="mod-actions"><button type="button" class="btn-primary" id="recGuardar">Guardar receta</button>
        <button type="button" class="btn-secondary rec-dirty" id="recDescartar"${draft.dirty ? '' : ' hidden'}>Descartar cambios</button>
        <span class="hint rec-dirty" style="margin:0"${draft.dirty ? '' : ' hidden'}>Cambios sin guardar</span></div>
      <p class="error" id="recMsg"></p>`;
    recCostos();
  }
  // Costo de la receta en edición (aún sin guardar): cantidad × costo unitario de cada ingrediente
  function recCostos() {
    if (!draft || typeof SmashCostos === 'undefined' || !$('recTot')) return;
    let total = 0, faltan = [];
    draft.lineas.forEach((l, k) => {
      const d = SmashCostos.lineaCosto(l), cell = $('recEditor').querySelector(`tr[data-rrow="${k}"] .rc-sub`);
      total += d.costo;
      if (d.i && !d.ok) faltan.push(d.i.nombre);
      if (cell) cell.textContent = d.i && Number(l.cant) > 0 ? money(d.costo) : '-';
    });
    const p = SmashDB.getProductById(draft.prodId), precio = p ? Number(p.price) || 0 : 0, g = precio - total;
    $('recTot').innerHTML = `
      <div class="summary-box"><div class="label">Costo de producción</div><div class="value">${fmt(total)}</div></div>
      <div class="summary-box"><div class="label">Precio de venta actual</div><div class="value">${fmt(precio)}</div></div>
      <div class="summary-box"><div class="label">Ganancia bruta</div><div class="value ${g < 0 ? 'neg' : ''}">${fmt(g)}</div></div>
      <div class="summary-box"><div class="label">Margen bruto</div><div class="value ${g < 0 ? 'neg' : ''}">${precio > 0 && draft.lineas.length ? (g / precio * 100).toFixed(1) + '%' : '-'}</div></div>`;
    $('recAviso').textContent = (faltan.length ? '⚠ Sin costo registrado: ' + faltan.join(', ') + '. Registra una compra o edita su costo. ' : '') +
      'El precio de venta no cambia solo: se modifica en Productos.';
  }
  $('recProd').addEventListener('change', () => {
    if (draft && draft.dirty && !confirm('Hay cambios sin guardar en la receta actual. ¿Descartarlos?')) { $('recProd').value = draft.prodId; return; }
    draft = { prodId: $('recProd').value, lineas: I.getReceta($('recProd').value), dirty: false };
    renderRecEditor();
  });
  $('recEditor').addEventListener('input', (e) => {
    const t = e.target; if (!t.dataset.rk) return;
    draft.lineas[+t.dataset.rk][t.dataset.rf] = t.value;
    draft.dirty = true;
    $('recEditor').querySelectorAll('.rec-dirty').forEach((x) => { x.hidden = false; });
    recCostos();
  });
  $('recEditor').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.rdel != null) { draft.lineas.splice(+b.dataset.rdel, 1); draft.dirty = true; renderRecEditor(); }
    else if (b.id === 'recAdd') {
      const i = I.getIngrediente($('recAddSel').value); if (!i) return;
      draft.lineas.push({ ingId: i.id, cant: '', unidad: i.unidad }); draft.dirty = true; renderRecEditor();
      const ins = $('recEditor').querySelectorAll('input[data-rf="cant"]'); if (ins.length) ins[ins.length - 1].focus();
    } else if (b.id === 'recDescartar') { draft = { prodId: draft.prodId, lineas: I.getReceta(draft.prodId), dirty: false }; renderRecEditor(); }
    else if (b.id === 'recGuardar') {
      const ok = tryDo($('recMsg'), () => I.setReceta(draft.prodId, draft.lineas, POR));
      if (!ok) return;
      draft = { prodId: draft.prodId, lineas: I.getReceta(draft.prodId), dirty: false };
      renderRecetas();
      flash($('recMsg'), true, '✓ Receta guardada' + (ok.length ? ' (' + ok.length + ' ingredientes).' : ': quedó sin ingredientes.'));
    }
  });

  /* ================= RESPALDO (Configuración) ================= */
  function renderBackup() {
    if (!shown('section-config')) return;
    const last = S.lastBackup(), u = S.usage(), dias = last ? (Date.now() - new Date(last).getTime()) / 86400000 : null;
    const pct = Math.round((u.bytes / u.limite) * 100), mb = (b) => (b / 1048576).toFixed(b < 10485760 ? 2 : 0);
    $('bkResumen').innerHTML = `
      <div class="summary-box"><div class="label">Último respaldo</div><div class="value ${dias == null || dias > 1 ? 'neg' : ''}" style="font-size:.95rem">${last ? esc(fecha(last)) : 'Nunca'}</div></div>
      <div class="summary-box"><div class="label">Espacio usado</div><div class="value ${pct >= 80 ? 'neg' : ''}">${pct}%</div><div class="sub">${(u.bytes / 1048576).toFixed(2)} MB de ${mb(u.limite)} MB${u.tipo === 'localStorage' ? ' (este navegador no permite más)' : ''}</div></div>
      <div class="summary-box"><div class="label">Pedidos guardados</div><div class="value">${SmashDB.getOrders().length}</div></div>
      <div class="summary-box"><div class="label">Movimientos de inventario</div><div class="value">${I.getMovimientos().length}</div></div>`;
  }
  $('bkDescargar').addEventListener('click', () => {
    try { S.downloadBackup(); flash($('bkMsg'), true, '✓ Respaldo descargado. Guárdalo fuera de este computador.'); } catch (e) { flash($('bkMsg'), false, '⚠ ' + e.message); }
    renderBackup();
  });
  $('bkArchivo').addEventListener('change', (e) => {
    const f = e.target.files[0]; e.target.value = '';
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => {
      let obj;
      try { obj = JSON.parse(rd.result); } catch (x) { flash($('bkMsg'), false, '⚠ El archivo no es un respaldo válido.'); return; }
      const cuando = obj && obj.creado ? fecha(obj.creado) : 'fecha desconocida';
      if (!confirm('Vas a restaurar el respaldo del ' + cuando + '.\n\nEsto REEMPLAZA todos los datos actuales de este navegador (pedidos, productos, inventario, contraseña de dueños...).\n\nAntes se descargará automáticamente un respaldo del estado actual. ¿Continuar?')) return;
      try {
        S.downloadBackup('antes_de_restaurar_');
        const n = S.importAll(obj);
        alert('✓ Respaldo restaurado (' + n + ' grupos de datos). La página se recargará.');
        location.reload();
      } catch (x) { flash($('bkMsg'), false, '⚠ ' + x.message + ' No se cambió nada.'); }
    };
    rd.readAsText(f);
  });

  /* ================= Enganche con el panel ================= */
  const renderVisible = () => { renderInv(); renderRecetas(); renderBackup(); };
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', renderVisible));
  window.addEventListener('storage', (e) => {
    if (!e.key || e.key.indexOf('smash_') !== 0) return;
    const a = document.activeElement;
    if (a && a.closest && a.closest('#section-inventario, #section-recetas') && /INPUT|SELECT|TEXTAREA/.test(a.tagName)) return;
    renderVisible();
  });
  renderVisible();
})();
