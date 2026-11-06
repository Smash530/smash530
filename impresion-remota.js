/* ============================================================
   SMASH · impresion-remota.js  (cocina y dueños)
   Imprimir comandas a distancia: desde un celular o cualquier PC
   (con la cuenta de caja o dueño conectada) se manda la comanda y
   la imprime el PC del negocio que tiene la impresora térmica.
   - "Equipo impresor": se activa en Configuración, en el PC que
     tiene la impresora. Ese equipo debe tener el panel abierto.
   - La comanda viaja completa (no depende de los datos del equipo).
   - Si hay dos equipos impresores, solo uno imprime cada comanda.
   Necesita supabase/impresion-remota.sql.
   ============================================================ */
const SmashImpRemota = (function () {
  const N = typeof SmashNube !== 'undefined' && SmashNube.ok ? SmashNube : null;
  const esc = SmashUI.esc;
  const K = 'smash_impresor';
  const leerCfg = () => { try { return Object.assign({ activo: false, nombre: 'PC cocina' }, JSON.parse(localStorage.getItem(K) || '{}')); } catch (e) { return { activo: false, nombre: 'PC cocina' }; } };
  const guardarCfg = (c) => { try { localStorage.setItem(K, JSON.stringify(c)); } catch (e) { /* sin almacenamiento */ } };
  let cfg = leerCfg();
  const S = { con: 'apagado', error: '', hora: null, impresas: 0, ultima: '', lider: false };

  /* ---------------- Aviso flotante ---------------- */
  let toastEl = null, toastT = null;
  function toast(html, tipo, ms) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'imp-toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.className = 'imp-toast show ' + (tipo || '');
    toastEl.innerHTML = html;
    clearTimeout(toastT);
    if (ms) toastT = setTimeout(() => { toastEl.className = 'imp-toast'; }, ms);
  }

  /* ---------------- Mandar a imprimir (cualquier equipo) ---------------- */
  async function enviar(o) {
    if (!N) { toast('⚠ Sin conexión con la nube. Revisa el internet.', 'bad', 6000); return { ok: false }; }
    const etiqueta = '#' + (o.numeroDia || o.id);
    toast('📡 Enviando comanda ' + esc(etiqueta) + ' a la impresora del negocio…', 'prog');
    const r = await N.enviarImpresion(o, etiqueta);
    if (!r.ok) { toast('⚠ No se pudo enviar: ' + esc(r.error) + '.', 'bad', 9000); return r; }
    toast('⏳ Comanda ' + esc(etiqueta) + ' en cola. Esperando al equipo impresor…', 'prog');
    // seguimiento: hasta 60 s
    const ini = Date.now();
    (async function seguir() {
      const e = await N.estadoImpresion(r.id);
      if (e && e.estado === 'impreso' && e.detalle === 'ventana') { toast('✓ Comanda ' + esc(etiqueta) + ' impresa en <b>' + esc(e.equipo || 'el negocio') + '</b>, pero allá Chrome pidió confirmar la impresión: ese PC no tiene activa la impresión automática (ver Configuración → Impresión a distancia).', 'bad', 12000); return; }
      if (e && e.estado === 'impreso') { toast('✓ Comanda ' + esc(etiqueta) + ' impresa en <b>' + esc(e.equipo || 'el negocio') + '</b>.', 'ok', 6000); return; }
      if (e && e.estado === 'error') { toast('⚠ El equipo ' + esc(e.equipo || '') + ' no pudo imprimir: ' + esc(e.detalle || 'error') + '.', 'bad', 9000); return; }
      if (Date.now() - ini > 60000) { toast('⚠ Ningún equipo impresor tomó la comanda ' + esc(etiqueta) + ' en 1 minuto. Revisa que el PC del negocio esté encendido con el panel abierto. Queda en cola 30 minutos.', 'bad', 12000); return; }
      setTimeout(seguir, 2000);
    })();
    return r;
  }

  /* ---------------- Equipo impresor ---------------- */
  const cola = [];
  let ocupado = false, detener = null;
  function imprimirHtml(html) {
    return new Promise((listo) => {
      const area = document.getElementById('printArea');
      if (!area) { listo(false); return; }
      area.innerHTML = html;
      const waits = Array.from(area.querySelectorAll('img')).map((im) => (im.complete ? Promise.resolve() : new Promise((r) => { im.addEventListener('load', r); im.addEventListener('error', r); })));
      Promise.race([Promise.all(waits), new Promise((r) => setTimeout(r, 1500))]).then(() => {
        // Con impresión automática (--kiosk-printing) window.print() vuelve casi al instante.
        // Si tarda, es que Chrome mostró la ventana de "Imprimir" y alguien tuvo que tocarla.
        const t0 = Date.now();
        try { window.print(); } catch (e) { listo(false); return; }
        const conVentana = Date.now() - t0 > 2500;
        if (conVentana !== S.ventana) { S.ventana = conVentana; pintar(); }
        listo(conVentana ? 'ventana' : true);
      });
    });
  }
  async function procesar() {
    if (ocupado) return;
    ocupado = true;
    while (cola.length) {
      const t = cola.shift();
      try {
        if (!(await N.tomarImpresion(t.id, cfg.nombre))) continue;   // otro equipo ya la tomó
        const ok = await imprimirHtml(SmashTicket.html(t.datos || {}));
        await N.marcarImpresion(t.id, ok ? 'impreso' : 'error', ok === 'ventana' ? 'ventana' : ok ? '' : 'no se pudo abrir la impresión');
        if (ok) { S.impresas++; S.ultima = t.pedido; }
      } catch (e) { try { await N.marcarImpresion(t.id, 'error', String(e && e.message || e)); } catch (x) {} }
      pintar();
      await new Promise((r) => setTimeout(r, 1200));   // pausa entre comandas
    }
    ocupado = false;
  }
  const vistos = new Set();
  function alTrabajo(t) {
    if (vistos.has(t.id)) return;
    vistos.add(t.id);
    cola.push(t);
    procesar();
  }
  function alEstado(e, info) {
    if (e === 'revisado') { S.hora = info.hora; S.error = ''; }
    else if (e === 'error' || e === 'sin-tabla') { S.error = (info && info.error) || 'error'; if (e === 'sin-tabla') S.con = e; }
    else { S.con = e; if (info && info.error) S.error = info.error; else if (e !== 'sin-sesion') S.error = ''; }
    pintar();
  }
  function arrancar() {
    if (detener) { detener(); detener = null; }
    if (!cfg.activo) { S.con = 'apagado'; pintar(); return; }
    if (!N) { S.con = 'sin-nube'; pintar(); return; }
    if (!S.lider) { pintar(); return; }
    S.con = 'conectando'; S.error = '';
    detener = N.seguirImpresiones(alTrabajo, alEstado);
    pintar();
  }
  // Una sola pestaña por navegador imprime (si cocina y dueños están abiertos a la vez)
  let pidioTurno = false;
  function tomarTurno() {
    if (pidioTurno) { arrancar(); return; }
    pidioTurno = true;
    if (navigator.locks && navigator.locks.request) {
      navigator.locks.request('smash-impresor', () => { S.lider = true; arrancar(); return new Promise(() => {}); });
    } else { S.lider = true; arrancar(); }
  }

  /* ---------------- Pantalla ---------------- */
  const TXT = {
    apagado: ['', ''],
    conectando: ['prog', '⏳ Equipo impresor: conectando…'],
    'en-vivo': ['on', '🖨️ Este equipo es el <b>impresor</b>: imprime las comandas que manden desde otros equipos.'],
    respaldo: ['on', '🖨️ Equipo impresor: conexión lenta, revisa cada 10 segundos.'],
    'sin-sesion': ['off', '⚠ Equipo impresor sin cuenta: conecta la cuenta de caja o dueño en "⭐ Clientes leales".'],
    'sin-tabla': ['off', '⚠ Falta preparar la base: ejecuta supabase/impresion-remota.sql en Supabase.'],
    'sin-nube': ['off', '⚠ Equipo impresor sin conexión con la nube.'],
  };
  function pintar() {
    const t = S.error && S.con !== 'sin-tabla' && S.con !== 'sin-sesion' ? ['off', '⚠ Equipo impresor: no se pudo revisar la cola (' + esc(S.error) + '). Se reintenta solo.'] : TXT[S.con] || TXT.conectando;
    const extra = S.impresas ? ` · ${S.impresas} impresa${S.impresas === 1 ? '' : 's'} (última ${esc(S.ultima)})` : '';
    const otra = cfg.activo && !S.lider ? ['prog', 'ℹ Otra pestaña de este navegador es la que imprime.'] : null;
    const ventana = cfg.activo && S.lider && S.ventana
      ? ['off', '⚠ Chrome está pidiendo confirmar cada impresión: este Chrome <b>no se abrió con el acceso directo de impresión automática</b>. Cierra Chrome por completo y ábrelo con ese acceso directo (pasos en Configuración → Impresión a distancia).'] : null;
    const v = otra || ventana || t;
    document.querySelectorAll('.imp-root').forEach(renderCfg);
    document.querySelectorAll('.imp-estado').forEach((el) => {
      el.hidden = !cfg.activo;
      el.className = 'imp-estado web-estado ' + v[0];
      el.innerHTML = v[1] + (otra ? '' : extra);
    });
  }
  // Se arma una sola vez; después solo se actualizan los valores (no cierra la ayuda abierta)
  function renderCfg(root) {
    if (root.dataset.ok) {
      const a = root.querySelector('.imp-activo'), n = root.querySelector('.imp-nombre');
      if (a) a.checked = cfg.activo;
      if (n && document.activeElement !== n) n.value = cfg.nombre;
      return;
    }
    root.dataset.ok = '1';
    root.innerHTML = `
      <div class="mod-box imp-box">
        <p class="hint" style="margin-top:0">Marca esta opción <b>solo en el PC del negocio que tiene la impresora térmica</b>. Desde cualquier otro equipo (celular o PC) se usa el botón
          <b>"📡 Imprimir en cocina"</b> del pedido y la comanda sale aquí.</p>
        <label class="chk"><input type="checkbox" class="imp-activo"${cfg.activo ? ' checked' : ''}> Este equipo imprime las comandas que manden a distancia</label>
        <label class="imp-nombre-l">Nombre de este equipo<input class="imp-nombre" maxlength="40" value="${esc(cfg.nombre)}" placeholder="Ej: PC cocina"></label>
        <div class="imp-estado web-estado" hidden></div>
        <div class="imp-acts">
          <button type="button" class="btn-secondary imp-prueba">📡 Enviar comanda de prueba</button>
        </div>
        <details class="imp-ayuda"><summary>Para que imprima solo, sin preguntar (recomendado)</summary>
          <ol>
            <li>En este PC pon la impresora térmica como <b>impresora predeterminada</b> de Windows.</li>
            <li>Crea un acceso directo de Chrome con esta línea en "Destino". Usa una ventana de Chrome aparte, así funciona aunque haya otro Chrome abierto:<br><code>"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --user-data-dir="C:\\SmashImpresora" ${esc(location.origin + location.pathname)}</code></li>
            <li>La primera vez, en esa ventana entra al panel, conecta la nube y marca de nuevo "Este equipo imprime…". Queda guardado.</li>
            <li>Abre el panel siempre con ese acceso directo y déjalo abierto (puede estar minimizado). Para que abra solo al prender el PC, copia el acceso directo en la carpeta <b>Inicio</b> de Windows (tecla Windows + R → escribe <b>shell:startup</b>).</li>
          </ol>
          <p class="hint">Sin ese paso también imprime, pero Chrome muestra la ventana de impresión y alguien en el negocio debe tocar "Imprimir". Si el panel avisa que Chrome está pidiendo confirmar, es porque se abrió sin el acceso directo.</p>
        </details>
      </div>`;
  }
  // Si se cambia la opción en otra pestaña del mismo navegador
  window.addEventListener('storage', (e) => {
    if (e.key !== K) return;
    cfg = leerCfg();
    if (cfg.activo && !S.lider) tomarTurno(); else arrancar();
  });
  document.addEventListener('change', (e) => {
    if (e.target.classList && e.target.classList.contains('imp-activo')) {
      cfg.activo = e.target.checked; guardarCfg(cfg);
      if (cfg.activo && !S.lider) tomarTurno(); else arrancar();
      e.target.blur(); pintar();
    }
    if (e.target.classList && e.target.classList.contains('imp-nombre')) {
      cfg.nombre = e.target.value.trim().slice(0, 40) || 'PC cocina'; guardarCfg(cfg); e.target.blur(); pintar();
    }
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('.imp-prueba')) {
      enviar({ id: 0, numeroDia: 'PRUEBA', cliente: 'Comanda de prueba', telefono: '-', direccion: 'Impresión a distancia', items: [{ qty: 1, name: 'Prueba de impresora' }], subtotal: 0, total: 0, domicilio: 0, creado: new Date().toISOString() });
    }
  });

  if (N && N.alCambiar) N.alCambiar(() => { if (cfg.activo && S.lider) arrancar(); });
  if (cfg.activo) tomarTurno();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pintar); else pintar();

  return { enviar, disponible: () => !!N, esImpresor: () => cfg.activo };
})();
