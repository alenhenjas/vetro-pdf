import {
  ArrowUpRight, Circle, Eraser, Highlighter, ImagePlus, Minus, MousePointer2, Pen, Redo2, Square, Type, Underline, Undo2,
  type LucideIcon,
} from 'lucide-react';
import { pickImages } from '../actions/editActions';
import type { Tool } from '../model/types';
import { useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { finishTextEditing } from '../tools/usePagePointer';
import { IconButton } from './ui';

const GROUPS: { tool: Tool; icon: LucideIcon; label: string; key: string }[][] = [
  [
    { tool: 'select', icon: MousePointer2, label: 'Selezione', key: 'V' },
    { tool: 'text', icon: Type, label: 'Testo', key: 'T' },
  ],
  [
    { tool: 'pen', icon: Pen, label: 'Penna', key: 'P' },
    { tool: 'highlighter', icon: Highlighter, label: 'Evidenziatore', key: 'H' },
    { tool: 'underline', icon: Underline, label: 'Sottolineatura', key: 'U' },
    { tool: 'eraser', icon: Eraser, label: 'Gomma', key: 'E' },
  ],
  [
    { tool: 'line', icon: Minus, label: 'Linea', key: 'L' },
    { tool: 'arrow', icon: ArrowUpRight, label: 'Freccia', key: 'A' },
    { tool: 'rect', icon: Square, label: 'Rettangolo', key: 'R' },
    { tool: 'ellipse', icon: Circle, label: 'Ellisse', key: 'O' },
  ],
];

export function Dock() {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  const canUndo = useDoc((s) => s.past.length > 0);
  const canRedo = useDoc((s) => s.future.length > 0);
  const undo = useDoc((s) => s.undo);
  const redo = useDoc((s) => s.redo);

  return (
    <nav className="dock glass" aria-label="Strumenti">
      {GROUPS.map((group, i) => (
        <div className="dock-group" key={i}>
          {group.map((t) => (
            <IconButton
              key={t.tool} icon={t.icon} label={t.label} shortcut={t.key} active={tool === t.tool}
              tipSide="top" data-tool={t.tool} size={19}
              onClick={() => {
                finishTextEditing();
                setTool(t.tool);
                useDoc.getState().select([]);
              }}
            />
          ))}
        </div>
      ))}
      <div className="dock-group">
        <IconButton icon={ImagePlus} label="Inserisci immagine" tipSide="top" size={19} onClick={pickImages} data-action="insert-image" />
      </div>
      <div className="dock-group">
        <IconButton icon={Undo2} label="Annulla" shortcut="Ctrl+Z" tipSide="top" size={19} disabled={!canUndo} onClick={undo} />
        <IconButton icon={Redo2} label="Ripeti" shortcut="Ctrl+Y" tipSide="top" size={19} disabled={!canRedo} onClick={redo} />
      </div>
    </nav>
  );
}
