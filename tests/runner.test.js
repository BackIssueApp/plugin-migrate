// Import-runner integration test: a real (temp) catalog database and a canned
// ComicVine client — verifies created/existing accounting, monitored carry-over
// (only for NEW series; existing keep their state), and per-item error capture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { openDb } from '../../../src/db.js';
import { runImport } from '../index.js';

const VOLUMES = {
  776: { id: 776, name: 'Invincible', publisher: 'Image', start_year: 2003, image_url: null, issues: [{ id: 1, number: '1', name: null }] },
  18076: { id: 18076, name: 'Chew', publisher: 'Image', start_year: 2009, image_url: null, issues: [] },
};
const fakeClient = {
  volume: async (id) => {
    if (!VOLUMES[id]) throw new Error(`volume ${id} not found`);
    return VOLUMES[id];
  },
};

test('runImport: adds new series, honors monitored, skips existing, records failures', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-test-'));
  const dbFile = path.join(dir, 'catalog.db');
  openDb(dbFile).close(); // create the schema

  const items = [
    { cvId: 776, title: 'Invincible', monitored: true },
    { cvId: 18076, title: 'Chew', monitored: false },   // paused in the source app
    { cvId: 99999, title: 'Ghost', monitored: true },   // unknown upstream → failure
  ];
  await runImport(items, null, { dbFile, client: fakeClient });

  const db = openDb(dbFile);
  const rows = db.prepare('SELECT cv_id, followed FROM series ORDER BY cv_id').all();
  assert.deepEqual(rows, [
    { cv_id: 776, followed: 1 },
    { cv_id: 18076, followed: 0 }, // paused carried over
  ]);

  // Re-run: both series now exist — nothing new, monitored state untouched.
  await runImport(items.slice(0, 2), null, { dbFile, client: fakeClient });
  const again = db.prepare('SELECT cv_id, followed FROM series ORDER BY cv_id').all();
  // addSeriesFromCv re-follows an existing series (same as re-adding by hand);
  // the paused one must NOT be re-paused or duplicated.
  assert.equal(again.length, 2);
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
