import { SCHEMA_VERSION } from '../src/server/db.js';
import { DatabaseSync, backup } from 'node:sqlite';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { encrypt, decrypt, hashPassword } from '../src/server/security.js';
process.umask(0o077);
const directory = process.env.DATA_DIR || './data';
const filename = join(directory, 'selflib.sqlite');
if (!existsSync(filename))
  throw new Error('No existing database. Maintenance never initializes an install.');
if (existsSync(join(directory, 'server.lock')))
  throw new Error(
    'Service lock exists. Stop SelfLib before offline maintenance. If a crash left a stale lock, confirm all services using this volume are stopped before removing server.lock.',
  );
const db = new DatabaseSync(filename);
if (
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version !==
  SCHEMA_VERSION
) {
  db.close();
  throw new Error('Unsupported maintenance schema. Use the matching version.');
}
const command = process.argv[2];
if (command === 'rotate-key') {
  const keyPath = join(directory, 'secrets.key');
  const oldKey = readFileSync(keyPath);
  if (oldKey.length !== 32) throw new Error('Invalid key.');
  const nextKey = randomBytes(32);
  const snapshot = join(directory, 'rotation-backup-' + Date.now());
  mkdirSync(snapshot, { mode: 0o700 });
  await backup(db, join(snapshot, 'selflib.sqlite'));
  copyFileSync(keyPath, join(snapshot, 'secrets.key'));
  try {
    const sources = db.prepare('SELECT id,secret FROM sources').all() as {
      id: string;
      secret: string;
    }[];
    const next = sources.map((s) => ({
      id: s.id,
      secret: encrypt(decrypt(s.secret, oldKey), nextKey),
    }));
    writeFileSync(keyPath + '.next', nextKey, { mode: 0o600 });
    db.exec('BEGIN IMMEDIATE');
    for (const source of next)
      db.prepare('UPDATE sources SET secret=? WHERE id=?').run(source.secret, source.id);
    db.exec('COMMIT');
    db.close();
    renameSync(keyPath + '.next', keyPath);
    console.log(
      'Key rotated. Verify source connections before retiring the private rotation backup.',
    );
  } catch (error) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    for (const suffix of ['-wal', '-shm']) rmSync(filename + suffix, { force: true });
    copyFileSync(join(snapshot, 'selflib.sqlite'), filename);
    copyFileSync(join(snapshot, 'secrets.key'), keyPath);
    rmSync(keyPath + '.next', { force: true });
    throw error;
  }
} else if (command === 'reset-password') {
  const password = readFileSync(0, 'utf8').replace(/\r?\n$/, '');
  if (password.length < 12 || password.length > 128)
    throw new Error('Password must have 12–128 characters.');
  if (!db.prepare('SELECT id FROM owner').get())
    throw new Error('No owner exists. Complete setup first.');
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE owner SET password=? WHERE id=1').run(hashPassword(password));
  db.exec('DELETE FROM sessions; COMMIT;');
  db.close();
  console.log('Owner password changed; all sessions revoked.');
} else if (command === 'revoke-sessions') {
  db.exec('DELETE FROM sessions');
  db.close();
  console.log('All sessions revoked.');
} else {
  db.close();
  throw new Error('Usage: maintenance.js rotate-key | reset-password | revoke-sessions');
}
