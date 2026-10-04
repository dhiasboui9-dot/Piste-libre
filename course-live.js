/* Piste libre : suivi de course en direct (style Strava).
   Remplace le contenu de la section #course.
   Distance en km et en mètres, temps, allure moyenne, allure actuelle,
   et pour chaque kilomètre : temps, allure et temps total.
   + Sauvegarde automatique : si la page est rechargée ou tuée par Android
     pendant la course, elle reprend où elle en était. */
(function () {
  var sec = document.getElementById('course');
if (!sec) {
  var t0 = document.getElementById('lTime');
  sec = t0 && (t0.closest('section') || t0.closest('.wrap'));
}
if (!sec) return; alert('course-live chargé : ' + (document.getElementById('course') ? 'course trouvé' : (document.getElementById('lTime') ? 'lTime trouvé' : 'rien trouvé')));
var wrap = sec.querySelector('.wrap') || sec;
var wrap = sec.querySelector('.wrap') || sec;
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
    '<button class="linkbtn" id="cvSave" type="button" hidden>Ajouter au carnet</button>' +
    '<p class="note">Garde la page ouverte et l’écran allumé pendant la course : le site empêche la mise en veille et sauvegarde ta course toutes les secondes. Si la page est rechargée, elle reprend automatiquement. À l’intérieur ou entre de grands immeubles, le GPS est moins précis. La distance reste une estimation.</p>';

  var $ = function (id) { return document.getElementById(id); };
  var KEY = 'pl-course-live';
  var state = 'idle', watchId = null, timer = null, wake = null, voice = false;
  var active = 0, segStart = null, dist = 0, last = null;
  var splits = [], lastSplitT = 0, nextKm = 1, pts = [];

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
  function persist() {
    try {
      if (state === 'running' || state === 'paused') {
        localStorage.setItem(KEY, JSON.stringify({
          state: state, active: active, segStart: segStart, dist: dist,
          splits: splits, lastSplitT: lastSplitT, nextKm: nextKm, voice: voice
        }));
      } else {
        localStorage.removeItem(KEY);
      }
    } catch (e) {}
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
    $('cvVoice').setAttribute('aria-pressed', voice ? 'true' : 'false');
    $('cvVoice').textContent = 'Annonce vocale à chaque km : ' + (voice ? 'oui' : 'non');
    if (state === 'running') {
      startWatch();
      timer = setInterval(draw, 1000);
      lock();
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
    persist();
  }

  function onPos(p) {
    if (state !== 'running') return;
    var c = p.coords;
    if (c.accuracy > 35) { msg('Signal GPS faible… reste à ciel ouvert si possible.'); return; }
    var t = elapsed();
    if (!last) { last = { lat: c.latitude, lon: c.longitude, t: t }; msg('GPS prêt. Bonne course !'); return; }
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
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && (state === 'running' || state === 'paused')) {
      if (state === 'running') { lock(); startWatch(); }
      draw();
    }
  });
  /* sauvegarde de dernière minute si la page se ferme */
  window.addEventListener('pagehide', persist);

  function btn() {
    $('cvStart').disabled = (state === 'running' || state === 'paused');
    $('cvPause').disabled = !(state === 'running' || state === 'paused');
    $('cvStop').disabled = !(state === 'running' || state === 'paused');
    $('cvPause').textContent = state === 'paused' ? 'Reprendre' : 'Pause';
  }

  $('cvStart').addEventListener('click', function () {
    if (!navigator.geolocation) { msg('Ton navigateur ne gère pas la localisation.'); return; }
    active = 0; dist = 0; last = null; splits = []; lastSplitT = 0; nextKm = 1; pts = [];
    $('cvSave').hidden = true; $('cvSave').textContent = 'Ajouter au carnet';
    state = 'running'; segStart = Date.now();
    msg('Recherche du signal GPS…');
    startWatch();
    clearInterval(timer);
    timer = setInterval(draw, 1000);
    lock(); btn(); draw();
  });
  $('cvPause').addEventListener('click', function () {
    if (state === 'running') { active = elapsed(); segStart = null; state = 'paused'; last = null; msg('En pause.'); }
    else if (state === 'paused') { segStart = Date.now(); state = 'running'; startWatch(); lock(); msg('Reprise… recherche du signal.'); }
    btn(); draw();
  });
  $('cvStop').addEventListener('click', function () {
    if (state !== 'running' && state !== 'paused') return;
    active = elapsed(); segStart = null; state = 'done';
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    clearInterval(timer); unlock();
    msg(dist >= 100 ? 'Course terminée. Bravo !' : 'Course terminée (distance trop courte pour être enregistrée).');
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
