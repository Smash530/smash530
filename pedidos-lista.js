/* ============================================================
   SMASH · pedidos-lista.js  (cocina y dueños)
   - "Pedidos": TODOS los pedidos en curso (recibido, confirmado,
     en preparación, listo y en camino) en un listado horizontal,
     con filtros por estado y buscador.
   - "Finalizados": pedidos entregados (y cancelados) por fecha.
   - Al tocar un pedido se abre a la derecha su ficha completa con
     los datos y todas las opciones (confirmar, cobrar, imprimir,
     editar, repartidor, cancelar...). Las acciones son las mismas
     de siempre (orders-ui.js), solo cambia cómo se ven.
   ============================================================ */
const SmashLista = (function () {
  const esc = SmashUI.esc, fmt = SmashUI.fmt, C = SmashComandas;
  const $ = (id) => document.getElementById(id);
  const EN_CURSO = ['nuevo', 'confirmado', 'preparando', 'listo', 'en_camino'];
  const FILTROS = [['', 'Todos'], ['nuevo', 'Recibidos'], ['confirmado', 'Confirmados'], ['preparando', 'En preparación'], ['listo', 'Listos'], ['en_camino', 'En camino']];
  const hoy = () => SmashExt.localDay(new Date().toISOString());
  const diaMas = (dia, n) => { const d = new Date(dia + 'T12:00:00'); d.setDate(d.getDate() + n); return SmashExt.localDay(d.toISOString()); };
  const diaTxt = (dia) => new Date(dia + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  /* "Pedidos" muestra solo los pedidos del día de servicio de hoy. Los de días anteriores
     pasan al historial (sus datos no se borran). Una reserva hecha anoche después del
     cierre es del día siguiente: aparece hoy con número de hoy (ver SmashExt.diaServicio). */
  const enCursoHoy = (o) => EN_CURSO.indexOf(o.status) > -1 && SmashExt.diaServicio(o) === hoy();
  const S ={ filtro: '', buscar: '', finDia: hoy(), finTipo: 'entregado', finBuscar: '', abierto: null, firma: '' };

  const coincide = (o, t) => !t || [o.cliente, o.telefono, o.direccion, o.zona, o.ref, '#' + (o.numeroDia || o.id), o.repartidor].join(' ').toLowerCase().includes(t);

  /* ---------------- Pedidos en curso ---------------- */
  function montarActivos() {
    const root = $('pedidosLista');
    if (!root || root.dataset.ok) return;
    root.dataset.ok = '1';
    root.innerHTML = `
      <details class="vh-box" id="vhBox" open>
        <summary><span class="vh-tit">📊 Ventas de hoy</span><span class="vh-res" id="vhRes"></span></summary>
        <div class="fn-kpis" id="vhKpis"></div>
        <div class="vh-prods" id="vhProds"></div>
      </details>
      <div class="ol-bar">
        <div class="ol-chips" id="olChips" role="tablist"></div>
        <input type="search" id="olBuscar" class="ol-search" placeholder="Buscar cliente, teléfono, # …" aria-label="Buscar pedido">
      </div>
      <div class="ol-head" aria-hidden="true"><span>#</span><span>Estado</span><span>Cliente</span><span>Pedido</span><span>Total</span><span>Tiempo</span><span></span></div>
      <div class="ol-list" id="olList"></div>`;
    $('olChips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; S.filtro = b.dataset.f; render(); });
    $('olBuscar').addEventListener('input', (e) => { S.buscar = e.target.value.trim().toLowerCase(); render(); });
  }
  /* Ventas de hoy: productos vendidos en el día (sin cancelados) */
  function renderVentasHoy() {
    if (!$('vhKpis')) return;
    const dia = hoy();
    const ped = SmashDB.getOrders().filter((o) => SmashExt.diaServicio(o) === dia && C.valido(o));
    const productos = SmashDB.getProducts();
    const por = {};
    let unidades = 0, burgers = 0;
    ped.forEach((o) => (o.items || []).forEach((it) => {
      const q = Number(it.qty) || 0;
      const p = productos.find((x) => x.id === it.id);
      const k = it.id || it.name;
      if (!por[k]) por[k] = { nombre: (p && p.name) || it.name || k, qty: 0, valor: 0 };
      por[k].qty += q;
      por[k].valor += q * (Number(it.price) || 0);
      unidades += q;
      if (p && p.categoria === 'hamburguesa') burgers += q;
    }));
    const vendido = ped.reduce((s, o) => s + (o.total || 0), 0);
    $("vhRes").textContent = `${burgers} hamburguesa${burgers === 1 ? "" : "s"} · ${ped.length} pedido${ped.length === 1 ? "" : "s"} · ${fmt(vendido)}`;
    $('vhKpis').innerHTML = `
      <div class="fn-kpi"><small>Hamburguesas (cupo)</small><b>${burgers}</b></div>
      <div class="fn-kpi"><small>Combos y adicionales</small><b>${unidades - burgers}</b></div>
      <div class="fn-kpi"><small>Pedidos</small><b>${ped.length}</b></div>
      <div class="fn-kpi"><small>Vendido hoy</small><b>${fmt(vendido)}</b></div>`;
    const filas = Object.values(por).sort((a, b) => b.qty - a.qty);
    $('vhProds').innerHTML = filas.length
      ? filas.map((f) => `<div class="vh-prod"><b>${f.qty}</b><span>${esc(f.nombre)}</span><small>${fmt(f.valor)}</small></div>`).join('')
      : '<p class="hint" style="margin:0">Todavía no hay ventas hoy.</p>';
  }

  function renderActivos() {
    montarActivos();
    if (!$('olList')) return;
    renderVentasHoy();
    const todos = SmashDB.getOrders().filter(enCursoHoy);
    $('olChips').innerHTML = FILTROS.map(([k, n]) => {
      const c = k ? todos.filter((o) => o.status === k).length : todos.length;
      return `<button type="button" class="ol-chip${S.filtro === k ? ' on' : ''}${k ? ' st-' + k : ''}" data-f="${k}">${n}<span>${c}</span></button>`;
    }).join('');
    // El último pedido que entró va de primero; los demás bajan
    const lista = todos.filter((o) => (!S.filtro || o.status === S.filtro) && coincide(o, S.buscar)).sort((a, b) => b.id - a.id);
    $('olList').innerHTML = lista.length ? lista.map((o) => SmashUI.fila(o, { activo: o.id === S.abierto })).join('')
      : `<div class="ol-empty"><b>${todos.length ? 'Ningún pedido coincide' : 'No hay pedidos en curso'}</b><span>${todos.length ? 'Cambia el filtro o la búsqueda.' : 'Los pedidos nuevos aparecen aquí solos.'}</span></div>`;
  }

  /* ---------------- Finalizados ---------------- */
  function montarFinalizados() {
    const root = $('finalizadosLista');
    if (!root || root.dataset.ok) return;
    root.dataset.ok = '1';
    root.innerHTML = `
      <div class="ol-bar">
        <div class="ol-chips" id="fnChips"></div>
        <div class="ol-tools"><button type="button" class="ol-today" id="fnAnt" aria-label="Día anterior">‹</button><input type="date" id="fnDia" class="ol-date" aria-label="Fecha"><button type="button" class="ol-today" id="fnSig" aria-label="Día siguiente">›</button><button type="button" class="ol-today" id="fnHoy">Hoy</button>
        <input type="search" id="fnBuscar" class="ol-search" placeholder="Buscar…" aria-label="Buscar pedido finalizado"></div>
      </div>
      <p class="hint fn-dia" id="fnDiaTxt"></p>
      <div class="fn-kpis" id="fnKpis"></div>
      <div class="ol-head" aria-hidden="true"><span>#</span><span>Estado</span><span>Cliente</span><span>Pedido</span><span>Total</span><span>Hora</span><span></span></div>
      <div class="ol-list" id="fnList"></div>`;
    $('fnDia').value = S.finDia;
    $('fnDia').addEventListener('change', (e) => { S.finDia = e.target.value || hoy(); render(); });
    $('fnHoy').addEventListener('click', () => { S.finDia = hoy(); $('fnDia').value = S.finDia; render(); });
    $('fnAnt').addEventListener('click', () => { S.finDia = diaMas(S.finDia, -1); $('fnDia').value = S.finDia; render(); });
    $('fnSig').addEventListener('click', () => { if (S.finDia >= hoy()) return; S.finDia = diaMas(S.finDia, 1); $('fnDia').value = S.finDia; render(); });
    $('fnBuscar').addEventListener('input', (e) => { S.finBuscar = e.target.value.trim().toLowerCase(); render(); });
    $('fnChips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (!b) return; S.finTipo = b.dataset.f; render(); });
  }
  function renderFinalizados() {
    montarFinalizados();
    if (!$('fnList')) return;
    // Todos los pedidos del día elegido; los que siguen en curso de días pasados salen como "Sin cerrar"
    const delDia = SmashDB.getOrders().filter((o) => SmashExt.diaServicio(o) === S.finDia && (o.status === 'entregado' || o.status === 'cancelado' || !enCursoHoy(o)));
    const ent = delDia.filter((o) => o.status === 'entregado'), can = delDia.filter((o) => o.status === 'cancelado');
    const abiertos = delDia.filter((o) => EN_CURSO.indexOf(o.status) > -1);
    const chips = [['entregado', 'Entregados', ent.length], ['cancelado', 'Cancelados', can.length]];
    if (abiertos.length || S.finTipo === 'abierto') chips.push(['abierto', 'Sin cerrar', abiertos.length]);
    chips.push(['', 'Todos', delDia.length]);
    $('fnChips').innerHTML = chips
      .map(([k, n, c]) => `<button type="button" class="ol-chip${S.finTipo === k ? ' on' : ''}${k && k !== 'abierto' ? ' st-' + k : k ? ' st-nuevo' : ''}" data-f="${k}">${n}<span>${c}</span></button>`).join('');
    $('fnSig').disabled = S.finDia >= hoy();
    $('fnDiaTxt').innerHTML = `<b>${esc(diaTxt(S.finDia))}</b>${S.finDia === hoy() ? ' · hoy' : ''} · ${delDia.length} pedido${delDia.length === 1 ? '' : 's'}${abiertos.length ? ` · <span style="color:var(--bad,#c62828)">${abiertos.length} ${abiertos.length === 1 ? 'quedó' : 'quedaron'} sin cerrar</span>` : ''}`;
    const tiempos = C.promedios(ent);
    $('fnKpis').innerHTML = `
      <div class="fn-kpi"><small>Entregados</small><b>${ent.length}</b></div>
      <div class="fn-kpi"><small>Vendido</small><b>${fmt(ent.reduce((s, o) => s + (o.total || 0), 0))}</b></div>
      <div class="fn-kpi"><small>Tiempo promedio</small><b>${tiempos.total ? C.dur(tiempos.total.prom) : '-'}</b></div>
      <div class="fn-kpi${can.length ? ' bad' : ''}"><small>Cancelados</small><b>${can.length}</b></div>`;
    const lista = delDia.filter((o) => (!S.finTipo || (S.finTipo === 'abierto' ? EN_CURSO.indexOf(o.status) > -1 : o.status === S.finTipo)) && coincide(o, S.finBuscar)).sort((a, b) => b.id - a.id);
    $('fnList').innerHTML = lista.length ? lista.map((o) => SmashUI.fila(o, { activo: o.id === S.abierto })).join('')
      : `<div class="ol-empty"><b>Sin pedidos ${S.finTipo === 'cancelado' ? 'cancelados' : S.finTipo === 'entregado' ? 'entregados' : S.finTipo === 'abierto' ? 'sin cerrar' : ''} este día</b><span>Usa las flechas o el calendario para ver otro día.</span></div>`;
  }

  /* ---------------- Panel lateral (ficha del pedido) ---------------- */
  let drawer = null;
  function crearDrawer() {
    if (drawer) return drawer;
    drawer = document.createElement('div');
    drawer.className = 'od-wrap';
    drawer.hidden = true;
    drawer.innerHTML = `<div class="od-backdrop" data-cerrar></div>
      <aside class="od-drawer" role="dialog" aria-modal="false" aria-label="Detalle del pedido">
        <button type="button" class="od-close" data-cerrar aria-label="Cerrar">✕</button>
        <div class="od-body" id="odBody"></div>
      </aside>`;
    document.body.appendChild(drawer);
    drawer.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]')) cerrar(); });
    return drawer;
  }
  function abrir(id) {
    S.abierto = id; S.firma = '';
    crearDrawer().hidden = false;
    document.body.classList.add('od-open');
    pintarDrawer();
    render();
    const b = drawer.querySelector('.od-drawer'); if (b) b.scrollTop = 0;
  }
  function cerrar() {
    S.abierto = null;
    if (drawer) drawer.hidden = true;
    document.body.classList.remove('od-open');
    render();
  }
  // Solo se repinta si el pedido cambió (para no mover la ficha mientras se usa)
  function pintarDrawer() {
    if (!drawer || S.abierto == null) return;
    const o = SmashDB.getOrderById(S.abierto);
    if (!o) { cerrar(); return; }
    const firma = JSON.stringify(o) + (typeof SmashCaja !== 'undefined' ? JSON.stringify(SmashCaja.estadoPago(o)) : '');
    if (firma === S.firma) return;
    S.firma = firma;
    const body = drawer.querySelector('#odBody'), y = drawer.querySelector('.od-drawer').scrollTop;
    body.innerHTML = SmashUI.detalle(o);
    drawer.querySelector('.od-drawer').scrollTop = y;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-act]')) return;              // los botones hacen su acción, no abren la ficha
    const r = e.target.closest('.ol-row[data-open]');
    if (r) abrir(parseInt(r.dataset.open, 10));
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.ol-row[data-open]')) { e.preventDefault(); abrir(parseInt(e.target.dataset.open, 10)); }
    if (e.key === 'Escape' && S.abierto != null && !document.querySelector('.smash-modal')) cerrar();
  }, true);   // antes que la ventana emergente: Escape cierra primero la ventana y luego la ficha

  function render() {
    try { SmashExt.arreglarNumerosHoy(); } catch (e) { /* sin datos */ }
    renderActivos();
    renderFinalizados();
    pintarDrawer();
    const n = SmashDB.getOrders().filter(enCursoHoy).length;
    document.querySelectorAll('[data-count="encurso"]').forEach((el) => { el.textContent = n || ''; });
  }
  /* Menú lateral en celular: se abre encima con fondo oscuro y se cierra al tocar fuera */
  const side = $('side');
  if (side) {
    new MutationObserver(() => document.body.classList.toggle('side-open', side.classList.contains('open'))).observe(side, { attributes: true, attributeFilter: ['class'] });
    document.addEventListener('click', (e) => {
      if (side.classList.contains('open') && !side.contains(e.target) && !e.target.closest('#menuToggle')) side.classList.remove('open');
    });
  }
  // Al cambiar de sección se cierra la ficha abierta
  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => { if (S.abierto != null) cerrar(); }));

  setInterval(render, 5000);
  window.addEventListener('storage', (e) => { if (e.key === SmashDB.KEYS.ORDERS) render(); });

  return { render, abrir, cerrar };
})();
