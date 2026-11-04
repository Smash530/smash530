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
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (o) => o.numeroDia || o.id;

  /* ============== LOGIN DE PERSONAL ============== */
  $('staffLoginForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const usuario = $('staffUsuario').value.trim();
    const password = $('staffPassword').value;
    const err = $('staffError');
    err.textContent = '';

    const res = SmashDB.loginStaff(usuario, password);
    if (!res.ok) { err.textContent = res.error; return; }
    enterDashboard(res.user);
  });

  $('staffLogoutBtn').addEventListener('click', () => {
    SmashDB.logoutStaff();
    location.reload();
  });

  function enterDashboard(staff) {
    $('staffAuthSection').hidden = true;
    $('dashboardSection').hidden = false;
    $('staffBox').hidden = false;
    $('staffName').textContent = '👨‍🍳 ' + staff.nombre;
    $('contFecha').value = todayISO();
    renderAll();
  }

  function renderAll() {
    renderPedidos();
    renderDomicilios();
    renderConteo();
    renderContabilidad();
    renderClientes();
    renderConfig();
    renderCrear();
  }

  /* ============== NAVEGACIÓN ENTRE SECCIONES ============== */
  document.querySelectorAll('.nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach((b) => b.classList.remove('active'));
      document.querySelectorAll('.panel-section').forEach((s) => (s.hidden = true));
      btn.classList.add('active');
      $('section-' + btn.dataset.section).hidden = false;
      if (btn.dataset.section === 'clientes') renderClientes();
      if (btn.dataset.section === 'crear') renderCrear();
      $('side').classList.remove('open');
    });
  });
  $('menuToggle').addEventListener('click', () => $('side').classList.toggle('open'));

  /* ============== PEDIDOS PENDIENTES (recibido + confirmado + preparando) ============== */
  const EMPTY = { nuevo: 'Sin pedidos nuevos.', confirmado: 'Nada por iniciar.', preparando: 'Nada en preparación.', listo: 'No hay domicilios esperando salida.', en_camino: 'Ningún domicilio en camino.' };
  function fillCol(status, orders) {
    const list = orders.filter((o) => o.status === status).sort((a, b) => a.id - b.id);
    $('col-' + status).innerHTML = list.length ? list.map((o) => SmashUI.card(o)).join('') : `<p class="empty-col-msg">${EMPTY[status]}</p>`;
    const n = $('n-' + status); if (n) n.textContent = list.length || '';
  }

  function renderCupo() {
    const el = $('cupoBar'), c = SmashExt.cupoHoy();
    if (!c) { el.className = 'cupo-bar'; el.innerHTML = '🍔 Cupo de hoy sin definir. Defínelo en Configuración.'; return; }
    const rest = c.total - c.vendidas;
    el.className = 'cupo-bar' + (rest <= 0 ? ' out' : rest <= 10 ? ' low' : '');
    el.innerHTML = rest <= 0 ? `🍔 <b>AGOTADO</b>: vendidas ${c.vendidas} de ${c.total}`
      : `🍔 Hoy: <b>${c.vendidas}</b> vendidas · quedan <b>${rest}</b> de ${c.total}`;
  }

  function renderPedidos() {
    renderCupo();
    const orders = SmashDB.getOrders();
    ['nuevo', 'confirmado', 'preparando'].forEach((s) => fillCol(s, orders));
  }

  /* ============== DOMICILIOS (listos para despachar + en camino) ============== */
  function renderDomicilios() {
    const orders = SmashDB.getOrders();
    ['listo', 'en_camino'].forEach((s) => fillCol(s, orders));
  }

  /* ============== CONTEO DEL DÍA ============== */
  function renderConteo() {
    const hoy = todayISO();
    const orders = ordersOn(hoy);
    const products = SmashDB.getProducts();
    const porProducto = {};
    let totalHamburguesas = 0;
    let totalPedidos = orders.length;

    orders.forEach((o) => {
      o.items.forEach((it) => {
        porProducto[it.id] = (porProducto[it.id] || 0) + it.qty;
        const prod = products.find((p) => p.id === it.id);
        if (prod && prod.categoria === 'hamburguesa') totalHamburguesas += it.qty;
      });
    });

    $('conteoResumen').innerHTML = `
      <div class="summary-box"><div class="label">Hamburguesas vendidas</div><div class="value">${totalHamburguesas}</div></div>
      <div class="summary-box"><div class="label">Pedidos hoy</div><div class="value">${totalPedidos}</div></div>
      <div class="summary-box"><div class="label">Ingreso hoy</div><div class="value">${fmt(orders.reduce((s, o) => s + o.total, 0))}</div></div>
      <div class="summary-box"><div class="label">Hora de corte</div><div class="value">${new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</div></div>
    `;

    const rows = Object.entries(porProducto).map(([id, qty]) => {
      const prod = products.find((p) => p.id === id);
      return `<div class="row"><span>${prod ? prod.name : id}</span><span>${qty}</span></div>`;
    }).join('');
    $('conteoDetalle').innerHTML = rows || '<div class="row"><span>Todavía no hay ventas hoy.</span></div>';
  }

  /* ============== FACTURACIÓN DEL DÍA (solo lo facturado, sin costos ni utilidad) ============== */
  $('contFecha').addEventListener('change', renderContabilidad);
  function renderContabilidad() {
    const fecha = $('contFecha').value || todayISO();
    const orders = ordersOn(fecha);
    const prod = orders.reduce((s, o) => s + o.subtotal - (o.descuento || 0), 0), dom = orders.reduce((s, o) => s + o.domicilio, 0);
    $('contCaja').innerHTML = SmashUI.caja(fecha);
    $('contResumen').innerHTML = `
      <div class="summary-box"><div class="label">Pedidos</div><div class="value">${orders.length}</div></div>
      <div class="summary-box"><div class="label">Facturado productos</div><div class="value">${fmt(prod)}</div></div>
      <div class="summary-box"><div class="label">Domicilios (aparte)</div><div class="value">${fmt(dom)}</div></div>
      <div class="summary-box"><div class="label">Total con domicilios</div><div class="value">${fmt(prod + dom)}</div></div>`;
    $('contNota').textContent = orders.length ? 'Ticket promedio: ' + fmt((prod + dom) / orders.length) : 'Sin ventas registradas ese día.';
  }

  /* ============== CONFIGURACIÓN (solo el cupo del día) ============== */
  function renderConfig() {
    const raw = SmashExt.getCupoRaw();
    $('cupoInput').value = raw ? raw.total : '';
  }
  $('guardarCupoBtn').addEventListener('click', () => {
    SmashExt.setCupo($('cupoInput').value);
    renderCupo();
    $('cupoOk').textContent = 'Cupo de hoy guardado.';
    setTimeout(() => ($('cupoOk').textContent = ''), 4000);
  });
  document.querySelectorAll('.publish-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(SmashExt.buildMenu())], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'menu.json';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 3000);
      const old = btn.textContent;
      btn.textContent = '✓ menu.json descargado: súbelo a tu hosting';
      setTimeout(() => (btn.textContent = old), 4000);
    });
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
      zona: fld(t, 'Zona'), domicilio: mny(fld(t, 'Domicilio')), domicilioPendiente: /otros/i.test(fld(t, 'Zona')) && !mny(fld(t, 'Domicilio')), pago: fld(t, 'Medio de pago'), ref: fld(t, 'Pedido N.'), origen: 'whatsapp', reserva: /\*?RESERVA:/i.test(t),
      ...SmashExt.leerLeal(t),
    });
    if (res.dup) { out.textContent = 'Ese pedido ya estaba agregado (#' + num(res.order) + ').'; return; }
    $('importText').value = '';
    const diff = !res.order.domicilioPendiente && res.order.total !== msgTotal;
    out.className = diff ? 'error' : 'ok-msg';
    out.textContent = diff
      ? '⚠ Agregado como #' + num(res.order) + ', pero el total del mensaje (' + fmt(msgTotal) + ') no coincide con el calculado (' + fmt(res.order.total) + '). Revisa.'
      : '✓ Pedido #' + num(res.order) + ' agregado.';
    ultimoConteo = SmashDB.getOrders().length; renderPedidos(); renderConteo(); renderContabilidad();
  });

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
  function paintSound() {
    const on = SmashExt.soundOn(), ready = SmashExt.audioReady();
    $('soundBtn').textContent = on ? '🔔 Sonido: activado' : '🔕 Sonido: apagado';
    $('soundHint').textContent = on && !ready ? 'Toca cualquier parte de la pantalla una vez para habilitar el audio del navegador.' : '';
  }
  $('soundBtn').addEventListener('click', () => { SmashExt.setSound(!SmashExt.soundOn()); SmashExt.unlockAudio(); if (SmashExt.soundOn()) SmashExt.chime(true); paintSound(); });
  document.addEventListener('pointerdown', () => { SmashExt.unlockAudio(); setTimeout(paintSound, 200); });
  setInterval(paintSound, 4000);

  /* ============== CREAR PEDIDO (como un cliente) ============== */
  // combo: { 'hamburguesa|combo': unidades }. El combo es una opción de cada hamburguesa, no un producto suelto.
  // sab: { 'adicional|sabor': unidades } para adicionales con sabores (ej. gaseosas)
  const cr = { qty: {}, nota: {}, combo: {}, sab: {}, built: '' };
  const crSabs = (id) => Object.keys(cr.sab).filter((k) => k.split('|')[0] === id);
  const crElegidas = (id) => crSabs(id).reduce((s, k) => s + cr.sab[k], 0);
  const crCombos = () => SmashDB.getProducts({ soloActivos: true }).filter((p) => p.categoria === 'combo');
  const crEnCombo = (bid) => Object.keys(cr.combo).filter((k) => k.split('|')[0] === bid).reduce((s, k) => s + cr.combo[k], 0);
  function crZonas() {
    const z = SmashExt.getZones(), sel = $('crZona'), cur = sel.value;
    const html = Object.keys(z).map((k) => `<option value="${k}">${esc(z[k].nombre)}${z[k].variable ? ' — valor variable' : ' — ' + fmt(z[k].fee)}</option>`).join('');
    if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; if (cur) sel.value = cur; }
  }
  function renderCrear() {
    crZonas();
    const prods = SmashDB.getProducts({ soloActivos: true });
    const box = $('crProducts');
    // no redibujar si el usuario está escribiendo una nota
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') { crTotal(); return; }
    const cs = prods.filter((p) => p.categoria === 'combo');
    box.innerHTML = prods.filter((p) => p.categoria !== 'combo').map((p) => {
      const q = cr.qty[p.id] || 0;
      const combo = q && p.categoria === 'hamburguesa' ? cs.map((c) => { const n = cr.combo[p.id + '|' + c.id] || 0; return `<div class="cr-combo">🍟 En combo (+${fmt(c.price)}): <b>${n} de ${q}</b>
          <div class="qty-mini"><button type="button" data-cr="cminus" data-id="${esc(p.id)}" data-c="${esc(c.id)}" aria-label="Menos combos">−</button><b>${n}</b><button type="button" data-cr="cplus" data-id="${esc(p.id)}" data-c="${esc(c.id)}" aria-label="Más combos">+</button></div></div>`; }).join('') : '';
      const ss = p.sabores || [];
      const sab = q && ss.length ? `<div class="cr-combo">🥤 Sabor: <b>${crElegidas(p.id)} de ${q}</b></div>` + ss.map((s, i) => { const n = cr.sab[p.id + '|' + s] || 0; return `<div class="cr-combo">${esc(s)}
          <div class="qty-mini"><button type="button" data-cr="sminus" data-id="${esc(p.id)}" data-s="${i}" aria-label="Menos ${esc(s)}">−</button><b>${n}</b><button type="button" data-cr="splus" data-id="${esc(p.id)}" data-s="${i}" aria-label="Más ${esc(s)}">+</button></div></div>`; }).join('') : '';
      return `<div class="cr-card${q ? ' sel' : ''}">
        <img src="${esc(p.img || '')}" alt="" loading="lazy" onerror="smashImgFallback(this)">
        <div class="cr-info"><b>${esc(p.name)}</b><small>${esc(p.desc || '')}</small><span class="cr-price">${fmt(p.price)}</span>
          <div class="qty-mini"><button type="button" data-cr="minus" data-id="${esc(p.id)}" aria-label="Menos">−</button><b>${q}</b><button type="button" data-cr="plus" data-id="${esc(p.id)}" aria-label="Más">+</button></div>
          ${combo}${sab}
          ${q ? `<input class="cr-note" data-id="${esc(p.id)}" maxlength="200" placeholder="Nota de este producto (sin cebolla, etc.)" value="${esc(cr.nota[p.id] || '')}">` : ''}
        </div></div>`;
    }).join('') || '<p class="hint">No hay productos activos.</p>';
    crTotal();
  }
  function crTotal() {
    const sub = crItems().reduce((s, i) => s + i.qty * i.price, 0);
    const zk = $('crZona').value, z = SmashExt.getZones()[zk] || { fee: 0 };
    $('crDomWrap').hidden = !z.variable;
    const dom = z.variable ? (parseFloat($('crDom').value) || 0) : z.fee;
    $('crTotal').innerHTML = `Subtotal ${fmt(sub)} · Domicilio ${fmt(dom)} · <b>Total ${fmt(sub + dom)}</b>`;
  }
  $('crProducts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cr]'); if (!b) return;
    const id = b.dataset.id, q = cr.qty[id] || 0, act = b.dataset.cr;
    if (act === 'cplus' || act === 'cminus') {
      const k = id + '|' + b.dataset.c, n = cr.combo[k] || 0;
      if (act === 'cplus' && crEnCombo(id) < q) cr.combo[k] = n + 1;
      if (act === 'cminus') cr.combo[k] = Math.max(0, n - 1);
      renderCrear(); return;
    }
    if (act === 'splus' || act === 'sminus') {
      const p = SmashDB.getProductById(id), s = p && (p.sabores || [])[+b.dataset.s];
      if (!s) return;
      const k = id + '|' + s, n = cr.sab[k] || 0;
      if (act === 'splus' && crElegidas(id) < q) cr.sab[k] = n + 1;
      if (act === 'sminus') cr.sab[k] = Math.max(0, n - 1);
      renderCrear(); return;
    }
    cr.qty[id] = act === 'plus' ? Math.min(50, q + 1) : Math.max(0, q - 1);
    let sobraS = crElegidas(id) - (cr.qty[id] || 0);
    crSabs(id).reverse().forEach((k) => { const r = Math.min(cr.sab[k], Math.max(0, sobraS)); cr.sab[k] -= r; sobraS -= r; });
    if (!cr.qty[id]) delete cr.nota[id];
    // si quedan menos hamburguesas que combos, se quitan los combos que sobran
    let sobra = crEnCombo(id) - (cr.qty[id] || 0);
    Object.keys(cr.combo).filter((k) => k.split('|')[0] === id).forEach((k) => { const r = Math.min(cr.combo[k], Math.max(0, sobra)); cr.combo[k] -= r; sobra -= r; });
    renderCrear();
  });
  function crItems() {
    const prods = SmashDB.getProducts({ soloActivos: true }), cs = crCombos(), out = [];
    prods.filter((p) => p.categoria !== 'combo' && cr.qty[p.id] > 0).forEach((p) => {
      const ss = p.sabores || [], nota = (cr.nota[p.id] || '').trim();
      if (ss.length) {
        // una línea por sabor; las unidades sin sabor elegido quedan en una línea aparte
        let resto = cr.qty[p.id];
        ss.forEach((s) => { const n = Math.min(cr.sab[p.id + '|' + s] || 0, resto); if (n) { out.push({ id: p.id, name: p.name, price: p.price, qty: n, cat: p.categoria, nota: 'Sabor: ' + s + (nota ? ' · ' + nota : '') }); resto -= n; } });
        if (resto) out.push({ id: p.id, name: p.name, price: p.price, qty: resto, cat: p.categoria, nota });
        return;
      }
      out.push({ id: p.id, name: p.name, price: p.price, qty: cr.qty[p.id], cat: p.categoria, nota: (cr.nota[p.id] || '').trim() });
      if (p.categoria === 'hamburguesa') cs.forEach((c) => { const n = cr.combo[p.id + '|' + c.id] || 0; if (n) out.push({ id: c.id, name: c.name, price: c.price, qty: n, cat: 'combo', nota: 'Para ' + p.name }); });
    });
    return out;
  }
  $('crProducts').addEventListener('input', (e) => { if (e.target.classList.contains('cr-note')) cr.nota[e.target.dataset.id] = e.target.value; });
  ['crZona', 'crDom'].forEach((i) => $(i).addEventListener('input', crTotal));
  $('crBtn').addEventListener('click', () => {
    const msg = $('crMsg'); msg.className = 'error'; msg.textContent = '';
    const items = crItems();
    const cliente = $('crCliente').value.trim(), zk = $('crZona').value, z = SmashExt.getZones()[zk];
    if (!items.length) { msg.textContent = 'Elige al menos un producto.'; return; }
    if (!cliente) { msg.textContent = 'Escribe el nombre del cliente.'; return; }
    let dom = z.fee, pend = false;
    if (z.variable) { const v = $('crDom').value; if (v === '' || !(parseFloat(v) >= 0)) { msg.textContent = 'Escribe el valor del domicilio de la agencia.'; return; } dom = parseFloat(v); }
    const res = SmashExt.addOrder({ cliente, telefono: $('crTel').value.trim(), direccion: $('crDir').value.trim(), items, notas: $('crNotas').value.trim(),
      zona: z.nombre, domicilio: dom, domicilioPendiente: pend, pago: $('crPago').value, origen: 'cocina' });
    if (!res.ok) { msg.textContent = 'No se creó: era igual al pedido #' + num(res.order) + ' de hace unos minutos.'; return; }
    cr.qty = {}; cr.nota = {}; cr.combo = {}; cr.sab = {};
    ['crCliente', 'crTel', 'crDir', 'crNotas', 'crDom'].forEach((i) => ($(i).value = ''));
    msg.className = 'ok-msg'; msg.textContent = '✓ Pedido #' + num(res.order) + ' creado. Ya está en Pedidos pendientes.';
    ultimoConteo = SmashDB.getOrders().length;
    renderAll();
  });

  /* ============== INICIO ============== */
  SmashUI.init({ who: 'cocina', refresh: renderAll, print: printComanda, pdf: pdfComanda });
  const existingStaff = SmashDB.currentStaff();
  if (existingStaff) enterDashboard(existingStaff);

  setInterval(() => {
    if (!$('dashboardSection').hidden) {
      const n = SmashDB.getOrders().length;
      if (n > ultimoConteo) beep();
      ultimoConteo = n;
      renderPedidos();
      renderDomicilios();
      renderConteo();
    }
  }, 3000);

  window.addEventListener('storage', (e) => {
    if (e.key === SmashDB.KEYS.ORDERS && !$('dashboardSection').hidden) {
      const n = SmashDB.getOrders().length;
      if (n > ultimoConteo) beep();
      ultimoConteo = n;
      renderClientes();
      renderPedidos();
      renderDomicilios();
      renderConteo();
      renderContabilidad();
    }
  });
})();
