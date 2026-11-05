import fontkit from '@pdf-lib/fontkit';
import {
  PDFArray, PDFDict, PDFDocument, PDFName, PDFNumber, PDFRef, PDFString,
  type PDFFont, type PDFObject, type PDFPage,
} from 'pdf-lib';
import { FALLBACK_FONT, FONT_FEATURES, fontFace } from '../model/fonts';
import { inkOps, shapeOps, type DrawOp, type Seg } from '../model/paths';
import type {
  Annotation, ImageAnnotation, ImageAsset, PageSize, ProjectData, TextAnnotation, TextLayout,
} from '../model/types';
import { CATALOG_KEY, FORMAT_VERSION, LAYER_NAME } from './format';

export interface ExportRequest {
  base: ArrayBuffer;
  docId: string;
  pageSizes: PageSize[];
  project: ProjectData;
  assets: ImageAsset[];
  layouts: Record<string, TextLayout>;
}

export interface ExportResult {
  bytes: Uint8Array;
  missingChars: string[];
}

const n = (v: number) => {
  const s = v.toFixed(3);
  return s.includes('.') ? s.replace(/\.?0+$/, '') || '0' : s;
};

function hexColor(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => c / 255) as [number, number, number];
}
const rg = (hex: string) => `${hexColor(hex).map(n).join(' ')} rg\n`;
const RG = (hex: string) => `${hexColor(hex).map(n).join(' ')} RG\n`;

function segsToPdf(segs: Seg[]): string {
  let out = '';
  let cx = 0;
  let cy = 0;
  for (const s of segs) {
    switch (s[0]) {
      case 'M': out += `${n(s[1])} ${n(s[2])} m\n`; [cx, cy] = [s[1], s[2]]; break;
      case 'L': out += `${n(s[1])} ${n(s[2])} l\n`; [cx, cy] = [s[1], s[2]]; break;
      case 'Q': {
        // Le curve quadratiche non esistono in PDF: conversione esatta in cubica.
        const [, qx, qy, x, y] = s;
        const c1x = cx + (2 / 3) * (qx - cx);
        const c1y = cy + (2 / 3) * (qy - cy);
        const c2x = x + (2 / 3) * (qx - x);
        const c2y = y + (2 / 3) * (qy - y);
        out += `${n(c1x)} ${n(c1y)} ${n(c2x)} ${n(c2y)} ${n(x)} ${n(y)} c\n`;
        [cx, cy] = [x, y];
        break;
      }
      case 'C': out += `${s.slice(1).map((v) => n(v as number)).join(' ')} c\n`; [cx, cy] = [s[5], s[6]]; break;
      case 'Z': out += 'h\n'; break;
    }
  }
  return out;
}

/** Matrice dallo spazio visivo (origine in alto a sinistra, y in basso) allo spazio utente. */
export function visualToUser(page: PDFPage, size: PageSize) {
  const media = page.getMediaBox();
  const crop = page.getCropBox();
  const x0 = Math.max(media.x, crop.x);
  const y0 = Math.max(media.y, crop.y);
  const x1 = Math.min(media.x + media.width, crop.x + crop.width);
  const y1 = Math.min(media.y + media.height, crop.y + crop.height);
  const box = x1 > x0 && y1 > y0 ? { x0, y0, x1, y1 } : {
    x0: media.x, y0: media.y, x1: media.x + media.width, y1: media.y + media.height,
  };
  const rotate = ((page.getRotation().angle % 360) + 360) % 360;
  const boxW = box.x1 - box.x0;
  const boxH = box.y1 - box.y0;
  const s = (rotate % 180 === 0 ? boxW : boxH) / size.w;
  const matrix: Record<number, number[]> = {
    0: [s, 0, 0, -s, box.x0, box.y1],
    90: [0, s, s, 0, box.x0, box.y0],
    180: [-s, 0, 0, s, box.x1, box.y0],
    270: [0, -s, -s, 0, box.x1, box.y1],
  };
  return { matrix: matrix[rotate] ?? matrix[0], box, rotate, scale: s };
}

const fontBytes = new Map<string, Promise<Uint8Array>>();
function loadFontFile(key: string) {
  let p = fontBytes.get(key);
  if (!p) {
    p = fetch(new URL(`${import.meta.env.BASE_URL}fonts/${key}.ttf`, self.location.origin).href)
      .then((r) => {
        if (!r.ok) throw new Error(`Font non trovato: ${key}`);
        return r.arrayBuffer();
      })
      .then((b) => new Uint8Array(b));
    fontBytes.set(key, p);
  }
  return p;
}

interface FontEntry {
  name: string;
  pdf: PDFFont;
  fk: FontkitFont;
}
interface FontkitFont {
  unitsPerEm: number;
  hasGlyphForCodePoint(cp: number): boolean;
  layout(text: string, features: object): {
    glyphs: { advanceWidth: number }[];
    positions: { xAdvance: number }[];
    advanceWidth: number;
  };
}

class LayerBuilder {
  fonts = new Map<string, FontEntry>();
  images = new Map<string, { name: string; ref: PDFRef }>();
  states = new Map<string, string>();
  missing = new Set<string>();
  fontDict: PDFDict;
  xobjectDict: PDFDict;
  gsDict: PDFDict;
  resources: PDFRef;

  constructor(private doc: PDFDocument, private assets: Map<string, ImageAsset>) {
    const ctx = doc.context;
    this.fontDict = ctx.obj({});
    this.xobjectDict = ctx.obj({});
    this.gsDict = ctx.obj({});
    this.resources = ctx.register(ctx.obj({ Font: this.fontDict, XObject: this.xobjectDict, ExtGState: this.gsDict }));
  }

  async font(key: string): Promise<FontEntry> {
    let entry = this.fonts.get(key);
    if (!entry) {
      const bytes = await loadFontFile(key);
      const pdf = await this.doc.embedFont(bytes, { subset: true, features: FONT_FEATURES });
      const name = `F${this.fonts.size}`;
      this.fontDict.set(PDFName.of(name), pdf.ref);
      entry = { name, pdf, fk: fontkit.create(bytes) as unknown as FontkitFont };
      this.fonts.set(key, entry);
    }
    return entry;
  }

  graphicsState(opacity: number, multiply: boolean): string {
    const key = `${opacity}|${multiply}`;
    let name = this.states.get(key);
    if (!name) {
      name = `GS${this.states.size}`;
      const dict = this.doc.context.obj({ Type: 'ExtGState', ca: opacity, CA: opacity });
      if (multiply) dict.set(PDFName.of('BM'), PDFName.of('Multiply'));
      this.gsDict.set(PDFName.of(name), dict);
      this.states.set(key, name);
    }
    return name;
  }

  async image(assetId: string) {
    let entry = this.images.get(assetId);
    if (!entry) {
      const asset = this.assets.get(assetId);
      if (!asset) return null;
      const img = asset.mime === 'image/jpeg' ? await this.doc.embedJpg(asset.bytes) : await this.doc.embedPng(asset.bytes);
      entry = { name: `Im${this.images.size}`, ref: img.ref };
      this.xobjectDict.set(PDFName.of(entry.name), img.ref);
      this.images.set(assetId, entry);
    }
    return entry;
  }

  drawOps(ops: DrawOp[]): string {
    let out = '';
    for (const op of ops) {
      if (!op.segs.length) continue;
      out += 'q\n';
      if (op.opacity < 1 || op.multiply) out += `/${this.graphicsState(op.opacity, op.multiply)} gs\n`;
      if (op.fill) {
        out += rg(op.fill) + segsToPdf(op.segs) + 'f\n';
      } else if (op.stroke) {
        out += RG(op.stroke) + `${n(op.strokeWidth ?? 1)} w\n`;
        out += op.round ? '1 J 1 j\n' : '0 J 0 j\n';
        out += segsToPdf(op.segs) + 'S\n';
      }
      out += 'Q\n';
    }
    return out;
  }

  private async textRun(text: string, entry: FontEntry, x: number, baseline: number, size: number, skew: number) {
    const { glyphs, positions, advanceWidth } = entry.fk.layout(text, FONT_FEATURES);
    const hex = entry.pdf.encodeText(text).toString().slice(1, -1);
    const parts: string[] = [];
    let chunk = '';
    glyphs.forEach((g, i) => {
      chunk += hex.slice(i * 4, i * 4 + 4);
      const kern = positions[i].xAdvance - g.advanceWidth;
      if (kern !== 0 && i < glyphs.length - 1) {
        parts.push(`<${chunk}>`, n((-kern / entry.fk.unitsPerEm) * 1000));
        chunk = '';
      }
    });
    if (chunk) parts.push(`<${chunk}>`);
    const ops = `/${entry.name} ${n(size)} Tf\n1 0 ${n(skew)} -1 ${n(x)} ${n(baseline)} Tm\n[${parts.join(' ')}] TJ\n`;
    return { ops, width: (advanceWidth / entry.fk.unitsPerEm) * size };
  }

  async text(a: TextAnnotation, layout: TextLayout): Promise<string> {
    const { style } = a;
    let out = 'q\n';
    if (style.backgroundOpacity > 0) {
      if (style.backgroundOpacity < 1) out += `/${this.graphicsState(style.backgroundOpacity, false)} gs\n`;
      out += `${rg(style.background)}${n(a.x)} ${n(a.y)} ${n(a.w)} ${n(a.h)} re f\n`;
    }
    out += 'Q\n';

    const face = fontFace(style.font, style.bold, style.italic);
    const primary = await this.font(face.key);
    const fallbackKey = fontFace(FALLBACK_FONT, style.bold, style.italic).key;
    const skew = face.fakeItalic ? 0.2 : 0;

    out += 'q\n' + rg(style.color) + RG(style.color);
    if (face.fakeBold) out += `${n(style.size * 0.03)} w\n2 Tr\n`;
    out += 'BT\n';
    for (const line of layout.lines) {
      // Suddivide la riga in tratti con font principale / font di riserva.
      const chars = [...line.text];
      const runs: { text: string; fallback: boolean }[] = [];
      for (let c of chars) {
        const cp = c.codePointAt(0)!;
        let fallback = false;
        if (!primary.fk.hasGlyphForCodePoint(cp)) {
          const alt = await this.font(fallbackKey);
          if (alt.fk.hasGlyphForCodePoint(cp)) {
            fallback = true;
          } else {
            this.missing.add(c);
            c = '?';
          }
        }
        const last = runs[runs.length - 1];
        if (last && last.fallback === fallback) last.text += c;
        else runs.push({ text: c, fallback });
      }
      let x = line.x;
      for (const run of runs) {
        const entry = run.fallback ? await this.font(fallbackKey) : primary;
        const { ops, width } = await this.textRun(run.text, entry, x, line.baseline, style.size, skew);
        out += ops;
        x += width;
      }
    }
    out += 'ET\n';
    if (style.underline) {
      const thickness = Math.max(0.5, style.size * 0.06);
      for (const line of layout.lines) {
        if (!line.width) continue;
        out += `${n(line.x)} ${n(line.baseline + style.size * 0.11)} ${n(line.width)} ${n(thickness)} re f\n`;
      }
    }
    return out + 'Q\n';
  }

  async imageOp(a: ImageAnnotation): Promise<string> {
    const img = await this.image(a.assetId);
    if (!img) return '';
    const cx = a.x + a.w / 2;
    const cy = a.y + a.h / 2;
    const t = (a.rotation * Math.PI) / 180;
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    return `q\n${n(cos)} ${n(sin)} ${n(-sin)} ${n(cos)} ${n(cx)} ${n(cy)} cm\n` +
      `${n(a.w)} 0 0 ${n(-a.h)} ${n(-a.w / 2)} ${n(a.h / 2)} cm\n/${img.name} Do\nQ\n`;
  }
}

async function annotationContent(b: LayerBuilder, list: Annotation[], layouts: Record<string, TextLayout>) {
  let out = '';
  for (const a of list) {
    if (a.kind === 'ink') out += b.drawOps(inkOps(a));
    else if (a.kind === 'shape') out += b.drawOps(shapeOps(a));
    else if (a.kind === 'image') out += await b.imageOp(a);
    else if (layouts[a.id]) out += await b.text(a, layouts[a.id]);
  }
  return out;
}

const rawEntry = (page: PDFPage, key: string) => page.node.get(PDFName.of(key));

function contentsOf(page: PDFPage): PDFObject[] {
  const ctx = page.doc.context;
  const raw = rawEntry(page, 'Contents');
  if (!raw) return [];
  const value = ctx.lookup(raw);
  return value instanceof PDFArray ? value.asArray() : [raw];
}

function enlargeBoxes(page: PDFPage, box: { x0: number; y0: number; x1: number; y1: number }, rotate: number, extra: number) {
  const b = { ...box };
  if (rotate === 0) b.x1 += extra;
  else if (rotate === 90) b.y1 += extra;
  else if (rotate === 180) b.x0 -= extra;
  else b.y0 -= extra;
  const media = page.getMediaBox();
  const mx0 = Math.min(media.x, b.x0);
  const my0 = Math.min(media.y, b.y0);
  const mx1 = Math.max(media.x + media.width, b.x1);
  const my1 = Math.max(media.y + media.height, b.y1);
  page.setMediaBox(mx0, my0, mx1 - mx0, my1 - my0);
  page.setCropBox(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
  return b;
}

export async function exportProject(req: ExportRequest): Promise<ExportResult> {
  const doc = await PDFDocument.load(req.base, { updateMetadata: false, throwOnInvalidObject: false });
  doc.registerFontkit(fontkit);
  const ctx = doc.context;
  const firstNewObject = ctx.largestObjectNumber + 1;
  const pages = doc.getPages();

  const builder = new LayerBuilder(doc, new Map(req.assets.map((a) => [a.id, a])));
  const openWrap = ctx.register(ctx.stream('q\n'));
  const closeWrap = ctx.register(ctx.stream('Q\n'));

  const indices = new Set<number>();
  for (const [k, list] of Object.entries(req.project.annotations)) if (list.length) indices.add(+k);
  for (const [k, m] of Object.entries(req.project.margins)) if (m > 0) indices.add(+k);
  const ordered = [...indices].filter((i) => i >= 0 && i < pages.length).sort((a, b) => a - b);

  const pageEntries: PDFObject[] = [];
  const slotAnnotations: ProjectData['annotations'] = {};
  const slotMargins: ProjectData['margins'] = {};

  for (const [slot, index] of ordered.entries()) {
    const page = pages[index];
    const size = req.pageSizes[index];
    const list = req.project.annotations[index] ?? [];
    const margin = req.project.margins[index] ?? 0;
    const { matrix, box, rotate, scale } = visualToUser(page, size);

    const entry = ctx.obj({ Page: page.ref });
    const rawMedia = rawEntry(page, 'MediaBox');
    const rawCrop = rawEntry(page, 'CropBox');
    const rawRes = rawEntry(page, 'Resources');

    let form = box;
    if (margin > 0) {
      entry.set(PDFName.of('HasMedia'), ctx.obj(!!rawMedia));
      if (rawMedia) entry.set(PDFName.of('OrigMedia'), rawMedia);
      entry.set(PDFName.of('HasCrop'), ctx.obj(!!rawCrop));
      if (rawCrop) entry.set(PDFName.of('OrigCrop'), rawCrop);
      form = enlargeBoxes(page, box, rotate, margin * scale);
    }

    if (list.length) {
      const body = await annotationContent(builder, list, req.layouts);
      const content = `q\n${matrix.map(n).join(' ')} cm\n${body}Q\n`;
      const formRef = ctx.register(ctx.flateStream(content, {
        Type: 'XObject',
        Subtype: 'Form',
        FormType: 1,
        BBox: [form.x0, form.y0, form.x1, form.y1],
        Resources: builder.resources,
        VetroLayer: true,
      }));
      const layerRef = ctx.register(ctx.stream(`q\n/${LAYER_NAME} Do\nQ\n`));

      // Risorse della pagina: copia privata (le originali possono essere condivise).
      const resources = page.node.Resources();
      const res = (resources ? resources.clone(ctx) : ctx.obj({})) as PDFDict;
      const xobjects = res.lookup(PDFName.of('XObject'));
      const xo = xobjects instanceof PDFDict ? (xobjects.clone(ctx) as PDFDict) : (ctx.obj({}) as PDFDict);
      xo.set(PDFName.of(LAYER_NAME), formRef);
      res.set(PDFName.of('XObject'), xo);
      entry.set(PDFName.of('HasRes'), ctx.obj(!!rawRes));
      if (rawRes) entry.set(PDFName.of('OrigRes'), rawRes);
      page.node.set(PDFName.of('Resources'), res);

      const contents = ctx.obj([]) as PDFArray;
      contents.push(openWrap);
      for (const c of contentsOf(page)) contents.push(c);
      contents.push(closeWrap);
      contents.push(layerRef);
      page.node.set(PDFName.of('Contents'), contents);
      entry.set(PDFName.of('Layer'), layerRef);
    }

    pageEntries.push(entry);
    slotAnnotations[slot] = list.map((a) => ({ ...a, page: slot }));
    if (margin > 0) slotMargins[slot] = margin;
  }

  // Tutti i font/immagini ora vengono scritti: da qui in poi si conoscono gli oggetti creati.
  await doc.flush();

  const project: ProjectData = { version: 1, annotations: slotAnnotations, margins: slotMargins };
  const data = ctx.register(ctx.flateStream(new TextEncoder().encode(JSON.stringify(project)), {}));

  const images = ctx.obj({}) as PDFDict;
  for (const [id, { ref }] of builder.images) images.set(PDFName.of(id), ref);

  const objects = ctx.obj([]) as PDFArray;
  for (const [ref] of ctx.enumerateIndirectObjects()) {
    if (ref.objectNumber >= firstNewObject) objects.push(ref);
  }

  const registry = ctx.obj({
    Type: 'VetroProject',
    Version: PDFNumber.of(FORMAT_VERSION),
    DocId: PDFString.of(req.docId),
    Data: data,
    Images: images,
    Pages: pageEntries,
    Wrap: [openWrap, closeWrap],
    Objects: objects,
  });
  doc.catalog.set(PDFName.of(CATALOG_KEY), ctx.register(registry));

  const bytes = await doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });

  // Verifica di sicurezza: il risultato deve rileggersi prima di toccare il file su disco.
  const check = await PDFDocument.load(bytes, { updateMetadata: false, throwOnInvalidObject: false });
  if (check.getPageCount() !== pages.length) throw new Error('Verifica del PDF generato non riuscita');

  return { bytes, missingChars: [...builder.missing] };
}
