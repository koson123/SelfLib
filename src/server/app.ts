import express, { type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase } from './db.js';
import {
  encryptionKey,
  encrypt,
  decrypt,
  hashPassword,
  verifyPassword,
  token,
  digest,
  validateBase,
  sourceTransport,
} from './security.js';
import { artworkBytes, mountArtwork, panoramaValid } from './artwork.js';
import { createAdapter } from './adapters.js';
import { demoItems } from './demo.js';
import { categoryKinds, shelfCategories } from '../shared.js';
import type { CatalogItem, ItemView, SourceConfig, SourceType } from '../shared.js';

type Row = Record<string, string | number | null | Uint8Array>;
export interface AppOptions {
  dataDir: string;
  appUrl: string;
  staticDir?: string;
  allowLoopback?: boolean;
  maxItems?: number;
  cacheBytes?: number;
}
const accountSchema = z.object({
  username: z
    .string()
    .trim()
    .min(3)
    .max(64)
    .regex(/^[\w.-]+$/),
  password: z.string().min(12).max(128),
  setupToken: z.string().optional(),
});
const connectionSchema = z.object({
  type: z.enum(['audiobookshelf', 'komga', 'jellyfin']),
  name: z.string().trim().min(1).max(80),
  url: z.string().max(2048),
  publicUrl: z.string().max(2048).optional(),
  credential: z
    .string()
    .max(4096)
    .refine((s) => !/[\r\n]/.test(s))
    .default(''),
  jellyfinUsername: z.string().min(1).max(128).optional(),
  jellyfinPassword: z.string().min(1).max(256).optional(),
  allowPrivate: z.boolean().default(false),
  libraryRooms: z
    .record(z.string().regex(/^[\w-]{1,200}$/), z.enum(['comics', 'manga', 'graphicnovels']))
    .refine((value) => Object.keys(value).length <= 100)
    .default({}),
});
const collectionSchema = z.object({ name: z.string().trim().min(1).max(80) });
const safeId = z.string().regex(/^[\w-]{1,200}$/);
const now = () => new Date().toISOString();
const errorMessage = (error: unknown) =>
  error instanceof z.ZodError
    ? 'Source API response does not match the supported contract. See integration documentation.'
    : error instanceof Error
      ? error.message
      : 'Operation failed.';

export function createApplication(options: AppOptions) {
  const appUrl = new URL(validateBase(options.appUrl));
  if (appUrl.pathname !== '/')
    throw new Error('SelfLib subpath installation is unsupported. Use a dedicated hostname.');
  const secure = appUrl.protocol === 'https:';
  const db = openDatabase(options.dataDir);
  if (
    !existsSync(join(options.dataDir, 'secrets.key')) &&
    db.prepare('SELECT id FROM sources LIMIT 1').get()
  ) {
    db.close();
    throw new Error('Missing secrets.key. Restore the key paired with this database backup.');
  }
  db.prepare(
    "UPDATE sources SET health='interrupted',error='Previous sync was interrupted. Cached catalog is retained; synchronize manually.' WHERE health='syncing'",
  ).run();
  const key = encryptionKey(options.dataDir);
  if (db.prepare('SELECT id FROM owner').get()) seedDemo(db);
  const lockPath = join(options.dataDir, 'server.lock');
  writeFileSync(lockPath, String(process.pid), { mode: 0o600 });
  const setupPath = join(options.dataDir, 'setup.token');
  if (!db.prepare('SELECT id FROM owner').get() && !existsSync(setupPath))
    writeFileSync(setupPath, token(), { mode: 0o600, flag: 'wx' });
  const app = express();
  app.disable('x-powered-by');
  const jobs = new Map<string, Promise<void>>();
  const attempts = new Map<string, { count: number; until: number }>();
  let closing = false;
  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    if (secure) res.set('Strict-Transport-Security', 'max-age=31536000');
    if (closing) {
      res.status(503).json({ error: 'SelfLib is shutting down.' });
      return;
    }
    next();
  });
  app.use(
    '/api/items/:id/custom-artwork/:role',
    express.json({ limit: '720kb', type: 'application/json' }),
  );
  app.use(
    '/api/collections/:id/panorama',
    express.json({ limit: '720kb', type: 'application/json' }),
  );
  app.use(express.json({ limit: '32kb', type: 'application/json' }));
  function cookie(req: Request, name: string) {
    const raw = req.headers.cookie
      ?.split(';')
      .map((s) => s.trim())
      .find((s) => s.startsWith(name + '='))
      ?.slice(name.length + 1);
    return raw && /^[A-Za-z0-9_-]{20,100}$/.test(raw) ? raw : undefined;
  }
  function session(req: Request) {
    const value = cookie(req, 'selflib_session');
    return value
      ? (db
          .prepare('SELECT * FROM sessions WHERE hash=? AND expires>?')
          .get(digest(value), Date.now()) as Row | undefined)
      : undefined;
  }
  function setCookie(res: Response, name: string, value: string, maxAge: number) {
    res.cookie(name, value, { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge });
  }
  function loggedIn(req: Request, res: Response, next: NextFunction) {
    if (!session(req)) {
      res.status(401).json({ error: 'Sign in to access your library.' });
      return;
    }
    next();
  }
  app.get('/healthz', (_req, res) => {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok', version: '0.1.0' });
  });
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method)) {
      if (req.get('Origin') !== appUrl.origin) {
        res
          .status(403)
          .json({ error: 'Request origin rejected. Set APP_URL to the URL used in your browser.' });
        return;
      }
      const expected = session(req)?.csrf || cookie(req, 'selflib_pre');
      if (!expected || req.get('X-CSRF-Token') !== expected) {
        res.status(403).json({ error: 'Security token expired. Reload the page.' });
        return;
      }
      if (!req.is('application/json')) {
        res.status(415).json({ error: 'JSON requests are required.' });
        return;
      }
    }
    next();
  });
  app.get('/api/status', (req, res) => {
    db.prepare('DELETE FROM sessions WHERE expires<=?').run(Date.now());
    const current = session(req);
    let csrf = current?.csrf;
    if (!csrf) {
      csrf = token();
      setCookie(res, 'selflib_pre', String(csrf), 60 * 60 * 1000);
    }
    res.json({
      setupRequired: !db.prepare('SELECT id FROM owner').get(),
      authenticated: !!current,
      csrf,
      username: current
        ? (db.prepare('SELECT username FROM owner').get() as Row)?.username
        : undefined,
      version: '0.1.0',
    });
  });
  function throttle(req: Request, res: Response) {
    const stamp = Date.now();
    for (const [id, entry] of attempts) if (entry.until < stamp) attempts.delete(id);
    if (attempts.size > 1000) {
      res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
      return true;
    }
    const id = req.socket.remoteAddress || 'unknown';
    const entry = attempts.get(id) || { count: 0, until: stamp + 15 * 60 * 1000 };
    entry.count++;
    attempts.set(id, entry);
    if (entry.count > 8) {
      res
        .set('Retry-After', '900')
        .status(429)
        .json({ error: 'Too many login attempts. Try again in 15 minutes.' });
      return true;
    }
    return false;
  }
  function newSession(res: Response) {
    const value = token();
    const csrf = token();
    const expires = Date.now() + 24 * 60 * 60 * 1000;
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(digest(value), csrf, expires);
    setCookie(res, 'selflib_session', value, 24 * 60 * 60 * 1000);
    res.clearCookie('selflib_pre', { path: '/' });
    return csrf;
  }
  app.post('/api/setup', (req, res) => {
    if (db.prepare('SELECT id FROM owner').get()) {
      res.status(409).json({ error: 'Owner already exists. Sign in.' });
      return;
    }
    if (throttle(req, res)) return;
    const account = accountSchema.parse(req.body);
    if (digest(account.setupToken || '') !== digest(readFileSync(setupPath, 'utf8'))) {
      res
        .status(403)
        .json({ error: 'Setup token is incorrect. Read /data/setup.token from the container.' });
      return;
    }
    db.prepare('INSERT INTO owner VALUES (1,?,?)').run(
      account.username,
      hashPassword(account.password),
    );
    seedDemo(db);
    unlinkSync(setupPath);
    res.status(201).json({ csrf: newSession(res) });
  });
  app.post('/api/login', (req, res) => {
    if (throttle(req, res)) return;
    const account = accountSchema.parse(req.body);
    const owner = db.prepare('SELECT * FROM owner').get() as Row | undefined;
    const stored = (owner?.password as string) || hashPassword('unused-dummy-password');
    if (!verifyPassword(account.password, stored) || account.username !== owner?.username) {
      res.status(401).json({ error: 'Username or password is incorrect.' });
      return;
    }
    attempts.delete(req.socket.remoteAddress || 'unknown');
    res.json({ csrf: newSession(res) });
  });
  app.post('/api/logout', loggedIn, (req, res) => {
    db.prepare('DELETE FROM sessions WHERE hash=?').run(digest(cookie(req, 'selflib_session')!));
    res.clearCookie('selflib_session', { path: '/', secure, sameSite: 'strict', httpOnly: true });
    res.json({ ok: true });
  });
  app.get('/api/demo', (_req, res) => {
    res.json({
      items: demoItems.map((item, i) => ({
        ...withoutArtwork(item),
        id: `demo-${i}`,
        favorite: false,
        artwork: false,
        demo: true,
        sourceName: 'Fictional demonstration',
      })),
      total: demoItems.length,
    });
  });
  app.use('/api', (req, res, next) => {
    if (['/status', '/demo'].includes(req.path)) return next();
    return loggedIn(req, res, next);
  });

  function sourceFrom(row: Row): SourceConfig {
    return {
      id: String(row.id),
      type: row.type as SourceType,
      name: String(row.name),
      url: String(row.url),
      publicUrl: String(row.public_url),
      credential: decrypt(String(row.secret), key),
      allowPrivate: !!row.allow_private,
      libraryRooms: JSON.parse(String(row.library_rooms || '{}')),
    };
  }
  function getSource(id: string) {
    const row = db.prepare('SELECT * FROM sources WHERE id=?').get(id) as Row | undefined;
    if (!row) throw Object.assign(new Error('Source not found.'), { status: 404 });
    return sourceFrom(row);
  }
  async function inputSource(body: unknown, id: string = randomUUID()): Promise<SourceConfig> {
    const input = connectionSchema.parse(body);
    const source: SourceConfig = {
      id,
      type: input.type,
      name: input.name,
      allowPrivate: input.allowPrivate,
      credential: input.credential,
      libraryRooms: input.libraryRooms,
      url: validateBase(input.url),
      publicUrl: validateBase(input.publicUrl || input.url),
    };
    if (input.jellyfinPassword || input.jellyfinUsername) {
      if (source.type !== 'jellyfin' || !input.jellyfinPassword || !input.jellyfinUsername)
        throw Object.assign(
          new Error('Jellyfin sign-in requires both viewer username and password.'),
          { status: 400 },
        );
      const result = z
        .object({
          AccessToken: z
            .string()
            .min(1)
            .max(4096)
            .regex(/^[^\r\n]+$/),
        })
        .parse(
          await sourceTransport(
            { ...source, credential: '' },
            {
              Authorization:
                'MediaBrowser Client="SelfLib", Device="SelfLib server", DeviceId="selflib-' +
                id +
                '", Version="0.1.0"',
            },
            options.allowLoopback,
          ).json('/Users/AuthenticateByName', {
            method: 'POST',
            body: { Username: input.jellyfinUsername, Pw: input.jellyfinPassword },
          }),
        );
      source.credential = result.AccessToken;
    }
    if (!source.credential)
      throw Object.assign(
        new Error('Enter an API key/user token, or sign in with a Jellyfin viewer account.'),
        { status: 400 },
      );
    return source;
  }
  app.get('/api/sources', (_req, res) => {
    res.json({
      sources: (
        db
          .prepare(
            'SELECT id,type,name,url,public_url,allow_private,health,error,last_attempt,last_sync,library_rooms FROM sources',
          )
          .all() as Row[]
      ).map((row) => ({
        ...row,
        syncing: jobs.has(String(row.id)),
        credentialStored: true,
        libraryRooms: JSON.parse(String(row.library_rooms)),
      })),
    });
  });
  app.post('/api/sources/test', async (req, res) => {
    try {
      const source = await inputSource(req.body);
      const result = await createAdapter(source, { allowLoopback: options.allowLoopback }).health();
      res.json({ ok: true, ...result });
    } catch (error) {
      res.status(502).json({ error: errorMessage(error) });
    }
  });
  app.post('/api/sources', async (req, res) => {
    if (Number((db.prepare('SELECT count(*) AS n FROM sources').get() as Row).n) >= 10) {
      res.status(409).json({ error: 'This milestone supports up to 10 connections.' });
      return;
    }
    const s = await inputSource(req.body);
    db.prepare(
      'INSERT INTO sources (id,type,name,url,public_url,secret,allow_private,library_rooms) VALUES (?,?,?,?,?,?,?,?)',
    ).run(
      s.id,
      s.type,
      s.name,
      s.url,
      s.publicUrl,
      encrypt(s.credential, key),
      s.allowPrivate ? 1 : 0,
      JSON.stringify(s.libraryRooms || {}),
    );
    res.status(201).json({ id: s.id });
  });
  app.put('/api/sources/:id', async (req, res) => {
    const old = getSource(String(req.params.id));
    if (jobs.has(old.id)) {
      res.status(409).json({ error: 'Wait for synchronization to finish.' });
      return;
    }
    const s = await inputSource(
      {
        ...req.body,
        credential: req.body.credential || old.credential,
        libraryRooms: req.body.libraryRooms ?? old.libraryRooms,
      },
      old.id,
    );
    db.prepare(
      'UPDATE sources SET type=?,name=?,url=?,public_url=?,secret=?,allow_private=?,library_rooms=?,health=?,error=NULL WHERE id=?',
    ).run(
      s.type,
      s.name,
      s.url,
      s.publicUrl,
      encrypt(s.credential, key),
      s.allowPrivate ? 1 : 0,
      JSON.stringify(s.libraryRooms || {}),
      'untested',
      s.id,
    );
    res.json({ ok: true });
  });
  app.post('/api/sources/:id/clear-artwork', (req, res) => {
    const source = getSource(String(req.params.id));
    if (jobs.has(source.id)) {
      res.status(409).json({ error: 'Wait for synchronization to finish.' });
      return;
    }
    db.prepare('UPDATE items SET artwork=NULL,mime=NULL WHERE source_id=?').run(source.id);
    res.json({ ok: true });
  });
  app.get('/api/sources/:id/libraries', async (req, res) => {
    const source = getSource(String(req.params.id));
    if (source.type !== 'komga') {
      res.status(400).json({ error: 'Library mapping is available for Komga.' });
      return;
    }
    const libraries = z
      .array(z.object({ id: safeId, name: z.string().max(500) }))
      .max(1000)
      .parse(
        await sourceTransport(
          source,
          { 'X-API-Key': source.credential },
          options.allowLoopback,
        ).json('/api/v1/libraries'),
      );
    res.json({ libraries });
  });
  app.post('/api/sources/:id/test', async (req, res) => {
    const s = getSource(String(req.params.id));
    try {
      const result = await createAdapter(s, { allowLoopback: options.allowLoopback }).health();
      db.prepare('UPDATE sources SET health=?,error=NULL WHERE id=?').run('reachable', s.id);
      res.json({ ok: true, ...result });
    } catch (error) {
      db.prepare('UPDATE sources SET health=?,error=? WHERE id=?').run(
        'unreachable',
        errorMessage(error),
        s.id,
      );
      res.status(502).json({ error: errorMessage(error) });
    }
  });
  app.delete('/api/sources/:id', (req, res) => {
    const s = getSource(String(req.params.id));
    if (jobs.has(s.id)) {
      res.status(409).json({ error: 'Wait for synchronization to finish.' });
      return;
    }
    db.exec('BEGIN');
    try {
      db.prepare(
        'DELETE FROM item_search WHERE id IN (SELECT id FROM items WHERE source_id=?)',
      ).run(s.id);
      db.prepare('DELETE FROM items WHERE source_id=?').run(s.id);
      db.prepare('DELETE FROM sources WHERE id=?').run(s.id);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    res.json({ ok: true });
  });

  async function synchronize(source: SourceConfig) {
    db.prepare('UPDATE sources SET last_attempt=?,health=?,error=NULL WHERE id=?').run(
      now(),
      'syncing',
      source.id,
    );
    const adapter = createAdapter(source, { allowLoopback: options.allowLoopback });
    try {
      await adapter.health();
      const items: CatalogItem[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      const deadline = Date.now() + 120000;
      do {
        if (closing || Date.now() > deadline)
          throw new Error(
            'Synchronization interrupted or exceeded two minutes. Cached catalog was retained.',
          );
        const label = cursor || 'initial';
        if (cursors.has(label))
          throw new Error('Source pagination repeated a cursor. Cached catalog was retained.');
        cursors.add(label);
        let page;
        try {
          page = await adapter.page(cursor);
        } catch (error) {
          if (!/could not be reached|HTTP 5/.test(errorMessage(error))) throw error;
          await new Promise((r) => setTimeout(r, 200));
          page = await adapter.page(cursor);
        }
        items.push(...page.items);
        if (items.length > (options.maxItems || 10000) || cursors.size > 100)
          throw new Error(
            'Source exceeds the 10,000-item/100-page milestone limit. Cached catalog was retained.',
          );
        cursor = page.nextCursor;
      } while (cursor);
      const unique = new Set(items.map((i) => i.sourceItemId));
      if (unique.size !== items.length)
        throw new Error('Source returned duplicate item identities. Cached catalog was retained.');
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const item of items) saveItem(db, item);
        const existing = db
          .prepare('SELECT id,remote_id FROM items WHERE source_id=?')
          .all(source.id) as Row[];
        for (const row of existing)
          if (!unique.has(String(row.remote_id))) {
            db.prepare('DELETE FROM item_search WHERE id=?').run(row.id);
            db.prepare('DELETE FROM items WHERE id=?').run(row.id);
          }
        db.prepare('UPDATE sources SET health=?,error=NULL,last_sync=? WHERE id=?').run(
          'ready',
          now(),
          source.id,
        );
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
      // Cache artwork after atomic catalog commit. Artwork failures do not discard a good catalog.
      const warnings = new Map<string, number>();
      let count = 0;
      for (const item of items) {
        if (closing || Date.now() > deadline) break;
        const id = itemIdentity(item);
        const cached = db.prepare('SELECT artwork FROM items WHERE id=?').get(id) as Row;
        if (cached.artwork || !item.artworkPath) continue;
        if (++count > 200) break;
        const used = artworkBytes(db);
        if (used >= (options.cacheBytes || 64 * 1024 * 1024)) break;
        try {
          const image = await adapter.artwork(item);
          if (image && used + image.bytes.length <= (options.cacheBytes || 64 * 1024 * 1024))
            db.prepare('UPDATE items SET artwork=?,mime=? WHERE id=?').run(
              image.bytes,
              image.mime,
              id,
            );
        } catch (error) {
          const reason = errorMessage(error);
          warnings.set(reason, (warnings.get(reason) || 0) + 1);
        }
      }
      if (warnings.size)
        db.prepare('UPDATE sources SET error=? WHERE id=?').run(
          `Catalog is available; generated covers are used where artwork failed. ${[...warnings]
            .slice(0, 4)
            .map(([reason, count]) => `${count} × ${reason}`)
            .join(' ')}`,
          source.id,
        );
      console.info(
        JSON.stringify({ event: 'sync_complete', sourceId: source.id, items: items.length }),
      );
    } catch (error) {
      db.prepare('UPDATE sources SET health=?,error=? WHERE id=?').run(
        'unreachable',
        errorMessage(error),
        source.id,
      );
      console.info(JSON.stringify({ event: 'sync_failed', sourceId: source.id }));
    }
  }
  app.post('/api/sources/:id/sync', (req, res) => {
    const s = getSource(String(req.params.id));
    if (jobs.has(s.id)) {
      res.status(409).json({ error: 'This source is already synchronizing.' });
      return;
    }
    if (jobs.size) {
      res
        .status(409)
        .json({ error: 'Another source is synchronizing. Try again when it finishes.' });
      return;
    }
    const job = synchronize(s).finally(() => jobs.delete(s.id));
    jobs.set(s.id, job);
    res.status(202).json({ ok: true });
  });
  function view(row: Row): ItemView {
    const item = JSON.parse(String(row.data)) as CatalogItem;
    return {
      ...withoutArtwork(item),
      id: String(row.id),
      favorite: !!row.favorite,
      artwork:
        !!row.artwork ||
        !!db
          .prepare("SELECT 1 FROM item_artwork WHERE item_id=? AND role='cover'")
          .get(String(row.id)),
      customCover: !!db
        .prepare("SELECT 1 FROM item_artwork WHERE item_id=? AND role='cover'")
        .get(String(row.id)),
      customSpine: !!db
        .prepare("SELECT 1 FROM item_artwork WHERE item_id=? AND role='spine'")
        .get(String(row.id)),
      demo: !!row.demo,
      sourceName: String(row.source_name || 'Fictional demonstration'),
    };
  }
  app.get('/api/items', (req, res) => {
    const limit = z.coerce.number().int().min(1).max(100).default(60).parse(req.query.limit);
    const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    const mode = req.query.demo === 'true' ? 1 : 0;
    const where = ['i.demo=?'];
    const params: (string | number)[] = [mode];
    const query = z.string().max(200).optional().parse(req.query.q);
    if (query?.trim()) {
      const words = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 12) || [];
      if (words.length) {
        where.push('i.id IN (SELECT id FROM item_search WHERE item_search MATCH ?)');
        params.push(words.map((w) => `"${w}"*`).join(' AND '));
      } else where.push('0');
    }
    if (req.query.section) {
      where.push('i.section=?');
      params.push(z.enum(['books', 'comics', 'movies']).parse(req.query.section));
    }
    if (req.query.category) {
      const category = z.enum(shelfCategories).parse(req.query.category);
      const kinds = categoryKinds[category];
      where.push(`json_extract(i.data,'$.kind') IN (${kinds.map(() => '?').join(',')})`);
      params.push(...kinds);
    }
    if (req.query.favorite === 'true') where.push('f.item_id IS NOT NULL');
    if (req.query.collection) {
      where.push('i.id IN (SELECT item_id FROM collection_items WHERE collection_id=?)');
      params.push(safeId.parse(req.query.collection));
    }
    if (req.query.continue === 'true')
      where.push(
        "json_extract(i.data,'$.progress.fraction')>0 AND json_extract(i.data,'$.progress.fraction')<1",
      );
    const sql = `FROM items i LEFT JOIN sources s ON s.id=i.source_id LEFT JOIN favorites f ON f.item_id=i.id WHERE ${where.join(' AND ')}`;
    const total = (db.prepare(`SELECT count(*) AS n ${sql}`).get(...params) as Row).n;
    const order = req.query.collection
      ? '(SELECT rowid FROM collection_items WHERE collection_id=? AND item_id=i.id)'
      : 'i.title COLLATE NOCASE,i.id';
    const orderParams = req.query.collection ? [safeId.parse(req.query.collection)] : [];
    const rows = db
      .prepare(
        `SELECT i.*,s.name AS source_name,f.item_id AS favorite ${sql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, ...orderParams, limit, offset) as Row[];
    res.json({ items: rows.map(view), total, offset, limit });
  });
  mountArtwork(app, db, options.cacheBytes || 64 * 1024 * 1024);
  app.get('/api/items/:id/artwork', (req, res) => {
    const custom = db
      .prepare("SELECT bytes AS artwork,mime FROM item_artwork WHERE item_id=? AND role='cover'")
      .get(String(req.params.id)) as Row | undefined;
    const row =
      custom ||
      (db.prepare('SELECT artwork,mime FROM items WHERE id=?').get(String(req.params.id)) as
        Row | undefined);
    if (!row?.artwork) {
      res.status(404).json({ error: 'Artwork not cached.' });
      return;
    }
    res
      .set('Cache-Control', 'private, no-store')
      .type(String(row.mime))
      .send(Buffer.from(row.artwork as Uint8Array));
  });
  app.get('/api/items/:id/open', (req, res) => {
    const row = db.prepare('SELECT data,demo FROM items WHERE id=?').get(String(req.params.id)) as
      Row | undefined;
    if (!row) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    if (row.demo) {
      res.status(409).json({ error: 'Demo items are fictional and cannot be opened.' });
      return;
    }
    const item = JSON.parse(String(row.data)) as CatalogItem;
    const source = getSource(item.sourceId);
    const url = createAdapter(source).handoff(item);
    if (!url.startsWith(validateBase(source.publicUrl) + '/'))
      throw new Error('Unsafe handoff blocked.');
    res.json({ url });
  });
  app.put('/api/items/:id/favorite', (req, res) => {
    const id = String(req.params.id);
    if (!db.prepare('SELECT id FROM items WHERE id=?').get(id)) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    const value = z.object({ favorite: z.boolean() }).parse(req.body);
    if (value.favorite) db.prepare('INSERT OR IGNORE INTO favorites VALUES (?)').run(id);
    else db.prepare('DELETE FROM favorites WHERE item_id=?').run(id);
    res.json({ ok: true });
  });
  app.get('/api/collections', (_req, res) =>
    res.json({
      collections: db
        .prepare(
          'SELECT c.*,count(ci.item_id) AS count,EXISTS(SELECT 1 FROM collection_artwork a WHERE a.collection_id=c.id) AS panorama FROM collections c LEFT JOIN collection_items ci ON ci.collection_id=c.id GROUP BY c.id ORDER BY c.name',
        )
        .all()
        .map((row) => ({ ...row, panorama: !!row.panorama && panoramaValid(db, String(row.id)) })),
    }),
  );
  app.post('/api/collections', (req, res) => {
    const { name } = collectionSchema.parse(req.body);
    const id = randomUUID();
    db.prepare('INSERT INTO collections VALUES (?,?)').run(id, name);
    res.status(201).json({ id, name });
  });
  app.delete('/api/collections/:id', (req, res) => {
    db.prepare('DELETE FROM collections WHERE id=?').run(String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/items/:id/collections', (req, res) =>
    res.json({
      ids: (
        db
          .prepare('SELECT collection_id FROM collection_items WHERE item_id=?')
          .all(String(req.params.id)) as Row[]
      ).map((r) => r.collection_id),
    }),
  );
  app.put('/api/collections/:id/items/:item', (req, res) => {
    const value = z.object({ included: z.boolean() }).parse(req.body);
    if (value.included)
      db.prepare('INSERT OR IGNORE INTO collection_items VALUES (?,?)').run(
        String(req.params.id),
        String(req.params.item),
      );
    else
      db.prepare('DELETE FROM collection_items WHERE collection_id=? AND item_id=?').run(
        String(req.params.id),
        String(req.params.item),
      );
    res.json({ ok: true });
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API route not found.' }));
  if (options.staticDir)
    app.use(
      express.static(resolve(options.staticDir), {
        index: 'index.html',
        dotfiles: 'deny',
        maxAge: 0,
      }),
    );
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res
        .status(400)
        .json({ error: 'Invalid input. Check field lengths, URL, password, and required fields.' });
      return;
    }
    const status =
      typeof error === 'object' && error && 'status' in error ? Number(error.status) : 500;
    if (error instanceof Error && /^(Source |Authentication |Endpoint )/.test(error.message)) {
      res.status(502).json({ error: error.message });
      return;
    }
    if (
      error instanceof Error &&
      /^(Jellyfin sign-in requires|Enter an API key\/user token|Upload a PNG|Artwork cache is full)/.test(
        error.message,
      )
    ) {
      res.status(status >= 400 && status < 500 ? status : 400).json({ error: error.message });
      return;
    }
    if (status >= 400 && status < 500) {
      res.status(status).json({ error: status === 404 ? 'Not found.' : 'Request rejected.' });
      return;
    }
    if (error instanceof Error && /^Server URL|^Enter a complete/.test(error.message)) {
      res.status(400).json({ error: error.message });
      return;
    }
    console.info(JSON.stringify({ event: 'request_failed' }));
    res
      .status(500)
      .json({ error: 'Operation failed. Check input or consult the troubleshooting guide.' });
  });
  return {
    app,
    db,
    async close() {
      closing = true;
      await Promise.allSettled([...jobs.values()]);
      db.close();
      if (existsSync(lockPath)) unlinkSync(lockPath);
    },
  };
}
function withoutArtwork(item: CatalogItem) {
  const { artworkPath: _, artworkFallbackPath: _fallback, ...safe } = item;
  return safe;
}
export function itemIdentity(item: CatalogItem) {
  return digest(`${item.sourceId}:${item.sourceItemId}`);
}
function saveItem(db: DatabaseSync, item: CatalogItem, demo = false) {
  const id = demo ? item.sourceItemId : itemIdentity(item);
  db.prepare(
    `INSERT INTO items (id,source_id,remote_id,section,title,creator,description,data,demo) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET section=excluded.section,title=excluded.title,creator=excluded.creator,description=excluded.description,artwork=CASE WHEN json_extract(items.data,'$.artworkPath') IS NOT json_extract(excluded.data,'$.artworkPath') THEN NULL ELSE items.artwork END,mime=CASE WHEN json_extract(items.data,'$.artworkPath') IS NOT json_extract(excluded.data,'$.artworkPath') THEN NULL ELSE items.mime END,data=excluded.data`,
  ).run(
    id,
    item.sourceId,
    item.sourceItemId,
    item.section,
    item.title,
    item.creator,
    item.description,
    JSON.stringify(item),
    demo ? 1 : 0,
  );
  db.prepare('DELETE FROM item_search WHERE id=?').run(id);
  db.prepare('INSERT INTO item_search VALUES (?,?,?,?,?)').run(
    id,
    item.title,
    item.creator,
    item.description,
    item.series || '',
  );
}
function seedDemo(db: DatabaseSync) {
  db.exec('BEGIN');
  try {
    for (const item of demoItems) saveItem(db, item, true);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
