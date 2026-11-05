import { create } from 'zustand';
import { viewerApi } from '../actions/viewerApi';
import { pageText, type PageText, session } from '../pdf/session';

export interface SearchRect {
  match: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SearchState {
  query: string;
  searching: boolean;
  scanned: number;
  matches: SearchRect[];
  byPage: Record<number, SearchRect[]>;
  active: number;
  run(query: string): void;
  step(delta: number): void;
  clear(): void;
}

const normalize = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Rettangolo di una corrispondenza; una parola spezzata su più item ne usa solo il primo. */
function rectFor(content: PageText, start: number, length: number): Omit<SearchRect, 'match' | 'page'> | null {
  const item = content.items.findLast((it) => it.start <= start);
  if (!item || !item.str.length) return null;
  const from = (start - item.start) / item.str.length;
  const to = Math.min(1, (start - item.start + length) / item.str.length);
  const ax = item.x0 + (item.x1 - item.x0) * from;
  const ay = item.y0 + (item.y1 - item.y0) * from;
  const bx = item.x0 + (item.x1 - item.x0) * to;
  const by = item.y0 + (item.y1 - item.y0) * to;
  const x = Math.min(ax, bx);
  const w = Math.abs(bx - ax);
  const vertical = Math.abs(by - ay) > Math.abs(bx - ax);
  if (vertical) {
    return { x: Math.min(ax, bx) - item.height * 0.8, y: Math.min(ay, by), w: item.height * 1.05, h: Math.abs(by - ay) };
  }
  return { x, y: Math.min(ay, by) - item.height * 0.82, w: Math.max(w, 2), h: item.height * 1.08 };
}

let token = 0;

export const useSearch = create<SearchState>((set, get) => ({
  query: '',
  searching: false,
  scanned: 0,
  matches: [],
  byPage: {},
  active: -1,

  run: (query) => {
    const run = ++token;
    set({ query, matches: [], byPage: {}, active: -1, scanned: 0, searching: !!query.trim() });
    const needle = normalize(query.trim());
    if (!needle || !session.pdf) return;
    void (async () => {
      const total = session.pdf!.numPages;
      for (let page = 0; page < total; page++) {
        if (run !== token || !session.pdf) return;
        const content = await pageText(page);
        if (run !== token) return;
        // Il testo normalizzato ha la stessa lunghezza solo per caratteri semplici: si mappa carattere per carattere.
        const hay: string[] = [];
        const map: number[] = [];
        [...content.text].forEach((ch, i) => {
          for (const n of normalize(ch)) {
            hay.push(n);
            map.push(i);
          }
        });
        const text = hay.join('');
        const found: SearchRect[] = [];
        let base = get().matches.length;
        for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
          const start = map[at];
          const rect = rectFor(content, start, map[at + needle.length - 1] - start + 1);
          if (rect) found.push({ ...rect, page, match: base++ });
        }
        set((s) => {
          const matches = found.length ? [...s.matches, ...found] : s.matches;
          const byPage = found.length ? { ...s.byPage, [page]: found } : s.byPage;
          return { matches, byPage, scanned: page + 1, searching: page + 1 < total };
        });
        if (found.length && get().active === -1) get().step(1);
        if (page % 8 === 7) await new Promise((r) => setTimeout(r));
      }
    })();
  },

  step: (delta) => {
    const { matches, active } = get();
    if (!matches.length) return;
    const next = active === -1 ? 0 : (active + delta + matches.length) % matches.length;
    set({ active: next });
    viewerApi.scrollToPage(matches[next].page, matches[next].y);
  },

  clear: () => {
    token++;
    set({ query: '', matches: [], byPage: {}, active: -1, scanned: 0, searching: false });
  },
}));
