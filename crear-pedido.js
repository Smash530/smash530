/* ============================================================
   SMASH · crear-pedido.js  (cocina y dueños)
   "Crear pedido" como lo haría un cliente:
   - Izquierda: los productos (con combos, sabores y notas).
   - Derecha: datos del cliente, resumen del pedido, total y el
     botón "Crear pedido" (se queda fijo mientras bajas).
   Se monta en #section-crear .crear-root. Cada panel llama a
   SmashCrear.init({ alCrear }) para refrescar lo suyo.
   ============================================================ */
const SmashCrear = (function () {
  const root = document.querySelector('#section-crear .crear-root');
  if (!root) return { init() {}, render() {} };
  const $ = (id) => document.getElementById(id);
  const esc = SmashUI.esc, fmt = SmashUI.fmt;
  const num = (o) => o.numeroDia || o.id;
  let cfg = { alCrear() {} };
  // Promociones del club: se ven en los productos; se aplican solo si el pedido es de un cliente registrado
  const N = typeof SmashNube !== 'undefined' && SmashNube.ok ? SmashNube : null;
  let promos = [], promosEn = 0, promosMsg = '';
  const cuestaPts = (p) => Math.max(0, Number(p && p.puntos) || 0);
  const promosHoy = () => (N ? promos.filter((p) => N.vigente(p) && !cuestaPts(p)) : []);
  async function cargarPromos(forzar) {
    if (!N || (!forzar && Date.now() - promosEn < 120000)) return;
    promosEn = Date.now();
    try { const r = await N.panelPromos(); promos = r.lista || []; promosMsg = r.ok ? '' : (r.error || ''); } catch (e) { promosMsg = 'Sin internet: no se cargaron las promociones.'; }
    render();
  }

  root.innerHTML = `
    <div class="cr-layout">
      <div class="cr-left">
        <div class="cr-products" id="crProducts"></div>
      </div>
      <aside class="cr-right">
        <div class="cr-panel">
          <h3 class="cr-h">Datos del cliente</h3>
          <div class="cr-club" id="crClub">
            <label>⭐ ¿Cliente del club? Búscalo para aplicar sus promos y sumarle puntos
              <span class="cr-club-row"><input id="crClubQ" maxlength="120" autocomplete="off" placeholder="Teléfono o correo"><button type="button" class="btn-sm" id="crClubBtn">Buscar</button></span></label>
            <div id="crClubRes"></div>
          </div>
          <div class="cr-form">
            <label class="wide">Cliente<input id="crCliente" maxlength="80" autocomplete="off" placeholder="Nombre del cliente"></label>
            <label>Teléfono<input id="crTel" maxlength="20" inputmode="tel" autocomplete="off" placeholder="300 000 0000"></label>
            <label>Medio de pago<select id="crPago"><option>Efectivo</option><option>Transferencia</option></select></label>
            <label class="wide">Dirección<input id="crDir" maxlength="200" autocomplete="off" placeholder="Calle, número, barrio"></label>
            <label class="wide">Zona<select id="crZona"></select></label>
            <label class="wide" id="crDomWrap" hidden>Valor domicilio agencia<input id="crDom" type="number" min="0" step="500"></label>
            <label class="wide">Notas generales<textarea id="crNotas" maxlength="300" placeholder="Opcional"></textarea></label>
          </div>
          <h3 class="cr-h">Resumen</h3>
          <div class="cr-resumen" id="crResumen"></div>
          <div class="cr-total" id="crTotal"></div>
          <p class="error" id="crMsg"></p>
          <button id="crBtn" class="btn-primary cr-btn" type="button">Crear pedido</button>
        </div>
      </aside>
    </div>`;

  // combo: { 'hamburguesa|combo': unidades }. El combo es una opción de cada hamburguesa, no un producto suelto.
  // sab: { 'adicional|sabor': unidades } para adicionales con sabores (ej. gaseosas)
  const cr = { qty: {}, nota: {}, combo: {}, sab: {}, cuenta: null };
  const crSabs = (id) => Object.keys(cr.sab).filter((k) => k.split('|')[0] === id);
  const crElegidas = (id) => crSabs(id).reduce((s, k) => s + cr.sab[k], 0);
  const crCombos = () => SmashDB.getProducts({ soloActivos: true }).filter((p) => p.categoria === 'combo');
  const crEnCombo = (bid) => Object.keys(cr.combo).filter((k) => k.split('|')[0] === bid).reduce((s, k) => s + cr.combo[k], 0);
  function crZonas() {
    const z = SmashExt.getZones(), sel = $('crZona'), cur = sel.value;
    const html = Object.keys(z).map((k) => `<option value="${k}">${esc(z[k].nombre)}${z[k].variable ? ' — valor variable' : ' — ' + fmt(z[k].fee)}</option>`).join('');
    if (sel.dataset.h !== html) { sel.innerHTML = html; sel.dataset.h = html; if (cur) sel.value = cur; }
  }
  // Fotos: las del menú publicado (las mismas que ve el cliente) y, si no hay, las del panel
  const imgsMenu = {};
  SmashExt.loadMenu().then((m) => {
    if (!m) return;
    m.productos.forEach((p) => { if (p && p.id && p.img) imgsMenu[p.id] = p.img; });
    render();
  });
  const fotoProd = (p) => imgsMenu[p.id] || p.img || '';
  const nombreProd = (id) => { const p = SmashDB.getProductById(id); return p ? p.name : ''; };
  const nombres = (ids, y) => { const l = ids.map(nombreProd).filter(Boolean); return l.length < 2 ? l.join('') : l.slice(0, -1).join(', ') + (y || ' y ') + l[l.length - 1]; };
  // Promos de hoy encima de cada producto
  function tagsPromo(p) {
    const l = promosHoy().filter((x) => N.tocaProducto(x, p.id));
    if (!l.length) return '';
    return `<div class="cr-promos">${l.map((x) => {
      const cada = Math.max(1, Number(x.valor) || 1), esRegalo = x.tipo === 'regalo' && !N.prodsDe(x).includes(p.id);
      const txt = x.tipo === 'regalo'
        ? (esRegalo ? `Gratis por cada ${cada > 1 ? cada + ' burgers' : 'burger'}` : `Regala ${nombres(N.regalosDe(x), ' o ')}${cada > 1 ? ' por cada ' + cada + ' burgers' : ' por cada burger'}${x.sin_combo !== false ? ' (sin combo)' : ''}`)
        : (x.descripcion || '');
      return `<div class="cr-promo${x.tipo === 'regalo' ? ' gift' : ''}"><b>${x.tipo === 'regalo' ? '🎁' : '⭐'} ${esc(x.titulo)}</b>${txt ? `<span>${esc(txt)}</span>` : ''}</div>`;
    }).join('')}${cr.cuenta ? '' : '<small class="cr-promo-nota">Solo clientes del club: busca al cliente para aplicarla</small>'}</div>`;
  }

  function render() {
    if ($('dashboardSection') && $('dashboardSection').hidden) return;
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
        ${fotoProd(p) ? `<img src="${esc(fotoProd(p))}" alt="${esc(p.name)}" loading="lazy" onerror="smashImgFallback(this)">` : '<div class="cr-ph" aria-hidden="true">🍔</div>'}
        <div class="cr-info">${tagsPromo(p)}<b>${esc(p.name)}</b><small>${esc(p.desc || '')}</small><span class="cr-price">${fmt(p.price)}</span>
          <div class="qty-mini"><button type="button" data-cr="minus" data-id="${esc(p.id)}" aria-label="Menos">−</button><b>${q}</b><button type="button" data-cr="plus" data-id="${esc(p.id)}" aria-label="Más">+</button></div>
          ${combo}${sab}
          ${q ? `<input class="cr-note" data-id="${esc(p.id)}" maxlength="200" placeholder="Nota de este producto (sin cebolla, etc.)" value="${esc(cr.nota[p.id] || '')}">` : ''}
        </div></div>`;
    }).join('') || '<p class="hint">No hay productos activos.</p>';
    crTotal();
  }
  // Descuentos del club para este pedido (solo con un cliente registrado elegido)
  function crPromos(items) {
    if (!N || !cr.cuenta) return { descuento: 0, usadas: [], regalos: [] };
    return N.aplicarPromos(items, promosHoy());
  }
  function crTotal() {
    const items = crItems();
    const sub = items.reduce((s, i) => s + i.qty * i.price, 0);
    const R = crPromos(items), desc = R.descuento;
    const zk = $('crZona').value, z = SmashExt.getZones()[zk] || { fee: 0 };
    $('crDomWrap').hidden = !z.variable;
    const dom = z.variable ? (parseFloat($('crDom').value) || 0) : z.fee;
    const regalos = R.regalos.filter((g) => g.faltan > 0 || g.siguiente > 0).map((g) => {
      const activos = SmashDB.getProducts({ soloActivos: true }).map((p) => p.id);
      const ops = N.regalosDe(g.p).filter((id) => activos.includes(id));
      return g.faltan > 0
        ? `<div class="cr-li cr-gift"><span>🎁 <b>${esc(g.p.titulo)}:</b> le toca${g.faltan > 1 ? 'n ' + g.faltan : ' 1'} gratis. ${ops.length ? 'Agrega: ' + ops.map((id) => `<button type="button" class="btn-sm" data-crgift="${esc(id)}">+ ${esc(nombreProd(id))}</button>`).join(' ') : `(${esc(nombres(N.regalosDe(g.p), ' o ') || 'el regalo')} no está activo en Productos)`}</span><span>Gratis</span></div>`
        : `<div class="cr-li cr-gift off"><span>🎁 <b>${esc(g.p.titulo)}:</b> con ${g.siguiente} burger${g.siguiente > 1 ? 's' : ''} más le regalas ${esc(nombres(ops, ' o '))}</span><span>—</span></div>`;
    }).join('');
    $('crResumen').innerHTML = items.length
      ? items.map((i) => `<div class="cr-li"><span><b>${esc(i.qty)}×</b> ${esc(i.name)}${i.nota ? `<small>${esc(i.nota)}</small>` : ''}</span><span>${fmt(i.qty * i.price)}</span></div>`).join('') +
        R.usadas.map((u) => `<div class="cr-li cr-desc"><span>⭐ ${esc(u.titulo)}</span><span>−${fmt(u.valor)}</span></div>`).join('') + regalos
      : '<p class="cr-vacio">Aún no has elegido productos.</p>';
    $('crTotal').innerHTML = `<div><span>Subtotal</span><b>${fmt(sub)}</b></div>${desc ? `<div class="cr-desc"><span>Descuento club</span><b>−${fmt(desc)}</b></div>` : ''}<div><span>Domicilio</span><b>${z.variable && $('crDom').value === '' ? 'por definir' : fmt(dom)}</b></div><div class="tot"><span>Total</span><b>${fmt(sub - desc + dom)}</b></div>`;
  }
  $('crResumen').addEventListener('click', (e) => {
    const b = e.target.closest('[data-crgift]'); if (!b) return;
    const id = b.dataset.crgift; cr.qty[id] = Math.min(50, (cr.qty[id] || 0) + 1);
    render();
  });

  /* ---- Cliente del club: buscar por teléfono o correo ---- */
  function pintarClub(lista, msg) {
    const box = $('crClubRes');
    if (cr.cuenta) {
      const c = cr.cuenta;
      box.innerHTML = `<div class="cr-club-sel">⭐ <b>${esc(c.nombre || c.correo)}</b>${c.usuario ? ' @' + esc(c.usuario) : ''} · ${esc(c.puntos || 0)} pts <button type="button" class="btn-sm" data-club="quitar">Quitar</button></div>` +
        (promosHoy().length ? '' : `<small class="hint">${esc(promosMsg || 'Hoy no hay promociones gratuitas activas.')}</small>`);
      return;
    }
    box.innerHTML = (lista || []).map((c, i) => `<button type="button" class="cr-club-op" data-club="${i}"><b>${esc(c.nombre || c.correo)}</b><small>${esc([c.telefono, c.correo].filter(Boolean).join(' · '))} · ${esc(c.puntos || 0)} pts</small></button>`).join('') +
      (msg ? `<small class="${/✓/.test(msg) ? 'hint' : 'error'}">${esc(msg)}</small>` : '');
    box._lista = lista || [];
  }
  async function buscarClub() {
    const q = $('crClubQ').value.trim();
    if (!N) { pintarClub([], 'No hay conexión con la nube.'); return; }
    if (q.replace(/\D/g, '').length < 7 && !/@/.test(q) && q.length < 3) { pintarClub([], 'Escribe el teléfono (10 dígitos) o el correo.'); return; }
    pintarClub([], 'Buscando…');
    const r = await N.panelBuscarCliente(q);
    if (!r.ok) { pintarClub([], r.error); return; }
    if (!r.lista.length) { pintarClub([], 'No hay ningún cliente del club con ese teléfono o correo.'); return; }
    if (r.lista.length === 1) { elegirClub(r.lista[0]); return; }
    pintarClub(r.lista, 'Elige al cliente:');
  }
  function elegirClub(c) {
    cr.cuenta = c;
    // llena los datos que estén vacíos
    if (!$('crCliente').value.trim() && c.nombre) $('crCliente').value = c.nombre;
    if (!$('crTel').value.trim() && c.telefono) $('crTel').value = c.telefono;
    if (!$('crDir').value.trim() && c.direccion) $('crDir').value = c.direccion;
    pintarClub();
    cargarPromos(true);
    render();
  }
  $('crClubBtn').addEventListener('click', buscarClub);
  $('crClubQ').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarClub(); } });
  $('crClubRes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-club]'); if (!b) return;
    if (b.dataset.club === 'quitar') { cr.cuenta = null; $('crClubQ').value = ''; pintarClub(); render(); return; }
    const c = ($('crClubRes')._lista || [])[+b.dataset.club]; if (c) elegirClub(c);
  });
  if (!N) $('crClub').hidden = true;
  $('crProducts').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cr]'); if (!b) return;
    const id = b.dataset.id, q = cr.qty[id] || 0, act = b.dataset.cr;
    if (act === 'cplus' || act === 'cminus') {
      const k = id + '|' + b.dataset.c, n = cr.combo[k] || 0;
      if (act === 'cplus' && crEnCombo(id) < q) cr.combo[k] = n + 1;
      if (act === 'cminus') cr.combo[k] = Math.max(0, n - 1);
      render(); return;
    }
    if (act === 'splus' || act === 'sminus') {
      const p = SmashDB.getProductById(id), s = p && (p.sabores || [])[+b.dataset.s];
      if (!s) return;
      const k = id + '|' + s, n = cr.sab[k] || 0;
      if (act === 'splus' && crElegidas(id) < q) cr.sab[k] = n + 1;
      if (act === 'sminus') cr.sab[k] = Math.max(0, n - 1);
      render(); return;
    }
    cr.qty[id] = act === 'plus' ? Math.min(50, q + 1) : Math.max(0, q - 1);
    let sobraS = crElegidas(id) - (cr.qty[id] || 0);
    crSabs(id).reverse().forEach((k) => { const r = Math.min(cr.sab[k], Math.max(0, sobraS)); cr.sab[k] -= r; sobraS -= r; });
    if (!cr.qty[id]) delete cr.nota[id];
    // si quedan menos hamburguesas que combos, se quitan los combos que sobran
    let sobra = crEnCombo(id) - (cr.qty[id] || 0);
    Object.keys(cr.combo).filter((k) => k.split('|')[0] === id).forEach((k) => { const r = Math.min(cr.combo[k], Math.max(0, sobra)); cr.combo[k] -= r; sobra -= r; });
    render();
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
      if (p.categoria === 'hamburguesa') cs.forEach((c) => { const n = cr.combo[p.id + '|' + c.id] || 0; if (n) out.push({ id: c.id, name: c.name, price: c.price, qty: n, cat: 'combo', nota: 'Para ' + p.name, paraId: p.id }); });
    });
    return out;
  }
  $('crProducts').addEventListener('input', (e) => { if (e.target.classList.contains('cr-note')) { cr.nota[e.target.dataset.id] = e.target.value; crTotal(); } });
  ['crZona', 'crDom'].forEach((i) => $(i).addEventListener('input', crTotal));
  $('crBtn').addEventListener('click', () => {
    const msg = $('crMsg'); msg.className = 'error'; msg.textContent = '';
    const items = crItems();
    const cliente = $('crCliente').value.trim(), zk = $('crZona').value, z = SmashExt.getZones()[zk];
    if (!items.length) { msg.textContent = 'Elige al menos un producto.'; return; }
    if (!cliente) { msg.textContent = 'Escribe el nombre del cliente.'; $('crCliente').focus(); return; }
    if (!z) { msg.textContent = 'Elige la zona.'; return; }
    let dom = z.fee;
    if (z.variable) { const v = $('crDom').value; if (v === '' || !(parseFloat(v) >= 0)) { msg.textContent = 'Escribe el valor del domicilio de la agencia.'; $('crDom').focus(); return; } dom = parseFloat(v); }
    const R = crPromos(items);
    const res = SmashExt.addOrder({ cliente, telefono: $('crTel').value.trim(), direccion: $('crDir').value.trim(), items, notas: $('crNotas').value.trim(),
      zona: z.nombre, domicilio: dom, domicilioPendiente: false, pago: $('crPago').value, origen: 'cocina',
      descuento: R.descuento, descuentos: R.usadas, cuenta: cr.cuenta ? { usuario: cr.cuenta.usuario || '', correo: cr.cuenta.correo } : null });
    if (!res.ok) { msg.textContent = 'No se creó: era igual al pedido #' + num(res.order) + ' de hace unos minutos.'; return; }
    cr.qty = {}; cr.nota = {}; cr.combo = {}; cr.sab = {}; cr.cuenta = null; pintarClub();
    ['crCliente', 'crTel', 'crDir', 'crNotas', 'crDom', 'crClubQ'].forEach((i) => ($(i).value = ''));
    msg.className = 'ok-msg';
    msg.innerHTML = '✓ Pedido #' + esc(num(res.order)) + ' creado. Ya está en Pedidos. <button type="button" class="cr-ver" data-ver="' + esc(res.order.id) + '">Ver pedido</button>';
    render();
    try { cfg.alCrear(res.order); } catch (e) { console.warn(e); }
  });
  // "Ver pedido": va a Pedidos y abre su ficha
  $('crMsg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ver]'); if (!b) return;
    const nav = document.querySelector('.nav-btn[data-section="pendientes"]'); if (nav) nav.click();
    if (typeof SmashLista !== 'undefined') setTimeout(() => SmashLista.abrir(parseInt(b.dataset.ver, 10)), 50);
  });
  document.querySelectorAll('.nav-btn[data-section="crear"]').forEach((b) => b.addEventListener('click', () => { setTimeout(render, 0); cargarPromos(); }));

  return { init: (c) => { cfg = Object.assign(cfg, c); render(); cargarPromos(true); }, render };
})();
