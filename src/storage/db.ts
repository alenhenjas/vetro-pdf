import type { ImageAsset, ProjectData } from '../model/types';

/** IndexedDB: file recenti (con handle), bozze automatiche, copie degli originali. */
const DB_NAME = 'vetro-pdf';
const STORES = ['recents', 'drafts', 'draftAssets', 'backups'] as const;
type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      for (const s of STORES) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const get = <T,>(store: StoreName, key: string) => run<T | undefined>(store, 'readonly', (s) => s.get(key));
const put = (store: StoreName, key: string, value: unknown) => run(store, 'readwrite', (s) => s.put(value, key));
const del = (store: StoreName, key: string) => run(store, 'readwrite', (s) => s.delete(key));
const all = <T,>(store: StoreName) => run<T[]>(store, 'readonly', (s) => s.getAll());
const keys = (store: StoreName) => run(store, 'readonly', (s) => s.getAllKeys()) as Promise<string[]>;

export interface RecentFile {
  docKey: string;
  name: string;
  handle: FileSystemFileHandle | null;
  pages: number;
  openedAt: number;
  thumbnail?: string;
}

export interface Draft {
  docKey: string;
  name: string;
  savedAt: number;
  project: ProjectData;
}

const MAX_RECENTS = 12;
const MAX_BACKUPS = 30;

export async function listRecents(): Promise<RecentFile[]> {
  const list = await all<RecentFile>('recents');
  return list.sort((a, b) => b.openedAt - a.openedAt);
}

export async function saveRecent(entry: RecentFile) {
  await put('recents', entry.docKey, entry);
  const list = await listRecents();
  for (const old of list.slice(MAX_RECENTS)) await del('recents', old.docKey);
}

export const removeRecent = (docKey: string) => del('recents', docKey);

export async function writeDraft(draft: Draft, assets: ImageAsset[]) {
  const existing = new Set(await keys('draftAssets'));
  for (const asset of assets) {
    const key = `${draft.docKey}/${asset.id}`;
    if (!existing.has(key)) await put('draftAssets', key, asset);
  }
  await put('drafts', draft.docKey, draft);
}

export const readDraft = (docKey: string) => get<Draft>('drafts', docKey);

export async function readDraftAssets(docKey: string): Promise<ImageAsset[]> {
  const prefix = `${docKey}/`;
  const list = (await keys('draftAssets')).filter((k) => k.startsWith(prefix));
  const assets = await Promise.all(list.map((k) => get<ImageAsset>('draftAssets', k)));
  return assets.filter((a): a is ImageAsset => !!a);
}

export async function deleteDraft(docKey: string) {
  await del('drafts', docKey);
  for (const k of await keys('draftAssets')) if (k.startsWith(`${docKey}/`)) await del('draftAssets', k);
}

export async function listDraftKeys() {
  return new Set(await keys('drafts'));
}

interface Backup {
  docKey: string;
  name: string;
  savedAt: number;
  bytes: Uint8Array;
}

export const readBackup = (docKey: string) => get<Backup>('backups', docKey);

export async function hasBackup(docKey: string) {
  return (await keys('backups')).includes(docKey);
}

export async function writeBackup(backup: Backup) {
  await put('backups', backup.docKey, backup);
  const existing = await all<Backup>('backups');
  if (existing.length > MAX_BACKUPS) {
    const oldest = existing.sort((a, b) => a.savedAt - b.savedAt).slice(0, existing.length - MAX_BACKUPS);
    for (const b of oldest) await del('backups', b.docKey);
  }
}
