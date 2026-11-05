import {
  decodePDFRawStream, PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFRef, PDFString, PDFHexString,
  EncryptedPDFError, type PDFObject,
} from 'pdf-lib';
import type { ImageAsset, ProjectData } from '../model/types';
import { CATALOG_KEY } from './format';

export interface ParseResult {
  encrypted?: boolean;
  /** PDF senza strato di Vetro: è ciò su cui si lavora e che viene riscritto a ogni salvataggio. */
  base: Uint8Array;
  docId: string | null;
  project: ProjectData | null;
  assets: ImageAsset[];
  /** Pagine la cui annotazione è stata fusa o rimossa da un altro programma. */
  lostPages: number;
}

const name = (s: string) => PDFName.of(s);

function decodeStream(stream: PDFRawStream): Uint8Array {
  return decodePDFRawStream(stream).decode();
}

async function readImage(doc: PDFDocument, id: string, ref: PDFObject): Promise<ImageAsset | null> {
  const stream = doc.context.lookup(ref);
  if (!(stream instanceof PDFRawStream)) return null;
  const dict = stream.dict;
  const width = (dict.lookup(name('Width')) as unknown as { asNumber(): number }).asNumber();
  const height = (dict.lookup(name('Height')) as unknown as { asNumber(): number }).asNumber();
  const filter = dict.lookup(name('Filter'));
  if (filter === name('DCTDecode')) {
    return { id, bytes: stream.getContents(), mime: 'image/jpeg', width, height };
  }
  const rgb = decodeStream(stream);
  const smask = dict.lookup(name('SMask'));
  const alpha = smask instanceof PDFRawStream ? decodeStream(smask) : null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    rgba[p] = rgb[i * 3];
    rgba[p + 1] = rgb[i * 3 + 1];
    rgba[p + 2] = rgb[i * 3 + 2];
    rgba[p + 3] = alpha ? alpha[i] : 255;
  }
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  const blob = await canvas.convertToBlob({ type: 'image/png' });
  return { id, bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/png', width, height };
}

const asArray = (doc: PDFDocument, value: PDFObject | undefined) => {
  const v = value ? doc.context.lookup(value) : undefined;
  return v instanceof PDFArray ? v.asArray() : [];
};

export async function parseProject(input: Uint8Array): Promise<ParseResult> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { updateMetadata: false, throwOnInvalidObject: false });
  } catch (err) {
    if (err instanceof EncryptedPDFError) {
      return { encrypted: true, base: input, docId: null, project: null, assets: [], lostPages: 0 };
    }
    // pdf-lib non legge il file: pdf.js può comunque mostrarlo; l'errore emergerà al salvataggio.
    return { base: input, docId: null, project: null, assets: [], lostPages: 0 };
  }

  const registryRef = doc.catalog.get(name(CATALOG_KEY));
  const registry = registryRef ? doc.context.lookup(registryRef) : undefined;
  if (!(registry instanceof PDFDict)) {
    return { base: input, docId: null, project: null, assets: [], lostPages: 0 };
  }

  const ctx = doc.context;
  const idValue = registry.lookup(name('DocId'));
  const docId = idValue instanceof PDFString || idValue instanceof PDFHexString ? idValue.decodeText() : null;

  const dataStream = registry.lookup(name('Data'));
  const stored = dataStream instanceof PDFRawStream
    ? (JSON.parse(new TextDecoder().decode(decodeStream(dataStream))) as ProjectData)
    : { version: 1 as const, annotations: {}, margins: {} };

  const assets: ImageAsset[] = [];
  const imagesDict = registry.lookup(name('Images'));
  if (imagesDict instanceof PDFDict) {
    for (const [key, value] of imagesDict.entries()) {
      const id = key.decodeText();
      const asset = await readImage(doc, id, value);
      if (asset) assets.push(asset);
    }
  }

  const wrap = asArray(doc, registry.get(name('Wrap')));
  const pages = doc.getPages();
  const indexByRef = new Map(pages.map((p, i) => [p.ref, i]));

  const project: ProjectData = { version: 1, annotations: {}, margins: {} };
  let lostPages = 0;
  let canDeleteObjects = true;

  asArray(doc, registry.get(name('Pages'))).forEach((rawEntry, slot) => {
    const entry = ctx.lookup(rawEntry);
    if (!(entry instanceof PDFDict)) return;
    const pageRef = entry.get(name('Page'));
    const index = pageRef instanceof PDFRef ? indexByRef.get(pageRef) : undefined;
    const list = stored.annotations[slot] ?? [];
    if (index === undefined) {
      if (list.length) lostPages++;
      return;
    }
    const node = pages[index].node;
    const layer = entry.get(name('Layer'));

    let layerIntact = true;
    if (layer) {
      const rawContents = node.get(name('Contents'));
      const contents = asArray(doc, rawContents);
      layerIntact = contents.includes(layer);
      if (layerIntact) {
        const kept = contents.filter((c) => c !== layer && !wrap.includes(c));
        node.set(name('Contents'), kept.length === 1 ? kept[0] : ctx.obj(kept));
        if (entry.lookup(name('HasRes')) === ctx.obj(true)) node.set(name('Resources'), entry.get(name('OrigRes'))!);
        else node.delete(name('Resources'));
      } else {
        // Un altro programma ha riscritto la pagina: il disegno ormai fa parte del contenuto.
        canDeleteObjects = false;
        if (list.length) lostPages++;
      }
    }

    if (entry.has(name('HasMedia'))) {
      if (entry.lookup(name('HasMedia')) === ctx.obj(true)) node.set(name('MediaBox'), entry.get(name('OrigMedia'))!);
      else node.delete(name('MediaBox'));
      if (entry.lookup(name('HasCrop')) === ctx.obj(true)) node.set(name('CropBox'), entry.get(name('OrigCrop'))!);
      else node.delete(name('CropBox'));
    }

    if (layerIntact) {
      project.annotations[index] = list.map((a) => ({ ...a, page: index }));
      const margin = stored.margins[slot];
      if (margin) project.margins[index] = margin;
    }
  });

  const objects = asArray(doc, registry.get(name('Objects')));
  doc.catalog.delete(name(CATALOG_KEY));
  if (registryRef instanceof PDFRef) ctx.delete(registryRef);
  if (canDeleteObjects) {
    for (const ref of objects) if (ref instanceof PDFRef) ctx.delete(ref);
  }

  const base = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
  return { base, docId, project, assets, lostPages };
}
