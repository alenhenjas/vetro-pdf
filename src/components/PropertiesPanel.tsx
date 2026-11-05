import {
  AlignCenter, AlignLeft, AlignRight, Bold, BringToFront, ChevronDown, Copy, Italic, RotateCw, SendToBack, Trash2, Underline,
} from 'lucide-react';
import { useEffect } from 'react';
import { deleteSelection, duplicateSelection } from '../actions/editActions';
import { FONTS } from '../model/fonts';
import { ensureFont, layoutText } from '../model/textLayout';
import type { Annotation, ImageAnnotation, TextAnnotation, TextStyle } from '../model/types';
import { findAnnotations, reorder, updateAnnotations, useDoc, withReplaced } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { ColorRow, IconButton, Slider, usePopover } from './ui';

function FontPicker({ value, onChange }: { value: string; onChange: (f: string) => void }) {
  const { open, setOpen, ref } = usePopover();
  useEffect(() => {
    if (open) FONTS.forEach((f) => void ensureFont({ font: f.family, bold: false, italic: false }));
  }, [open]);
  return (
    <div className="popover-host" ref={ref}>
      <button
        type="button" className="field-btn" data-testid="font-picker" style={{ fontFamily: `"${value}"` }}
        onClick={() => setOpen(!open)} aria-haspopup="listbox" aria-expanded={open}
      >
        {value}<ChevronDown size={14} />
      </button>
      {open && (
        <div className="popover glass font-list" role="listbox">
          {FONTS.map((f) => (
            <button
              key={f.family} type="button" role="option" aria-selected={f.family === value}
              className={'font-option' + (f.family === value ? ' active' : '')}
              onClick={() => { onChange(f.family); setOpen(false); }}
            >
              <span style={{ fontFamily: `"${f.family}"` }}>{f.family}</span>
              <small>{f.category}</small>
              <span className="font-sample" style={{ fontFamily: `"${f.family}"` }}>Aa àè 123</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BackgroundPicker({ style, onChange }: { style: TextStyle; onChange: (p: Partial<TextStyle>) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div className="popover-host" ref={ref}>
      <button type="button" className="bg-btn" data-testid="bg-picker" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="bg-swatch" style={{ background: style.background, opacity: Math.max(0.15, style.backgroundOpacity) }} />
        Sfondo
      </button>
      {open && (
        <div className="popover glass bg-pop">
          <ColorRow
            value={style.background} label="Sfondo"
            onChange={(background) => onChange({ background, backgroundOpacity: style.backgroundOpacity || 1 })}
          />
          <Slider
            label="Opacità" value={style.backgroundOpacity} min={0} max={1} step={0.05}
            onChange={(backgroundOpacity) => onChange({ backgroundOpacity })} format={(v) => `${Math.round(v * 100)}%`}
          />
        </div>
      )}
    </div>
  );
}

function TextControls({ style, onChange }: { style: TextStyle; onChange: (p: Partial<TextStyle>) => void }) {
  return (
    <>
      <div className="panel-row">
        <FontPicker value={style.font} onChange={(font) => onChange({ font })} />
        <label className="number-field">
          <span className="sr-only">Dimensione</span>
          <input
            type="number" min={6} max={144} value={style.size} data-testid="font-size"
            onChange={(e) => { const v = Number(e.target.value); if (v >= 1) onChange({ size: v }); }}
          />
          <span>pt</span>
        </label>
        <span className="divider-v" />
        <IconButton icon={Bold} label="Grassetto" active={style.bold} tipSide="top" onClick={() => onChange({ bold: !style.bold })} />
        <IconButton icon={Italic} label="Corsivo" active={style.italic} tipSide="top" onClick={() => onChange({ italic: !style.italic })} />
        <IconButton icon={Underline} label="Sottolineato" active={style.underline} tipSide="top" onClick={() => onChange({ underline: !style.underline })} />
        <span className="divider-v" />
        <IconButton icon={AlignLeft} label="Allinea a sinistra" active={style.align === 'left'} tipSide="top" onClick={() => onChange({ align: 'left' })} />
        <IconButton icon={AlignCenter} label="Centra" active={style.align === 'center'} tipSide="top" onClick={() => onChange({ align: 'center' })} />
        <IconButton icon={AlignRight} label="Allinea a destra" active={style.align === 'right'} tipSide="top" onClick={() => onChange({ align: 'right' })} />
      </div>
      <div className="panel-row">
        <ColorRow value={style.color} onChange={(color) => onChange({ color })} label="Colore del testo" />
        <span className="divider-v" />
        <Slider
          label="Interlinea" value={style.lineHeight} min={1} max={2.4} step={0.05}
          onChange={(lineHeight) => onChange({ lineHeight })} format={(v) => v.toFixed(2)}
        />
        <span className="divider-v" />
        <BackgroundPicker style={style} onChange={onChange} />
      </div>
    </>
  );
}

function WidthPreview({ width, color, marker }: { width: number; color: string; marker?: boolean }) {
  return (
    <span className="width-preview" aria-hidden>
      <span style={{ height: Math.min(26, Math.max(1, width)), background: color, opacity: marker ? 0.6 : 1 }} />
    </span>
  );
}

function SelectionActions({ list }: { list: Annotation[] }) {
  const ids = list.map((a) => a.id);
  return (
    <>
      <IconButton icon={BringToFront} label="Porta avanti" shortcut="]" tipSide="top" onClick={() => reorder(ids, 'front')} />
      <IconButton icon={SendToBack} label="Porta indietro" shortcut="[" tipSide="top" onClick={() => reorder(ids, 'back')} />
      <IconButton icon={Copy} label="Duplica" shortcut="Ctrl+D" tipSide="top" onClick={duplicateSelection} />
      <IconButton icon={Trash2} label="Elimina" shortcut="Canc" tipSide="top" onClick={deleteSelection} />
    </>
  );
}

/** Applica una modifica alla selezione, una voce di annullamento per ogni interazione. */
function liveUpdate(changed: Annotation[], commit: boolean) {
  const doc = useDoc.getState();
  if (doc.editingId) {
    doc.patch((c) => ({ annotations: withReplaced(c.annotations, changed) }));
  } else if (commit) {
    updateAnnotations(changed);
  } else {
    doc.beginTx();
    doc.patch((c) => ({ annotations: withReplaced(c.annotations, changed) }));
  }
}
const endLive = () => {
  const doc = useDoc.getState();
  if (!doc.editingId) doc.endTx();
};

function fit(a: TextAnnotation): TextAnnotation {
  const needed = layoutText(a).contentHeight;
  return needed > a.h ? { ...a, h: needed } : a;
}

export function PropertiesPanel() {
  const tool = useUi((s) => s.tool);
  const prefs = useUi((s) => s.prefs);
  const setPrefs = useUi((s) => s.setPrefs);
  const setTextPrefs = useUi((s) => s.setTextPrefs);
  const selectionIds = useDoc((s) => s.selection);
  useDoc((s) => s.annotations);
  const editing = useDoc((s) => s.editingId !== null);
  const selection = findAnnotations(selectionIds);

  const texts = selection.filter((a): a is TextAnnotation => a.kind === 'text');
  const strokes = selection.filter((a) => a.kind === 'ink' || a.kind === 'shape');
  const images = selection.filter((a): a is ImageAnnotation => a.kind === 'image');

  const applyText = (p: Partial<TextStyle>) => {
    setTextPrefs(p);
    const needsFont = p.font !== undefined || p.bold !== undefined || p.italic !== undefined;
    const run = () => {
      const current = findAnnotations(texts.map((t) => t.id)) as TextAnnotation[];
      if (current.length) liveUpdate(current.map((t) => fit({ ...t, style: { ...t.style, ...p } })), true);
    };
    if (needsFont) {
      const merged = { ...(texts[0]?.style ?? prefs.text), ...p };
      void ensureFont(merged).then(run);
    } else {
      run();
    }
  };

  const applyStroke = (p: { color?: string; width?: number }, commit = true) => {
    if (strokes.length) liveUpdate(strokes.map((a) => ({ ...a, ...p }) as Annotation), commit);
  };

  if (selection.length) {
    const multiple = (texts.length > 0 ? 1 : 0) + (strokes.length > 0 ? 1 : 0) + (images.length > 0 ? 1 : 0) > 1;
    const first = strokes[0] as (Annotation & { color: string; width: number }) | undefined;
    return (
      <div className="panel glass" data-panel="selection">
        {texts.length > 0 && !multiple && (
          <TextControls style={texts[0].style} onChange={applyText} />
        )}
        {first && !multiple && (
          <div className="panel-row">
            <ColorRow value={first.color} onChange={(color) => applyStroke({ color })} />
            <span className="divider-v" />
            <Slider
              label="Spessore" value={first.width} min={0.5} max={40} step={0.5}
              onChange={(width) => applyStroke({ width }, false)} onCommit={endLive}
            />
          </div>
        )}
        {!editing && <div className="panel-row">
          {images.length === 1 && selection.length === 1 && (
            <>
              <Slider
                label="Rotazione" value={Math.round(images[0].rotation)} min={0} max={359} step={1}
                onChange={(rotation) => liveUpdate([{ ...images[0], rotation }], false)} onCommit={endLive}
                format={(v) => `${v}°`}
              />
              <IconButton
                icon={RotateCw} label="Ruota di 90°" tipSide="top"
                onClick={() => updateAnnotations([{ ...images[0], rotation: (images[0].rotation + 90) % 360 }])}
              />
              <span className="divider-v" />
            </>
          )}
          {selection.length > 1 && <span className="panel-note">{selection.length} oggetti</span>}
          <SelectionActions list={selection} />
        </div>}
      </div>
    );
  }

  if (tool === 'text') {
    return <div className="panel glass" data-panel="text"><TextControls style={prefs.text} onChange={applyText} /></div>;
  }
  if (tool === 'pen' || tool === 'highlighter') {
    const marker = tool === 'highlighter';
    const color = marker ? prefs.highlighterColor : prefs.penColor;
    const width = marker ? prefs.highlighterWidth : prefs.penWidth;
    return (
      <div className="panel glass" data-panel={tool}>
        <div className="panel-row">
          <ColorRow value={color} highlight={marker} onChange={(c) => setPrefs(marker ? { highlighterColor: c } : { penColor: c })} />
          <span className="divider-v" />
          <WidthPreview width={width} color={color} marker={marker} />
          <Slider
            label="Spessore" value={width} min={marker ? 4 : 0.5} max={marker ? 40 : 20} step={0.5}
            onChange={(w) => setPrefs(marker ? { highlighterWidth: w } : { penWidth: w })}
          />
        </div>
      </div>
    );
  }
  if (tool === 'rect' || tool === 'ellipse' || tool === 'arrow' || tool === 'line' || tool === 'underline') {
    return (
      <div className="panel glass" data-panel="shape">
        <div className="panel-row">
          <ColorRow value={prefs.shapeColor} onChange={(shapeColor) => setPrefs({ shapeColor })} />
          <span className="divider-v" />
          <WidthPreview width={prefs.shapeWidth} color={prefs.shapeColor} />
          <Slider
            label="Spessore" value={prefs.shapeWidth} min={0.5} max={20} step={0.5}
            onChange={(shapeWidth) => setPrefs({ shapeWidth })}
          />
          <span className="panel-note">{tool === 'underline' ? 'Si aggancia al testo' : 'Shift vincola'}</span>
        </div>
      </div>
    );
  }
  if (tool === 'eraser') {
    return <div className="panel glass" data-panel="eraser"><div className="panel-row"><span className="panel-note">Passa sopra un tratto o una forma per cancellarlo</span></div></div>;
  }
  return null;
}
