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
  const TIPO = { porcentaje: '% de descuento', valor: '$ de descuento', precio: 'Precio especial', incentivo: 'Incentivo (sin descuento automático)' };
  const fecha = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO') : '-');
  const fechaH = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '-');
  let yo = null, lista = [], promos = [], filtro = '', abierto = null, editando = null, cargando = false;
  const staff = () => !!yo && (yo.rol === 'caja' || yo.rol === 'dueno');
  const prodNombre = (id) => { const p = id && SmashDB.getProductById(id); return id ? (p ? p.name : id) : 'Todo el pedido'; };

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
      <p class="hint">Puntos por pedido: hamburguesa 10 · hamburguesa en combo 15 · papas 2 · gaseosa 2 · salsa 1. Se suman con el botón "⭐ Sumar puntos" del pedido.</p>
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
    const v = p.tipo === 'porcentaje' ? p.valor + '% de descuento' : p.tipo === 'valor' ? fmt(p.valor) + ' de descuento' : p.tipo === 'precio' ? 'precio especial ' + fmt(p.valor) : 'incentivo';
    return v + (p.tipo === 'incentivo' ? '' : ' · ' + prodNombre(p.producto)) + (p.tipo === 'valor' && !p.producto ? ' (una vez por pedido)' : p.producto && p.tipo !== 'incentivo' ? ' (por unidad)' : '');
  }
  // Campos de una promoción (se usan en "Nueva promoción" y en la ventana de editar)
  function camposPromo(e) {
    const dsel = (e.dias || []).map(Number);
    const prods = SmashDB.getProducts();
    return `
        <label>Nombre<input name="titulo" maxlength="80" required value="${esc(e.titulo)}" placeholder="Ej: Martes de Smash Toci"></label>
        <label>Descripción para el cliente<input name="descripcion" maxlength="300" value="${esc(e.descripcion)}" placeholder="Ej: 20% en tu Smash Toci todos los martes"></label>
        <div class="two-col">
          <label>Tipo<select name="tipo">${Object.keys(TIPO).map((k) => `<option value="${k}"${e.tipo === k ? ' selected' : ''}>${TIPO[k]}</option>`).join('')}</select></label>
          <label>Producto<select name="producto"><option value="">Todo el pedido</option>${prods.map((p) => `<option value="${esc(p.id)}"${e.producto === p.id ? ' selected' : ''}>${esc(p.name)}${p.categoria === 'combo' ? ' (combo)' : ''}</option>`).join('')}</select></label>
        </div>
        <label class="promo-valor">Valor <small class="hint promo-ayuda"></small><input name="valor" type="number" min="0" step="1" value="${esc(e.valor)}"></label>
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
  const leerPromo = (f, id) => ({ id, titulo: f.titulo.value, descripcion: f.descripcion.value, tipo: f.tipo.value, producto: f.producto.value, valor: f.tipo.value === 'incentivo' ? 0 : f.valor.value,
    desde: f.desde.value, hasta: f.hasta.value, activa: f.activa.checked, dias: [...f.querySelectorAll('input[name=dia]:checked')].map((x) => +x.value) });

  function tarjetaPromo(p) {
    const st = estado(p);
    return `<div class="promo-card ${st[1]}" data-l="pedit" data-id="${esc(p.id)}" role="button" tabindex="0" aria-label="Editar promoción ${esc(p.titulo)}">
      <div class="row"><b>${esc(p.titulo)}</b><span class="promo-st ${st[1]}">${st[0]}</span></div>
      ${p.descripcion ? `<div class="promo-desc">${esc(p.descripcion)}</div>` : ''}
      <div class="promo-det">🏷️ ${esc(detalle(p))}</div>
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
    f.querySelector('.promo-ayuda').textContent = t === 'porcentaje' ? '(porcentaje, de 1 a 100)' : t === 'valor' ? '(pesos que se descuentan)' : t === 'precio' ? '(precio final en pesos, elige un producto)' : '(no se usa: el incentivo solo se muestra al cliente)';
    f.querySelector('.promo-valor').hidden = t === 'incentivo';
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
    SmashExt.updateOrder(o.id, { puntosSumados: r.ok ? pts : (o.puntosSumados || pts), puntosEn: new Date().toISOString() });
    if (r.ok) alert(`✓ ${pts} puntos sumados. Ahora tiene ${r.total}.`); else alert(r.error);
    if (refrescar) refrescar();
    if (root && staff()) cargar();
  }

  if (N && N.ok) cargar(); else render();
  return { render, cargar, sumarDePedido };
})();
