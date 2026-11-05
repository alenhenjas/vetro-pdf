import { create } from 'zustand';
import type { Annotation, TextStyle, Tool } from '../model/types';

export type ThemeMode = 'auto' | 'light' | 'dark';

export const QUICK_COLORS = ['#1c1c1e', '#ffffff', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#0a84ff', '#af52de'];
export const HIGHLIGHT_COLORS = ['#ffe066', '#b8f28f', '#8fe3ff', '#ffb3d9', '#ffc078', '#d0bfff', '#ff8787', '#c8d1dc'];

export interface ToolPrefs {
  penColor: string;
  penWidth: number;
  highlighterColor: string;
  highlighterWidth: number;
  shapeColor: string;
  shapeWidth: number;
  text: TextStyle;
  recentColors: string[];
}

const DEFAULT_PREFS: ToolPrefs = {
  penColor: '#0a84ff',
  penWidth: 2.5,
  highlighterColor: '#ffe066',
  highlighterWidth: 14,
  shapeColor: '#ff3b30',
  shapeWidth: 2,
  text: {
    font: 'Inter', size: 14, color: '#1c1c1e', bold: false, italic: false, underline: false,
    align: 'left', lineHeight: 1.3, background: '#ffffff', backgroundOpacity: 0,
  },
  recentColors: [],
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
  } catch { /* preferenze non essenziali */ }
}
function readTheme(): ThemeMode {
  try {
    return (localStorage.getItem('vetro.theme') as ThemeMode) || 'auto';
  } catch {
    return 'auto';
  }
}

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export interface DialogAction {
  id: string;
  label: string;
  tone?: 'primary' | 'danger';
}
export interface DialogState {
  title: string;
  message: string;
  actions: DialogAction[];
  resolve: (id: string) => void;
}

interface UiState {
  tool: Tool;
  prefs: ToolPrefs;
  theme: ThemeMode;
  scale: number;
  currentPage: number;
  sidebarOpen: boolean;
  searchOpen: boolean;
  busy: string | null;
  saving: boolean;
  toasts: Toast[];
  dialog: DialogState | null;
  /** Ultima posizione del cursore su una pagina, per incollare accanto al puntatore. */
  pointer: { page: number; x: number; y: number } | null;
  live: Annotation | null;

  setTool(t: Tool): void;
  setPrefs(p: Partial<ToolPrefs>): void;
  setTextPrefs(p: Partial<TextStyle>): void;
  pushRecentColor(c: string): void;
  setTheme(t: ThemeMode): void;
  setScale(s: number): void;
  set(p: Partial<Pick<UiState, 'currentPage' | 'sidebarOpen' | 'searchOpen' | 'busy' | 'saving' | 'pointer' | 'live'>>): void;
  toast(message: string, tone?: Toast['tone']): void;
  ask(d: Omit<DialogState, 'resolve'>): Promise<string>;
  closeDialog(id: string): void;
}

let toastId = 1;

export const useUi = create<UiState>((set, get) => ({
  tool: 'select',
  prefs: read('vetro.prefs', DEFAULT_PREFS),
  theme: readTheme(),
  scale: 1,
  currentPage: 0,
  sidebarOpen: true,
  searchOpen: false,
  busy: null,
  saving: false,
  toasts: [],
  dialog: null,
  pointer: null,
  live: null,

  setTool: (tool) => set({ tool }),
  setPrefs: (p) => {
    const prefs = { ...get().prefs, ...p };
    write('vetro.prefs', prefs);
    set({ prefs });
  },
  setTextPrefs: (p) => get().setPrefs({ text: { ...get().prefs.text, ...p } }),
  pushRecentColor: (c) => {
    const lower = c.toLowerCase();
    if (QUICK_COLORS.includes(lower)) return;
    const recentColors = [lower, ...get().prefs.recentColors.filter((x) => x !== lower)].slice(0, 8);
    get().setPrefs({ recentColors });
  },
  setTheme: (theme) => {
    write('vetro.theme', theme);
    set({ theme });
  },
  setScale: (scale) => set({ scale: Math.min(6, Math.max(0.2, scale)) }),
  set: (p) => set(p),
  toast: (message, tone = 'info') => {
    const id = toastId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), tone === 'error' ? 7000 : 3200);
  },
  ask: (d) => new Promise((resolve) => set({ dialog: { ...d, resolve } })),
  closeDialog: (id) => {
    get().dialog?.resolve(id);
    set({ dialog: null });
  },
}));
