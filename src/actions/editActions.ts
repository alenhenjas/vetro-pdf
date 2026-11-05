import { frame, newId, translate, unionRects } from '../model/geometry';
import { ensureFont, layoutText } from '../model/textLayout';
import type { Annotation, ImageAsset, ImageAnnotation, TextAnnotation } from '../model/types';
import { addAsset } from '../pdf/session';
import { addAnnotations, findAnnotations, removeAnnotations, useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';

/* ---- Appunti interni ---- */

let clipboard: Annotation[] = [];
let pasteCount = 0;

export const CLIP_MIME = 'application/x-vetro-pdf';

export function copySelection(data?: DataTransfer | null) {
  const list = findAnnotations(useDoc.getState().selection);
  if (!list.length) return false;
  clipboard = list;
  pasteCount = 0;
  if (data) {
    data.setData(CLIP_MIME, '1');
    data.setData('text/plain', list.filter((a) => a.kind === 'text').map((a) => (a as TextAnnotation).text).join('\n'));
  }
  return true;
}

/** Incolla nella pagina corrente: se è la stessa di origine, con un piccolo scarto. */
export function pasteClipboard() {
  if (!clipboard.length) return;
  pasteCount++;
  const page = useUi.getState().currentPage;
  const size = useDoc.getState().doc!.pageSizes[page];
  const box = unionRects(clipboard.map(frame));
  const sameBox = clipboard[0].page === page;
  const dx = sameBox ? 14 * pasteCount : (size.w - box.w) / 2 - box.x;
  const dy = sameBox ? 14 * pasteCount : (size.h - box.h) / 2 - box.y + 14 * (pasteCount - 1);
  addAnnotations(clipboard.map((a) => ({ ...translate(a, dx, dy), id: newId(), page })));
}

export function duplicateSelection() {
  const list = findAnnotations(useDoc.getState().selection);
  if (list.length) addAnnotations(list.map((a) => ({ ...translate(a, 14, 14), id: newId() })));
}

export function deleteSelection() {
  removeAnnotations(useDoc.getState().selection);
}

/* ---- Immagini ---- */

function exifOrientation(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0) !== 0xffd8) return 1;
  let offset = 2;
  while (offset + 4 < view.byteLength) {
    const marker = view.getUint16(offset);
    const size = view.getUint16(offset + 2);
    if (marker === 0xffe1 && view.getUint32(offset + 4) === 0x45786966) {
      const tiff = offset + 10;
      const little = view.getUint16(tiff) === 0x4949;
      const entries = view.getUint16(tiff + view.getUint32(tiff + 4, little), little);
      const dir = tiff + view.getUint32(tiff + 4, little) + 2;
      for (let i = 0; i < entries; i++) {
        if (view.getUint16(dir + i * 12, little) === 0x0112) return view.getUint16(dir + i * 12 + 8, little);
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00) return 1;
    offset += 2 + size;
  }
  return 1;
}

async function digest(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** PNG e JPEG restano byte per byte; gli altri formati (WebP, GIF, BMP…) diventano PNG. */
async function toAsset(blob: Blob): Promise<ImageAsset> {
  let bytes = new Uint8Array(await blob.arrayBuffer());
  let mime: ImageAsset['mime'] = blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png';
  const bitmap = await createImageBitmap(blob);
  const { width, height } = bitmap;
  const rotated = blob.type === 'image/jpeg' && exifOrientation(bytes) > 1;
  if (rotated || (blob.type !== 'image/jpeg' && blob.type !== 'image/png')) {
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
    const encoded = await canvas.convertToBlob(rotated ? { type: 'image/jpeg', quality: 0.95 } : { type: 'image/png' });
    bytes = new Uint8Array(await encoded.arrayBuffer());
    mime = rotated ? 'image/jpeg' : 'image/png';
  }
  bitmap.close();
  return { id: await digest(bytes), bytes, mime, width, height };
}

/** Inserisce un'immagine accanto al punto indicato, o al centro della pagina visibile. */
export async function insertImages(blobs: Blob[], at?: { page: number; x: number; y: number } | null) {
  const { doc, margins } = useDoc.getState();
  const ui = useUi.getState();
  if (!doc) return;
  const placed: ImageAnnotation[] = [];
  for (const blob of blobs) {
    let asset: ImageAsset;
    try {
      asset = await toAsset(blob);
    } catch {
      ui.toast('Formato immagine non supportato', 'error');
      continue;
    }
    addAsset(asset);
    const page = at?.page ?? ui.currentPage;
    const size = doc.pageSizes[page];
    const limitW = size.w * 0.6;
    const limitH = size.h * 0.6;
    // Gli screenshot arrivano a 96 dpi: 1 pixel ≈ 0.75 pt.
    const fit = Math.min(1, limitW / (asset.width * 0.75), limitH / (asset.height * 0.75));
    const w = asset.width * 0.75 * fit;
    const h = asset.height * 0.75 * fit;
    const pageW = size.w + (margins[page] ?? 0);
    const cascade = placed.length * 18;
    const x = at ? Math.min(at.x + 10 + cascade, pageW - w) : (pageW - w) / 2 + cascade;
    const y = at ? Math.min(at.y + 10 + cascade, size.h - h) : (size.h - h) / 2 + cascade;
    placed.push({
      id: newId(), page, kind: 'image', assetId: asset.id,
      x: Math.max(0, x), y: Math.max(0, y), w, h, rotation: 0,
    });
  }
  if (placed.length) {
    addAnnotations(placed);
    useUi.getState().setTool('select');
  }
}

export const visiblePointer = () => {
  const { pointer } = useUi.getState();
  const el = pointer && document.querySelector(`[data-page="${pointer.page}"]`);
  return el ? pointer : null;
};

export function pickImages() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;
  input.onchange = () => {
    const files = [...(input.files ?? [])];
    if (files.length) void insertImages(files, null);
  };
  input.click();
}

export function insertPlainText(text: string) {
  const ui = useUi.getState();
  const at = visiblePointer();
  const page = at?.page ?? ui.currentPage;
  const size = useDoc.getState().doc!.pageSizes[page];
  const style = ui.prefs.text;
  void ensureFont(style).then(() => {
    const draft: TextAnnotation = {
      id: newId(), page, kind: 'text', text,
      x: at ? at.x : size.w * 0.2, y: at ? at.y : size.h * 0.3, w: Math.min(320, size.w * 0.6), h: 0, style,
    };
    const h = layoutText(draft).contentHeight;
    addAnnotations([{ ...draft, h }]);
  });
}

/** Handler dell'evento paste globale. */
export function handlePaste(e: ClipboardEvent) {
  const data = e.clipboardData;
  if (!data || !useDoc.getState().doc) return;
  if (data.types.includes(CLIP_MIME)) {
    e.preventDefault();
    pasteClipboard();
    return;
  }
  const images = [...data.items]
    .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
    .map((i) => i.getAsFile())
    .filter((f): f is File => !!f);
  if (images.length) {
    e.preventDefault();
    void insertImages(images, visiblePointer());
    return;
  }
  const text = data.getData('text/plain');
  if (text.trim()) {
    e.preventDefault();
    insertPlainText(text);
  }
}

