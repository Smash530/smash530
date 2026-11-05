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
  // El cursor empieza en el primer campo vacío (solo en computador)
  if (!sec.hidden && window.matchMedia && window.matchMedia('(pointer:fine)').matches) {
    var u = document.getElementById('staffUsuario');
    setTimeout(function () { (u && !u.value ? u : pw).focus(); }, 50);
  }
})();
