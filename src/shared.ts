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
  kind: 'book' | 'audiobook' | 'comic' | 'movie' | 'show' | 'episode';
  title: string;
  creator: string;
  description: string;
  series?: string;
  artworkPath?: string;
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
export interface ItemView extends Omit<CatalogItem, 'artworkPath'> {
  id: string;
  favorite: boolean;
  artwork: boolean;
  demo: boolean;
  sourceName: string;
}
