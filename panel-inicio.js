/* ============================================================
   SMASH · panel-inicio.js  (cocina y dueños)
   Encabezado de bienvenida de la pantalla de Pedidos: saludo,
   fecha y hora, pedidos en curso y accesos rápidos.
   Solo muestra datos que ya existen y usa los mismos botones
   del menú, así que no cambia cómo funciona el panel.
   ============================================================ */
(function () {
  'use strict';
  const hero = document.querySelector('[data-ph]');
  if (!hero) return;
  const $ = (s) => hero.querySelector(s);
  const may = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  /* ---- Saludo, fecha y hora ---- */
  function reloj() {
    const d = new Date(), h = d.getHours();
    $('[data-ph-saludo]').textContent = h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches';
    try {
      $('[data-ph-fecha]').textContent = hero.dataset.phPanel + ' · ' + may(d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }));
      $('[data-ph-hora]').textContent = d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
    } catch (e) { /* navegador viejo: queda el texto base */ }
  }

  /* ---- Nombre de quien entró (sin el emoji; un correo no se muestra) ---- */
  const nombreEl = document.getElementById('staffName');
  function nombre() {
    const t = (nombreEl ? nombreEl.textContent : '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
    $('[data-ph-nombre]').textContent = t && !t.includes('@') ? ', ' + t : '';
  }
  if (nombreEl) new MutationObserver(nombre).observe(nombreEl, { childList: true, characterData: true, subtree: true });

  /* ---- Pedidos en curso (el mismo número del menú) ---- */
  const cuenta = document.querySelector('.nav-count[data-count="encurso"]');
  function curso() {
    const n = cuenta ? parseInt(cuenta.textContent, 10) || 0 : 0;
    $('[data-ph-curso]').textContent = n;
    hero.classList.toggle('con-pedidos', n > 0);
  }
  if (cuenta) new MutationObserver(curso).observe(cuenta, { childList: true, characterData: true, subtree: true });

  /* ---- Accesos rápidos ---- */
  hero.addEventListener('click', (e) => {
    const b = e.target.closest('.ph-btn');
    if (!b) return;
    if (b.dataset.ir) {
      const nav = document.querySelector('.nav-btn[data-section="' + b.dataset.ir + '"]');
      if (nav) { nav.click(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
      return;
    }
    if (b.hasAttribute('data-ph-wa')) {
      const box = document.querySelector('#section-pendientes details.import-box');
      if (!box) return;
      box.open = true;
      box.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const t = document.getElementById('importText');
      if (t) setTimeout(() => t.focus({ preventScroll: true }), 300);
    }
  });

  reloj(); nombre(); curso();
  setInterval(() => { if (!hero.closest('.panel-section').hidden) reloj(); }, 30000);
})();
