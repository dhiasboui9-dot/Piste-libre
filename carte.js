/* Piste libre — fond de carte réel (rues, parcs, eau) comme Strava.
   Tuiles sombres © OpenStreetMap contributors © CARTO, dessinées sur un canvas :
   le même code sert à la carte en direct, aux miniatures, et aux images de story.
   Hors connexion : un fond quadrillé sombre est affiché à la place, le tracé reste visible.

   PisteCarte.draw(ctx, w, h, track, { pad, lw, accent, onLoad })
        track = [[lat, lon], ..., null (coupure), ...]
   PisteCarte.preload(track, w, h, pad) -> Promise (attend les tuiles avant d'exporter une image)
*/
(function () {
  var TS = 256, MAXZ = 17, MINZ = 3;
  var cache = {};

  function wx(lon, z) { return (lon + 180) / 360 * TS * Math.pow(2, z); }
  function wy(lat, z) {
    var s = Math.sin(lat * Math.PI / 180);
    s = Math.max(-0.9999, Math.min(0.9999, s));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TS * Math.pow(2, z);
  }

  /* niveau de zoom + échelle pour que tout le tracé tienne dans w × h */
  function view(track, w, h, pad) {
    var minLa = 90, maxLa = -90, minLo = 180, maxLo = -180, n = 0, i, p;
    for (i = 0; i < track.length; i++) {
      p = track[i];
      if (!p) continue;
      n++;
      if (p[0] < minLa) minLa = p[0];
      if (p[0] > maxLa) maxLa = p[0];
      if (p[1] < minLo) minLo = p[1];
      if (p[1] > maxLo) maxLo = p[1];
    }
    if (!n) return null;
    var bw = wx(maxLo, MAXZ) - wx(minLo, MAXZ), bh = wy(minLa, MAXZ) - wy(maxLa, MAXZ);
    var s = Math.min((w - 2 * pad) / Math.max(bw, 1), (h - 2 * pad) / Math.max(bh, 1));
    var z = MAXZ + Math.floor(Math.log(s) / Math.LN2);
    z = Math.max(MINZ, Math.min(MAXZ, z));
    var k = s / Math.pow(2, z - MAXZ);
    if (z === MAXZ) k = Math.min(k, 1);
    return {
      z: z, k: k, w: w, h: h,
      cx: (wx(minLo, z) + wx(maxLo, z)) / 2,
      cy: (wy(minLa, z) + wy(maxLa, z)) / 2
    };
  }
  function toScreen(v, p) {
    return [(wx(p[1], v.z) - v.cx) * v.k + v.w / 2, (wy(p[0], v.z) - v.cy) * v.k + v.h / 2];
  }

  function tileUrl(z, x, y) {
    return 'https://' + 'abcd'.charAt((x + y) % 4) + '.basemaps.cartocdn.com/dark_all/' + z + '/' + x + '/' + y + '@2x.png';
  }
  function tiles(v) {
    var hw = v.w / (2 * v.k), hh = v.h / (2 * v.k);
    var x0 = Math.floor((v.cx - hw) / TS), x1 = Math.floor((v.cx + hw) / TS);
    var y0 = Math.floor((v.cy - hh) / TS), y1 = Math.floor((v.cy + hh) / TS);
    var n = Math.pow(2, v.z), list = [], x, y, xm;
    for (y = y0; y <= y1; y++) {
      if (y < 0 || y >= n) continue;
      for (x = x0; x <= x1; x++) {
        xm = ((x % n) + n) % n;
        list.push({ x: x, y: y, url: tileUrl(v.z, xm, y) });
      }
    }
    return list;
  }

  function run(e) {
    var l = e.cbs; e.cbs = [];
    for (var i = 0; i < l.length; i++) l[i]();
  }
  function get(url, cb) {
    var e = cache[url];
    if (!e) {
      e = cache[url] = { state: 'wait', img: new Image(), cbs: [] };
      e.img.crossOrigin = 'anonymous';
      e.img.onload = function () { e.state = 'ok'; run(e); };
      e.img.onerror = function () {
        e.state = 'err'; run(e);
        setTimeout(function () { if (cache[url] === e) delete cache[url]; }, 20000);
      };
      e.img.src = url;
    }
    if (e.state === 'ok') return e.img;
    if (e.state === 'wait' && cb) e.cbs.push(cb);
    return null;
  }

  function draw(ctx, w, h, track, o) {
    o = o || {};
    var pad = o.pad || 20, lw = o.lw || 5, acc = o.accent || '#fcd53f';
    var queued = false;
    function fire() {
      if (queued || !o.onLoad) return;
      queued = true;
      setTimeout(function () { queued = false; o.onLoad(); }, 60);
    }
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.fillStyle = '#121a2e'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 1; ctx.beginPath();
    var g;
    for (g = 40; g < w; g += 40) { ctx.moveTo(g, 0); ctx.lineTo(g, h); }
    for (g = 40; g < h; g += 40) { ctx.moveTo(0, g); ctx.lineTo(w, g); }
    ctx.stroke();

    var v = view(track, w, h, pad);
    if (!v) { ctx.restore(); return false; }

    var size = TS * v.k + 0.5;
    tiles(v).forEach(function (t) {
      var img = get(t.url, fire);
      if (!img) return;
      ctx.drawImage(img, (t.x * TS - v.cx) * v.k + w / 2, (t.y * TS - v.cy) * v.k + h / 2, size, size);
    });

    /* tracé */
    function trace() {
      var pen = false, j, q;
      ctx.beginPath();
      for (j = 0; j < track.length; j++) {
        if (!track[j]) { pen = false; continue; }
        q = toScreen(v, track[j]);
        if (!pen) { ctx.moveTo(q[0], q[1]); pen = true; } else ctx.lineTo(q[0], q[1]);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(); ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.lineWidth = lw * 1.9; ctx.stroke();
    trace(); ctx.strokeStyle = acc; ctx.lineWidth = lw; ctx.stroke();

    var first = null, last = null, i;
    for (i = 0; i < track.length; i++) if (track[i]) { if (!first) first = track[i]; last = track[i]; }
    function dot(p, fill) {
      var q = toScreen(v, p);
      ctx.beginPath(); ctx.arc(q[0], q[1], lw * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw * 0.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    dot(first, '#3ddc84');
    if (last !== first) dot(last, acc);

    /* mention obligatoire des sources de la carte */
    var fs = Math.max(9, Math.round(w / 64)), txt = '© OpenStreetMap · © CARTO';
    ctx.font = fs + 'px sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    var tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(w - tw - fs * 1.2, h - fs * 1.8, tw + fs * 1.2, fs * 1.8);
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillText(txt, w - tw - fs * 0.6, h - fs * 0.55);
    ctx.restore();
    return true;
  }

  /* attend que les tuiles nécessaires soient chargées (6 s maximum) */
  function preload(track, w, h, pad) {
    return new Promise(function (resolve) {
      var v = view(track || [], w, h, pad || 20);
      if (!v) { resolve(); return; }
      var left = 0, done = false, timer;
      function fin() { if (!done) { done = true; clearTimeout(timer); resolve(); } }
      timer = setTimeout(fin, 6000);
      tiles(v).forEach(function (t) {
        var e = cache[t.url];
        if (e && (e.state === 'ok' || e.state === 'err')) return;
        left++;
        get(t.url, function () { left--; if (left <= 0) fin(); });
      });
      if (!left) fin();
    });
  }

  window.PisteCarte = { draw: draw, preload: preload };
})();
