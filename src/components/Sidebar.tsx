import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { viewerApi } from '../actions/viewerApi';
import { requestThumb } from '../pdf/session';
import { useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';

const THUMB_W = 132;
const ROW_EXTRA = 34;

const Thumb = memo(function Thumb({ index, height }: { index: number; height: number }) {
  const [url, setUrl] = useState<string | null>(null);
  const count = useDoc((s) => s.annotations[index]?.length ?? 0);
  const active = useUi((s) => s.currentPage === index);

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void requestThumb(index, () => alive).then((u) => { if (alive && u) setUrl(u); });
    }, 60);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [index]);

  return (
    <button
      className={'thumb' + (active ? ' active' : '')}
      onClick={() => viewerApi.scrollToPage(index)}
      aria-label={`Vai a pagina ${index + 1}`}
      aria-current={active ? 'page' : undefined}
    >
      <span className="thumb-image" style={{ height }}>
        {url && <img src={url} alt="" draggable={false} />}
        {count > 0 && <span className="thumb-badge">{count}</span>}
      </span>
      <span className="thumb-label">{index + 1}</span>
    </button>
  );
});

export function Sidebar() {
  const pageSizes = useDoc((s) => s.doc!.pageSizes);
  const currentPage = useUi((s) => s.currentPage);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });

  const { tops, heights, total } = useMemo(() => {
    const tops: number[] = [];
    const heights: number[] = [];
    let y = 0;
    for (const p of pageSizes) {
      const h = Math.round((THUMB_W * p.h) / p.w);
      tops.push(y);
      heights.push(h);
      y += h + ROW_EXTRA;
    }
    return { tops, heights, total: y };
  }, [pageSizes]);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, height: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // La miniatura corrente resta in vista durante lo scorrimento del documento.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const top = tops[currentPage];
    const bottom = top + heights[currentPage] + ROW_EXTRA;
    if (top < el.scrollTop) el.scrollTop = top - 8;
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight + 8;
  }, [currentPage, tops, heights]);

  const items = [];
  for (let i = 0; i < pageSizes.length; i++) {
    if (tops[i] + heights[i] + ROW_EXTRA < view.top - 300) continue;
    if (tops[i] > view.top + view.height + 300) break;
    items.push(
      <div key={i} className="thumb-row" style={{ top: tops[i] }}>
        <Thumb index={i} height={heights[i]} />
      </div>,
    );
  }

  return (
    <aside className="sidebar glass" aria-label="Miniature delle pagine">
      <div
        ref={scroller}
        className="sidebar-scroll"
        onScroll={(e) => {
          const el = e.currentTarget;
          setView({ top: el.scrollTop, height: el.clientHeight });
        }}
      >
        <div style={{ height: total, position: 'relative' }}>{items}</div>
      </div>
    </aside>
  );
}
