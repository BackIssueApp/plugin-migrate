// Parser tests against in-memory fixture databases shaped like each app's real
// schema (the columns we read, at least).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { detectApp, parseLibraryDb } from '../parsers.js';

function mylarDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE comics (ComicID TEXT, ComicName TEXT, ComicYear TEXT, ComicLocation TEXT, Status TEXT);
    INSERT INTO comics VALUES ('101823','Saga','2012','/comics/Saga (2012)','Active');
    INSERT INTO comics VALUES ('49191','The Walking Dead','2003','/comics/TWD','Paused');
    INSERT INTO comics VALUES ('','Broken Row','','',NULL);
    INSERT INTO comics VALUES ('101823','Saga','2012','/comics/Saga dupe','Paused');`);
  return db;
}

function kapowarrDb() {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE volumes (id INTEGER, comicvine_id INTEGER, title TEXT, year INTEGER, folder TEXT, monitored INTEGER);
    INSERT INTO volumes VALUES (1, 776, 'Invincible', 2003, '/comics/Invincible', 1);
    INSERT INTO volumes VALUES (2, 18076, 'Chew', 2009, '/comics/Chew', 0);
    INSERT INTO volumes VALUES (3, NULL, 'Unmatched', NULL, NULL, 1);`);
  return db;
}

test('detectApp distinguishes the two schemas (and rejects others)', () => {
  assert.equal(detectApp(mylarDb()), 'mylar');
  assert.equal(detectApp(kapowarrDb()), 'kapowarr');
  const other = new Database(':memory:');
  other.exec('CREATE TABLE stuff (x)');
  assert.equal(detectApp(other), null);
  assert.equal(parseLibraryDb(other), null);
});

test('parseLibraryDb(mylar): CV ids, monitored from Status, dupes collapse (monitored wins), broken rows dropped', () => {
  const { app, series } = parseLibraryDb(mylarDb());
  assert.equal(app, 'mylar');
  assert.deepEqual(series, [
    { cvId: 101823, title: 'Saga', year: 2012, monitored: true, folder: '/comics/Saga (2012)' },
    { cvId: 49191, title: 'The Walking Dead', year: 2003, monitored: false, folder: '/comics/TWD' },
  ]);
});

test('parseLibraryDb(kapowarr): monitored flag carries, null cv ids dropped', () => {
  const { app, series } = parseLibraryDb(kapowarrDb());
  assert.equal(app, 'kapowarr');
  assert.deepEqual(series, [
    { cvId: 18076, title: 'Chew', year: 2009, monitored: false, folder: '/comics/Chew' },
    { cvId: 776, title: 'Invincible', year: 2003, monitored: true, folder: '/comics/Invincible' },
  ]);
});
