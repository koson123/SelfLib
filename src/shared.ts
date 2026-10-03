export type SourceType = 'audiobookshelf' | 'komga' | 'jellyfin';
export type Section = 'books' | 'comics' | 'movies';
export type Capability = 'supported' | 'unsupported';
export interface Progress {
  fraction: number;
  position?: number;
  unit: 'seconds' | 'pages' | 'fraction';
  updatedAt?: string;
}
export interface CatalogItem {
  sourceId: string;
  sourceItemId: string;
  section: Section;
  kind: 'book' | 'audiobook' | 'comic' | 'manga' | 'graphicnovel' | 'movie' | 'show' | 'episode';
  title: string;
  creator: string;
  description: string;
  series?: string;
  /** Authoritative upstream series identity; never group by title. */
  parentSourceItemId?: string;
  seasonNumber?: number;
  episodeNumber?: number;
  libraryId?: string;
  libraryName?: string;
  artworkPath?: string;
  artworkFallbackPath?: string;
  progress?: Progress;
  actions: { open: Capability; progress: Capability; embeddedPlayback: 'unsupported' };
}
export interface SourceConfig {
  id: string;
  type: SourceType;
  name: string;
  url: string;
  publicUrl: string;
  credential: string;
  allowPrivate: boolean;
  libraryRooms?: Record<string, 'comics' | 'manga' | 'graphicnovels'>;
}
export interface Page {
  items: CatalogItem[];
  nextCursor?: string;
}
export interface Adapter {
  type: SourceType;
  capabilities: {
    catalog: Capability;
    artwork: Capability;
    progress: Capability;
    open: Capability;
  };
  health(): Promise<{ version?: string; account?: string }>;
  page(cursor?: string): Promise<Page>;
  artwork(item: CatalogItem): Promise<{ bytes: Uint8Array; mime: string } | undefined>;
  handoff(item: CatalogItem): string;
}
export interface ItemView extends Omit<CatalogItem, 'artworkPath' | 'artworkFallbackPath'> {
  id: string;
  favorite: boolean;
  artwork: boolean;
  customCover?: boolean;
  customSpine?: boolean;
  demo: boolean;
  sourceName: string;
  episodeCount?: number;
  resumeEpisode?: { id: string; title: string; progress: Progress };
}

/** Presentation rooms are separate from the stable source section identity. */
export const shelfCategories = [
  'books',
  'audiobooks',
  'comics',
  'manga',
  'graphicnovels',
  'movies',
  'shows',
] as const;
export type ShelfCategory = (typeof shelfCategories)[number];
export const categoryKinds: Record<ShelfCategory, CatalogItem['kind'][]> = {
  books: ['book'],
  audiobooks: ['audiobook'],
  comics: ['comic'],
  manga: ['manga'],
  graphicnovels: ['graphicnovel'],
  movies: ['movie'],
  shows: ['show', 'episode'],
};
export function shelfCategory(item: Pick<CatalogItem, 'kind'>): ShelfCategory {
  return shelfCategories.find((category) => categoryKinds[category].includes(item.kind))!;
}
