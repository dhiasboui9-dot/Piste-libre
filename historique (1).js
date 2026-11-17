/* Piste libre — historique des séances
   course.js appelle à « Terminer » :
     PisteHistorique.saveFromRun({ distM, durationMs, splits, track, lost });
   Fonctions pour la page des séances :
     PisteHistorique.thumb(canvas, séance)   -> miniature du tracé
     PisteHistorique.shareSession(séance)    -> story 1080×1920 avec le tracé
   Pour partager avec une photo : partage-story.html?id=<séance.id>
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
    let dist = 0;
    let nextKm = 1000;
    let lastKmTime = points.length ? points[0].t : 0;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      const dt = (b.t - a.t) / 1000;
      const d = haversine(a, b);
      if (dt <= 0 || d / dt > 12) continue;
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

  // Enregistre une séance à partir de points GPS bruts [{lat, lon, t}]
  function saveSession(points, extra) {
    if (!points || points.length < 2) return null;
    const r = analyse(points);
    if (r.distanceM < 100) return null;
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
  // run = { distM, durationMs, splits: [{label, pace, total}], track, lost }
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
      track: (run.track || []).map(function (p) {
        return p ? [Math.round(p[0] * 1e5) / 1e5, Math.round(p[1] * 1e5) / 1e5] : null;
      }),
      lostMs: run.lost || 0,
    };
    all.unshift(session);
    if (!write(KEY_SESSIONS, all)) return null;
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

  // ---------- Tracé GPS : miniature et partage ----------
  function drawTrack(ctx, w, h, pad, lw, track) {
    const pts = track.filter(Boolean);
    if (!pts.length) return;
    const la = pts.map((p) => p[0]), lo = pts.map((p) => p[1]);
    const minLa = Math.min(...la), maxLa = Math.max(...la);
    const minLo = Math.min(...lo), maxLo = Math.max(...lo);
    const k = Math.cos((minLa + maxLa) / 2 * Math.PI / 180);
    const ax = (maxLo - minLo) * k, ay = maxLa - minLa;
    const sc = Math.min((w - 2 * pad) / Math.max(ax, 4e-4), (h - 2 * pad) / Math.max(ay, 4e-4));
    const ox = (w - ax * sc) / 2, oy = (h - ay * sc) / 2;
    const P = (p) => [ox + (p[1] - minLo) * k * sc, oy + (maxLa - p[0]) * sc];
    function trace() {
      ctx.beginPath();
      let pen = false;
      track.forEach((p) => {
        if (!p) { pen = false; return; }
        const q = P(p);
        if (pen) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]);
        pen = true;
      });
    }
    ctx.lineCap = ctx.lineJoin = "round";
    trace(); ctx.strokeStyle = "rgba(0,0,0,.5)"; ctx.lineWidth = lw * 1.8; ctx.stroke();
    trace(); ctx.strokeStyle = "#f7d23e"; ctx.lineWidth = lw; ctx.stroke();
    [[pts[0], "#3ddc84"], [pts[pts.length - 1], "#f7d23e"]].forEach(function (d) {
      const q = P(d[0]);
      ctx.beginPath(); ctx.arc(q[0], q[1], lw * 1.5, 0, 7);
      ctx.fillStyle = d[1]; ctx.fill();
      ctx.strokeStyle = "#fff"; ctx.lineWidth = lw * 0.5; ctx.stroke();
    });
  }

  // miniature dans un <canvas> (liste des séances)
  function thumb(canvas, s) {
    const c = canvas.getContext("2d");
    c.fillStyle = "#121a2e"; c.fillRect(0, 0, canvas.width, canvas.height);
    drawTrack(c, canvas.width, canvas.height, 14, 3, s.track || []);
  }

  // image story 1080×1920 + partage
  function shareSession(s) {
    const W = 1080, H = 1920, cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const x = cv.getContext("2d"), f = "Roboto, system-ui, sans-serif";
    x.fillStyle = "#0e1325"; x.fillRect(0, 0, W, H);
    x.fillStyle = "#f7d23e"; x.beginPath(); x.arc(90, 150, 24, 0, 7); x.fill();
    x.fillStyle = "#eef1fb"; x.font = "800 70px " + f; x.fillText("Piste libre", 135, 175);
    x.textAlign = "right"; x.fillStyle = "#9aa3c0"; x.font = "600 38px " + f;
    x.fillText(new Date(s.date).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), W - 70, 172);
    x.save(); x.beginPath(); x.rect(60, 240, 960, 940); x.clip();
    x.fillStyle = "#121a2e"; x.fillRect(60, 240, 960, 940); x.translate(60, 240);
    drawTrack(x, 960, 940, 100, 14, s.track || []); x.restore();
    const km = (s.distanceM / 1000).toFixed(2).replace(".", ",");
    const avg = fmtPace((s.durationSec - (s.lostMs || 0) / 1000) / (s.distanceM / 1000)).replace(" /km", "");
    x.textAlign = "left"; x.fillStyle = "#eef1fb"; x.font = "800 290px " + f; x.fillText(km, 70, 1450);
    const kw = x.measureText(km).width;
    x.fillStyle = "#9aa3c0"; x.font = "700 90px " + f; x.fillText("km", 94 + kw, 1450);
    x.fillStyle = "#eef1fb"; x.font = "800 130px " + f;
    x.fillText(fmtDuration(s.durationSec), 70, 1650); x.fillText(avg, 570, 1650);
    x.fillStyle = "#9aa3c0"; x.font = "600 44px " + f;
    x.fillText("Temps", 70, 1715); x.fillText("Allure moy. /km", 570, 1715);
    cv.toBlob(function (b) {
      if (!b) return;
      const file = new File([b], "course-piste-libre.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] }))
        navigator.share({ files: [file], title: "Ma course" }).catch(function () {});
      else {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b); a.download = file.name; a.click();
      }
    }, "image/png");
  }

  window.PisteHistorique = {
    saveSession, saveFromRun, list, remove, analyse, calories,
    getWeight, setWeight, fmtPace, fmtDuration, thumb, shareSession,
  };

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
})();
