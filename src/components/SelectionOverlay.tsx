import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { frame, rescale, rotatePoint, unionRects } from '../model/geometry';
import type { Annotation, ImageAnnotation, Rect, ShapeAnnotation, TextAnnotation } from '../model/types';
import { layoutText } from '../model/textLayout';
import { useDoc, withReplaced } from '../store/docStore';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'p1' | 'p2' | 'rotate';

const CORNERS: Handle[] = ['nw', 'ne', 'se', 'sw'];
const ALL: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const HANDLE_POS: Record<string, [number, number]> = {
  nw: [0, 0], n: [0.5, 0], ne: [1, 0], e: [1, 0.5], se: [1, 1], s: [0.5, 1], sw: [0, 1], w: [0, 0.5],
};

function resizedBox(box: Rect, handle: Handle, x: number, y: number, keepAspect: boolean): Rect {
  let x0 = box.x, y0 = box.y, x1 = box.x + box.w, y1 = box.y + box.h;
  if (handle.includes('w')) x0 = Math.min(x, x1 - 2);
  if (handle.includes('e')) x1 = Math.max(x, x0 + 2);
  if (handle.includes('n')) y0 = Math.min(y, y1 - 2);
  if (handle.includes('s')) y1 = Math.max(y, y0 + 2);
  if (keepAspect && box.w && box.h && handle.length === 2) {
    const s = Math.max((x1 - x0) / box.w, (y1 - y0) / box.h);
    const w = box.w * s;
    const h = box.h * s;
    if (handle.includes('w')) x0 = x1 - w; else x1 = x0 + w;
    if (handle.includes('n')) y0 = y1 - h; else y1 = y0 + h;
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Ridimensiona un'immagine anche ruotata tenendo fermo l'angolo opposto. */
function resizeImage(a: ImageAnnotation, handle: Handle, px: number, py: number): ImageAnnotation {
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  const [hx, hy] = HANDLE_POS[handle];
  const anchor = rotatePoint(a.x + a.w * (1 - hx), a.y + a.h * (1 - hy), cx, cy, a.rotation);
  // Puntatore espresso nel sistema dell'immagine, con origine nell'ancora.
  const local = rotatePoint(px, py, anchor.x, anchor.y, -a.rotation);
  const dx = Math.abs(local.x - anchor.x);
  const dy = Math.abs(local.y - anchor.y);
  const s = Math.max(dx / a.w, dy / a.h, 8 / Math.min(a.w, a.h));
  const w = a.w * s;
  const h = a.h * s;
  const signX = hx > 0.5 ? 1 : -1;
  const signY = hy > 0.5 ? 1 : -1;
  const center = rotatePoint(anchor.x + (signX * w) / 2, anchor.y + (signY * h) / 2, anchor.x, anchor.y, a.rotation);
  return { ...a, x: center.x - w / 2, y: center.y - h / 2, w, h };
}

function fitTextHeight(a: TextAnnotation): TextAnnotation {
  const needed = layoutText(a).contentHeight;
  return needed > a.h ? { ...a, h: needed } : a;
}

export function SelectionOverlay({ items, scale }: { items: Annotation[]; scale: number }) {
  const drag = useRef<{ handle: Handle; initial: Annotation[]; box: Rect } | null>(null);
  const single = items.length === 1 ? items[0] : null;

  const rotated = single?.kind === 'image' ? single : null;
  const box = rotated ? { x: rotated.x, y: rotated.y, w: rotated.w, h: rotated.h } : unionRects(items.map(frame));
  const isSegment = single?.kind === 'shape' && single.shape !== 'rect' && single.shape !== 'ellipse';
  const pad = rotated || single?.kind === 'text' ? 0 : 4 / scale;

  const point = (e: ReactPointerEvent) => {
    const page = (e.currentTarget as HTMLElement).closest('[data-page]')!.querySelector('.page-overlay')!;
    const r = page.getBoundingClientRect();
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const onDown = (handle: Handle) => (e: ReactPointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { handle, initial: items, box };
    useDoc.getState().beginTx();
  };

  const onMove = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const { x, y } = point(e);
    const first = d.initial[0];
    let changed: Annotation[];
    if (d.handle === 'rotate' && first.kind === 'image') {
      const cx = first.x + first.w / 2;
      const cy = first.y + first.h / 2;
      let angle = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90;
      if (e.shiftKey) angle = Math.round(angle / 15) * 15;
      changed = [{ ...first, rotation: ((Math.round(angle * 10) / 10) % 360 + 360) % 360 }];
    } else if (d.handle === 'p1' || d.handle === 'p2') {
      const s = first as ShapeAnnotation;
      changed = [d.handle === 'p1' ? { ...s, x1: x, y1: y } : { ...s, x2: x, y2: y }];
    } else if (d.initial.length === 1 && first.kind === 'image') {
      changed = [resizeImage(first, d.handle, x, y)];
    } else {
      const hasImage = d.initial.some((a) => a.kind === 'image');
      const to = resizedBox(d.box, d.handle, x, y, e.shiftKey || hasImage);
      changed = d.initial.map((a) => {
        const next = rescale(a, d.box, to);
        return next.kind === 'text' ? fitTextHeight(next) : next;
      });
    }
    useDoc.getState().patch((c) => ({ annotations: withReplaced(c.annotations, changed) }));
  };

  const onUp = () => {
    if (!drag.current) return;
    drag.current = null;
    useDoc.getState().endTx();
  };

  const handleProps = (h: Handle) => ({
    onPointerDown: onDown(h), onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onUp,
    'data-handle': h,
  });

  if (isSegment && single?.kind === 'shape') {
    return (
      <div className="selection-layer">
        {(['p1', 'p2'] as const).map((h) => (
          <div
            key={h} className="handle round" {...handleProps(h)}
            style={{ left: (h === 'p1' ? single.x1 : single.x2) * scale, top: (h === 'p1' ? single.y1 : single.y2) * scale }}
          />
        ))}
      </div>
    );
  }

  const handles = single?.kind === 'ink' || !single || rotated ? CORNERS : ALL;
  const left = (box.x - pad) * scale;
  const top = (box.y - pad) * scale;
  const width = (box.w + pad * 2) * scale;
  const height = (box.h + pad * 2) * scale;

  return (
    <div className="selection-layer">
      <div
        className="selection-box"
        style={{ left, top, width, height, transform: rotated?.rotation ? `rotate(${rotated.rotation}deg)` : undefined }}
      >
        {handles.map((h) => (
          <div
            key={h} className={`handle cursor-${h}`} {...handleProps(h)}
            style={{ left: `${HANDLE_POS[h][0] * 100}%`, top: `${HANDLE_POS[h][1] * 100}%` }}
          />
        ))}
        {rotated && (
          <>
            <div className="rotate-stem" />
            <div className="handle round rotate" {...handleProps('rotate')} title="Ruota (Shift: passi di 15°)" />
          </>
        )}
      </div>
    </div>
  );
}
