import type { Express } from 'express';
import type { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { categoryKinds } from '../shared.js';

export function artworkBytes(db: DatabaseSync): number {
  return Number(
    (
      db
        .prepare(
          `SELECT (SELECT coalesce(sum(length(artwork)),0) FROM items)
    + (SELECT coalesce(sum(length(bytes)),0) FROM item_artwork)
    + (SELECT coalesce(sum(length(bytes)),0) FROM collection_artwork) AS n`,
        )
        .get() as { n: number }
    ).n,
  );
}
const imageSchema = z.object({
  mime: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z
    .string()
    .min(16)
    .max(699052)
    .regex(/^[A-Za-z0-9+/]+={0,2}$/),
});
function decodeImage(body: unknown) {
  const input = imageSchema.parse(body);
  const bytes = Buffer.from(input.base64, 'base64');
  const matches =
    input.mime === 'image/png'
      ? bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
      : input.mime === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!matches || bytes.length > 512 * 1024 || bytes.toString('base64') !== input.base64)
    throw Object.assign(new Error('Upload a PNG, JPEG or WebP image of at most 512 KiB.'), {
      status: 400,
    });
  return { bytes, mime: input.mime };
}
function panoramaItems(db: DatabaseSync, id: string) {
  return db
    .prepare(
      `SELECT i.id,i.demo,json_extract(i.data,'$.kind') AS kind FROM collection_items c
    JOIN items i ON c.item_id=i.id WHERE c.collection_id=? ORDER BY c.rowid`,
    )
    .all(id) as { id: string; demo: number; kind: string }[];
}
export function panoramaValid(db: DatabaseSync, id: string) {
  const rows = panoramaItems(db, id);
  const rooms = new Set(
    rows.map(
      (item) =>
        Object.entries(categoryKinds).find(([, kinds]) =>
          (kinds as string[]).includes(item.kind),
        )?.[0],
    ),
  );
  return (
    rows.length >= 2 &&
    rows.length <= 18 &&
    rooms.size === 1 &&
    new Set(rows.map((item) => item.demo)).size === 1
  );
}
/** Mounted after owner authentication and CSRF checks; uploads never accept URLs/paths/SVG. */
export function mountArtwork(app: Express, db: DatabaseSync, budget: number) {
  const fits = (bytes: Buffer, previous: number) => {
    if (artworkBytes(db) - previous + bytes.length > budget)
      throw Object.assign(
        new Error(
          'Artwork cache is full. Remove custom artwork or clear cached source covers to free space.',
        ),
        { status: 409 },
      );
  };
  app.put('/api/items/:id/custom-artwork/:role', (req, res) => {
    const role = z.enum(['cover', 'spine']).parse(req.params.role);
    const id = String(req.params.id);
    if (!db.prepare('SELECT id FROM items WHERE id=?').get(id)) {
      res.status(404).json({ error: 'Item not found.' });
      return;
    }
    const image = decodeImage(req.body);
    const previous = db
      .prepare('SELECT length(bytes) AS n FROM item_artwork WHERE item_id=? AND role=?')
      .get(id, role) as { n: number } | undefined;
    fits(image.bytes, previous?.n || 0);
    db.prepare(
      'INSERT INTO item_artwork VALUES (?,?,?,?) ON CONFLICT(item_id,role) DO UPDATE SET bytes=excluded.bytes,mime=excluded.mime',
    ).run(id, role, image.bytes, image.mime);
    res.json({ ok: true });
  });
  app.delete('/api/items/:id/custom-artwork/:role', (req, res) => {
    const role = z.enum(['cover', 'spine']).parse(req.params.role);
    db.prepare('DELETE FROM item_artwork WHERE item_id=? AND role=?').run(
      String(req.params.id),
      role,
    );
    res.json({ ok: true });
  });
  app.get('/api/items/:id/custom-artwork/:role', (req, res) => {
    const role = z.enum(['cover', 'spine']).parse(req.params.role);
    const row = db
      .prepare('SELECT bytes,mime FROM item_artwork WHERE item_id=? AND role=?')
      .get(String(req.params.id), role) as { bytes: Uint8Array; mime: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Custom artwork not found.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store').type(row.mime).send(Buffer.from(row.bytes));
  });
  app.put('/api/collections/:id/panorama', (req, res) => {
    const id = String(req.params.id);
    if (!panoramaValid(db, id)) {
      res.status(409).json({
        error:
          'A panorama needs 2–18 items from one room and one demo/live mode. Add them in box-set order.',
      });
      return;
    }
    const image = decodeImage(req.body);
    const previous = db
      .prepare('SELECT length(bytes) AS n FROM collection_artwork WHERE collection_id=?')
      .get(id) as { n: number } | undefined;
    fits(image.bytes, previous?.n || 0);
    db.prepare(
      'INSERT INTO collection_artwork VALUES (?,?,?) ON CONFLICT(collection_id) DO UPDATE SET bytes=excluded.bytes,mime=excluded.mime',
    ).run(id, image.bytes, image.mime);
    res.json({ ok: true });
  });
  app.delete('/api/collections/:id/panorama', (req, res) => {
    db.prepare('DELETE FROM collection_artwork WHERE collection_id=?').run(String(req.params.id));
    res.json({ ok: true });
  });
  app.get('/api/collections/:id/panorama', (req, res) => {
    const row = db
      .prepare('SELECT bytes,mime FROM collection_artwork WHERE collection_id=?')
      .get(String(req.params.id)) as { bytes: Uint8Array; mime: string } | undefined;
    if (!row) {
      res.status(404).json({ error: 'Panorama not found.' });
      return;
    }
    res.set('Cache-Control', 'private, no-store').type(row.mime).send(Buffer.from(row.bytes));
  });
  app.get('/api/collections/:id/spine-layout.css', (req, res) => {
    const id = String(req.params.id);
    const rows = panoramaValid(db, id) ? panoramaItems(db, id) : [];
    // IDs are validated/generated catalog hashes, never user-supplied CSS selectors.
    const css = rows
      .filter((item) => /^[\w-]+$/.test(item.id))
      .map(
        (item, index) =>
          `[data-item="${item.id}"] .panorama-art img {width:${rows.length * 100}%;max-width:none;transform:translateX(-${(index / rows.length) * 100}%);}`,
      )
      .join('\n');
    res.set('Cache-Control', 'private, no-store').type('text/css').send(css);
  });
}
