import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { constrain, frame, hitTest, newId, rectFromPoints, rectsIntersect, translate } from '../model/geometry';
import { ensureFont } from '../model/textLayout';
import type { Annotation, InkAnnotation, Rect, ShapeAnnotation, ShapeKind, TextAnnotation } from '../model/types';
import { pageText } from '../pdf/session';
import { addAnnotations, findAnnotation, findAnnotations, removeAnnotations, useDoc, withReplaced } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { snapUnderline } from './snap';

type Gesture =
  | { type: 'ink'; ann: InkAnnotation }
  | { type: 'shape'; ann: ShapeAnnotation }
  | { type: 'erase'; erased: Set<string> }
  | { type: 'move'; startX: number; startY: number; initial: Annotation[]; moved: boolean }
  | { type: 'marquee'; startX: number; startY: number; base: string[] };

const SHAPE_TOOLS: Record<string, ShapeKind> = {
  rect: 'rect', ellipse: 'ellipse', arrow: 'arrow', line: 'line', underline: 'underline',
};

export interface MarqueeSetter {
  (r: Rect | null): void;
}

function topmostAt(page: number, x: number, y: number, tol: number) {
  const list = useDoc.getState().annotations[page] ?? [];
  for (let i = list.length - 1; i >= 0; i--) if (hitTest(list[i], x, y, tol)) return list[i];
  return null;
}

let freshTextId: string | null = null;

/** Testo: crea una nuova casella e avvia subito la modifica. */
export async function startTextAt(page: number, x: number, y: number) {
  const ui = useUi.getState();
  const style = ui.prefs.text;
  await ensureFont(style);
  const line = style.size * style.lineHeight + 8;
  const size = useDoc.getState().doc!.pageSizes[page];
  const w = Math.min(240, size.w - Math.min(x, size.w - 80));
  const ann: TextAnnotation = { id: newId(), page, kind: 'text', x, y: y - line / 2, w, h: line, text: '', style };
  addAnnotations([ann], false);
  const doc = useDoc.getState();
  doc.select([ann.id]);
  doc.setEditing(ann.id);
  freshTextId = ann.id;
}

export function finishTextEditing() {
  const doc = useDoc.getState();
  const id = doc.editingId;
  if (!id) return;
  doc.endTx();
  doc.setEditing(null);
  const a = findAnnotation(id);
  const fresh = freshTextId === id;
  freshTextId = null;
  if (a?.kind === 'text' && !a.text.trim()) {
    // Casella nuova rimasta vuota: sparisce senza lasciare traccia nella cronologia.
    if (fresh) useDoc.getState().discardLast();
    else removeAnnotations([id]);
  }
}

export function usePagePointer(
  page: number,
  overlay: RefObject<HTMLDivElement | null>,
  setMarquee: MarqueeSetter,
) {
  const gesture = useRef<Gesture | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Lo stilo non deve far scorrere la pagina mentre si disegna; il dito sì.
  useEffect(() => {
    const el = overlay.current;
    if (!el) return;
    const onTouch = (e: TouchEvent) => {
      const tool = useUi.getState().tool;
      const stylus = [...e.touches].some((t) => (t as Touch & { touchType?: string }).touchType === 'stylus');
      if (stylus && tool !== 'select') e.preventDefault();
    };
    el.addEventListener('touchstart', onTouch, { passive: false });
    return () => el.removeEventListener('touchstart', onTouch);
  }, [overlay]);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = overlay.current!.getBoundingClientRect();
    const scale = useUi.getState().scale;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  const clickSelect = (x: number, y: number, shift: boolean) => {
    const doc = useDoc.getState();
    const hit = topmostAt(page, x, y, 6 / useUi.getState().scale);
    if (!hit) {
      if (!shift) doc.select([]);
      return null;
    }
    if (shift) {
      doc.select(doc.selection.includes(hit.id) ? doc.selection.filter((id) => id !== hit.id) : [...doc.selection, hit.id]);
    } else if (!doc.selection.includes(hit.id)) {
      doc.select([hit.id]);
    }
    return hit;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ui = useUi.getState();
    const doc = useDoc.getState();
    if (e.button !== 0) return;
    const { x, y } = point(e);
    ui.set({ currentPage: page });

    if (e.pointerType === 'touch') {
      touchStart.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (doc.editingId) finishTextEditing();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const capture = () => overlay.current?.setPointerCapture(e.pointerId);
    const { tool, prefs } = ui;

    if (tool === 'pen' || tool === 'highlighter') {
      capture();
      const marker = tool === 'highlighter';
      const hasPressure = e.pointerType === 'pen';
      const ann: InkAnnotation = {
        id: newId(), page, kind: 'ink', tool,
        points: [x, y, hasPressure ? e.pressure : 0.5],
        hasPressure,
        color: marker ? prefs.highlighterColor : prefs.penColor,
        width: marker ? prefs.highlighterWidth : prefs.penWidth,
      };
      gesture.current = { type: 'ink', ann };
      ui.set({ live: ann });
    } else if (tool in SHAPE_TOOLS) {
      capture();
      const shape = SHAPE_TOOLS[tool];
      const ann: ShapeAnnotation = {
        id: newId(), page, kind: 'shape', shape, x1: x, y1: y, x2: x, y2: y,
        color: prefs.shapeColor, width: prefs.shapeWidth,
      };
      gesture.current = { type: 'shape', ann };
      if (shape === 'underline') void pageText(page);
    } else if (tool === 'eraser') {
      capture();
      doc.beginTx();
      gesture.current = { type: 'erase', erased: new Set() };
      erase(x, y);
    } else if (tool === 'text') {
      const hit = topmostAt(page, x, y, 0);
      if (hit?.kind === 'text') {
        doc.select([hit.id]);
        doc.setEditing(hit.id);
      } else {
        void startTextAt(page, x, y);
      }
    } else {
      capture();
      const hit = clickSelect(x, y, e.shiftKey);
      if (hit) {
        const ids = useDoc.getState().selection;
        gesture.current = { type: 'move', startX: x, startY: y, initial: findAnnotations(ids), moved: false };
      } else {
        gesture.current = { type: 'marquee', startX: x, startY: y, base: e.shiftKey ? doc.selection : [] };
      }
    }
  };

  const erase = (x: number, y: number) => {
    const g = gesture.current;
    if (g?.type !== 'erase') return;
    const doc = useDoc.getState();
    const list = doc.annotations[page] ?? [];
    const tol = 5 / useUi.getState().scale;
    const hits = list.filter((a) => (a.kind === 'ink' || a.kind === 'shape') && hitTest(a, x, y, tol));
    if (!hits.length) return;
    const gone = new Set(hits.map((a) => a.id));
    doc.patch((c) => ({ annotations: { ...c.annotations, [page]: (c.annotations[page] ?? []).filter((a) => !gone.has(a.id)) } }));
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const ui = useUi.getState();
    const { x, y } = point(e);
    if (e.pointerType !== 'touch') ui.set({ pointer: { page, x, y } });
    const g = gesture.current;
    if (!g) return;

    switch (g.type) {
      case 'ink': {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        const samples = events.length ? events : [e.nativeEvent];
        const added: number[] = [];
        for (const ev of samples) {
          const p = point(ev);
          added.push(p.x, p.y, g.ann.hasPressure ? ev.pressure : 0.5);
        }
        g.ann = { ...g.ann, points: g.ann.points.concat(added) };
        ui.set({ live: g.ann });
        break;
      }
      case 'shape': {
        let px = x;
        let py = y;
        if (e.shiftKey) ({ x: px, y: py } = constrain(g.ann.shape, g.ann.x1, g.ann.y1, x, y));
        g.ann = { ...g.ann, x2: px, y2: py };
        ui.set({ live: g.ann });
        if (g.ann.shape === 'underline') {
          const start = g.ann;
          void snapUnderline(page, start, ui.scale).then((snapped) => {
            if (gesture.current === g && g.ann === start) ui.set({ live: snapped });
          });
        }
        break;
      }
      case 'erase':
        erase(x, y);
        break;
      case 'move': {
        const dx = x - g.startX;
        const dy = y - g.startY;
        if (!g.moved && Math.hypot(dx, dy) * ui.scale < 3) return;
        if (!g.moved) {
          g.moved = true;
          useDoc.getState().beginTx();
        }
        const moved = g.initial.map((a) => translate(a, dx, dy));
        useDoc.getState().patch((c) => ({ annotations: withReplaced(c.annotations, moved) }));
        break;
      }
      case 'marquee': {
        const rect = rectFromPoints(g.startX, g.startY, x, y);
        setMarquee(rect);
        const list = useDoc.getState().annotations[page] ?? [];
        const ids = list.filter((a) => rectsIntersect(frame(a), rect)).map((a) => a.id);
        useDoc.getState().select([...new Set([...g.base, ...ids])]);
        break;
      }
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') {
      const s = touchStart.current;
      touchStart.current = null;
      if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 8) {
        const { x, y } = point(e);
        const tool = useUi.getState().tool;
        if (tool === 'select') clickSelect(x, y, false);
        else if (tool === 'text') void startTextAt(page, x, y);
      }
      return;
    }
    const g = gesture.current;
    gesture.current = null;
    const ui = useUi.getState();
    if (!g) return;
    switch (g.type) {
      case 'ink':
        addAnnotations([g.ann], false);
        ui.set({ live: null });
        break;
      case 'shape': {
        const ann = (ui.live as ShapeAnnotation | null) ?? g.ann;
        ui.set({ live: null });
        if (Math.hypot(ann.x2 - ann.x1, ann.y2 - ann.y1) >= 2) addAnnotations([ann], false);
        break;
      }
      case 'erase':
        useDoc.getState().endTx();
        break;
      case 'move':
        if (g.moved) useDoc.getState().endTx();
        break;
      case 'marquee':
        setMarquee(null);
        break;
    }
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    touchStart.current = null;
    useUi.getState().set({ live: null });
    setMarquee(null);
    if (g?.type === 'erase' || g?.type === 'move') useDoc.getState().endTx();
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (useUi.getState().tool !== 'select') return;
    const { x, y } = point(e);
    const hit = topmostAt(page, x, y, 2);
    if (hit?.kind === 'text') {
      useDoc.getState().select([hit.id]);
      useDoc.getState().setEditing(hit.id);
    }
  };

  // Il mousedown predefinito toglierebbe il fuoco alla casella di testo appena aperta.
  const onMouseDown = (e: React.MouseEvent) => e.preventDefault();

  return { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick, onMouseDown };
}

