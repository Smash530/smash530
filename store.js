/* ============================================================
   SMASH · store.js
   Guardado seguro para los módulos nuevos (inventario, recetas,
   caja...). No reemplaza a data.js ni a data-ext.js: usa el mismo
   localStorage y las mismas llaves "smash_*".
   - save(): guarda y comprueba que quedó escrito; si falla, lanza
     un error para que la pantalla NO confirme la operación.
   - tx(): varios cambios relacionados se guardan todos o ninguno.
   - respaldo completo (exportar / restaurar) en un archivo JSON.
   ============================================================ */
const SmashStore = (function () {
  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  // Escribe textos ya convertidos; si uno falla, devuelve todo a como estaba.
  function txRaw(map) {
    const keys = Object.keys(map), prev = {};
    keys.forEach((k) => { prev[k] = localStorage.getItem(k); });
    try {
      keys.forEach((k) => {
        if (map[k] === null) localStorage.removeItem(k);
        else localStorage.setItem(k, map[k]);
        if (localStorage.getItem(k) !== map[k]) throw new Error('no se pudo verificar ' + k);
      });
    } catch (e) {
      keys.forEach((k) => {
        try { if (prev[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, prev[k]); } catch (x) { /* nada más que hacer */ }
      });
      const lleno = e && (e.name === 'QuotaExceededError' || e.code === 22);
      throw new Error(lleno
        ? 'El almacenamiento del navegador está lleno. Descarga un respaldo y libera espacio (por ejemplo, fotos muy pesadas).'
        : 'No se pudo guardar (' + (e && e.message) + '). No se aplicó ningún cambio.');
    }
  }
  function tx(changes) {
    const map = {};
    Object.keys(changes).forEach((k) => { map[k] = JSON.stringify(changes[k]); });
    txRaw(map);
  }
  const save = (key, value) => tx({ [key]: value });

  const uid = (p) => (p || '') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nowISO = () => new Date().toISOString();
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };

  /* ---------------- Respaldo completo ---------------- */
  // No se respaldan sesiones abiertas ni el bloqueo de intentos.
  const NO_RESPALDAR = /^smash_(session_|owner_lock)/;
  const LAST = 'smash_ultimo_respaldo';

  function smashKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf('smash_') === 0 && !NO_RESPALDAR.test(k)) out.push(k);
    }
    return out.sort();
  }
  function exportAll() {
    const datos = {};
    smashKeys().forEach((k) => { if (k !== LAST) datos[k] = localStorage.getItem(k); });
    return { app: 'smash', version: 1, creado: nowISO(), datos };
  }
  function descargar(nombre, texto, tipo) {
    const url = URL.createObjectURL(new Blob([texto], { type: tipo || 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
  }
  function downloadBackup(prefijo) {
    const b = exportAll();
    descargar((prefijo || 'respaldo_smash_') + b.creado.slice(0, 19).replace(/[:T]/g, '-') + '.json', JSON.stringify(b));
    try { localStorage.setItem(LAST, JSON.stringify(b.creado)); } catch (e) { /* sin espacio: el archivo ya salió */ }
    return b;
  }
  const lastBackup = () => read(LAST, null);

  // Restaura un respaldo: reemplaza los datos smash_* por los del archivo.
  function importAll(obj) {
    if (!obj || obj.app !== 'smash' || !obj.datos || typeof obj.datos !== 'object') throw new Error('El archivo no es un respaldo de SMASH.');
    const map = {};
    Object.keys(obj.datos).forEach((k) => {
      if (k.indexOf('smash_') !== 0 || NO_RESPALDAR.test(k)) return;
      const v = obj.datos[k];
      if (typeof v !== 'string') throw new Error('Respaldo dañado en ' + k + '.');
      JSON.parse(v); // valida que sea JSON
      map[k] = v;
    });
    if (!map.smash_orders && !map.smash_products) throw new Error('El respaldo no contiene pedidos ni productos.');
    smashKeys().forEach((k) => { if (!(k in map) && k !== LAST) map[k] = null; });
    txRaw(map);
    return Object.keys(map).filter((k) => map[k] !== null).length;
  }

  // Espacio usado (localStorage guarda texto en UTF-16: ~2 bytes por carácter)
  function usage() {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      chars += k.length + (localStorage.getItem(k) || '').length;
    }
    return { bytes: chars * 2, limite: 5 * 1024 * 1024 };
  }

  return { read, save, tx, txRaw, uid, nowISO, today, exportAll, downloadBackup, lastBackup, importAll, usage, descargar };
})();
