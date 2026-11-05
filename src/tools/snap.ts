import type { ShapeAnnotation } from '../model/types';
import { pageText } from '../pdf/session';

/**
 * Sottolineatura: resta sempre orizzontale; se passa vicino a una riga di testo del PDF
 * si aggancia appena sotto la sua baseline e alle estremità delle parole.
 */
export async function snapUnderline(page: number, a: ShapeAnnotation, scale: number): Promise<ShapeAnnotation> {
  const straight = { ...a, y2: a.y1 };
  const { items } = await pageText(page);
  const reach = 14 / scale;
  const left = Math.min(a.x1, a.x2);
  const right = Math.max(a.x1, a.x2);
  let best: { y: number; dist: number } | null = null;
  const onLine = [];
  for (const it of items) {
    if (!it.str.trim() || Math.abs(it.y1 - it.y0) > 0.5) continue;
    const x0 = Math.min(it.x0, it.x1);
    const x1 = Math.max(it.x0, it.x1);
    if (x1 < left || x0 > right) continue;
    const dist = Math.abs(a.y1 - (it.y0 - it.height / 3));
    if (dist < it.height + reach) {
      if (!best || dist < best.dist) best = { y: it.y0, dist };
      onLine.push({ it, x0, x1 });
    }
  }
  if (!best) return straight;
  const y = best.y + Math.max(1.5, a.width);
  const words = onLine.filter(({ it }) => Math.abs(it.y0 - best.y) < 1);
  let x1 = a.x1;
  let x2 = a.x2;
  for (const { x0, x1: end } of words) {
    if (Math.abs(left - x0) < reach) x1 = a.x1 <= a.x2 ? x0 : x1;
    if (Math.abs(left - x0) < reach && a.x1 > a.x2) x2 = x0;
    if (Math.abs(right - end) < reach) {
      if (a.x1 <= a.x2) x2 = end;
      else x1 = end;
    }
  }
  return { ...a, x1, x2, y1: y, y2: y };
}
