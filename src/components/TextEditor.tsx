import { useEffect, useLayoutEffect, useRef } from 'react';
import { CSS_FONT_FEATURES, TEXT_PADDING } from '../model/fonts';
import { layoutText } from '../model/textLayout';
import type { TextAnnotation } from '../model/types';
import { useDoc, withReplaced } from '../store/docStore';

/** Textarea posizionata sopra la casella: stessa geometria e stesso font del disegno finale. */
export function TextEditor({ a, scale }: { a: TextAnnotation; scale: number }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { style } = a;

  useEffect(() => {
    useDoc.getState().beginTx();
    const el = ref.current;
    el?.focus({ preventScroll: true });
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [a.id]);

  // Se cambia lo stile dal pannello, la casella si adatta al nuovo ingombro.
  useLayoutEffect(() => {
    const needed = layoutText(a).contentHeight;
    if (needed > a.h + 0.01) {
      useDoc.getState().patch((c) => ({ annotations: withReplaced(c.annotations, [{ ...a, h: needed }]) }));
    }
  }, [a]);

  return (
    <textarea
      ref={ref}
      data-text-editor
      className="text-editor"
      spellCheck={false}
      value={a.text}
      onChange={(e) => {
        const next = { ...a, text: e.target.value };
        useDoc.getState().patch((c) => ({ annotations: withReplaced(c.annotations, [next]) }));
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        left: a.x * scale,
        top: a.y * scale,
        width: a.w * scale,
        height: a.h * scale,
        padding: TEXT_PADDING * scale,
        fontFamily: `"${style.font}"`,
        fontSize: style.size * scale,
        fontWeight: style.bold ? 700 : 400,
        fontStyle: style.italic ? 'italic' : 'normal',
        fontFeatureSettings: CSS_FONT_FEATURES,
        textDecoration: style.underline ? 'underline' : 'none',
        lineHeight: `${style.size * style.lineHeight * scale}px`,
        textAlign: style.align,
        color: style.color,
      }}
    />
  );
}
