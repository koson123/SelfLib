import { shelfCategories, shelfCategory, type ItemView } from '../shared.js';
type Status = {
  setupRequired: boolean;
  authenticated: boolean;
  csrf: string;
  username?: string;
  version: string;
};
type Source = {
  id: string;
  type: string;
  name: string;
  url: string;
  public_url: string;
  allow_private: number;
  health: string;
  error?: string;
  last_sync?: string;
  last_attempt?: string;
  syncing: boolean;
  libraryRooms?: Record<string, string>;
};
type Collection = { id: string; name: string; count: number; panorama?: boolean };
const app = document.querySelector<HTMLDivElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#detail')!;
let status: Status;
let demo = false;
let page = 'home';
let view = localStorage.getItem('selflib-view') || 'spines';
let q = '';
let offset = 0;
let total = 0;
let items: ItemView[] = [];
let sources: Source[] = [];
let collections: Collection[] = [];
let selectedCollection = '';
let generation = 0;
let poll: ReturnType<typeof setTimeout> | undefined;
const escape = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const icon = (name: string) => {
  const paths: Record<string, string> = {
    headphones:
      '<path d="M4 14v-3a8 8 0 0 1 16 0v3"/><rect x="3" y="12" width="4" height="9" rx="2"/><rect x="17" y="12" width="4" height="9" rx="2"/>',
    shows: '<rect x="3" y="6" width="18" height="15" rx="2"/><path d="m8 2 4 4 4-4M7 17h10"/>',
    audiobooks: '<path d="M4 14v-3a8 8 0 0 1 16 0v3M4 14v6h3v-6zm13 0v6h3v-6z"/>',
    book: '<path d="M3 4h6l3 3 3-3h6v15h-6l-3 2-3-2H3z"/><path d="M12 7v14"/>',
    search: '<circle cx="10" cy="10" r="6"/><path d="m15 15 6 6"/>',
    heart: '<path d="M12 21 3 12a5 5 0 0 1 9-7 5 5 0 0 1 9 7z"/>',
    home: '<path d="m3 10 9-7 9 7v11H3z"/><path d="M9 21v-8h6v8"/>',
    comics: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M12 3v9M9 12v9"/>',
    movies: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m10 8 6 4-6 4z"/>',
    collection: '<path d="M3 6h7l2 3h9v12H3z"/><path d="M3 6V3h8l2 3h8v3"/>',
    settings:
      '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    logout: '<path d="M10 3H3v18h7M9 12h12m-5-5 5 5-5 5"/>',
    spark: '<path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3z"/>',
  };
  return `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round">${paths[name === 'manga' || name === 'graphicnovels' ? 'comics' : name] || paths.book}</svg>`;
};
const labels: Record<string, string> = {
  home: 'The entrance',
  books: 'Books',
  audiobooks: 'Audiobooks',
  shows: 'TV shows',
  comics: 'Comics',
  manga: 'Manga',
  graphicnovels: 'Graphic novels',
  movies: 'Movies',
  favorites: 'Your favorites',
  collections: 'Personal collections',
  settings: 'Library connections',
};
const date = (value?: string) => (value ? new Date(value).toLocaleString() : 'Never');
async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch('/api' + path, {
    method,
    headers:
      method === 'GET'
        ? {}
        : { 'Content-Type': 'application/json', 'X-CSRF-Token': status?.csrf || '' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && status?.authenticated) {
      status.authenticated = false;
      demo = false;
      renderAuth();
    }
    throw new Error(result.error || 'Request failed.');
  }
  return result as T;
}
function notice(message: string) {
  const node = document.querySelector<HTMLDivElement>('#notice')!;
  node.textContent = message;
  node.classList.add('visible');
  setTimeout(() => node.classList.remove('visible'), 6000);
}
function formValues(form: HTMLFormElement) {
  return Object.fromEntries(new FormData(form));
}
function busy(button: HTMLButtonElement, work: () => Promise<void>) {
  button.disabled = true;
  void work()
    .catch((error) => notice(error.message))
    .finally(() => (button.disabled = false));
}
function tone(item: ItemView) {
  return [...item.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % 8;
}
function cover(item: ItemView, spine = false) {
  const film = item.section === 'movies';
  const symbol = icon(
    item.kind === 'audiobook'
      ? 'headphones'
      : film
        ? 'movies'
        : item.section === 'comics'
          ? 'comics'
          : 'spark',
  );
  const artwork = item.artwork
    ? `<img src="/api/items/${encodeURIComponent(item.id)}/artwork" alt="" loading="lazy" decoding="async">`
    : '';
  const panorama =
    spine &&
    page === 'collections' &&
    collections.find((c) => c.id === selectedCollection)?.panorama;
  const illustrated = item.customSpine || panorama;
  const spineImage = panorama
    ? `/api/collections/${encodeURIComponent(selectedCollection)}/panorama`
    : item.customSpine
      ? `/api/items/${encodeURIComponent(item.id)}/custom-artwork/spine`
      : '';
  const decoration = `<svg class="spine-illustration" viewBox="0 0 48 210" aria-hidden="true"><path d="M5 206Q48 147 14 35Q-2 90 30 100Q45 64 14 35M12 194Q-2 142 23 126Q45 153 12 194M20 174Q46 145 36 113M16 64Q32 20 42 7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M14 38Q34 53 22 87Q7 67 14 38M23 128Q8 143 13 169Q35 147 23 128" fill="currentColor" opacity=".35"/></svg>`;
  const binding = spine
    ? `<span class="spine-art ${panorama ? 'panorama-art' : ''}" aria-hidden="true">${spineImage ? `<img src="${spineImage}" alt="" loading="lazy">` : artwork || decoration}</span>${!illustrated ? `<span class="spine-title">${escape(item.title)}</span><span class="spine-author" aria-hidden="true">${escape(item.creator || item.kind)}</span>` : ''}`
    : artwork ||
      `<div class="cover-art" aria-hidden="true"><span class="cover-edition">${escape(item.kind)}</span><span class="cover-title">${escape(item.title)}</span><span class="cover-symbol">${symbol}</span><span class="cover-author">${escape(item.creator || 'Your collection')}</span></div>`;
  return `<div class="object ${spine ? 'spine' : ''} ${illustrated ? 'illustrated-spine' : ''} ${film ? 'film-case dvd-case' : item.section === 'comics' ? 'comic-volume' : 'bound-book'} tone-${tone(item)}">${film ? '<span class="dvd-format" aria-hidden="true">DVD</span>' : ''}${binding}${item.progress ? `<span class="ribbon" title="${Math.round(item.progress.fraction * 100)}% complete"></span>` : ''}${item.favorite ? '<span class="favorite-mark" aria-label="Favorite">♥</span>' : ''}</div>`;
}

function itemCard(item: ItemView, compact = false) {
  return `<article class="item ${compact ? 'compact' : ''}"><button class="item-open" data-item="${escape(item.id)}" aria-label="View ${escape(item.title)}" title="${escape(item.title)}${item.creator ? ' · ' + escape(item.creator) : ''}">${cover(item, view === 'spines' && !compact)}<span class="item-caption"><strong>${escape(item.title)}</strong><small>${escape(item.creator || item.kind)}</small></span></button>${item.progress && compact ? `<progress max="1" value="${item.progress.fraction}" aria-label="${escape(item.title)} progress"></progress><span class="progress-caption">${Math.round(item.progress.fraction * 100)}% · ${item.kind === 'audiobook' ? 'listening' : item.section === 'movies' ? 'watching' : 'reading'}</span>` : ''}</article>`;
}
function bindItems(root: ParentNode = app) {
  root.querySelectorAll<HTMLButtonElement>('[data-item]').forEach((button) =>
    button.addEventListener('click', () => {
      const item = items.find((i) => i.id === button.dataset.item);
      if (item) void showDetail(item);
    }),
  );
}
function shell() {
  app.innerHTML = `<a class="skip-link" href="#main">Skip to library</a><aside class="sidebar"><a class="brand" href="#" data-page="home">${icon('book')}<span>SelfLib<small>A PLACE FOR YOUR STORIES</small></span></a><p class="nav-label">YOUR LIBRARY</p><nav aria-label="Library sections">${['home', ...shelfCategories, 'favorites', 'collections'].map((p) => `<button data-page="${p}" class="nav-link ${page === p ? 'active' : ''}" ${page === p ? 'aria-current="page"' : ''}>${icon(p === 'books' ? 'book' : p === 'favorites' ? 'heart' : p === 'collections' ? 'collection' : p)}${escape(p === 'home' ? 'Entrance' : p === 'collections' ? 'Collections' : labels[p])}</button>`).join('')}</nav><div class="sidebar-bottom"><div class="library-note">${icon('spark')}<p>Your collections.<br>Your own little world.</p></div><button data-page="settings" class="nav-link ${page === 'settings' ? 'active' : ''}">${icon('settings')}Connections</button>${status.authenticated && !demo ? '<button id="enter-demo" class="nav-link">Explore demo library</button>' : ''}${status.authenticated ? `<button id="logout" class="nav-link">${icon('logout')}Sign out · ${escape(status.username)}</button>` : `<button id="leave-demo" class="nav-link">${icon('logout')}Set up your library</button>`}</div></aside><div class="workspace"><header class="topbar"><span class="breadcrumb">YOUR LIBRARY <span>/</span> ${escape(labels[page])}</span><form id="search" role="search">${icon('search')}<input type="search" name="q" aria-label="Search across your library" placeholder="Find a story, author, or series…" value="${escape(q)}" maxlength="200"><button type="submit" class="search-submit">Search</button></form><span class="owner-avatar" aria-label="${demo ? 'Demo library' : 'Owner account'}">${demo ? 'D' : escape(status.username?.slice(0, 1).toUpperCase() || 'S')}</span></header>${demo ? '<div class="demo-banner"><strong>DEMO LIBRARY</strong> Fictional titles and illustrative progress. No media or source credentials. <button id="demo-switch">' + (status.authenticated ? 'Return to my library' : 'Create my library') + '</button></div>' : ''}<main id="main" tabindex="-1"></main><footer>SelfLib <span>0.1.0 · A library of your own</span></footer></div>`;
  app.querySelectorAll<HTMLElement>('[data-page]').forEach((button) =>
    button.addEventListener('click', (event) => {
      event.preventDefault();
      page = button.dataset.page!;
      q = '';
      offset = 0;
      void render();
    }),
  );
  app.querySelector<HTMLFormElement>('#search')!.addEventListener('submit', (event) => {
    event.preventDefault();
    q = String(formValues(event.currentTarget as HTMLFormElement).q);
    page = 'home';
    offset = 0;
    void render();
  });
  app.querySelector('#logout')?.addEventListener(
    'click',
    () =>
      void api('/logout', 'POST', {})
        .then(() => boot())
        .catch((e) => notice(e.message)),
  );
  app.querySelector('#enter-demo')?.addEventListener('click', () => {
    demo = true;
    page = 'home';
    q = '';
    offset = 0;
    void render();
  });
  for (const id of ['leave-demo', 'demo-switch'])
    app.querySelector('#' + id)?.addEventListener('click', () => {
      demo = false;
      void (status.authenticated ? render() : Promise.resolve(renderAuth()));
    });
}
async function loadItems(extra = '') {
  if (!status.authenticated) {
    const result = await api<{ items: ItemView[] }>('/demo');
    let selected = result.items;
    if (shelfCategories.some((category) => category === page))
      selected = selected.filter((i) => shelfCategory(i) === page);
    if (q)
      selected = selected.filter((i) =>
        (i.title + ' ' + i.creator + ' ' + i.description).toLowerCase().includes(q.toLowerCase()),
      );
    if (page === 'favorites' || page === 'collections') selected = [];
    return { items: selected, total: selected.length };
  }
  const params = new URLSearchParams({ demo: String(demo), limit: '60', offset: String(offset) });
  if (q) params.set('q', q);
  if (shelfCategories.some((category) => category === page)) params.set('category', page);
  if (page === 'favorites') params.set('favorite', 'true');
  if (page === 'collections' && selectedCollection) params.set('collection', selectedCollection);
  return api<{ items: ItemView[]; total: number }>('/items?' + params + extra);
}
async function render() {
  const renderId = ++generation;
  clearTimeout(poll);
  document.querySelector('#panorama-layout')?.remove();
  shell();
  const main = app.querySelector<HTMLElement>('main')!;
  main.innerHTML = '<p class="loading">Opening the shelves…</p>';
  try {
    if (status.authenticated) {
      const results = await Promise.all([
        api<{ sources: Source[] }>('/sources'),
        api<{ collections: Collection[] }>('/collections'),
      ]);
      if (renderId !== generation) return;
      sources = results[0].sources;
      collections = results[1].collections;
    }
    if (page === 'settings') {
      renderSettings(main);
      return;
    }
    let result = await loadItems();
    if (page === 'home' && !q && status.authenticated) {
      const previews = await Promise.all(
        shelfCategories.map((section) =>
          api<{ items: ItemView[]; total: number }>(
            '/items?demo=' + demo + '&category=' + section + '&limit=6',
          ),
        ),
      );
      result = {
        items: previews.flatMap((p) => p.items),
        total: previews.reduce((n, p) => n + p.total, 0),
      };
    }
    if (renderId !== generation) return;
    items = result.items;
    total = result.total;
    let continueItems: ItemView[] = [];
    if (page === 'home' && !q) {
      continueItems = status.authenticated
        ? (await api<{ items: ItemView[] }>('/items?continue=true&demo=' + demo + '&limit=6')).items
        : items.filter((i) => i.progress).slice(0, 6);
      items = [...new Map([...items, ...continueItems].map((i) => [i.id, i])).values()];
    }
    if (renderId !== generation) return;
    const title = q ? `Searching for “${escape(q)}”` : labels[page];
    const sourceWarning =
      !demo && sources.some((s) => s.health === 'unreachable')
        ? '<p class="outage-note">A collection source is unavailable. You can still browse its cached catalog. Check Connections for details.</p>'
        : '';
    const home = page === 'home' && !q;
    main.innerHTML = `${home ? `<section class="hero"><div class="hero-copy"><p class="eyebrow">WELCOME TO YOUR PERSONAL LIBRARY</p><h1>A world of stories.<br><em>A place to call yours.</em></h1><p>Pick up where you left off, wander the shelves,<br class="desktop-break"> or find something you haven’t discovered yet.</p><button class="primary" id="browse-books">Explore the bookshelves ${icon('arrow')}</button></div><div class="hero-illustration" aria-hidden="true"><div class="illustration-window"></div><div class="little-book one">STORIES</div><div class="little-book two">ATLAS</div><div class="little-book three">NIGHTS</div><div class="illustration-shelf"></div><div class="plant"><span></span></div><div class="lamp"></div></div></section>` : `<div class="page-heading"><p class="eyebrow">${q ? 'THE CATALOG' : 'YOUR PERSONAL LIBRARY'}</p><h1>${title}</h1><p>${total} ${total === 1 ? 'item' : 'items'} to discover${demo ? ' · fictional demonstration' : ''}.</p></div>`}${sourceWarning}${home && continueItems.length ? `<section class="continue-section"><div class="section-heading"><div><p class="eyebrow">THE READING TABLE</p><h2>Right where you left off</h2></div><span class="quiet">${demo ? 'Illustrative progress' : 'Progress from your sources'}</span></div><div class="continue-grid">${continueItems.map((i) => itemCard(i, true)).join('')}</div></section>` : ''}${page === 'collections' ? collectionToolbar() : ''}<section class="browse-section"><div class="section-heading"><div>${home ? '<p class="eyebrow">WANDER A LITTLE</p><h2>Your shelves</h2>' : '<h2>On the shelves</h2>'}</div><div class="view-switch" role="group" aria-label="Shelf presentation"><button id="covers" class="${view === 'covers' ? 'selected' : ''}" aria-pressed="${view === 'covers'}">Covers</button><button id="spines" class="${view === 'spines' ? 'selected' : ''}" aria-pressed="${view === 'spines'}">Spines</button></div></div>${home ? `<div class="room-directory">${shelfCategories.map((s) => `<button data-room="${s}">${icon(s === 'books' ? 'book' : s)}<span>${labels[s]}</span>${icon('arrow')}</button>`).join('')}</div>` : ''}${renderShelves(result.items)}${total > 60 && !home ? `<div class="pagination"><button id="previous" ${offset === 0 ? 'disabled' : ''}>Previous</button><span>${offset + 1}–${Math.min(offset + 60, total)} of ${total}</span><button id="next" ${offset + 60 >= total ? 'disabled' : ''}>Next</button></div>` : ''}</section>${home ? `<section class="future"><p class="eyebrow">ROOM TO GROW</p><p>Music · Photos · Games · Reference</p><span>Future sections — integrations are not available in this release.</span></section>` : ''}`;
    main.querySelector('#browse-books')?.addEventListener('click', () => navigate('books'));
    main
      .querySelectorAll<HTMLButtonElement>('[data-room]')
      .forEach((b) => b.addEventListener('click', () => navigate(b.dataset.room!)));
    for (const mode of ['covers', 'spines'])
      main.querySelector('#' + mode)?.addEventListener('click', () => {
        view = mode;
        localStorage.setItem('selflib-view', mode);
        void render();
      });
    main.querySelector('#previous')?.addEventListener('click', () => {
      offset = Math.max(0, offset - 60);
      void render();
    });
    main.querySelector('#next')?.addEventListener('click', () => {
      offset += 60;
      void render();
    });
    if (page === 'collections') {
      bindCollections(main);
      if (selectedCollection && collections.find((c) => c.id === selectedCollection)?.panorama) {
        const link = document.createElement('link');
        link.id = 'panorama-layout';
        link.rel = 'stylesheet';
        link.href =
          '/api/collections/' + encodeURIComponent(selectedCollection) + '/spine-layout.css';
        document.head.append(link);
      }
    }
    bindItems(main);
  } catch (error) {
    main.innerHTML = `<div class="empty"><h2>Couldn’t open this shelf</h2><p>${escape((error as Error).message)}</p><button id="retry">Try again</button></div>`;
    main.querySelector('#retry')?.addEventListener('click', () => void render());
  }
}
function navigate(destination: string) {
  page = destination;
  offset = 0;
  q = '';
  void render();
}
function renderShelves(list: ItemView[]) {
  if (!list.length)
    return `<div class="empty">${icon('book')}<h2>${q ? 'No matching stories yet' : page === 'favorites' ? 'Save a little inspiration' : page === 'collections' ? 'Make room for a collection' : 'The shelves are ready for you'}</h2><p>${q ? 'Try a shorter title, author, or series.' : page === 'favorites' ? 'Open an item and add it to your favorites.' : page === 'collections' ? 'Create a collection, then add items from their detail panels.' : 'Add any one connection and synchronize its catalog, or explore the demo library.'}</p>${!demo && page !== 'favorites' && page !== 'collections' ? '<button id="empty-connect" class="primary">Connect a collection</button><button id="empty-demo">Explore demo</button>' : ''}</div>`;
  const groups: Record<string, ItemView[]> = {};
  for (const item of list) (groups[shelfCategory(item)] ??= []).push(item);
  return Object.entries(groups)
    .map(
      ([section, entries]) =>
        `<div class="shelf-group ${page === 'collections' && collections.find((c) => c.id === selectedCollection)?.panorama ? 'panoramic' : ''}"><div class="shelf-label">${icon(section === 'books' ? 'book' : section)}<h3>${labels[section]}</h3><span>${entries.length} on this page</span></div>${Array.from(
          { length: Math.ceil(entries.length / (view === 'spines' ? 18 : 6)) },
          (_, row) =>
            `<div class="shelf-bay"><div class="shelf-items ${view}">${entries
              .slice(row * (view === 'spines' ? 18 : 6), (row + 1) * (view === 'spines' ? 18 : 6))
              .map((i) => itemCard(i))
              .join('')}</div><div class="wood-edge"></div></div>`,
        ).join('')}</div>`,
    )
    .join('');
}
app.addEventListener('click', (event) => {
  const id = (event.target as HTMLElement).closest('button')?.id;
  if (id === 'empty-connect') navigate('settings');
  if (id === 'empty-demo') {
    demo = true;
    void render();
  }
});
function collectionToolbar() {
  return `<div class="collection-toolbar"><label>Collection <select id="collection-filter" aria-label="Collection"><option value="">All collections / all items</option>${collections.map((c) => `<option value="${c.id}" ${selectedCollection === c.id ? 'selected' : ''}>${escape(c.name)} (${c.count})</option>`).join('')}</select></label><button id="new-collection" class="primary">+ New collection</button>${selectedCollection ? '<button id="delete-collection" class="danger">Delete collection</button>' : ''}</div>${selectedCollection ? '<form id="panorama-form" class="artwork-controls"><h3>Illustrated box-set spines</h3><p>Upload one wide image to span 2–18 items in this room. Items follow the order you added them. Mixed rooms cannot share a panorama. Use artwork you have permission to use.</p><label>Box-set panorama<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><button type="submit">Save panorama</button><button id="remove-panorama" type="button">Remove panorama</button><small>PNG, JPEG or WebP, maximum 512 KiB. View Spines to see it.</small><p class="artwork-result" role="status"></p></form>' : ''}`;
}
function bindCollections(main: HTMLElement) {
  const panoramaForm = main.querySelector<HTMLFormElement>('#panorama-form');
  if (panoramaForm) {
    panoramaForm.addEventListener('submit', (event) => {
      event.preventDefault();
      busy(panoramaForm.querySelector<HTMLButtonElement>('[type=submit]')!, async () => {
        try {
          await api(
            '/collections/' + selectedCollection + '/panorama',
            'PUT',
            await imagePayload(panoramaForm),
          );
          view = 'spines';
          localStorage.setItem('selflib-view', view);
          await render();
          notice('Box-set panorama saved.');
        } catch (error) {
          panoramaForm.querySelector('.artwork-result')!.textContent = (error as Error).message;
        }
      });
    });
    panoramaForm
      .querySelector<HTMLButtonElement>('#remove-panorama')!
      .addEventListener('click', (event) =>
        busy(event.currentTarget as HTMLButtonElement, async () => {
          await api('/collections/' + selectedCollection + '/panorama', 'DELETE', {});
          await render();
        }),
      );
  }
  main
    .querySelector<HTMLSelectElement>('#collection-filter')!
    .addEventListener('change', (event) => {
      selectedCollection = (event.target as HTMLSelectElement).value;
      offset = 0;
      void render();
    });
  main.querySelector('#new-collection')!.addEventListener('click', showCreateCollection);
  main
    .querySelector<HTMLButtonElement>('#delete-collection')
    ?.addEventListener('click', (event) => {
      if (confirm('Delete this collection? Media and favorites are kept.'))
        busy(event.currentTarget as HTMLButtonElement, async () => {
          await api('/collections/' + selectedCollection, 'DELETE', {});
          selectedCollection = '';
          await render();
        });
    });
}
function showCreateCollection() {
  if (!status.authenticated) {
    notice('Create an owner account to save collections.');
    return;
  }
  dialog.innerHTML =
    '<button class="dialog-close" aria-label="Close">×</button><p class="eyebrow">PERSONAL SHELVES</p><h2 id="dialog-title">Create a collection</h2><form id="create-collection"><label>Collection name<input name="name" required maxlength="80" placeholder="Quiet evenings"></label><button class="primary" type="submit">Create collection</button></form>';
  openDialog();
  dialog.querySelector<HTMLFormElement>('form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    busy(form.querySelector('button')!, async () => {
      await api('/collections', 'POST', formValues(form));
      dialog.close();
      await render();
    });
  });
}
async function showDetail(item: ItemView) {
  dialog.innerHTML = `<button class="dialog-close" aria-label="Close">×</button><div class="detail-layout"><div class="detail-cover">${cover(item)}</div><div class="detail-copy"><p class="eyebrow">${escape(item.sourceName)} · ${escape(item.kind)}</p><h2 id="dialog-title">${escape(item.title)}</h2><p class="detail-author">${escape(item.creator)}</p>${item.series ? `<p>Series: ${escape(item.series)}</p>` : ''}<p class="description">${escape(item.description || 'No description is available from this source.')}</p>${item.progress ? `<div class="detail-progress"><progress max="1" value="${item.progress.fraction}" aria-label="Progress"></progress><p>${Math.round(item.progress.fraction * 100)}% complete${item.progress.unit === 'pages' ? ` · page ${item.progress.position}` : item.progress.unit === 'seconds' ? ` · ${Math.floor((item.progress.position || 0) / 60)} minutes in` : ''}<small>${item.demo ? 'Illustrative demo progress' : 'Source progress as of the last synchronization. The source reader/player resumes playback.'}</small></p></div>` : '<p class="quiet">No in-progress position reported by the source.</p>'}<div class="detail-actions"><button id="open-source" class="primary" ${item.actions.open === 'unsupported' ? 'disabled' : ''}>${item.kind === 'audiobook' ? 'Listen' : item.section === 'movies' ? 'Watch' : 'Read'} in source ${icon('arrow')}</button><button id="favorite" aria-pressed="${item.favorite}">${icon('heart')}${item.favorite ? 'Saved' : 'Favorite'}</button></div><p class="quiet">${item.demo ? 'Demo titles are fictional and cannot be read or played.' : 'Opens your configured source app. You may need to sign in there.'}</p><p id="favorite-feedback" class="favorite-feedback" role="status" aria-live="polite"></p><div id="detail-collections"></div>${status.authenticated ? '<form id="item-artwork-form" class="artwork-controls"><h3>Cover and spine artwork</h3><p>Use your own edition artwork. SelfLib keeps this private and leaves the source untouched.</p><label>Artwork type<select name="role"><option value="cover">' + (item.section === 'movies' ? 'DVD cover' : 'Cover') + '</option><option value="spine">Full illustrated spine</option></select></label><label>Artwork image<input type="file" name="image" accept="image/png,image/jpeg,image/webp" required></label><small>PNG, JPEG or WebP, maximum 512 KiB. For a wraparound DVD scan, crop to its front or spine before uploading. Use artwork you have permission to use.</small><button type="submit">Save artwork</button><button id="remove-item-artwork" type="button">Remove selected custom artwork</button><p class="artwork-result" role="status"></p></form>' : ''}</div></div>`;
  openDialog();
  const artworkForm = dialog.querySelector<HTMLFormElement>('#item-artwork-form');
  if (artworkForm) {
    const updateArt = async (method: string) => {
      const role = String(formValues(artworkForm).role);
      try {
        await api(
          '/items/' + item.id + '/custom-artwork/' + role,
          method,
          method === 'PUT' ? await imagePayload(artworkForm) : {},
        );
        await render();
        const updated = items.find((candidate) => candidate.id === item.id);
        if (updated && dialog.open) {
          Object.assign(item, updated);
          dialog.querySelector('.detail-cover')!.innerHTML = cover(updated);
        }
        artworkForm.querySelector('.artwork-result')!.textContent =
          method === 'PUT'
            ? 'Artwork saved. Switch to Spines to see a spine image.'
            : 'Custom artwork removed; source artwork is retained.';
      } catch (error) {
        artworkForm.querySelector('.artwork-result')!.textContent = (error as Error).message;
      }
    };
    artworkForm.addEventListener('submit', (event) => {
      event.preventDefault();
      busy(artworkForm.querySelector<HTMLButtonElement>('[type=submit]')!, () => updateArt('PUT'));
    });
    artworkForm
      .querySelector<HTMLButtonElement>('#remove-item-artwork')!
      .addEventListener('click', (event) =>
        busy(event.currentTarget as HTMLButtonElement, () => updateArt('DELETE')),
      );
  }
  dialog.querySelector<HTMLButtonElement>('#open-source')!.addEventListener('click', (event) =>
    busy(event.currentTarget as HTMLButtonElement, async () => {
      const result = await api<{ url: string }>('/items/' + item.id + '/open');
      const url = new URL(result.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Unsafe action URL.');
      // Same-tab navigation also works when mobile browsers block async popups.
      window.location.assign(url.toString());
    }),
  );
  dialog.querySelector<HTMLButtonElement>('#favorite')!.addEventListener('click', (event) => {
    if (!status.authenticated) {
      notice('Create an owner account to save favorites.');
      return;
    }
    busy(event.currentTarget as HTMLButtonElement, async () => {
      await api('/items/' + item.id + '/favorite', 'PUT', { favorite: !item.favorite });
      item.favorite = !item.favorite;
      const b = dialog.querySelector<HTMLButtonElement>('#favorite')!;
      b.innerHTML = icon('heart') + (item.favorite ? 'Saved' : 'Favorite');
      b.setAttribute('aria-pressed', String(item.favorite));
      b.classList.remove('favorite-pop');
      void b.offsetWidth;
      b.classList.add('favorite-pop');
      dialog.querySelector('.detail-cover')!.innerHTML = cover(item);
      dialog.querySelector('#favorite-feedback')!.textContent = item.favorite
        ? 'Added to your favorites.'
        : 'Removed from your favorites.';
      await render();
    });
  });
  if (status.authenticated) {
    try {
      const { ids } = await api<{ ids: string[] }>('/items/' + item.id + '/collections');
      if (!dialog.open) return;
      const root = dialog.querySelector('#detail-collections');
      if (!root) return;
      root.innerHTML = `<h3>Add to a collection</h3>${collections.length ? collections.map((c) => `<label class="check"><input type="checkbox" data-collection="${c.id}" ${ids.includes(c.id) ? 'checked' : ''}>${escape(c.name)}</label>`).join('') : '<p class="quiet">Create collections from the Collections section.</p>'}`;
      root.querySelectorAll<HTMLInputElement>('input').forEach((input) =>
        input.addEventListener(
          'change',
          () =>
            void api('/collections/' + input.dataset.collection + '/items/' + item.id, 'PUT', {
              included: input.checked,
            }).catch((e) => {
              input.checked = !input.checked;
              notice(e.message);
            }),
        ),
      );
    } catch (error) {
      notice((error as Error).message);
    }
  }
}
function openDialog() {
  if (!dialog.open) dialog.showModal();
  dialog.querySelector('.dialog-close')?.addEventListener('click', () => dialog.close());
}
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) {
    const rect = dialog.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      dialog.close();
  }
});

const help: Record<string, string> = {
  audiobookshelf:
    'Create an API key for your intended reader account in Audiobookshelf Settings → API Keys. The key inherits that user’s library access. Use the same account whose listening progress you want. Older static tokens are not a verified target.',
  komga:
    'Create an API key in Komga Account → API keys. Use a normal reader account with only the desired libraries; administration permissions are unnecessary. Versions without API keys are not supported.',
  jellyfin:
    'Sign in below with a normal Jellyfin viewer account, or paste its user access token. Dashboard API keys do not identify a viewer and cannot supply personal progress. SelfLib exchanges your password on the server, stores only the encrypted token, and never returns it to the browser.',
};
function renderSettings(main: HTMLElement) {
  main.innerHTML = `<div class="page-heading"><p class="eyebrow">BRING YOUR COLLECTIONS TOGETHER</p><h1>Library connections</h1><p>Keep your media where it belongs. SelfLib brings its shelves here.</p></div>${!status.authenticated ? '<div class="empty"><h2>Connect your own collections</h2><p>First create the owner account. Exploring the demo never requires credentials.</p><button id="setup-from-settings" class="primary">Create my library</button></div>' : `<p class="privacy-note">Single-owner release. Every connected account’s visible catalog is available to this owner. Choose a reader/viewer account with the intended library permissions.</p><div class="connection-list">${sources.map((s) => `<article class="connection"><div class="connection-heading">${icon(s.type === 'jellyfin' ? 'movies' : s.type === 'komga' ? 'comics' : 'book')}<div><h2>${escape(s.name)}</h2><p>${escape(s.type)}</p></div><span class="health ${s.health === 'ready' || s.health === 'reachable' ? 'ready' : ''}">${escape(s.syncing ? 'syncing' : s.health)}</span></div><p class="connection-url">${escape(s.url)}</p><dl><div><dt>Last successful sync</dt><dd>${escape(date(s.last_sync))}</dd></div><div><dt>Last attempt</dt><dd>${escape(date(s.last_attempt))}</dd></div></dl>${s.error ? `<p class="connection-error">${escape(s.error)}</p>` : ''}<div class="connection-actions"><button data-sync="${s.id}" class="primary" ${s.syncing ? 'disabled' : ''}>${s.syncing ? 'Synchronizing…' : 'Synchronize'}</button><button data-test="${s.id}">Test connection</button><button data-edit="${s.id}">Edit</button><button data-clear-artwork="${s.id}">Clear cached covers</button>${s.type === 'komga' ? `<button data-map="${s.id}">Map libraries</button>` : ''}<button data-remove="${s.id}" class="danger">Remove</button></div><div id="library-map-${s.id}"></div></article>`).join('') || '<p class="quiet">No connections yet. Add any one source below to begin.</p>'}</div><section class="connection-form-card"><p class="eyebrow">ONE SOURCE IS ENOUGH TO START</p><h2 id="connection-form-title">Add a connection</h2><form id="connection-form"><input type="hidden" name="id" value=""><div class="form-grid"><label>Service<select name="type" aria-label="Service"><option value="audiobookshelf">Audiobookshelf</option><option value="komga">Komga</option><option value="jellyfin">Jellyfin</option></select></label><label>Display name<input name="name" required maxlength="80" placeholder="My books"></label><label>Server URL<input name="url" aria-label="Server URL" type="url" required placeholder="https://books.example.org" maxlength="2048"><small>Address reachable by the SelfLib container, including the service base path if needed.</small></label><label>Browser URL <span class="quiet">optional</span><input name="publicUrl" aria-label="Browser URL" type="url" placeholder="Same as server URL" maxlength="2048"><small>Address reachable by your browser. Used only for handoff links.</small></label></div><label>API key / user access token<input name="credential" aria-label="API key / user access token" type="password" required autocomplete="new-password" maxlength="4096"><small>Stored encrypted on the server. Never returned to your browser.</small></label><fieldset id="jellyfin-signin" hidden><legend>Or sign in with your Jellyfin viewer account</legend><label>Jellyfin username<input name="jellyfinUsername" autocomplete="off" maxlength="128"></label><label>Jellyfin password<input name="jellyfinPassword" type="password" autocomplete="new-password" maxlength="256"></label><small>Leave the token field blank to sign in. Password is sent to the configured service and is never stored. Test connection also creates a Jellyfin session; revoke unused sessions in Jellyfin.</small></fieldset><p id="auth-help" class="auth-help">${help.audiobookshelf}</p><label class="check"><input name="allowPrivate" type="checkbox">Allow this configured source to use private LAN addresses</label><p class="quiet">Local addresses are intentional and require this approval. Redirects, link-local/metadata addresses, and arbitrary proxy destinations are blocked.</p><div class="form-actions"><button id="test-new" type="button">Test connection</button><button type="submit" class="primary">Save connection</button><button id="cancel-edit" type="button" hidden>Cancel edit</button></div><p id="connection-result" role="status" aria-live="polite"></p></form></section><section class="future"><h2>Coming later</h2><p>Navidrome · Immich · Paperless-ngx · Playnite · RomM</p><span>These integrations are planned and cannot be configured yet.</span></section>`}`;
  main.querySelector('#setup-from-settings')?.addEventListener('click', () => {
    demo = false;
    renderAuth();
  });
  if (!status.authenticated) return;
  const form = main.querySelector<HTMLFormElement>('#connection-form')!;
  const fields = (): Record<string, unknown> & { id?: string; credential?: string } => {
    const v = formValues(form);
    return {
      ...v,
      id: String(v.id || ''),
      credential: String(v.credential || ''),
      allowPrivate: v.allowPrivate === 'on',
      publicUrl: v.publicUrl || undefined,
      jellyfinUsername:
        v.type === 'jellyfin' && v.jellyfinUsername ? v.jellyfinUsername : undefined,
      jellyfinPassword:
        v.type === 'jellyfin' && v.jellyfinPassword ? v.jellyfinPassword : undefined,
    };
  };
  const updateAuth = () => {
    const jellyfin = (form.elements.namedItem('type') as HTMLSelectElement).value === 'jellyfin';
    form.querySelector<HTMLElement>('#jellyfin-signin')!.hidden = !jellyfin;
    form.querySelector<HTMLInputElement>('[name=credential]')!.required =
      !jellyfin && !(form.elements.namedItem('id') as HTMLInputElement).value;
  };
  const reset = () => {
    form.reset();
    form.querySelector<HTMLInputElement>('[name=id]')!.value = '';
    form.querySelector<HTMLInputElement>('[name=credential]')!.required = true;
    main.querySelector('#connection-form-title')!.textContent = 'Add a connection';
    main.querySelector<HTMLButtonElement>('#cancel-edit')!.hidden = true;
    updateAuth();
  };
  form.querySelector<HTMLSelectElement>('[name=type]')!.addEventListener('change', (event) => {
    form.querySelector('#auth-help')!.textContent = help[(event.target as HTMLSelectElement).value];
    updateAuth();
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    busy(form.querySelector<HTMLButtonElement>('[type=submit]')!, async () => {
      const v = fields();
      await api(v.id ? '/sources/' + v.id : '/sources', v.id ? 'PUT' : 'POST', v);
      notice('Connection saved. Synchronize to fill its shelves.');
      await render();
    });
  });
  form.querySelector<HTMLButtonElement>('#test-new')!.addEventListener('click', (event) =>
    busy(event.currentTarget as HTMLButtonElement, async () => {
      const v = fields();
      const result = main.querySelector('#connection-result')!;
      result.textContent = 'Testing…';
      try {
        const r = await api<{ ok: boolean; account?: string }>(
          v.id && !v.credential && !v.jellyfinPassword
            ? '/sources/' + v.id + '/test'
            : '/sources/test',
          'POST',
          v,
        );
        result.textContent = 'Connection succeeded' + (r.account ? ' for ' + r.account : '') + '.';
      } catch (error) {
        result.textContent = (error as Error).message;
      }
    }),
  );
  main.querySelector('#cancel-edit')!.addEventListener('click', reset);
  main.querySelectorAll<HTMLButtonElement>('[data-clear-artwork]').forEach((button) =>
    button.addEventListener('click', () => {
      if (
        confirm(
          'Clear only the downloaded covers for this source? Metadata, favorites, custom artwork and source files are kept. Synchronize to download covers again.',
        )
      )
        busy(button, async () => {
          await api('/sources/' + button.dataset.clearArtwork + '/clear-artwork', 'POST', {});
          notice('Cached source covers cleared. Synchronize to download them again.');
          await render();
        });
    }),
  );
  main.querySelectorAll<HTMLButtonElement>('[data-map]').forEach((button) =>
    button.addEventListener('click', () =>
      busy(button, async () => {
        const source = sources.find((source) => source.id === button.dataset.map)!;
        const root = main.querySelector('#library-map-' + source.id)!;
        const { libraries } = await api<{ libraries: { id: string; name: string }[] }>(
          '/sources/' + source.id + '/libraries',
        );
        root.innerHTML = `<form class="library-mapping"><h3>Choose a room for each Komga library</h3><p>Map by the library in Komga, not by filenames or guessed genres. Save, then synchronize.</p>${libraries
          .map(
            (library) =>
              `<label>${escape(library.name)}<select name="${escape(library.id)}" aria-label="${escape(library.name)} room">${[
                ['', 'Automatic'],
                ['comics', 'Comics'],
                ['manga', 'Manga'],
                ['graphicnovels', 'Graphic novels'],
              ]
                .map(
                  ([value, label]) =>
                    `<option value="${value}" ${source.libraryRooms?.[library.id] === value ? 'selected' : ''}>${label}</option>`,
                )
                .join('')}</select></label>`,
          )
          .join('')}<button type="submit">Save library rooms</button><p role="status"></p></form>`;
        root.querySelector<HTMLFormElement>('form')!.addEventListener('submit', (event) => {
          event.preventDefault();
          const form = event.currentTarget as HTMLFormElement;
          busy(form.querySelector<HTMLButtonElement>('button')!, async () => {
            const libraryRooms = Object.fromEntries(
              Object.entries(formValues(form)).filter(([, room]) => room),
            );
            await api('/sources/' + source.id, 'PUT', {
              type: source.type,
              name: source.name,
              url: source.url,
              publicUrl: source.public_url,
              credential: '',
              allowPrivate: !!source.allow_private,
              libraryRooms,
            });
            source.libraryRooms = libraryRooms as Record<string, string>;
            form.querySelector('[role=status]')!.textContent =
              'Library rooms saved. Synchronize this connection to move its items.';
          });
        });
      }),
    ),
  );
  main.querySelectorAll<HTMLButtonElement>('[data-sync]').forEach((b) =>
    b.addEventListener('click', () =>
      busy(b, async () => {
        await api('/sources/' + b.dataset.sync + '/sync', 'POST', {});
        notice('Synchronization started. Cached browsing remains available.');
        await render();
      }),
    ),
  );
  main.querySelectorAll<HTMLButtonElement>('[data-test]').forEach((b) =>
    b.addEventListener('click', () =>
      busy(b, async () => {
        await api('/sources/' + b.dataset.test + '/test', 'POST', {});
        notice('Connection is reachable.');
        await render();
      }),
    ),
  );
  main.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) =>
    b.addEventListener('click', () => {
      if (confirm('Remove this source and its cached catalog? Your source media is untouched.'))
        busy(b, async () => {
          await api('/sources/' + b.dataset.remove, 'DELETE', {});
          await render();
        });
    }),
  );
  main.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((b) =>
    b.addEventListener('click', () => {
      const s = sources.find((s) => s.id === b.dataset.edit)!;
      for (const [name, value] of Object.entries({
        id: s.id,
        type: s.type,
        name: s.name,
        url: s.url,
        publicUrl: s.public_url,
        credential: '',
        jellyfinUsername: '',
        jellyfinPassword: '',
      })) {
        (form.elements.namedItem(name) as HTMLInputElement).value = value;
      }
      (form.elements.namedItem('allowPrivate') as HTMLInputElement).checked = !!s.allow_private;
      form.querySelector<HTMLInputElement>('[name=credential]')!.required = false;
      updateAuth();
      form.querySelector<HTMLInputElement>('[name=credential]')!.placeholder =
        'Leave blank to keep the stored credential';
      main.querySelector('#auth-help')!.textContent = help[s.type];
      main.querySelector('#connection-form-title')!.textContent = 'Edit connection';
      main.querySelector<HTMLButtonElement>('#cancel-edit')!.hidden = false;
      form.scrollIntoView({ behavior: 'smooth' });
    }),
  );
  if (sources.some((s) => s.syncing)) poll = setTimeout(() => void render(), 2000);
}
function renderAuth() {
  clearTimeout(poll);
  app.innerHTML = `<div class="auth-page"><div class="auth-brand">${icon('book')} SelfLib</div><section class="auth-story"><p class="eyebrow">A LIBRARY OF YOUR OWN</p><h1>All your stories.<br><em>Under one roof.</em></h1><p>A quiet, beautiful place for the books, films,<br>and collections that mean something to you.</p><div class="auth-mini-shelf" aria-hidden="true"><span></span><span></span><span></span><span></span><span></span></div><button id="explore-demo">Explore the demo library ${icon('arrow')}</button><small>Fictional collections. No account or credentials required.</small></section><section class="auth-card"><p class="eyebrow">${status.setupRequired ? 'FIRST-RUN SETUP' : 'WELCOME BACK'}</p><h2>${status.setupRequired ? 'Make this library yours' : 'Open your library'}</h2><p>${status.setupRequired ? 'Create the single owner account. You can connect your collections next.' : 'Sign in to browse your personal collections.'}</p><form id="auth-form"><label>Username<input name="username" required minlength="3" maxlength="64" autocomplete="username" pattern="[A-Za-z0-9_.-]+"></label><label>Password<input name="password" aria-label="Password" type="password" required minlength="12" maxlength="128" autocomplete="${status.setupRequired ? 'new-password' : 'current-password'}"><small>At least 12 characters.</small></label>${status.setupRequired ? '<label>Setup token<input name="setupToken" aria-label="Setup token" type="password" required autocomplete="off"><small>Read it with: <code>docker compose exec selflib cat /data/setup.token</code>. The token protects first-run ownership.</small></label>' : ''}<button class="primary" type="submit">${status.setupRequired ? 'Create owner account' : 'Sign in'} ${icon('arrow')}</button><p id="auth-error" role="alert"></p></form><p class="auth-local">Local authentication · No cloud account · No telemetry</p></section></div>`;
  app.querySelector('#explore-demo')!.addEventListener('click', () => {
    demo = true;
    page = 'home';
    void render();
  });
  app.querySelector<HTMLFormElement>('#auth-form')!.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    busy(form.querySelector('button')!, async () => {
      try {
        const response = await api<{ csrf: string }>(
          status.setupRequired ? '/setup' : '/login',
          'POST',
          formValues(form),
        );
        status.csrf = response.csrf;
        status = await api<Status>('/status');
        demo = false;
        page = 'home';
        await render();
      } catch (error) {
        form.querySelector('#auth-error')!.textContent = (error as Error).message;
      }
    });
  });
}
async function boot() {
  try {
    status = await api<Status>('/status');
    if (status.authenticated) {
      page = 'home';
      await render();
    } else renderAuth();
  } catch (error) {
    app.innerHTML = `<div class="empty"><h1>SelfLib couldn’t start</h1><p>${escape((error as Error).message)}</p><p>Check the server and reload this page.</p></div>`;
  }
}
void boot();

async function imagePayload(form: HTMLFormElement) {
  const file = (form.elements.namedItem('image') as HTMLInputElement).files?.[0];
  if (
    !file ||
    !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) ||
    file.size > 512 * 1024
  )
    throw new Error('Choose a PNG, JPEG or WebP image of at most 512 KiB.');
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.readAsDataURL(file);
  });
  return { mime: file.type, base64 };
}
