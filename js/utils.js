/* ── Pure utility functions — shared by index.html and test suite ── */

/* ── COLORS & INITIALS ──────────────────────────────────────────── */
const COLORS = ['#ffb830','#39ff14','#ff3d6b','#00ffff','#b87eff','#ff6600','#00e5ff','#ff00ff'];

function pColor(name) {
  if (!name) return '#39ff14';
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffffffff;
  return COLORS[Math.abs(h) % COLORS.length];
}

function ini2(n) {
  return (n || '??').slice(0, 2).toUpperCase();
}

/* ── MARQUEE ────────────────────────────────────────────────────── */
function buildMarquee(items) {
  const doubled = [...items, ...items];
  return doubled.map(t => `<span class="marquee-item">${t}</span>`).join('');
}

/* ── EMPTY / LOADING STATES ─────────────────────────────────────── */
function emptyState(msg) {
  return `<div style="text-align:center;padding:48px 20px;">
    <div style="font-size:36px;margin-bottom:14px;">🎳</div>
    <div style="font-family:'Press Start 2P',monospace;font-size:9px;color:var(--dim);letter-spacing:1px;line-height:1.8;">${msg}</div>
    <div style="margin-top:18px;">
      <button onclick="window.location.href='upload.html'"
        style="background:var(--neon-g);color:var(--void);border:none;border-radius:4px;padding:10px 22px;
               font-family:'Press Start 2P',monospace;font-size:8px;letter-spacing:1px;cursor:pointer;
               box-shadow:0 0 16px rgba(57,255,20,.3),3px 3px 0 var(--neon-g2);">
        📸 UPLOAD FIRST SCORE
      </button>
    </div>
  </div>`;
}

function loadingState() {
  return `<div style="text-align:center;padding:40px 20px;">
    <div style="width:40px;height:40px;border:3px solid var(--rail2);border-top-color:var(--neon-g);
                border-radius:50%;animation:spin .7s linear infinite;margin:0 auto 16px;
                box-shadow:0 0 16px rgba(57,255,20,.2);"></div>
    <div style="font-family:'Press Start 2P',monospace;font-size:8px;color:var(--dim);letter-spacing:1px;">LOADING...</div>
  </div>`;
}

/* ── LOCAL STORAGE CACHE ────────────────────────────────────────── */
const CACHE_KEY_PREFIX = 'ar_cache_';
const CACHE_TTL_MS     = 5 * 60 * 1000;

function getCached(leagueId) {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + leagueId);
    if (!raw) return null;
    const { ts, data } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL_MS) return null;
    return data;
  } catch(e) { return null; }
}

function setCache(leagueId, data) {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + leagueId, JSON.stringify({ ts: Date.now(), data }));
  } catch(e) {}
}

/* ── MILESTONES ─────────────────────────────────────────────────── */
const MILESTONES = [
  { min:300, max:300, key:'300', label:'PERFECT 300',  emoji:'🏆', rarity:'legendary' },
  { min:290, max:299, key:'290', label:'290+ GAME',    emoji:'💎', rarity:'epic'      },
  { min:275, max:289, key:'275', label:'275+ GAME',    emoji:'🔥', rarity:'epic'      },
  { min:250, max:274, key:'250', label:'250+ GAME',    emoji:'⚡', rarity:'rare'      },
  { min:225, max:249, key:'225', label:'225+ GAME',    emoji:'🌟', rarity:'rare'      },
  { min:200, max:224, key:'200', label:'200+ GAME',    emoji:'✨', rarity:'uncommon'  },
  { min:175, max:199, key:'175', label:'175+ GAME',    emoji:'🎳', rarity:'common'    },
];

function getMilestoneForScore(score) {
  return MILESTONES.find(m => score >= m.min && score <= m.max) || null;
}

/* ── STATS FILTER HELPERS ───────────────────────────────────────── */
function computeFilteredBowlers(weeks, numWeeks, allBowlers) {
  const sliced = weeks.slice(0, numWeeks);
  if (!sliced.length) return allBowlers;

  const bowlerMap = {};
  sliced.forEach(w => {
    (w.bowlers || []).forEach(b => {
      const key = (b.name || '').trim().toLowerCase();
      if (!key) return;
      if (!bowlerMap[key]) bowlerMap[key] = { name: b.name, allGames: [], weeklyGames: [] };
      bowlerMap[key].allGames.push(...(b.games || []));
      if (b.games && b.games.length) bowlerMap[key].weeklyGames.push(b.games);
    });
  });

  return Object.values(bowlerMap).map(b => {
    if (!b.allGames.length) return null;
    const orig = (allBowlers || []).find(
      s => (s.name || '').trim().toLowerCase() === (b.name || '').trim().toLowerCase()
    ) || {};
    const avg = Math.round(b.allGames.reduce((a, v) => a + v, 0) / b.allGames.length);
    const highGame = Math.max(...b.allGames);
    let highSeries = 0;
    b.weeklyGames.forEach(g => {
      const top3 = [...g].sort((a, z) => z - a).slice(0, 3);
      const t = top3.reduce((a, v) => a + v, 0);
      if (t > highSeries) highSeries = t;
    });
    return { ...orig, avg, highGame, highSeries, gamesCount: b.allGames.length };
  }).filter(Boolean);
}

/* CommonJS export for Jest; no-op in browser */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    COLORS,
    MILESTONES,
    CACHE_KEY_PREFIX,
    CACHE_TTL_MS,
    pColor,
    ini2,
    buildMarquee,
    emptyState,
    loadingState,
    getCached,
    setCache,
    getMilestoneForScore,
    computeFilteredBowlers,
  };
}
