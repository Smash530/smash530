/* ============================================================
   SMASH · ticket.js
   Ticket de comanda para térmica de 80 mm:
   - SmashTicket.html(o)       -> HTML para imprimir (#printArea)
   - SmashTicket.downloadPdf(o)-> descarga un PDF de 80 mm (sin librerías)
   Logo: coloca tu imagen en images/logo-ticket.jpeg
   ============================================================ */
const SmashTicket = (function () {
  const LOGO = 'images/logo-ticket.jpeg';
  const FRASE = 'En los tiempos de incertidumbre, yo estaré ahí';
  const GRACIAS = '¡Gracias por tu compra! Te esperamos en una próxima.';
  const fmt = (n) => '$' + Math.round(n || 0).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (o) => o.numeroDia || o.id;
  const ahora = () => new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(/[\u00a0\u202f\u2009]/g, ' ');

  /* ---------- HTML para imprimir ---------- */
  function html(o) {
    const items = (o.items || []).map((it) => `<div class="tk-it"><b>${esc(it.qty)} x</b> ${esc(it.name)}${it.nota ? `<div class="tk-n">&gt; ${esc(it.nota)}</div>` : ''}</div>`).join('');
    return `
      <div class="tk-logo"><img src="${LOGO}" alt="" onerror="this.remove()"></div>
      <div class="tk-c tk-h">SMASH</div>
      <div class="tk-s">${esc(ahora())}</div>
      <div class="tk-c tk-big">Comanda #${esc(num(o))}</div>
      ${o.reserva ? '<div class="tk-c"><b>*** RESERVA ***</b></div>' : ''}
      ${o.horaEntrega ? '<div class="tk-c"><b>ENTREGAR: ' + esc(o.horaEntrega) + '</b></div>' : ''}
      <div class="tk-sp"></div>
      <div><b>${esc(o.cliente)}</b></div>
      <div>Tel: ${esc(o.telefono || '-')}</div>
      <div>${esc(o.direccion || '-')}${o.zona ? ' (' + esc(o.zona) + ')' : ''}</div>
      <div class="tk-sp"></div><hr><div class="tk-sp"></div>
      ${items}
      ${o.notas ? `<div class="tk-sp"></div><div>Notas: <b>${esc(o.notas)}</b></div>` : ''}
      <div class="tk-sp"></div><hr>
      <div class="tk-r"><span>Subtotal</span><span>${fmt(o.subtotal)}</span></div>
      ${o.descuento ? `<div class="tk-r"><span>Descuento</span><span>-${fmt(o.descuento)}</span></div>` : ''}
      <div class="tk-r"><span>Domicilio</span><span>${o.domicilioPendiente ? 'POR CONFIRMAR' : fmt(o.domicilio)}</span></div>
      <div class="tk-r tk-tot"><span>TOTAL</span><span>${fmt(o.total)}</span></div>
      ${o.pago ? `<div>Pago: <b>${esc(o.pago)}</b></div>` : ''}
      <div class="tk-sp"></div><hr><div class="tk-sp"></div>
      <div class="tk-c">${esc(GRACIAS)}</div>
      <div class="tk-sp"></div>
      <div class="tk-s">${esc(FRASE)}</div>
      <div class="tk-c">.</div>`;
  }

  /* ---------- PDF mínimo (Helvetica estándar + JPEG opcional) ---------- */
  const W = 226.77, M = 12, CW = W - 2 * M;
  let ctx2d = null;
  function measure(txt, size, bold) {
    try {
      if (!ctx2d && typeof document !== 'undefined') ctx2d = document.createElement('canvas').getContext('2d');
      if (ctx2d) { ctx2d.font = (bold ? 'bold ' : '') + '100px Arial, Helvetica, sans-serif'; return ctx2d.measureText(txt).width * size / 100; }
    } catch (e) { /* sin canvas */ }
    return txt.length * size * (bold ? 0.56 : 0.5);
  }
  const clean = (s) => String(s == null ? '' : s).replace(/[\u00a0\u202f\u2009]/g, ' ').replace(/[\u2013\u2014]/g, '-').replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x00-\xff]/g, '?');
  function wrap(txt, size, bold, width) {
    const words = clean(txt).split(/\s+/).filter(Boolean), lines = [];
    let cur = '';
    words.forEach((w) => {
      const t = cur ? cur + ' ' + w : w;
      if (measure(t, size, bold) <= width || !cur) cur = t; else { lines.push(cur); cur = w; }
    });
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
  }
  function jpegInfo(b) {
    let i = 2;
    while (i < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8], c: b[i + 9] };
      }
      i += 2 + ((b[i + 2] << 8) | b[i + 3]);
    }
    return null;
  }

  function buildPdf(o, logoBytes) {
    const ops = []; // {k:'t'|'r'|'rule'|'img', ...} con y desde arriba
    let y = 14;
    const text = (txt, size, bold, align) => {
      wrap(txt, size, bold, CW).forEach((ln) => {
        y += size * 1.2;
        const w = measure(ln, size, bold);
        const x = align === 'c' ? (W - w) / 2 : M;
        ops.push({ k: 't', txt: ln, size, bold, x, y: y - size * 0.2 });
      });
    };
    const row = (l, r, size, bold) => {
      y += size * 1.2;
      ops.push({ k: 't', txt: clean(l), size, bold, x: M, y: y - size * 0.2 });
      ops.push({ k: 't', txt: clean(r), size, bold, x: W - M - measure(clean(r), size, bold), y: y - size * 0.2 });
    };
    const gap = (g) => { y += g; };
    const rule = () => { gap(3); ops.push({ k: 'rule', y }); gap(3); };

    let img = null;
    if (logoBytes) { const inf = jpegInfo(logoBytes); if (inf && (inf.c === 1 || inf.c === 3)) img = inf; }
    if (img) {
      const mw = 110, mh = 60, s = Math.min(mw / img.w, mh / img.h), w = img.w * s, h = img.h * s;
      ops.push({ k: 'img', x: (W - w) / 2, y: y, w, h }); y += h + 4;
    }
    text('SMASH', 22, true, 'c');
    gap(3);
    text(ahora(), 8, false, 'c');
    gap(5);
    text('Comanda #' + num(o), 17, true, 'c');
    if (o.reserva) text('*** RESERVA ***', 11, true, 'c');
    if (o.horaEntrega) text('ENTREGAR: ' + o.horaEntrega, 11, true, 'c');
    gap(8);
    text(o.cliente || '', 11, true);
    text('Tel: ' + (o.telefono || '-'), 10, false);
    text((o.direccion || '-') + (o.zona ? ' (' + o.zona + ')' : ''), 10, false);
    gap(6); rule(); gap(4);
    (o.items || []).forEach((it) => { text(it.qty + ' x ' + it.name, 10.5, false); if (it.nota) text('   > ' + it.nota, 9, true); });
    if (o.notas) { gap(5); text('Notas: ' + o.notas, 9.5, true); }
    gap(5); rule();
    row('Subtotal', fmt(o.subtotal), 10, false);
    if (o.descuento) row('Descuento', '-' + fmt(o.descuento), 10, false);
    row('Domicilio', o.domicilioPendiente ? 'POR CONFIRMAR' : fmt(o.domicilio), 10, false);
    gap(2);
    row('TOTAL', fmt(o.total), 14, true);
    if (o.pago) { gap(2); text('Pago: ' + o.pago, 10, false); }
    gap(6); rule(); gap(4);
    text(GRACIAS, 10, true, 'c');
    gap(8);
    text(FRASE, 8, false, 'c');
    gap(16);
    const H = y;

    // contenido
    const P = (n) => n.toFixed(2);
    const body = [];
    ops.forEach((p) => {
      if (p.k === 't') {
        const bytes = clean(p.txt).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
        body.push(`BT /${p.bold ? 'F2' : 'F1'} ${p.size} Tf ${P(p.x)} ${P(H - p.y)} Td (${bytes}) Tj ET`);
      } else if (p.k === 'rule') {
        body.push(`q [2 2] 0 d 0.6 w ${P(M)} ${P(H - p.y)} m ${P(W - M)} ${P(H - p.y)} l S Q`);
      } else if (p.k === 'img') {
        body.push(`q ${P(p.w)} 0 0 ${P(p.h)} ${P(p.x)} ${P(H - p.y - p.h)} cm /Im1 Do Q`);
      }
    });
    const stream = body.join('\n');

    // ensamblado binario
    const enc = (s) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 255; return a; };
    const chunks = [], offsets = [];
    let len = 0;
    const push = (u8) => { chunks.push(u8); len += u8.length; };
    const obj = (n, head, data) => {
      offsets[n] = len;
      push(enc(`${n} 0 obj\n${head}\n`));
      if (data) { push(enc('stream\n')); push(data); push(enc('\nendstream\n')); }
      push(enc('endobj\n'));
    };
    push(enc('%PDF-1.4\n'));
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${P(W)} ${P(H)}] /Resources << /Font << /F1 5 0 R /F2 6 0 R >>${img ? ' /XObject << /Im1 7 0 R >>' : ''} >> /Contents 4 0 R >>`);
    const sb = enc(stream);
    obj(4, `<< /Length ${sb.length} >>`, sb);
    obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    obj(6, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    if (img) obj(7, `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /${img.c === 1 ? 'DeviceGray' : 'DeviceRGB'} /BitsPerComponent 8 /Filter /DCTDecode /Length ${logoBytes.length} >>`, logoBytes);
    const n = img ? 7 : 6, xref = len;
    let x = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
    for (let i = 1; i <= n; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
    x += `trailer\n<< /Size ${n + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
    push(enc(x));
    const out = new Uint8Array(len);
    let p = 0;
    chunks.forEach((c) => { out.set(c, p); p += c.length; });
    return out;
  }

  async function downloadPdf(o) {
    let logo = null;
    try {
      const r = await fetch(LOGO);
      if (r.ok) logo = new Uint8Array(await r.arrayBuffer());
    } catch (e) { /* sin logo */ }
    const bytes = buildPdf(o, logo);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'comanda-' + num(o) + '.pdf';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  return { html, buildPdf, downloadPdf };
})();
if (typeof module !== 'undefined') module.exports = SmashTicket;
