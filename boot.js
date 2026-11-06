/* ============================================================
   SMASH · boot.js
   Almacén de datos grande del navegador (IndexedDB, hasta 500 MB)
   en lugar de localStorage (~5 MB).
   - SmashLS tiene los mismos métodos que localStorage (getItem,
     setItem, removeItem, key, length) y responde al instante desde
     memoria; cada cambio se escribe en IndexedDB por detrás.
   - Al abrir la página se leen todos los datos y luego se cargan
     los demás scripts (SmashBoot.cargar).
   - La primera vez copia los datos smash_* que había en
     localStorage. Esa copia vieja no se borra ni se vuelve a usar.
   - Las demás pestañas se enteran de cada cambio (BroadcastChannel)
     y reciben el mismo evento "storage" de siempre.
   - Si el navegador no permite IndexedDB, sigue con localStorage.
   ============================================================ */
var SmashLS, SmashBoot;
(function () {
  var DBN = 'smash', ST = 'kv', MIG = '#migrado', MB = 1048576, MAX = 500 * MB;
  var mem = Object.create(null), lista = null, db = null, cola = {}, pendiente = false, avisado = false;
  var canal = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('smash-datos') : null;
  var tiene = function (k) { return Object.prototype.hasOwnProperty.call(mem, k); };
  var llaves = function () { return lista || (lista = Object.keys(mem).sort()); };

  function evento(k, antes, ahora) {
    try { window.dispatchEvent(new StorageEvent('storage', { key: k, oldValue: antes, newValue: ahora })); } catch (e) { /* navegador viejo */ }
  }
  // Escrituras agrupadas: todos los cambios del mismo momento van en una sola transacción
  function guardar(k, v) {
    cola[k] = v;
    if (pendiente) return;
    pendiente = true;
    Promise.resolve().then(function () {
      var c = cola; cola = {}; pendiente = false;
      try {
        var tx = db.transaction(ST, 'readwrite'), s = tx.objectStore(ST);
        Object.keys(c).forEach(function (x) { if (c[x] === null) s.delete(x); else s.put(c[x], x); });
        tx.onerror = tx.onabort = function () { fallo(tx.error); };
      } catch (e) { fallo(e); }
    });
  }
  function fallo(e) {
    console.error('SMASH: no se pudo guardar en el almacén del navegador', e);
    if (!avisado) { avisado = true; alert('⚠ No se pudo guardar el último cambio en este navegador. Descarga un respaldo desde Configuración y recarga la página.'); }
  }

  var memoria = {
    getItem: function (k) { k = String(k); return tiene(k) ? mem[k] : null; },
    setItem: function (k, v) {
      k = String(k); v = String(v);
      var antes = tiene(k) ? mem[k] : null;
      if (antes === null) lista = null;
      mem[k] = v; guardar(k, v);
      if (canal) canal.postMessage({ k: k, v: v });
    },
    removeItem: function (k) {
      k = String(k);
      if (!tiene(k)) return;
      delete mem[k]; lista = null; guardar(k, null);
      if (canal) canal.postMessage({ k: k, v: null });
    },
    key: function (i) { var l = llaves(); return i >= 0 && i < l.length ? l[i] : null; },
    get length() { return llaves().length; },
  };
  if (canal) canal.onmessage = function (e) {
    var d = e.data || {}, antes = tiene(d.k) ? mem[d.k] : null;
    if (typeof d.k !== 'string') return;
    if (d.v === null) delete mem[d.k]; else mem[d.k] = d.v;
    lista = null;
    evento(d.k, antes, d.v);
  };

  function req(r) { return new Promise(function (ok, no) { r.onsuccess = function () { ok(r.result); }; r.onerror = function () { no(r.error); }; }); }
  function abrir() {
    return new Promise(function (ok, no) {
      var r = indexedDB.open(DBN, 1);
      r.onupgradeneeded = function () { r.result.createObjectStore(ST); };
      r.onsuccess = function () { ok(r.result); };
      r.onerror = function () { no(r.error); };
      r.onblocked = function () { no(new Error('bloqueado')); };
    });
  }
  function leerTodo() {
    var s = db.transaction(ST, 'readonly').objectStore(ST);
    return Promise.all([req(s.getAllKeys()), req(s.getAll())]).then(function (r) {
      var out = {};
      r[0].forEach(function (k, i) { out[k] = r[1][i]; });
      return out;
    });
  }
  // Primera vez: copia lo de localStorage. La marca queda en IndexedDB para no volver a copiarlo.
  function migrar(datos) {
    if (datos[MIG]) return Promise.resolve(datos);
    var tx = db.transaction(ST, 'readwrite'), s = tx.objectStore(ST);
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('smash_') === 0 && !(k in datos)) { datos[k] = localStorage.getItem(k); s.put(datos[k], k); }
    }
    datos[MIG] = new Date().toISOString();
    s.put(datos[MIG], MIG);
    return new Promise(function (ok, no) { tx.oncomplete = function () { ok(datos); }; tx.onerror = tx.onabort = function () { no(tx.error); }; });
  }

  var info = { tipo: 'localStorage', limite: 5 * MB };
  var listo = (function () {
    if (typeof indexedDB === 'undefined' || typeof Promise === 'undefined') return Promise.resolve(false);
    return abrir().then(function (d) {
      db = d;
      // si otra pestaña borra o actualiza el almacén, esta lo suelta (al guardar pedirá recargar)
      d.onversionchange = function () { d.close(); };
      return leerTodo();
    }).then(migrar).then(function (datos) {
      Object.keys(datos).forEach(function (k) { if (k !== MIG && typeof datos[k] === 'string') mem[k] = datos[k]; });
      SmashLS = memoria;
      info.tipo = 'indexedDB'; info.limite = MAX; info.migrado = datos[MIG];
      // pide al navegador que no borre estos datos cuando le falte espacio
      if (navigator.storage && navigator.storage.persist) navigator.storage.persist().then(function (p) { info.persistente = p; }, function () {});
      if (navigator.storage && navigator.storage.estimate) {
        return navigator.storage.estimate().then(function (e) { if (e && e.quota) info.limite = Math.min(MAX, e.quota); }, function () {});
      }
    }).then(function () { return true; }, function (e) {
      console.warn('SMASH: IndexedDB no disponible, se usa localStorage', e);
      return false;
    });
  })();
  try { SmashLS = window.localStorage; } catch (e) { SmashLS = memoria; }

  /* ---------- Versión publicada (version.json) ----------
     Cada publicación cambia version.json. Los scripts se piden con ?v=versión (así el
     navegador no usa archivos viejos) y cada minuto se revisa si hay una versión nueva:
     si la hay, la página se recarga sola cuando nadie la está usando (sin ventanas
     abiertas, sin escribir y, en la página de clientes, con el carrito vacío).
     Así un panel que quedó abierto todo el día no sigue con código viejo. */
  var version = '';
  function leerVersion() {
    if (typeof fetch === 'undefined' || location.protocol === 'file:') return Promise.resolve('');
    var tiempo = new Promise(function (ok) { setTimeout(function () { ok(''); }, 2500); });
    var pedir = fetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : {}; })
      .then(function (j) { return String((j && j.v) || ''); }, function () { return ''; });
    return Promise.race([pedir, tiempo]);
  }
  var ultimoUso = Date.now();
  ['pointerdown', 'keydown', 'input', 'touchstart'].forEach(function (ev) {
    document.addEventListener(ev, function () { ultimoUso = Date.now(); }, true);
  });
  function sePuedeRecargar() {
    if (Date.now() - ultimoUso < 45000) return false;                     // alguien la está usando
    var a = document.activeElement;
    if (a && /^(INPUT|TEXTAREA)$/.test(a.tagName) && a.value && a.type !== 'search') return false;   // a medio escribir
    if (document.querySelector('.smash-modal, .sm-box, .acc:not([hidden]), .gracias:not([hidden])')) return false;
    var cnt = document.getElementById('cnt');                             // página de clientes: carrito con productos
    if (cnt && !/vac/i.test(cnt.textContent || '')) return false;
    return true;
  }
  var nueva = '';
  function revisarVersion() {
    if (!version) return;
    leerVersion().then(function (v) {
      if (v && v !== version) nueva = v;
      if (nueva && (document.visibilityState === 'hidden' || sePuedeRecargar())) location.reload();
    });
  }
  setInterval(revisarVersion, 60000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') revisarVersion(); });

  // Carga los scripts en orden cuando los datos ya están en memoria
  function cargar(scripts) {
    Promise.all([listo, leerVersion()]).then(function (r) {
      version = r[1] || '';
      scripts.forEach(function (src) {
        var s = document.createElement('script');
        s.src = version && !/^https?:/.test(src) ? src + (src.indexOf('?') > -1 ? '&' : '?') + 'v=' + encodeURIComponent(version) : src;
        s.async = false;
        document.body.appendChild(s);
      });
    });
  }
  SmashBoot = { cargar: cargar, info: info, listo: listo, version: function () { return version; } };
})();
