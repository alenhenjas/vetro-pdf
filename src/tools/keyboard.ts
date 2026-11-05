import { copySelection, deleteSelection, duplicateSelection, handlePaste } from '../actions/editActions';
import { openWithPicker, saveAs, saveDocument } from '../actions/fileActions';
import { viewerApi } from '../actions/viewerApi';
import { translate } from '../model/geometry';
import type { Tool } from '../model/types';
import { findAnnotations, reorder, updateAnnotations, useDoc } from '../store/docStore';
import { useUi } from '../store/uiStore';
import { finishTextEditing } from './usePagePointer';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select', t: 'text', p: 'pen', h: 'highlighter', e: 'eraser',
  r: 'rect', o: 'ellipse', a: 'arrow', l: 'line', u: 'underline',
};

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.tagName === 'INPUT') return !['range', 'checkbox', 'color', 'radio'].includes((el as HTMLInputElement).type);
  return el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable;
};

function onKeyDown(e: KeyboardEvent) {
  const ui = useUi.getState();
  const doc = useDoc.getState();
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();

  if (ui.dialog) {
    if (key === 'escape' && ui.dialog.actions.some((a) => a.id === 'cancel')) ui.closeDialog('cancel');
    return;
  }

  // Scorciatoie valide anche mentre si scrive.
  if (mod && key === 's') {
    e.preventDefault();
    if (!doc.doc) return;
    if (e.shiftKey) void saveAs();
    else void saveDocument();
    return;
  }
  if (mod && key === 'o') {
    e.preventDefault();
    void openWithPicker();
    return;
  }
  if (!doc.doc) return;
  if (mod && key === 'f') {
    e.preventDefault();
    ui.set({ searchOpen: true });
    requestAnimationFrame(() => (document.querySelector('[data-search-input]') as HTMLInputElement | null)?.select());
    return;
  }
  if (key === 'escape' && doc.editingId) {
    finishTextEditing();
    return;
  }
  if (isTyping(e.target)) return;

  if (mod) {
    if (key === 'z') {
      e.preventDefault();
      if (e.shiftKey) doc.redo();
      else doc.undo();
    } else if (key === 'y') {
      e.preventDefault();
      doc.redo();
    } else if (key === 'd') {
      e.preventDefault();
      duplicateSelection();
    } else if (key === 'a') {
      e.preventDefault();
      doc.select((doc.annotations[ui.currentPage] ?? []).map((a) => a.id));
      ui.setTool('select');
    } else if (key === '+' || key === '=') {
      e.preventDefault();
      viewerApi.zoomBy(1.2);
    } else if (key === '-') {
      e.preventDefault();
      viewerApi.zoomBy(1 / 1.2);
    } else if (key === '0') {
      e.preventDefault();
      viewerApi.fitWidth();
    }
    return;
  }

  if (key === 'escape') {
    doc.select([]);
    if (ui.searchOpen) ui.set({ searchOpen: false });
    ui.setTool('select');
    return;
  }
  if (key === 'delete' || key === 'backspace') {
    e.preventDefault();
    deleteSelection();
    return;
  }
  if (e.key.startsWith('Arrow') && doc.selection.length) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    updateAnnotations(findAnnotations(doc.selection).map((a) => translate(a, dx, dy)));
    return;
  }
  if (key === ']' && doc.selection.length) reorder(doc.selection, 'front');
  else if (key === '[' && doc.selection.length) reorder(doc.selection, 'back');
  else if (!e.altKey && TOOL_KEYS[key]) {
    ui.setTool(TOOL_KEYS[key]);
    doc.select([]);
  }
}

function onCopy(e: ClipboardEvent) {
  if (isTyping(e.target)) return;
  if (copySelection(e.clipboardData)) e.preventDefault();
}

function onCut(e: ClipboardEvent) {
  if (isTyping(e.target)) return;
  if (copySelection(e.clipboardData)) {
    e.preventDefault();
    deleteSelection();
  }
}

function onPaste(e: ClipboardEvent) {
  if (isTyping(e.target)) return;
  handlePaste(e);
}

function onBeforeUnload(e: BeforeUnloadEvent) {
  const s = useDoc.getState();
  if (s.doc && s.rev !== s.savedRev) e.preventDefault();
}

function blockBrowserZoom(e: WheelEvent) {
  if (e.ctrlKey) e.preventDefault();
}

export function installGlobalShortcuts() {
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('copy', onCopy);
  window.addEventListener('cut', onCut);
  window.addEventListener('paste', onPaste);
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('wheel', blockBrowserZoom, { passive: false });
  return () => {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('copy', onCopy);
    window.removeEventListener('cut', onCut);
    window.removeEventListener('paste', onPaste);
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('wheel', blockBrowserZoom);
  };
}
