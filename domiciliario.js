/* ============================================================
   SMASH · domiciliario.js  (página del domiciliario, celular)
   El domiciliario entra con su usuario y ve SOLO los pedidos que
   le asignaron desde cocina o dueños. Marca "Salí" y "Entregado";
   esas horas llegan a los paneles para medir los tiempos.
   Revisa cada 10 s y avisa (vibra y suena) cuando le llega uno nuevo.
   ============================================================ */
(function () {
  'use strict';
  const API = SmashDomiNube.domi;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
  const hora = (iso) => { try { return new Date(iso).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const desde = (iso, hasta) => Math.max(0, Math.round(((hasta ? new Date(hasta) : new Date()).getTime() - new Date(iso).getTime()) / 60000));
  const dur = (min) => (min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0'));
  const tel = (t) => String(t || '').replace(/\D/g, '').replace(/^57(?=\d{10}$)/, '');
  const LENTO = 45;

  let lista = [], tab = 'activos', conocidos = null, ocupado = false, ultimo = null, falla = false;

  /* ---------------- Saludo ---------------- */
  const saludo = () => { const h = new Date().getHours(); return h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches'; };
  document.querySelectorAll('[data-saludo]').forEach((e) => { e.textContent = saludo(); });

  /* ---------------- Entrar / salir ---------------- */
  function vista() {
    const s = API.sesion();
    $('vEntrar').hidden = !!s; $('vApp').hidden = !s;
    if (s) {
      $('aNombre').textContent = s.nombre || s.usuario;
      $('aAv').textContent = (s.nombre || s.usuario || '?').charAt(0).toUpperCase();
      cargar();
      iniciarMapa(); iniciarGps();
    } else { conocidos = null; lista = []; compartiendo = false; pararGps(); }
  }
  $('fEntrar').addEventListener('submit', async (e) => {
    e.preventDefault();
    const b = e.target.querySelector('[type=submit]');
    b.disabled = true; b.textContent = 'Entrando…'; $('eEntrar').textContent = '';
    const r = await API.entrar($('dUsuario').value, $('dClave').value);
    b.disabled = false; b.textContent = 'Entrar';
    if (!r || !r.ok) { $('eEntrar').textContent = (r && r.error) || 'No se pudo entrar.'; return; }
    $('dClave').value = '';
    sonar(true);
    vista();
  });
  document.querySelector('.dz-ojo').addEventListener('click', (e) => {
    const i = $('dClave'), ver = i.type === 'password';
    i.type = ver ? 'text' : 'password'; e.currentTarget.classList.toggle('on', ver);
  });
  $('bSalir').addEventListener('click', async () => {
    if (!confirm('¿Cerrar sesión en este celular?')) return;
    if (APP) { try { if (SmashApp.terminarTurno) SmashApp.terminarTurno(); else SmashApp.detenerRastreo(); } catch (e) { /* sin app */ } }
    await API.salir(); vista();
  });

  /* ---------------- Cargar pedidos ---------------- */
  async function cargar() {
    if (ocupado || !API.sesion()) return;
    ocupado = true;
    const r = await API.mias();
    ocupado = false;
    if (!r || !r.ok) {
      if (r && r.error === 'sesion') { toast('Tu sesión terminó. Entra de nuevo.'); vista(); return; }
      falla = true; pintarVivo(); return;
    }
    falla = false; ultimo = new Date();
    if (r.nombre) $('aNombre').textContent = r.nombre;
    const nuevos = (r.lista || []).filter((e) => (e.estado === 'asignado' || e.estado === 'en_camino') && conocidos && !conocidos.has(e.pedido));
    conocidos = new Set((r.lista || []).map((e) => e.pedido));
    lista = r.lista || [];
    if (nuevos.length) avisarNuevo(nuevos);
    pintar();
  }

  /* ---------------- Pintar ---------------- */
  function pintarVivo() {
    const v = $('aVivo');
    v.classList.toggle('mal', falla);
    v.querySelector('span').textContent = falla ? 'Sin conexión' : 'En línea';
    $('aAct').textContent = ultimo ? 'Actualizado ' + hora(ultimo.toISOString()) + ' · se revisa solo cada 10 s' : '';
  }
  function pintar() {
    const act = lista.filter((e) => e.estado === 'asignado' || e.estado === 'en_camino');
    const hechos = lista.filter((e) => e.estado === 'entregado').sort((a, b) => (a.entregado_en < b.entregado_en ? 1 : -1));
    $('nActivos').textContent = act.length; $('nHechos').textContent = hechos.length;
    const tiempos = hechos.map((e) => desde(e.asignado_en || e.salio_en, e.entregado_en));
    const prom = tiempos.length ? Math.round(tiempos.reduce((s, x) => s + x, 0) / tiempos.length) : null;
    const porCobrar = act.reduce((s, e) => s + (Number(e.cobrar) || 0), 0);
    $('aResumen').innerHTML = `
      <div><b>${act.length}</b><span>por entregar</span></div>
      <div><b>${hechos.length}</b><span>entregados hoy</span></div>
      <div><b>${prom == null ? '—' : dur(prom)}</b><span>promedio</span></div>
      ${porCobrar ? `<div class="cobro"><b>${fmt(porCobrar)}</b><span>por cobrar</span></div>` : ''}`;
    if (tab === 'cuentas') $('aLista').innerHTML = cuentasHtml();
    else if (tab === 'hechos') $('aLista').innerHTML = hechos.length ? hechos.map(hecha).join('') : vacio();
    else $('aLista').innerHTML = act.length ? rutasHtml(act) : vacio();
    pintarVivo();
    revisarCompartir();
  }
  // Los pedidos activos se agrupan por ruta; la ruta sale junta ("Salí con la ruta")
  function rutasHtml(act) {
    const g = {};
    act.forEach((e) => { const k = e.ruta || 'p' + e.pedido; (g[k] = g[k] || { k, en: e.ruta_en || e.asignado_en, l: [] }).l.push(e); });
    return Object.values(g).sort((a, b) => (a.en > b.en ? 1 : -1)).map((r) => {
      const porSalir = r.l.filter((e) => e.estado === 'asignado');
      const hasta = new Date(new Date(r.en).getTime() + 6 * 60000);
      const cambia = hasta.getTime() > Date.now();
      r.l.sort((a, b) => (Number(a.numero) || 0) - (Number(b.numero) || 0));
      return `<section class="dz-ruta" data-ruta="${esc(r.k)}">
        <div class="dz-ruta-h"><div><b>Tu ruta · ${r.l.length} ${r.l.length === 1 ? 'destino' : 'destinos'}</b><small>Asignada ${hora(r.en)}${cambia ? ` · el negocio puede cambiar destinos hasta las ${hora(hasta.toISOString())}` : ''}</small></div></div>
        ${porSalir.length ? `<button type="button" class="dz-btn prim dz-grande" data-salir-ruta="${esc(r.k)}"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 7.5M5.5 17.5 9 10h6l3.5 7.5"/></svg>${porSalir.length === r.l.length ? 'Salí con la ruta' : `Salí con ${porSalir.length} ${porSalir.length === 1 ? 'destino nuevo' : 'destinos nuevos'}`}</button>` : ''}
        ${r.l.map(tarjeta).join('')}
      </section>`;
    }).join('');
  }
  let cuentas = null, cargandoCuentas = false;
  async function cargarCuentas() {
    if (cargandoCuentas) return;
    cargandoCuentas = true;
    const r = await API.cuentas();
    cargandoCuentas = false;
    if (r && r.ok) { cuentas = r; if (tab === 'cuentas') pintar(); }
  }
  function cuentasHtml() {
    if (!cuentas) { cargarCuentas(); return '<div class="dz-vacio"><b>Cargando tus cuentas…</b></div>'; }
    const c = cuentas, caja = (t, x, cl) => `<div class="dz-cta ${cl || ''}"><span>${t}</span><b>${fmt(x.pago)}</b><small>${x.n} ${x.n === 1 ? 'domicilio' : 'domicilios'}</small></div>`;
    const dia = (d) => { try { const t = new Date(d + 'T12:00:00').toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short' }); return t.charAt(0).toUpperCase() + t.slice(1); } catch (e) { return d; } };
    return `<div class="dz-ctas">${caja('Hoy', c.hoy, 'hoy')}${caja('Esta semana', c.semana)}${caja('Este mes', c.mes)}</div>
      ${(c.dias || []).length ? `<div class="dz-dias"><b>Por día</b>${c.dias.map((d) => `<div><span>${esc(dia(d.dia))}</span><small>${d.n} dom.</small><b>${fmt(d.pago)}</b></div>`).join('')}</div>` : ''}
      <p class="dz-act">Lo que te corresponde según la zona de cada domicilio. Cualquier duda, habla con el negocio.</p>`;
  }
  const vacio = () => tab !== 'hechos'
    ? `<div class="dz-vacio"><div class="dz-vacio-ic"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 7.5M5.5 17.5 9 10h6l3.5 7.5M9 10l-1.5-3H5"/></svg></div><b>No tienes pedidos por entregar</b><span>Cuando te asignen uno, aparece aquí y el celular vibra.</span></div>`
    : '<div class="dz-vacio"><b>Aún no has entregado pedidos hoy</b></div>';

  function tarjeta(e) {
    const min = desde(e.asignado_en);
    const enCamino = e.estado === 'en_camino';
    const t = tel(e.telefono);
    const q = encodeURIComponent([e.direccion, e.zona].filter(Boolean).join(', '));
    const items = String(e.items || '').split('\n').filter(Boolean);
    return `<article class="dz-ped${enCamino ? ' camino' : ''}${min >= LENTO ? ' tarde' : ''}" data-p="${esc(e.pedido)}">
      <div class="dz-ped-h">
        <b class="dz-num">#${esc(e.numero || e.pedido)}</b>
        <span class="dz-est">${enCamino ? 'En camino' : 'Asignado'}</span>
        <span class="dz-reloj" data-desde="${esc(e.asignado_en)}"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>${dur(min)}</span>
      </div>
      <div class="dz-cli">
        <b>${esc(e.cliente || 'Cliente')}</b>
        <p class="dz-dir">${esc(e.direccion || 'Sin dirección')}${e.zona ? `<small>${esc(e.zona)}</small>` : ''}</p>
      </div>
      <div class="dz-acc3">
        ${q ? `<a class="dz-chip" href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>Mapa</a>` : ''}
        ${t ? `<a class="dz-chip" href="tel:+57${t}"><svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>Llamar</a>
        <a class="dz-chip" href="https://wa.me/57${t}" target="_blank" rel="noopener"><svg viewBox="0 0 24 24"><path d="M21 11.5a8.4 8.4 0 0 1-12.5 7.4L3 20.5l1.6-5.3A8.4 8.4 0 1 1 21 11.5z"/></svg>WhatsApp</a>` : ''}
      </div>
      ${items.length ? `<ul class="dz-items">${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
      ${e.notas ? `<p class="dz-notas">📝 ${esc(e.notas)}</p>` : ''}
      <div class="dz-pago ${Number(e.cobrar) > 0 ? 'cobrar' : 'ok'}">
        ${Number(e.cobrar) > 0 ? `<span>Cobrar al cliente${e.pago ? ' · ' + esc(e.pago) : ''}</span><b>${fmt(e.cobrar)}</b>` : `<span>${e.pago ? esc(e.pago) + ' · ' : ''}No hay que cobrar</span><b>✓</b>`}
      </div>
      <div class="dz-pasos"><span class="on">Asignado<small>${hora(e.asignado_en)}</small></span><span class="${enCamino ? 'on' : ''}">Salió<small>${e.salio_en ? hora(e.salio_en) : '—'}</small></span><span>Entregado<small>—</small></span></div>
      ${enCamino ? '<button type="button" class="dz-btn ok dz-grande" data-accion="entregado"><svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>Marcar entregado</button>' : '<p class="dz-porsalir">Sale con la ruta: toca "Salí con la ruta" arriba.</p>'}
    </article>`;
  }
  function hecha(e) {
    const tot = desde(e.asignado_en || e.salio_en, e.entregado_en);
    const cam = e.salio_en ? desde(e.salio_en, e.entregado_en) : null;
    return `<article class="dz-hecha"><b class="dz-num">#${esc(e.numero || e.pedido)}</b>
      <div><b>${esc(e.cliente || 'Cliente')}</b><small>${esc(e.zona || e.direccion || '')} · entregado ${hora(e.entregado_en)}</small></div>
      <span class="dz-tt${tot >= LENTO ? ' tarde' : ''}"><b>${dur(tot)}</b><small>${cam != null ? 'en camino ' + dur(cam) : 'total'}</small></span></article>`;
  }

  /* ---------------- Acciones ---------------- */
  $('aLista').addEventListener('click', (ev) => {
    const sr = ev.target.closest('[data-salir-ruta]');
    if (sr) {
      const l = lista.filter((e) => (e.ruta || 'p' + e.pedido) === sr.dataset.salirRuta && e.estado === 'asignado');
      if (!l.length) return;
      confirmar(`¿Sales ya con ${l.length === 1 ? 'el pedido' : 'los ' + l.length + ' pedidos'}?`, `Se guarda la hora de salida de: ${l.map((e) => '#' + (e.numero || e.pedido)).join(', ')}.`, async () => {
        sr.disabled = true; sr.classList.add('cargando');
        let mal = null;
        for (const e of l) {
          const r = await API.estado(e.pedido, 'en_camino');
          if (!r || !r.ok) { mal = r; continue; }
          const i = lista.findIndex((x) => x.pedido === e.pedido); if (i >= 0 && r.entrega) lista[i] = r.entrega;
        }
        if (mal) { toast((mal && mal.error) || 'Algunos no se pudieron guardar. Intenta de nuevo.'); if (mal && mal.error === 'sesion') { vista(); return; } cargar(); }
        else { if (navigator.vibrate) navigator.vibrate(40); toast('¡En camino! 🛵 Buena ruta'); }
        pintar();
      });
      return;
    }
    const b = ev.target.closest('[data-accion]');
    if (!b) return;
    const card = b.closest('[data-p]'), e = lista.find((x) => String(x.pedido) === card.dataset.p);
    if (!e) return;
    const acc = b.dataset.accion;
    confirmar(acc === 'entregado' ? `¿Entregaste el pedido #${e.numero || e.pedido}?` : `¿Sales ya con el pedido #${e.numero || e.pedido}?`,
      acc === 'entregado' ? `Cliente: ${e.cliente || ''}${Number(e.cobrar) > 0 ? ` · recuerda cobrar ${fmt(e.cobrar)}` : ''}. Se guarda la hora de entrega.` : `Se guarda la hora de salida para ${e.cliente || 'el cliente'}.`,
      async () => {
        b.disabled = true; b.classList.add('cargando');
        const r = await API.estado(e.pedido, acc);
        if (!r || !r.ok) { b.disabled = false; b.classList.remove('cargando'); toast((r && r.error) || 'No se pudo guardar. Intenta de nuevo.'); if (r && r.error === 'sesion') vista(); else cargar(); return; }
        if (navigator.vibrate) navigator.vibrate(40);
        toast(acc === 'entregado' ? '¡Entregado! Buen trabajo 🙌' : '¡En camino! 🛵');
        if (acc === 'entregado') cuentas = null;
        const i = lista.findIndex((x) => x.pedido === e.pedido); if (i >= 0 && r.entrega) lista[i] = r.entrega;
        pintar();
      });
  });
  document.querySelectorAll('.dz-tabs button').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.dz-tabs button').forEach((x) => x.classList.toggle('on', x === b));
    if (tab === 'cuentas') cargarCuentas();
    pintar();
  }));

  /* ---------------- Confirmación (hoja inferior) ---------------- */
  let alSi = null;
  function confirmar(tit, txt, si) {
    $('hTit').textContent = tit; $('hTxt').textContent = txt; alSi = si;
    $('hConfirmar').hidden = false;
    requestAnimationFrame(() => $('hConfirmar').classList.add('on'));
  }
  function cerrarHoja() { $('hConfirmar').classList.remove('on'); setTimeout(() => { $('hConfirmar').hidden = true; }, 200); }
  $('hConfirmar').addEventListener('click', (e) => {
    if (e.target.closest('[data-si]')) { const f = alSi; cerrarHoja(); if (f) f(); }
    else if (e.target.closest('[data-no]') || e.target === $('hConfirmar')) cerrarHoja();
  });

  /* ---------------- Avisos ---------------- */
  let tT = null;
  function toast(t) { const el = $('aToast'); el.textContent = t; el.hidden = false; clearTimeout(tT); tT = setTimeout(() => { el.hidden = true; }, 3200); }
  let audio = null;
  function sonar(soloPreparar) {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === 'suspended') audio.resume();
      if (soloPreparar) return;
      [0, 0.18].forEach((d) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
        g.gain.setValueAtTime(0.0001, audio.currentTime + d); g.gain.exponentialRampToValueAtTime(0.25, audio.currentTime + d + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + d + 0.16);
        o.start(audio.currentTime + d); o.stop(audio.currentTime + d + 0.17);
      });
    } catch (e) { /* sin sonido */ }
  }
  document.addEventListener('pointerdown', () => sonar(true), { once: true });
  function avisarNuevo(nuevos) {
    // En turno, la app ya suena y vibra con su propia notificación: aquí solo se muestra el mensaje
    if (!(APP && appEstado === 'activo')) {
      if (APP) { try { SmashApp.vibrar(800); } catch (e) { /* sin app */ } } else if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
      sonar();
    }
    toast(nuevos.length > 1 ? `Te asignaron ${nuevos.length} pedidos nuevos` : `Nuevo pedido #${nuevos[0].numero || nuevos[0].pedido} para ${nuevos[0].cliente || 'entregar'}`);
    if (tab !== 'activos') document.querySelector('.dz-tabs [data-tab="activos"]').click();
  }

  /* ============================================================
     UBICACIÓN EN VIVO
     - El minimapa muestra dónde estás (solo en este celular).
     - Mientras tengas pedidos por entregar, tu ubicación se envía al
       negocio (cada ~10 s o al moverte 40 m) para verla en el mapa de
       los paneles. Sin pedidos, se deja de enviar y se borra.
     - Con un pedido "En camino" la pantalla no se apaga sola, para
       que el GPS siga funcionando.
     ============================================================ */
  let gpsId = null, mapa = null, yo = null, aro = null, pos = null, centrado = false, siguiendo = true;
  let enviado = null, compartiendo = false, revisado = false, wake = null, estadoGps = 'buscando';
  /* App SMASH Domicilios (Android): window.SmashApp existe. El domiciliario inicia su TURNO y
     la app (servicio "SMASH · En turno") le avisa los pedidos nuevos con sonido y vibración y
     comparte su ubicación, aunque la pantalla esté apagada. La página solo muestra el estado. */
  const APP = (() => { try { return !!(window.SmashApp && SmashApp.disponible() === '1'); } catch (e) { return false; } })();
  const estadoApp = () => { try { return SmashApp.estadoTurno ? SmashApp.estadoTurno() : SmashApp.estadoRastreo(); } catch (e) { return 'inactivo'; } };
  let appEstado = APP ? estadoApp() : '';
  window.SmashAppEstado = (e) => { appEstado = e; pintarTurno(); pintarGps(); };
  if (APP) document.documentElement.classList.add('en-app');

  function pintarTurno() {
    const el = $('aTurno');
    if (!el) return;
    el.hidden = !APP || !API.sesion();
    if (el.hidden) return;
    const on = appEstado === 'activo';
    let desdeTxt = '';
    try { const ms = Number(SmashApp.turnoDesde && SmashApp.turnoDesde()); if (ms > 0) desdeTxt = ' desde las ' + hora(new Date(ms).toISOString()); } catch (e) { /* sin hora */ }
    el.className = 'dz-turno' + (on ? ' on' : '');
    el.innerHTML = on
      ? `<div class="dz-turno-t"><span class="dz-turno-dot"></span><div><b>En turno${esc(desdeTxt)}</b><small>Te avisamos con sonido cada pedido nuevo, aunque tengas el celular en el bolsillo.</small></div></div>
         <button type="button" class="dz-btn dz-turno-fin" id="bTurnoFin">Terminar turno</button>`
      : `<div class="dz-turno-t"><span class="dz-turno-dot"></span><div><b>Estás fuera de turno</b><small>${appEstado === 'sin_permiso' ? 'Para iniciar el turno, permite la ubicación y las notificaciones.' : 'Inicia el turno para recibir tus pedidos con sonido y vibración.'}</small></div></div>
         <button type="button" class="dz-btn prim dz-turno-ini" id="bTurnoIni"><svg viewBox="0 0 24 24"><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><path d="M15 6h2l3 7.5M5.5 17.5 9 10h6l3.5 7.5"/></svg>Iniciar turno</button>
         ${appEstado === 'sin_permiso' ? '<button type="button" class="dz-ajustes" id="bAjustesTurno">Abrir ajustes</button>' : ''}`;
    const ini = $('bTurnoIni'), fin = $('bTurnoFin'), aj = $('bAjustesTurno');
    if (ini) ini.onclick = () => {
      const s = API.sesion(); if (!s || !s.token) return;
      sonar(true);
      try { if (SmashApp.iniciarTurno) SmashApp.iniciarTurno(s.token); else SmashApp.iniciarRastreo(s.token); } catch (e) { /* sin app */ }
      setTimeout(() => window.SmashAppEstado(estadoApp()), 1500);
    };
    if (fin) fin.onclick = () => {
      const n = activos().length;
      confirmar('¿Terminar el turno?', n ? `Todavía tienes ${n} ${n === 1 ? 'pedido' : 'pedidos'} por entregar. Si terminas, el negocio deja de ver tu ubicación y no te avisaremos pedidos nuevos.` : 'Dejarás de recibir avisos de pedidos y de compartir tu ubicación.', () => {
        try { if (SmashApp.terminarTurno) SmashApp.terminarTurno(); else SmashApp.detenerRastreo(); } catch (e) { /* sin app */ }
        setTimeout(() => window.SmashAppEstado(estadoApp()), 800);
      });
    };
    if (aj) aj.onclick = () => { try { SmashApp.abrirAjustes(); } catch (e) { /* sin app */ } };
  }
  const activos = () => lista.filter((e) => e.estado === 'asignado' || e.estado === 'en_camino');
  const metros = (a, b) => {
    const R = 6371000, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  function pintarGps() {
    const el = $('gpsEstado'), ay = $('gpsAyuda');
    if (APP) {
      // En la app: la ubicación la comparte el turno (botón de arriba)
      const on = appEstado === 'activo';
      el.className = 'dz-gps ' + (on ? 'on' : 'solo');
      el.lastChild.textContent = on ? 'En turno · compartiendo con el negocio' : 'Fuera de turno · solo tú ves el mapa';
      ay.hidden = true;
      return;
    }
    const t = { buscando: 'Buscando tu ubicación…', no: 'Ubicación desactivada', sin: 'Este celular no tiene GPS' }[estadoGps]
      || (compartiendo ? 'Compartiendo con el negocio' : 'Solo tú la ves · sin pedidos');
    el.className = 'dz-gps ' + (estadoGps === 'ok' ? (compartiendo ? 'on' : 'solo') : estadoGps === 'buscando' ? '' : 'mal');
    el.lastChild.textContent = t;
    ay.hidden = estadoGps !== 'no';
    if (estadoGps === 'no') ay.textContent = 'Activa la ubicación del celular y permite que esta página la use (toca el candado junto a la dirección). Así el negocio sabe por dónde vas.';
  }
  async function iniciarMapa() {
    if (mapa || typeof SmashMapa === 'undefined') return;
    try {
      mapa = await SmashMapa.crear($('mMapa'), { tema: 'oscuro', zoom: false });
      mapa.on('dragstart', () => { siguiendo = false; });
      if (pos) moverYo();
    } catch (e) { $('mMapa').innerHTML = '<p class="dz-mapa-err">No se pudo cargar el mapa.</p>'; }
  }
  function moverYo() {
    if (!mapa || !pos) return;
    const L = window.L, ll = [pos.lat, pos.lng];
    if (!yo) {
      yo = L.marker(ll, { icon: SmashMapa.icono((API.sesion() || {}).nombre ? API.sesion().nombre.charAt(0).toUpperCase() : '•', 'yo', pos.rumbo), zIndexOffset: 1000 }).addTo(mapa);
      aro = L.circle(ll, { radius: pos.precision || 30, color: '#e3262f', weight: 1, fillColor: '#e3262f', fillOpacity: 0.08 }).addTo(mapa);
    } else {
      yo.setLatLng(ll); aro.setLatLng(ll).setRadius(pos.precision || 30);
      yo.setIcon(SmashMapa.icono((API.sesion() || {}).nombre ? API.sesion().nombre.charAt(0).toUpperCase() : '•', 'yo', pos.rumbo));
    }
    if (!centrado) { mapa.setView(ll, 16); centrado = true; } else if (siguiendo) mapa.panTo(ll, { animate: true });
  }
  function alPosicion(p) {
    const c = p.coords;
    pos = { lat: c.latitude, lng: c.longitude, precision: c.accuracy != null ? Math.round(c.accuracy) : null,
      rumbo: c.heading != null && !isNaN(c.heading) ? Math.round(c.heading) : null,
      velocidad: c.speed != null && !isNaN(c.speed) ? Math.round(c.speed * 3.6) : null };
    estadoGps = 'ok'; pintarGps(); moverYo(); enviar(false);
  }
  function alError(e) {
    estadoGps = e && e.code === 1 ? 'no' : (pos ? 'ok' : 'buscando');
    pintarGps();
  }
  function iniciarGps() {
    if (gpsId != null) return;
    if (!navigator.geolocation) { estadoGps = 'sin'; pintarGps(); return; }
    gpsId = navigator.geolocation.watchPosition(alPosicion, alError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }
  function pararGps() { if (gpsId != null && navigator.geolocation) navigator.geolocation.clearWatch(gpsId); gpsId = null; }
  async function enviar(forzar) {
    if (APP || !compartiendo || !pos) return;   // en la app la ubicación la envía el servicio nativo
    const t = Date.now();
    if (!forzar && enviado && (t - enviado.t < 4000 || (t - enviado.t < 10000 && metros(enviado, pos) < 40))) return;
    enviado = { t, lat: pos.lat, lng: pos.lng };
    const r = await API.ubicar(pos);
    if (r && !r.ok && r.error === 'sesion') vista();
  }
  // Se llama cada vez que cambia la lista de pedidos
  async function revisarCompartir() {
    const antes = compartiendo, primera = !revisado;
    revisado = true;
    compartiendo = activos().length > 0;
    if (compartiendo && !antes) enviar(true);
    if (APP) {
      // En la app manda el turno (lo inicia y termina el domiciliario): aquí solo se lee su estado
      appEstado = estadoApp();
      pintarTurno();
    } else if (!compartiendo && (antes || primera)) {
      // Navegador: sin pedidos se deja de enviar y se borra la última posición
      enviado = null; await API.ocultar();
    }
    pintarGps();
    $('bBolsillo').hidden = APP || !compartiendo;
    if (!compartiendo) bolsillo(false);
    await pantalla();
  }
  // Pantalla encendida mientras tenga ruta: con la pantalla apagada el navegador deja de dar la ubicación
  async function pantalla() {
    if (APP) return;   // la app no necesita la pantalla encendida
    try {
      if (compartiendo && !wake && navigator.wakeLock && document.visibilityState === 'visible') { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); }
      if (!compartiendo && wake) { wake.release(); wake = null; }
    } catch (e) { wake = null; }
  }
  // Al salir de la página (otra app, bloquear el celular) se avisa al negocio; al volver, se envía de una vez
  document.addEventListener('visibilitychange', () => {
    if (!compartiendo || APP) return;   // en la app la ubicación sigue llegando aunque salga de la pantalla
    if (document.visibilityState === 'hidden') API.fondo();
    else { enviar(true); pantalla(); }
  });

  /* ---------------- Modo bolsillo ----------------
     Pantalla negra que deja el celular encendido (el GPS sigue funcionando) gastando
     poca batería y sin tocar nada por accidente. Se sale manteniendo presionado. */
  function bolsillo(si) {
    $('vBolsillo').hidden = !si;
    document.body.classList.toggle('en-bolsillo', si);
    if (si) { $('bolTxt').textContent = activos().length + ' por entregar · compartiendo tu ubicación'; pantalla(); }
  }
  $('bBolsillo').addEventListener('click', () => bolsillo(true));
  let tBol = null;
  const soltar = () => { clearTimeout(tBol); $('bDesbloquear').classList.remove('llenando'); };
  $('bDesbloquear').addEventListener('pointerdown', (e) => { e.preventDefault(); $('bDesbloquear').classList.add('llenando'); tBol = setTimeout(() => { soltar(); bolsillo(false); }, 1200); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('bDesbloquear').addEventListener(ev, soltar));
  $('vBolsillo').addEventListener('contextmenu', (e) => e.preventDefault());
  $('bCentrar').addEventListener('click', () => { siguiendo = true; if (mapa && pos) mapa.setView([pos.lat, pos.lng], Math.max(mapa.getZoom(), 16)); });
  $('bMapaTam').addEventListener('click', () => {
    const g = $('aMapa').classList.toggle('grande');
    $('bMapaTam').setAttribute('aria-label', g ? 'Achicar mapa' : 'Agrandar mapa');
    setTimeout(() => { if (mapa) mapa.invalidateSize(); }, 260);
  });
  // Copia de prueba (localhost): permite simular el GPS desde la consola
  if (SmashDomiNube.PRUEBA) window.SmashDomiGPS = { simular: (lat, lng, rumbo, kmh) => alPosicion({ coords: { latitude: lat, longitude: lng, accuracy: 12, heading: rumbo, speed: kmh != null ? kmh / 3.6 : null } }) };

  /* ---------------- Relojes y revisión ---------------- */
  setInterval(() => {
    document.querySelectorAll('.dz-reloj[data-desde]').forEach((r) => {
      const m = desde(r.dataset.desde);
      r.lastChild.textContent = dur(m);
      r.closest('.dz-ped').classList.toggle('tarde', m >= LENTO);
    });
  }, 30000);
  setInterval(() => { if (document.visibilityState === 'visible') cargar(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') cargar(); });
  window.addEventListener('online', cargar);

  vista();
})();
