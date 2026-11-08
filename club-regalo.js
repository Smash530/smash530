/* ============================================================
   SMASH · club-regalo.js — anuncio de los 15 puntos de regalo
   Solo actúa con body.invita-club (hay nube y nadie ha iniciado sesión;
   la clase la pone cliente.js en pintarCuenta).
   1. El cupón del Club cuenta de 0 a 15 cuando aparece en pantalla.
   2. Confeti al tocar cualquier botón del regalo.
   3. Tarjeta flotante "Te regalamos 15 puntos" una vez al día.
   ============================================================ */
(function () {
  "use strict";
  var quieto = window.matchMedia("(prefers-reduced-motion: reduce)");
  var invita = function () { return document.body.classList.contains("invita-club"); };
  var $ = function (i) { return document.getElementById(i); };
  function guardado(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } }
  function hoy() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function vibrar(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) {} }

  /* ---------- 1. Cuenta regresiva del cupón ---------- */
  var num = $("cgNum"), gift = document.querySelector(".club-gift");
  function contar() {
    if (!num) return;
    if (quieto.matches) { num.textContent = "15"; return; }
    var t0 = performance.now();
    (function paso(t) {
      var k = Math.min(1, (t - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      num.textContent = Math.round(15 * e);
      if (k < 1) requestAnimationFrame(paso);
      else if (gift) { gift.classList.add("listo"); }
    })(t0);
  }
  if (gift && "IntersectionObserver" in window) {
    var visto = false;
    new IntersectionObserver(function (es, ob) {
      es.forEach(function (x) {
        if (x.isIntersecting && !visto && invita()) { visto = true; contar(); ob.disconnect(); }
      });
    }, { threshold: 0.55 }).observe(gift);
  }

  /* ---------- 2. Confeti al tocar el regalo ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest ? e.target.closest(".club-gift,.hero-regalo,.rg-si,.tb-reg") : null;
    if (!b) return;
    vibrar([10, 40, 10]);
    if (window.SmashConfeti) window.SmashConfeti({ x: e.clientX || innerWidth / 2, y: e.clientY || innerHeight / 2 });
    cerrarPop();
  }, true);

  /* ---------- 3. Tarjeta flotante (una vez al día) ---------- */
  var pop = null, popT = null;
  function cerrarPop(recordar) {
    if (!pop) return;
    clearTimeout(popT);
    var p = pop; pop = null;
    p.classList.remove("show");
    setTimeout(function () { p.remove(); }, 400);
    if (recordar) guardado("smash_regalo_visto", hoy());
  }
  function hayAlgoAbierto() {
    var acc = $("acc"), gr = $("gracias");
    return (acc && !acc.hidden) || (gr && !gr.hidden) || document.body.classList.contains("sheet-open") || document.querySelector(".inst.show");
  }
  function mostrarPop() {
    if (pop || !invita() || guardado("smash_regalo_visto") === hoy() || hayAlgoAbierto()) return;
    pop = document.createElement("div");
    pop.className = "regalo-pop"; pop.setAttribute("role", "dialog"); pop.setAttribute("aria-label", "Regalo de bienvenida");
    pop.innerHTML =
      '<span class="rg-caja" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="9" y="27" width="46" height="31" rx="4" fill="#e3262f"/><rect x="5" y="17" width="54" height="13" rx="4" fill="#ff3d46"/><rect x="28" y="17" width="8" height="41" fill="#ffb627"/><path d="M32 17c-4-9-15-11-16-4-1 5 8 5 16 4zm0 0c4-9 15-11 16-4 1 5-8 5-16 4z" fill="none" stroke="#ffb627" stroke-width="4" stroke-linejoin="round"/></svg></span>' +
      '<div class="rg-t"><b>¡Te regalamos <em>15 puntos</em>!</b><small>Regístrate gratis y úsalos hoy mismo en la promo del día.</small></div>' +
      '<button type="button" class="rg-si" data-acc="registro">Reclamar</button>' +
      '<button type="button" class="rg-x" aria-label="Cerrar">×</button>';
    document.body.appendChild(pop);
    pop.querySelector(".rg-x").addEventListener("click", function () { cerrarPop(true); });
    pop.querySelector(".rg-si").addEventListener("click", function () { guardado("smash_regalo_visto", hoy()); });
    requestAnimationFrame(function () { requestAnimationFrame(function () { if (pop) pop.classList.add("show"); }); });
    popT = setTimeout(function () { cerrarPop(false); }, 16000);
  }
  // aparece tras 8 s, o antes si la persona baja más allá de la portada
  var programado = setTimeout(mostrarPop, 8000);
  function alBajar() {
    var h = document.querySelector(".hero");
    if (h && window.scrollY > h.offsetHeight * 0.7) { clearTimeout(programado); window.removeEventListener("scroll", alBajar); setTimeout(mostrarPop, 600); }
  }
  window.addEventListener("scroll", alBajar, { passive: true });
  // si inicia sesión, todo lo del regalo se va
  document.addEventListener("smash:yo", function (e) { if (e.detail && e.detail.yo) cerrarPop(false); });
})();
