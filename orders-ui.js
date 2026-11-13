/* ============================================================
   SMASH · orders-ui.js
   Parte compartida por cocina.html y dueno.html:
   tarjeta de pedido con cronómetro, editar pedido, repartidor,
   valor de domicilio (zona "Otros") y resumen de caja diaria.
   ============================================================ */
const SmashUI = (function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => '$' + Math.round(n || 0).toLocaleString('es-CO');
  const num = (o) => o.numeroDia || o.id;
  const C = SmashComandas, NEXT = C.NEXT, NEXT_LABEL = C.NEXT_LABEL;
  const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '');
  let cfg = { who: 'cocina', refresh() {}, print() {}, pdf() {} };

  /* ---------- cronómetro mm:ss ---------- */
  const fmtMs = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  };
  const cls = (ms, done) => 'timer ' + (done ? 'done' : ms < 15 * 60000 ? 'ok' : ms < 25 * 60000 ? 'warn' : 'late');
  // una reserva cuenta desde que abre la cocina, no desde la noche anterior
  const inicio = (o) => (SmashExt.inicioPedido ? SmashExt.inicioPedido(o) : o.creado);
  function timerHtml(o) {
    const ms = (o.entregadoEn ? new Date(o.entregadoEn).getTime() : Date.now()) - new Date(inicio(o)).getTime();
    return `<span class="${cls(ms, !!o.entregadoEn)}" data-since="${esc(inicio(o))}" data-until="${esc(o.entregadoEn || '')}">⏱ ${fmtMs(ms)}</span>`;
  }
  function tick() {
    document.querySelectorAll('.timer[data-since]').forEach((el) => {
      const ms = (el.dataset.until ? new Date(el.dataset.until).getTime() : Date.now()) - new Date(el.dataset.since).getTime();
      el.textContent = '⏱ ' + fmtMs(ms);
      el.className = cls(ms, !!el.dataset.until);
    });
  }
  setInterval(tick, 1000);

  /* ---------- pedido repetido y promociones pagadas con puntos ---------- */
  let repCache = { t: 0, g: [] };
  function repetidos(o) {
    if (!o || !o.ref || !SmashExt.pedidosRepetidos) return [];
    if (Date.now() - repCache.t > 1500) repCache = { t: Date.now(), g: SmashExt.pedidosRepetidos() };
    const g = repCache.g.find((x) => x[0].ref === o.ref);
    return g ? g.filter((x) => x.id !== o.id) : [];
  }
  function repetidoHtml(o, cl) {
    const otros = repetidos(o);
    return otros.length ? `<div class="${cl} warn">⚠ Pedido repetido: es el mismo pedido web que ${otros.map((x) => '#' + esc(num(x))).join(', ')}. Cancela uno de los dos.</div>` : '';
  }
  // Nombre de la promo del pedido, en negrilla y antes de los productos (igual que en la comanda)
  function promoHtml(o, cl) {
    const l = typeof SmashTicket !== 'undefined' && SmashTicket.promos ? SmashTicket.promos(o) : [];
    return l.map((t) => `<div class="${cl} promo-tit">⭐ PROMO: <b>${esc(t)}</b></div>`).join('');
  }
  // Producto regalado por una promo: su nota dice "GRATIS"
  const notaSinGratis = (it) => String(it.nota || '').replace(/(^| · )GRATIS · .*$/, '').trim();
  const notaHtml = (n, tag) => n ? `<${tag} class="${tag === 'span' ? 'inote' : ''}${/(^|· )GRATIS/.test(n) ? ' gratis' : ''}">↳ ${esc(n)}</${tag}>` : '';
  function canjeHtml(o, cl) {
    let h = '';
    if (o.canjes && o.canjes.length) h += `<div class="${cl} gold">⭐ Pagó con puntos: ${o.canjes.map((c) => esc(c.titulo) + ' (−' + esc(c.puntos) + ' pts' + (Number(c.valor) > 0 ? ' · −' + fmt(c.valor) : ' · regalo') + ')').join(', ')}</div>`;
    if (o.canjeRechazado) h += `<div class="${cl} warn">⚠ La promoción con puntos no se aplicó (${esc(o.canjeRechazado)}). El total ya está sin ese descuento.</div>`;
    if (o.puntosDevueltos) h += `<div class="${cl}">↩ Se devolvieron ${esc(o.puntosDevueltos)} puntos del canje al cliente.</div>`;
    return h;
  }

  /* ---------- tarjeta de pedido ---------- */
  function card(o) {
    const status = o.status;
    const items = SmashExt.itemsConRegalos(o).map((it) => it.regalo
      ? `<div class="oit promo-tit"><b>🎁 GRATIS · ${esc(it.regalo)}</b></div><div class="oit">${esc(it.qty)}× ${esc(it.name)} <span class="inote gratis">adición gratis</span>${notaSinGratis(it) ? notaHtml(notaSinGratis(it), 'span') : ''}</div>`
      : `<div class="oit">${esc(it.qty)}× ${esc(it.name)}${notaHtml(it.nota, 'span')}</div>`).join('');
    const id = esc(o.id), d = C.desglose(o);
    const dom = o.domicilioPendiente ? '<span class="pend">por confirmar</span>' : fmt(d.domicilio);
    const despacho = status === 'listo' || status === 'en_camino';
    const repBtn = (o.impresa || despacho) ? `<button class="btn-rep" data-act="rep" data-id="${id}">🛵 ${o.repartidor ? 'Cambiar repartidor' : 'Asignar repartidor'}</button>` : '';
    const marcas = [['Recibido', o.creado], ['Confirmado', o.confirmadoEn], ['Preparación', o.preparandoEn], ['Listo', o.listoEn], ['Salió', o.salioEn]].filter((x) => x[1]);
    const ep = typeof SmashCaja !== 'undefined' ? SmashCaja.estadoPago(o) : null;
    const pagoHtml = !ep || ep.k === 'antiguo' || ep.k === 'na' ? ''
      : ep.k === 'pagado' ? `<div class="pago-ok">💰 Pagado: ${esc(ep.pago.lineas.map((l) => SmashCaja.METODOS[l.metodo] + ' ' + fmt(l.monto)).join(' + '))}</div>`
      : `<div class="pago-pend">💰 Pendiente de pago</div>`;
    return `
      <div class="order-card st-${esc(status)}">
        <div class="row"><strong class="onum">#${esc(num(o))}</strong><span class="st-badge st-${esc(status)}">${esc(C.NOMBRE[status] || status)}</span>${timerHtml(o)}</div>
        ${o.reserva ? (status === 'nuevo' ? `<div class="resv-tag">📅 RESERVA: llegó fuera de horario. Confírmala para despacharla al abrir.</div>` : '<div class="resv-tag mini">📅 Reserva</div>') : ''}
        <div class="meta">Comanda ${esc(C.codigo(o))}${o.ref ? ' · ' + esc(o.ref) : ''}${o.origen === 'cocina' ? ' · tomado en caja' : ''}${o.editadoEn ? ' · editado' : ''}</div>
        <div class="oname">${esc(o.cliente)} ${o.telefono ? `<a class="otel" href="tel:${esc(String(o.telefono).replace(/[^\d+]/g, ''))}">📞 ${esc(o.telefono)}</a>` : '<span class="meta">sin teléfono</span>'}</div>
        ${o.horaEntrega ? `<div class="hora-tag">🕒 Entregar: <b>${esc(o.horaEntrega)}</b></div>` : ''}
        ${o.telefono2 ? `<div class="meta">📞 Ref. domicilio: <a class="otel" href="tel:${esc(String(o.telefono2).replace(/[^\d+]/g, ''))}">${esc(o.telefono2)}</a></div>` : ''}
        ${o.cuenta ? `<div class="leal-tag">⭐ Cliente leal: @${esc(o.cuenta.usuario || '-')} · ${esc(o.cuenta.correo)}${o.puntosSumados ? ` · <b>+${esc(o.puntosSumados)} pts sumados</b>` : ''}</div>` : ''}
        ${o.cuenta && !o.puntosSumados && o.puntosAviso ? `<div class="leal-tag">⚠ ${esc(o.puntosAviso)}</div>` : ''}
        ${canjeHtml(o, "leal-tag")}${repetidoHtml(o, "leal-tag")}
        <div class="oaddr">📍 ${esc(o.direccion || 'sin dirección')}${o.zona ? ` <span class="meta">(${esc(o.zona)})</span>` : ''}</div>
        <div class="items">${promoHtml(o, 'leal-tag')}${items}</div>
        ${o.notas ? `<div class="meta">📝 ${esc(o.notas)}</div>` : ''}
        ${(o.novedades || []).map((n) => `<div class="nov">⚠ ${esc(n.texto)} <span class="meta">${esc(hora(n.en))}${n.por ? ' · ' + esc(n.por) : ''}</span></div>`).join('')}
        ${o.repartidor ? `<div class="rep">🛵 Repartidor: <b>${esc(o.repartidor)}</b>${o.salioEn ? ' · salió ' + esc(hora(o.salioEn)) : ''}</div>` : ''}
        <div class="desg"><span>Productos ${fmt(d.productos)}</span>${d.adicionales ? `<span>Adicionales ${fmt(d.adicionales)}</span>` : ''}${d.descuento ? `<span>Descuento −${fmt(d.descuento)}</span>` : ''}<span>Domicilio ${dom}</span>${o.pago ? `<span>${esc(o.pago)}</span>` : ''}<strong>Total ${fmt(d.total)}</strong></div>
        ${pagoHtml}
        <div class="meta marcas">${marcas.map((m) => esc(m[0]) + ' ' + esc(hora(m[1]))).join(' · ')}</div>
        <div class="order-actions">
          ${NEXT[status] ? `<button class="btn-advance" data-act="advance" data-id="${id}" data-status="${esc(status)}">${NEXT_LABEL[status]}</button>` : ''}
          ${ep && (ep.k === 'pendiente' || ep.k === 'pagado') ? `<button class="btn-pay${ep.k === 'pagado' ? ' done' : ''}" data-act="pay" data-id="${id}">💰 ${ep.k === 'pagado' ? 'Ver pago' : 'Cobrar'}</button>` : ''}
          ${o.cuenta && !o.puntosSumados && status !== 'cancelado' && typeof SmashLealesUI !== 'undefined' ? `<button class="btn-pts" data-act="puntos" data-id="${id}">⭐ Sumar puntos</button>` : ''}
          <button class="btn-print" data-act="print" data-id="${id}">🖨️ Imprimir comanda</button>
          <button class="btn-pdf" data-act="pdf" data-id="${id}">⬇️ PDF</button>
          ${repBtn}
          ${status !== 'cancelado' ? `<button class="btn-dom" data-act="dom" data-id="${id}">💲 ${o.domicilioPendiente ? 'Valor del domicilio' : 'Corregir domicilio'}</button>` : ''}
          <button class="btn-edit" data-act="edit" data-id="${id}">✏️ Editar</button>
          <button class="btn-nov" data-act="nov" data-id="${id}">📝 Novedad</button>
          <button class="btn-del" data-act="cancel" data-id="${id}">✕ Cancelar</button>
        </div>
      </div>`;
  }

  /* ---------- fila del listado horizontal ---------- */
  const telHref = (t) => 'tel:' + esc(String(t).replace(/[^\d+]/g, ''));
  function resumenItems(o) {
    return (o.items || []).map((it) => esc(it.qty) + '× ' + esc(it.name)).join(', ');
  }
  function pagoCorto(o) {
    const ep = typeof SmashCaja !== 'undefined' ? SmashCaja.estadoPago(o) : null;
    if (ep && ep.k === 'pagado') return '<span class="ol-paid">Pagado</span>';
    if (ep && ep.k === 'pendiente') return '<span class="ol-unpaid">Por cobrar</span>';
    return esc(o.pago || '');
  }
  function fila(o, opt) {
    opt = opt || {};
    const st = o.status, id = esc(o.id), fin = st === 'entregado' || st === 'cancelado';
    const cuando = fin ? (st === 'entregado' ? o.entregadoEn : o.canceladoEn) : o.creado;
    return `<div class="ol-row st-${esc(st)}${opt.activo ? ' sel' : ''}" data-open="${id}" tabindex="0" role="button" aria-label="Abrir pedido ${esc(num(o))}">
      <div class="ol-num"><b>#${esc(num(o))}</b><small>${esc(hora(o.creado))}</small></div>
      <div class="ol-st"><span class="st-badge st-${esc(st)}">${esc(C.NOMBRE[st] || st)}</span>${o.reserva ? '<span class="ol-flag">📅 Reserva</span>' : ''}${o.origen === 'web' ? '<span class="ol-flag web">🌐 Web</span>' : ''}${repetidos(o).length ? '<span class="ol-flag rep">⚠ Repetido</span>' : ''}${o.canjes && o.canjes.length ? '<span class="ol-flag pts">⭐ Puntos</span>' : ''}</div>
      <div class="ol-cli"><b>${esc(o.cliente || 'Sin nombre')}</b><small>📍 ${esc(o.zona || o.direccion || 'sin dirección')}${o.horaEntrega ? ' · 🕒 ' + esc(o.horaEntrega) : ''}</small></div>
      <div class="ol-items" title="${resumenItems(o)}">${typeof SmashTicket !== 'undefined' && SmashTicket.promos ? SmashTicket.promos(o).map((t) => `<b class="ol-promo">⭐ ${esc(t)}</b> · `).join('') : ''}${resumenItems(o)}</div>
      <div class="ol-tot"><b>${fmt(o.total)}</b><small>${pagoCorto(o)}</small></div>
      <div class="ol-time">${fin ? `<span class="ol-end">${st === 'entregado' ? '✓' : '✕'} ${esc(hora(cuando))}</span>` : timerHtml(o)}</div>
      <div class="ol-act">${!fin && NEXT[st] ? `<button type="button" class="ol-next" data-act="advance" data-id="${id}" data-status="${esc(st)}">${NEXT_LABEL[st]}</button>` : '<span class="ol-chev">›</span>'}</div>
    </div>`;
  }

  /* ---------- ficha completa del pedido (panel lateral derecho) ---------- */
  const PASOS = [['nuevo', 'Recibido', 'creado'], ['confirmado', 'Confirmado', 'confirmadoEn'], ['preparando', 'Preparación', 'preparandoEn'], ['listo', 'Listo', 'listoEn'], ['en_camino', 'En camino', 'salioEn'], ['entregado', 'Entregado', 'entregadoEn']];
  function detalle(o) {
    const st = o.status, id = esc(o.id), d = C.desglose(o), fin = st === 'entregado' || st === 'cancelado';
    const idx = PASOS.findIndex((p) => p[0] === st);
    const ep = typeof SmashCaja !== 'undefined' ? SmashCaja.estadoPago(o) : null;
    const despacho = st === 'listo' || st === 'en_camino';
    const btn = (act, txt, cls) => `<button type="button" class="od-btn ${cls || ''}" data-act="${act}" data-id="${id}">${txt}</button>`;
    const acciones = [];
    if (ep && (ep.k === 'pendiente' || ep.k === 'pagado')) acciones.push(btn('pay', ep.k === 'pagado' ? '💰 Ver pago' : '💰 Cobrar', ep.k === 'pagado' ? '' : 'hl'));
    // Imprimir a distancia: en un equipo que NO es el impresor va primero y resaltado
    const remota = typeof SmashImpRemota !== 'undefined' && SmashImpRemota.disponible();
    if (remota && !SmashImpRemota.esImpresor()) acciones.push(btn('remote', '📡 Imprimir en cocina', 'hl'));
    acciones.push(btn('print', remota && !SmashImpRemota.esImpresor() ? '🖨️ Imprimir aquí' : '🖨️ Imprimir comanda'), btn('pdf', '⬇️ PDF'));    if (!fin && (o.impresa || despacho)) acciones.push(btn('rep', o.repartidor ? '🛵 Cambiar repartidor' : '🛵 Asignar repartidor'));
    if (st !== 'cancelado') acciones.push(btn('dom', o.domicilioPendiente ? '💲 Valor del domicilio' : '💲 Corregir domicilio', o.domicilioPendiente ? 'hl' : ''));
    if (!fin) acciones.push(btn('edit', '✏️ Editar pedido'));
    acciones.push(btn('nov', '📝 Novedad'));
    if (o.cuenta && !o.puntosSumados && st !== 'cancelado' && typeof SmashLealesUI !== 'undefined') acciones.push(btn('puntos', '⭐ Sumar puntos'));
    const c = o.cancelacion;
    return `
      <div class="od-head st-${esc(st)}">
        <div><div class="od-num">Pedido #${esc(num(o))}</div>
          <div class="od-sub">Comanda ${esc(C.codigo(o))}${o.ref ? ' · ' + esc(o.ref) : ''} · ${o.origen === 'web' ? 'página web' : o.origen === 'whatsapp' ? 'WhatsApp' : o.origen === 'cocina' ? 'tomado en caja' : esc(o.origen || '')}${o.editadoEn ? ' · editado' : ''}</div></div>
        <div class="od-head-r"><span class="st-badge st-${esc(st)}">${esc(C.NOMBRE[st] || st)}</span>${timerHtml(o)}</div>
      </div>
      ${st === 'cancelado' ? '' : `<ol class="od-steps">${PASOS.map((p, i) => `<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span></span><b>${p[1]}</b><small>${esc(hora(o[p[2]])) || '&nbsp;'}</small></li>`).join('')}</ol>`}
      ${!fin && NEXT[st] ? `<button type="button" class="od-next" data-act="advance" data-id="${id}" data-status="${esc(st)}">${NEXT_LABEL[st]}</button>` : ''}
      ${o.reserva && st === 'nuevo' ? '<div class="od-alert warn">📅 <b>Reserva:</b> llegó fuera de horario. Confírmala para despacharla al abrir.</div>' : ''}
      ${o.domicilioPendiente && !fin ? '<div class="od-alert warn">💲 Falta definir el valor del domicilio (zona por confirmar).</div>' : ''}
      ${c ? `<div class="od-alert bad">✕ <b>Cancelado</b> en ${esc(C.NOMBRE[c.etapa] || c.etapa)} · ${esc(hora(c.en))}<br>${esc(c.motivo)} · responsable ${esc(c.responsable)}${c.preparado ? ' · se alcanzó a preparar' : ''}</div>` : ''}

      <section class="od-sec">
        <h4>Cliente</h4>
        <div class="od-cli">${esc(o.cliente || 'Sin nombre')}</div>
        <div class="od-lines">
          ${o.telefono ? `<a class="od-tel" href="${telHref(o.telefono)}">📞 ${esc(o.telefono)}</a>` : '<span class="od-mut">Sin teléfono</span>'}
          ${o.telefono2 ? `<a class="od-tel" href="${telHref(o.telefono2)}">📞 Ref. ${esc(o.telefono2)}</a>` : ''}
        </div>
        <div class="od-addr">📍 ${esc(o.direccion || 'Sin dirección')}${o.zona ? ` <span class="od-mut">· ${esc(o.zona)}</span>` : ''}</div>
        ${o.horaEntrega ? `<div class="od-tag">🕒 Entregar: <b>${esc(o.horaEntrega)}</b></div>` : ''}
        ${o.cuenta ? `<div class="od-tag gold">⭐ Cliente leal @${esc(o.cuenta.usuario || '-')} · ${esc(o.cuenta.correo)}${o.puntosSumados ? ` · +${esc(o.puntosSumados)} pts` : ''}</div>` : ''}
        ${o.cuenta && !o.puntosSumados && o.puntosAviso ? `<div class="od-tag">⚠ ${esc(o.puntosAviso)}</div>` : ''}
        ${canjeHtml(o, "od-tag")}${repetidoHtml(o, "od-tag")}
        ${o.repartidor ? `<div class="od-tag">🛵 Repartidor: <b>${esc(o.repartidor)}</b>${o.salioEn ? ' · salió ' + esc(hora(o.salioEn)) : ''}</div>` : ''}
      </section>

      <section class="od-sec">
        <h4>Productos</h4>
        ${promoHtml(o, 'od-tag gold')}
        <ul class="od-items">${SmashExt.itemsConRegalos(o).map((it) => it.regalo
          ? `<li class="od-regalo-tit"><b>🎁 GRATIS · ${esc(it.regalo)}</b></li><li><span class="q">${esc(it.qty)}×</span><span class="n">${esc(it.name)} <small class="gratis">adición gratis</small>${notaSinGratis(it) ? notaHtml(notaSinGratis(it), 'small') : ''}</span><span class="p">Gratis</span></li>`
          : `<li><span class="q">${esc(it.qty)}×</span><span class="n">${esc(it.name)}${notaHtml(it.nota, 'small')}</span><span class="p">${fmt(it.price * it.qty)}</span></li>`).join('')}</ul>
        ${o.notas ? `<div class="od-note">📝 ${esc(o.notas)}</div>` : ''}
      </section>

      <section class="od-sec od-sum">
        <div><span>Productos</span><b>${fmt(d.productos)}</b></div>
        ${d.adicionales ? `<div><span>Adicionales</span><b>${fmt(d.adicionales)}</b></div>` : ''}
        ${d.descuento ? `<div><span>Descuento</span><b>−${fmt(d.descuento)}</b></div>` : ''}
        <div class="od-dom"><span>Domicilio${o.zona ? ` <small>· ${esc(o.zona)}</small>` : ''}</span><b>${o.domicilioPendiente ? '<span class="pend">por confirmar</span>' : fmt(d.domicilio)}${st !== 'cancelado' ? `<button type="button" class="od-dom-ed" data-act="dom" data-id="${id}" title="Corregir el valor del domicilio">✏️ Corregir</button>` : ''}</b></div>
        <div class="tot"><span>Total${o.pago ? ' · ' + esc(o.pago) : ''}</span><b>${fmt(d.total)}</b></div>
        ${ep && ep.k === 'pagado' ? `<div class="od-paid">💰 Pagado: ${esc(ep.pago.lineas.map((l) => SmashCaja.METODOS[l.metodo] + ' ' + fmt(l.monto)).join(' + '))}</div>` : ep && ep.k === 'pendiente' ? '<div class="od-unpaid">💰 Pendiente de pago</div>' : ''}
      </section>

      ${(o.novedades || []).length ? `<section class="od-sec"><h4>Novedades</h4>${o.novedades.map((n) => `<div class="od-nov">⚠ ${esc(n.texto)} <small>${esc(hora(n.en))}${n.por ? ' · ' + esc(n.por) : ''}</small></div>`).join('')}</section>` : ''}

      <section class="od-sec"><h4>Acciones</h4><div class="od-acts">${acciones.join('')}</div>
        ${!fin ? `<button type="button" class="od-cancel" data-act="cancel" data-id="${id}">✕ Cancelar pedido</button>` : ''}</section>`;
  }

  /* ---------- ventana emergente ---------- */
  let openModal = null;
  function closeModal() { if (openModal) { openModal.remove(); openModal = null; } }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  function modal(title, body, onSave, saveLabel) {
    closeModal();
    const m = document.createElement('div');
    m.className = 'smash-modal';
    m.innerHTML = `<div class="sm-box" role="dialog" aria-modal="true"><h3>${title}</h3><div class="sm-body">${body}</div>
      <div class="sm-foot"><button type="button" class="sm-cancel">Cancelar</button><button type="button" class="sm-save btn-primary">${saveLabel || 'Guardar'}</button></div></div>`;
    document.body.appendChild(m);
    openModal = m;
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
    m.querySelector('.sm-cancel').addEventListener('click', closeModal);
    m.querySelector('.sm-save').addEventListener('click', () => { if (onSave(m) !== false) closeModal(); });
    return m;
  }

  /* ---------- repartidor ---------- */
  // Asigna el domiciliario. Con luegoEstado ("en_camino") se usa al despachar: exige el nombre y cambia el estado.
  function openRepartidor(o, luegoEstado) {
    const nombres = [];
    SmashExt.getPersonal().filter((p) => /domic|repart|mensaj|moto/i.test(p.cargo)).forEach((p) => nombres.push(p.nombre));
    SmashExt.getRepartidores().forEach((n) => { if (!nombres.some((x) => x.toLowerCase() === n.toLowerCase())) nombres.push(n); });
    const m = modal(luegoEstado ? `Despachar pedido #${esc(num(o))}` : `Repartidor del pedido #${esc(num(o))}`,
      `<p class="hint">${luegoEstado ? 'Escribe quién lleva el pedido. Se registra la hora de salida.' : 'Solo se ve en el sistema. No sale en la comanda.'}</p>
       <label class="ed-wide">Nombre del domiciliario<input id="repIn" list="repList" maxlength="60" value="${esc(o.repartidor || '')}" autocomplete="off"></label>
       <datalist id="repList">${nombres.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>`,
      (mm) => {
        const n = mm.querySelector('#repIn').value.trim();
        if (luegoEstado && !n) { mm.querySelector('#repIn').focus(); return false; }
        SmashExt.updateOrder(o.id, { repartidor: n });
        SmashExt.rememberRepartidor(n);
        if (luegoEstado) SmashExt.setStatus(o.id, luegoEstado);
        cfg.refresh();
      }, luegoEstado ? '🛵 Despachar' : 'Guardar');
    m.querySelector('#repIn').focus();
  }

  /* ---------- novedad del pedido ---------- */
  function openNovedad(o) {
    const m = modal(`Novedad del pedido #${esc(num(o))}`,
      `<p class="hint">Queda en el historial del pedido con la hora (cliente no contesta, cambio de dirección, demora...).</p>
       <label class="ed-wide">Novedad<textarea id="novIn" maxlength="300"></textarea></label><p class="error" id="novErr"></p>`,
      (mm) => {
        try { C.agregarNovedad(o.id, mm.querySelector('#novIn').value, cfg.who); } catch (e) { mm.querySelector('#novErr').textContent = e.message; return false; }
        cfg.refresh();
      });
    m.querySelector('#novIn').focus();
  }

  /* ---------- cancelar (anular) pedido ---------- */
  const MOTIVOS = ['Cliente canceló', 'Cliente no contesta / no recibe', 'Dirección errada o fuera de cobertura', 'Producto agotado', 'Pedido duplicado', 'Error al tomar el pedido', 'Demora', 'Otro'];
  function openCancelar(o) {
    const info = C.infoCancelacion(o);
    const m = modal(`Cancelar pedido #${esc(num(o))}`,
      `<p class="hint">El pedido no se borra: queda como <b>Cancelado</b> con su motivo y sale de las ventas. Estado actual: <b>${esc(C.NOMBRE[o.status])}</b>.</p>
       <label class="ed-wide">Motivo<select id="canMot">${MOTIVOS.map((x) => `<option>${esc(x)}</option>`).join('')}</select></label>
       <label class="ed-wide">Detalle (opcional)<input id="canDet" maxlength="150"></label>
       <label class="ed-wide">Responsable de la cancelación<input id="canResp" maxlength="60" value="${esc(C.ultimoResponsable())}" placeholder="Nombre de quien cancela"></label>
       ${info.enCocina ? `<label class="chk"><input type="checkbox" id="canPrep" checked> El pedido alcanzó a prepararse (los insumos se pierden)</label>
         <p class="hint">${cfg.who === 'cocina' ? 'Si se preparó, se registra como pérdida' : `Pérdida estimada si se preparó: <b>${fmt(info.costo)}</b>`}${info.consumos.length ? ' · insumos: ' + esc(info.consumos.map((x) => x.ingNombre).join(', ')) : ''}. Si no se preparó, los insumos vuelven al inventario.</p>`
         : '<p class="hint">Aún no entraba a cocina: no hay pérdida ni se toca el inventario.</p>'}
       <p class="error" id="canErr"></p>`,
      (mm) => {
        const det = mm.querySelector('#canDet').value.trim();
        try {
          C.cancelar(o.id, {
            motivo: mm.querySelector('#canMot').value + (det ? ': ' + det : ''), responsable: mm.querySelector('#canResp').value,
            preparado: info.enCocina ? mm.querySelector('#canPrep').checked : false,
          }, cfg.who);
        } catch (e) { mm.querySelector('#canErr').textContent = e.message; return false; }
        cfg.refresh();
      }, 'Cancelar pedido');
    m.querySelector('.sm-cancel').textContent = 'Volver';
  }

  /* ---------- valor del domicilio (zona Otros) ---------- */
  function openDomicilio(o) {
    const sinDom = (o.subtotal || 0) - (o.descuento || 0);
    const m = modal(`Domicilio del pedido #${esc(num(o))}`,
      `<p class="hint">Zona: ${esc(o.zona || 'sin zona')}${o.domicilioPendiente ? '' : ` · valor actual ${fmt(o.domicilio || 0)}`}. Escribe el valor correcto: el total del pedido se recalcula y sale así en la comanda.</p>
       <label class="ed-wide">Valor del domicilio (COP)<input id="domIn" type="number" min="0" step="500" inputmode="numeric" value="${esc(o.domicilioPendiente ? '' : o.domicilio)}"></label>
       <div class="ed-total" id="domTot"></div>`,
      (mm) => {
        const v = parseFloat(mm.querySelector('#domIn').value);
        if (!(v >= 0)) { mm.querySelector('#domIn').focus(); return false; }
        const antes = o.domicilioPendiente ? null : Number(o.domicilio) || 0;
        const nuevo = Math.round(v);
        SmashExt.updateOrder(o.id, { domicilio: nuevo });
        // queda constancia en las novedades del pedido
        if (antes !== null && antes !== nuevo) { try { C.agregarNovedad(o.id, `Domicilio corregido: ${fmt(antes)} → ${fmt(nuevo)}`, cfg.who); } catch (e) { /* sin novedad no pasa nada */ } }
        cfg.refresh();
      }, 'Guardar domicilio');
    const inp = m.querySelector('#domIn'), tot = m.querySelector('#domTot');
    const pintar = () => { const v = parseFloat(inp.value); tot.innerHTML = `Productos ${fmt(sinDom)} · Domicilio ${v >= 0 ? fmt(v) : '—'} · <b>Total ${fmt(sinDom + (v >= 0 ? v : 0))}</b>`; };
    inp.addEventListener('input', pintar); pintar();
    inp.focus(); inp.select();
  }

  /* ---------- editar pedido ---------- */
  /* Todo el pedido se puede corregir: productos, adiciones, combos, precios, notas, descuento,
     el cliente del club y la promo del día que el cliente olvidó agregar (si la promo cuesta
     puntos y el pedido es de una cuenta del club, los puntos se descuentan al guardar).
     Las promos quedan en el pedido igual que las de la página, así salen en la comanda impresa. */
  const NB = () => (typeof SmashNube !== 'undefined' && SmashNube.ok ? SmashNube : null);
  const cuestaPts = (p) => Math.max(0, Number(p && p.puntos) || 0);
  const titDe = (x) => String((x && (x.titulo || x.motivo)) || '').replace(/^Promo cliente leal:\s*/i, '').trim();
  let edPromos = null, edPromosMsg = '', edPromosEn = 0;
  async function cargarPromosEd() {
    const N = NB();
    if (!N || !N.panelPromos) { edPromos = []; edPromosMsg = 'Sin conexión con la nube: no se pueden cargar las promociones.'; return; }
    if (edPromos && Date.now() - edPromosEn < 120000) return;
    try { const r = await N.panelPromos(); edPromos = r.lista || []; edPromosMsg = r.ok ? '' : (r.error || 'No se cargaron las promociones.'); } catch (e) { edPromos = []; edPromosMsg = 'Sin internet: no se cargaron las promociones.'; }
    edPromosEn = Date.now();
  }
  function openEditor(o) {
    const N = NB();
    const draft = {
      items: o.items.map((i) => Object.assign({}, i)), notas: o.notas || '', cliente: o.cliente || '',
      telefono: o.telefono || '', direccion: o.direccion || '', domicilio: o.domicilioPendiente ? '' : o.domicilio,
      descuento: Number(o.descuento) || 0,
      descuentos: (o.descuentos || []).map((x) => Object.assign({}, x)),
      cuenta: o.cuenta ? Object.assign({}, o.cuenta) : null,
      canjesNuevos: [],        // promos con puntos aplicadas aquí: se descuentan al guardar
      aplicadas: [],           // promos aplicadas aquí (para la novedad del pedido)
    };
    let aviso = '', club = { lista: [], msg: '' }, guardando = false;
    const variable = !!o.domicilioPendiente || /otros/i.test(o.zona || '');
    const products = SmashDB.getProducts({ soloActivos: true });
    const prodDe = (id) => products.find((p) => p.id === id) || SmashDB.getProductById(id);
    const esBurger = (it) => (it.cat || (prodDe(it.id) || {}).categoria) === 'hamburguesa';
    const adiciones = products.filter((p) => p.categoria === 'adicional');
    const combo = products.find((p) => p.categoria === 'combo');
    const subtotal = () => draft.items.reduce((s, i) => s + (Number(i.price) || 0) * i.qty, 0);
    const descOk = () => Math.max(0, Math.min(Number(draft.descuento) || 0, subtotal()));

    // Guarda los cambios (después de descontar los puntos, si hay una promo con puntos)
    function guardar(refCanje) {
      const patch = {
        items: draft.items.map((i) => {
          const x = { id: i.id, name: i.name, price: Math.max(0, Math.round(Number(i.price) || 0)), qty: Math.max(1, Math.min(50, i.qty | 0)), cat: i.cat || '' };
          if (i.nota && i.nota.trim()) x.nota = i.nota.trim().slice(0, 200);
          if (i.para) { x.para = i.para; x.paraId = i.paraId; }
          if (i.regalo) { x.regalo = i.regalo; x.precioLista = i.precioLista || 0; x.price = 0; if (i.regaloPromo != null) x.regaloPromo = i.regaloPromo; }
          return x;
        }),
        notas: draft.notas.trim().slice(0, 300), cliente: draft.cliente.trim(), telefono: draft.telefono.trim(), direccion: draft.direccion.trim(),
        descuento: descOk(), descuentos: draft.descuentos, editadoEn: new Date().toISOString(),
      };
      if (draft.cuenta) patch.cuenta = { usuario: draft.cuenta.usuario || '', correo: draft.cuenta.correo };
      if (draft.canjesNuevos.length && refCanje) {
        patch.canjes = (o.canjes || []).concat(draft.canjesNuevos);
        patch.refsCanje = (o.refsCanje || []).concat([refCanje]);
      }
      const domNuevo = draft.domicilio === '' ? NaN : parseFloat(draft.domicilio);
      if (domNuevo >= 0 && (o.domicilioPendiente || Math.round(domNuevo) !== (Number(o.domicilio) || 0))) patch.domicilio = Math.round(domNuevo);
      SmashExt.updateOrder(o.id, patch);
      if (draft.aplicadas.length) { try { C.agregarNovedad(o.id, 'Promo aplicada al editar: ' + draft.aplicadas.join(', '), cfg.who); } catch (e) { /* sin novedad no pasa nada */ } }
      cfg.refresh();
    }

    const m = modal(`Editar pedido #${esc(num(o))}`, '<div id="edBody"></div>', () => {
      if (guardando) return false;
      if (!draft.items.length) { alert('El pedido debe tener al menos un producto.'); return false; }
      if (!draft.cliente.trim()) { alert('Escribe el nombre del cliente.'); return false; }
      if (!draft.canjesNuevos.length) { guardar(''); return true; }
      const pts = draft.canjesNuevos.reduce((s, c) => s + c.puntos, 0);
      if (!draft.cuenta || !N || !N.panelCanjear) {
        if (!confirm(`La promo cuesta ${pts} puntos, pero ${draft.cuenta ? 'no hay conexión con la nube' : 'este pedido no es de una cuenta del club'}: se aplica SIN descontar puntos. ¿Guardar así?`)) return false;
        draft.canjesNuevos = []; guardar(''); return true;
      }
      // primero la nube descuenta los puntos; si no se puede, no se guarda la promo
      guardando = true;
      const btn = m.querySelector('.sm-save'); btn.disabled = true; btn.textContent = 'Descontando puntos…';
      const ref = 'ed-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      N.panelCanjear(draft.cuenta.correo, draft.canjesNuevos.map((c) => c.promo), ref).catch(() => ({ ok: false, error: 'Sin internet' })).then((r) => {
        guardando = false; btn.disabled = false; btn.textContent = 'Guardar cambios';
        if (!r || !r.ok) { aviso = '⚠ No se descontaron los puntos: ' + ((r && r.error) || 'error') + '. Quita la promo o inténtalo de nuevo.'; render(); return; }
        guardar(ref); closeModal();
      });
      return false;
    }, 'Guardar cambios');
    m.querySelector('.sm-box').classList.add('wide');
    const body = m.querySelector('#edBody');
    const totalHtml = () => {
      const sub = subtotal(), d = descOk(), dom = parseFloat(draft.domicilio) || 0;
      return `Productos ${fmt(sub)}${d ? ` · Descuento −${fmt(d)}` : ''} · Domicilio ${draft.domicilio === '' ? 'por confirmar' : fmt(dom)} · <b>Total ${fmt(sub - d + dom)}</b>`;
    };

    /* ---- promo del día ---- */
    const vigentes = () => (N && edPromos ? edPromos.filter((p) => N.vigente(p)) : []);
    const yaTiene = (p) => draft.items.some((i) => i.regalo && (String(i.regaloPromo) === String(p.id) || i.regalo === p.titulo)) ||
      draft.descuentos.some((x) => titDe(x) === p.titulo) || (o.canjes || []).concat(draft.canjesNuevos).some((c) => String(c.promo) === String(p.id));
    // valor sugerido para promos de descuento (paquete: precio normal − precio del paquete, por cada paquete que alcance)
    function sugerido(p) {
      const base = draft.items.filter((i) => !i.regalo);
      if (p.tipo === 'paquete') {
        const ids = N.prodsDe(p), cuenta = (id) => base.filter((i) => i.id === id).reduce((s, i) => s + i.qty, 0);
        const n = ids.length ? Math.min.apply(null, ids.map(cuenta)) : 0, normal = N.precioNormalPaquete(p, prodDe);
        return n > 0 && normal > 0 ? Math.max(0, n * (normal - (Number(p.valor) || 0))) : 0;
      }
      const R = N.aplicarPromos(base, [p]), u = (R.usadas || []).find((x) => String(x.id) === String(p.id));
      return u ? u.valor : 0;
    }
    function promoHtmlEd() {
      if (!N) return '<p class="hint">Sin conexión con la nube: no se pueden cargar las promociones. Puedes poner el descuento o el precio a mano.</p>';
      if (edPromos === null) return '<p class="hint">Cargando las promociones de hoy…</p>';
      const l = vigentes();
      if (!l.length) return `<p class="hint">${esc(edPromosMsg || 'Hoy no hay promociones activas.')}</p>`;
      return l.map((p) => {
        const pts = cuestaPts(p), tiene = yaTiene(p);
        let acc;
        if (tiene) acc = `<span class="ed-ok">✓ Ya está en el pedido</span>`;
        else if (p.tipo === 'regalo') {
          const ops = N.regalosDe(p).map(prodDe).filter(Boolean);
          acc = ops.map((g) => `<button type="button" class="btn-sm" data-ed="promo" data-p="${esc(p.id)}" data-g="${esc(g.id)}">Aplicar · regalo ${esc(g.name)}</button>`).join(' ') || '<small class="hint">El regalo de esta promo no está en el menú.</small>';
        } else if (p.tipo === 'incentivo') acc = '<small class="hint">Beneficio sin descuento.</small>';
        else acc = `<label class="ed-pv">Descuento $<input type="number" min="0" step="100" inputmode="numeric" data-pv="${esc(p.id)}" value="${esc(sugerido(p) || '')}"></label><button type="button" class="btn-sm" data-ed="promo" data-p="${esc(p.id)}">Aplicar</button>`;
        return `<div class="ed-promo${tiene ? ' on' : ''}"><div><b>⭐ ${esc(p.titulo)}</b>${pts ? ` <small class="ed-pts">${pts} pts</small>` : ''}${p.descripcion ? `<small>${esc(p.descripcion)}</small>` : ''}</div><div class="ed-promo-acc">${acc}</div></div>`;
      }).join('');
    }
    function aplicar(p, giftId) {
      aviso = '';
      if (p.tipo === 'regalo') {
        const base = draft.items.filter((i) => !i.regalo);
        const R = N.aplicarPromos(base, [p]), g = (R.regalos || []).find((x) => String(x.p.id) === String(p.id));
        const gana = g ? g.gana : 0;
        if (gana <= 0) { aviso = `⚠ ${p.titulo}: el pedido aún no cumple (${(g && g.siguiente) ? 'le falta' + (g.siguiente > 1 ? 'n ' : ' ') + g.siguiente + ' burger' + (g.siguiente > 1 ? 's' : '') : 'no tiene las burgers de la promo'}${p.sin_combo !== false ? '; las burgers en combo no cuentan' : ''}).`; return; }
        const gp = prodDe(giftId); if (!gp) return;
        let falta = gana;
        // las unidades del regalo que ya venían cobradas pasan a $0
        for (let i = 0; i < draft.items.length && falta > 0; i++) {
          const it = draft.items[i];
          if (it.regalo || it.id !== gp.id) continue;
          const n = Math.min(falta, it.qty);
          const gift = Object.assign({}, it, { qty: n, regalo: p.titulo, regaloPromo: p.id, precioLista: it.price, price: 0, nota: (it.nota ? it.nota + ' · ' : '') + 'GRATIS · ' + p.titulo });
          if (n < it.qty) { it.qty -= n; draft.items.splice(i + 1, 0, gift); i++; } else draft.items[i] = gift;
          falta -= n;
        }
        if (falta > 0) {
          const line = { id: gp.id, name: gp.name, price: 0, qty: falta, cat: gp.categoria || '', regalo: p.titulo, regaloPromo: p.id, precioLista: gp.price, nota: 'GRATIS · ' + p.titulo };
          if (gp.categoria === 'combo') { const b = draft.items.find((i) => !i.regalo && esBurger(i)); if (b) { line.para = b.name; line.paraId = b.id; line.nota = 'Para ' + b.name + ' · GRATIS · ' + p.titulo; } }
          draft.items.push(line);
        }
        if (cuestaPts(p)) draft.canjesNuevos.push({ promo: p.id, titulo: p.titulo, puntos: cuestaPts(p), valor: 0 });
      } else {
        const inp = body.querySelector(`[data-pv="${p.id}"]`), v = Math.round(parseFloat(inp && inp.value) || 0);
        if (!(v > 0)) { aviso = `⚠ Escribe el valor del descuento de ${p.titulo}.`; return; }
        draft.descuento = (Number(draft.descuento) || 0) + v;
        draft.descuentos.push({ motivo: 'Promo cliente leal: ' + p.titulo, valor: v, promo: p.id });
        if (cuestaPts(p)) draft.canjesNuevos.push({ promo: p.id, titulo: p.titulo, puntos: cuestaPts(p), valor: v });
      }
      draft.aplicadas.push(p.titulo);
    }
    // si se quita una promo aplicada aquí, tampoco se cobran sus puntos
    function soltarPts(titulo) {
      if (draft.items.some((i) => i.regalo === titulo) || draft.descuentos.some((x) => titDe(x) === titulo)) return;
      draft.canjesNuevos = draft.canjesNuevos.filter((c) => c.titulo !== titulo);
      draft.aplicadas = draft.aplicadas.filter((t) => t !== titulo);
    }

    /* ---- cliente del club ---- */
    function clubHtml() {
      if (draft.cuenta) {
        const c = draft.cuenta;
        return `<div class="ed-club on">⭐ <b>Parte del Club SMASH</b> · ${esc(c.nombre || '')}${c.usuario ? ' @' + esc(c.usuario) : ''}${c.puntos != null ? ' · ' + esc(c.puntos) + ' pts' : ''}${o.cuenta ? '' : ' <button type="button" class="btn-sm" data-ed="clubno">Quitar</button>'}</div>`;
      }
      if (!N || !N.panelBuscarCliente) return '<p class="hint">Sin conexión con la nube: no se puede buscar al cliente del club.</p>';
      return `<div class="ed-add"><input id="edClubQ" placeholder="¿Es del club? Teléfono o correo del cliente" autocomplete="off"><button type="button" data-ed="club">Buscar</button></div>
        ${club.lista.map((c, i) => `<button type="button" class="cr-club-op" data-ed="clubsi" data-i="${i}"><b>${esc(c.nombre || c.correo)}</b><small>${esc([c.telefono, c.correo].filter(Boolean).join(' · '))} · ${esc(c.puntos || 0)} pts</small></button>`).join('')}
        ${club.msg ? `<small class="hint">${esc(club.msg)}</small>` : ''}`;
    }
    async function buscarClub() {
      const q = (body.querySelector('#edClubQ') || {}).value || '';
      if (q.replace(/\D/g, '').length < 7 && !/@/.test(q)) { club = { lista: [], msg: 'Escribe el teléfono (10 dígitos) o el correo.' }; render(); return; }
      club = { lista: [], msg: 'Buscando…' }; render();
      let r; try { r = await N.panelBuscarCliente(q.trim()); } catch (e) { r = { ok: false, error: 'Sin internet' }; }
      if (!r.ok) club = { lista: [], msg: r.error || 'No se pudo buscar.' };
      else if (!r.lista.length) club = { lista: [], msg: 'No hay ningún cliente del club con ese teléfono o correo.' };
      else if (r.lista.length === 1) { draft.cuenta = r.lista[0]; club = { lista: [], msg: '' }; }
      else club = { lista: r.lista, msg: 'Elige al cliente:' };
      render();
    }

    function filaItem(it, i) {
      const g = !!it.regalo, b = !g && esBurger(it);
      return `
          <div class="ed-row${g ? ' ed-gift' : ''}">
            <div class="ed-name">${g ? `<b class="ed-gift-t">🎁 GRATIS · ${esc(it.regalo)}</b>` : ''}${esc(it.para ? 'Combo para ' + it.para : it.name)}
              ${b && combo ? ` <button type="button" class="btn-sm ed-combo" data-ed="combo" data-i="${i}">+ Combo</button>` : ''}</div>
            <div class="ed-ctl">
              ${g ? '<span class="ed-free">Gratis</span>' : `<label class="ed-price" title="Precio por unidad">$<input type="number" min="0" step="100" inputmode="numeric" data-price="${i}" value="${esc(it.price)}"></label>`}
              <div class="qty-mini"><button type="button" data-ed="minus" data-i="${i}" aria-label="Menos">−</button><b>${esc(it.qty)}</b><button type="button" data-ed="plus" data-i="${i}" aria-label="Más">+</button></div>
            </div>
            <input class="ed-note" data-i="${i}" maxlength="200" placeholder="Nota de este producto (sin cebolla, término…)" value="${esc(g ? String(it.nota || '').replace(/(^| · )GRATIS · .*$/, '') : it.nota || '')}">
            <button type="button" class="ed-rm" data-ed="rm" data-i="${i}" aria-label="Quitar producto">✕</button>
          </div>`;
    }
    function render() {
      const regs = draft.items.map((it, i) => [it, i]);
      body.innerHTML = `
        <div class="ed-grid">
          <label>Cliente<input data-f="cliente" maxlength="80" value="${esc(draft.cliente)}"></label>
          <label>Teléfono<input data-f="telefono" maxlength="20" value="${esc(draft.telefono)}"></label>
          <label class="ed-wide">Dirección<input data-f="direccion" maxlength="200" value="${esc(draft.direccion)}"></label>
        </div>
        <h4>⭐ Cliente del club</h4>
        <div id="edClub">${clubHtml()}</div>
        <h4>Productos</h4>
        <div class="ed-items">${regs.filter(([it]) => !it.regalo).concat(regs.filter(([it]) => it.regalo)).map(([it, i]) => filaItem(it, i)).join('') || '<p class="hint">Sin productos: agrega al menos uno.</p>'}</div>
        ${adiciones.length ? `<div class="ed-chips"><span>Adiciones:</span>${adiciones.map((p) => `<button type="button" class="btn-sm" data-ed="addp" data-id="${esc(p.id)}">+ ${esc(p.name)} <small>${fmt(p.price)}</small></button>`).join('')}</div>` : ''}
        <div class="ed-add"><select id="edSel">${products.map((p) => `<option value="${esc(p.id)}">${esc(p.name)} · ${fmt(p.price)}</option>`).join('')}</select>
          <button type="button" data-ed="add">+ Agregar producto</button></div>
        <h4>⭐ Promo del día</h4>
        <div class="ed-promos">${promoHtmlEd()}</div>
        ${draft.descuentos.length ? `<div class="ed-desc-l">${draft.descuentos.map((x, i) => `<div class="ed-desc-i"><span>⭐ ${esc(titDe(x) || 'Descuento')}</span><span>−${fmt(x.valor)} <button type="button" class="ed-rm" data-ed="rmdesc" data-i="${i}" aria-label="Quitar promo">✕</button></span></div>`).join('')}</div>` : ''}
        ${draft.canjesNuevos.length ? `<p class="hint">Al guardar se descuentan ${draft.canjesNuevos.reduce((s, c) => s + c.puntos, 0)} puntos ${draft.cuenta ? 'de la cuenta del cliente' : '(el pedido no tiene cuenta del club: busca al cliente arriba)'}.</p>` : ''}
        ${aviso ? `<p class="error">${esc(aviso)}</p>` : ''}
        <div class="ed-grid">
          <label>Descuento total<input type="number" min="0" step="100" inputmode="numeric" data-f="descuento" value="${esc(draft.descuento || '')}" placeholder="0"></label>
          <label>Valor del domicilio${variable ? ' (agencia)' : ''}${o.zona ? ` <small>· ${esc(o.zona)}</small>` : ''}<input type="number" min="0" step="500" inputmode="numeric" data-f="domicilio" value="${esc(draft.domicilio)}"></label>
        </div>
        <label class="ed-wide">Notas del pedido<textarea data-f="notas" maxlength="300">${esc(draft.notas)}</textarea></label>
        <div class="ed-total" id="edTotal">${totalHtml()}</div>`;
    }
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-ed]'); if (!b) return;
      const i = parseInt(b.dataset.i, 10), a = b.dataset.ed, it = draft.items[i];
      if (a === 'minus' && it.qty > 1) it.qty--;
      else if (a === 'plus' && it.qty < 50) it.qty++;
      else if (a === 'rm') { draft.items.splice(i, 1); if (it.regalo) soltarPts(it.regalo); }
      else if (a === 'add' || a === 'addp') {
        const p = prodDe(a === 'add' ? body.querySelector('#edSel').value : b.dataset.id);
        if (!p) return;
        const igual = draft.items.find((x) => x.id === p.id && !x.regalo && !x.para && !x.nota);
        if (igual && p.categoria !== 'hamburguesa') igual.qty = Math.min(50, igual.qty + 1);
        else draft.items.push({ id: p.id, name: p.name, price: p.price, qty: 1, cat: p.categoria });
      } else if (a === 'combo' && combo) {
        const ya = draft.items.find((x) => x.id === combo.id && !x.regalo && x.paraId === it.id);
        if (ya) ya.qty = Math.min(50, ya.qty + 1);
        else draft.items.splice(i + 1, 0, { id: combo.id, name: combo.name, price: combo.price, qty: 1, cat: 'combo', nota: 'Para ' + it.name, para: it.name, paraId: it.id });
      } else if (a === 'rmdesc') {
        const x = draft.descuentos.splice(i, 1)[0];
        draft.descuento = Math.max(0, (Number(draft.descuento) || 0) - (Number(x && x.valor) || 0));
        soltarPts(titDe(x));
      } else if (a === 'promo') {
        const p = vigentes().find((x) => String(x.id) === b.dataset.p); if (!p) return;
        aplicar(p, b.dataset.g);
      } else if (a === 'club') { buscarClub(); return; }
      else if (a === 'clubsi') { draft.cuenta = club.lista[i]; club = { lista: [], msg: '' }; }
      else if (a === 'clubno') draft.cuenta = null;
      else return;
      render();
    });
    body.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'edClubQ') { e.preventDefault(); buscarClub(); } });
    body.addEventListener('input', (e) => {
      const t = e.target;
      if (t.dataset.f) draft[t.dataset.f] = t.dataset.f === 'descuento' ? (parseFloat(t.value) || 0) : t.value;
      else if (t.dataset.price != null) draft.items[parseInt(t.dataset.price, 10)].price = Math.max(0, parseFloat(t.value) || 0);
      else if (t.classList.contains('ed-note')) {
        const it = draft.items[parseInt(t.dataset.i, 10)];
        it.nota = it.regalo ? (t.value.trim() ? t.value.trim() + ' · ' : '') + 'GRATIS · ' + it.regalo : t.value;
      } else return;
      body.querySelector('#edTotal').innerHTML = totalHtml();
    });
    render();
    if (N) cargarPromosEd().then(() => { if (openModal === m) render(); });
  }

  /* ---------- acciones de la tarjeta ---------- */
  function init(c) {
    cfg = Object.assign(cfg, c);
    document.addEventListener('click', (e) => {
      const b = e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      const id = parseInt(b.dataset.id, 10), o = SmashDB.getOrderById(id);
      if (!o) return;
      switch (b.dataset.act) {
        case 'print': SmashExt.updateOrder(id, { impresa: true, impresaEn: o.impresaEn || new Date().toISOString() }); cfg.print(id); cfg.refresh(); break;
        case 'pdf': cfg.pdf(id); break;
        case 'remote':   // imprimir en la térmica del negocio desde otro equipo
          if (typeof SmashImpRemota === 'undefined') break;
          SmashImpRemota.enviar(o).then((r) => { if (r && r.ok) { SmashExt.updateOrder(id, { impresa: true, impresaEn: o.impresaEn || new Date().toISOString() }); cfg.refresh(); } });
          break;
        case 'puntos': SmashLealesUI.sumarDePedido(o, () => cfg.refresh()); break;
        case 'advance': {
          if (o.status !== b.dataset.status) { cfg.refresh(); break; } // la tarjeta estaba desactualizada (otra pestaña)
          const st = NEXT[o.status];
          if (!st) break;
          if (st === 'en_camino' && !o.repartidor) { openRepartidor(o, st); break; }
          // Al entregar se cobra de una vez: se abre el cobro y el pedido queda entregado al registrar el pago
          if (st === 'entregado' && typeof SmashCajaUI !== 'undefined' && typeof SmashCaja !== 'undefined' && SmashCaja.estadoPago(o).k === 'pendiente') {
            SmashCajaUI.openPago(o, { entregar: () => { const x = SmashDB.getOrderById(id); if (x && x.status !== 'entregado' && x.status !== 'cancelado') SmashExt.setStatus(id, 'entregado'); cfg.refresh(); } });
            break;
          }
          SmashExt.setStatus(id, st);
          // Al entrar a preparación se descuentan los insumos de la receta (una sola vez por pedido)
          if (st === 'preparando' && typeof SmashInv !== 'undefined') {
            try { SmashInv.consumirPedido(SmashDB.getOrderById(id), cfg.who); } catch (err) { alert('El pedido pasó a preparación, pero no se pudo descontar el inventario: ' + err.message); }
          }
          cfg.refresh(); break;
        }
        case 'edit':
          // Un pedido pagado no se edita: el cobro dejaría de cuadrar con caja
          if (typeof SmashCaja !== 'undefined' && SmashCaja.pagoDe(o)) { alert('Este pedido ya está pagado. Si hay que cambiarlo, primero anula el pago en "Ver pago" (dentro del mismo turno).'); break; }
          openEditor(o); break;
        case 'rep': openRepartidor(o); break;
        case 'dom': {
          // Si el cliente le pagó el domicilio a SMASH, cambiarlo descuadraría caja
          const pg = typeof SmashCaja !== 'undefined' ? SmashCaja.pagoDe(o) : null;
          if (pg && pg.domicilio) { alert('Este pedido ya se cobró incluyendo el domicilio. Para corregirlo, primero anula el pago en "Ver pago" (dentro del mismo turno).'); break; }
          openDomicilio(o); break;
        }
        case 'nov': openNovedad(o); break;
        case 'pay': if (typeof SmashCajaUI !== 'undefined') SmashCajaUI.openPago(o); break;
        case 'cancel': openCancelar(o); break;
      }
    });
  }

  /* ---------- caja diaria: efectivo vs transferencia (sin domicilio) ---------- */
  function caja(day) {
    if (typeof SmashCaja !== 'undefined') return cajaReal(day);
    const orders = SmashDB.getOrders().filter((o) => SmashExt.localDay(o.creado) === day && C.valido(o));
    const by = { Efectivo: { n: 0, v: 0 }, Transferencia: { n: 0, v: 0 }, Otro: { n: 0, v: 0 } };
    let dom = 0;
    orders.forEach((o) => { const k = by[o.pago] ? o.pago : 'Otro'; by[k].n++; by[k].v += o.subtotal - (o.descuento || 0); dom += o.domicilio || 0; });
    const total = by.Efectivo.v + by.Transferencia.v + by.Otro.v;
    const box = (label, d) => `<div class="summary-box"><div class="label">${label}</div><div class="value">${fmt(d.v)}</div><div class="sub">${d.n} ${d.n === 1 ? 'pedido' : 'pedidos'}</div></div>`;
    return `${box('💵 Efectivo', by.Efectivo)}${box('🏦 Transferencia', by.Transferencia)}
      <div class="summary-box"><div class="label">Total productos</div><div class="value">${fmt(total)}</div><div class="sub">${orders.length} ${orders.length === 1 ? 'pedido' : 'pedidos'}</div></div>
      ${by.Otro.n ? box('Sin medio de pago', by.Otro) : ''}
      <p class="hint caja-note">Estos valores no incluyen domicilios. Domicilios del día (aparte): ${fmt(dom)}.</p>`;
  }
  // Con el módulo de caja: dinero realmente cobrado ese día por medio de pago. Los pedidos anteriores
  // al módulo se suman por el medio de pago que anunció el cliente (como antes).
  function cajaReal(day) {
    const SC = SmashCaja, res = SC.resumenPeriodo(day, day), pagos = SC.getPagos();
    const del = SmashDB.getOrders().filter((o) => SmashExt.localDay(o.creado) === day && C.valido(o));
    const vm = res.ventasPorMetodo; // solo productos: los domicilios nunca suman aquí
    const by = { efectivo: { n: 0, v: vm.efectivo }, transferencia: { n: 0, v: vm.transferencia }, otro: { n: 0, v: vm.otro } };
    SC.getPagos().filter((p) => !p.anulado && SmashExt.localDay(p.en) === day).forEach((p) => p.lineas.forEach((l) => by[l.metodo].n++));
    let pendV = 0, pendN = 0;
    del.forEach((o) => {
      const e = SC.estadoPago(o, pagos);
      if (e.k === 'antiguo') { const k = /transf/i.test(o.pago) ? 'transferencia' : /efect/i.test(o.pago) ? 'efectivo' : 'otro'; by[k].v += o.subtotal; by[k].n++; }
      if (e.k === 'pendiente') { pendV += SC.montoACobrar(o, false); pendN++; }
    });
    const box = (label, d, extra) => `<div class="summary-box"><div class="label">${label}</div><div class="value">${fmt(d.v)}</div><div class="sub">${extra || d.n + (d.n === 1 ? ' pago' : ' pagos')}</div></div>`;
    return `${box('💵 Efectivo', by.efectivo)}${box('🏦 Transferencia', by.transferencia)}${by.otro.v ? box('Otros medios', by.otro) : ''}
      ${box('Total cobrado', { v: by.efectivo.v + by.transferencia.v + by.otro.v }, del.length + (del.length === 1 ? ' pedido del día' : ' pedidos del día'))}
      ${pendN ? `<div class="summary-box"><div class="label">⚠ Pendiente de pago</div><div class="value neg">${fmt(pendV)}</div><div class="sub">${pendN} ${pendN === 1 ? 'pedido' : 'pedidos'}</div></div>` : ''}
      <p class="hint caja-note">Cobrado ese día por productos, por medio de pago. No incluye domicilios${res.domicilios ? ` (aparte: ${fmt(res.domicilios)} de domicilios que el cliente pagó a SMASH, son del domiciliario)` : ''}. Domicilios de los pedidos del día: ${fmt(del.reduce((s, o) => s + (o.domicilio || 0), 0))}.</p>`;
  }

  return { init, card, fila, detalle, caja, fmtMs, timerHtml, tick, esc, fmt, openCancelar, modal, closeModal, refresh: () => cfg.refresh(), who: () => cfg.who };
})();
