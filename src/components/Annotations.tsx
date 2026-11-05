import { memo, useMemo, type CSSProperties } from 'react';
import { CSS_FONT_FEATURES } from '../model/fonts';
import { inkOps, segsToSvg, shapeOps, type DrawOp } from '../model/paths';
import { layoutText } from '../model/textLayout';
import type { Annotation, ImageAnnotation, TextAnnotation } from '../model/types';
import { session } from '../pdf/session';

function Ops({ ops }: { ops: DrawOp[] }) {
  return (
    <>
      {ops.map((op, i) => (
        <path
          key={i}
          d={segsToSvg(op.segs)}
          fill={op.fill ?? 'none'}
          stroke={op.stroke ?? 'none'}
          strokeWidth={op.strokeWidth}
          strokeLinecap={op.round ? 'round' : 'butt'}
          strokeLinejoin={op.round ? 'round' : 'miter'}
          opacity={op.opacity}
        />
      ))}
    </>
  );
}

function TextView({ a, hidden }: { a: TextAnnotation; hidden: boolean }) {
  const { style } = a;
  const layout = layoutText(a);
  const css: CSSProperties = {
    fontFamily: `"${style.font}"`,
    fontSize: style.size,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontFeatureSettings: CSS_FONT_FEATURES,
    whiteSpace: 'pre',
    textRendering: 'geometricPrecision',
  };
  return (
    <>
      {style.backgroundOpacity > 0 && (
        <rect x={a.x} y={a.y} width={a.w} height={a.h} fill={style.background} opacity={style.backgroundOpacity} />
      )}
      {!hidden && layout.lines.map((line, i) => (
        <g key={i}>
          <text x={line.x} y={line.baseline} fill={style.color} style={css}>{line.text}</text>
          {style.underline && line.width > 0 && (
            <rect
              x={line.x} y={line.baseline + style.size * 0.11}
              width={line.width} height={Math.max(0.5, style.size * 0.06)} fill={style.color}
            />
          )}
        </g>
      ))}
    </>
  );
}

function ImageView({ a }: { a: ImageAnnotation }) {
  const href = session.assetUrls.get(a.assetId);
  const cx = a.x + a.w / 2;
  const cy = a.y + a.h / 2;
  return (
    <image
      href={href} x={a.x} y={a.y} width={a.w} height={a.h} preserveAspectRatio="none"
      transform={a.rotation ? `rotate(${a.rotation} ${cx} ${cy})` : undefined}
    />
  );
}

export const AnnotationView = memo(function AnnotationView({ a, editing }: { a: Annotation; editing?: boolean }) {
  return (
    <g data-annotation-id={a.id} data-kind={a.kind} data-subkind={a.kind === 'ink' ? a.tool : a.kind === 'shape' ? a.shape : undefined}>
      {a.kind === 'ink' && <Ops ops={inkOps(a)} />}
      {a.kind === 'shape' && <Ops ops={shapeOps(a)} />}
      {a.kind === 'text' && <TextView a={a} hidden={!!editing} />}
      {a.kind === 'image' && <ImageView a={a} />}
    </g>
  );
});

const isMultiply = (a: Annotation) => a.kind === 'ink' && a.tool === 'highlighter';

/**
 * L'evidenziatore si fonde col PDF in modalità multiply, che in CSS funziona solo a livello di
 * elemento SVG radice: le annotazioni vengono quindi spezzate in gruppi consecutivi,
 * mantenendo l'ordine di sovrapposizione.
 */
export function AnnotationLayers({ list, width, height, editingId }: {
  list: Annotation[]; width: number; height: number; editingId: string | null;
}) {
  const runs = useMemo(() => {
    const out: { multiply: boolean; items: Annotation[] }[] = [];
    for (const a of list) {
      const multiply = isMultiply(a);
      const last = out[out.length - 1];
      if (last && last.multiply === multiply) last.items.push(a);
      else out.push({ multiply, items: [a] });
    }
    return out;
  }, [list]);
  return (
    <>
      {runs.map((run, i) => (
        <svg
          key={i} className={'annotation-svg' + (run.multiply ? ' multiply' : '')}
          viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none"
        >
          {run.items.map((a) => <AnnotationView key={a.id} a={a} editing={a.id === editingId} />)}
        </svg>
      ))}
    </>
  );
}
