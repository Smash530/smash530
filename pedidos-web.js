/* ============================================================
   SMASH · pedidos-web.js  (panel de cocina / caja)
   Recibe en tiempo real los pedidos que los clientes hacen en la
   página web (tabla pedidos_web de Supabase) y los guarda solos en
   "Pedidos pendientes", listos para imprimir la comanda.
   - Funciona en el panel de cocina y en el de dueños.
   - Necesita una cuenta con rol Caja o Dueño conectada en
     "⭐ Clientes leales" (queda guardada en este equipo).
   - Un mismo pedido nunca entra dos veces: se reconoce por su N°.
   - El mensaje de WhatsApp sigue llegando como confirmación; si se
     pega en "Agregar pedido de WhatsApp" se detecta como repetido.
   ============================================================ */
const SmashPedidosWeb = (function () {
  const N = typeof SmashNube !== 'undefined' ? SmashNube : null;
  const el = () => document.getElementById('webEstado');
  let detener = null, recibidos = 0, ultimo = '';

  const txt = (v, n) => String(v == null ? '' : v).slice(0, n);
  const num = (v) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= 0 ? n : 0; };

  // Los datos llegan de internet: se limpian antes de guardarlos
  function limpiar(f) {
    const d = f.datos || {};
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 60).map((it) => {
      const l = { id: txt(it && it.id, 60), name: txt(it && it.name, 120), price: num(it && it.price), qty: Math.min(99, Math.max(1, num(it && it.qty) || 1)) };
      if (it && it.cat) l.cat = txt(it.cat, 30);
      if (it && it.nota) l.nota = txt(it.nota, 200);
      return l;
    }).filter((l) => l.id && l.name);
    if (!items.length) return null;
    const o = {
      ref: txt(f.ref, 20), origen: 'web',
      cliente: txt(d.cliente, 80) || 'Cliente web', telefono: txt(d.telefono, 20), telefono2: txt(d.telefono2, 20),
      direccion: txt(d.direccion, 200), zona: txt(d.zona, 60), pago: txt(d.pago, 30), notas: txt(d.notas, 500),
      domicilio: num(d.domicilio), domicilioPendiente: !!d.domicilioPendiente, reserva: !!d.reserva, horaEntrega: txt(d.horaEntrega, 40), items,
    };
    // Descuento de cliente leal: solo si el pedido viene de una cuenta (se verifica al sumar puntos)
    if (f.cuenta && d.cuenta && d.cuenta.correo) {
      o.cuenta = { usuario: txt(d.cuenta.usuario, 30), correo: txt(d.cuenta.correo, 120) };
      o.descuento = num(d.descuento);
      o.descuentos = (Array.isArray(d.descuentos) ? d.descuentos : []).slice(0, 10).map((x) => ({ titulo: txt(x && (x.titulo || x.motivo), 80), valor: num(x && x.valor) }));
    }
    return o;
  }

  function alPedido(f) {
    const o = limpiar(f);
    if (!o) return;
    const r = SmashExt.addOrder(o);
    if (r.ok) { recibidos++; ultimo = o.ref; pintar(); }
    if (r.ok || r.dup) N.marcarRecibido(f.ref).catch(() => {});
  }

  // Estado visible: conexión + última revisión + error real (para saber dónde se queda un pedido)
  const S = { con: 'conectando', total: null, hora: null, error: '' };
  const TXT = {
    'en-vivo': ['on', '🟢 Pedidos web en tiempo real: llegan solos a esta lista.'],
    respaldo: ['on', '🟡 Pedidos web: conexión en vivo lenta, se revisan cada 15 segundos.'],
    conectando: ['prog', '⏳ Conectando con los pedidos web…'],
    'sin-sesion': ['off', '⚠ Para recibir los pedidos de la página automáticamente, conecta la cuenta de caja o dueño en "⭐ Clientes leales".'],
    'sin-tabla': ['off', '⚠ Falta preparar la base: ejecuta supabase/pedidos-en-linea.sql en Supabase (una vez).'],
    'sin-nube': ['off', '⚠ Sin conexión con la nube: los pedidos web no llegan solos. Revisa el internet y recarga.'],
    'otra-pestana': ['prog', 'ℹ Los pedidos web los está recibiendo otra pestaña abierta de este navegador; aparecen aquí también.'],
  };
  const hhmm = (d) => d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).replace(/[  ]/g, ' ');
  function alEstado(e, info) {
    if (e === 'revisado') { S.total = info.total; S.hora = info.hora; S.error = ''; }
    else if (e === 'error' || e === 'sin-tabla') { S.error = (info && info.error) || 'error desconocido'; if (e === 'sin-tabla') S.con = e; }
    else S.con = e;
    pintar();
  }
  function pintar() {
    const b = el(); if (!b) return;
    const t = S.error && S.con !== 'sin-tabla' ? ['off', '⚠ No se pudieron revisar los pedidos web (' + S.error + '). Se reintenta solo.'] : TXT[S.con] || TXT.conectando;
    b.hidden = false; b.className = 'web-estado ' + t[0];
    let extra = '';
    if (S.hora && (S.con === 'en-vivo' || S.con === 'respaldo' || S.con === 'conectando'))
      extra = ' Última revisión ' + hhmm(S.hora) + ' · ' + S.total + ' pedido(s) web en las últimas 36 h' + (recibidos ? ' · nuevos aquí: ' + recibidos + (ultimo ? ' (último ' + ultimo + ')' : '') : '') + '.';
    b.textContent = t[1] + extra;
  }

  function iniciar() {
    if (detener) { detener(); detener = null; }
    if (!N) { S.con = 'sin-nube'; pintar(); return; }
    detener = N.recibirPedidos(alPedido, alEstado);
  }

  // Una sola pestaña por navegador recibe (evita pedidos repetidos si cocina y dueños están abiertos a la vez)
  let lider = false;
  function arrancar() {
    lider = true;
    let cuentaActual;
    if (N && N.alCambiar) N.alCambiar((p) => { const id = p ? p.id + ':' + p.rol : ''; if (id !== cuentaActual) { cuentaActual = id; iniciar(); } });
    iniciar();
  }
  function empezar() {
    if (navigator.locks && navigator.locks.request) {
      navigator.locks.request('smash-pedidos-web', { ifAvailable: true }, (lock) => {
        if (lock) { arrancar(); return new Promise(() => {}); }   // se queda con el turno mientras la pestaña esté abierta
        S.con = 'otra-pestana'; pintar();
        // cuando la otra pestaña se cierre, esta toma el turno
        navigator.locks.request('smash-pedidos-web', () => { arrancar(); return new Promise(() => {}); });
        return null;
      });
    } else arrancar();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', empezar); else empezar();
  return { iniciar: () => { if (lider) iniciar(); }, estado: () => ({ ...S, recibidos, lider }) };
})();
