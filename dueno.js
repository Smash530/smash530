(function () {
  const $ = (id) => document.getElementById(id);
  const fmt = (n) => '$' + Math.round(n).toLocaleString('es-CO');
  const todayISO = () => {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  };

  // Día local (Colombia). data.js compara en UTC y deja fuera los pedidos de 7 a 10 pm.
  const localDay = (iso) => { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  // Pedidos válidos del día (los cancelados no cuentan como venta)
  const ordersOn = (day) => SmashDB.getOrders().filter((o) => localDay(o.creado) === day && SmashComandas.valido(o));
  // Venta neta de productos: subtotal menos descuentos (canjes de puntos)
  const neto = (o) => (o.subtotal || 0) - (o.descuento || 0);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (o) => o.numeroDia || o.id;

  /* ============== ACCESO DE DUEÑOS ============== */
  $('staffLoginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('staffError'), btn = e.target.querySelector('button[type=submit]');
    err.textContent = '';
    const correo = $('staffUsuario').value, clave = $('staffPassword').value;
    const res = SmashExt.loginOwner(correo, clave);
    $('staffPassword').value = '';
    const Sy = typeof SmashSync !== 'undefined' ? SmashSync : null;
    if (res.ok) {
      if (Sy) Sy.entrarConNube('dueno', correo, clave);   // conecta la nube solo, sin esperar
      enterDashboard(res.email);
      return;
    }
    // Equipo nuevo o clave cambiada en otro equipo: se revisa en la nube
    if (!Sy || typeof SmashNube === 'undefined' || !SmashNube.ok) { err.textContent = res.error; return; }
    btn.disabled = true; err.textContent = 'Revisando en la nube…';
    const r = await Sy.entrarConNube('dueno', correo, clave);
    let res2 = res;
    if (r.ok) res2 = SmashExt.loginOwner(correo, clave);   // la nube ya trajo las claves
    btn.disabled = false;
    if (res2.ok) { err.textContent = ''; enterDashboard(res2.email); return; }
    err.textContent = r.ok ? res.error : r.error;
  });
  $('staffLogoutBtn').addEventListener('click', () => { SmashExt.logoutOwner(); location.reload(); });

  function enterDashboard(email) {
    $('staffAuthSection').hidden = true;
    $('dashboardSection').hidden = false;
    $('staffBox').hidden = false;
    $('staffName').textContent = '🔑 ' + email;
    $('contFecha').value = todayISO();
    $('ventasFecha').value = todayISO();
    renderAll();
  }
  function renderAll() {
    renderPedidos(); renderVentas($('ventasFecha').value || null); renderContabilidad();
    renderProductos(); renderPersonal(); renderClientes(); renderConfig(); renderTop(); renderSim();
  }

  /* ============== NAVEGACIÓN (menú lateral) ============== */
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel-section').forEach((s) => (s.hidden = true));
      btn.classList.add('active');
      $('section-' + btn.dataset.section).hidden = false;
      $('side').classList.remove('open');
      renderAll();
    });
  });
  $('menuToggle').addEventListener('click', () => $('side').classList.toggle('open'));

  /* ============== PEDIDOS PENDIENTES (nuevo + preparando) ============== */
  function renderCupo() {
    const el = $('cupoBar'), c = SmashExt.cupoHoy();
    if (!c) { el.className = 'cupo-bar'; el.innerHTML = '🍔 Cupo de hoy sin definir (lo define cocina al iniciar el día).'; return; }
    const rest = c.total - c.vendidas;
    el.className = 'cupo-bar' + (rest <= 0 ? ' out' : rest <= 10 ? ' low' : '');
    el.innerHTML = rest <= 0 ? `🍔 <b>AGOTADO</b>: ${c.burgers} burgers vendidas (gastan ${c.vendidas} de ${c.total})`
      : `🍔 Hoy: <b>${c.burgers}</b> burgers vendidas (cada una gasta ${SmashExt.CUPO_POR_BURGER}) · quedan <b>${rest}</b> de ${c.total}`;
  }

  function renderPedidos() {
    renderCupo();
    SmashLista.render();   // listado horizontal + ficha lateral (pedidos-lista.js)
  }

  /* ============== CONTABILIDAD ============== */
  // Gastos guardados de un día, o null si nunca se registraron (sin valores por defecto)
  const gastosGuardados = () => SmashStore.read(SmashDB.KEYS.GASTOS_DIA, {});
  // Costo de producción de los pedidos con el costo vigente cuando se registraron
  const costoDe = (orders) => { const s = SmashCostos.getSellos(); return orders.reduce((t, o) => t + SmashCostos.costoPedido(o, s), 0); };

  function loadGastosInputs(fecha) {
    const g = gastosGuardados()[fecha];
    $('gNomina').value = g ? g.nomina : '';
    $('gPublicidad').value = g ? g.publicidad : '';
    $('gServicios').value = g ? g.servicios : '';
    $('gOtros').value = g ? g.otros : '';
    $('gEstado').textContent = g ? '' : 'Sin gastos registrados para este día.';
  }

  $('contFecha').addEventListener('change', () => {
    loadGastosInputs($('contFecha').value);
    renderContabilidad();
  });

  $('guardarGastosBtn').addEventListener('click', () => {
    const fecha = $('contFecha').value;
    SmashDB.setGastosDia(fecha, {
      nomina: parseFloat($('gNomina').value) || 0,
      publicidad: parseFloat($('gPublicidad').value) || 0,
      servicios: parseFloat($('gServicios').value) || 0,
      otros: parseFloat($('gOtros').value) || 0,
    });
    renderContabilidad();
  });

  function renderContabilidad() {
    const fecha = $('contFecha').value || todayISO();
    loadGastosInputs(fecha);
    $('contCaja').innerHTML = SmashUI.caja(fecha);
    renderNomSug(fecha);
    renderMes(fecha);
    const orders = ordersOn(fecha);

    // Mismo cálculo que "Informes" (finanzas.js): ventas netas, costo de lo vendido y todos los gastos
    // registrados (Contabilidad, Gastos, gastos de caja y mermas), sin contar nada dos veces.
    // Los domicilios son dinero del domiciliario: se registran aparte y no entran en ingresos ni utilidad.
    const R = SmashFinanzas.calcular(fecha, fecha);
    const ingresoProductos = R.netas;
    const ingresoDomicilios = orders.reduce((s, o) => s + o.domicilio, 0);
    const perdidas = R.perdidas;
    const costoVariable = R.costoVendido;
    const gastosFijos = R.gastos.operativo + R.gastos.fijo + R.gastos.nomina + R.gastos.otro;

    const ingresoTotal = ingresoProductos;
    const utilidad = R.utilidad;
    const margenPct = ingresoTotal > 0 ? (utilidad / ingresoTotal) * 100 : 0;

    $('contResumen').innerHTML = `
      <div class="summary-box"><div class="label">Ventas netas de productos</div><div class="value">${fmt(ingresoProductos)}</div></div>
      <div class="summary-box"><div class="label">Costo variable</div><div class="value">${fmt(costoVariable)}</div>${perdidas ? `<div class="sub">incluye ${fmt(perdidas)} de pérdidas por cancelación</div>` : ''}</div>
      <div class="summary-box"><div class="label">Gastos del día</div><div class="value">${fmt(gastosFijos)}</div><div class="sub">todos los registrados (ver Informes)</div></div>
      <div class="summary-box"><div class="label">Utilidad neta</div><div class="value">${fmt(utilidad)}</div></div>
      <p class="hint caja-note">Domicilios del día (pagados a domiciliarios, no son de SMASH): ${fmt(ingresoDomicilios)} en ${orders.filter((o) => o.domicilio > 0).length} pedidos.</p>
    `;

    const banner = $('contBanner');
    if (ingresoTotal === 0) {
      banner.className = 'banner';
      banner.textContent = 'Sin ventas registradas ese día.';
    } else if (margenPct >= 20) {
      banner.className = 'banner green';
      banner.textContent = `✅ Margen neto ${margenPct.toFixed(1)}% — saludable`;
    } else if (margenPct >= 10) {
      banner.className = 'banner yellow';
      banner.textContent = `⚠️ Margen neto ${margenPct.toFixed(1)}% — revisar estructura`;
    } else {
      banner.className = 'banner danger';
      banner.textContent = `🔴 Margen neto ${margenPct.toFixed(1)}% — insostenible`;
    }
  }

  // Resumen del mes: ventas de productos, costo, gastos fijos registrados y domicilios (aparte)
  function renderMes(fecha) {
    const mes = fecha.slice(0, 7);
    const orders = SmashDB.getOrders().filter((o) => localDay(o.creado).slice(0, 7) === mes && SmashComandas.valido(o));
    const [m1, m2] = SmashFinanzas.periodo('mes', fecha), R = SmashFinanzas.calcular(m1, m2);
    const ingreso = R.netas;
    const perdidas = R.perdidas;
    const costo = R.costoVendido;
    const fijos = R.gastos.operativo + R.gastos.fijo + R.gastos.nomina + R.gastos.otro;
    const conDom = orders.filter((o) => o.domicilio > 0), dom = conDom.reduce((s, o) => s + o.domicilio, 0);
    const porRep = {};
    conDom.forEach((o) => { const r = o.repartidor || 'Sin asignar'; porRep[r] = porRep[r] || { n: 0, v: 0 }; porRep[r].n++; porRep[r].v += o.domicilio; });
    $('contMes').innerHTML = `
      <div class="summary-box"><div class="label">Ventas de productos (${esc(mes)})</div><div class="value">${fmt(ingreso)}</div></div>
      <div class="summary-box"><div class="label">Costo variable</div><div class="value">${fmt(costo)}</div>${perdidas ? `<div class="sub">incluye ${fmt(perdidas)} de pérdidas por cancelación</div>` : ''}</div>
      <div class="summary-box"><div class="label">Gastos del mes</div><div class="value">${fmt(fijos)}</div><div class="sub">fijos, operativos, nómina y otros</div></div>
      <div class="summary-box"><div class="label">Utilidad neta del mes</div><div class="value">${fmt(R.utilidad)}</div></div>
      <div class="summary-box"><div class="label">Domicilios del mes (registro aparte)</div><div class="value">${fmt(dom)}</div><div class="sub">${conDom.length} domicilios · promedio ${fmt(conDom.length ? dom / conDom.length : 0)}</div></div>
      ${Object.keys(porRep).sort((a, b) => porRep[b].v - porRep[a].v).map((r) => `<div class="summary-box"><div class="label">🛵 ${esc(r)}</div><div class="value">${fmt(porRep[r].v)}</div><div class="sub">${porRep[r].n} domicilios</div></div>`).join('')}
      <p class="hint caja-note">Los domicilios se pagan a los domiciliarios: no suman a ventas, gastos ni utilidad. Sirven para saber cuánto se paga en domicilios cada mes.</p>`;
  }

  /* ============== REGISTRO DE VENTAS (con costos y utilidad) ============== */
  const STATUS_LABEL = SmashComandas.NOMBRE;
  const costoOrden = (o) => SmashCostos.costoPedido(o);
  let ventasVisibles = [];
  function renderVentas(filterDate) {
    let orders = SmashDB.getOrders();
    if (filterDate) orders = orders.filter((o) => localDay(o.creado) === filterDate);
    orders = orders.slice().reverse();
    ventasVisibles = orders;
    // Los cancelados se listan (marcados) pero no suman a ventas ni a costos
    const validos = SmashComandas.vigentes(orders), cancelados = orders.length - validos.length;
    const tot = validos.reduce((s, o) => s + neto(o), 0), cos = costoDe(validos);
    $('ventasResumen').innerHTML = `
      <div class="summary-box"><div class="label">Pedidos</div><div class="value">${validos.length}</div>${cancelados ? `<div class="sub">+ ${cancelados} cancelados</div>` : ''}</div>
      <div class="summary-box"><div class="label">Ventas de productos</div><div class="value">${fmt(tot)}</div><div class="sub">sin domicilios</div></div>
      <div class="summary-box"><div class="label">Costo de lo producido</div><div class="value">${fmt(cos)}</div></div>
      <div class="summary-box"><div class="label">Utilidad bruta</div><div class="value">${fmt(tot - cos)}</div></div>`;
    $('ventasBody').innerHTML = orders.map((o) => {
      const can = o.status === 'cancelado', costo = can ? 0 : costoOrden(o), c = o.cancelacion || {};
      return `<tr${can ? ' class="row-cancel"' : ''}>
        <td>#${esc(num(o))}<br><small class="hint">${esc(SmashComandas.codigo(o))}</small></td><td>${esc(new Date(o.creado).toLocaleString('es-CO'))}</td><td>${esc(o.cliente)}</td>
        <td>${esc(o.items.map((it) => `${it.qty}× ${it.name}`).join(', '))}</td>
        <td>${fmt(o.subtotal)}${o.descuento ? `<br><small class="hint">desc. −${fmt(o.descuento)}</small>` : ''}</td><td>${fmt(o.domicilio)}</td><td>${fmt(o.total)}</td><td>${can ? '-' : fmt(costo)}</td><td>${can ? '-' : fmt(neto(o) - costo)}</td>
        <td>${esc(STATUS_LABEL[o.status] || o.status)}${can ? `<br><small class="hint">${esc(c.motivo || '')} · ${esc(c.responsable || '')}${c.perdida ? ' · pérdida ' + fmt(c.perdida) : ''}</small>` : ''}</td>
        <td>${can || o.status === 'entregado' ? '' : `<button class="btn-sm" data-vcan="${o.id}">Cancelar</button>`}</td></tr>`;
    }).join('') || '<tr><td colspan="11" style="text-align:center;color:var(--muted);">Sin pedidos para este filtro.</td></tr>';
    $('delBody').innerHTML = SmashExt.getDeletedOrders().slice().reverse().slice(0, 100).map((d) => `<tr>
      <td>${esc(new Date(d.cuando).toLocaleString('es-CO'))}</td><td>${esc(d.por)}</td><td>#${esc(num(d.orden))}</td>
      <td>${esc(d.orden.cliente)}</td><td>${fmt(d.orden.total)}</td><td>${esc(STATUS_LABEL[d.orden.status] || d.orden.status)}</td></tr>`).join('')
      || '<tr><td colspan="6" style="text-align:center;color:var(--muted);">Ningún pedido eliminado.</td></tr>';
  }
  $('ventasBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-vcan]'); if (!b) return;
    const o = SmashDB.getOrderById(parseInt(b.dataset.vcan, 10));
    if (o) SmashUI.openCancelar(o);
  });
  $('ventasFecha').addEventListener('change', () => renderVentas($('ventasFecha').value || null));
  $('ventasHoyBtn').addEventListener('click', () => { $('ventasFecha').value = todayISO(); renderVentas(todayISO()); });
  $('ventasTodoBtn').addEventListener('click', () => { $('ventasFecha').value = ''; renderVentas(null); });
  function descargarCsv(nombre, header, rows) {
    const cell = (v) => { let s = String(v == null ? '' : v); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
    const text = [header, ...rows].map((r) => r.map(cell).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob(['\ufeff' + text], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  $('exportBtn').addEventListener('click', () => descargarCsv(`ventas_smash_${$('ventasFecha').value || 'todas'}.csv`,
    ['numero', 'fecha', 'cliente', 'telefono', 'direccion', 'zona', 'items', 'subtotal', 'descuento', 'domicilio', 'total', 'costo', 'utilidad_bruta', 'pago', 'estado', 'ref'],
    ventasVisibles.map((o) => [num(o), o.creado, o.cliente, o.telefono, o.direccion, o.zona || '', o.items.map((i) => `${i.qty}x ${i.name}`).join(' | '),
      o.subtotal, o.descuento || 0, o.domicilio, o.total, o.status === 'cancelado' ? 0 : costoOrden(o), o.status === 'cancelado' ? 0 : neto(o) - costoOrden(o), o.pago || '', o.status, o.ref || ''])));

  // Reduce la foto (máx. 800 px, JPEG) para que el menú publicado pese poco.
  function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = reject;
      reader.onload = () => {
        const im = new Image();
        im.onerror = () => resolve(reader.result);
        im.onload = () => {
          const s = Math.min(1, 800 / Math.max(im.width, im.height));
          const c = document.createElement('canvas');
          c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
          const x = c.getContext('2d');
          x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
          x.drawImage(im, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/jpeg', 0.82));
        };
        im.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  function costoInfo(p) {
    const r = SmashCostos.resumenProducto(p);
    if (r.fuente === 'receta') return `<p class="hint" style="margin:0 0 5px">Costo por receta: <b>${fmt(r.costo)}</b> · margen ${r.margen == null ? '-' : r.margen.toFixed(1) + '%'}${r.incompleto ? ' · ⚠ receta incompleta' : ''}. El costo manual no se usa.</p>`;
    return `<p class="hint" style="margin:0 0 5px">${r.fuente === 'manual' ? 'Usa el costo manual (sin receta) · margen ' + (r.margen == null ? '-' : r.margen.toFixed(1) + '%') : 'Sin costo: arma su receta o escribe un costo manual.'}</p>`;
  }
  // Sabores / tipos de un adicional: el cliente elige uno por cada unidad (ej. Gaseosa Postobón: Uva, Manzana…)
  const sabChip = (s) => `<span class="sab-chip" data-v="${esc(s)}">${esc(s)}<button type="button" data-sabdel aria-label="Quitar ${esc(s)}">×</button></span>`;
  function sabBox(p) {
    return `<div class="pn-sab"${p.categoria === 'adicional' ? '' : ' hidden'}>
      <div class="lb">Sabores / tipos para elegir</div>
      <div class="sab-list">${(p.sabores || []).map(sabChip).join('')}</div>
      <div class="sab-add"><input type="text" class="pn-sabnew" maxlength="40" placeholder="Ej: Uva"><button type="button" data-sabadd>+ Agregar</button></div>
      <p class="hint">Si tiene sabores, el cliente elige uno por cada unidad. Sin sabores se pide normal. Recuerda dar Guardar.</p>
    </div>`;
  }
  function sabAgregar(card) {
    const inp = card.querySelector('.pn-sabnew'), list = card.querySelector('.sab-list');
    const ya = Array.from(list.querySelectorAll('.sab-chip')).map((c) => c.dataset.v);
    const nuevos = SmashExt.leerSabores(ya.concat(inp.value.split(','))).slice(ya.length);
    list.insertAdjacentHTML('beforeend', nuevos.map(sabChip).join(''));
    inp.value = ''; inp.focus();
  }
  function renderProductos() {
    const products = SmashDB.getProducts();
    $('productosLista').innerHTML = products.map((p) => `
      <div class="producto-card" data-id="${esc(p.id)}">
        ${p.img ? `<img src="${esc(p.img)}" alt="" onerror="smashImgFallback(this)">` : `<div class="prod-placeholder">🍔</div>`}
        <div class="prod-body">
          <input type="text" class="pn-nombre" value="${esc(p.name)}" maxlength="80">
          <input type="text" class="pn-desc" value="${esc(p.desc || '')}" placeholder="Descripción / ingredientes" maxlength="400">
          <div class="prod-row">
            <input type="number" class="pn-precio" value="${esc(p.price)}" placeholder="Precio de venta" min="0">
            <input type="number" class="pn-costo" value="${esc(p.cost)}" placeholder="Costo manual" title="Costo manual: solo se usa si el producto no tiene receta" min="0">
          </div>
          ${costoInfo(p)}
          <select class="pn-categoria">
            <option value="hamburguesa" ${p.categoria === 'hamburguesa' ? 'selected' : ''}>Hamburguesa</option>
            <option value="combo" ${p.categoria === 'combo' ? 'selected' : ''}>Combo (opción dentro de cada hamburguesa)</option>
            <option value="adicional" ${p.categoria === 'adicional' ? 'selected' : ''}>Adicional</option>
          </select>
          ${sabBox(p)}
          <label class="chk"><input type="checkbox" class="pn-activo" ${p.activo !== false ? 'checked' : ''}> Visible para clientes</label>
          <input type="file" class="pn-foto prod-file" accept="image/*">
          <div class="prod-actions">
            <button class="btn-guardar" data-guardar="${esc(p.id)}">Guardar</button>
            <button class="btn-eliminar" data-eliminar="${esc(p.id)}">Eliminar</button>
          </div>
        </div>
      </div>`).join('');
  }
  $('productosLista').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const card = b.closest('.producto-card'); if (!card) return;
    if (b.hasAttribute('data-sabdel')) { b.closest('.sab-chip').remove(); return; }
    if (b.hasAttribute('data-sabadd')) { sabAgregar(card); return; }
    if (b.dataset.guardar) {
      const fields = {
        name: card.querySelector('.pn-nombre').value.trim(),
        desc: card.querySelector('.pn-desc').value.trim(),
        price: parseFloat(card.querySelector('.pn-precio').value) || 0,
        cost: parseFloat(card.querySelector('.pn-costo').value) || 0,
        categoria: card.querySelector('.pn-categoria').value,
        activo: card.querySelector('.pn-activo').checked,
        // lo que quedó escrito sin dar "+ Agregar" también se guarda
        sabores: SmashExt.leerSabores(Array.from(card.querySelectorAll('.sab-chip')).map((c) => c.dataset.v).concat(card.querySelector('.pn-sabnew').value.split(','))),
      };
      if (!fields.name) { alert('El nombre no puede estar vacío.'); return; }
      if (fields.activo && !(fields.price > 0)) { alert('Escribe el precio de venta antes de hacerlo visible para clientes.'); return; }
      const f = card.querySelector('.pn-foto').files[0];
      if (f) fields.img = await fileToDataURL(f);
      SmashDB.updateProduct(b.dataset.guardar, fields);
      renderProductos();
    } else if (b.dataset.eliminar) {
      // Un producto con ventas no se elimina: se oculta, para que el historial quede completo
      if (typeof SmashAudit !== 'undefined' && SmashAudit.productoVendido(b.dataset.eliminar)) {
        alert('Este producto ya tiene ventas registradas, por eso no se elimina. Para quitarlo del menú desmarca "Visible para clientes" y guarda.');
        return;
      }
      if (confirm('¿Eliminar este producto del menú? (Para ocultarlo sin borrarlo, desmarca "Visible para clientes")')) {
        SmashDB.deleteProduct(b.dataset.eliminar);
        renderProductos();
      }
    }
  });
  $('productosLista').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.classList.contains('pn-sabnew')) { e.preventDefault(); sabAgregar(e.target.closest('.producto-card')); }
  });
  $('productosLista').addEventListener('change', (e) => {
    if (e.target.classList.contains('pn-categoria')) e.target.closest('.producto-card').querySelector('.pn-sab').hidden = e.target.value !== 'adicional';
  });
  $('npCategoria').addEventListener('change', () => { $('npSabWrap').hidden = $('npCategoria').value !== 'adicional'; });
  $('nuevoProductoForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = $('npFoto').files[0];
    SmashDB.addProduct({
      name: $('npNombre').value.trim(), desc: $('npDesc').value.trim(),
      price: parseFloat($('npPrecio').value) || 0, cost: parseFloat($('npCosto').value) || 0,
      categoria: $('npCategoria').value, img: f ? await fileToDataURL(f) : '',
      sabores: $('npCategoria').value === 'adicional' ? SmashExt.leerSabores($('npSabores').value) : [],
    });
    e.target.reset();
    $('npSabWrap').hidden = $('npCategoria').value !== 'adicional';
    renderProductos();
  });

  /* ============== PERSONAL ============== */
  $('pDias').innerHTML = SmashExt.DIAS.map((d) => `<label><input type="checkbox" value="${d}"> ${d}</label>`).join('');
  function renderPersonal() {
    $('persBody').innerHTML = SmashExt.getPersonal().map((p) => `<tr>
      <td>${esc(p.nombre)}</td><td>${esc(p.cargo)}</td><td>${esc(p.telefono)}</td><td>${fmt(p.pago || 0)}</td><td>${esc(p.dias.join(', ') || '-')}</td>
      <td>${esc(SmashExt.antiguedad(p.registro))}</td><td>${esc(new Date(p.registro).toLocaleDateString('es-CO'))}</td>
      <td><button class="btn-sm" data-pdel="${esc(p.id)}">Eliminar</button></td></tr>`).join('')
      || '<tr><td colspan="8" style="text-align:center;color:var(--muted);">Todavía no hay personal registrado.</td></tr>';
  }
  $('persForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const err = $('pError'); err.textContent = '';
    const nombre = $('pNombre').value.trim(), tel = $('pTel').value.trim();
    if (nombre.length < 3) { err.textContent = 'Escribe el nombre completo.'; return; }
    if (tel.replace(/\D/g, '').length < 7) { err.textContent = 'Escribe un teléfono válido.'; return; }
    SmashExt.addPersonal({ nombre, cargo: $('pCargo').value, telefono: tel, pago: parseFloat($('pPago').value) || 0, dias: Array.from($('pDias').querySelectorAll('input:checked')).map((i) => i.value) });
    e.target.reset();
    renderPersonal();
  });
  $('persBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pdel]'); if (!b) return;
    if (confirm('¿Eliminar a esta persona del personal?')) { SmashExt.deletePersonal(b.dataset.pdel); renderPersonal(); }
  });

  /* ============== HORARIO DE ATENCIÓN ============== */
  // Borrador de días (lo que el dueño marca antes de guardar)
  let horDraft = null;
  const DIAS_ORDEN = [1, 2, 3, 4, 5, 6, 0];
  const fechaCorta = (f) => new Date(f + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
  function pintarHorDias() {
    $('horDias').innerHTML = DIAS_ORDEN.map((n) => `<label class="dia-chip"><input type="checkbox" data-hdia="${n}"${horDraft.cerrados.indexOf(n) < 0 ? ' checked' : ''}><span>${SmashExt.DIA_LARGO[n].slice(0, 3)}</span></label>`).join('');
    const hoy = todayISO(), proximas = horDraft.fechas.filter((x) => x.f >= hoy);
    $('horFechas').innerHTML = proximas.length
      ? `<ul class="hor-fechas">${proximas.map((x) => `<li><span><b>${esc(fechaCorta(x.f))}</b>${x.m ? ' · ' + esc(x.m) : ''}</span><button type="button" class="btn-sm" data-hquitar="${esc(x.f)}">Quitar</button></li>`).join('')}</ul>`
      : '<p class="hint" style="margin:6px 0 0">No hay días cerrados programados.</p>';
    const abren = horDraft.abiertos.filter((f) => f >= hoy);
    $('horAbiertos').innerHTML = abren.length
      ? `<ul class="hor-fechas">${abren.map((f) => `<li><span><b>${esc(fechaCorta(f))}</b> · abrimos</span><button type="button" class="btn-sm" data-habquitar="${esc(f)}">Quitar</button></li>`).join('')}</ul>`
      : '<p class="hint" style="margin:6px 0 0">No hay días especiales abiertos.</p>';
  }
  function renderHorario() {
    const h = SmashExt.getHorario(), e = SmashExt.estadoHorario(h);
    const editando = $('horForm').contains(document.activeElement) || (horDraft && horDraft.sucio);
    if (!editando) { $('horAbre').value = h.abre; $('horCierra').value = h.cierra; horDraft = { cerrados: h.cerrados.slice(), fechas: h.fechas.slice(), abiertos: h.abiertos.slice(), sucio: false }; pintarHorDias(); }
    $('horEstado').innerHTML = `
      <div class="summary-box"><div class="label">Horario visible</div><div class="value">${esc(e.abre)} a ${esc(e.cierra)}</div><div class="sub">${esc(e.dias)}</div></div>
      <div class="summary-box"><div class="label">Ahora</div><div class="value ${e.abierto ? '' : 'neg'}">${e.abierto ? 'Abierto' : 'Cerrado'}</div><div class="sub">${e.abierto ? 'Los pedidos entran normal' : (e.cerradoHoy ? 'Hoy: ' + esc(e.motivoHoy) + '. ' : '') + 'Los pedidos entran como reserva para ' + esc(e.proxTexto) + ' a las ' + esc(e.abre)}</div>${e.cerradoHoy ? '<button type="button" class="btn-primary" id="horAbrirHoy" style="margin-top:8px">Abrir hoy</button>' : ''}</div>`;
  }
  // "Abrir hoy": abre solo la fecha de hoy (aunque sea de descanso o estuviera cerrada) y lo guarda de una vez
  $('horEstado').addEventListener('click', (e) => {
    if (e.target.id !== 'horAbrirHoy') return;
    const hoy = todayISO();
    if (!horDraft.sucio) { const h = SmashExt.getHorario(); horDraft = { cerrados: h.cerrados.slice(), fechas: h.fechas.slice(), abiertos: h.abiertos.slice(), sucio: false }; }
    horDraft.fechas = horDraft.fechas.filter((x) => x.f !== hoy);
    if (horDraft.abiertos.indexOf(hoy) < 0) horDraft.abiertos.push(hoy);
    horDraft.sucio = true; pintarHorDias();
    $('horForm').requestSubmit();
  });
  $('horForm').addEventListener('change', (e) => {
    const n = e.target.dataset.hdia; if (n == null) return;
    const d = +n, i = horDraft.cerrados.indexOf(d);
    if (e.target.checked && i > -1) horDraft.cerrados.splice(i, 1);
    if (!e.target.checked && i < 0) horDraft.cerrados.push(d);
    horDraft.sucio = true;
  });
  $('horForm').addEventListener('click', (e) => {
    if (e.target.id === 'horFechaAdd') {
      const f = $('horFecha').value, m = $('horMotivo').value.trim();
      if (!f) { $('horMsg').className = 'error'; $('horMsg').textContent = 'Elige la fecha que no abren.'; return; }
      if (f < todayISO()) { $('horMsg').className = 'error'; $('horMsg').textContent = 'Esa fecha ya pasó.'; return; }
      horDraft.fechas = horDraft.fechas.filter((x) => x.f !== f).concat([{ f, m: m || 'Mantenimiento' }]).sort((a, b) => a.f.localeCompare(b.f));
      horDraft.sucio = true; $('horFecha').value = ''; $('horMotivo').value = '';
      $('horMsg').className = 'hint'; $('horMsg').textContent = 'Día agregado. Toca "Guardar horario" para aplicarlo.';
      pintarHorDias(); return;
    }
    if (e.target.id === 'horAbreAdd') {
      const f = $('horAbreFecha').value;
      if (!f) { $('horMsg').className = 'error'; $('horMsg').textContent = 'Elige la fecha que sí abren.'; return; }
      if (f < todayISO()) { $('horMsg').className = 'error'; $('horMsg').textContent = 'Esa fecha ya pasó.'; return; }
      horDraft.fechas = horDraft.fechas.filter((x) => x.f !== f);
      if (horDraft.abiertos.indexOf(f) < 0) horDraft.abiertos = horDraft.abiertos.concat([f]).sort();
      horDraft.sucio = true; $('horAbreFecha').value = '';
      $('horMsg').className = 'hint'; $('horMsg').textContent = 'Día agregado. Toca "Guardar horario" para aplicarlo.';
      pintarHorDias(); return;
    }
    const qa = e.target.closest('[data-habquitar]');
    if (qa) { horDraft.abiertos = horDraft.abiertos.filter((f) => f !== qa.dataset.habquitar); horDraft.sucio = true; pintarHorDias(); return; }
    const q = e.target.closest('[data-hquitar]');
    if (q) { horDraft.fechas = horDraft.fechas.filter((x) => x.f !== q.dataset.hquitar); horDraft.sucio = true; pintarHorDias(); }
  });
  $('horForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ayer = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const r = SmashExt.setHorario($('horAbre').value, $('horCierra').value, horDraft.cerrados, horDraft.fechas.filter((x) => x.f >= ayer), horDraft.abiertos.filter((f) => f >= ayer));
    const msg = $('horMsg');
    msg.className = r.ok ? 'ok-msg' : 'error';
    if (!r.ok) { msg.textContent = r.error; return; }
    horDraft.sucio = false;
    $('horAbre').blur(); $('horCierra').blur(); renderHorario();
    if (typeof SmashNube === 'undefined' || !SmashNube.guardarHorario) { msg.textContent = '✓ Horario guardado en este equipo.'; return; }
    msg.textContent = '✓ Horario guardado. Publicándolo en la página de clientes…';
    let n;
    try { n = await SmashNube.guardarHorario(r.horario); } catch (x) { n = { ok: false, error: String(x && x.message || x) }; }
    msg.className = n.ok ? 'ok-msg' : 'error';
    msg.textContent = n.ok ? '✓ Horario guardado y visible en la página de clientes.' : '⚠ Guardado en este equipo, pero la página de clientes NO lo ve: ' + String(n.error || '').replace(/\.+$/, '') + '.';
  });
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', renderHorario));
  renderHorario();

  /* ============== CONFIGURACIÓN (domicilio, publicar menú, contraseña) ============== */
  // Zonas de cobertura: nombre, tarifa, valor variable y activa. Se editan en borrador y se guardan juntas.
  let zonasDraft = null;
  function renderConfig() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#section-config')) return;
    zonasDraft = SmashExt.getZonasCfg().map((z) => Object.assign({}, z));
    renderZonas();
  }
  function renderZonas() {
    $('zonasLista').innerHTML = `<table class="rtable"><thead><tr><th>Zona</th><th>Tarifa (COP)</th><th>Valor variable</th><th>Activa</th></tr></thead><tbody>` +
      zonasDraft.map((z, i) => `<tr><td class="first"><input data-zi="${i}" data-zf="nombre" maxlength="60" value="${esc(z.nombre)}"></td>
        <td data-l="Tarifa"><input type="number" min="0" step="500" inputmode="numeric" data-zi="${i}" data-zf="fee" value="${esc(z.variable ? '' : z.fee)}"${z.variable ? ' disabled placeholder="la escribe caja"' : ''}></td>
        <td data-l="Valor variable"><input type="checkbox" data-zi="${i}" data-zf="variable"${z.variable ? ' checked' : ''} style="min-width:0;width:24px;min-height:24px"></td>
        <td data-l="Activa"><input type="checkbox" data-zi="${i}" data-zf="activa"${z.activa !== false ? ' checked' : ''} style="min-width:0;width:24px;min-height:24px"></td></tr>`).join('') + '</tbody></table>';
  }
  $('zonasLista').addEventListener('change', (e) => {
    const t = e.target; if (!t.dataset.zf) return;
    const z = zonasDraft[+t.dataset.zi];
    z[t.dataset.zf] = t.type === 'checkbox' ? t.checked : t.value;
    if (t.dataset.zf === 'variable') renderZonas();
  });
  $('zonasLista').addEventListener('input', (e) => { const t = e.target; if (t.dataset.zf && t.type !== 'checkbox') zonasDraft[+t.dataset.zi][t.dataset.zf] = t.value; });
  $('zonaAgregar').addEventListener('click', () => {
    zonasDraft.push({ k: '', nombre: '', fee: 0, variable: false, activa: true });
    renderZonas();
    const ins = $('zonasLista').querySelectorAll('input[data-zf="nombre"]'); ins[ins.length - 1].focus();
  });
  $('guardarZonasBtn').addEventListener('click', () => {
    const msg = $('zonasOk');
    try { zonasDraft = SmashExt.saveZonasCfg(zonasDraft).map((z) => Object.assign({}, z)); } catch (e) { msg.className = 'error'; msg.textContent = '⚠ ' + e.message; return; }
    renderZonas();
    msg.className = 'ok-msg';
    msg.textContent = '✓ Zonas y tarifas guardadas. Si el sitio está en un hosting, publica el menú para que los clientes las vean.';
    setTimeout(() => (msg.textContent = ''), 5000);
  });
  document.querySelectorAll('.publish-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = URL.createObjectURL(new Blob([JSON.stringify(SmashExt.buildMenu())], { type: 'application/json' }));
      const a = document.createElement('a'); a.href = url; a.download = 'menu.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      const old = btn.textContent; btn.textContent = '✓ menu.json descargado';
      setTimeout(() => (btn.textContent = old), 4000);
    });
  });
  $('pwForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const r = SmashExt.changeOwnerPassword($('pwActual').value, $('pwNueva').value, $('pwNueva2').value);
    const m = $('pwMsg');
    m.className = r.ok ? 'ok-msg' : 'error';
    m.textContent = r.ok ? 'Contraseña cambiada. Úsala la próxima vez que entres.' : r.error;
    if (r.ok) e.target.reset();
  });

  /* ============== IMPORTAR PEDIDO DE WHATSAPP ============== */
  const mny = (s) => parseInt(String(s).replace(/\D/g, ''), 10) || 0;
  const fld = (t, l) => { const m = t.match(new RegExp('\\*?' + l + ':\\*?[ \\t]*(.*)', 'i')); return m ? m[1].replace(/\*/g, '').trim() : ''; };
  $('importBtn').addEventListener('click', () => {
    const t = $('importText').value, out = $('importMsg');
    out.className = 'error';
    const its = SmashExt.leerItems(t);
    const cliente = fld(t, 'Cliente'), dir = fld(t, 'Direcci[oó]n'), msgTotal = mny(fld(t, 'TOTAL A PAGAR'));
    const faltan = [];
    if (!cliente) faltan.push('cliente');
    if (!dir) faltan.push('dirección');
    if (!its.length) faltan.push('productos');
    if (!msgTotal) faltan.push('total');
    if (faltan.length) { out.textContent = 'No pude leer: ' + faltan.join(', ') + '. Pega el mensaje completo, tal como llegó.'; return; }
    const res = SmashExt.addOrder({
      cliente, telefono: fld(t, 'Tel[eé]fono'), direccion: dir, items: its, notas: fld(t, 'Notas'),
      zona: fld(t, 'Zona'), domicilio: mny(fld(t, 'Domicilio')), pago: fld(t, 'Medio de pago'), horaEntrega: fld(t, 'Hora de entrega'), ref: fld(t, 'Pedido N.'), origen: 'whatsapp', reserva: /\*?RESERVA:/i.test(t),
      ...SmashExt.leerLeal(t),
    });
    if (res.dup) { out.textContent = 'Ese pedido ya estaba agregado (#' + num(res.order) + ').'; return; }
    $('importText').value = '';
    const diff = res.order.total !== msgTotal;
    out.className = diff ? 'error' : 'ok-msg';
    out.textContent = diff
      ? '⚠ Agregado como #' + num(res.order) + ', pero el total del mensaje (' + fmt(msgTotal) + ') no coincide con el calculado (' + fmt(res.order.total) + '). Revisa.'
      : '✓ Pedido #' + num(res.order) + ' agregado.';
    renderPedidos(); renderVentas($('ventasFecha').value || null); renderContabilidad();
  });

  /* ============== RECIBO DE CIERRE DEL DÍA (térmica 80 mm) ============== */
  function balanceDia() { const f = $('contFecha').value || todayISO(); return SmashTicket.balance(ordersOn(f), f); }
  $('cierreImprimir').addEventListener('click', () => {
    const area = $('printArea');
    area.innerHTML = SmashTicket.cierreHtml(balanceDia());
    const waits = Array.from(area.querySelectorAll('img')).map((im) =>
      im.complete ? Promise.resolve() : new Promise((r) => { im.addEventListener('load', r); im.addEventListener('error', r); }));
    Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 1500))]).then(() => window.print());
  });
  $('cierrePdf').addEventListener('click', () => SmashTicket.downloadCierrePdf(balanceDia()));

  /* ============== IMPRESIÓN DE COMANDA (80 mm, un pedido a la vez) ============== */
  function printComanda(id) {
    const o = SmashDB.getOrderById(id);
    if (!o) return;
    const area = $('printArea');
    area.innerHTML = SmashTicket.html(o);
    // espera a que cargue el logo (máx. 1,5 s) y luego abre la impresión
    const waits = Array.from(area.querySelectorAll('img')).map((im) =>
      im.complete ? Promise.resolve() : new Promise((r) => { im.addEventListener('load', r); im.addEventListener('error', r); }));
    Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 1500))]).then(() => window.print());
  }
  function pdfComanda(id) {
    const o = SmashDB.getOrderById(id);
    if (o) SmashTicket.downloadPdf(o);
  }

  /* ============== CLIENTES Y FIDELIDAD ============== */
  // La sección de clientes (fichas, puntos, búsqueda, CSV) vive en clientes-ui.js, compartida con caja.
  const renderClientes = () => { if (typeof SmashClientesUI !== 'undefined') SmashClientesUI.render(); };

  /* ============== AVISO SONORO DE PEDIDO NUEVO ============== */
  let ultimoConteo = SmashDB.getOrders().length;
  function beep() { SmashExt.chime(); }
  document.addEventListener('pointerdown', () => SmashExt.unlockAudio());

  /* ============== NÓMINA SUGERIDA (pago diario del personal que asiste) ============== */
  function renderNomSug(fecha) {
    const dia = SmashExt.DIAS[(new Date(fecha + 'T12:00:00').getDay() + 6) % 7];
    const lista = SmashExt.getPersonal().filter((p) => (p.dias || []).indexOf(dia) > -1);
    const total = lista.reduce((s, p) => s + (p.pago || 0), 0), b = $('nomSug');
    b.dataset.v = total;
    b.textContent = total ? `Usar pago diario del personal (${dia}): ${fmt(total)}` : '';
    b.hidden = !total;
  }
  $('nomSug').addEventListener('click', (e) => { $('gNomina').value = e.target.dataset.v; });

  /* ============== MÁS VENDIDAS (día / semana / mes / año) ============== */
  let topP = 'semana';
  const ymd = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  function rango(p, ref) {
    const d = new Date(ref + 'T12:00:00');
    let a = new Date(d), b = new Date(d);
    if (p === 'semana') { const w = (d.getDay() + 6) % 7; a.setDate(d.getDate() - w); b = new Date(a); b.setDate(a.getDate() + 6); }
    else if (p === 'mes') { a = new Date(d.getFullYear(), d.getMonth(), 1, 12); b = new Date(d.getFullYear(), d.getMonth() + 1, 0, 12); }
    else if (p === 'anio') { a = new Date(d.getFullYear(), 0, 1, 12); b = new Date(d.getFullYear(), 11, 31, 12); }
    return [ymd(a), ymd(b)];
  }
  function renderTop() {
    if ($('section-top').hidden) return;
    if (!$('topFecha').value) $('topFecha').value = todayISO();
    const [d1, d2] = rango(topP, $('topFecha').value);
    $('topRango').textContent = d1 === d2 ? d1 : d1 + '  →  ' + d2;
    const led = SmashExt.refreshLedger(), tot = {}, dias = [];
    Object.keys(led).sort().forEach((day) => {
      if (day < d1 || day > d2) return;
      let n = 0;
      Object.keys(led[day]).forEach((id) => { const r = led[day][id]; tot[id] = tot[id] || { n: r.n, q: 0 }; tot[id].q += r.q; tot[id].n = r.n; n += r.q; });
      dias.push([day, n, led[day]]);
    });
    const rows = Object.keys(tot).map((id) => ({ id, n: tot[id].n, q: tot[id].q })).sort((a, b) => b.q - a.q);
    const total = rows.reduce((s, r) => s + r.q, 0), top = rows[0];
    const prod = top ? SmashDB.getProductById(top.id) : null;
    const lbl = { dia: 'del día', semana: 'de la semana', mes: 'del mes', anio: 'del año' }[topP];
    $('topHero').innerHTML = top ? `<div class="top-hero">
        ${prod && prod.img ? `<img src="${esc(prod.img)}" alt="" onerror="smashImgFallback(this)">` : '<div class="prod-placeholder">🍔</div>'}
        <div><small>🏆 Hamburguesa más vendida ${lbl}</small><h3>${esc(top.n)}</h3><b>${top.q} unidades</b> · ${Math.round(top.q / total * 100)}% del total</div></div>`
      : '<p class="hint">Todavía no hay hamburguesas vendidas en este periodo.</p>';
    $('topResumen').innerHTML = `<div class="summary-box"><div class="label">Hamburguesas vendidas</div><div class="value">${total}</div></div>
      <div class="summary-box"><div class="label">Tipos vendidos</div><div class="value">${rows.length}</div></div>
      <div class="summary-box"><div class="label">Días con ventas</div><div class="value">${dias.length}</div></div>
      <div class="summary-box"><div class="label">Promedio por día</div><div class="value">${dias.length ? (total / dias.length).toFixed(1) : 0}</div></div>`;
    $('topBody').innerHTML = rows.map((r) => `<tr><td>${esc(r.n)}</td><td>${r.q}</td><td>${Math.round(r.q / total * 100)}%</td></tr>`).join('')
      || '<tr><td colspan="3" style="text-align:center;color:var(--muted);">Sin datos.</td></tr>';
    $('topDiasHead').innerHTML = '<tr><th>Día</th><th>Total</th><th>Detalle</th></tr>';
    $('topDias').innerHTML = dias.slice().reverse().map(([day, n, det]) => `<tr><td>${esc(day)}</td><td><b>${n}</b></td><td>${Object.keys(det).map((id) => esc(det[id].n) + ' ×' + det[id].q).join(' · ')}</td></tr>`).join('')
      || '<tr><td colspan="3" style="text-align:center;color:var(--muted);">Sin datos.</td></tr>';
  }
  $('topTabs').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    topP = b.dataset.p;
    $('topTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('active', x === b));
    renderTop();
  });
  $('topFecha').addEventListener('change', renderTop);

  /* ============== SIMULADOR DE COSTO ============== */
  const SIMK = 'smash_sim';
  const simLoad = () => { try { return JSON.parse(SmashLS.getItem(SIMK)) || { nombre: '', margen: 52, ings: [] }; } catch (e) { return { nombre: '', margen: 52, ings: [] }; } };
  let sim = simLoad();
  const simSave = () => { try { SmashLS.setItem(SIMK, JSON.stringify(sim)); } catch (e) { /* sin almacenamiento */ } };
  function renderSim() {
    if ($('section-simulador').hidden) return;
    if (document.activeElement !== $('simNombre')) $('simNombre').value = sim.nombre;
    if (document.activeElement !== $('simMargen')) $('simMargen').value = sim.margen;
    $('simLista').innerHTML = sim.ings.length ? `<div class="table-wrap"><table class="data-table"><thead><tr><th>Ingrediente</th><th>Cant.</th><th>Costo unit.</th><th>Subtotal</th><th></th></tr></thead><tbody>` +
      sim.ings.map((x, i) => `<tr><td>${esc(x.n)}</td><td>${x.q}</td><td>${fmt(x.c)}</td><td>${fmt(x.q * x.c)}</td><td><button class="btn-sm" data-simdel="${i}">Quitar</button></td></tr>`).join('') + '</tbody></table></div>'
      : '<p class="hint">Agrega el primer ingrediente.</p>';
    const costo = sim.ings.reduce((s, x) => s + x.q * x.c, 0), m = Math.min(95, Math.max(1, +sim.margen || 52)) / 100;
    const precio = costo > 0 ? Math.ceil(costo / (1 - m) / 100) * 100 : 0;
    const util = precio - costo;
    $('simResumen').innerHTML = `<div class="summary-box"><div class="label">Costo de insumos</div><div class="value">${fmt(costo)}</div></div>
      <div class="summary-box"><div class="label">Precio sugerido</div><div class="value">${fmt(precio)}</div></div>
      <div class="summary-box"><div class="label">Utilidad por unidad</div><div class="value">${fmt(util)}</div></div>
      <div class="summary-box"><div class="label">Margen real</div><div class="value">${precio ? (util / precio * 100).toFixed(1) : 0}%</div></div>`;
    $('simNota').className = 'banner' + (costo ? ' green' : '');
    $('simNota').textContent = costo ? `Con costo ${fmt(costo)}, vender a ${fmt(precio)} deja ${Math.round(m * 100)}% libre de insumos (precio redondeado hacia arriba a $100). No incluye nómina, servicios ni publicidad.` : 'Sin ingredientes todavía.';
  }
  $('simForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sim.ings.push({ n: $('simIng').value.trim().slice(0, 60), q: parseFloat($('simCant').value) || 0, c: parseFloat($('simCosto').value) || 0 });
    e.target.reset(); $('simCant').value = 1; simSave(); renderSim(); $('simIng').focus();
  });
  $('simLista').addEventListener('click', (e) => { const b = e.target.closest('[data-simdel]'); if (!b) return; sim.ings.splice(+b.dataset.simdel, 1); simSave(); renderSim(); });
  $('simNombre').addEventListener('input', () => { sim.nombre = $('simNombre').value; simSave(); });
  $('simMargen').addEventListener('input', () => { sim.margen = parseFloat($('simMargen').value) || 52; simSave(); renderSim(); });
  $('simLimpiar').addEventListener('click', () => { if (confirm('¿Borrar la simulación actual?')) { sim = { nombre: '', margen: 52, ings: [] }; simSave(); renderSim(); } });

  /* ============== CREAR PEDIDO (crear-pedido.js, compartido con cocina) ============== */
  if (typeof SmashCrear !== 'undefined') SmashCrear.init({ alCrear: () => { ultimoConteo = SmashDB.getOrders().length; renderAll(); } });

  /* ============== INICIO ============== */
  SmashUI.init({ who: 'dueño', refresh: renderAll, print: printComanda, pdf: pdfComanda });
  const existing = SmashExt.currentOwner();
  if (existing) enterDashboard(existing);

  setInterval(() => { if (!$('dashboardSection').hidden) renderPedidos(); }, 3000);
  window.addEventListener('storage', (e) => {
    if (e.key === SmashDB.KEYS.ORDERS && !$('dashboardSection').hidden) {
      const n = SmashDB.getOrders().length;
      if (n > ultimoConteo) beep();
      ultimoConteo = n;
      renderPedidos(); renderVentas($('ventasFecha').value || null); renderClientes();
      if (document.activeElement && !['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) renderContabilidad();
    }
  });
})();
