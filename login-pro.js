/* ============================================================
   SMASH · login-pro.js (cocina y dueños)
   Detalles del inicio de sesión: botón para ver la contraseña
   y aviso de Bloq Mayús. No cambia cómo se valida el acceso.
   ============================================================ */
(function () {
  var sec = document.getElementById('staffAuthSection');
  if (!sec) return;
  var pw = document.getElementById('staffPassword');
  var eye = sec.querySelector('.lf-eye');
  var caps = sec.querySelector('.lf-caps');
  if (eye && pw) {
    eye.addEventListener('click', function () {
      var ver = pw.type === 'password';
      pw.type = ver ? 'text' : 'password';
      eye.classList.toggle('on', ver);
      eye.setAttribute('aria-label', ver ? 'Ocultar contraseña' : 'Mostrar contraseña');
      eye.title = eye.getAttribute('aria-label');
      pw.focus();
    });
    // Al enviar se vuelve a ocultar
    var form = document.getElementById('staffLoginForm');
    if (form) form.addEventListener('submit', function () { pw.type = 'password'; eye.classList.remove('on'); });
  }
  if (caps && pw) {
    var revisar = function (e) { if (e.getModifierState) caps.hidden = !e.getModifierState('CapsLock'); };
    pw.addEventListener('keydown', revisar);
    pw.addEventListener('keyup', revisar);
    pw.addEventListener('blur', function () { caps.hidden = true; });
  }
  // Portada: saludo según la hora y fecha/hora en vivo
  var saludo = sec.querySelector('[data-lv-saludo]'), hora = sec.querySelector('[data-lv-hora]');
  function reloj() {
    var d = new Date(), h = d.getHours();
    if (saludo) saludo.textContent = h >= 5 && h < 12 ? 'Buenos días' : h >= 12 && h < 19 ? 'Buenas tardes' : 'Buenas noches';
    if (hora) {
      try {
        var f = d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
        hora.textContent = f.charAt(0).toUpperCase() + f.slice(1) + ' · ' + d.toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' });
      } catch (e) { hora.textContent = ''; }
    }
  }
  if (saludo || hora) { reloj(); setInterval(function () { if (!sec.hidden) reloj(); }, 30000); }

  // El cursor empieza en el primer campo vacío (solo en computador)
  if (!sec.hidden && window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
    var u = document.getElementById('staffUsuario');
    setTimeout(function () { (u && !u.value ? u : pw).focus(); }, 50);
  }
})();
