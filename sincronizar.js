/* ============================================================
   SMASH · sincronizar.js (cocina y dueños)
   Todos los datos del negocio viven también en la nube y se
   mantienen iguales en todos los equipos, sin oprimir botones.

   Cómo funciona:
   - Cada vez que el sistema guarda un dato (pedidos, inventario,
     gastos, caja, recetas, socios...), este módulo lo anota como
     "por subir" y lo sube a la nube en 1-2 segundos.
   - Cuando otro equipo cambia algo, la nube avisa al instante
     (Realtime) y este equipo lo baja. Cada 30 s revisa por si un
     aviso se perdió.
   - Sin internet se sigue trabajando normal: los cambios quedan
     anotados y se suben al volver la conexión.
   - Si dos equipos cambian el mismo dato a la vez, se combinan:
     cada pedido, insumo o movimiento se compara por separado, así
     un pedido nuevo en el celular y otro en el PC quedan los dos.
   - Necesita la cuenta de caja o dueño conectada en
     "⭐ Clientes leales" (la misma de los pedidos web).
   - Si hay varias pestañas abiertas, solo una sincroniza.
   ============================================================ */
const SmashSync = (function () {
  const N = typeof SmashNube !== 'undefined' ? SmashNube : null;
  // Datos que son de cada equipo y no se comparten
  const NO = /^smash_(session_|owner_lock|staff_lock|ultimo_respaldo|sound_on|sim$|impresor)/;
  // Contraseñas de dueños: solo los dueños las ven en la nube
  const SOLO_DUENO = /^smash_(owner_cred|duenos|users)$/;
  const LS_META = 'sync_meta', LS_PEND = 'sync_pend', LS_EST = 'sync_estado', LS_EQ = 'nube_equipo', BASE = 'syncbase_';
  const sincroniza = (k) => typeof k === 'string' && /^smash_[a-z0-9_]{1,60}$/.test(k) && !NO.test(k);

  const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sin espacio */ } };
  const equipo = () => lsGet(LS_EQ, '') || (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'Celular' : 'PC');

  /* ---------------- 1. Anotar cada cambio ---------------- */
  const usable = SmashLS && SmashLS !== (function () { try { return window.localStorage; } catch (e) { return null; } })();
  const orig = usable ? { set: SmashLS.setItem.bind(SmashLS), get: SmashLS.getItem.bind(SmashLS) } : null;
  let aplicando = false;
  function marcar(k) { const p = lsGet(LS_PEND, {}); if (!p[k]) { p[k] = 1; lsSet(LS_PEND, p); } }
  function desmarcar(k) { const p = lsGet(LS_PEND, {}); if (p[k]) { delete p[k]; lsSet(LS_PEND, p); } }
  if (usable) {
    SmashLS.setItem = function (k, v) {
      orig.set(k, v);
      if (!aplicando && sincroniza(String(k))) marcar(String(k));
    };
  }
  const getBase = (k) => orig.get(BASE + k);
  const setBase = (k, v) => orig.set(BASE + k, v);
  const meta = () => lsGet(LS_META, {});
  function setVer(k, v) { const m = meta(); m[k] = v; lsSet(LS_META, m); }

  /* ---------------- 2. Combinar cambios de dos equipos ---------------- */
  const J = (x) => JSON.stringify(x === undefined ? null : x);
  const eq = (a, b) => J(a) === J(b);
  const esObj = (x) => x && typeof x === 'object' && !Array.isArray(x);
  const conId = (a) => Array.isArray(a) && a.length > 0 && a.every((x) => esObj(x) && x.id != null);

  function merge3(b, l, r, clave) {
    if (eq(l, r) || eq(l, b)) return r;
    if (eq(r, b)) return l;
    if (typeof l === 'number' && typeof r === 'number' && /seq/.test(clave || '')) return Math.max(l, r);
    if (Array.isArray(l) && Array.isArray(r)) {
      const bb = Array.isArray(b) ? b : [];
      if ((conId(l) || !l.length) && (conId(r) || !r.length) && (l.length || r.length)) return mergeIds(bb, l, r);
      return mergeConjunto(bb, l, r);
    }
    if (esObj(l) && esObj(r)) {
      const bo = esObj(b) ? b : {}, out = {};
      Object.keys(Object.assign({}, r, l)).forEach((k) => {
        const v = merge3(bo[k], l[k], r[k], k);
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    return r;   // mismo dato cambiado distinto en los dos: gana el último que llegó a la nube
  }
  // Listas con id (pedidos, insumos, gastos...): se compara cada elemento
  function mergeIds(b, l, r) {
    // Se identifica por id + hora de creación: si dos equipos dieron el mismo id a pedidos distintos, no se mezclan
    const kid = (x) => String(x.id) + (x && typeof x.creado === "string" ? "|" + x.creado : "");
    const map = (a) => { const m = new Map(); a.forEach((x) => { if (esObj(x) && x.id != null) m.set(kid(x), x); }); return m; };
    const ya = new Set();
    const B = map(b), L = map(l), out = [], choques = [];
    const R = map(r);
    r.forEach((rx) => {
      if (!esObj(rx) || rx.id == null) return;
      const id = kid(rx), lx = L.get(id), bx = B.get(id);
      if (ya.has(id)) return; ya.add(id);                                                         // copia repetida del mismo elemento
      if (lx === undefined) { if (bx === undefined || !eq(rx, bx)) out.push(rx); return; }        // borrado aquí y sin cambios allá → se borra
      if (bx === undefined && !eq(lx, rx) && typeof lx.id === 'number' && typeof lx.creado !== 'string') { out.push(rx); choques.push(lx); return; } // mismo número creado en dos equipos
      out.push(merge3(bx, lx, rx));
    });
    l.forEach((lx) => {
      if (!esObj(lx) || lx.id == null) return;
      const id = kid(lx);
      if (R.has(id) || ya.has(id)) return; ya.add(id);
      const bx = B.get(id);
      if (bx === undefined || !eq(lx, bx)) out.push(lx);                                            // nuevo aquí (o cambiado aquí y borrado allá)
    });
    if (choques.length) {
      let maxId = out.reduce((m, x) => (typeof x.id === 'number' && x.id > m ? x.id : m), 0);
      choques.forEach((x) => {
        if (x.ref && out.some((o) => o.ref === x.ref)) return;                                     // el mismo pedido web lo recibieron los dos equipos: queda uno
        const n = Object.assign({}, x, { id: ++maxId });
        if (x.numeroDia != null && x.creado) {
          const E = typeof SmashExt !== "undefined" && SmashExt.diaServicio ? SmashExt : null;
          const dia = E ? E.diaServicio(x) : String(x.creado).slice(0, 10);
          n.numeroDia = E ? E.nextDayNumber(out, dia) : out.filter((o) => String(o.creado || "").slice(0, 10) === dia).reduce((m, o) => Math.max(m, Number(o.numeroDia) || 0), 0) + 1;
        }
        out.push(n);
      });
    }
    return out;
  }
  // Listas sin id (registros sueltos): se suman los nuevos de cada lado y se quitan los borrados
  function mergeConjunto(b, l, r) {
    const BS = new Set(b.map(J)), LS = new Set(l.map(J)), RS = new Set(r.map(J));
    const out = r.filter((x) => { const s = J(x); return LS.has(s) || !BS.has(s); });
    l.forEach((x) => { const s = J(x); if (!RS.has(s) && !BS.has(s)) out.push(x); });
    return out;
  }
  function fusionar(k, baseTxt, localTxt, remotoTxt) {
    let b, l, r;
    try { r = JSON.parse(remotoTxt); } catch (e) { return localTxt; }
    try { l = JSON.parse(localTxt); } catch (e) { return remotoTxt; }
    try { b = baseTxt == null ? undefined : JSON.parse(baseTxt); } catch (e) { b = undefined; }
    const m = merge3(b, l, r, k);
    return eq(m, r) ? remotoTxt : JSON.stringify(m);
  }

  /* ---------------- 3. Estado visible ---------------- */
  let estadoMem = lsGet(LS_EST, null);
  function estado(k, t, extra) {
    estadoMem = Object.assign({ k, t, en: new Date().toISOString() }, extra || {});
    lsSet(LS_EST, estadoMem);
    pintar();
  }
  const chip = document.createElement('button');
  chip.type = 'button'; chip.className = 'sync-chip'; chip.hidden = true;
  chip.addEventListener('click', () => {
    if (estadoMem && estadoMem.k === 'cuenta') pedirClave();
    else if (lider) revisarTodo();
    else alert(chip.title);
  });
  // Panel de dueños o de cocina, y quién está dentro
  const ES_DUENO = /dueno/.test(location.pathname);
  function quienEsta() {
    try {
      if (ES_DUENO) return typeof SmashExt !== 'undefined' && SmashExt.currentOwner ? SmashExt.currentOwner() : '';
      const s = typeof SmashDB !== 'undefined' && SmashDB.currentStaff ? SmashDB.currentStaff() : null;
      return s ? s.usuario : '';
    } catch (e) { return ''; }
  }
  // Conecta la nube con el usuario y clave del panel (se usa al entrar al panel)
  async function entrarConNube(tipo, usuario, clave) {
    if (!usable || !N || !N.ok || !N.panelEntrar) return { ok: false, error: 'Sin nube' };
    const r = await N.panelEntrar(tipo, usuario, clave, equipo());
    if (r.ok) {
      const t0 = Date.now();
      if (lider) await iniciar();
      else {                                        // otra pestaña sincroniza: se espera a que termine (máx. 10 s)
        lsSet('sync_reintentar', t0);
        for (let i = 0; i < 40; i++) { const e = lsGet(LS_EST, null); if (e && e.k === 'ok' && new Date(e.en).getTime() >= t0) break; await new Promise((ok) => setTimeout(ok, 250)); }
      }
    } else if (!rol) estado('cuenta', 'Conectar nube', { detalle: r.error });
    return r;
  }
  // Para quien ya estaba dentro del panel antes de esta versión: confirma su clave una sola vez
  function pedirClave() {
    const u = quienEsta();
    if (!u || typeof SmashUI === 'undefined') { alert(chip.title); return; }
    SmashUI.modal('Conectar este equipo a la nube',
      `<p class="hint">Escribe la clave con la que entras al panel. Se pide una sola vez: después este equipo guarda y recibe los datos solo.</p>
       <label class="ed-wide">Usuario<input value="${String(u).replace(/"/g, '&quot;')}" disabled></label>
       <label class="ed-wide">Clave<input type="password" id="syncClave" autocomplete="current-password"></label>
       <p class="error" id="syncErr"></p>`,
      (m) => {
        const btn = m.querySelector('.sm-save'), err = m.querySelector('#syncErr');
        btn.disabled = true; btn.textContent = 'Conectando…';
        entrarConNube(ES_DUENO ? 'dueno' : 'caja', u, m.querySelector('#syncClave').value).then((r) => {
          if (r.ok) SmashUI.closeModal();
          else { err.textContent = r.error; btn.disabled = false; btn.textContent = 'Conectar'; }
        });
        return false;
      }, 'Conectar');
  }
  function montarChip() {
    const top = document.querySelector('.topbar');
    if (top && !chip.isConnected) { const ub = top.querySelector('.top-links'); top.insertBefore(chip, ub || null); }
  }
  function pintar() {
    montarChip();
    const e = lsGet(LS_EST, null) || estadoMem;
    if (!e) { chip.hidden = true; return; }
    const pend = Object.keys(lsGet(LS_PEND, {})).length;
    const ICO = { ok: '☁️', sync: '🔄', pend: '⏳', cuenta: '🔌', error: '⚠️', off: '☁️' };
    let t = e.t;
    if (e.k === 'ok' && pend) t = 'Subiendo ' + pend + (pend === 1 ? ' cambio…' : ' cambios…');
    chip.hidden = false;
    chip.className = 'sync-chip ' + (e.k === 'ok' && pend ? 'sync' : e.k);
    chip.innerHTML = `<span class="i">${ICO[e.k] || '☁️'}</span><span class="t"></span>`;
    chip.querySelector('.t').textContent = t;
    chip.title = e.detalle || t;
  }
  window.addEventListener('storage', (e) => { if (e.key === LS_EST || e.key === LS_PEND) pintar(); });
  setInterval(pintar, 5000);

  /* ---------------- 4. Subir y bajar ---------------- */
  let lider = false, rol = '', ocupado = false, otraVez = false, dejar = null, colaBajar = new Set(), relojBajar = null;

  function avisarPantalla(k, antes, ahora) {
    try { window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: antes, newValue: ahora })); } catch (e) { /* viejo */ }
  }
  // Aplica en este equipo lo que llegó de la nube (combinando si aquí había cambios sin subir)
  function aplicarRemoto(k, remoto, version) {
    const local = SmashLS.getItem(k), pend = !!lsGet(LS_PEND, {})[k];
    const final = pend && local != null ? fusionar(k, getBase(k), local, remoto) : remoto;
    if (final !== local) {
      aplicando = true;
      try { SmashLS.setItem(k, final); } finally { aplicando = false; }
      avisarPantalla(k, local, final);
    }
    setBase(k, remoto);
    setVer(k, version);
    if (final === remoto) desmarcar(k); else marcar(k);
  }
  async function bajar(claves) {
    for (let i = 0; i < claves.length; i += 8) {
      const r = await N.datosLeer(claves.slice(i, i + 8));
      if (!r.ok) throw new Error(r.error);
      r.lista.forEach((f) => { if (sincroniza(f.clave) && f.version > (meta()[f.clave] || 0)) aplicarRemoto(f.clave, f.valor, f.version); });
    }
  }
  async function subir() {
    const esDueno = rol === 'dueno';
    for (let vuelta = 0; vuelta < 4; vuelta++) {
      const p = lsGet(LS_PEND, {}), claves = Object.keys(p);
      if (!claves.length) return;
      for (const k of claves) {
        if (!sincroniza(k) || (SOLO_DUENO.test(k) && !esDueno)) { desmarcar(k); continue; }
        const valor = SmashLS.getItem(k);
        if (valor == null) { desmarcar(k); continue; }
        const r = await N.guardarDato(k, valor, meta()[k] || 0, equipo(), SOLO_DUENO.test(k));
        if (r && r.ok) {
          setVer(k, r.version); setBase(k, valor);
          if (SmashLS.getItem(k) === valor) desmarcar(k);
        } else if (r && r.conflicto) {
          aplicarRemoto(k, r.valor, r.version);          // otro equipo guardó antes: se combina y se vuelve a subir
        } else throw new Error((r && r.error) || 'no se pudo subir');
      }
    }
  }
  async function ciclo(fn) {
    if (ocupado) { otraVez = true; return; }
    ocupado = true;
    try {
      await fn();
      const pend = Object.keys(lsGet(LS_PEND, {})).length;
      estado('ok', pend ? 'Subiendo cambios…' : 'En la nube · al día');
    } catch (e) {
      const m = String((e && e.message) || e);
      if (m === 'sin-acceso') {                       // la llave venció o fue retirada: hay que volver a entrar
        if (N.panelSalir) N.panelSalir();
        rol = ''; if (dejar) { dejar(); dejar = null; }
        estado('cuenta', 'Conectar nube', { detalle: 'La conexión de este equipo con la nube venció. Toca aquí y escribe tu clave.' });
      } else if (/sin conexi|failed to fetch|network/i.test(m) || !navigator.onLine) estado('pend', 'Sin internet · se sube al volver', { detalle: m });
      else estado('error', 'Revisar nube', { detalle: m });
    } finally {
      ocupado = false;
      if (otraVez) { otraVez = false; setTimeout(() => ciclo(subir), 300); }
    }
  }
  // Revisión completa: baja lo nuevo de la nube, anota lo que la nube no tiene y sube lo pendiente
  async function revisarTodo() {
    await ciclo(async () => {
      const a = await N.datosAvisos();
      if (!a.ok) throw new Error(a.error);
      const m = meta(), enNube = new Set(a.lista.map((x) => x.clave));
      // Primera vez de este equipo con un dato que ya está en la nube: se combina (no se reemplaza)
      a.lista.forEach((x) => { if (sincroniza(x.clave) && m[x.clave] == null && SmashLS.getItem(x.clave) != null) marcar(x.clave); });
      const nuevas = a.lista.filter((x) => sincroniza(x.clave) && x.version > (m[x.clave] || 0)).map((x) => x.clave);
      if (nuevas.length) await bajar(nuevas);
      for (let i = 0; i < SmashLS.length; i++) { const k = SmashLS.key(i); if (sincroniza(k) && !enNube.has(k)) marcar(k); }
      await subir();
    });
  }
  function pedirBajar(clave) {
    colaBajar.add(clave);
    clearTimeout(relojBajar);
    relojBajar = setTimeout(() => { const c = Array.from(colaBajar); colaBajar = new Set(); ciclo(() => bajar(c)); }, 250);
  }

  /* ---------------- 5. Arranque ---------------- */
  // Quién es este equipo en la nube: la llave que dio la nube al entrar al panel,
  // o (como antes) la cuenta de caja/dueño conectada en "⭐ Clientes leales".
  async function acceso() {
    const s = N.panelSesion && N.panelSesion();
    if (s && (s.rol === 'caja' || s.rol === 'dueno')) return s.rol;
    const p = await N.perfil().catch(() => null);
    return p && (p.rol === 'caja' || p.rol === 'dueno') ? p.rol : '';
  }
  async function iniciar() {
    if (!usable) { estado('off', 'Sin sincronizar', { detalle: 'Este navegador no permite el almacén de datos.' }); return; }
    if (!N || !N.ok) { estado('off', 'Sin nube', { detalle: 'Este equipo no está conectado a la nube.' }); return; }
    const r = await acceso();
    if (!r) {
      rol = '';
      if (dejar) { dejar(); dejar = null; }
      estado('cuenta', 'Conectar nube', { detalle: 'Entra al panel con tu usuario y clave: la nube se conecta sola. Si ya estás dentro, toca aquí.' });
      return;
    }
    const cambio = rol !== r; rol = r;
    if (cambio || !dejar) {
      if (dejar) dejar();
      dejar = N.seguirDatos((av) => { if (sincroniza(av.clave) && av.version > (meta()[av.clave] || 0)) pedirBajar(av.clave); });
    }
    estado('sync', 'Sincronizando…');
    await revisarTodo();
  }
  function comoLider() {
    lider = true;
    iniciar();
    setInterval(() => { if (rol) revisarTodo(); }, 30000);                              // por si se pierde un aviso
    setInterval(() => { if (rol && Object.keys(lsGet(LS_PEND, {})).length && !ocupado) ciclo(subir); }, 1500);  // sube lo nuevo
    setInterval(() => { if (!rol) iniciar(); }, 60000);
    window.addEventListener('online', () => { if (rol) revisarTodo(); else iniciar(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && rol) revisarTodo(); });
    if (N && N.alCambiar) N.alCambiar(() => iniciar());
    // Otra pestaña de este equipo entró al panel y conectó la nube
    window.addEventListener('storage', (e) => { if (e.key === 'nube_panel' || e.key === 'sync_reintentar') iniciar(); });
  }
  if (navigator.locks && navigator.locks.request) navigator.locks.request('smash-sync', () => new Promise(() => comoLider()));
  else comoLider();
  pintar();

  return { estado: () => estadoMem, revisarTodo, iniciar, entrarConNube, _merge: merge3, _fusionar: fusionar };
})();
