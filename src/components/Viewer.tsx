import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { insertImages } from '../actions/editActions';
import { openDropped } from '../actions/fileActions';
import { viewerApi } from '../actions/viewerApi';
import type { Tool } from '../model/types';
import { setRenderFocus } from '../pdf/session';
import { useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { PageView } from './PageView';

const GAP = 18;
const PAD_TOP = 76;
const PAD_BOTTOM = 150;
const SIDE = 24;

function lowerBound(tops: number[], value: number) {
  let lo = 0;
  let hi = tops.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (tops[mid] <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function cursorFor(tool: Tool, color: string, width: number, scale: number) {
  if (tool !== 'pen' && tool !== 'highlighter') return undefined;
  const d = Math.max(4, Math.min(64, width * scale));
  const size = Math.ceil(d + 8);
  const c = size / 2;
  const svg = tool === 'pen'
    ? `<circle cx="${c}" cy="${c}" r="${d / 2}" fill="${color}" stroke="#fff" stroke-width="1.5"/><circle cx="${c}" cy="${c}" r="${d / 2 + 1}" fill="none" stroke="#0005"/>`
    : `<rect x="${c - d * 0.22}" y="${c - d / 2}" width="${d * 0.44}" height="${d}" rx="2" fill="${color}" fill-opacity=".75" stroke="#0006"/>`;
  const url = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">${svg}</svg>`)}`;
  return `url("${url}") ${c} ${c}, crosshair`;
}

export function Viewer() {
  const doc = useDoc((s) => s.doc)!;
  const margins = useDoc((s) => s.margins);
  const scale = useUi((s) => s.scale);
  const tool = useUi((s) => s.tool);
  const prefs = useUi((s) => s.prefs);
  const sidebarOpen = useUi((s) => s.sidebarOpen);

  const scroller = useRef<HTMLDivElement>(null);
  const anchor = useRef<{ page: number; fracY: number; offX: number; fx: number; fy: number } | null>(null);
  const [view, setView] = useState({ top: 0, height: 800, width: 1000 });
  const [dragOver, setDragOver] = useState(false);

  const { pageSizes } = doc;

  const layout = useMemo(() => {
    const tops = new Array<number>(pageSizes.length);
    let y = PAD_TOP;
    let maxW = 0;
    pageSizes.forEach((p, i) => {
      tops[i] = y;
      y += p.h * scale + GAP;
      maxW = Math.max(maxW, (p.w + (margins[i] ?? 0)) * scale);
    });
    return { tops, height: y + PAD_BOTTOM, maxW };
  }, [pageSizes, margins, scale]);

  const contentWidth = Math.max(view.width, layout.maxW + SIDE * 2);

  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    setView({ top: el.scrollTop, height: el.clientHeight, width: el.clientWidth });
  }, []);

  // Pagina corrente: quella che occupa il centro della finestra.
  useEffect(() => {
    const center = view.top + view.height / 2;
    const page = lowerBound(layout.tops, center);
    useUi.getState().set({ currentPage: page });
    setRenderFocus(page);
  }, [view, layout]);

  useLayoutEffect(() => {
    measure();
    const el = scroller.current!;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);

  // Lo zoom mantiene fermo il punto sotto il cursore.
  useLayoutEffect(() => {
    const a = anchor.current;
    const el = scroller.current;
    if (!a || !el) return;
    anchor.current = null;
    const pageH = pageSizes[a.page].h * scale;
    el.scrollTop = layout.tops[a.page] + a.fracY * pageH - a.fy;
    el.scrollLeft = contentWidth / 2 + a.offX * scale - a.fx;
    measure();
  }, [scale, layout, contentWidth, pageSizes, measure]);

  const fitScale = useCallback(() => {
    const el = scroller.current;
    if (!el) return 1;
    const page = useUi.getState().currentPage;
    const width = pageSizes[page].w + (useDoc.getState().margins[page] ?? 0);
    return (el.clientWidth - SIDE * 2) / width;
  }, [pageSizes]);

  const prepareAnchor = useCallback((focus?: { clientX: number; clientY: number }) => {
    const el = scroller.current!;
    const r = el.getBoundingClientRect();
    const fx = focus ? focus.clientX - r.left : el.clientWidth / 2;
    const fy = focus ? focus.clientY - r.top : el.clientHeight / 2;
    const contentX = el.scrollLeft + fx;
    const contentY = el.scrollTop + fy;
    const page = lowerBound(layout.tops, contentY);
    const cur = useUi.getState().scale;
    anchor.current = {
      page,
      fracY: (contentY - layout.tops[page]) / (pageSizes[page].h * cur),
      offX: (contentX - contentWidth / 2) / cur,
      fx,
      fy,
    };
  }, [layout, pageSizes, contentWidth]);

  useEffect(() => {
    viewerApi.zoomBy = (factor, focus) => {
      prepareAnchor(focus);
      const ui = useUi.getState();
      ui.setScale(ui.scale * factor);
    };
    viewerApi.zoomTo = (s) => {
      prepareAnchor();
      useUi.getState().setScale(s);
    };
    viewerApi.fitWidth = () => {
      prepareAnchor();
      useUi.getState().setScale(fitScale());
    };
    viewerApi.scrollToPage = (page, yPt) => {
      const el = scroller.current;
      if (!el) return;
      const s = useUi.getState().scale;
      const offset = yPt === undefined ? -PAD_TOP + 8 : yPt * s - el.clientHeight * 0.35;
      el.scrollTop = layout.tops[page] + offset;
    };
  }, [prepareAnchor, fitScale, layout]);

  // Primo adattamento alla larghezza: comodo ma mai eccessivo sui monitor grandi.
  const fittedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (fittedFor.current === doc.docKey || !scroller.current) return;
    fittedFor.current = doc.docKey;
    useUi.getState().setScale(Math.min(1.6, fitScale()));
    scroller.current.scrollTop = 0;
  }, [doc.docKey, fitScale]);

  // Ctrl+rotella e pinch del trackpad (che Chrome trasforma in wheel con ctrlKey).
  useEffect(() => {
    const el = scroller.current!;
    let accumulated = 1;
    let raf = 0;
    let last = { clientX: 0, clientY: 0 };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      accumulated *= Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      last = { clientX: e.clientX, clientY: e.clientY };
      if (!raf) {
        raf = requestAnimationFrame(() => {
          raf = 0;
          viewerApi.zoomBy(accumulated, last);
          accumulated = 1;
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });

    // Pinch su schermo touch.
    let pinch: { dist: number } | null = null;
    const distance = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) pinch = { dist: distance(e.touches) };
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const dist = distance(e.touches);
      viewerApi.zoomBy(dist / pinch.dist, {
        clientX: (e.touches[0].clientX + e.touches[1].clientX) / 2,
        clientY: (e.touches[0].clientY + e.touches[1].clientY) / 2,
      });
      pinch.dist = dist;
    };
    const onTouchEnd = () => { pinch = null; };
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
    };
  }, []);

  const onScroll = useCallback(() => {
    requestAnimationFrame(measure);
  }, [measure]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = [...e.dataTransfer.files];
    if (files.some((f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf'))) {
      void openDropped(e);
      return;
    }
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (!images.length) return;
    const pageEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('[data-page]');
    if (pageEl) {
      const r = pageEl.getBoundingClientRect();
      const s = useUi.getState().scale;
      const page = Number((pageEl as HTMLElement).dataset.page);
      void insertImages(images, { page, x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s });
    } else {
      void insertImages(images, null);
    }
  };

  const overscan = view.height;
  const first = lowerBound(layout.tops, view.top - overscan);
  const last = lowerBound(layout.tops, view.top + view.height + overscan);
  const pages = [];
  for (let i = first; i <= last; i++) {
    const size = pageSizes[i];
    const margin = margins[i] ?? 0;
    pages.push(
      <PageView
        key={i} index={i} size={size} margin={margin} scale={scale}
        top={layout.tops[i]} left={(contentWidth - (size.w + margin) * scale) / 2}
      />,
    );
  }

  const color = tool === 'highlighter' ? prefs.highlighterColor : prefs.penColor;
  const width = tool === 'highlighter' ? prefs.highlighterWidth : prefs.penWidth;

  return (
    <div
      ref={scroller}
      className={`viewer tool-${tool}${sidebarOpen ? ' with-sidebar' : ''}${dragOver ? ' drag-over' : ''}`}
      data-viewer
      onScroll={onScroll}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragOver(false); }}
      onDrop={onDrop}
      style={{ ['--tool-cursor' as string]: cursorFor(tool, color, width, scale) }}
    >
      <div className="viewer-content" style={{ width: contentWidth, height: layout.height }}>{pages}</div>
    </div>
  );
}
