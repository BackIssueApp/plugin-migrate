// Parsers for other collection managers' databases. Both Mylar3 and Kapowarr
// store their library in SQLite with ComicVine volume ids, so migration is an
// EXACT mapping — no fuzzy matching. Each parser takes an open better-sqlite3
// handle (readonly) and returns normalized rows:
//   { cvId, title, year, monitored, folder }
// detectApp() sniffs which application a database belongs to by its tables.

function tables(db) {
  return new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name),
  );
}

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((r) => r.name));
}

// Which app wrote this database? 'mylar' | 'kapowarr' | null.
export function detectApp(db) {
  const t = tables(db);
  if (t.has('comics') && columns(db, 'comics').has('ComicID')) return 'mylar';
  if (t.has('volumes') && columns(db, 'volumes').has('comicvine_id')) return 'kapowarr';
  return null;
}

// Mylar3: table `comics` — ComicID IS the ComicVine volume id (text). Status
// 'Active' means monitored; 'Paused' (and anything else) not.
export function parseMylar(db) {
  const cols = columns(db, 'comics');
  const pick = (want, fallback) => (cols.has(want) ? want : (cols.has(fallback) ? fallback : null));
  const nameCol = pick('ComicName', 'ComicName_Filesafe');
  const rows = db.prepare('SELECT * FROM comics').all();
  const out = [];
  for (const r of rows) {
    const cvId = Number(String(r.ComicID ?? '').replace(/\D/g, ''));
    if (!cvId) continue; // unmatched/placeholder rows can't be migrated exactly
    out.push({
      cvId,
      title: (nameCol && r[nameCol]) || `Volume ${cvId}`,
      year: r.ComicYear != null && String(r.ComicYear).match(/^\d{4}$/) ? Number(r.ComicYear) : null,
      monitored: String(r.Status || '').toLowerCase() === 'active',
      folder: r.ComicLocation || null,
    });
  }
  return out;
}

// Kapowarr: table `volumes` — comicvine_id (integer), monitored (0/1).
export function parseKapowarr(db) {
  const cols = columns(db, 'volumes');
  const rows = db.prepare('SELECT * FROM volumes').all();
  const out = [];
  for (const r of rows) {
    const cvId = Number(r.comicvine_id);
    if (!cvId) continue;
    out.push({
      cvId,
      title: r.title || `Volume ${cvId}`,
      year: r.year != null && String(r.year).match(/^\d{4}$/) ? Number(r.year) : null,
      monitored: cols.has('monitored') ? !!r.monitored : true,
      folder: r.folder || null,
    });
  }
  return out;
}

// Parse whichever app the database belongs to. Returns { app, series } or null
// when the file isn't a recognized library database.
export function parseLibraryDb(db) {
  const app = detectApp(db);
  if (!app) return null;
  const series = app === 'mylar' ? parseMylar(db) : parseKapowarr(db);
  // One row per CV id (Mylar can hold duplicate rows after failed refreshes) —
  // keep the first, prefer a monitored one.
  const byId = new Map();
  for (const s of series) {
    const prev = byId.get(s.cvId);
    if (!prev || (!prev.monitored && s.monitored)) byId.set(s.cvId, s);
  }
  return { app, series: [...byId.values()].sort((a, b) => String(a.title).localeCompare(String(b.title))) };
}
