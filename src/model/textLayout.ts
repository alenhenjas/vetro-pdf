import { TEXT_PADDING } from './fonts';
import type { TextAnnotation, TextLayout, TextLine, TextStyle } from './types';

/**
 * Layout del testo in punti PDF. Il risultato (righe, posizione e baseline) viene usato
 * da SVG a schermo e dall'export, così l'a-capo è identico in app e negli altri lettori.
 */
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
const ctx = canvas?.getContext('2d') ?? null;
const REF = 200;

export const cssFont = (s: Pick<TextStyle, 'font' | 'bold' | 'italic'>, px: number) =>
  `${s.italic ? 'italic ' : ''}${s.bold ? '700' : '400'} ${px}px "${s.font}"`;

function measurer(style: TextStyle) {
  if (!ctx) throw new Error('Layout del testo disponibile solo nel thread principale');
  ctx.font = cssFont(style, REF);
  ctx.fontKerning = 'normal';
  const k = style.size / REF;
  return (t: string) => ctx.measureText(t).width * k;
}

function wrap(text: string, maxWidth: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const token of paragraph.split(/(?<=\s)/)) {
      const candidate = line + token;
      if (measure(candidate.trimEnd()) <= maxWidth || !line) {
        line = candidate;
      } else {
        out.push(line);
        line = token;
      }
      // Parola più lunga della casella: si spezza per carattere.
      while (measure(line.trimEnd()) > maxWidth && line.trimEnd().length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && measure(line.slice(0, cut)) > maxWidth) cut--;
        out.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    out.push(line);
  }
  return out.map((l) => l.replace(/\s+$/, ''));
}

const cache = new WeakMap<TextAnnotation, TextLayout>();

export function layoutText(a: TextAnnotation): TextLayout {
  const hit = cache.get(a);
  if (hit) return hit;
  const { style } = a;
  const measure = measurer(style);
  const inner = Math.max(1, a.w - TEXT_PADDING * 2);
  const metrics = ctx!.measureText('Hg');
  const ascent = (metrics.fontBoundingBoxAscent * style.size) / REF;
  const descent = (metrics.fontBoundingBoxDescent * style.size) / REF;
  const lineHeight = style.size * style.lineHeight;
  const lead = (lineHeight - (ascent + descent)) / 2 + ascent;
  const lines: TextLine[] = wrap(a.text, inner, measure).map((text, i) => {
    const width = measure(text);
    const offset = style.align === 'center' ? (inner - width) / 2 : style.align === 'right' ? inner - width : 0;
    return { text, width, x: a.x + TEXT_PADDING + offset, baseline: a.y + TEXT_PADDING + lead + i * lineHeight };
  });
  const layout = { lines, contentHeight: lines.length * lineHeight + TEXT_PADDING * 2 };
  cache.set(a, layout);
  return layout;
}

export async function ensureFont(style: Pick<TextStyle, 'font' | 'bold' | 'italic'>) {
  await document.fonts.load(cssFont(style, 16), 'Aà');
}
