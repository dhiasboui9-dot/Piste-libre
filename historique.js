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
    saveSession, list, remove, analyse, calories,
    getWeight, setWeight, fmtPace, fmtDuration,
  };
})();
