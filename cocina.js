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

  /* ============== PEDIDOS: listado horizontal + ficha lateral (pedidos-lista.js) ============== */

  function renderCupo() {
    const el = $('cupoBar'), c = SmashExt.cupoHoy();
    if (!c) { el.className = 'cupo-bar'; el.innerHTML = '🍔 Cupo de hoy sin definir. Defínelo en Configuración.'; return; }
    const rest = c.total - c.vendidas;
    el.className = 'cupo-bar' + (rest <= 0 ? ' out' : rest <= 10 ? ' low' : '');
    el.innerHTML = (rest <= 0 ? `🍔 <b>AGOTADO</b>: vendidas ${c.vendidas} de ${c.total}`
      : `🍔 Hoy: <b>${c.vendidas}</b> vendidas · quedan <b>${rest}</b> de ${c.total}`)
      + (CN.error ? ` <small title="${SmashUI.esc(CN.error)}">· ⚠ la página de clientes NO lo ve (${SmashUI.esc(CN.error)})</small>`
        : CN.enviado === c.total + ':' + c.vendidas ? ' <small>· 🌐 visible en la página de clientes</small>' : '');
    subirCupo(c);
  }

  /* El cupo y las vendidas se publican solos en la nube (tabla cupo_dia) para la
     página de clientes. Solo se envía cuando cambia; si falla, reintenta cada 30 s. */
  const CN = { enviado: '', enviando: false, error: '', fallo: 0 };
  async function subirCupo(c, forzar) {
    if (typeof SmashNube === 'undefined' || !SmashNube.ok || !c || CN.enviando) return;
    const clave = c.total + ':' + c.vendidas;
    if (!forzar && (clave === CN.enviado || (CN.error && Date.now() - CN.fallo < 30000))) return;
    CN.enviando = true;
    let r;
    try { r = await SmashNube.guardarCupo(c.total, c.vendidas); } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
    CN.enviando = false;
    if (r.ok) { CN.enviado = clave; CN.error = ''; } else { CN.error = r.error; CN.fallo = Date.now(); }
    renderCupoSolo();
    return r;
  }
  // repinta la barra sin volver a enviar
  function renderCupoSolo() { const e = CN.enviando; CN.enviando = true; renderCupo(); CN.enviando = e; }
  // al conectar la cuenta de caja o dueño se publica de inmediato
  if (typeof SmashNube !== 'undefined' && SmashNube.alCambiar) SmashNube.alCambiar(() => { CN.error = ''; CN.fallo = 0; subirCupo(SmashExt.cupoHoy(), true); });

  function renderPedidos() {
    renderCupo();
    SmashLista.render();
  }

  // Los domicilios (listos y en camino) ahora están en el mismo listado de pedidos
  function renderDomicilios() {}

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
  $('guardarCupoBtn').addEventListener('click', async () => {
    SmashExt.setCupo($('cupoInput').value);
    const ok = $('cupoOk');
    ok.textContent = 'Cupo guardado en este equipo. Publicándolo en la página de clientes…';
    CN.error = ''; CN.fallo = 0; CN.enviado = '';
    renderCupoSolo();
    let r = null;
    for (let i = 0; i < 20 && CN.enviando; i++) await new Promise((x) => setTimeout(x, 150));   // espera un envío en curso
    r = await subirCupo(SmashExt.cupoHoy(), true);
    ok.textContent = !r ? 'Cupo de hoy guardado.'
      : r.ok ? '✓ Cupo de hoy guardado y visible en la página de clientes.'
      : '⚠ Cupo guardado solo en este equipo: la página de clientes NO lo ve porque ' + r.error + '.';
    if (r && r.ok) setTimeout(() => (ok.textContent = ''), 6000);
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
      zona: fld(t, 'Zona'), domicilio: mny(fld(t, 'Domicilio')), domicilioPendiente: /otros/i.test(fld(t, 'Zona')) && !mny(fld(t, 'Domicilio')), pago: fld(t, 'Medio de pago'), horaEntrega: fld(t, 'Hora de entrega'), ref: fld(t, 'Pedido N.'), origen: 'whatsapp', reserva: /\*?RESERVA:/i.test(t),
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
  function paintSound() {
    const on = SmashExt.soundOn(), ready = SmashExt.audioReady();
    $('soundBtn').textContent = on ? '🔔 Sonido: activado' : '🔕 Sonido: apagado';
    $('soundHint').textContent = on && !ready ? 'Toca cualquier parte de la pantalla una vez para habilitar el audio del navegador.' : '';
  }
  $('soundBtn').addEventListener('click', () => { SmashExt.setSound(!SmashExt.soundOn()); SmashExt.unlockAudio(); if (SmashExt.soundOn()) SmashExt.chime(true); paintSound(); });
  document.addEventListener('pointerdown', () => { SmashExt.unlockAudio(); setTimeout(paintSound, 200); });
  setInterval(paintSound, 4000);

  /* ============== CREAR PEDIDO: vive en crear-pedido.js (compartido con dueños) ============== */
  const renderCrear = () => { if (typeof SmashCrear !== 'undefined') SmashCrear.render(); };
  if (typeof SmashCrear !== 'undefined') SmashCrear.init({ alCrear: () => { ultimoConteo = SmashDB.getOrders().length; renderAll(); } });
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
