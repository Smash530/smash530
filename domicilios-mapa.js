/* ============================================================
   SMASH · domicilios-mapa.js  (cocina y dueños)
   Mapa en vivo de los domiciliarios (lado izquierdo de la sección
   Domicilios). La lista de domiciliarios y sus rutas está a la
   derecha (domicilios-panel.js).
   - Se actualiza cada 5 s solo mientras la sección está abierta.
   - Gris: no llega señal hace más de 2 min, o el domiciliario salió
     de la página / apagó la pantalla.
   - "Ver en el mapa" (ficha del pedido o lista) centra al domiciliario.
   - Dueños: "Ubicar el negocio" y clic en el mapa. Se guarda en
     "smash_negocio_pos" y llega a todos los equipos.
   ============================================================ */
const SmashDomiMapa = (function () {
  'use strict';
  const N = typeof SmashDomiNube !== 'undefined' ? SmashDomiNube.panel : null;
  const ES_DUENO = /dueno/i.test(location.pathname);
  const K_NEG = 'smash_negocio_pos';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const VIEJO = 2 * 60000;
  let mapa = null, montando = false, capa = {}, neg = null, ubic = [], ajustado = false, foco = null, fijando = false, ultimo = null, error = '';

  const seccion = () => document.getElementById('section-domicilios');
  const visible = () => { const s = seccion(); return s && !s.hidden; };
  const negocio = () => { try { return JSON.parse(SmashLS.getItem(K_NEG) || 'null'); } catch (e) { return null; } };

  function tarjeta() {
    const slot = document.getElementById('dmMapaSlot');
    if (!slot) return null;
    if (!slot.firstChild) {
      slot.innerHTML = `<div class="dmm">
        <div class="dmm-mapa" id="dmMapa"><p class="dm-mapa-cargando">Cargando mapa…</p></div>
        <div class="dmm-top"><span class="dm-envivo"><i></i>En vivo</span><span class="dmm-act" id="dmMapaAct"></span></div>
        <div class="dmm-btns"><button type="button" class="dmm-b" data-todos title="Ver a todos">⤢ Todos</button>${ES_DUENO ? '<button type="button" class="dmm-b" data-negocio title="Marcar dónde queda el negocio">📍 Negocio</button>' : ''}</div>
        <p class="dmm-fijar" id="dmFijar" hidden>Toca el mapa donde queda el negocio <button type="button" class="dm-mini" data-cancelar-fijar>Cancelar</button></p>
        <div class="dmm-ley"><span><i class="cam"></i>En camino</span><span><i class="asg"></i>Asignado</span><span><i class="viejo"></i>Sin señal</span></div>
      </div>`;
      slot.querySelector('[data-todos]').addEventListener('click', () => { foco = null; ajustar(true); });
      const bn = slot.querySelector('[data-negocio]');
      if (bn) bn.addEventListener('click', () => { fijando = true; slot.querySelector('#dmFijar').hidden = false; if (mapa) mapa.getContainer().style.cursor = 'crosshair'; });
      slot.querySelector('[data-cancelar-fijar]').addEventListener('click', cancelarFijar);
    }
    return slot.firstChild;
  }
  function cancelarFijar() {
    fijando = false;
    const f = document.getElementById('dmFijar'); if (f) f.hidden = true;
    if (mapa) mapa.getContainer().style.cursor = '';
  }

  async function montar() {
    if (mapa || montando || typeof SmashMapa === 'undefined') return;
    const t = tarjeta(); if (!t) return;
    montando = true;
    try {
      const el = t.querySelector('#dmMapa');
      el.innerHTML = '';
      const n = negocio();
      mapa = await SmashMapa.crear(el, { centro: n ? [n.lat, n.lng] : undefined, nivel: n ? 14 : 5 });
      mapa.on('click', (e) => {
        if (!fijando) return;
        SmashLS.setItem(K_NEG, JSON.stringify({ lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }));
        cancelarFijar(); pintarNegocio(); ajustar(true);
      });
      mapa.on('dragstart', () => { foco = null; });
      pintarNegocio();
      await refrescar();
    } catch (e) {
      const el = t.querySelector('#dmMapa'); if (el) el.innerHTML = '<p class="dm-mapa-cargando">No se pudo cargar el mapa. Revisa el internet.</p>';
    }
    montando = false;
  }

  function pintarNegocio() {
    if (!mapa) return;
    const n = negocio();
    if (neg) { mapa.removeLayer(neg); neg = null; }
    if (n) neg = window.L.marker([n.lat, n.lng], { icon: SmashMapa.icono('S', 'negocio'), zIndexOffset: -100 }).addTo(mapa).bindPopup('<div class="sm-pop"><b>SMASH</b><small>El negocio</small></div>');
  }

  /* ---------------- Datos ---------------- */
  let trayendo = false;
  async function refrescar() {
    if (!N || !N.listo() || trayendo) return;
    trayendo = true;
    try {
      const r = await N.ubicaciones();
      if (r && r.ok) { ubic = r.lista || []; ultimo = new Date(); error = ''; }
      else error = (r && r.error) || 'Sin conexión';
    } catch (e) { error = 'Sin conexión'; }
    trayendo = false;
    pintar();
    window.dispatchEvent(new CustomEvent('smash:domi-ubic'));
  }

  const sinSenal = (u) => u.fondo || Date.now() - new Date(u.en).getTime() > VIEJO;
  function claseDe(u) {
    if (sinSenal(u)) return 'viejo';
    return (u.pedidos || []).some((p) => p.estado === 'en_camino') ? 'cam' : 'asg';
  }
  function popup(u) {
    const ped = u.pedidos || [];
    const est = u.fondo ? 'Salió de la página · última ubicación ' + SmashMapa.hace(u.en) : SmashMapa.hace(u.en) + (u.velocidad != null ? ' · ' + u.velocidad + ' km/h' : '') + (u.precision ? ' · ±' + Math.round(u.precision) + ' m' : '');
    return `<div class="sm-pop"><b>${esc(u.nombre)}</b><small>${esc(est)}</small>
      ${ped.length ? `<ul>${ped.map((p) => `<li>#${esc(p.numero || p.pedido)} ${esc(p.cliente || '')}<em>${p.estado === 'en_camino' ? 'en camino' : 'por salir'}</em><br><small>${esc(p.direccion || p.zona || '')}</small></li>`).join('')}</ul>` : '<small>Sin pedidos por entregar</small>'}</div>`;
  }
  function pintar() {
    if (!mapa) return;
    const L = window.L, vistos = {};
    ubic.forEach((u) => {
      vistos[u.domiciliario] = 1;
      const ll = [u.lat, u.lng], cl = claseDe(u), ini = (u.nombre || '?').charAt(0).toUpperCase();
      const ruta = (u.rastro || []).map((p) => [p[0], p[1]]);
      const color = cl === 'cam' ? '#7c3aed' : cl === 'viejo' ? '#6b7280' : '#2563eb';
      let c = capa[u.domiciliario];
      if (!c) {
        c = capa[u.domiciliario] = {
          m: L.marker(ll, { icon: SmashMapa.icono(ini, cl, u.rumbo) }).addTo(mapa).bindPopup(popup(u)),
          r: L.polyline(ruta, { color, weight: 4, opacity: 0.45, lineCap: 'round', lineJoin: 'round' }).addTo(mapa),
        };
      } else {
        c.m.setLatLng(ll).setIcon(SmashMapa.icono(ini, cl, u.rumbo));
        c.m.setPopupContent(popup(u));
        c.r.setLatLngs(ruta).setStyle({ color });
      }
    });
    Object.keys(capa).forEach((id) => { if (!vistos[id]) { mapa.removeLayer(capa[id].m); mapa.removeLayer(capa[id].r); delete capa[id]; } });
    if (foco && capa[foco]) mapa.panTo(capa[foco].m.getLatLng(), { animate: true });
    else if (!ajustado) ajustar(false);
    const act = document.getElementById('dmMapaAct');
    if (act) act.textContent = error ? '⚠ ' + error : ultimo ? 'Actualizado ' + ultimo.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit', second: '2-digit' }) : '';
  }
  function ajustar(forzar) {
    if (!mapa) return;
    const pts = ubic.map((u) => [u.lat, u.lng]);
    const n = negocio(); if (n) pts.push([n.lat, n.lng]);
    if (!pts.length) return;
    if (pts.length === 1) mapa.setView(pts[0], 15, { animate: forzar });
    else mapa.fitBounds(pts, { padding: [50, 50], maxZoom: 16, animate: forzar });
    ajustado = true;
  }
  function enfocar(id) {
    foco = id;
    const c = capa[id];
    if (mapa && c) { mapa.setView(c.m.getLatLng(), Math.max(mapa.getZoom(), 16), { animate: true }); c.m.openPopup(); }
  }

  /* ---------------- "Ver en el mapa" desde cualquier parte ---------------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ver-mapa]');
    if (!b) return;
    const id = b.dataset.verMapa;
    const nav = document.querySelector('.nav-btn[data-section="domicilios"]');
    if (nav && !visible()) nav.click();
    foco = id;
    const intentar = (n) => { if (capa[id]) enfocar(id); else if (n > 0) setTimeout(() => intentar(n - 1), 500); };
    setTimeout(() => { const t = document.querySelector('.dm-main'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); intentar(12); }, 150);
  });

  /* ---------------- Arranque ---------------- */
  window.addEventListener('smash:domi-pintado', () => { tarjeta(); if (visible()) { if (!mapa) montar(); else setTimeout(() => mapa.invalidateSize(), 50); } });
  window.addEventListener('storage', (e) => { if (e.key === K_NEG) pintarNegocio(); });
  setInterval(() => { if (visible() && document.visibilityState === 'visible') refrescar(); }, 5000);

  return {
    refrescar, enfocar,
    ubicacion: (id) => ubic.find((u) => u.domiciliario === id) || null,
  };
})();
