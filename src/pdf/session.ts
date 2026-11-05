import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ImageAsset, PageSize } from '../model/types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

const asset = (path: string) => new URL(`${import.meta.env.BASE_URL}pdfjs/${path}/`, location.href).href;

/** Dati del documento aperto che non stanno nello store: binari e proxy di pdf.js. */
export const session: {
  pdf: PDFDocumentProxy | null;
  base: Uint8Array | null;
  assets: Map<string, ImageAsset>;
  assetUrls: Map<string, string>;
} = { pdf: null, base: null, assets: new Map(), assetUrls: new Map() };

export function addAsset(a: ImageAsset) {
  if (session.assets.has(a.id)) return;
  session.assets.set(a.id, a);
  session.assetUrls.set(a.id, URL.createObjectURL(new Blob([a.bytes as BlobPart], { type: a.mime })));
}

let loadingTask: ReturnType<typeof pdfjs.getDocument> | null = null;

export async function loadPdf(base: Uint8Array) {
  await closeSession();
  const task = pdfjs.getDocument({
    data: base.slice(),
    cMapUrl: asset('cmaps'),
    cMapPacked: true,
    standardFontDataUrl: asset('standard_fonts'),
    wasmUrl: asset('wasm'),
    iccUrl: asset('iccs'),
    enableXfa: false,
  });
  loadingTask = task;
  const pdf = await task.promise;
  session.pdf = pdf;
  session.base = base;
  return pdf;
}

export async function closeSession() {
  resetRenderer();
  textCache.clear();
  const old = loadingTask;
  loadingTask = null;
  session.pdf = null;
  session.base = null;
  for (const url of session.assetUrls.values()) URL.revokeObjectURL(url);
  session.assets = new Map();
  session.assetUrls = new Map();
  await old?.destroy();
}

export async function readPageSizes(pdf: PDFDocumentProxy, onProgress?: (done: number) => void): Promise<PageSize[]> {
  const sizes: PageSize[] = new Array(pdf.numPages);
  const batch = 32;
  for (let start = 0; start < pdf.numPages; start += batch) {
    const end = Math.min(pdf.numPages, start + batch);
    await Promise.all(Array.from({ length: end - start }, async (_, k) => {
      const page = await pdf.getPage(start + k + 1);
      const vp = page.getViewport({ scale: 1 });
      sizes[start + k] = { w: vp.width, h: vp.height };
    }));
    onProgress?.(end);
  }
  return sizes;
}

/* ---- Rendering: coda con priorità, massimo due pagine alla volta, cache LRU ---- */

const MAX_PIXELS = 16_000_000;
const CACHE_SIZE = 10;
const cache = new Map<string, HTMLCanvasElement>();

interface Job {
  page: number;
  key: string;
  run: () => Promise<void>;
  cancelled: boolean;
  task?: RenderTask;
}
const queue: Job[] = [];
let active = 0;
let focusPage = 0;

export const setRenderFocus = (page: number) => { focusPage = page; };

function pump() {
  while (active < 2 && queue.length) {
    queue.sort((a, b) => Math.abs(a.page - focusPage) - Math.abs(b.page - focusPage));
    const job = queue.shift()!;
    if (job.cancelled) continue;
    active++;
    job.run().finally(() => {
      active--;
      pump();
    });
  }
}

function resetRenderer() {
  queue.length = 0;
  cache.clear();
}

export function pixelScale(size: PageSize, scale: number) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const wanted = scale * dpr;
  const limit = Math.sqrt(MAX_PIXELS / (size.w * size.h));
  return Math.round(Math.min(wanted, limit) * 100) / 100;
}

export function renderPage(index: number, px: number, onDone: (c: HTMLCanvasElement) => void) {
  const key = `${index}@${px}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    onDone(hit);
    return () => undefined;
  }
  const job: Job = {
    page: index,
    key,
    cancelled: false,
    run: async () => {
      const pdf = session.pdf;
      if (!pdf || job.cancelled) return;
      const page: PDFPageProxy = await pdf.getPage(index + 1);
      if (job.cancelled) return;
      const viewport = page.getViewport({ scale: px });
      const canvas = document.createElement('canvas');
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      try {
        job.task = page.render({ canvas, viewport, background: '#ffffff' });
        await job.task.promise;
      } catch {
        return; // Rendering annullato o pagina non disegnabile.
      }
      cache.set(key, canvas);
      for (const k of cache.keys()) {
        if (cache.size <= CACHE_SIZE) break;
        cache.delete(k);
      }
      if (!job.cancelled) onDone(canvas);
    },
  };
  queue.push(job);
  pump();
  return () => {
    job.cancelled = true;
    job.task?.cancel();
  };
}

/* ---- Miniature ---- */

const THUMB_WIDTH = 320;
const thumbs = new Map<number, string>();
let thumbChain: Promise<unknown> = Promise.resolve();

export const resetThumbs = () => {
  for (const url of thumbs.values()) URL.revokeObjectURL(url);
  thumbs.clear();
};

export function requestThumb(index: number, isWanted: () => boolean): Promise<string | null> {
  const hit = thumbs.get(index);
  if (hit) return Promise.resolve(hit);
  const result = thumbChain.then(async () => {
    const pdf = session.pdf;
    if (!pdf || !isWanted()) return null;
    const page = await pdf.getPage(index + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: THUMB_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.8));
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    thumbs.set(index, url);
    return url;
  }).catch(() => null);
  thumbChain = result;
  return result;
}

/* ---- Testo delle pagine (ricerca e aggancio della sottolineatura) ---- */

export interface TextItem {
  str: string;
  /** Vertici in spazio visivo: inizio baseline, fine baseline, altezza. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  height: number;
  start: number;
}
export interface PageText {
  text: string;
  items: TextItem[];
}

const textCache = new Map<number, Promise<PageText>>();

export function pageText(index: number): Promise<PageText> {
  let p = textCache.get(index);
  if (!p) {
    p = (async () => {
      const pdf = session.pdf!;
      const page = await pdf.getPage(index + 1);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const items: TextItem[] = [];
      let text = '';
      for (const raw of content.items) {
        if (!('str' in raw)) continue;
        const [a, b, , , e, f] = raw.transform as number[];
        const norm = Math.hypot(a, b) || 1;
        const [x0, y0] = viewport.convertToViewportPoint(e, f);
        const [x1, y1] = viewport.convertToViewportPoint(e + (a / norm) * raw.width, f + (b / norm) * raw.width);
        items.push({ str: raw.str, x0, y0, x1, y1, height: raw.height || norm, start: text.length });
        text += raw.str + (raw.hasEOL ? ' ' : '');
      }
      return { text, items };
    })();
    textCache.set(index, p);
  }
  return p;
}
