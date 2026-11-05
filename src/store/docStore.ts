import { create } from 'zustand';
import type { Annotation, AnnotationMap, MarginMap, PageSize } from '../model/types';

export interface DocInfo {
  name: string;
  docKey: string;
  /** Cambia a ogni apertura: rimonta le viste legate al PDF caricato. */
  openId: number;
  handle: FileSystemFileHandle | null;
  pageSizes: PageSize[];
  /** Data di modifica del file su disco quando è stato letto o scritto l'ultima volta. */
  lastModified: number | null;
}

interface Snapshot {
  annotations: AnnotationMap;
  margins: MarginMap;
  rev: number;
}

type Content = Pick<Snapshot, 'annotations' | 'margins'>;

interface DocState {
  doc: DocInfo | null;
  annotations: AnnotationMap;
  margins: MarginMap;
  rev: number;
  savedRev: number;
  past: Snapshot[];
  future: Snapshot[];
  /** Stato prima della transazione in corso (trascinamenti, digitazione). */
  txBase: Snapshot | null;
  selection: string[];
  editingId: string | null;

  setDoc(doc: DocInfo | null, content?: Content): void;
  patchDoc(patch: Partial<DocInfo>): void;
  commit(fn: (c: Content) => Partial<Content>): void;
  beginTx(): void;
  patch(fn: (c: Content) => Partial<Content>): void;
  endTx(): void;
  cancelTx(): void;
  undo(): void;
  discardLast(): void;
  redo(): void;
  markSaved(rev: number): void;
  select(ids: string[]): void;
  setEditing(id: string | null): void;
}

let revCounter = 1;
const snapshot = (s: DocState): Snapshot => ({ annotations: s.annotations, margins: s.margins, rev: s.rev });

export const useDoc = create<DocState>((set, get) => ({
  doc: null,
  annotations: {},
  margins: {},
  rev: 0,
  savedRev: 0,
  past: [],
  future: [],
  txBase: null,
  selection: [],
  editingId: null,

  setDoc: (doc, content) => {
    const rev = revCounter++;
    set({
      doc,
      annotations: content?.annotations ?? {},
      margins: content?.margins ?? {},
      rev,
      savedRev: rev,
      past: [],
      future: [],
      txBase: null,
      selection: [],
      editingId: null,
    });
  },

  patchDoc: (patch) => set((s) => ({ doc: s.doc ? { ...s.doc, ...patch } : s.doc })),

  commit: (fn) => set((s) => ({
    ...fn({ annotations: s.annotations, margins: s.margins }),
    past: [...s.past, snapshot(s)],
    future: [],
    rev: revCounter++,
  })),

  beginTx: () => {
    const s = get();
    if (!s.txBase) set({ txBase: snapshot(s) });
  },

  patch: (fn) => set((s) => fn({ annotations: s.annotations, margins: s.margins })),

  endTx: () => set((s) => {
    if (!s.txBase) return {};
    const changed = s.annotations !== s.txBase.annotations || s.margins !== s.txBase.margins;
    if (!changed) return { txBase: null };
    return { past: [...s.past, s.txBase], future: [], txBase: null, rev: revCounter++ };
  }),

  cancelTx: () => set((s) => (s.txBase
    ? { annotations: s.txBase.annotations, margins: s.txBase.margins, txBase: null }
    : {})),

  undo: () => set((s) => {
    const prev = s.past[s.past.length - 1];
    if (!prev) return {};
    return {
      ...prev,
      past: s.past.slice(0, -1),
      future: [snapshot(s), ...s.future],
      selection: [],
      editingId: null,
    };
  }),

  discardLast: () => set((s) => {
    const prev = s.past[s.past.length - 1];
    if (!prev) return {};
    return { ...prev, past: s.past.slice(0, -1), selection: [], editingId: null };
  }),

  redo: () => set((s) => {
    const next = s.future[0];
    if (!next) return {};
    return {
      ...next,
      past: [...s.past, snapshot(s)],
      future: s.future.slice(1),
      selection: [],
      editingId: null,
    };
  }),

  markSaved: (rev) => set({ savedRev: rev }),
  select: (ids) => set({ selection: ids }),
  setEditing: (id) => set({ editingId: id }),
}));

export const isDirty = () => {
  const s = useDoc.getState();
  return !!s.doc && s.rev !== s.savedRev;
};

/* ---- Operazioni sulle annotazioni ---- */

export function findAnnotations(ids: string[]): Annotation[] {
  const { annotations } = useDoc.getState();
  const wanted = new Set(ids);
  const out: Annotation[] = [];
  for (const list of Object.values(annotations)) for (const a of list) if (wanted.has(a.id)) out.push(a);
  return out;
}

export const findAnnotation = (id: string) => findAnnotations([id])[0];

export function withReplaced(map: AnnotationMap, changed: Annotation[]): AnnotationMap {
  const byId = new Map(changed.map((a) => [a.id, a]));
  const pages = new Set(changed.map((a) => a.page));
  const next = { ...map };
  for (const p of pages) next[p] = (next[p] ?? []).map((a) => byId.get(a.id) ?? a);
  return next;
}

export function addAnnotations(items: Annotation[], select = true) {
  const { commit } = useDoc.getState();
  commit((c) => {
    const annotations = { ...c.annotations };
    for (const a of items) annotations[a.page] = [...(annotations[a.page] ?? []), a];
    return { annotations };
  });
  if (select) useDoc.getState().select(items.map((a) => a.id));
}

export function updateAnnotations(changed: Annotation[]) {
  useDoc.getState().commit((c) => ({ annotations: withReplaced(c.annotations, changed) }));
}

export function removeAnnotations(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  const { commit, select, selection } = useDoc.getState();
  commit((c) => {
    const annotations: AnnotationMap = {};
    for (const [p, list] of Object.entries(c.annotations)) annotations[+p] = list.filter((a) => !gone.has(a.id));
    return { annotations };
  });
  select(selection.filter((id) => !gone.has(id)));
}

export function reorder(ids: string[], direction: 'front' | 'back') {
  const wanted = new Set(ids);
  useDoc.getState().commit((c) => {
    const annotations = { ...c.annotations };
    for (const p of new Set(findAnnotations(ids).map((a) => a.page))) {
      const moved = annotations[p].filter((a) => wanted.has(a.id));
      const rest = annotations[p].filter((a) => !wanted.has(a.id));
      annotations[p] = direction === 'front' ? [...rest, ...moved] : [...moved, ...rest];
    }
    return { annotations };
  });
}
