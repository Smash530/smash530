/* ============================================================
   SMASH · avisar-promos.js  (caja y dueños)
   "📣 Avisar promo": arma el mensaje de la promo de hoy y la lista
   de clientes del club que aceptaron recibir promos por WhatsApp.
   La cajera toca "Enviar" en cada cliente: se abre WhatsApp con el
   mensaje ya escrito y solo tiene que darle enviar.
   - Solo salen los clientes que marcaron "Quiero recibir las promos".
   - "Dar de baja" si el cliente responde SALIR.
   - Lo enviado se recuerda en este equipo durante el día, para no
     repetirle el mensaje a nadie.
   Necesita supabase/avisos-promos.sql y el panel conectado a la nube.
   ============================================================ */
const SmashAvisos = (function () {
  const root = document.querySelector('#section-avisos .avisos-root');
  if (!root) return { cargar() {} };
  const N = typeof SmashNube !== 'undefined' && SmashNube.ok ? SmashNube : null;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGINA = 'https://smash530.vercel.app/cliente.html';
  const LS_ENV = 'smash_avisos_enviados', LS_MSG = 'smash_avisos_mensaje';
  const hoy = () => (N ? N.hoyCO() : new Date().toISOString().slice(0, 10));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } };

  let promos = [], lista = [], error = '', cargando = false, cargadoEn = 0;

  /* ---- Lo enviado hoy (por equipo) ---- */
  function enviados() { const e = lsGet(LS_ENV); return e && e.fecha === hoy() ? e.ids : []; }
  function marcar(id) { const ids = enviados(); if (ids.indexOf(id) < 0) ids.push(id); lsSet(LS_ENV, { fecha: hoy(), ids }); }

  /* ---- Mensaje ---- */
  function mensajeBase() {
    const lineas = promos.map((p) => '⭐ *' + p.titulo + '*' + (p.descripcion ? '\n' + p.descripcion : '')).join('\n\n');
    return '¡Hola {nombre}! 🍔 Hoy en SMASH tenemos promo para ti:\n\n' + lineas +
      '\n\nPide aquí con tu cuenta 👉 ' + PAGINA +
      '\n\n(Si no quieres recibir más promos, responde SALIR)';
  }
  function mensaje() { const m = lsGet(LS_MSG); return m && m.fecha === hoy() && m.texto ? m.texto : mensajeBase(); }
  const nombreCorto = (c) => String(c.nombre || c.usuario || '').trim().split(/\s+/)[0] || '';
  function textoPara(c) { return mensaje().replace(/\{nombre\}/g, nombreCorto(c)).replace(/¡Hola !/, '¡Hola!'); }
  function telWa(t) {
    const d = String(t || '').replace(/\D/g, '');
    if (d.length === 10) return '57' + d;
    if (d.length === 12 && d.indexOf('57') === 0) return d;
    return d.length >= 10 ? d : '';
  }

  /* ---- Datos ---- */
  async function cargar(forzar) {
    if (!N) { error = 'Este equipo no tiene conexión con la nube.'; render(); return; }
    if (cargando || (!forzar && Date.now() - cargadoEn < 60000)) { render(); return; }
    cargando = true; error = ''; render();
    try {
      const [rp, rc] = await Promise.all([N.panelPromos(), N.panelClientesPromos()]);
      promos = (rp.lista || []).filter((p) => N.vigente(p));
      if (!rc.ok) { error = rc.error || 'No se pudo leer la lista de clientes.'; lista = []; }
      else lista = rc.lista || [];
      if (!rp.ok && !error) error = rp.error || '';
      cargadoEn = Date.now();
    } catch (e) { error = 'Sin internet: no se pudo cargar.'; }
    cargando = false; render();
  }

  /* ---- Pantalla ---- */
  function render() {
    const env = enviados(), pend = lista.filter((c) => env.indexOf(c.id) < 0 && telWa(c.telefono));
    const hayPromo = promos.length > 0;
    root.innerHTML = `
      <div class="avi-grid">
        <div class="avi-card">
          <h3 class="avi-h">1. La promo de hoy</h3>
          ${cargando && !cargadoEn ? '<p class="hint">Cargando…</p>'
            : hayPromo ? `<ul class="avi-promos">${promos.map((p) => `<li><b>⭐ ${esc(p.titulo)}</b>${p.descripcion ? `<span>${esc(p.descripcion)}</span>` : ''}</li>`).join('')}</ul>`
            : '<p class="avi-vacio">Hoy no hay promociones activas. Puedes escribir un mensaje igual, pero lo ideal es avisar solo los días de promo.</p>'}
          <h3 class="avi-h">2. El mensaje</h3>
          <textarea id="aviMsg" rows="9" maxlength="1500">${esc(mensaje())}</textarea>
          <p class="hint"><b>{nombre}</b> se cambia por el nombre de cada cliente. Lo que pongas entre *asteriscos* sale en negrilla en WhatsApp.
            <button type="button" class="avi-lnk" id="aviRestaurar">Volver al mensaje automático</button></p>
        </div>
        <div class="avi-card">
          <h3 class="avi-h">3. Enviar</h3>
          <div class="avi-stats">
            <div><b>${lista.length}</b><small>aceptan promos</small></div>
            <div><b>${lista.filter((c) => env.indexOf(c.id) >= 0).length}</b><small>enviados hoy</small></div>
            <div><b>${pend.length}</b><small>faltan</small></div>
          </div>
          <button type="button" class="btn-primary avi-sig" id="aviSig" ${pend.length ? '' : 'disabled'}>📲 ${pend.length ? 'Enviar al siguiente: ' + esc(nombreCorto(pend[0]) || 'cliente') : lista.length ? '✓ Ya les enviaste a todos' : 'No hay clientes para avisar'}</button>
          <p class="hint">Se abre WhatsApp con el mensaje escrito: solo dale enviar y vuelve aquí para el siguiente.</p>
          ${error ? `<p class="avi-err">⚠ ${esc(error)}</p>` : ''}
          <div class="avi-lista">
            ${lista.map((c) => {
              const ya = env.indexOf(c.id) >= 0, tel = telWa(c.telefono);
              return `<div class="avi-row${ya ? ' ya' : ''}">
                <div class="avi-q"><b>${esc(c.nombre || c.usuario || 'Cliente')}</b><small>${esc(c.telefono)}</small></div>
                ${tel ? `<button type="button" class="btn-sm${ya ? '' : ' avi-env'}" data-avienv="${esc(c.id)}">${ya ? '✓ Enviado · otra vez' : '📲 Enviar'}</button>` : '<small class="hint">Teléfono no válido</small>'}
                <button type="button" class="avi-baja" data-avibaja="${esc(c.id)}" title="El cliente pidió no recibir más promos">Dar de baja</button>
              </div>`;
            }).join('') || (cargadoEn && !error ? '<p class="avi-vacio">Todavía ningún cliente ha aceptado recibir promos. Los clientes lo activan al registrarse o en "Mi cuenta" de la página.</p>' : '')}
          </div>
          <button type="button" class="avi-lnk" id="aviRecargar">${cargando ? 'Cargando…' : '↻ Actualizar lista'}</button>
        </div>
      </div>`;
  }

  function enviar(id) {
    const c = lista.find((x) => x.id === id); if (!c) return;
    const tel = telWa(c.telefono); if (!tel) return;
    window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(textoPara(c)), '_blank', 'noopener');
    marcar(id); render();
  }

  root.addEventListener('input', (e) => {
    if (e.target.id === 'aviMsg') lsSet(LS_MSG, { fecha: hoy(), texto: e.target.value });
  });
  root.addEventListener('click', async (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.id === 'aviRecargar') { cargar(true); return; }
    if (t.id === 'aviRestaurar') { lsSet(LS_MSG, null); render(); return; }
    if (t.id === 'aviSig') {
      const env = enviados(), c = lista.find((x) => env.indexOf(x.id) < 0 && telWa(x.telefono));
      if (c) enviar(c.id);
      return;
    }
    if (t.dataset.avienv) { enviar(t.dataset.avienv); return; }
    if (t.dataset.avibaja) {
      const c = lista.find((x) => x.id === t.dataset.avibaja); if (!c) return;
      if (!confirm('¿Dar de baja a ' + (c.nombre || 'este cliente') + '? Ya no le saldrá en esta lista. Él mismo puede volver a activarlo en su cuenta.')) return;
      t.disabled = true; t.textContent = 'Quitando…';
      const r = await N.panelBajaPromos(c.id);
      if (!r.ok) { alert(r.error); t.disabled = false; t.textContent = 'Dar de baja'; return; }
      lista = lista.filter((x) => x.id !== c.id); render();
    }
  });

  // Se carga al abrir la sección
  document.querySelectorAll('.nav-btn[data-section="avisos"]').forEach((b) => b.addEventListener('click', () => cargar()));
  render();
  return { cargar };
})();
