import { createServer, type IncomingMessage } from 'node:http';
export const secret = 'fixture-secret-not-for-real-use';
export const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==',
  'base64',
);
// Hand-authored minimal responses from official API contracts, not captured personal data.
export const fixtures = {
  absMe: {
    id: 'user-1',
    username: 'reader',
    mediaProgress: [
      { libraryItemId: 'book-1', progress: 0.4, currentTime: 240, lastUpdate: 1700000000000 },
    ],
  },
  absLibraries: {
    libraries: [
      { id: 'lib-1', mediaType: 'book' },
      { id: 'pod-1', mediaType: 'podcast' },
    ],
  },
  absPage: {
    results: [
      {
        id: 'book-1',
        media: {
          metadata: {
            title: 'Fixture Atlas',
            authors: [{ name: 'Fictional Author' }],
            series: [{ name: 'Fixture Journeys' }],
            description: 'A synthetic audiobook for integration tests.',
          },
          audioFiles: [{}],
          coverPath: '/never-read-this-filesystem-path',
        },
      },
    ],
    total: 1,
  },
  komgaMe: { email: 'reader@example.org' },
  komgaPage: {
    content: [
      {
        id: 'comic-1',
        libraryId: 'comic-lib',
        name: 'Volume 1',
        seriesTitle: 'Fixture Harbor',
        media: { pagesCount: 100 },
        metadata: {
          title: 'Fixture Comic',
          summary: 'Synthetic comic.',
          authors: [{ name: 'Fictional Artist' }],
        },
        readProgress: { page: 25, completed: false, lastModified: '2026-01-01T00:00:00Z' },
      },
    ],
    last: true,
  },
  jellyMe: { Id: 'viewer-1', Name: 'viewer' },
  jellyPage: {
    Items: [
      {
        Id: 'movie-1',
        Name: 'Fixture Film',
        Type: 'Movie',
        Overview: 'Synthetic film.',
        RunTimeTicks: 10000000000,
        People: [{ Name: 'Fictional Director', Type: 'Director' }],
        ImageTags: { Primary: 'tag' },
        UserData: { PlaybackPositionTicks: 5000000000, Played: false },
      },
      { Id: 'show-1', Name: 'Fixture Show', Type: 'Series', UserData: { Played: false } },
    ],
    TotalRecordCount: 2,
  },
};
export async function fixtureServer() {
  let fail = false;
  const overrides = new Map<string, unknown>();
  const requests: { url: string; method: string; headers: IncomingMessage['headers'] }[] = [];
  const server = createServer(async (req, res) => {
    requests.push({ url: req.url || '', method: req.method || '', headers: req.headers });
    if (fail) {
      res.writeHead(503, { 'Content-Type': 'application/json' });
      res.end('{"error":"fixture down"}');
      return;
    }
    const url = new URL(req.url || '', 'http://fixture');
    if (url.pathname === '/Users/AuthenticateByName') {
      let body = '';
      for await (const chunk of req) body += chunk.toString();
      const credentials = JSON.parse(body);
      const valid =
        req.method === 'POST' &&
        req.headers.authorization?.startsWith('MediaBrowser Client="SelfLib"') &&
        credentials.Username === 'fixture-viewer' &&
        credentials.Pw === 'fixture-viewer-password';
      res.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(valid ? { AccessToken: secret, User: fixtures.jellyMe } : {}));
      return;
    }
    if (url.pathname === '/Users/Me' && req.headers['x-emby-token'] === 'fixture-server-wide-key') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end('{}');
      return;
    }
    if (url.pathname === '/redirect') {
      res.writeHead(302, { Location: 'http://169.254.169.254/' });
      res.end();
      return;
    }
    if (url.pathname === '/oversized') {
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': '9999999' });
      res.end();
      return;
    }
    if (
      url.pathname.includes('thumbnail') ||
      url.pathname.includes('/cover') ||
      url.pathname.includes('/Images/')
    ) {
      if (!req.headers.accept?.includes('image/')) {
        res.writeHead(406);
        res.end('{}');
        return;
      }
      const expected = url.pathname.startsWith('/api/v')
        ? req.headers['x-api-key']
        : url.pathname.startsWith('/api/')
          ? req.headers.authorization?.replace('Bearer ', '')
          : req.headers['x-emby-token'];
      if (expected !== secret) {
        res.writeHead(401);
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'image/png' });
      res.end(png);
      return;
    }
    const routes: Record<string, unknown> = {
      '/api/me': fixtures.absMe,
      '/api/libraries': fixtures.absLibraries,
      '/api/libraries/lib-1/items': fixtures.absPage,
      '/api/v1/libraries': [
        { id: 'comic-lib', name: 'Comics', root: '/private-library-root' },
        { id: 'manga-lib', name: 'Manga' },
        { id: 'graphic-lib', name: 'Graphic Novels' },
      ],
      '/api/v2/users/me': fixtures.komgaMe,
      '/api/v1/books/list': fixtures.komgaPage,
      '/Users/Me': fixtures.jellyMe,
      '/Items': fixtures.jellyPage,
    };
    const result = overrides.has(url.pathname) ? overrides.get(url.pathname) : routes[url.pathname];
    if (!result) {
      res.writeHead(404);
      res.end('{}');
      return;
    }
    const expected = url.pathname.startsWith('/api/v')
      ? req.headers['x-api-key']
      : url.pathname.startsWith('/api/')
        ? req.headers.authorization?.replace('Bearer ', '')
        : req.headers['x-emby-token'];
    if (expected !== secret) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    if (url.pathname === '/api/v1/books/list' && req.method !== 'POST') {
      res.writeHead(405);
      res.end('{}');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(result));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`,
    requests,
    setResponse(path: string, value: unknown) {
      overrides.set(path, value);
    },
    setFailure(value: boolean) {
      fail = value;
    },
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
