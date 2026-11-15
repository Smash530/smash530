/* ============================================================
   SMASH · smash-mapa.js  (paneles y página del domiciliario)
   Carga el mapa (Leaflet + calles de OpenStreetMap, gratis
   y sin clave) solo cuando se necesita, y da ayudas comunes.
   ============================================================ */
const SmashMapa = (function () {
  'use strict';
  const LF = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/';
  let carga = null;
  function cargar() {
    if (window.L && window.L.map) return Promise.resolve(window.L);
    if (carga) return carga;
    carga = new Promise((ok, mal) => {
      const css = document.createElement('link');
      css.rel = 'stylesheet'; css.href = LF + 'leaflet.min.css';
      document.head.appendChild(css);
      const css2 = document.createElement('link');
      css2.rel = 'stylesheet'; css2.href = 'smash-mapa.css';
      document.head.appendChild(css2);
      const s =document.createElement('script');
      s.src = LF + 'leaflet.min.js'; s.async = true;
      s.onload = () => ok(window.L);
      s.onerror = () => { carga = null; mal(new Error('No se pudo cargar el mapa (revisa el internet).')); };
      document.head.appendChild(s);
    });
    return carga;
  }
  const oscuro = (forzar) => forzar === 'oscuro' || (forzar !== 'claro' && (
    document.documentElement.dataset.theme === 'dark' ||
    (document.documentElement.dataset.theme !== 'light' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches)));
  // Crea un mapa en "el". tema: 'oscuro' | 'claro' | undefined (según el equipo)
  async function crear(el, opc) {
    const L = await cargar();
    opc = opc || {};
    const m = L.map(el, { zoomControl: opc.zoom !== false, attributionControl: true, preferCanvas: true });
    // Calles de OpenStreetMap (gratis, sin clave). En tema oscuro se oscurecen con un filtro (smash-mapa.css)
    if (oscuro(opc.tema)) el.classList.add('sm-oscuro');
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
    }).addTo(m);
    m.attributionControl.setPrefix('');
    m.setView(opc.centro || [4.6, -74.08], opc.nivel || 5);
    return m;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Marcador redondo con la inicial; clase: 'cam' | 'asg' | 'viejo' | 'yo' | 'negocio'
  function icono(texto, clase, rumbo) {
    return window.L.divIcon({
      className: 'sm-pin-wrap', iconSize: [40, 40], iconAnchor: [20, 20], popupAnchor: [0, -20],
      html: `<div class="sm-pin ${clase || ''}">${rumbo != null && !isNaN(rumbo) ? `<i class="sm-rumbo" style="transform:rotate(${Math.round(rumbo)}deg)"></i>` : ''}<span>${esc(texto)}</span></div>`,
    });
  }
  const hace = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    return s < 60 ? 'hace ' + s + ' s' : s < 3600 ? 'hace ' + Math.round(s / 60) + ' min' : 'hace ' + Math.floor(s / 3600) + ' h';
  };
  return { cargar, crear, icono, hace, esc };
})();
