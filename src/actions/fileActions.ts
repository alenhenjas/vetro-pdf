import { exportPdf, parsePdf } from '../export/client';
import type { ExportRequest } from '../export/exportPdf';
import { layoutText, ensureFont } from '../model/textLayout';
import type { AnnotationMap, ImageAsset, MarginMap, ProjectData, TextLayout } from '../model/types';
import { addAsset, closeSession, loadPdf, readPageSizes, resetThumbs, session } from '../pdf/session';
import {
  deleteDraft, hasBackup, readBackup, readDraft, readDraftAssets, saveRecent, writeBackup, writeDraft,
  type RecentFile,
} from '../storage/db';
import { isDirty, useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { finishTextEditing } from '../tools/usePagePointer';

const PDF_TYPES = [{ description: 'Documenti PDF', accept: { 'application/pdf': ['.pdf'] as `.${string}`[] } }];

export const hasFileSystemAccess = () => 'showOpenFilePicker' in window;

const ui = () => useUi.getState();

async function sha256(bytes: Uint8Array) {
  const hash = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---- Apertura ---- */

export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty()) return true;
  const choice = await ui().ask({
    title: 'Modifiche non salvate',
    message: `Vuoi salvare le modifiche a «${useDoc.getState().doc?.name}» prima di continuare?`,
    actions: [
      { id: 'cancel', label: 'Annulla' },
      { id: 'discard', label: 'Non salvare', tone: 'danger' },
      { id: 'save', label: 'Salva', tone: 'primary' },
    ],
  });
  if (choice === 'cancel') return false;
  if (choice === 'save') return saveDocument();
  await removeCurrentDraft();
  return true;
}

function pickFileFallback(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/pdf,.pdf';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export async function openWithPicker() {
  if (!hasFileSystemAccess()) {
    const file = await pickFileFallback();
    if (file) await openFile(file, null);
    return;
  }
  try {
    const [handle] = await window.showOpenFilePicker({ types: PDF_TYPES, multiple: false });
    await openHandle(handle);
  } catch (err) {
    if ((err as Error).name !== 'AbortError') ui().toast(`Impossibile aprire il file: ${(err as Error).message}`, 'error');
  }
}

async function ensurePermission(handle: FileSystemFileHandle, mode: 'read' | 'readwrite') {
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export async function openHandle(handle: FileSystemFileHandle) {
  if (!(await ensurePermission(handle, 'read'))) {
    ui().toast('Permesso di lettura negato', 'error');
    return;
  }
  await openFile(await handle.getFile(), handle);
}

export async function openRecent(recent: RecentFile) {
  if (!recent.handle) {
    await openWithPicker();
    return;
  }
  try {
    await openHandle(recent.handle);
  } catch {
    ui().toast('File non trovato: forse è stato spostato o eliminato', 'error');
  }
}

export async function openFile(file: File, handle: FileSystemFileHandle | null) {
  if (!(await confirmDiscard())) return;
  ui().set({ busy: 'Apertura…' });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await openBytes(bytes, file.name, handle, file.lastModified);
  } catch (err) {
    ui().toast(`Impossibile aprire «${file.name}»: ${(err as Error).message}`, 'error');
  } finally {
    ui().set({ busy: null });
  }
}

async function loadTextFonts(annotations: AnnotationMap) {
  const styles = new Map<string, { font: string; bold: boolean; italic: boolean }>();
  for (const list of Object.values(annotations)) {
    for (const a of list) if (a.kind === 'text') styles.set(`${a.style.font}|${a.style.bold}|${a.style.italic}`, a.style);
  }
  await Promise.all([...styles.values()].map(ensureFont));
}

async function openBytes(bytes: Uint8Array, name: string, handle: FileSystemFileHandle | null, lastModified: number | null, forceDirty = false) {
  const hash = await sha256(bytes);
  const parsed = await parsePdf(bytes);
  if (parsed.encrypted) {
    ui().toast('Questo PDF è protetto da password: Vetro PDF non può modificarlo', 'error');
    return;
  }
  const pdf = await loadPdf(parsed.base);
  resetThumbs();
  const pageSizes = await readPageSizes(pdf, (done) => {
    if (pdf.numPages > 64) ui().set({ busy: `Apertura… ${done}/${pdf.numPages}` });
  });
  for (const asset of parsed.assets) addAsset(asset);

  const annotations = parsed.project?.annotations ?? {};
  const margins = parsed.project?.margins ?? {};
  await loadTextFonts(annotations);

  const docKey = parsed.docId ?? hash;
  ui().set({ currentPage: 0, searchOpen: false, live: null, pointer: null });
  ui().setTool('select');
  useDoc.getState().setDoc({ name, docKey, openId: Date.now(), handle, pageSizes, lastModified }, { annotations, margins });
  if (forceDirty) useDoc.getState().commit(() => ({}));

  if (parsed.lostPages) {
    ui().toast(`${parsed.lostPages} pagine sono state riscritte da un altro programma: lì le annotazioni non sono più modificabili`, 'info');
  }
  void rememberRecent(name, docKey, handle, pdf.numPages);
  await offerDraft(docKey);
}

async function rememberRecent(name: string, docKey: string, handle: FileSystemFileHandle | null, pages: number) {
  let thumbnail: string | undefined;
  try {
    const page = await session.pdf!.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 240 / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvas, viewport, background: '#ffffff' }).promise;
    thumbnail = canvas.toDataURL('image/jpeg', 0.7);
  } catch { /* la miniatura è facoltativa */ }
  await saveRecent({ docKey, name, handle, pages, openedAt: Date.now(), thumbnail }).catch(() => undefined);
}

async function offerDraft(docKey: string) {
  const draft = await readDraft(docKey).catch(() => undefined);
  if (!draft) return;
  const when = new Date(draft.savedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  const choice = await ui().ask({
    title: 'Bozza ritrovata',
    message: `C'è una bozza non salvata di questo documento (${when}). Vuoi ripristinarla?`,
    actions: [
      { id: 'discard', label: 'Scarta', tone: 'danger' },
      { id: 'restore', label: 'Ripristina', tone: 'primary' },
    ],
  });
  if (choice === 'discard') {
    await deleteDraft(docKey);
    return;
  }
  for (const asset of await readDraftAssets(docKey)) addAsset(asset);
  await loadTextFonts(draft.project.annotations);
  useDoc.getState().commit(() => ({ annotations: draft.project.annotations, margins: draft.project.margins }));
}

/** PDF trascinato: se il browser lo consente si tiene il riferimento al file, così Ctrl+S sovrascrive l'originale. */
export async function openDropped(e: { dataTransfer: DataTransfer }) {
  const item = [...e.dataTransfer.items].find((i) => i.kind === 'file');
  const file = e.dataTransfer.files[0];
  if (!file) return;
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    ui().toast('Trascina un file PDF', 'error');
    return;
  }
  const pending = (item as (DataTransferItem & {
    getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
  }) | undefined)?.getAsFileSystemHandle?.();
  const handle = await pending?.catch(() => null);
  if (handle?.kind === 'file') {
    if (await confirmDiscard()) await openHandle(handle as FileSystemFileHandle);
  } else {
    await openFile(file, null);
  }
}

export async function closeDocument() {
  if (!(await confirmDiscard())) return;
  useDoc.getState().setDoc(null);
  await closeSession();
  resetThumbs();
}

/* ---- Salvataggio ---- */

function cleanAnnotations(annotations: AnnotationMap) {
  const out: AnnotationMap = {};
  for (const [page, list] of Object.entries(annotations)) {
    const kept = list.filter((a) => a.kind !== 'text' || a.text.trim());
    if (kept.length) out[+page] = kept;
  }
  return out;
}

function roundInk(annotations: AnnotationMap) {
  const out: AnnotationMap = {};
  for (const [page, list] of Object.entries(annotations)) {
    out[+page] = list.map((a) => (a.kind === 'ink'
      ? { ...a, points: a.points.map((v) => Math.round(v * 100) / 100) }
      : a));
  }
  return out;
}

function usedAssets(annotations: AnnotationMap): ImageAsset[] {
  const ids = new Set<string>();
  for (const list of Object.values(annotations)) for (const a of list) if (a.kind === 'image') ids.add(a.assetId);
  return [...ids].map((id) => session.assets.get(id)).filter((a): a is ImageAsset => !!a);
}

function currentProject(annotations: AnnotationMap, margins: MarginMap): ProjectData {
  const positive: MarginMap = {};
  for (const [p, m] of Object.entries(margins)) if (m > 0) positive[+p] = m;
  return { version: 1, annotations: roundInk(cleanAnnotations(annotations)), margins: positive };
}

async function buildPdf(): Promise<Uint8Array> {
  const { doc, annotations, margins } = useDoc.getState();
  if (!doc || !session.base) throw new Error('Nessun documento aperto');
  const project = currentProject(annotations, margins);
  await loadTextFonts(project.annotations);

  const layouts: Record<string, TextLayout> = {};
  for (const list of Object.values(project.annotations)) {
    for (const a of list) if (a.kind === 'text') layouts[a.id] = layoutText(a);
  }
  const request: ExportRequest = {
    base: session.base.slice().buffer,
    docId: doc.docKey,
    pageSizes: doc.pageSizes,
    project,
    assets: usedAssets(project.annotations),
    layouts,
  };
  const result = await exportPdf(request);
  if (result.missingChars.length) {
    ui().toast(`Caratteri non disponibili nei font, sostituiti con «?»: ${result.missingChars.join(' ')}`, 'error');
  }
  return result.bytes;
}

async function writeToHandle(handle: FileSystemFileHandle, bytes: Uint8Array) {
  const writable = await handle.createWritable();
  await writable.write(bytes as FileSystemWriteChunkType);
  await writable.close();
}

function downloadBytes(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function finishEditing() {
  finishTextEditing();
  const s = useDoc.getState();
  if (s.txBase) s.endTx();
}

function afterSave(rev: number) {
  useDoc.getState().markSaved(rev);
  void removeCurrentDraft();
}

export async function saveDocument(): Promise<boolean> {
  if (ui().saving) return false;
  finishEditing();
  const { doc, rev } = useDoc.getState();
  if (!doc) return false;

  if (!doc.handle) {
    if (hasFileSystemAccess()) return saveAs(true);
    ui().set({ saving: true });
    try {
      downloadBytes(await buildPdf(), doc.name);
      afterSave(rev);
      ui().toast('PDF scaricato', 'success');
      return true;
    } catch (err) {
      ui().toast(`Salvataggio non riuscito: ${(err as Error).message}`, 'error');
      return false;
    } finally {
      ui().set({ saving: false });
    }
  }

  const handle = doc.handle;
  ui().set({ saving: true });
  try {
    if (!(await ensurePermission(handle, 'readwrite'))) {
      ui().toast('Permesso di scrittura negato: usa «Salva con nome»', 'error');
      return false;
    }
    const onDisk = await handle.getFile();
    if (doc.lastModified && onDisk.lastModified !== doc.lastModified) {
      const choice = await ui().ask({
        title: 'File modificato altrove',
        message: 'Un altro programma ha modificato questo PDF dopo l\'apertura. Sovrascrivendo perderai quelle modifiche.',
        actions: [
          { id: 'cancel', label: 'Annulla' },
          { id: 'overwrite', label: 'Sovrascrivi', tone: 'danger' },
        ],
      });
      if (choice !== 'overwrite') return false;
    }
    const bytes = await buildPdf();
    if (!(await hasBackup(doc.docKey))) {
      await writeBackup({
        docKey: doc.docKey, name: doc.name, savedAt: Date.now(),
        bytes: new Uint8Array(await onDisk.arrayBuffer()),
      });
    }
    await writeToHandle(handle, bytes);
    const after = await handle.getFile();
    useDoc.getState().patchDoc({ lastModified: after.lastModified });
    afterSave(rev);
    ui().toast('Salvato', 'success');
    return true;
  } catch (err) {
    const e = err as Error;
    const locked = e.name === 'NoModificationAllowedError' || e.name === 'InvalidStateError';
    ui().toast(locked
      ? 'Il file è bloccato da un altro programma. Chiudilo e riprova, oppure usa «Salva con nome».'
      : `Salvataggio non riuscito: ${e.message}`, 'error');
    return false;
  } finally {
    ui().set({ saving: false });
  }
}

/** Crea una copia. Con `adopt` (documento senza file) la copia diventa il file in uso. */
export async function saveAs(adopt = false): Promise<boolean> {
  finishEditing();
  const { doc, rev } = useDoc.getState();
  if (!doc) return false;
  const suggestedName = adopt ? doc.name : doc.name.replace(/\.pdf$/i, '') + ' - copia.pdf';
  try {
    ui().set({ saving: true });
    if (!('showSaveFilePicker' in window)) {
      downloadBytes(await buildPdf(), suggestedName);
      ui().toast('Copia scaricata', 'success');
      return true;
    }
    const handle = await window.showSaveFilePicker({ suggestedName, types: PDF_TYPES });
    await writeToHandle(handle, await buildPdf());
    if (adopt) {
      const file = await handle.getFile();
      useDoc.getState().patchDoc({ handle, name: file.name, lastModified: file.lastModified });
      afterSave(rev);
    }
    ui().toast(adopt ? 'Salvato' : 'Copia salvata', 'success');
    return true;
  } catch (err) {
    if ((err as Error).name !== 'AbortError') ui().toast(`Salvataggio non riuscito: ${(err as Error).message}`, 'error');
    return false;
  } finally {
    ui().set({ saving: false });
  }
}

export async function restoreOriginal() {
  const { doc } = useDoc.getState();
  if (!doc) return;
  const backup = await readBackup(doc.docKey);
  if (!backup) {
    ui().toast('Nessuna copia dell\'originale: il file non è ancora stato sovrascritto', 'info');
    return;
  }
  const when = new Date(backup.savedAt).toLocaleString('it-IT', { dateStyle: 'medium', timeStyle: 'short' });
  const choice = await ui().ask({
    title: 'Ripristina originale',
    message: `Il PDF tornerà com'era prima del primo salvataggio (${when}). Le annotazioni attuali verranno rimosse. Il file su disco cambia solo quando premi Salva.`,
    actions: [
      { id: 'cancel', label: 'Annulla' },
      { id: 'restore', label: 'Ripristina', tone: 'danger' },
    ],
  });
  if (choice !== 'restore') return;
  ui().set({ busy: 'Ripristino…' });
  try {
    await openBytes(backup.bytes.slice(), doc.name, doc.handle, doc.lastModified, true);
    useDoc.getState().patchDoc({ docKey: doc.docKey });
    ui().toast('Originale ripristinato. Premi Ctrl+S per sovrascrivere il file.', 'success');
  } finally {
    ui().set({ busy: null });
  }
}

/* ---- Bozze automatiche ---- */

async function removeCurrentDraft() {
  const key = useDoc.getState().doc?.docKey;
  if (key) await deleteDraft(key).catch(() => undefined);
}

let lastDraftRev = -1;

export function startDraftAutosave() {
  const timer = setInterval(() => {
    const { doc, rev, savedRev, annotations, margins, txBase } = useDoc.getState();
    if (!doc || txBase || rev === lastDraftRev) return;
    lastDraftRev = rev;
    if (rev === savedRev) {
      void removeCurrentDraft();
      return;
    }
    const project = currentProject(annotations, margins);
    writeDraft({ docKey: doc.docKey, name: doc.name, savedAt: Date.now(), project }, usedAssets(project.annotations))
      .catch(() => undefined);
  }, 3000);
  return () => clearInterval(timer);
}

/* ---- "Apri con" da Windows ---- */

export function listenForLaunchFiles() {
  const queue = window.launchQueue;
  queue?.setConsumer(async (params) => {
    const handle = params.files?.[0];
    if (handle) await openHandle(handle as FileSystemFileHandle);
  });
}
