/* ============================================================
   SMASH · leales-ui.js (caja y dueños)
   Clientes leales con cuenta en la nube (nube.js / Supabase):
   - "⭐ Clientes leales": lista con sus datos y puntos, historial,
     sumar o canjear puntos. Dueños: cambiar el rol de una cuenta.
   - "🎁 Promociones" (solo en el panel de dueños): crear, pausar,
     editar y borrar promociones para clientes con sesión.
   - Botón "⭐ Sumar puntos" de la tarjeta de pedido: verifica la cuenta
     y el descuento antes de sumar.
   Para entrar se usa una cuenta de la nube con rol caja o dueño.
   ============================================================ */
const SmashLealesUI = (function () {
  const N = typeof SmashNube !== 'undefined' ? SmashNube : null;
  const root = document.querySelector('#section-leales .leal-root');
  const proot = document.querySelector('#section-promos .promo-root');
  const esc = SmashUI.esc, fmt = SmashUI.fmt;
  const esDueno = !!document.getElementById('section-costos');
  const ROL = { cliente: 'Cliente', caja: 'Caja', dueno: 'Dueño' };
  const TIPO = { porcentaje: '% de descuento', valor: '$ de descuento', precio: 'Precio especial', regalo: '🎁 Regalo (lleva gratis)', incentivo: 'Incentivo (sin descuento automático)' };
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO') : '-');
  const fechaH = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  let yo = null, lista = [], promos = [], filtro = '', abierto = null, editando = null, cargando = false;
  const staff = () => !!yo && (yo.rol === 'caja' || yo.rol === 'dueno');
  const prodNombre = (id) => { const p = id && SmashDB.getProductById(id); return id ? (p ? p.name : id) : 'Todo el pedido'; };
  // "smash,toci" → "Smash y Smash Toci" (vacío = Todo el pedido)
  const prodsNombre = (v, y) => { const l = N.listaIds(v).map(prodNombre); return !l.length ? 'Todo el pedido' : l.length === 1 ? l[0] : l.slice(0, -1).join(', ') + (y || ' y ') + l[l.length - 1]; };

  /* ---------------- Conexión ---------------- */
  function loginHtml() {
    return `<div class="mod-box leal-login">
      <p>Entra con tu <b>cuenta de la nube</b> (la misma de la página de clientes) para ver los clientes leales.
      La cuenta debe tener rol <b>Caja</b> o <b>Dueño</b>.</p>
      <form class="leal-fin">
        <input type="email" name="correo" placeholder="Correo" autocomplete="email" required>
        <input type="password" name="clave" placeholder="Contraseña" autocomplete="current-password" required>
        <button type="submit" class="btn-primary">Conectar</button>
        <p class="error leal-msg"></p>
      </form>
      <p class="hint">¿Primera vez? Regístrate en la página de clientes con tu correo. Luego un dueño te da el rol desde aquí
      (o, para el primer dueño, se hace una sola vez en Supabase: ver LEEME.txt, "CLIENTES LEALES").</p>
    </div>`;
  }
  function cabecera() {
    return `<div class="leal-who">☁️ Conectado como <b>${esc(yo.nombre || yo.correo)}</b> <span class="rol-tag">${esc(ROL[yo.rol] || yo.rol)}</span>
      <button type="button" class="btn-sm" data-l="recargar">↻ Actualizar</button><button type="button" class="btn-sm" data-l="salir">Desconectar</button></div>`;
  }
  async function conectar(form) {
    const m = form.querySelector('.leal-msg'); m.textContent = 'Conectando…';
    const r = await N.entrar(form.correo.value, form.clave.value);
    if (!r.ok) { m.textContent = r.error; return; }
    await cargar();
  }
  async function cargar() {
    if (!N || !N.ok || cargando) return;
    cargando = true;
    try {
      yo = await N.perfil(true);
      if (staff()) {
        const r = await N.clientes();
        lista = r.ok ? r.lista : [];
        promos = await N.promociones(true);
      }
    } finally { cargando = false; }
    render();
  }

  /* ---------------- Clientes leales ---------------- */
  function renderLeales() {
    if (!root) return;
    if (!N || !N.ok) { root.innerHTML = '<p class="error">No se pudo cargar la conexión con la nube. Revisa el internet y recarga la página.</p>'; return; }
    if (!yo) { root.innerHTML = loginHtml(); return; }
    if (!staff()) { root.innerHTML = cabecera() + '<p class="error">Esta cuenta es de cliente: no tiene permiso para ver los clientes. Un dueño debe darle rol Caja o Dueño.</p>'; return; }
    const t = filtro.toLowerCase().trim();
    const ver = lista.filter((c) => !t || [c.usuario, c.nombre, c.telefono, c.telefono2, c.correo, c.direccion].join(' ').toLowerCase().includes(t));
    const clientes = lista.filter((c) => c.rol === 'cliente'), mes = new Date().toISOString().slice(0, 7);
    root.innerHTML = cabecera() + `
      <div class="summary-grid">
        <div class="summary-box"><div class="label">Clientes registrados</div><div class="value">${clientes.length}</div></div>
        <div class="summary-box"><div class="label">Nuevos este mes</div><div class="value">${clientes.filter((c) => String(c.creado).slice(0, 7) === mes).length}</div></div>
        <div class="summary-box"><div class="label">Puntos acumulados</div><div class="value">${clientes.reduce((s, c) => s + (c.puntos || 0), 0).toLocaleString('es-CO')}</div></div>
        <div class="summary-box"><div class="label">Promociones vigentes</div><div class="value">${promos.filter(N.vigente).length}</div></div>
      </div>
      <p class="hint">Puntos por pedido: hamburguesa 10 · hamburguesa en combo 15 · papas 2 · gaseosa 2 · salsa 1. Se suman solos cuando el pedido se marca como Entregado (si falla, queda el botón "⭐ Sumar puntos").</p>
      <div class="date-row"><input type="search" class="leal-q" placeholder="Buscar por usuario, nombre, teléfono, correo o dirección" value="${esc(filtro)}"></div>
      <table class="rtable leal-tabla"><thead><tr><th>Usuario</th><th>Nombre</th><th>Teléfono</th><th>Tel. ref.</th><th>Correo</th><th>Dirección</th><th>Puntos</th><th>Registro</th><th></th></tr></thead><tbody>
      ${ver.map((c) => `<tr>
        <td class="first">@${esc(c.usuario || '-')}${c.rol !== 'cliente' ? ` <span class="rol-tag">${esc(ROL[c.rol])}</span>` : ''}</td>
        <td data-l="Nombre">${esc(c.nombre)}</td>
        <td data-l="Teléfono">${c.telefono ? `<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : '-'}</td>
        <td data-l="Tel. ref.">${esc(c.telefono2 || '-')}</td>
        <td data-l="Correo">${esc(c.correo)}</td>
        <td data-l="Dirección">${esc(c.direccion || '-')}</td>
        <td data-l="Puntos"><b>${c.puntos || 0}</b></td>
        <td data-l="Registro">${esc(fecha(c.creado))}</td>
        <td class="full"><div class="leal-acts">
          <button type="button" class="btn-sm" data-l="hist" data-id="${esc(c.id)}">${abierto === c.id ? 'Ocultar' : 'Historial'}</button>
          <button type="button" class="btn-sm" data-l="pts" data-id="${esc(c.id)}">± Puntos</button>
          ${esDueno && yo.rol === 'dueno' && c.id !== yo.id ? `<select class="leal-rol" data-id="${esc(c.id)}" aria-label="Rol de ${esc(c.usuario || c.correo)}">${Object.keys(ROL).map((r) => `<option value="${r}"${c.rol === r ? ' selected' : ''}>${ROL[r]}</option>`).join('')}</select>` : ''}
        </div></td></tr>
        ${abierto === c.id ? `<tr class="leal-hist"><td class="full" colspan="9" id="hist_${esc(c.id)}">Cargando historial…</td></tr>` : ''}`).join('') || '<tr><td colspan="9" style="text-align:center;color:var(--muted)">No hay cuentas que coincidan.</td></tr>'}
      </tbody></table>`;
    if (abierto) N.movimientos(abierto).then((m) => {
      const el = document.getElementById('hist_' + abierto);
      if (el) el.innerHTML = m.length ? m.map((x) => `<div class="leal-mov"><b class="${x.puntos > 0 ? 'pos' : 'neg'}">${x.puntos > 0 ? '+' : ''}${x.puntos}</b> ${esc(x.motivo)}${x.pedido ? ` <span class="hint">(${esc(x.pedido)})</span>` : ''} <span class="hint">· ${esc(fechaH(x.creado))}</span></div>`).join('') : '<span class="hint">Sin movimientos todavía.</span>';
    });
  }

  /* ---------------- Promociones (solo dueños) ---------------- */
  const finDeMes = () => { const h = N.hoyCO(), d = new Date(+h.slice(0, 4), +h.slice(5, 7), 0); return h.slice(0, 8) + String(d.getDate()).padStart(2, '0'); };
  function estado(p) {
    const h = N.hoyCO();
    if (!p.activa) return ['Pausada', 'off'];
    if (p.hasta < h) return ['Vencida', 'off'];
    if (p.desde > h) return ['Programada', 'prog'];
    if (!N.tocaHoy(p)) return ['Hoy no aplica', 'prog'];
    return ['Vigente', 'on'];
  }
  function detalle(p) {
    if (p.tipo === 'regalo') {
      const c = Math.max(1, Number(p.valor) || 1);
      return `🎁 ${prodsNombre(p.regalo, ' o ')} gratis por cada ${c > 1 ? c + ' de ' : ''}${prodsNombre(p.producto, ' o ')}${p.sin_combo !== false ? ' (sin contar combos)' : ''}`;
    }
    const v = p.tipo === 'porcentaje' ? p.valor + '% de descuento' : p.tipo === 'valor' ? fmt(p.valor) + ' de descuento' : p.tipo === 'precio' ? 'precio especial ' + fmt(p.valor) : 'incentivo';
    return v + (p.tipo === 'incentivo' ? (p.producto ? ' · ' + prodsNombre(p.producto) : '') : ' · ' + prodsNombre(p.producto)) + (p.tipo === 'valor' && !p.producto ? ' (una vez por pedido)' : p.producto && p.tipo !== 'incentivo' ? ' (por unidad)' : '');
  }
  // Campos de una promoción (se usan en "Nueva promoción" y en la ventana de editar)
  function camposPromo(e) {
    const dsel = (e.dias || []).map(Number);
    const prods = SmashDB.getProducts().filter((p) => p.categoria !== 'combo');
    const psel = N.listaIds(e.producto), rsel = N.listaIds(e.regalo);
    const chips = (name, sel) => prods.map((p) => `<label class="dia-chip prod-chip"><input type="checkbox" name="${name}" value="${esc(p.id)}"${sel.includes(p.id) ? ' checked' : ''}><span>${esc(p.name)}</span></label>`).join('');
    return `
        <label>Nombre<input name="titulo" maxlength="80" required value="${esc(e.titulo)}" placeholder="Ej: Martes de Smash Toci"></label>
        <label>Descripción para el cliente<input name="descripcion" maxlength="300" value="${esc(e.descripcion)}" placeholder="Ej: 20% en tu Smash Toci todos los martes"></label>
        <label>Tipo<select name="tipo">${Object.keys(TIPO).map((k) => `<option value="${k}"${e.tipo === k ? ' selected' : ''}>${TIPO[k]}</option>`).join('')}</select></label>
        <fieldset class="promo-dias promo-prods"><legend><span class="pp-leg">Productos de la promo</span> <small class="hint pp-ayuda"></small></legend>
          <div class="dias-chips">${chips('producto', psel)}</div>
          <div class="pp-btns"><button type="button" class="btn-sm" data-pp="burgers">🍔 Marcar todas las burgers</button><button type="button" class="btn-sm" data-pp="ninguno">Quitar todos</button></div>
        </fieldset>
        <fieldset class="promo-dias promo-regalo"><legend>Producto de regalo <small class="hint">(si marcas varios, el cliente elige cuál)</small></legend>
          <div class="dias-chips">${chips('regalo', rsel)}</div>
          <label class="chk"><input type="checkbox" name="sin_combo"${e.sin_combo !== false ? ' checked' : ''}> Las burgers pedidas en combo no cuentan</label>
        </fieldset>
        <label class="promo-valor"><span><span class="pv-leg">Valor</span> <small class="hint promo-ayuda"></small></span><input name="valor" type="number" min="0" step="1" value="${esc(e.tipo === 'regalo' ? Math.max(1, Number(e.valor) || 1) : e.valor)}"></label>
        <label class="promo-pts">Precio en puntos <small class="hint">(0 = gratis para clientes registrados. Si cuesta puntos, al enviar el pedido se le descuentan solos; si no le alcanzan, compra sin la promo)</small><input name="puntos" type="number" min="0" max="100000" step="1" value="${esc(e.puntos || 0)}" data-col="${e.puntos !== undefined ? 1 : 0}"></label>
        <div class="two-col">
          <label>Desde<input name="desde" type="date" required value="${esc(e.desde)}"></label>
          <label>Hasta<input name="hasta" type="date" required value="${esc(e.hasta)}"></label>
        </div>
        <fieldset class="promo-dias"><legend>Días de la semana <small class="hint">(sin marcar = todos los días)</small></legend>
          <div class="dias-chips">${[1, 2, 3, 4, 5, 6, 0].map((i) => `<label class="dia-chip"><input type="checkbox" name="dia" value="${i}"${dsel.includes(i) ? ' checked' : ''}><span>${N.DIAS[i].slice(0, 3)}</span></label>`).join('')}</div>
          <small class="hint">Se repite cada semana dentro de las fechas. Ej: marca solo Mar para una promo de todos los martes.</small>
        </fieldset>
        <label class="chk"><input type="checkbox" name="activa"${e.activa !== false ? ' checked' : ''}> Activa</label>`;
  }
  const marcados = (f, n) => [...f.querySelectorAll(`input[name=${n}]:checked`)].map((x) => x.value);
  const leerPromo = (f, id) => ({ id, titulo: f.titulo.value, descripcion: f.descripcion.value, tipo: f.tipo.value, producto: marcados(f, 'producto'), valor: f.tipo.value === 'incentivo' ? 0 : f.valor.value,
    regalo: marcados(f, 'regalo'), sin_combo: !!(f.sin_combo && f.sin_combo.checked),
    desde: f.desde.value, hasta: f.hasta.value, activa: f.activa.checked, dias: [...f.querySelectorAll("input[name=dia]:checked")].map((x) => +x.value),
    puntos: f.puntos ? f.puntos.value : 0, conPuntos: !!(f.puntos && f.puntos.dataset.col === "1") });

  function tarjetaPromo(p) {
    const st = estado(p);
    return `<div class="promo-card ${st[1]}" data-l="pedit" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="Editar promoción ${esc(p.titulo)}">
      <div class="row"><b>${esc(p.titulo)}</b><span class="promo-st ${st[1]}">${st[0]}</span></div>
      ${p.descripcion ? `<div class="promo-desc">${esc(p.descripcion)}</div>` : ''}
      <div class="promo-det">🏷️ ${esc(detalle(p))}${Number(p.puntos) > 0 ? ` · <b class="promo-pts-tag">⭐ ${esc(p.puntos)} pts</b>` : ""}</div>
      <div class="promo-fechas">📅 ${esc(N.textoDias(p))} · del ${esc(p.desde)} al ${esc(p.hasta)}</div>
      <span class="promo-edit">✏️ Toca para editar</span>
    </div>`;
  }

  function renderPromos() {
    if (!proot) return;
    if (!N || !N.ok) { proot.innerHTML = '<p class="error">No se pudo cargar la conexión con la nube.</p>'; return; }
    if (!yo) { proot.innerHTML = loginHtml(); return; }
    if (yo.rol !== 'dueno') { proot.innerHTML = cabecera() + '<p class="error">Solo las cuentas con rol Dueño pueden crear o cambiar promociones.</p>'; return; }
    // no borrar lo que se está escribiendo en "Nueva promoción"
    const fViejo = document.getElementById('promoForm');
    const borrador = fViejo && fViejo.contains(document.activeElement) ? leerPromo(fViejo) : null;
    const e = borrador || { tipo: 'porcentaje', producto: '', valor: '', desde: N.hoyCO(), hasta: finDeMes(), activa: true, titulo: '', descripcion: '', dias: [] };
    const vig = promos.filter((p) => estado(p)[1] === 'on').length;
    proot.innerHTML = cabecera() + `
      <p class="hint">Las promociones solo las ven y las usan los clientes que iniciaron sesión con su cuenta. Se activan al instante: no hace falta publicar el menu.json.
      Si un producto tiene varias promociones se aplica la mejor; de las de "todo el pedido" se aplica una.</p>
      <div class="promo-layout">
        <form class="mod-box promo-form" id="promoForm">
          <h3 class="promo-h">Nueva promoción</h3>
          ${camposPromo(e)}
          <p class="error" id="promoMsg"></p>
          <button type="submit" class="btn-primary">Crear promoción</button>
        </form>
        <div class="promo-col">
          <div class="promo-col-head"><h3 class="promo-h">Promociones creadas</h3><span class="hint">${promos.length} en total · ${vig} vigente${vig === 1 ? '' : 's'} hoy</span></div>
          <div class="promo-lista">${promos.map(tarjetaPromo).join('') || '<div class="ol-empty"><b>Todavía no hay promociones</b><span>Crea la primera con el formulario.</span></div>'}</div>
        </div>
      </div>`;
    ayudaValor(document.getElementById('promoForm'));
  }
  function ayudaValor(f) {
    if (!f || !f.tipo) return;
    const t = f.tipo.value;
    f.querySelector('.promo-ayuda').textContent = t === 'porcentaje' ? '(porcentaje, de 1 a 100)' : t === 'valor' ? '(pesos que se descuentan)' : t === 'precio' ? '(precio final en pesos, marca uno o varios productos)' : t === 'regalo' ? 'productos marcados (1 = uno por cada burger · 2 = uno por cada 2 burgers)' : '(no se usa: el incentivo solo se muestra al cliente)';
    f.querySelector('.pv-leg').textContent = t === 'regalo' ? '1 regalo por cada' : 'Valor';
    f.querySelector('.promo-valor').hidden = t === 'incentivo';
    f.querySelector('.promo-regalo').hidden = t !== 'regalo';
    f.querySelector('.pp-leg').textContent = t === 'regalo' ? 'Productos que dan el regalo' : 'Productos de la promo';
    f.querySelector('.pp-ayuda').textContent = t === 'regalo' ? '(marca las burgers que cuentan)' : t === 'incentivo' ? '(la promo se muestra encima de estos productos)' : '(sin marcar = todo el pedido)';
    if (t === 'regalo' && !(Number(f.valor.value) >= 1)) f.valor.value = 1;
  }

  // Ventana para editar una promoción: guardar, pausar/activar o borrar. Se cierra sola al guardar.
  function editarPromo(p) {
    const st = estado(p);
    const m = SmashUI.modal('Editar promoción', `
      <div class="promo-modal-st"><span class="promo-st ${st[1]}">${st[0]}</span><span class="hint">${esc(detalle(p))}</span></div>
      <form class="promo-form" id="promoEditForm">${camposPromo(p)}</form>
      <div class="promo-modal-acts">
        <button type="button" class="btn-secondary" data-pm="toggle">${p.activa ? '⏸ Pausar' : '▶ Activar'}</button>
        <button type="button" class="btn-sm" data-pm="del">🗑 Borrar promoción</button>
      </div>
      <p class="error" id="promoEditMsg"></p>`, () => { guardarEdicion(); return false; }, 'Guardar cambios');
    m.querySelector('.sm-box').classList.add('wide');
    const f = m.querySelector('#promoEditForm'), msg = m.querySelector('#promoEditMsg');
    ayudaValor(f);
    f.addEventListener('change', (ev) => { if (ev.target.name === 'tipo') ayudaValor(f); });
    f.addEventListener('click', marcarProds);
    f.addEventListener('submit', (ev) => { ev.preventDefault(); guardarEdicion(); });
    let ocupado = false;
    async function hecho(r2) {
      if (!r2.ok) { msg.className = 'error'; msg.textContent = r2.error; ocupado = false; return; }
      SmashUI.closeModal();
      promos = await N.promociones(true); renderPromos();
    }
    async function guardarEdicion() {
      if (ocupado) return;
      if (!f.reportValidity()) return;
      ocupado = true; msg.className = 'hint'; msg.textContent = 'Guardando…';
      hecho(await N.guardarPromo(leerPromo(f, p.id)));
    }
    m.addEventListener('click', async (ev) => {
      const b = ev.target.closest('[data-pm]'); if (!b || ocupado) return;
      if (b.dataset.pm === 'toggle') { ocupado = true; hecho(await N.activarPromo(p.id, !p.activa)); }
      if (b.dataset.pm === 'del') {
        if (!confirm(`¿Borrar la promoción "${p.titulo}"? Los clientes dejarán de verla. (Para quitarla por un tiempo usa "Pausar".)`)) return;
        ocupado = true; hecho(await N.borrarPromo(p.id));
      }
    });
    setTimeout(() => f.titulo.focus(), 50);
  }

  // Botones "Marcar todas las burgers" / "Quitar todos"
  function marcarProds(ev) {
    const b = ev.target.closest && ev.target.closest('[data-pp]'); if (!b) return;
    b.closest('.promo-prods').querySelectorAll('input[name=producto]').forEach((x) => { const p = SmashDB.getProductById(x.value); x.checked = b.dataset.pp === 'burgers' && !!p && p.categoria === 'hamburguesa'; });
  }
  function render() { renderLeales(); renderPromos(); }

  /* ---------------- Eventos ---------------- */
  [root, proot].forEach((r) => {
    if (!r) return;
    r.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (e.target.classList.contains('leal-fin')) return conectar(e.target);
      if (e.target.id === 'promoForm') {
        const f = e.target, m = document.getElementById('promoMsg');
        m.className = 'error'; m.textContent = 'Guardando…';
        const r2 = await N.guardarPromo(leerPromo(f));   // este formulario siempre crea una nueva
        if (!r2.ok) { m.textContent = r2.error; return; }
        if (document.activeElement && f.contains(document.activeElement)) document.activeElement.blur();
        promos = await N.promociones(true); renderPromos();
        const ok = document.getElementById('promoMsg'); if (ok) { ok.className = 'ok-msg'; ok.textContent = '✓ Promoción creada.'; }
      }
    });
    if (r === proot) r.addEventListener('click', marcarProds);
    r.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('promo-card')) { e.preventDefault(); e.target.click(); }
    });
    r.addEventListener('input', (e) => {
      if (e.target.classList.contains('leal-q')) { filtro = e.target.value; const pos = e.target.selectionStart; renderLeales(); const q = root.querySelector('.leal-q'); q.focus(); q.setSelectionRange(pos, pos); }
    });
    r.addEventListener('change', async (e) => {
      if (e.target.name === 'tipo' && e.target.form && e.target.form.id === 'promoForm') ayudaValor(e.target.form);
      if (e.target.classList.contains('leal-rol')) {
        const c = lista.find((x) => x.id === e.target.dataset.id), rol = e.target.value;
        if (!c || !confirm(`¿Dar rol "${ROL[rol]}" a ${c.nombre || c.correo}?${rol !== 'cliente' ? ' Podrá ver los datos de todos los clientes.' : ''}`)) { renderLeales(); return; }
        const r2 = await N.cambiarRol(c.id, rol);
        if (!r2.ok) alert(r2.error);
        await cargar();
      }
    });
    r.addEventListener('click', async (e) => {
      const b = e.target.closest('[data-l]'); if (!b) return;
      const id = b.dataset.id, act = b.dataset.l;
      if (act === 'salir') { await N.salir(); yo = null; lista = []; promos = []; render(); }
      else if (act === 'recargar') await cargar();
      else if (act === 'hist') { abierto = abierto === id ? null : id; renderLeales(); }
      else if (act === 'pts') {
        const c = lista.find((x) => x.id === id); if (!c) return;
        const v = parseInt(prompt(`Puntos para ${c.nombre || c.correo} (tiene ${c.puntos || 0}).\nEscribe un número positivo para sumar o negativo para canjear (ej: -50):`, ''), 10);
        if (!v) return;
        const motivo = prompt('Motivo (ej: canje de una gaseosa, bono de cumpleaños):', v < 0 ? 'Canje de puntos' : 'Puntos de regalo');
        if (motivo == null) return;
        const r2 = await N.sumarPuntos(id, v, motivo, '');
        if (!r2.ok) alert(r2.error);
        await cargar();
      } else if (act === 'pedit') { const p = promos.find((x) => String(x.id) === id); if (p) editarPromo(p); }
      else if (act === 'ptoggle') { const p = promos.find((x) => String(x.id) === id); const r2 = await N.activarPromo(p.id, !p.activa); if (!r2.ok) alert(r2.error); promos = await N.promociones(true); renderPromos(); }
      else if (act === 'pdel') {
        const p = promos.find((x) => String(x.id) === id);
        if (!confirm(`¿Borrar la promoción "${p.titulo}"? Los clientes dejarán de verla. (Para quitarla por un tiempo usa "Pausar".)`)) return;
        const r2 = await N.borrarPromo(p.id); if (!r2.ok) alert(r2.error); promos = await N.promociones(true); renderPromos();
      }
    });
  });
  if (N && N.ok) N.alCambiar(() => cargar());

  /* ---------------- Puntos de un pedido (botón de la tarjeta) ---------------- */
  async function sumarDePedido(o, refrescar) {
    if (!N || !N.ok) { alert('No hay conexión con la nube. Revisa el internet.'); return; }
    if (!staff()) { await cargar(); }
    if (!staff()) { alert('Para sumar puntos conecta una cuenta de la nube con rol Caja o Dueño en "⭐ Clientes leales".'); return; }
    const c = await N.buscarPorCorreo(o.cuenta.correo);
    if (!c) { alert(`⚠ No existe ninguna cuenta con el correo ${o.cuenta.correo}. No se suman puntos.${o.descuento ? '\nEste pedido trae un descuento de ' + fmt(o.descuento) + ': edítalo o confirma con el cliente antes de cobrarlo.' : ''}`); return; }
    if (o.descuento) {
      const real = N.aplicarPromos(o.items, await N.promociones(true)).descuento;
      if (o.descuento > real && !confirm(`⚠ El pedido trae un descuento de ${fmt(o.descuento)}, pero las promociones vigentes dan ${fmt(real)}.\nRevisa el cobro antes de entregarlo. ¿Sumar los puntos de todas formas?`)) return;
    }
    const pts = N.puntosPedido(o.items, SmashDB.getProductById);
    if (!pts) { alert('Este pedido no tiene productos que sumen puntos.'); return; }
    if (!confirm(`¿Sumar ${pts} puntos a ${c.nombre || c.correo} (@${c.usuario || '-'})? Hoy tiene ${c.puntos || 0}.`)) return;
    const r = await N.sumarPuntos(c.id, pts, 'Pedido #' + (o.numeroDia || o.id), o.ref || 'pedido-' + o.id);
    if (!r.ok && !/ya se habían sumado/.test(r.error)) { alert(r.error); return; }
    SmashExt.updateOrder(o.id, { puntosSumados: r.ok ? pts : (o.puntosSumados || pts), puntosEn: new Date().toISOString(), puntosAviso: '' });
    if (r.ok) alert(`✓ ${pts} puntos sumados. Ahora tiene ${r.total}.`); else alert(r.error);
    if (refrescar) refrescar();
    if (root && staff()) cargar();
  }

  /* ---------------- Puntos automáticos al entregar ----------------
     Cuando un pedido de un cliente con cuenta pasa a "Entregado" (en cocina o dueños)
     los puntos se suman solos, sin preguntar. La nube no deja sumar dos veces el
     mismo pedido, así que no importa si varios equipos lo intentan a la vez.
     Si no se puede (sin cuenta de caja conectada, correo inexistente…) la tarjeta
     muestra el motivo y queda el botón "⭐ Sumar puntos" para hacerlo a mano. */
  const enCurso = new Set();
  const avisar = (o, txt) => { if (o.puntosAviso !== txt) SmashExt.updateOrder(o.id, { puntosAviso: txt }); };
  async function autoPuntos(o) {
    if (!o || !o.cuenta || !o.cuenta.correo || o.puntosSumados || o.status !== 'entregado' || o.puntosSinAuto) return;
    if (enCurso.has(o.id) || !N || !N.ok) return;
    enCurso.add(o.id);
    try {
      const pts = N.puntosPedido(o.items, SmashDB.getProductById);
      if (!pts) { SmashExt.updateOrder(o.id, { puntosSinAuto: true, puntosAviso: 'Este pedido no tiene productos que sumen puntos.' }); return; }
      const motivo = 'Pedido #' + (o.numeroDia || o.id), ref = o.ref || 'pedido-' + o.id;
      // 1) Con la llave del panel (la misma con la que el equipo entra a la nube): no hace falta otra cuenta
      if (N.panelSesion && N.panelSesion() && N.panelSumarPuntos) {
        const r = await N.panelSumarPuntos(o.cuenta.correo, pts, motivo, ref);
        if (r.ok || r.repetido) {
          SmashExt.updateOrder(o.id, { puntosSumados: pts, puntosEn: new Date().toISOString(), puntosAviso: '' });
          if (r.ok && typeof SmashUI !== 'undefined' && SmashUI.toast) SmashUI.toast(`⭐ +${pts} puntos para ${r.nombre || '@' + (r.usuario || o.cuenta.correo)}`);
          return;
        }
        if (r.sinCuenta) { SmashExt.updateOrder(o.id, { puntosSinAuto: true, puntosAviso: `No existe ninguna cuenta con el correo ${o.cuenta.correo}: no se sumaron puntos.` }); return; }
        if (!r.falta && r.error !== 'sin-acceso') { avisar(o, 'No se pudieron sumar los puntos: ' + r.error + '. Se reintenta solo.'); return; }
        // si falta el SQL nuevo o la llave venció, se intenta con la cuenta de caja (forma anterior)
      }
      if (!staff()) await cargar();
      if (!staff()) { avisar(o, 'Puntos pendientes: falta ejecutar supabase/puntos-y-canjes.sql en Supabase (o conectar la cuenta de caja en "⭐ Clientes leales"). Se suman solos después.'); return; }
      const c = await N.buscarPorCorreo(o.cuenta.correo);
      if (!c) { SmashExt.updateOrder(o.id, { puntosSinAuto: true, puntosAviso: `No existe ninguna cuenta con el correo ${o.cuenta.correo}: no se sumaron puntos.` }); return; }
      const r = await N.sumarPuntos(c.id, pts, motivo, ref);
      if (!r.ok && !/ya se habían sumado/.test(r.error)) { avisar(o, 'No se pudieron sumar los puntos: ' + r.error); return; }
      SmashExt.updateOrder(o.id, { puntosSumados: pts, puntosEn: new Date().toISOString(), puntosAviso: '' });
      if (typeof SmashUI !== 'undefined' && SmashUI.toast) SmashUI.toast(`⭐ +${pts} puntos para ${c.nombre || '@' + (c.usuario || c.correo)}`);
      if (root && staff()) cargar();
    } catch (e) {
      avisar(o, 'No se pudieron sumar los puntos (sin internet). Se reintenta solo.');
    } finally { enCurso.delete(o.id); }
  }
  /* Pedido cancelado que había pagado una promoción con puntos: se le devuelven
     los puntos al cliente (la nube no los devuelve dos veces). */
  async function devolverCanje(o) {
    if (!o || o.status !== 'cancelado' || !o.canjes || !o.canjes.length || o.puntosDevueltos != null || !o.ref) return;
    if (enCurso.has('dev' + o.id) || !N || !N.ok || !N.panelDevolverCanje || !(N.panelSesion && N.panelSesion())) return;
    enCurso.add('dev' + o.id);
    try {
      const r = await N.panelDevolverCanje(o.ref);
      if (r.ok) {
        const pts = o.canjes.reduce((s, c) => s + (Number(c.puntos) || 0), 0);
        SmashExt.updateOrder(o.id, { puntosDevueltos: r.devueltos || pts });
        if (r.devueltos && typeof SmashUI !== 'undefined' && SmashUI.toast) SmashUI.toast(`↩ ${r.devueltos} puntos devueltos por el pedido cancelado`);
      }
    } catch (e) { /* se reintenta en la próxima revisión */ } finally { enCurso.delete('dev' + o.id); }
  }
  // Revisa los pedidos entregados de los últimos 7 días que aún no tienen puntos
  // (y los cancelados que habían pagado con puntos)
  function revisarEntregados() {
    const desde = Date.now() - 7 * 864e5;
    SmashDB.getOrders().forEach((o) => {
      if (new Date(o.entregadoEn || o.canceladoEn || o.creado).getTime() < desde) return;
      if (o.status === 'entregado' && o.cuenta && !o.puntosSumados && !o.puntosSinAuto) autoPuntos(o);
      else if (o.status === 'cancelado') devolverCanje(o);
    });
  }
  const _setStatus = SmashExt.setStatus;
  SmashExt.setStatus = function (id, status) {
    const r = _setStatus.apply(this, arguments);
    if (r && status === 'entregado') setTimeout(() => autoPuntos(SmashDB.getOrderById(id)), 0);
    return r;
  };
  setTimeout(revisarEntregados, 4000);
  setInterval(revisarEntregados, 60000);

  if (N && N.ok) cargar(); else render();
  return { render, cargar, sumarDePedido, autoPuntos, revisarEntregados };
})();
