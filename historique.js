/* Piste libre — historique des séances
   Utilisation depuis course-live.js, à la fin de la course :
     PisteHistorique.saveSession(points);
   où points = [{lat, lon, t}, ...]  (t = Date.now() en ms)
*/
(function () {
  const KEY_SESSIONS = "pl_sessions_v1";
  const KEY_WEIGHT = "pl_weight_kg";

  function read(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function getWeight() {
    const w = Number(read(KEY_WEIGHT, 70));
    return w > 20 && w < 300 ? w : 70;
  }
  function setWeight(kg) {
    write(KEY_WEIGHT, Number(kg));
  }

  // Distance entre deux points GPS (mètres)
  function haversine(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  // Calcule distance totale, durée et allure par kilomètre
  function analyse(points) {
    const splits = [];
    let dist = 0;              // mètres cumulés
    let nextKm = 1000;
    let lastKmTime = points.length ? points[0].t : 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dt = (b.t - a.t) / 1000;
      const d = haversine(a, b);
      if (dt <= 0 || d / dt > 12) continue; // saut GPS (> 43 km/h) ignoré
      const before = dist;
      dist += d;
      while (dist >= nextKm) {
        const frac = (nextKm - before) / d;
        const tCross = a.t + frac * (b.t - a.t);
        splits.push({ km: splits.length + 1, sec: (tCross - lastKmTime) / 1000, partial: false });
        lastKmTime = tCross;
        nextKm += 1000;
      }
    }
    const end = points.length ? points[points.length - 1].t : 0;
    const rest = dist - (nextKm - 1000);
    if (rest > 50) {
      // dernier kilomètre incomplet : allure ramenée au km
      const sec = (end - lastKmTime) / 1000;
      splits.push({ km: splits.length + 1, sec: sec * (1000 / rest), partial: true, meters: Math.round(rest) });
    }
    const durationSec = points.length > 1 ? (end - points[0].t) / 1000 : 0;
    return { distanceM: dist, durationSec, splits };
  }

  // Calories ≈ poids (kg) × distance (km) × 1,036
  function calories(distanceM, weightKg) {
    return Math.round(weightKg * (distanceM / 1000) * 1.036);
  }

  // Enregistre la séance automatiquement
  function saveSession(points, extra) {
    if (!points || points.length < 2) return null;
    const r = analyse(points);
    if (r.distanceM < 100) return null; // séance trop courte
    const weight = getWeight();
    const session = {
      id: String(points[0].t),
      date: points[0].t,
      distanceM: Math.round(r.distanceM),
      durationSec: Math.round(r.durationSec),
      splits: r.splits.map((s) => ({ ...s, sec: Math.round(s.sec) })),
      weightKg: weight,
      calories: calories(r.distanceM, weight),
      ...(extra || {}),
    };
    const all = read(KEY_SESSIONS, []);
    all.unshift(session);
    write(KEY_SESSIONS, all);
    return session;
  }

  // Enregistre une séance à partir des données déjà calculées par l'app
  // run = { distM, durationMs, splits: [{label, pace, total}] }
  function saveFromRun(run) {
    if (!run || !(run.distM >= 100)) return null;
    const weight = getWeight();
    const now = Date.now();
    const durationSec = Math.round(run.durationMs / 1000);
    const all = read(KEY_SESSIONS, []);
    // évite d'enregistrer deux fois la même séance
    if (all.length && Math.abs(all[0].distanceM - run.distM) < 5 &&
        now - all[0].date < durationSec * 1000 + 120000) return all[0];
    const splits = (run.splits || []).map((s) => {
      const m = /(\d+):(\d+)/.exec(s.pace || "");
      return {
        label: s.label,
        sec: m ? Number(m[1]) * 60 + Number(m[2]) : 0,
        total: s.total,
        partial: /km/.test(s.label || ""),
      };
    });
    const session = {
      id: String(now),
      date: now - durationSec * 1000,
      distanceM: Math.round(run.distM),
      durationSec,
      splits,
      weightKg: weight,
      calories: calories(run.distM, weight),
    };
    all.unshift(session);
    write(KEY_SESSIONS, all);
    return session;
  }

  function list() {
    return read(KEY_SESSIONS, []);
  }
  function remove(id) {
    write(KEY_SESSIONS, list().filter((s) => s.id !== id));
  }

  // Formatage
  function fmtPace(sec) {
    if (!isFinite(sec) || sec <= 0) return "–";
    const m = Math.floor(sec / 60), s = Math.round(sec % 60);
    return m + ":" + String(s === 60 ? 59 : s).padStart(2, "0") + " /km";
  }
  function fmtDuration(sec) {
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(s).padStart(2, "0");
  }

  window.PisteHistorique = {
    saveSession, saveFromRun, list, remove, analyse, calories,
    getWeight, setWeight, fmtPace, fmtDuration,
  };
  // --- Branchement automatique sur le bouton "Ajouter au carnet" ---
  // (aucune modification de index.html nécessaire à part le chargement de ce fichier)
  function parseClock(t) {
    const a = String(t || "").trim().split(":").map(Number);
    if (!a.length || a.some(isNaN)) return 0;
    return a.length === 3 ? a[0] * 3600 + a[1] * 60 + a[2] : a[0] * 60 + (a[1] || 0);
  }
  document.addEventListener("click", function (e) {
    if (!e.target.closest || !e.target.closest("#lSave")) return;
    setTimeout(function () {
      try {
        const carnet = JSON.parse(localStorage.getItem("pl-carnet") || "[]");
        const last = carnet[carnet.length - 1];
        if (!last) return;
        const splits = [];
        document.querySelectorAll("#lTable tr").forEach(function (tr, i) {
          const c = tr.querySelectorAll("td");
          if (i === 0 || c.length < 3) return;
          splits.push({ label: c[0].textContent.trim(), pace: c[1].textContent.trim(), total: c[2].textContent.trim() });
        });
        const timeEl = document.getElementById("lTime");
        const sec = timeEl ? parseClock(timeEl.textContent) : (last.min || 0) * 60;
        const res = window.PisteHistorique.saveFromRun({
          distM: Number(last.km) * 1000,
          durationMs: sec * 1000,
          splits: splits,
        });
        const b = document.getElementById("lSave");
        if (b) {
          b.textContent = res ? "Séance enregistrée ✓" : "Séance trop courte (moins de 100 m)";
          if (res && !document.getElementById("pl-voir")) {
            const a = document.createElement("a");
            a.id = "pl-voir";
            a.href = "historique.html";
            a.textContent = "Voir mes séances (allure par km, calories) ›";
            a.style.cssText = "display:block;margin:12px 0;text-align:center;color:inherit;font-weight:600;";
            b.insertAdjacentElement("afterend", a);
          }
        }
      } catch (err) {}
    }, 100);
  });
  // --- Lien "Séances" ajouté automatiquement dans le menu ---
  function addMenuLink() {
    if (document.getElementById("pl-link-seances")) return;
    if (/historique\.html/.test(location.pathname)) return;
    const links = Array.from(document.querySelectorAll("nav a, header a, a"));
    const ref = links.find(function (a) { return a.textContent.trim() === "Outils"; });
    if (ref) {
      const a = ref.cloneNode(false);
      a.id = "pl-link-seances";
      a.href = "historique.html";
      a.textContent = "Séances";
      a.removeAttribute("onclick");
      ref.insertAdjacentElement("afterend", a);
      return;
    }
    // Si le menu n'est pas trouvé : petit bouton flottant
    const b = document.createElement("a");
    b.id = "pl-link-seances";
    b.href = "historique.html";
    b.textContent = "Séances";
    b.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:50;background:#f7d23e;color:#0f1424;" +
      "padding:12px 18px;border-radius:999px;font:700 15px Roboto,system-ui,sans-serif;text-decoration:none;";
    document.body.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addMenuLink);
  else addMenuLink();
  // --- Bouton "Enregistrer la séance" placé sous le compteur ---
  function setupSaveButton() {
    const btn = document.getElementById("lSave");
    if (!btn) return false;
    if (btn.dataset.plReady) return true;
    btn.dataset.plReady = "1";
    btn.textContent = "Enregistrer la séance";
    const t = document.getElementById("lTime");
    const card = t && t.closest("div");
    const grid = card && card.parentElement;
    if (grid && grid.parentElement && !grid.contains(btn)) {
      grid.insertAdjacentElement("afterend", btn);
      btn.style.display = "block";
      btn.style.width = "100%";
      btn.style.margin = "16px 0";
    }
    return true;
  }
  if (!setupSaveButton()) {
    const obs = new MutationObserver(function () {
      if (setupSaveButton()) obs.disconnect();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  }
})();
