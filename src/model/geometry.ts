import type { Annotation, InkAnnotation, Rect } from './types';

export const newId = () => Math.random().toString(36).slice(2, 11);

export function rectFromPoints(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function rectsIntersect(a: Rect, b: Rect) {
  return a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y;
}

export function unionRects(rects: Rect[]): Rect {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export function rotatePoint(x: number, y: number, cx: number, cy: number, deg: number) {
  const t = (deg * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return { x: cx + (x - cx) * c - (y - cy) * s, y: cy + (x - cx) * s + (y - cy) * c };
}

const inkBoxes = new WeakMap<InkAnnotation, Rect>();

/** Riquadro "logico" dell'annotazione (usato per maniglie e ridimensionamento). */
export function frame(a: Annotation): Rect {
  switch (a.kind) {
    case 'ink': {
      const cached = inkBoxes.get(a);
      if (cached) return cached;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = 0; i < a.points.length; i += 3) {
        x0 = Math.min(x0, a.points[i]);
        x1 = Math.max(x1, a.points[i]);
        y0 = Math.min(y0, a.points[i + 1]);
        y1 = Math.max(y1, a.points[i + 1]);
      }
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      inkBoxes.set(a, box);
      return box;
    }
    case 'shape':
      return rectFromPoints(a.x1, a.y1, a.x2, a.y2);
    case 'text':
      return { x: a.x, y: a.y, w: a.w, h: a.h };
    case 'image': {
      if (!a.rotation) return { x: a.x, y: a.y, w: a.w, h: a.h };
      const cx = a.x + a.w / 2;
      const cy = a.y + a.h / 2;
      const c = [[a.x, a.y], [a.x + a.w, a.y], [a.x + a.w, a.y + a.h], [a.x, a.y + a.h]]
        .map(([x, y]) => rotatePoint(x, y, cx, cy, a.rotation));
      const xs = c.map((p) => p.x);
      const ys = c.map((p) => p.y);
      return rectFromPoints(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
  }
}

export function translate(a: Annotation, dx: number, dy: number): Annotation {
  switch (a.kind) {
    case 'ink': {
      const points = a.points.slice();
      for (let i = 0; i < points.length; i += 3) {
        points[i] += dx;
        points[i + 1] += dy;
      }
      return { ...a, points };
    }
    case 'shape':
      return { ...a, x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy };
    default:
      return { ...a, x: a.x + dx, y: a.y + dy };
  }
}

/** Mappa l'annotazione dal riquadro `from` al riquadro `to`. */
export function rescale(a: Annotation, from: Rect, to: Rect): Annotation {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  switch (a.kind) {
    case 'ink': {
      const points = a.points.slice();
      for (let i = 0; i < points.length; i += 3) {
        points[i] = mx(points[i]);
        points[i + 1] = my(points[i + 1]);
      }
      return { ...a, points };
    }
    case 'shape':
      return { ...a, x1: mx(a.x1), y1: my(a.y1), x2: mx(a.x2), y2: my(a.y2) };
    default:
      return { ...a, x: mx(a.x), y: my(a.y), w: Math.max(4, a.w * sx), h: Math.max(4, a.h * sy) };
  }
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

export function hitTest(a: Annotation, x: number, y: number, tol: number): boolean {
  switch (a.kind) {
    case 'ink': {
      const f = frame(a);
      const reach = a.width / 2 + tol;
      if (x < f.x - reach || x > f.x + f.w + reach || y < f.y - reach || y > f.y + f.h + reach) return false;
      const p = a.points;
      if (p.length === 3) return Math.hypot(x - p[0], y - p[1]) <= reach;
      for (let i = 3; i < p.length; i += 3) {
        if (distToSegment(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= reach) return true;
      }
      return false;
    }
    case 'shape': {
      const reach = a.width / 2 + tol;
      if (a.shape === 'rect') {
        const { x1, y1, x2, y2 } = a;
        return [[x1, y1, x2, y1], [x2, y1, x2, y2], [x2, y2, x1, y2], [x1, y2, x1, y1]]
          .some(([ax, ay, bx, by]) => distToSegment(x, y, ax, ay, bx, by) <= reach);
      }
      if (a.shape === 'ellipse') {
        const rx = Math.abs(a.x2 - a.x1) / 2 || 1;
        const ry = Math.abs(a.y2 - a.y1) / 2 || 1;
        const nx = (x - (a.x1 + a.x2) / 2) / rx;
        const ny = (y - (a.y1 + a.y2) / 2) / ry;
        return Math.abs(Math.hypot(nx, ny) - 1) * Math.min(rx, ry) <= reach;
      }
      return distToSegment(x, y, a.x1, a.y1, a.x2, a.y2) <= reach;
    }
    case 'text':
      return x >= a.x - tol && x <= a.x + a.w + tol && y >= a.y - tol && y <= a.y + a.h + tol;
    case 'image': {
      const p = rotatePoint(x, y, a.x + a.w / 2, a.y + a.h / 2, -a.rotation);
      return p.x >= a.x - tol && p.x <= a.x + a.w + tol && p.y >= a.y - tol && p.y <= a.y + a.h + tol;
    }
  }
}

/** Con Shift le linee si bloccano a passi di 45°, rettangoli ed ellissi diventano regolari. */
export function constrain(shape: string, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (shape === 'rect' || shape === 'ellipse') {
    const s = Math.max(Math.abs(dx), Math.abs(dy));
    return { x: x1 + Math.sign(dx || 1) * s, y: y1 + Math.sign(dy || 1) * s };
  }
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  const len = Math.hypot(dx, dy);
  return { x: x1 + Math.cos(angle) * len, y: y1 + Math.sin(angle) * len };
}
