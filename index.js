// Migration Assistant plugin for BackIssue.
//
// Imports an existing collection from another manager (Mylar3 or Kapowarr) by
// reading its SQLite database: both store ComicVine volume ids, so every series
// maps EXACTLY — no fuzzy matching. The user uploads the .db file (or points at
// a path the server can read), previews the parsed series list, picks what to
// bring over, and the import adds each volume through the same ComicVine path
// the Add dialog uses. Monitored/paused state carries over; files on disk are
// picked up afterwards by the normal library scan. Downloads are NEVER queued
// by the migration — review your library first, then grab what's missing.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import config from '../../src/config.js';
import { makeCvClient } from '../../src/cv.js';
import { addSeriesFromCv } from '../../src/cvmatch.js';
import { setFollowed, assignSeriesLibrary } from '../../src/db.js';
import { logInfo, logWarn } from '../../src/logstore.js';
import { parseLibraryDb } from './parsers.js';

const MAX_UPLOAD_BYTES = 512 * 1024 * 1024; // mylar.db carries issue tables; be generous
const uploadPath = () => path.join(config.dataDir, 'migrate-upload.db');

// One import at a time; progress is polled by the client.
const state = {
  running: false, done: 0, total: 0, current: '',
  added: 0, existed: 0, failed: [], finishedAt: null, app: null,
};

function openParsed(dbFile) {
  let src;
  try { src = new Database(dbFile, { readonly: true, fileMustExist: true }); }
  catch (e) { throw new Error(`can't open database: ${e?.message || e}`); }
  try {
    const parsed = parseLibraryDb(src);
    if (!parsed) throw new Error('not a recognized Mylar3 or Kapowarr database');
    return parsed;
  } finally {
    try { src.close(); } catch { /* readonly handle */ }
  }
}

// The catalog cv_ids already in the collection, so the preview can mark them.
function existingCvIds() {
  const cat = new Database(config.dbPath, { readonly: true });
  try { return new Set(cat.prepare('SELECT cv_id FROM series WHERE cv_id IS NOT NULL').all().map((r) => r.cv_id)); }
  finally { cat.close(); }
}

function previewPayload(parsed) {
  const existing = existingCvIds();
  return {
    app: parsed.app,
    series: parsed.series.map((s) => ({ ...s, existing: existing.has(s.cvId) })),
  };
}

// Deps are injectable for tests (a temp catalog + a canned CV client).
export async function runImport(items, libraryId, { dbFile = config.dbPath, client = null } = {}) {
  const cat = new Database(dbFile);
  const cv = client || makeCvClient(config);
  Object.assign(state, { running: true, done: 0, total: items.length, current: '', added: 0, existed: 0, failed: [], finishedAt: null });
  try {
    for (const it of items) {
      state.current = it.title || `volume ${it.cvId}`;
      try {
        const r = await addSeriesFromCv(cat, cv, it.cvId);
        if (r.outcome === 'created') {
          state.added++;
          // Carry the source's monitored state; existing series keep theirs.
          if (it.monitored === false) setFollowed(cat, r.seriesId, false);
          if (libraryId) { try { assignSeriesLibrary(cat, r.seriesId, Number(libraryId)); } catch { /* library gone */ } }
        } else {
          state.existed++;
        }
      } catch (e) {
        state.failed.push({ cvId: it.cvId, title: it.title, error: String(e?.message || e) });
        // A ComicVine rate limit will fail everything after it too — stop and
        // let the user re-run later (the import is idempotent).
        if (e?.rateLimited) {
          logWarn(`Migration paused by the ComicVine rate limit after ${state.done} series — re-run to continue`, 'collection');
          break;
        }
      }
      state.done++;
    }
    logInfo(`Migration finished: ${state.added} added, ${state.existed} already present, ${state.failed.length} failed`, 'collection');
  } finally {
    state.running = false;
    state.current = '';
    state.finishedAt = Date.now();
    cat.close();
    fs.rm(uploadPath(), { force: true }, () => {});
  }
}

export default function register(api) {
  api.registerClientAsset({ js: 'client/ui.js', css: 'client/ui.css' });

  // Upload the source database as a raw body (express.json ignores
  // non-JSON content types, so the request streams straight through).
  api.registerRoute('post', '/api/migrate/upload', (req, res) => {
    const dest = uploadPath();
    const out = fs.createWriteStream(dest);
    let size = 0, aborted = false;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_UPLOAD_BYTES && !aborted) {
        aborted = true;
        out.destroy();
        fs.rm(dest, { force: true }, () => {});
        res.status(413).json({ error: 'file too large' });
        req.destroy();
      }
    });
    req.pipe(out);
    out.on('finish', () => {
      if (aborted) return;
      try { res.json(previewPayload(openParsed(dest))); }
      catch (e) { res.status(400).json({ error: String(e?.message || e) }); }
    });
    out.on('error', (e) => { if (!aborted) res.status(500).json({ error: String(e?.message || e) }); });
  }, { access: 'admin' });

  // Preview a database at a server-readable path (e.g. dropped into /data).
  api.registerRoute('post', '/api/migrate/preview', (req, res) => {
    const p = String(req.body?.path || '').trim();
    if (!p) return res.status(400).json({ error: 'a path is required' });
    try { res.json(previewPayload(openParsed(p))); }
    catch (e) { res.status(400).json({ error: String(e?.message || e) }); }
  }, { access: 'admin' });

  // Start the import: { series: [{ cvId, title?, monitored? }], libraryId? }.
  api.registerRoute('post', '/api/migrate/run', (req, res) => {
    if (state.running) return res.status(409).json({ error: 'a migration is already running' });
    const items = (Array.isArray(req.body?.series) ? req.body.series : [])
      .map((s) => ({ cvId: Number(s.cvId), title: s.title || '', monitored: s.monitored !== false }))
      .filter((s) => Number.isFinite(s.cvId) && s.cvId > 0);
    if (!items.length) return res.status(400).json({ error: 'no series selected' });
    runImport(items, req.body?.libraryId || null); // intentionally not awaited
    res.json({ started: true, total: items.length });
  }, { access: 'admin' });

  api.registerRoute('get', '/api/migrate/progress', (req, res) => res.json(state), { access: 'admin' });
}
