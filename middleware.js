/* ============================================================
   SMASH · middleware.js (solo en Vercel)
   Se ejecuta en el servidor de Vercel antes de entregar cualquier
   archivo. La página de clientes queda pública; todo lo demás
   (panel de caja, panel de dueños y sus scripts) pide usuario y
   clave. Las claves NO están en el código: vienen de las variables
   de entorno del proyecto en Vercel.

     CAJA_USUARIO / CAJA_CLAVE    → panel de caja
     DUENO_USUARIO / DUENO_CLAVE  → panel de dueños (y también caja)

   Si falta alguna variable, nada protegido se entrega (falla cerrado).
   ============================================================ */
export const config = { runtime: 'nodejs', matcher: ['/:path*'] };

// Lo único que ve un cliente sin clave
const PUBLICO = new Set([
  '/', '/index.html', '/cliente.html', '/cliente.css', '/cliente-resp.css',
  '/cliente.js', '/data.js', '/data-ext.js', '/menu.json', '/favicon.ico',
]);
// Solo para dueños
const DUENOS = new Set([
  '/dueno', '/dueno.html', '/dueno.js', '/dueno.css', '/costos-ui.js',
  '/finanzas-ui.js', '/inventario-ui.js', '/auditoria-ui.js',
]);

// Equivale a next() de @vercel/functions: deja pasar la petición sin instalar paquetes
const seguir = () => new Response(null, { headers: { 'x-middleware-next': '1' } });

function igual(a, b) {
  // Comparación en tiempo constante para no dar pistas por la demora de la respuesta
  a = String(a); b = String(b);
  let d = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return d === 0;
}

function credenciales(request) {
  const h = request.headers.get('authorization') || '';
  if (!h.startsWith('Basic ')) return null;
  try {
    const txt = Buffer.from(h.slice(6), 'base64').toString('utf8');
    const i = txt.indexOf(':');
    return i < 0 ? null : { u: txt.slice(0, i), p: txt.slice(i + 1) };
  } catch (e) { return null; }
}

const pedir = (zona) => new Response('Acceso restringido.', {
  status: 401,
  headers: { 'WWW-Authenticate': `Basic realm="${zona}", charset="UTF-8"`, 'Cache-Control': 'no-store' },
});

export default function middleware(request) {
  let ruta;
  try { ruta = decodeURIComponent(new URL(request.url).pathname).toLowerCase(); } catch (e) { return pedir('SMASH Panel'); }
  if (ruta.includes('..') || ruta.includes('\\')) return pedir('SMASH Panel'); // rutas disfrazadas
  if (PUBLICO.has(ruta) || ruta.startsWith('/images/')) return seguir();

  const env = process.env;
  if (!env.CAJA_USUARIO || !env.CAJA_CLAVE || !env.DUENO_USUARIO || !env.DUENO_CLAVE) {
    return new Response('Falta configurar las variables de entorno del panel en Vercel.', { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  const soloDuenos = DUENOS.has(ruta);
  const c = credenciales(request);
  const esDueno = !!c && igual(c.u, env.DUENO_USUARIO) & igual(c.p, env.DUENO_CLAVE);
  const esCaja = !!c && igual(c.u, env.CAJA_USUARIO) & igual(c.p, env.CAJA_CLAVE);

  if (esDueno || (esCaja && !soloDuenos)) return seguir();
  return pedir(soloDuenos ? 'SMASH Duenos' : 'SMASH Panel');
}
