import { z } from 'zod';
import type { Adapter, CatalogItem, SourceConfig, Progress } from '../shared.js';
import { sourceTransport, validateBase, type Transport } from './security.js';

const idSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = (value: unknown, max = 10000) =>
  typeof value === 'string' ? value.slice(0, max) : '';
const fraction = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const supported = {
  catalog: 'supported',
  artwork: 'supported',
  progress: 'supported',
  open: 'supported',
} as const;
const actions = (progress = true) =>
  ({
    open: 'supported',
    progress: progress ? 'supported' : 'unsupported',
    embeddedPlayback: 'unsupported',
  }) as CatalogItem['actions'];

const absUser = z.object({
  id: z.string(),
  username: z.string().optional(),
  mediaProgress: z
    .array(
      z.object({
        libraryItemId: z.string(),
        progress: z.number(),
        currentTime: z.number().optional(),
        isFinished: z.boolean().optional(),
        lastUpdate: z.number().optional(),
      }),
    )
    .optional(),
});
const absItem = z.object({
  id: idSchema,
  media: z.object({
    metadata: z.object({
      title: z.string(),
      authorName: z.string().optional(),
      authors: z.array(z.object({ name: z.string() })).optional(),
      series: z.array(z.object({ name: z.string() })).optional(),
      description: z.string().nullish(),
      seriesName: z.string().nullish(),
    }),
    tracks: z.array(z.unknown()).optional(),
    audioFiles: z.array(z.unknown()).optional(),
    numAudioFiles: z.number().optional(),
    ebookFile: z.unknown().optional(),
    coverPath: z.string().nullish(),
  }),
});
const komgaItem = z.object({
  id: idSchema,
  seriesTitle: z.string().optional(),
  name: z.string().optional(),
  media: z.object({ pagesCount: z.number() }),
  metadata: z.object({
    title: z.string(),
    summary: z.string().optional(),
    authors: z.array(z.object({ name: z.string() })).optional(),
  }),
  readProgress: z
    .object({ page: z.number(), completed: z.boolean(), lastModified: z.string().optional() })
    .nullish(),
});
const jellyItem = z.object({
  Id: idSchema,
  Name: z.string(),
  Type: z.enum(['Movie', 'Series', 'Episode']),
  Overview: z.string().optional(),
  SeriesName: z.string().optional(),
  RunTimeTicks: z.number().optional(),
  People: z.array(z.object({ Name: z.string(), Type: z.string() })).optional(),
  ImageTags: z.object({ Primary: z.string().optional() }).optional(),
  UserData: z
    .object({
      PlaybackPositionTicks: z.number().optional(),
      Played: z.boolean().optional(),
      LastPlayedDate: z.string().optional(),
    })
    .optional(),
});

export function createAdapter(
  source: SourceConfig,
  options: { transport?: Transport; allowLoopback?: boolean } = {},
): Adapter {
  const headers: Record<string, string> =
    source.type === 'komga'
      ? { 'X-API-Key': source.credential }
      : source.type === 'jellyfin'
        ? { 'X-Emby-Token': source.credential }
        : { Authorization: `Bearer ${source.credential}` };
  const transport = options.transport || sourceTransport(source, headers, options.allowLoopback);
  const publicUrl = validateBase(source.publicUrl);
  const artwork = async (item: CatalogItem) =>
    item.artworkPath ? transport.image(item.artworkPath) : undefined;
  if (source.type === 'audiobookshelf') {
    let libraries: string[] | undefined;
    let progress = new Map<string, Progress>();
    return {
      type: source.type,
      capabilities: supported,
      artwork,
      async health() {
        const me = absUser.parse(await transport.json('/api/me'));
        progress = new Map(
          (me.mediaProgress || []).map((p) => [
            p.libraryItemId,
            {
              fraction: p.isFinished ? 1 : fraction(p.progress),
              position: p.currentTime,
              unit: p.currentTime === undefined ? 'fraction' : 'seconds',
              updatedAt: p.lastUpdate ? new Date(p.lastUpdate).toISOString() : undefined,
            },
          ]),
        );
        return { account: me.username };
      },
      async page(cursor = '0:0') {
        if (!libraries) {
          const result = z
            .object({ libraries: z.array(z.object({ id: idSchema, mediaType: z.string() })) })
            .parse(await transport.json('/api/libraries'));
          libraries = result.libraries.filter((l) => l.mediaType === 'book').map((l) => l.id);
        }
        const [index, page] = cursor.split(':').map(Number);
        if (!libraries[index]) return { items: [] };
        const result = z
          .object({ results: z.array(absItem), total: z.number() })
          .parse(
            await transport.json(
              `/api/libraries/${libraries[index]}/items?limit=100&page=${page}&minified=0`,
            ),
          );
        const items: CatalogItem[] = result.results.map((item) => ({
          sourceId: source.id,
          sourceItemId: item.id,
          section: 'books',
          kind:
            (item.media.numAudioFiles ||
              item.media.tracks?.length ||
              item.media.audioFiles?.length ||
              0) > 0
              ? 'audiobook'
              : 'book',
          title: text(item.media.metadata.title, 500),
          creator: text(
            item.media.metadata.authorName ||
              item.media.metadata.authors?.map((a) => a.name).join(', '),
            500,
          ),
          description: text(item.media.metadata.description),
          series: text(
            item.media.metadata.seriesName ||
              item.media.metadata.series?.map((s) => s.name).join(', '),
            500,
          ),
          artworkPath: item.media.coverPath ? `/api/items/${item.id}/cover?width=360` : undefined,
          progress: progress.get(item.id),
          actions: actions(),
        }));
        return {
          items,
          nextCursor:
            (page + 1) * 100 < result.total
              ? `${index}:${page + 1}`
              : index + 1 < libraries.length
                ? `${index + 1}:0`
                : undefined,
        };
      },
      handoff: (item) => `${publicUrl}/item/${idSchema.parse(item.sourceItemId)}`,
    };
  }
  if (source.type === 'komga')
    return {
      type: source.type,
      capabilities: supported,
      artwork,
      async health() {
        const me = z
          .object({ email: z.string().optional() })
          .passthrough()
          .parse(await transport.json('/api/v1/users/me'));
        return { account: me.email };
      },
      async page(cursor = '0') {
        const page = Number(cursor);
        const result = z
          .object({ content: z.array(komgaItem), last: z.boolean() })
          .parse(
            await transport.json(
              `/api/v1/books/list?page=${page}&size=100&sort=metadata.title,asc`,
              { method: 'POST', body: {} },
            ),
          );
        return {
          items: result.content.map((item) => ({
            sourceId: source.id,
            sourceItemId: item.id,
            section: 'comics',
            kind: 'comic',
            title: text(item.metadata.title || item.name, 500),
            creator: text(item.metadata.authors?.map((a) => a.name).join(', '), 500),
            description: text(item.metadata.summary),
            series: text(item.seriesTitle, 500),
            artworkPath: `/api/v1/books/${item.id}/thumbnail`,
            progress: item.readProgress
              ? {
                  fraction: item.readProgress.completed
                    ? 1
                    : fraction(item.readProgress.page / Math.max(1, item.media.pagesCount)),
                  position: item.readProgress.page,
                  unit: 'pages',
                  updatedAt: item.readProgress.lastModified,
                }
              : undefined,
            actions: actions(),
          })),
          nextCursor: result.last ? undefined : String(page + 1),
        };
      },
      // Open the detail route: Komga chooses the appropriate PDF/comic or EPUB reader.
      handoff: (item) => `${publicUrl}/book/${idSchema.parse(item.sourceItemId)}`,
    };
  let userId: string | undefined;
  return {
    type: source.type,
    capabilities: supported,
    artwork,
    async health() {
      const me = z
        .object({ Id: idSchema, Name: z.string().optional() })
        .parse(await transport.json('/Users/Me'));
      userId = me.Id;
      return { account: me.Name };
    },
    async page(cursor = '0') {
      if (!userId) await this.health();
      const offset = Number(cursor);
      const result = z
        .object({ Items: z.array(jellyItem), TotalRecordCount: z.number() })
        .parse(
          await transport.json(
            `/Items?UserId=${userId}&Recursive=true&IncludeItemTypes=Movie,Series,Episode&Fields=Overview,People&EnableUserData=true&StartIndex=${offset}&Limit=100`,
          ),
        );
      return {
        items: result.Items.map((item) => ({
          sourceId: source.id,
          sourceItemId: item.Id,
          section: 'movies',
          kind: item.Type === 'Series' ? 'show' : item.Type === 'Episode' ? 'episode' : 'movie',
          title: text(item.Name, 500),
          creator: text(
            item.People?.filter((p) => p.Type === 'Director')
              .map((p) => p.Name)
              .join(', '),
            500,
          ),
          description: text(item.Overview),
          series: text(item.SeriesName, 500),
          artworkPath: item.ImageTags?.Primary
            ? `/Items/${item.Id}/Images/Primary?maxWidth=360&quality=80`
            : undefined,
          progress:
            item.Type !== 'Series' && item.UserData && item.RunTimeTicks
              ? {
                  fraction: item.UserData.Played
                    ? 1
                    : fraction((item.UserData.PlaybackPositionTicks || 0) / item.RunTimeTicks),
                  position: (item.UserData.PlaybackPositionTicks || 0) / 10000000,
                  unit: 'seconds',
                  updatedAt: item.UserData.LastPlayedDate,
                }
              : undefined,
          actions: actions(item.Type !== 'Series'),
        })),
        nextCursor:
          offset + result.Items.length < result.TotalRecordCount
            ? String(offset + result.Items.length)
            : undefined,
      };
    },
    handoff: (item) => `${publicUrl}/web/#/details?id=${idSchema.parse(item.sourceItemId)}`,
  };
}
