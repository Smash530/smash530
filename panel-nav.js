/* ============================================================
   SMASH · panel-nav.js  (cocina y dueños)
   Menú lateral por grupos desplegables (Operación, Ventas,
   Finanzas…), buscador de secciones y ruta arriba del contenido.
   Solo ordena y muestra el menú: los botones .nav-btn siguen
   siendo los mismos, así que cada módulo funciona igual que antes.
   ============================================================ */
(function () {
  'use strict';
  const nav = document.getElementById('panelNav');
  if (!nav || !nav.querySelector('.ng')) return;

  const svg = (p, c) => '<svg viewBox="0 0 24 24" aria-hidden="true"' + (c ? ' class="' + c + '"' : '') + '>' + p + '</svg>';
  const CHEV = '<path d="m6 9 6 6 6-6"/>';
  const FLECHA = '<path d="m9 18 6-6-6-6"/>';
  const LUPA = '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>';
  const MENU = '<path d="M4 6h16M4 12h16M4 18h10"/>';

  /* Iconos de línea de cada grupo */
  const GI = {
    operacion: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.07-2.14-.22-4.05 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.15.43-2.29 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    ventas: '<path d="m22 7-8.5 8.5-5-5L2 17"/><path d="M16 7h6v6"/>',
    finanzas: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
    menu: '<path d="M17 21a1 1 0 0 0 1-1v-5.35c0-.46.32-.84.73-1.04a4 4 0 0 0-2.14-7.59 5 5 0 0 0-9.18 0 4 4 0 0 0-2.14 7.59c.41.2.73.58.73 1.04V20a1 1 0 0 0 1 1Z"/><path d="M6 17h12"/>',
    clientes: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
    sistema: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/>'
  };
  /* Iconos de línea de cada sección */
  const IC = {
    pendientes: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4M12 16h4M8 11h.01M8 16h.01"/>',
    finalizados: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/>',
    crear: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/>',
    domicilios: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 7.5M5.5 17.5 9 10h6l3.5 7.5M9 10l-1.5-3H5"/>',
    historial: '<path d="M5 2v20l2.33-1.5L9.67 22 12 20.5 14.33 22l2.34-1.5L19 22V2l-2.33 1.5L14.33 2 12 3.5 9.67 2 7.33 3.5z"/><path d="M9 8h6M9 12h6M9 16h3"/>',
    caja: '<path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/>',
    cierres: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="m12 2 8 5H4z"/>',
    conteo: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    contabilidad: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    informes: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
    ventas: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
    top: '<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6M18 9h1.5a2.5 2.5 0 0 0 0-5H18M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0z"/>',
    gastos: '<path d="M22 17 13.5 8.5l-5 5L2 7"/><path d="M16 17h6v-6"/>',
    socios: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
    productos: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2M7 2v20M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3zm0 0v7"/>',
    inventario: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12M7.5 4.2l9 5.2"/>',
    recetas: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    costos: '<path d="M12.59 2.59A2 2 0 0 0 11.17 2H4a2 2 0 0 0-2 2v7.17a2 2 0 0 0 .59 1.42l8.7 8.7a2.43 2.43 0 0 0 3.42 0l6.58-6.58a2.43 2.43 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
    simulador: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M16 14v4M16 10h.01M12 10h.01M8 10h.01M12 14h.01M8 14h.01M12 18h.01M8 18h.01"/>',
    clientes: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    leales: '<path d="m12 2 3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01z"/>',
    promos: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5C10 3 12 8 12 8s2-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    avisos: '<path d="m3 11 18-5v12L3 14z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    personal: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="m16 11 2 2 4-4"/>',
    horario: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    auditoria: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="m9 12 2 2 4-4"/>',
    config: '<path d="M20 7h-9M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>'
  };

  const sinTilde = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const grupos = Array.from(nav.querySelectorAll('.ng'));
  const botones = Array.from(nav.querySelectorAll('.nav-btn'));
  const tituloDe = (g) => g.querySelector('.ng-t b').textContent;
  const etiqueta = (b) => (b.querySelector('.nl') || b).textContent.trim();

  /* ---- Encabezados de grupo ---- */
  grupos.forEach((g) => {
    const h = g.querySelector('.ng-head'), body = g.querySelector('.ng-body');
    const t = h.textContent.trim(), sub = h.dataset.sub || '';
    body.id = 'ngb-' + g.dataset.g;
    h.setAttribute('aria-controls', body.id);
    h.innerHTML = '<span class="ng-ic">' + svg(GI[g.dataset.g] || GI.sistema) + '</span>' +
      '<span class="ng-t"><b>' + t + '</b>' + (sub ? '<small>' + sub + '</small>' : '') + '</span>' +
      '<span class="ng-badge" hidden></span>' + svg(CHEV, 'ng-chev');
    h.addEventListener('click', () => abrir(g, !g.classList.contains('abierto')));
  });

  /* ---- Botones: icono de línea y texto aparte ---- */
  botones.forEach((b) => {
    const ni = b.querySelector('.ni');
    if (ni && IC[b.dataset.section]) ni.innerHTML = svg(IC[b.dataset.section]);
    Array.from(b.childNodes).forEach((n) => {
      if (n.nodeType === 3 && n.textContent.trim()) { const s = document.createElement('span'); s.className = 'nl'; s.textContent = n.textContent.trim(); b.replaceChild(s, n); }
    });
    b.title = etiqueta(b);
  });

  /* ---- Abrir / cerrar (uno a la vez) ---- */
  let buscando = false;
  function abrir(g, si) {
    if (si && !buscando) grupos.forEach((o) => { if (o !== g) marcar(o, false); });
    marcar(g, si);
  }
  function marcar(g, si) {
    g.classList.toggle('abierto', si);
    g.querySelector('.ng-head').setAttribute('aria-expanded', si ? 'true' : 'false');
    g.querySelector('.ng-body').inert = !si;
  }

  /* ---- Ruta arriba del contenido y botón Menú del celular ---- */
  const content = document.querySelector('#dashboardSection .content');
  const ruta = document.createElement('div');
  ruta.className = 'pn-ruta';
  if (content) content.insertBefore(ruta, content.firstChild);
  const toggle = document.getElementById('menuToggle');
  function actual() {
    const b = nav.querySelector('.nav-btn.active') || botones[0];
    const g = b.closest('.ng');
    grupos.forEach((o) => o.classList.toggle('tiene-activo', o === g));
    ruta.innerHTML = '<span>' + tituloDe(g) + '</span>' + svg(FLECHA) + '<b>' + etiqueta(b) + '</b>';
    if (toggle) toggle.innerHTML = svg(MENU) + '<span>Menú</span><em>' + etiqueta(b) + '</em>';
    return g;
  }
  nav.addEventListener('click', (e) => {
    const b = e.target.closest('.nav-btn');
    if (!b) return;
    if (buscando) limpiar();
    setTimeout(() => { const g = actual(); if (!g.classList.contains('abierto')) abrir(g, true); }, 0);
  });

  /* ---- Buscador de secciones ---- */
  const caja = document.createElement('div');
  caja.className = 'pn-buscar';
  caja.innerHTML = svg(LUPA) + '<input type="search" placeholder="Buscar sección" aria-label="Buscar sección" autocomplete="off" spellcheck="false"><kbd>/</kbd>';
  nav.insertBefore(caja, nav.firstChild);
  const vacio = document.createElement('p');
  vacio.className = 'pn-vacio'; vacio.hidden = true; vacio.textContent = 'Sin resultados';
  nav.appendChild(vacio);
  const input = caja.querySelector('input');
  let antes = [];

  function filtrar() {
    const q = sinTilde(input.value);
    if (!q) { limpiar(true); return; }
    if (!buscando) { antes = grupos.filter((g) => g.classList.contains('abierto')); buscando = true; nav.classList.add('buscando'); }
    let total = 0;
    grupos.forEach((g) => {
      const enGrupo = sinTilde(tituloDe(g)).includes(q);
      let n = 0;
      g.querySelectorAll('.nav-btn').forEach((b) => { const ok = enGrupo || sinTilde(etiqueta(b)).includes(q); b.hidden = !ok; if (ok) n++; });
      g.hidden = !n; total += n;
      if (n) marcar(g, true);
    });
    vacio.hidden = total > 0;
  }
  function limpiar(dejarTexto) {
    if (!dejarTexto) input.value = '';
    buscando = false; nav.classList.remove('buscando'); vacio.hidden = true;
    botones.forEach((b) => (b.hidden = false));
    grupos.forEach((g) => { g.hidden = false; marcar(g, antes.includes(g)); });
    const g = actual(); if (!g.classList.contains('abierto') && !antes.length) abrir(g, true);
    antes = [];
  }
  // Primero la opción cuyo nombre coincide; si no, la primera visible
  function primero() {
    const q = sinTilde(input.value), vis = botones.filter((x) => !x.hidden && !x.closest('.ng').hidden);
    return vis.find((x) => sinTilde(etiqueta(x)).startsWith(q)) || vis.find((x) => sinTilde(etiqueta(x)).includes(q)) || vis[0];
  }
  input.addEventListener('input', filtrar);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { limpiar(); input.blur(); }
    if (e.key === 'Enter') { e.preventDefault(); const b = primero(); if (b) { limpiar(); b.click(); input.blur(); } }
    if (e.key === 'ArrowDown') { e.preventDefault(); const b = primero(); if (b) b.focus(); }
  });
  document.addEventListener('keydown', (e) => {
    const t = e.target, escribiendo = t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName));
    if ((e.key === '/' && !escribiendo && !e.ctrlKey && !e.metaKey && !e.altKey) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k')) {
      if (document.getElementById('dashboardSection').hidden) return;
      e.preventDefault();
      const side = document.getElementById('side');
      if (side && window.matchMedia('(max-width:820px)').matches) side.classList.add('open');
      input.focus(); input.select();
    }
  });

  /* ---- Contador de pedidos visible aunque el grupo esté cerrado ---- */
  function sumar() {
    grupos.forEach((g) => {
      let s = 0;
      g.querySelectorAll('.nav-count').forEach((c) => { s += parseInt(c.textContent, 10) || 0; });
      const badge = g.querySelector('.ng-badge');
      const txt = s ? String(s) : '';
      if (badge.textContent !== txt) badge.textContent = txt;
      badge.hidden = !s;
      g.classList.toggle('con-aviso', !!s);
    });
  }
  const obs = new MutationObserver(sumar);
  nav.querySelectorAll('.nav-count').forEach((c) => obs.observe(c, { childList: true, characterData: true, subtree: true }));

  /* ---- Estado inicial: solo el grupo de la sección abierta ---- */
  grupos.forEach((g) => marcar(g, false));
  abrir(actual(), true);
  sumar();
  requestAnimationFrame(() => nav.classList.add('pn-listo'));
})();
