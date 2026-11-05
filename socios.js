/* ============================================================
   SMASH · socios.js (solo panel de dueños)
   "Reparto de socios": cuánto le corresponde al socio de la
   utilidad final del negocio, por día, semana y mes, y la cuenta
   de lo que ya se le guardó y entregó.

   De dónde sale la utilidad: SmashFinanzas.calcular (la misma de
   Informes) = ventas netas − costo de lo vendido − gastos
   operativos − costos fijos − nómina − otros egresos. Los gastos
   mensuales se reparten por igual en los días del mes, así cada
   día carga su parte del arriendo, internet, etc.
   Domicilios no cuentan (son del domiciliario).

   Reparto = (utilidad − reserva del negocio) × % del socio.
   Si un día hay pérdida, la parte del socio de ese día es negativa
   y se descuenta de lo acumulado (las pérdidas también se reparten).
   ============================================================ */
(function () {
  const root = document.querySelector('#section-socios .soc-root');
  if (!root || typeof SmashFinanzas === 'undefined') return;
  const F = SmashFinanzas, S = SmashStore, esc = SmashUI.esc, fmt = SmashUI.fmt;
  const K = { CFG: 'smash_socios_cfg', MOVS: 'smash_socios_movs' };
  const $ = (id) => document.getElementById(id);
  const r = (n) => Math.round(Number(n) || 0);
  const shown = () => !$('dashboardSection').hidden && !$('section-socios').hidden;

  /* ---------------- Configuración y movimientos ---------------- */
  const CFG0 = { socio: 'Socio', yo: 'Dueño', pct: 50, reserva: 0, inicio: S.today().slice(0, 8) + '01' };
  const getCfg = () => Object.assign({}, CFG0, S.read(K.CFG, {}));
  const getMovs = () => S.read(K.MOVS, []);
  const vigentes = () => getMovs().filter((m) => !m.anulado);

  /* ---------------- Fechas ---------------- */
  const addDays = (d, n) => { const x = new Date(d + 'T12:00:00'); x.setDate(x.getDate() + n); return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const fDia = (d, o) => new Date(d + 'T12:00:00').toLocaleDateString('es-CO', o || { weekday: 'short', day: 'numeric', month: 'short' });
  function etiqueta(tipo, d1, d2) {
    if (tipo === 'dia') return fDia(d1, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (tipo === 'mes') { const t = fDia(d1, { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
    return fDia(d1, { day: 'numeric', month: 'short' }) + ' – ' + fDia(d2, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function mover(tipo, ref, paso) {
    if (tipo === 'dia') return addDays(ref, paso);
    if (tipo === 'semana') return addDays(ref, 7 * paso);
    const d = new Date(ref + 'T12:00:00'); d.setDate(1); d.setMonth(d.getMonth() + paso);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  /* ---------------- Cálculo ---------------- */
  // Parte del socio a partir de una utilidad
  function repartir(util, c) {
    const reserva = util > 0 ? r((util * c.reserva) / 100) : 0;
    const base = util - reserva;
    const socio = r((base * c.pct) / 100);
    return { util, reserva, base, socio, yo: base - socio };
  }
  // Solo hasta hoy: los días que aún no pasan no cargan arriendo ni otros gastos mensuales
  function periodo(d1, d2, c) {
    const hoy = S.today(), R = F.calcular(d1, d2 > hoy ? hoy : d2);
    return Object.assign({ R }, repartir(R.utilidad, c));
  }
  function porDia(d1, d2, c) {
    const hoy = S.today(), guardado = {};
    vigentes().filter((m) => m.tipo === 'apartado').forEach((m) => { guardado[m.dia] = (guardado[m.dia] || 0) + m.monto; });
    return F.dias(d1, d2).map((d) => {
      const R = F.calcular(d, d), p = repartir(R.utilidad, c);
      return Object.assign(p, { d, futuro: d > hoy, netas: R.netas, costos: R.netas - R.utilidad, pedidos: R.nPedidos, guardado: guardado[d] || 0 });
    });
  }
  // Cuenta del socio desde el inicio de la sociedad hasta hoy
  function cuenta(c) {
    const hoy = S.today(), ini = c.inicio && c.inicio <= hoy ? c.inicio : hoy;
    const corresponde = periodo(ini, hoy, c).socio;
    const movs = vigentes().filter((m) => (m.tipo === 'entrega' ? m.fecha : m.dia) >= ini);
    const guardado = movs.filter((m) => m.tipo === 'apartado').reduce((s, m) => s + m.monto, 0);
    const entregado = movs.filter((m) => m.tipo === 'entrega').reduce((s, m) => s + m.monto, 0);
    return { ini, corresponde, guardado, entregado, porGuardar: corresponde - guardado, enCaja: guardado - entregado };
  }

  /* ---------------- Movimientos ---------------- */
  function agregar(m) {
    const list = getMovs();
    list.push(Object.assign({ id: S.uid('so'), en: S.nowISO(), por: 'dueño' }, m));
    S.save(K.MOVS, list);
  }
  function anular(id, motivo) {
    const list = getMovs(), m = list.find((x) => x.id === id);
    if (!m || m.anulado) throw new Error('El movimiento no existe o ya estaba anulado.');
    m.anulado = { motivo: String(motivo).trim().slice(0, 150), en: S.nowISO() };
    S.save(K.MOVS, list);
  }

  /* ---------------- Pantalla ---------------- */
  const ST = { tipo: 'dia', ref: S.today(), tabla: true };
  root.innerHTML = `
    <div class="soc-toolbar">
      <div class="soc-seg" id="socTabs" role="tablist">
        <button type="button" data-t="dia" class="on">Día</button><button type="button" data-t="semana">Semana</button><button type="button" data-t="mes">Mes</button>
      </div>
      <div class="soc-nav">
        <button type="button" class="soc-arrow" data-paso="-1" aria-label="Periodo anterior">‹</button>
        <div class="soc-label"><b id="socLabel"></b><input type="date" id="socRef" aria-label="Elegir fecha"></div>
        <button type="button" class="soc-arrow" data-paso="1" aria-label="Periodo siguiente">›</button>
        <button type="button" class="soc-hoy" id="socHoy">Hoy</button>
      </div>
    </div>
    <div id="socCuerpo"></div>`;
  $('socRef').value = ST.ref;
  $('socTabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-t]'); if (!b) return;
    ST.tipo = b.dataset.t;
    $('socTabs').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    render();
  });
  root.addEventListener('click', (e) => {
    const a = e.target.closest('[data-paso]');
    if (a) { ST.ref = mover(ST.tipo, ST.ref, +a.dataset.paso); $('socRef').value = ST.ref; render(); return; }
    if (e.target.id === 'socHoy') { ST.ref = S.today(); $('socRef').value = ST.ref; render(); return; }
    if (e.target.id === 'socLabel') { try { $('socRef').showPicker(); } catch (x) { $('socRef').focus(); } return; }
    const g = e.target.closest('[data-guardar]');
    if (g) { abrirGuardar(g.dataset.guardar); return; }
    if (e.target.closest('#socGuardarPer')) { abrirGuardarPeriodo(); return; }
    if (e.target.closest('#socEntregar')) { abrirEntrega(); return; }
    if (e.target.closest('#socConfig')) { abrirConfig(); return; }
    if (e.target.closest('#socCsv')) { descargarCsv(); return; }
    if (e.target.closest('#socTablaBtn')) { ST.tabla = !ST.tabla; render(); return; }
    const an = e.target.closest('[data-anular]');
    if (an) {
      const motivo = prompt('¿Por qué se anula este movimiento? (queda en el historial)');
      if (!motivo || !motivo.trim()) return;
      try { anular(an.dataset.anular, motivo); } catch (x) { alert(x.message); }
      render();
    }
  });
  $('socRef').addEventListener('change', (e) => { ST.ref = e.target.value || S.today(); render(); });

  function render() {
    if (!shown()) return;
    const c = getCfg(), [d1, d2] = F.periodo(ST.tipo, ST.ref);
    $('socLabel').textContent = etiqueta(ST.tipo, d1, d2);
    if (d1 > S.today()) {
      $('socCuerpo').innerHTML = `<div class="ol-empty"><b>Este periodo todavía no empieza</b><span>Vuelve a hoy con el botón "Hoy".</span></div>`;
      return;
    }
    const P = periodo(d1, d2, c), dias = ST.tipo === 'dia' ? null : porDia(d1, d2, c), C = cuenta(c), R = P.R, hoy = S.today();
    const enCurso = d1 <= hoy && hoy <= d2;
    const guardadoPer = vigentes().filter((m) => m.tipo === 'apartado' && m.dia >= d1 && m.dia <= d2).reduce((s, m) => s + m.monto, 0);
    const faltaPer = P.socio - guardadoPer;
    const pctY = 100 - c.pct, neg = (v) => (v < 0 ? ' neg' : '');
    const nombre = { dia: 'del día', semana: 'de la semana', mes: 'del mes' }[ST.tipo];
    const est = estadoGuardado(P.socio, guardadoPer);

    $('socCuerpo').innerHTML = `
      ${enCurso ? `<div class="soc-live"><span class="dot"></span>Periodo en curso: los valores cambian a medida que entran ventas y gastos.</div>` : ''}
      <div class="soc-hero">
        <div class="soc-card">
          <small>Utilidad neta ${nombre}</small>
          <b class="${neg(P.util)}">${fmt(P.util)}</b>
          <span class="soc-sub">${R.netas ? `${(R.utilidadPct || 0).toFixed(1)}% de ${fmt(R.netas)} en ventas netas` : 'Sin ventas en este periodo'}</span>
        </div>
        <div class="soc-card soc-main">
          <small>Parte de ${esc(c.socio)} · ${c.pct}%</small>
          <b class="${neg(P.socio)}">${fmt(P.socio)}</b>
          <span class="soc-pill ${est.k}">${est.t}</span>
          ${P.socio > 0 && faltaPer > 0 ? `<button type="button" class="soc-btn" id="socGuardarPer">Guardar ${fmt(faltaPer)}</button>` : ''}
        </div>
        <div class="soc-card">
          <small>Parte de ${esc(c.yo)} · ${pctY}%</small>
          <b class="${neg(P.yo)}">${fmt(P.yo)}</b>
          <span class="soc-sub">${P.reserva ? `Después de ${fmt(P.reserva)} de reserva (${c.reserva}%)` : 'Lo que queda para ti'}</span>
        </div>
      </div>

      <div class="soc-grid">
        <section class="soc-panel">
          <header><h3>Cómo se calcula</h3><span class="soc-muted">${esc(etiqueta(ST.tipo, d1, d2))}</span></header>
          <ul class="soc-flow">
            <li><span>Ventas netas</span><b>${fmt(R.netas)}</b></li>
            <li class="m"><span>Costo de lo vendido</span><b>− ${fmt(R.costoVendido)}</b></li>
            <li class="m"><span>Gastos operativos</span><b>− ${fmt(R.gastos.operativo)}</b></li>
            <li class="m"><span>Costos fijos <em>(arriendo, servicios…)</em></span><b>− ${fmt(R.gastos.fijo)}</b></li>
            <li class="m"><span>Nómina</span><b>− ${fmt(R.gastos.nomina)}</b></li>
            <li class="m"><span>Otros egresos</span><b>− ${fmt(R.gastos.otro)}</b></li>
            <li class="t"><span>Utilidad neta</span><b class="${neg(P.util)}">${fmt(P.util)}</b></li>
            ${c.reserva ? `<li class="m"><span>Reserva del negocio (${c.reserva}%)</span><b>− ${fmt(P.reserva)}</b></li><li class="t"><span>A repartir</span><b class="${neg(P.base)}">${fmt(P.base)}</b></li>` : ''}
            <li class="s"><span>${esc(c.socio)} · ${c.pct}%</span><b>${fmt(P.socio)}</b></li>
            <li class="s y"><span>${esc(c.yo)} · ${pctY}%</span><b>${fmt(P.yo)}</b></li>
          </ul>
          <p class="soc-note">Los gastos mensuales (arriendo, internet…) se reparten por igual en los días del mes. Los domicilios no cuentan: son del domiciliario. Todo sale de lo registrado en Pedidos, Inventario, Gastos, Caja y Contabilidad.</p>
        </section>

        <section class="soc-panel">
          <header><h3>Cuenta de ${esc(c.socio)}</h3><span class="soc-muted">desde ${esc(fDia(C.ini, { day: 'numeric', month: 'short', year: 'numeric' }))}</span></header>
          <div class="soc-acc">
            <div><small>Le corresponde</small><b class="${neg(C.corresponde)}">${fmt(C.corresponde)}</b></div>
            <div><small>Guardado</small><b>${fmt(C.guardado)}</b></div>
            <div><small>Entregado</small><b>${fmt(C.entregado)}</b></div>
          </div>
          <div class="soc-due ${C.porGuardar > 0 ? 'warn' : 'ok'}">
            <span>${C.porGuardar > 0 ? 'Falta por guardar' : C.porGuardar < 0 ? 'Guardado de más' : 'Todo guardado'}</span><b>${fmt(Math.abs(C.porGuardar))}</b>
          </div>
          <div class="soc-due neutral"><span>Guardado pendiente por entregarle</span><b>${fmt(C.enCaja)}</b></div>
          <div class="soc-actions">
            <button type="button" class="btn-primary" id="socEntregar">Registrar entrega</button>
            <button type="button" class="btn-secondary" id="socConfig">⚙️ Ajustes del reparto</button>
          </div>
        </section>
      </div>

      ${dias ? diasHtml(dias, c, faltaPer) : ''}
      ${movsHtml(c)}`;
  }

  function estadoGuardado(parte, guardado) {
    if (parte <= 0) return { k: 'mute', t: parte < 0 ? 'Pérdida: no hay parte para guardar' : 'Sin ganancia' };
    if (guardado >= parte) return { k: 'ok', t: '✓ Guardado' };
    if (guardado > 0) return { k: 'warn', t: `Faltan ${fmt(parte - guardado)}` };
    return { k: 'warn', t: 'Pendiente por guardar' };
  }

  // Lo que falta guardar en el periodo es NETO: los días con pérdida descuentan.
  // Ese neto se reparte en los días con ganancia, del más antiguo al más reciente.
  function asignar(dias, falta) {
    let resto = Math.max(0, falta);
    const out = {};
    dias.filter((x) => !x.futuro && x.socio > x.guardado && x.socio > 0).forEach((x) => {
      const v = Math.min(resto, x.socio - x.guardado);
      if (v > 0) { out[x.d] = v; resto -= v; }
    });
    return out;
  }
  function diasHtml(dias, c, faltaPer) {
    const sug = asignar(dias, faltaPer);
    const pasados = dias.filter((x) => !x.futuro);
    const max = Math.max(1, ...pasados.map((x) => Math.abs(x.socio)));
    const barras = dias.map((x) => {
      const h = x.futuro ? 0 : Math.max(x.socio ? 3 : 0, (Math.abs(x.socio) / max) * 100);
      return `<div class="soc-bar${x.futuro ? ' fut' : ''}${x.socio < 0 ? ' neg' : ''}" title="${esc(fDia(x.d))}: ${fmt(x.socio)}"><i style="height:${h}%"></i><span>${new Date(x.d + 'T12:00:00').getDate()}</span></div>`;
    }).join('');
    const filas = dias.slice().reverse().map((x) => {
      if (x.futuro) return '';
      const e = x.socio < 0 ? { k: 'mute', t: 'Pérdida: se descuenta' } : x.socio === 0 ? { k: 'mute', t: 'Sin ganancia' }
        : sug[x.d] ? { k: 'warn', t: 'Por guardar ' + fmt(sug[x.d]) } : x.guardado >= x.socio ? { k: 'ok', t: '✓ Guardado' } : x.guardado > 0 ? { k: 'ok', t: '✓ Guardado (neto)' } : { k: 'mute', t: 'Compensa pérdida' };
      return `<tr><td class="first">${esc(fDia(x.d))}</td><td class="num" data-l="Ventas netas">${fmt(x.netas)}</td><td class="num" data-l="Costos y gastos">${fmt(x.costos)}</td>
        <td class="num${x.util < 0 ? ' neg' : ''}" data-l="Utilidad">${fmt(x.util)}</td><td class="num soc-strong${x.socio < 0 ? ' neg' : ''}" data-l="Parte ${esc(c.socio)}">${fmt(x.socio)}</td>
        <td class="num" data-l="Guardado">${x.guardado ? fmt(x.guardado) : '—'}</td>
        <td data-l="Estado"><span class="soc-pill ${e.k}">${e.t}</span></td>
        <td class="num">${sug[x.d] ? `<button type="button" class="btn-sm" data-guardar="${x.d}">Guardar</button>` : ''}</td></tr>`;
    }).join('');
    return `<section class="soc-panel">
      <header><h3>Día a día</h3><div class="soc-head-acts"><button type="button" class="btn-sm" id="socTablaBtn">${ST.tabla ? 'Ocultar tabla' : 'Ver tabla'}</button><button type="button" class="btn-sm" id="socCsv">⬇ Descargar</button></div></header>
      <div class="soc-chart" role="img" aria-label="Parte del socio por día">${barras}</div>
      ${ST.tabla ? `<table class="rtable soc-table"><thead><tr><th>Día</th><th class="num">Ventas netas</th><th class="num">Costos y gastos</th><th class="num">Utilidad</th><th class="num">Parte ${esc(c.socio)}</th><th class="num">Guardado</th><th>Estado</th><th></th></tr></thead>
        <tbody>${filas || '<tr><td colspan="8" class="empty">Todavía no hay días en este periodo.</td></tr>'}</tbody></table>` : ''}
    </section>`;
  }

  function movsHtml(c) {
    const list = getMovs().slice().sort((a, b) => b.en.localeCompare(a.en)).slice(0, 40);
    if (!list.length) return `<section class="soc-panel"><header><h3>Movimientos</h3></header><p class="soc-note" style="margin:0">Aún no hay movimientos. Cuando guardes la parte de ${esc(c.socio)} o se la entregues, queda registrado aquí.</p></section>`;
    return `<section class="soc-panel"><header><h3>Movimientos</h3><span class="soc-muted">últimos ${list.length}</span></header>
      <ul class="soc-movs">${list.map((m) => `<li class="${m.anulado ? 'anul' : ''}">
        <span class="ic ${m.tipo}">${m.tipo === 'apartado' ? '↓' : '↗'}</span>
        <div><b>${m.tipo === 'apartado' ? 'Guardado · ' + esc(fDia(m.dia)) : 'Entregado a ' + esc(c.socio) + (m.medio ? ' · ' + esc(m.medio) : '')}</b>
          <small>${esc(new Date(m.en).toLocaleString('es-CO', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}${m.nota ? ' · ' + esc(m.nota) : ''}${m.anulado ? ' · Anulado: ' + esc(m.anulado.motivo) : ''}</small></div>
        <span class="v">${fmt(m.monto)}</span>
        ${m.anulado ? '' : `<button type="button" class="btn-sm" data-anular="${esc(m.id)}" aria-label="Anular movimiento">Anular</button>`}
      </li>`).join('')}</ul></section>`;
  }

  /* ---------------- Ventanas ---------------- */
  function leerMonto(m, sel) { return r(String(m.querySelector(sel).value).replace(/[^\d]/g, '')); }
  function error(m, t) { const p = m.querySelector('.soc-err'); p.textContent = t; return false; }

  // Neto que falta guardar en el periodo que se está viendo
  function pendientesPeriodo(c) {
    const [d1, d2] = F.periodo(ST.tipo, ST.ref), dias = porDia(d1, d2, c);
    const guardado = vigentes().filter((m) => m.tipo === 'apartado' && m.dia >= d1 && m.dia <= d2).reduce((s, m) => s + m.monto, 0);
    const falta = periodo(d1, d2, c).socio - guardado;
    return { dias, falta, sug: asignar(dias, falta) };
  }
  function abrirGuardar(dia) {
    const c = getCfg(), x = porDia(dia, dia, c)[0], P = pendientesPeriodo(c), falta = P.sug[dia] || 0;
    SmashUI.modal(`Guardar parte de ${esc(c.socio)}`,
      `<p class="hint">${esc(fDia(dia, { weekday: 'long', day: 'numeric', month: 'long' }))}: le corresponden <b>${fmt(x.socio)}</b>${x.guardado ? `, ya guardaste ${fmt(x.guardado)}` : ''}.${falta < x.socio - x.guardado ? ` Sugerimos ${fmt(falta)} porque otros días del periodo tuvieron pérdida.` : ''}</p>
       <label class="ed-wide">Valor guardado (COP)<input id="socMonto" inputmode="numeric" value="${falta}"></label>
       <label class="ed-wide">Nota (opcional)<input id="socNota" maxlength="120" placeholder="Ej: en el sobre del socio"></label>
       <p class="error soc-err"></p>`,
      (m) => {
        const v = leerMonto(m, '#socMonto');
        if (!(v > 0)) return error(m, 'Escribe el valor que guardaste.');
        try { agregar({ tipo: 'apartado', dia, monto: v, nota: m.querySelector('#socNota').value.trim().slice(0, 120) }); } catch (e) { return error(m, e.message); }
        render();
      }, 'Guardar');
  }
  // Guarda lo que falta de cada día del periodo (un movimiento por día)
  function abrirGuardarPeriodo() {
    const c = getCfg(), [d1] = F.periodo(ST.tipo, ST.ref);
    if (ST.tipo === 'dia') { abrirGuardar(d1); return; }
    const P = pendientesPeriodo(c), pend = Object.keys(P.sug).map((d) => ({ d, v: P.sug[d] }));
    const tot = pend.reduce((s, x) => s + x.v, 0), perdidas = P.dias.filter((x) => !x.futuro && x.socio < 0).reduce((s, x) => s + x.socio, 0);
    if (!tot) return;
    SmashUI.modal(`Guardar parte de ${esc(c.socio)}`,
      `<p class="hint">Se registra lo que falta del periodo, repartido en ${pend.length} ${pend.length === 1 ? 'día' : 'días'} con ganancia.</p>
       <div class="soc-due warn" style="margin:8px 0"><span>Total a guardar</span><b>${fmt(tot)}</b></div>
       ${perdidas ? `<p class="hint">Ya se descontaron ${fmt(Math.abs(perdidas))} de días con pérdida: las pérdidas también se reparten.</p>` : ''}
       <p class="error soc-err"></p>`,
      (m) => {
        try { const list = getMovs(); pend.forEach((x) => list.push({ id: S.uid('so'), en: S.nowISO(), por: 'dueño', tipo: 'apartado', dia: x.d, monto: x.v })); S.save(K.MOVS, list); }
        catch (e) { return error(m, e.message); }
        render();
      }, 'Guardar ' + fmt(tot));
  }
  function abrirEntrega() {
    const c = getCfg(), C = cuenta(c);
    SmashUI.modal(`Entregar dinero a ${esc(c.socio)}`,
      `<p class="hint">Guardado pendiente por entregarle: <b>${fmt(C.enCaja)}</b>.</p>
       <label class="ed-wide">Fecha<input type="date" id="socFecha" value="${S.today()}"></label>
       <label class="ed-wide">Valor entregado (COP)<input id="socMonto" inputmode="numeric" value="${Math.max(0, C.enCaja)}"></label>
       <label class="ed-wide">Medio<select id="socMedio"><option>Efectivo</option><option>Transferencia</option><option>Otro</option></select></label>
       <label class="ed-wide">Nota (opcional)<input id="socNota" maxlength="120"></label>
       <p class="error soc-err"></p>`,
      (m) => {
        const v = leerMonto(m, '#socMonto'), f = m.querySelector('#socFecha').value;
        if (!(v > 0)) return error(m, 'Escribe el valor entregado.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) return error(m, 'Elige la fecha.');
        try { agregar({ tipo: 'entrega', fecha: f, monto: v, medio: m.querySelector('#socMedio').value, nota: m.querySelector('#socNota').value.trim().slice(0, 120) }); } catch (e) { return error(m, e.message); }
        render();
      }, 'Registrar entrega');
  }
  function abrirConfig() {
    const c = getCfg();
    SmashUI.modal('Ajustes del reparto',
      `<div class="soc-cfg">
        <label>Nombre del socio<input id="cfSocio" maxlength="40" value="${esc(c.socio)}"></label>
        <label>Tu nombre<input id="cfYo" maxlength="40" value="${esc(c.yo)}"></label>
        <label>% para el socio<input id="cfPct" type="number" min="0" max="100" step="1" value="${c.pct}"></label>
        <label>Reserva del negocio antes de repartir (%)<input id="cfRes" type="number" min="0" max="100" step="1" value="${c.reserva}"></label>
        <label class="wide">Inicio de la cuenta del socio<input id="cfIni" type="date" value="${esc(c.inicio)}"></label>
      </div>
      <p class="hint">La reserva es opcional (por ejemplo, para reparaciones o imprevistos): se aparta de la utilidad antes de dividir. Déjala en 0 para repartir toda la utilidad. El inicio define desde cuándo se acumula lo que le corresponde al socio.</p>
      <p class="error soc-err"></p>`,
      (m) => {
        const v = (id) => m.querySelector(id).value;
        const pct = Number(v('#cfPct')), res = Number(v('#cfRes'));
        if (!(pct >= 0 && pct <= 100)) return error(m, 'El % del socio debe estar entre 0 y 100.');
        if (!(res >= 0 && res < 100)) return error(m, 'La reserva debe estar entre 0 y 99.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v('#cfIni'))) return error(m, 'Elige la fecha de inicio.');
        try { S.save(K.CFG, { socio: v('#cfSocio').trim().slice(0, 40) || 'Socio', yo: v('#cfYo').trim().slice(0, 40) || 'Dueño', pct, reserva: res, inicio: v('#cfIni') }); } catch (e) { return error(m, e.message); }
        render();
      }, 'Guardar ajustes');
  }

  function descargarCsv() {
    const c = getCfg(), [d1, d2] = F.periodo(ST.tipo, ST.ref);
    const rows = [['Dia', 'Ventas netas', 'Costos y gastos', 'Utilidad', 'Reserva', 'Parte ' + c.socio, 'Parte ' + c.yo, 'Guardado']];
    porDia(d1, d2, c).filter((x) => !x.futuro).forEach((x) => rows.push([x.d, x.netas, x.costos, x.util, x.reserva, x.socio, x.yo, x.guardado]));
    const csv = '﻿' + rows.map((r0) => r0.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\r\n');
    S.descargar(`reparto_socios_${d1}_a_${d2}.csv`, csv, 'text/csv;charset=utf-8');
  }

  document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => setTimeout(render, 0)));
  window.addEventListener('storage', (e) => { if (e.key && e.key.indexOf('smash_') === 0 && !document.querySelector('.smash-modal')) render(); });
  setInterval(() => { if (!document.querySelector('.smash-modal')) render(); }, 30000);
  render();
})();
