/* ============================================================
   SMASH · cliente-comanda.js — capa visual de la comanda y el
   seguimiento. Solo LEE lo que cliente.js ya pintó (totales,
   zona elegida) y el estado que guarda cliente-vivo.js.
   No calcula precios, no arma el mensaje, no guarda pedidos.
   ============================================================ */
(function () {
  var $ = function (i) { return document.getElementById(i); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function txt(el) { return el ? el.textContent.trim() : ""; }
  function mirar(el, fn, attrs) { if (el) new MutationObserver(fn).observe(el, { childList: true, subtree: true, characterData: true, attributes: !!attrs }); }
  function precioDe(s) { var m = String(s || "").match(/\$[\d.]+/g); return m ? m[m.length - 1] : ""; }

  /* ---------- Comanda: encabezado con fecha y pie con los totales de cliente.js ---------- */
  function fechaTk() {
    try {
      var f = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", hour: "numeric", minute: "2-digit", hour12: true });
      var p = f.replace(/[  ]/g, " ").replace(/\./g, "").split(/,\s*/);
      $("tkFecha").textContent = "PEDIDO WEB · " + p[0] + (p[1] ? " · " + p[1].toUpperCase().replace(/\s?A ?M/, " AM").replace(/\s?P ?M/, " PM") : "");
    } catch (e) { /* navegador viejo */ }
  }
  fechaTk(); setInterval(fechaTk, 30000);
  function pie() {
    var n = Number((txt($("cnt")).match(/^(\d+)/) || [])[1] || 0), ft = $("tkFoot"), go = $("go");
    if (!n) { ft.hidden = true; go.removeAttribute("data-tot"); return; }
    var sub = precioDe(txt($("cnt")).split("·")[1]), dl = txt($("dl")), zon = document.querySelector("#zones .chip.on[data-z]");
    var zNom = zon && zon.firstChild ? zon.firstChild.textContent.trim() : "";
    var dom = /confirmar/i.test(dl) ? "Por confirmar" : precioDe(dl) || "Elige zona";
    var desc = $("desc"), d = desc && !desc.hidden ? precioDe(txt(desc)) : "";
    var tot = txt($("tot"));
    ft.innerHTML = '<div class="ln"><span>Subtotal</span><span>' + esc(sub.replace("$", "")) + "</span></div>" +
      (d ? '<div class="ln desc"><span>Descuento club</span><span>−' + esc(d.replace("$", "")) + "</span></div>" : "") +
      '<div class="ln"><span>Domicilio' + (zNom ? " " + esc(zNom) : "") + "</span><span>" + esc(dom.replace("$", "")) + "</span></div>" +
      '<div class="dash"></div><div class="ln big"><span>Total</span><span>' + esc(tot) + (/confirmar/i.test(dl) ? " + dom." : "") + "</span></div>";
    ft.hidden = false;
    go.setAttribute("data-tot", tot);
  }
  ["cnt", "tot", "dl", "desc"].forEach(function (i) { mirar($(i), pie, true); });
  mirar($("zones"), pie, true); pie();

  /* ---------- Confirmación: número, total y en qué va (lo publica la caja) ---------- */
  var PASOS = [
    { t: "Recibido", i: "🧾", d: "Tu pedido ya está en la caja." },
    { t: "Cocinando", i: "🔥", d: "Estamos aplastando tus burgers en la plancha." },
    { t: "En camino", i: "🛵", d: "Tu pedido ya salió. ¡Ten el celular a la mano!" },
    { t: "Entregado", i: "😋", d: "¡Que lo disfrutes! Gracias por pedir en SMASH." }
  ];
  // misma lectura que cliente-vivo.js (cli_seguir): solo se lee, no se escribe
  function paso(s) {
    if (!s) return 0;
    if (s.estado === "cancelado") return -2;
    if (s.estado === "entregado") return 3;
    if (s.estado === "en_camino" || s.estado === "listo") return 2;
    if (s.estado === "preparando") return 1;
    return 0;
  }
  var refActual = "", tProg = null;
  function prog() {
    if (!refActual) return;
    var l = []; try { l = JSON.parse(localStorage.getItem("cli_seguir") || "[]") || []; } catch (e) {}
    var x = l.filter(function (y) { return y && y.ref === refActual; })[0], p = paso(x && x.s);
    var bars = $("gProg").querySelectorAll(".g-bars i"), st = $("gProg").querySelectorAll(".g-steps span");
    $("gProg").classList.toggle("mal", p === -2);
    for (var i = 0; i < 4; i++) {
      bars[i].className = p === -2 ? "" : i < p ? "on" : i === p ? (p === 3 ? "on" : "half") : "";
      st[i].className = p >= 0 && i <= p ? "on" : "";
    }
    var k = p === -2 ? { t: "Pedido cancelado", i: "✖", d: "Escríbenos por WhatsApp si tienes dudas." } : PASOS[p];
    $("gNowI").textContent = k.i; $("gNowT").textContent = k.t; $("gNowD").textContent = k.d;
  }
  document.addEventListener("smash:pedido", function (e) {
    var d = e.detail || {}, nombre = String(($("fn") && $("fn").value) || "").trim().split(" ")[0];
    refActual = d.ref || "";
    $("gRef").textContent = d.ref || ""; $("gTot").textContent = d.total || "";
    $("gOrder").hidden = !d.ref;
    $("graciasHola").textContent = (nombre ? "Gracias, " + nombre + "." : "Gracias por tu pedido.") + " Si necesitamos algo te escribimos por WhatsApp.";
    $("graciasT").innerHTML = d.reserva ? "Tu reserva<br>quedó<br><span>lista.</span>" : "Ya está<br>en la<br><span>plancha.</span>";
    $("gProg").hidden = !!d.reserva || !d.ref;
    prog(); clearInterval(tProg); tProg = setInterval(function () { if ($("gracias").hidden) clearInterval(tProg); else prog(); }, 3000);
  });
})();
