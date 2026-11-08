/* ============================================================
   SMASH · seguimiento-panel.js  (cocina y dueños)
   Publica en la nube el estado de los pedidos que llegaron desde la
   página web (confirmado, en preparación, en camino, entregado…),
   para que el cliente vea en su celular en qué va su pedido.
   - Se publica al cambiar el estado y, por si algo falla, cada 30 s
     se revisan los pedidos web de los últimos 2 días.
   - No cambia nada de los pedidos: solo lee su estado.
   - Recuerda en este equipo lo ya publicado para no repetirlo.
   Necesita supabase/seguimiento-pedidos.sql y el panel conectado.
   ============================================================ */
const SmashSeguimiento = (function () {
  const N = typeof SmashNube !== 'undefined' && SmashNube.ok ? SmashNube : null;
  if (!N || !N.panelEstadosPedidos) return { revisar() {} };
  const LS = 'smash_seguimiento_pub';
  const lee = () => { try { return JSON.parse(localStorage.getItem(LS) || '{}') || {}; } catch (e) { return {}; } };
  const guarda = (m) => { try { localStorage.setItem(LS, JSON.stringify(m)); } catch (e) { /* sin espacio */ } };
  let ocupado = false, falta = false;

  async function revisar() {
    if (ocupado || falta || !(N.panelSesion && N.panelSesion())) return;
    const desde = Date.now() - 2 * 864e5, pub = lee(), lista = [];
    SmashDB.getOrders().forEach((o) => {
      if (!o.ref || o.origen !== 'web' || !o.status) return;
      if (new Date(o.creado || 0).getTime() < desde) return;
      if (pub[o.ref] !== o.status) lista.push({ ref: o.ref, estado: o.status });
    });
    if (!lista.length) return;
    ocupado = true;
    try {
      const r = await N.panelEstadosPedidos(lista.slice(0, 60));
      if (r && r.ok) {
        const m = lee();
        lista.slice(0, 60).forEach((x) => { m[x.ref] = x.estado; });
        // se olvidan los de hace más de 3 días
        Object.keys(m).forEach((k) => { if (!SmashDB.getOrders().some((o) => o.ref === k && new Date(o.creado || 0).getTime() > Date.now() - 3 * 864e5)) delete m[k]; });
        guarda(m);
      } else if (r && r.falta) falta = true;   // falta el SQL: no se insiste hasta recargar
    } catch (e) { /* sin internet: se reintenta en la próxima vuelta */ }
    ocupado = false;
  }

  // Al cambiar un estado, se publica de una vez
  if (typeof SmashExt !== 'undefined' && SmashExt.setStatus) {
    const antes = SmashExt.setStatus;
    SmashExt.setStatus = function () { const r = antes.apply(this, arguments); setTimeout(revisar, 300); return r; };
  }
  setInterval(revisar, 30000);
  setTimeout(revisar, 5000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') revisar(); });
  return { revisar };
})();
