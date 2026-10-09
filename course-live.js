/* var s=document.createElement('script');s.src='historique.js';document.head.appendChild(s); Piste libre : suivi de course en direct (style Strava).
   Remplace le contenu de la section #course.
   Distance en km et en mètres, temps, allure moyenne, allure actuelle,
   et pour chaque kilomètre : temps, allure et temps total.
   + Sauvegarde automatique : si la page est rechargée ou tuée par Android
     pendant la course, elle reprend où elle en était.
   + Écran éteint : le temps et l'allure moyenne continuent (basés sur l'horloge),
     le GPS est maintenu actif par un son silencieux, et tout se remet à jour
     dès que l'écran se rallume. La course ne s'arrête que sur « Terminer ».
   + Carte du tracé GPS (dessinée sur canvas, marche hors connexion) pendant
     et après la course, et bouton « Partager en story » (image 1080×1920 avec
     carte, distance, temps et allure moyenne). */
(function () { 
   document.head.appendChild(document.createElement('script')).src='historique.js';
  var sec = document.getElementById('course');
  if (!sec) {
    var t0 = document.getElementById('lTime');
    sec = t0 && (t0.closest('section') || t0.closest('.wrap'));
  }
  if (!sec) return;
  var wrap = sec.querySelector('.wrap') || sec;

  var css = document.createElement('style');
  css.textContent =
    '.lv-hero{margin-top:22px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:16px 18px}' +
    '.lv-km{display:flex;align-items:baseline;gap:8px;font-family:var(--display);font-weight:800;line-height:.9}' +
    '.lv-km span{font-size:clamp(4.2rem,22vw,6.5rem);font-variant-numeric:tabular-nums}' +
    '.lv-km small{font-size:1.8rem;font-weight:700;color:var(--muted)}' +
    '.lv-m{margin-top:6px;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}' +
    '.lv-bar{margin-top:12px;height:8px;border-radius:99px;background:var(--bg);border:1px solid var(--line);overflow:hidden}' +
    '.lv-bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .25s linear}' +
    '.lv-map{margin-top:14px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#121a2e}' +
    '.lv-map canvas{display:block;width:100%;height:280px}' +
    '#cvTable td,#cvTable th{font-variant-numeric:tabular-nums}' +
    '#cvTable th:not(:first-child),#cvTable td:not(:first-child){text-align:right}' +
    '#cvTable tr.best td{font-weight:800;color:var(--accent)}' +
    '#cvTable tr.now td{color:var(--muted);font-style:italic}' +
    '@media (prefers-reduced-motion: reduce){.lv-bar i{transition:none}}';
  document.head.appendChild(css);

  wrap.innerHTML =
    '<h2>Suivi de course en direct</h2>' +
    '<p class="intro-sub">Lance le suivi au départ de ta sortie. Tu vois ta distance, ton temps et ton allure, et le site garde le temps et l’allure de chaque kilomètre.</p>' +
    '<div class="lv-hero">' +
      '<div class="lv-km"><span id="cvKm">0,00</span><small>km</small></div>' +
      '<div class="lv-m" id="cvM">0 m</div>' +
      '<div class="lv-bar" aria-hidden="true"><i id="cvBar"></i></div>' +
    '</div>' +
    '<div class="lv-map" id="cvMapWrap" hidden><canvas id="cvMap" aria-label="Carte du parcours"></canvas></div>' +
    '<div class="stats live">' +
      '<div class="stat"><div class="v" id="cvTime">0:00</div><div class="l">temps</div></div>' +
      '<div class="stat"><div class="v" id="cvAvg">–</div><div class="l">allure moy. /km</div></div>' +
      '<div class="stat"><div class="v" id="cvNow">–</div><div class="l">allure actuelle</div></div>' +
    '</div>' +
    '<div class="curkm" id="cvCur" aria-live="off"></div>' +
    '<div class="gpsmsg" id="cvMsg" role="status">Prêt. Autorise la localisation quand ton navigateur te le demande.</div>' +
    '<div class="lctl">' +
      '<button class="go" id="cvStart" type="button">Démarrer</button>' +
      '<button class="go stop" id="cvPause" type="button" disabled>Pause</button>' +
      '<button class="go stop" id="cvStop" type="button" disabled>Terminer</button>' +
    '</div>' +
    '<div class="chips" style="margin-top:14px"><button class="chip" id="cvVoice" type="button" aria-pressed="false">Annonce vocale à chaque km : non</button></div>' +
    '<div class="lsplits" id="cvSplits" hidden><table class="zones" id="cvTable"></table></div>' +
    '<button class="linkbtn" id="cvShare" type="button" hidden>Partager en story</button> ' +
    '<button class="linkbtn" id="cvSave" type="button" hidden>Ajouter au carnet</button>' +
    '<p class="note">Tu peux éteindre l’écran pendant la course : le temps et l’allure moyenne continuent, et la course ne s’arrête que quand tu appuies sur « Terminer ». Pour un GPS plus fiable, laisse la page ouverte (ne la ferme pas) et verrouille simplement l’écran. À l’intérieur ou entre de grands immeubles, le GPS est moins précis. La distance reste une estimation.</p>';

  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'pl-course-live';
  var KEY_TRACK = 'pl-course-track';
  var state = 'idle', watchId = null, timer = null, wake = null, voice = false;
  var active = 0, segStart = null, dist = 0, last = null;
  var splits = [], lastSplitT = 0, nextKm = 1, pts = [];
  var keepAudio = null, silenceUrl = null;
  var track = [], lastTrackSave = 0;   // track : [lat, lon] ou null (coupure : pause / reprise)

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function elapsed() { return active + (segStart ? Date.now() - segStart : 0); }
  function fmtT(ms) {
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return h > 0 ? h + ':' + pad(m) + ':' + pad(r) : m + ':' + pad(r);
  }
  function fmtP(msPerKm) {
    if (!isFinite(msPerKm) || msPerKm <= 0 || msPerKm > 3600000) return '–';
    var s = Math.round(msPerKm / 1000);
    return Math.floor(s / 60) + ':' + pad(s % 60);
  }
  function fmtKm(m) { return (m / 1000).toFixed(2).replace('.', ','); }
  function fmtM(m) { return Math.round(m).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f') + '\u00a0m'; }
  function msg(t) { $('cvMsg').textContent = t; }

  /* ---------- sauvegarde / restauration ---------- */
  function persist(force) {
    try {
      if (state === 'running' || state === 'paused') {
        localStorage.setItem(KEY, JSON.stringify({
          state: state, active: active, segStart: segStart, dist: dist,
          splits: splits, lastSplitT: lastSplitT, nextKm: nextKm, voice: voice
        }));
        var now = Date.now();
        if (force === true || now - lastTrackSave > 10000) {
          localStorage.setItem(KEY_TRACK, JSON.stringify(track));
          lastTrackSave = now;
        }
      } else {
        localStorage.removeItem(KEY);
        localStorage.removeItem(KEY_TRACK);
      }
    } catch (e) {}
  }
  function breakTrack() {
    if (track.length && track[track.length - 1]) track.push(null);
  }
  function restore() {
    var s = null;
    try { s = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { s = null; }
    if (!s || (s.state !== 'running' && s.state !== 'paused')) return;
    state = s.state;
    active = s.active || 0;
    segStart = s.state === 'running' ? s.segStart : null;
    dist = s.dist || 0;
    splits = Array.isArray(s.splits) ? s.splits : [];
    lastSplitT = s.lastSplitT || 0;
    nextKm = s.nextKm || 1;
    voice = !!s.voice;
    last = null; pts = [];
    try {
      var tr = JSON.parse(localStorage.getItem(KEY_TRACK) || '[]');
      track = Array.isArray(tr) ? tr : [];
    } catch (e) { track = []; }
    breakTrack();
    $('cvVoice').setAttribute('aria-pressed', voice ? 'true' : 'false');
    $('cvVoice').textContent = 'Annonce vocale à chaque km : ' + (voice ? 'oui' : 'non');
    if (state === 'running') {
      startWatch();
      timer = setInterval(draw, 1000);
      lock(); startKeepAlive();
      msg('Course reprise après un rechargement. Le temps a continué ; la distance reprend dès que le GPS est de retour.');
    } else {
      timer = setInterval(draw, 1000);
      msg('Course en pause restaurée. Appuie sur Reprendre.');
    }
  }

  function hav(a, b) {
    var R = 6371000, r = Math.PI / 180;
    var dLa = (b.latitude - a.lat) * r, dLo = (b.longitude - a.lon) * r;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) +
      Math.cos(a.lat * r) * Math.cos(b.latitude * r) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
  }
  function say(t) {
    if (!voice || !('speechSynthesis' in window)) return;
    try { var u = new SpeechSynthesisUtterance(t); u.lang = 'fr-FR'; window.speechSynthesis.speak(u); } catch (e) {}
  }

  /* allure actuelle : fenêtre d'environ 20 secondes */
  function currentPace() {
    var n = pts.length;
    if (n < 2) return NaN;
    var end = pts[n - 1], i = n - 1;
    while (i > 0 && end.t - pts[i - 1].t <= 20000) i--;
    var dd = end.d - pts[i].d, dt = end.t - pts[i].t;
    if (dd < 15 || dt <= 0) return NaN;
    return dt / (dd / 1000);
  }

  /* ---------- carte (canvas, sans fond de carte externe) ---------- */
  function accent() {
    var a = '';
    try { a = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); } catch (e) {}
    return a || '#fcd53f';
  }
  function dispFont() {
    var f = '';
    try { f = getComputedStyle(document.documentElement).getPropertyValue('--display').trim(); } catch (e) {}
    return f || 'system-ui, sans-serif';
  }
  function project(w, h, pad) {
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
    var k = Math.cos((minLa + maxLa) / 2 * Math.PI / 180);
    var ax = (maxLo - minLo) * k, ay = maxLa - minLa;
    var sc = Math.min((w - 2 * pad) / Math.max(ax, 0.0004), (h - 2 * pad) / Math.max(ay, 0.0004));
    var ox = (w - ax * sc) / 2, oy = (h - ay * sc) / 2;
    return function (q) { return [ox + (q[1] - minLo) * k * sc, oy + (maxLa - q[0]) * sc]; };
  }
  function drawGrid(ctx, w, h, step) {
    ctx.strokeStyle = 'rgba(255,255,255,.05)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = step; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (var y = step; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }
  function drawRoute(ctx, w, h, pad, lw) {
    var pr = project(w, h, pad);
    if (!pr) return;
    var acc = accent(), i, q, first = null, lastP = null;
    function trace() {
      var pen = false, j, pp, qq;
      ctx.beginPath();
      for (j = 0; j < track.length; j++) {
        pp = track[j];
        if (!pp) { pen = false; continue; }
        qq = pr(pp);
        if (!pen) { ctx.moveTo(qq[0], qq[1]); pen = true; } else ctx.lineTo(qq[0], qq[1]);
      }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(); ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.lineWidth = lw * 1.8; ctx.stroke();
    trace(); ctx.strokeStyle = acc; ctx.lineWidth = lw; ctx.stroke();
    for (i = 0; i < track.length; i++) if (track[i]) { if (!first) first = track[i]; lastP = track[i]; }
    function dot(p, fill) {
      q = pr(p);
      ctx.beginPath(); ctx.arc(q[0], q[1], lw * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = fill; ctx.fill();
      ctx.lineWidth = lw * 0.5; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
    dot(first, '#3ddc84');
    if (lastP !== first) dot(lastP, acc);
  }
  function drawMapLive() {
    var box = $('cvMapWrap');
    if (!track.length) { box.hidden = true; return; }
    box.hidden = false;
    var c = $('cvMap'), dpr = window.devicePixelRatio || 1;
    var w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    }
    var ctx = c.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#121a2e'; ctx.fillRect(0, 0, w, h);
    drawGrid(ctx, w, h, 40);
    drawRoute(ctx, w, h, 26, 5);
  }
  window.addEventListener('resize', drawMapLive);

  /* ---------- image à partager en story (1080 × 1920) ---------- */
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  function makeStory() {
    var W = 1080, H = 1920, c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d'), f = dispFont(), acc = accent();
    var g = x.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0e1325'); g.addColorStop(1, '#1a2240');
    x.fillStyle = g; x.fillRect(0, 0, W, H);

    /* en-tête */
    x.fillStyle = acc; x.beginPath(); x.arc(90, 150, 24, 0, Math.PI * 2); x.fill();
    x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillStyle = '#eef1fb'; x.font = '800 70px ' + f; x.fillText('Piste libre', 135, 175);
    x.textAlign = 'right'; x.fillStyle = '#9aa3c0'; x.font = '600 38px ' + f;
    var d = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
    x.fillText(d, W - 70, 172);

    /* carte */
    x.save();
    rr(x, 60, 240, 960, 940, 40); x.clip();
    x.fillStyle = '#121a2e'; x.fillRect(60, 240, 960, 940);
    x.translate(60, 240);
    drawGrid(x, 960, 940, 60);
    drawRoute(x, 960, 940, 100, 14);
    x.restore();

    /* chiffres */
    var t = elapsed();
    var avg = dist >= 50 ? fmtP(t / (dist / 1000)) : '–';
    x.textAlign = 'left'; x.fillStyle = '#eef1fb';
    x.font = '800 290px ' + f;
    var km = fmtKm(dist);
    x.fillText(km, 70, 1450);
    var kw = x.measureText(km).width;
    x.fillStyle = '#9aa3c0'; x.font = '700 90px ' + f;
    x.fillText('km', 70 + kw + 24, 1450);

    x.fillStyle = '#eef1fb'; x.font = '800 130px ' + f;
    x.fillText(fmtT(t), 70, 1650);
    x.fillText(avg, 570, 1650);
    x.fillStyle = '#9aa3c0'; x.font = '600 44px ' + f;
    x.fillText('Temps', 70, 1715);
    x.fillText('Allure moy. /km', 570, 1715);
    return c;
  }
  function shareStory() {
    var c = makeStory();
    c.toBlob(function (b) {
      if (!b) { msg('Impossible de créer l’image.'); return; }
      var file = null;
      try { file = new File([b], 'course-piste-libre.png', { type: 'image/png' }); } catch (e) {}
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: 'Ma course' }).catch(function () {});
      } else {
        var u = URL.createObjectURL(b), a = document.createElement('a');
        a.href = u; a.download = 'course-piste-libre.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(u); }, 5000);
        msg('Image enregistrée dans ton téléphone : ajoute-la à ta story.');
      }
    }, 'image/png');
  }

  function draw() {
    var t = elapsed();
    var inKm = dist - (nextKm - 1) * 1000;
    $('cvKm').textContent = fmtKm(dist);
    $('cvM').textContent = fmtM(dist);
    $('cvTime').textContent = fmtT(t);
    $('cvAvg').textContent = dist >= 50 ? fmtP(t / (dist / 1000)) : '–';
    $('cvNow').textContent = state === 'running' ? fmtP(currentPace()) : '–';
    $('cvBar').style.width = Math.min(100, Math.max(0, inKm / 10)) + '%';

    if (state === 'running' || state === 'paused') {
      var tk = t - lastSplitT;
      $('cvCur').textContent = 'Km ' + nextKm + ' en cours : ' + Math.round(inKm) + ' m' +
        (inKm >= 50 ? ' · ' + fmtP(tk / (inKm / 1000)) + ' /km' : '');
    }

    /* tableau par kilomètre */
    var best = -1, bestMs = Infinity, i;
    for (i = 0; i < splits.length; i++) if (splits[i].ms < bestMs) { bestMs = splits[i].ms; best = i; }
    var rows = '<tr><th>Km</th><th>Temps</th><th>Allure /km</th><th>Total</th></tr>', cum = 0;
    for (i = 0; i < splits.length; i++) {
      cum += splits[i].ms;
      rows += '<tr' + (i === best && splits.length > 1 ? ' class="best"' : '') + '><td>' + splits[i].km + '</td><td>' +
        fmtT(splits[i].ms) + '</td><td>' + fmtP(splits[i].ms) + '</td><td>' + fmtT(cum) + '</td></tr>';
    }
    var showPartial = inKm >= 50 && state !== 'idle';
    if (showPartial) {
      var tk2 = t - lastSplitT;
      rows += '<tr class="now"><td>' + nextKm + ' (' + Math.round(inKm) + ' m)</td><td>' + fmtT(tk2) +
        '</td><td>' + fmtP(tk2 / (inKm / 1000)) + '</td><td>' + fmtT(t) + '</td></tr>';
    }
    $('cvTable').innerHTML = rows;
    $('cvSplits').hidden = !(splits.length || showPartial);
    $('cvShare').hidden = !(dist >= 100 && track.length);
    drawMapLive();
    persist();
  }

  function onPos(p) {
    if (state !== 'running') return;
    var c = p.coords;
    if (c.accuracy > 35) { msg('Signal GPS faible… reste à ciel ouvert si possible.'); return; }
    var t = elapsed();
    /* premier point (départ ou reprise) : on ne garde pas d'ancien point,
       sauf si le GPS revient après un écran éteint (last est conservé) */
    if (!last) {
      last = { lat: c.latitude, lon: c.longitude, t: t };
      track.push([c.latitude, c.longitude]);
      msg('GPS prêt. Bonne course !');
      draw();
      return;
    }
    var d = hav(last, c), dt = (t - last.t) / 1000;
    if (d < 3) return;                       // bruit GPS
    if (dt > 0 && d / dt > 12) return;       // saut impossible
    var nd = dist + d;
    while (nd >= nextKm * 1000) {
      var frac = (nextKm * 1000 - dist) / (nd - dist);
      var tc = last.t + frac * (t - last.t);
      var ms = tc - lastSplitT;
      splits.push({ km: nextKm, ms: ms });
      lastSplitT = tc;
      var s = Math.round(ms / 1000);
      say('Kilomètre ' + nextKm + '. Temps ' + Math.floor(s / 60) + ' minutes ' + (s % 60) + ' secondes.');
      nextKm++;
    }
    dist = nd;
    last = { lat: c.latitude, lon: c.longitude, t: t };
    track.push([c.latitude, c.longitude]);
    pts.push({ t: t, d: dist });
    if (pts.length > 80) pts.shift();
    msg('Suivi en cours.');
    draw();
  }
  function onErr(e) {
    if (e && e.code === 1) msg('Localisation refusée. Autorise-la dans les réglages du navigateur, puis recommence.');
    else msg('Signal GPS introuvable pour le moment. Le temps continue de courir.');
  }
  function startWatch() {
    if (watchId !== null || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
  }
  function restartWatch() {
    if (watchId !== null) { try { navigator.geolocation.clearWatch(watchId); } catch (e) {} watchId = null; }
    startWatch();
  }

  /* ---------- écran toujours allumé ---------- */
  function lock() {
    try {
      if (wake || !(navigator.wakeLock && navigator.wakeLock.request)) return;
      navigator.wakeLock.request('screen').then(function (l) {
        wake = l;
        l.addEventListener('release', function () { wake = null; });
      }).catch(function () {});
    } catch (e) {}
  }
  function unlock() { try { if (wake) { wake.release(); wake = null; } } catch (e) {} }

  /* ---------- maintien en vie écran éteint (son silencieux) ----------
     Un son en lecture empêche Android de geler la page : le GPS et le
     chrono continuent même écran verrouillé. */
  function makeSilence() {
    var rate = 8000, n = rate, buf = new ArrayBuffer(44 + n), v = new DataView(buf), i;
    function w(o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); }
    w(0, 'RIFF'); v.setUint32(4, 36 + n, true); w(8, 'WAVE'); w(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true);
    w(36, 'data'); v.setUint32(40, n, true);
    for (i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  function startKeepAlive() {
    try {
      if (!keepAudio) {
        silenceUrl = silenceUrl || makeSilence();
        keepAudio = new Audio(silenceUrl);
        keepAudio.loop = true;
      }
      var p = keepAudio.play();
      if (p && p.catch) p.catch(function () {});
      if ('mediaSession' in navigator && window.MediaMetadata) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: 'Course en cours', artist: 'Piste libre' });
        try { navigator.mediaSession.setActionHandler('play', function () { keepAudio && keepAudio.play(); }); } catch (e) {}
        try { navigator.mediaSession.setActionHandler('pause', function () { keepAudio && keepAudio.play(); }); } catch (e) {}
      }
    } catch (e) {}
  }
  function stopKeepAlive() {
    try { if (keepAudio) { keepAudio.pause(); keepAudio.currentTime = 0; } } catch (e) {}
  }

  /* retour à l'écran : on remet tout à jour tout de suite */
  function refresh() {
    if (state !== 'running' && state !== 'paused') return;
    if (state === 'running') {
      lock(); restartWatch();
      if (keepAudio && keepAudio.paused) startKeepAlive();
    }
    draw();
  }
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') refresh();
    else persist(true);
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('pageshow', refresh);
  /* sauvegarde de dernière minute si la page se ferme */
  window.addEventListener('pagehide', function () { persist(true); });

  function btn() {
    $('cvStart').disabled = (state === 'running' || state === 'paused');
    $('cvPause').disabled = !(state === 'running' || state === 'paused');
    $('cvStop').disabled = !(state === 'running' || state === 'paused');
    $('cvPause').textContent = state === 'paused' ? 'Reprendre' : 'Pause';
  }

  $('cvStart').addEventListener('click', function () {
    if (!navigator.geolocation) { msg('Ton navigateur ne gère pas la localisation.'); return; }
    active = 0; dist = 0; last = null; splits = []; lastSplitT = 0; nextKm = 1; pts = []; track = [];
    $('cvSave').hidden = true; $('cvSave').textContent = 'Ajouter au carnet';
    state = 'running'; segStart = Date.now();
    msg('Recherche du signal GPS…');
    startWatch();
    clearInterval(timer);
    timer = setInterval(draw, 1000);
    lock(); startKeepAlive(); btn(); draw();
  });
  $('cvPause').addEventListener('click', function () {
    if (state === 'running') { active = elapsed(); segStart = null; state = 'paused'; last = null; breakTrack(); msg('En pause.'); }
    else if (state === 'paused') { segStart = Date.now(); state = 'running'; startWatch(); lock(); startKeepAlive(); msg('Reprise… recherche du signal.'); }
    btn(); draw();
  });
  $('cvStop').addEventListener('click', function () {
    if (state !== 'running' && state !== 'paused') return;
    active = elapsed(); segStart = null; state = 'done';
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    clearInterval(timer); unlock(); stopKeepAlive();
    msg(dist >= 100 ? 'Course terminée. Bravo ! Tu peux la partager en story.' : 'Course terminée (distance trop courte pour être enregistrée).');
    $('cvCur').textContent = '';
    $('cvSave').hidden = !(dist >= 100);
    btn(); draw();
  });
  $('cvVoice').addEventListener('click', function () {
    voice = !voice;
    this.setAttribute('aria-pressed', voice ? 'true' : 'false');
    this.textContent = 'Annonce vocale à chaque km : ' + (voice ? 'oui' : 'non');
    if (voice) say('Annonces vocales activées.');
  });
  $('cvShare').addEventListener('click', shareStory);
  $('cvSave').addEventListener('click', function () {
    var arr = [];
    try { arr = JSON.parse(localStorage.getItem('pl-carnet') || '[]'); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
    var n = new Date();
    arr.push({
      date: n.getFullYear() + '-' + pad(n.getMonth() + 1) + '-' + pad(n.getDate()),
      km: Math.round(dist / 10) / 100,
      min: Math.max(1, Math.round(active / 60000)),
      f: 3
    });
    try { localStorage.setItem('pl-carnet', JSON.stringify(arr)); } catch (e) { msg('Impossible d’enregistrer sur cet appareil.'); return; }
    window.dispatchEvent(new Event('pl-carnet-changed'));
    this.textContent = 'Ajoutée au carnet ✓';
  });

  restore();
  btn(); draw();
})();
