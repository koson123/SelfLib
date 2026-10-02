import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';

export const SCHEMA_VERSION = 1;
export function openDatabase(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const filename = join(directory, 'selflib.sqlite');
  const db = new DatabaseSync(filename);
  chmodSync(filename, 0o600);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
  const version = Number(
    (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version,
  );
  if (version > SCHEMA_VERSION) {
    db.close();
    throw new Error(
      'Database is newer than this SelfLib version. Restore a matching backup or upgrade the application.',
    );
  }
  if (version === 0) {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE owner (id INTEGER PRIMARY KEY CHECK(id=1), username TEXT NOT NULL, password TEXT NOT NULL);
      CREATE TABLE sessions (hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE sources (id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT NOT NULL, url TEXT NOT NULL,
        public_url TEXT NOT NULL, secret TEXT NOT NULL, allow_private INTEGER NOT NULL,
        health TEXT NOT NULL DEFAULT 'untested', error TEXT, last_attempt TEXT, last_sync TEXT);
      CREATE TABLE items (id TEXT PRIMARY KEY, source_id TEXT NOT NULL, remote_id TEXT NOT NULL,
        section TEXT NOT NULL, title TEXT NOT NULL, creator TEXT NOT NULL, description TEXT NOT NULL,
        data TEXT NOT NULL, artwork BLOB, mime TEXT, demo INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_id, remote_id));
      CREATE VIRTUAL TABLE item_search USING fts5(id UNINDEXED, title, creator, description, series);
      CREATE TABLE favorites (item_id TEXT PRIMARY KEY REFERENCES items(id) ON DELETE CASCADE);
      CREATE TABLE collections (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
      CREATE TABLE collection_items (collection_id TEXT REFERENCES collections(id) ON DELETE CASCADE,
        item_id TEXT REFERENCES items(id) ON DELETE CASCADE, PRIMARY KEY(collection_id,item_id));
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO migrations VALUES (1, datetime('now'));
      PRAGMA user_version=1;
      COMMIT;`);
  }
  return db;
}
