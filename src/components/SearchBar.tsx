import { ChevronDown, ChevronUp, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useSearch } from '../store/searchStore';
import { useUi } from '../store/uiStore';
import { IconButton } from './ui';

export function SearchBar() {
  const set = useUi((s) => s.set);
  const { query, matches, active, searching, run, step, clear } = useSearch();
  const input = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const close = () => {
    clear();
    set({ searchOpen: false });
  };

  return (
    <div className="search-bar glass" role="search">
      <Search size={15} className="muted" />
      <input
        ref={input} data-search-input placeholder="Cerca nel documento" defaultValue={query}
        aria-label="Cerca nel documento"
        onChange={(e) => {
          const value = e.target.value;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => run(value), 180);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') step(e.shiftKey ? -1 : 1);
          if (e.key === 'Escape') { e.stopPropagation(); close(); }
        }}
      />
      <span className="search-count" data-testid="search-count">
        {query.trim() ? (matches.length ? `${active + 1} di ${matches.length}${searching ? '+' : ''}` : searching ? '…' : 'Nessun risultato') : ''}
      </span>
      <IconButton icon={ChevronUp} label="Precedente" size={15} onClick={() => step(-1)} />
      <IconButton icon={ChevronDown} label="Successivo" size={15} onClick={() => step(1)} />
      <IconButton icon={X} label="Chiudi" shortcut="Esc" size={15} onClick={close} />
    </div>
  );
}
