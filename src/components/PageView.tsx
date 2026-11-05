import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Annotation, PageSize, Rect, TextAnnotation } from '../model/types';
import { pixelScale, renderPage } from '../pdf/session';
import { useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { usePagePointer } from '../tools/usePagePointer';
import { AnnotationLayers, AnnotationView } from './Annotations';
import { SearchHighlights } from './SearchHighlights';
import { SelectionOverlay } from './SelectionOverlay';
import { TextEditor } from './TextEditor';

const EMPTY: Annotation[] = [];

function PageCanvas({ index, size, scale }: { index: number; size: PageSize; scale: number }) {
  const holder = useRef<HTMLDivElement>(null);
  const px = pixelScale(size, scale);

  useEffect(() => {
    const el = holder.current;
    if (!el) return;
    let cancelRender: (() => void) | undefined;
    const start = () => {
      cancelRender = renderPage(index, px, (canvas) => {
        if (el.firstChild !== canvas) el.replaceChildren(canvas);
      });
    };
    // Durante lo zoom resta visibile il canvas precedente, ingrandito via CSS.
    const timer = el.firstChild ? setTimeout(start, 130) : setTimeout(start, 0);
    return () => {
      clearTimeout(timer);
      cancelRender?.();
    };
  }, [index, px]);

  return <div ref={holder} className="page-canvas" style={{ width: size.w * scale, height: size.h * scale }} />;
}

export const PageView = memo(function PageView({ index, size, margin, top, left, scale }: {
  index: number; size: PageSize; margin: number; top: number; left: number; scale: number;
}) {
  const list = useDoc((s) => s.annotations[index] ?? EMPTY);
  const selection = useDoc((s) => s.selection);
  const editingId = useDoc((s) => s.editingId);
  const live = useUi((s) => (s.live?.page === index ? s.live : null));
  const overlay = useRef<HTMLDivElement>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const handlers = usePagePointer(index, overlay, setMarquee);

  const width = size.w + margin;
  const selected = useMemo(() => list.filter((a) => selection.includes(a.id)), [list, selection]);
  const editing = list.find((a) => a.id === editingId) as TextAnnotation | undefined;
  const showHandles = selected.length > 0 && !editing;

  return (
    <div className="page" data-page={index} style={{ top, left, width: width * scale, height: size.h * scale }}>
      <PageCanvas index={index} size={size} scale={scale} />
      {margin > 0 && (
        <div className="page-margin" style={{ left: size.w * scale, width: margin * scale, height: size.h * scale }} />
      )}
      <SearchHighlights index={index} width={width} height={size.h} />
      <AnnotationLayers list={list} width={width} height={size.h} editingId={editingId} />
      {live && (
        <svg className="annotation-svg" viewBox={`0 0 ${width} ${size.h}`} preserveAspectRatio="none">
          <AnnotationView a={live} />
        </svg>
      )}
      <div ref={overlay} className="page-overlay" {...handlers} />
      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.x * scale, top: marquee.y * scale, width: marquee.w * scale, height: marquee.h * scale }}
        />
      )}
      {showHandles && <SelectionOverlay items={selected} scale={scale} />}
      {editing && <TextEditor key={editing.id} a={editing} scale={scale} />}
    </div>
  );
});
