/* Piste libre : mise à jour obligatoire.
   Quand version.json change, l'ami voit un écran bloquant et ne peut
   entrer qu'après avoir touché « Mettre à jour ». */
(function () {
  var KEY = 'pl-version';

  function clearAll() {
    var jobs = [];
    if ('serviceWorker' in navigator) {
      jobs.push(navigator.serviceWorker.getRegistrations().then(function (rs) {
        return Promise.all(rs.map(function (r) { return r.unregister(); }));
      }));
    }
    if (window.caches) {
      jobs.push(caches.keys().then(function (ks) {
        return Promise.all(ks.map(function (k) { return caches.delete(k); }));
      }));
    }
    return Promise.all(jobs).catch(function () {});
  }

  function applyUpdate(v) {
    var base = location.href.split('?')[0].split('#')[0];
    clearAll()
      .then(function () { return fetch(base, { cache: 'reload' }).catch(function () {}); })
      .then(function () {
        try { localStorage.setItem(KEY, v); } catch (e) {}
        location.replace(base + '?v=' + encodeURIComponent(v));
      });
  }

  function block(v) {
    if (document.getElementById('pl-update')) return;
    var d = document.createElement('div');
    d.id = 'pl-update';
    d.setAttribute('role', 'alertdialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-labelledby', 'pl-upd-t');
    d.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:24px;background:#0C1424;color:#EAF0FA;font-family:Barlow,Helvetica,Arial,sans-serif';
    d.innerHTML =
      '<div style="width:100%;max-width:420px;background:#152039;border:1px solid #28375A;border-top:8px solid #FFD400;border-radius:16px;padding:28px 22px">' +
      '<h1 id="pl-upd-t" style="margin:0;font-family:\'Barlow Condensed\',\'Arial Narrow\',sans-serif;font-weight:800;font-size:2.4rem;line-height:.95;text-transform:uppercase">Mise à jour disponible</h1>' +
      '<p style="margin:12px 0 18px;color:#9BABC7;line-height:1.5">Une nouvelle version de Piste libre est prête. Mets à jour pour continuer.</p>' +
      '<button id="pl-upd-b" type="button" style="font:inherit;font-weight:700;font-size:1.05rem;width:100%;background:#86A0FF;color:#0C1424;border:0;border-radius:10px;padding:14px;cursor:pointer">Mettre à jour</button>' +
      '</div>';
    document.body.appendChild(d);
    document.documentElement.style.overflow = 'hidden';
    var b = document.getElementById('pl-upd-b');
    b.focus();
    b.onclick = function () {
      b.disabled = true;
      b.textContent = 'Mise à jour…';
      applyUpdate(v);
    };
  }

  var FILES = [location.pathname, 'course-live.js', 'version.json'];

  function head(u) {
    return fetch(u + (u.indexOf('?') > -1 ? '&' : '?') + 't=' + Date.now(), { method: 'HEAD', cache: 'no-store' })
      .then(function (r) { return r.headers.get('etag') || r.headers.get('last-modified') || ''; })
      .catch(function () { return ''; });
  }

  function check() {
    Promise.all(FILES.map(head)).then(function (a) {
      if (a.every(function (x) { return !x; })) return;
      var v = a.join('|');
      var seen = null;
      try { seen = localStorage.getItem(KEY); } catch (e) {}
      if (seen === null) { try { localStorage.setItem(KEY, v); } catch (e) {} return; }
      if (seen !== v) block(v);
    });
  }

  function init() {
    check();
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') check();
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
