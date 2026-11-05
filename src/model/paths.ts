import { getStroke } from 'perfect-freehand';
import type { InkAnnotation, ShapeAnnotation } from './types';

/**
 * Generazione dei tracciati vettoriali. Lo stesso codice alimenta sia l'SVG a schermo
 * sia l'operatore di disegno nel PDF: ciò che si vede è esattamente ciò che viene salvato.
 */
export type Seg =
  | ['M', number, number]
  | ['L', number, number]
  | ['Q', number, number, number, number]
  | ['C', number, number, number, number, number, number]
  | ['Z'];

export interface DrawOp {
  segs: Seg[];
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity: number;
  multiply: boolean;
  round: boolean;
}

export const HIGHLIGHT_OPACITY = 0.5;

export function inkOutline(a: InkAnnotation): Seg[] {
  const input: number[][] = [];
  for (let i = 0; i < a.points.length; i += 3) {
    input.push([a.points[i], a.points[i + 1], a.points[i + 2]]);
  }
  const marker = a.tool === 'highlighter';
  const outline = getStroke(input, {
    size: a.width,
    thinning: marker ? 0 : 0.55,
    smoothing: 0.5,
    streamline: marker ? 0.6 : 0.45,
    simulatePressure: !marker && !a.hasPressure,
    last: true,
  });
  if (outline.length < 2) return [];
  const segs: Seg[] = [['M', outline[0][0], outline[0][1]]];
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    segs.push(['Q', x0, y0, (x0 + x1) / 2, (y0 + y1) / 2]);
  }
  segs.push(['Z']);
  return segs;
}

export function inkOps(a: InkAnnotation): DrawOp[] {
  const marker = a.tool === 'highlighter';
  return [{
    segs: inkOutline(a),
    fill: a.color,
    opacity: marker ? HIGHLIGHT_OPACITY : 1,
    multiply: marker,
    round: false,
  }];
}

const KAPPA = 0.5522847498;

export function shapeOps(a: ShapeAnnotation): DrawOp[] {
  const { x1, y1, x2, y2, color, width } = a;
  const base = { stroke: color, strokeWidth: width, opacity: 1, multiply: false, round: true };
  switch (a.shape) {
    case 'line':
    case 'underline':
      return [{ ...base, segs: [['M', x1, y1], ['L', x2, y2]] }];
    case 'arrow': {
      const len = Math.hypot(x2 - x1, y2 - y1) || 1;
      const head = Math.min(len, Math.max(9, width * 4.2));
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      const bx = x2 - ux * head;
      const by = y2 - uy * head;
      const half = head * 0.48;
      return [
        { ...base, segs: [['M', x1, y1], ['L', x2 - ux * head * 0.6, y2 - uy * head * 0.6]] },
        {
          ...base, stroke: undefined, fill: color,
          segs: [['M', x2, y2], ['L', bx - uy * half, by + ux * half], ['L', bx + uy * half, by - ux * half], ['Z']],
        },
      ];
    }
    case 'rect': {
      return [{
        ...base, round: false,
        segs: [['M', x1, y1], ['L', x2, y1], ['L', x2, y2], ['L', x1, y2], ['Z']],
      }];
    }
    case 'ellipse': {
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = Math.abs(x2 - x1) / 2;
      const ry = Math.abs(y2 - y1) / 2;
      const kx = rx * KAPPA;
      const ky = ry * KAPPA;
      return [{
        ...base,
        segs: [
          ['M', cx - rx, cy],
          ['C', cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry],
          ['C', cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy],
          ['C', cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry],
          ['C', cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy],
          ['Z'],
        ],
      }];
    }
  }
}

export function segsToSvg(segs: Seg[]): string {
  const n = (v: number) => Math.round(v * 100) / 100;
  return segs.map((s) => s[0] + s.slice(1).map((v) => n(v as number)).join(' ')).join('');
}
