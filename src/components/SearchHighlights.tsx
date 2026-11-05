import { useSearch } from '../store/searchStore';

export function SearchHighlights({ index, width, height }: { index: number; width: number; height: number }) {
  const rects = useSearch((s) => s.byPage[index]);
  const active = useSearch((s) => s.active);
  if (!rects?.length) return null;
  return (
    <svg className="annotation-svg multiply" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      {rects.map((r) => (
        <rect
          key={r.match} x={r.x} y={r.y} width={r.w} height={r.h} rx={1.5}
          fill={r.match === active ? '#ff9f0a' : '#ffe066'} data-search-hit
        />
      ))}
    </svg>
  );
}
