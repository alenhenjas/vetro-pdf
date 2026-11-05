import {
  ChevronLeft, Download, FileUp, History, Maximize2, Minus, Monitor, Moon, MoreHorizontal, PanelLeft, Plus, Save,
  Search, StretchHorizontal, Sun,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { closeDocument, openWithPicker, restoreOriginal, saveAs, saveDocument } from '../actions/fileActions';
import { viewerApi } from '../actions/viewerApi';
import { useDoc } from '../store/docStore';
import { useUi, type ThemeMode } from '../store/uiStore';
import { IconButton, Kbd, Slider, usePopover } from './ui';

const THEMES: { id: ThemeMode; icon: typeof Sun; label: string }[] = [
  { id: 'light', icon: Sun, label: 'Chiaro' },
  { id: 'auto', icon: Monitor, label: 'Automatico' },
  { id: 'dark', icon: Moon, label: 'Scuro' },
];

export function ThemeSwitch() {
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  return (
    <div className="segmented" role="radiogroup" aria-label="Tema">
      {THEMES.map((t) => (
        <button
          key={t.id} type="button" role="radio" aria-checked={theme === t.id} aria-label={t.label} title={t.label}
          className={theme === t.id ? 'active' : ''} data-theme-option={t.id} onClick={() => setTheme(t.id)}
        >
          <t.icon size={15} />
        </button>
      ))}
    </div>
  );
}

function MarginControl() {
  const page = useUi((s) => s.currentPage);
  const current = useDoc((s) => s.margins[page] ?? 0);
  const { open, setOpen, ref } = usePopover();
  const [allPages, setAllPages] = useState(false);

  const apply = (value: number, all: boolean) => {
    const doc = useDoc.getState();
    doc.beginTx();
    doc.patch((c) => {
      if (!all) return { margins: { ...c.margins, [page]: value } };
      const margins: Record<number, number> = {};
      doc.doc!.pageSizes.forEach((_, i) => { margins[i] = value; });
      return { margins };
    });
  };

  return (
    <div className="popover-host" ref={ref}>
      <IconButton
        icon={StretchHorizontal} label="Allarga margine" active={current > 0 || open}
        data-action="margin" onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="popover glass margin-pop">
          <h3>Allarga margine</h3>
          <p>Aggiunge spazio bianco a destra, così le immagini non coprono il contenuto.</p>
          <Slider
            label="Spazio" value={current} min={0} max={500} step={10} testId="margin-slider"
            onChange={(v) => apply(v, allPages)} onCommit={() => useDoc.getState().endTx()}
            format={(v) => `${v} pt`}
          />
          <label className="check">
            <input
              type="checkbox" checked={allPages}
              onChange={(e) => {
                setAllPages(e.target.checked);
                if (e.target.checked) { apply(current, true); useDoc.getState().endTx(); }
              }}
            />
            Applica a tutte le pagine
          </label>
        </div>
      )}
    </div>
  );
}

function MoreMenu() {
  const { open, setOpen, ref } = usePopover();
  const run = (fn: () => void) => () => { setOpen(false); fn(); };
  return (
    <div className="popover-host" ref={ref}>
      <IconButton icon={MoreHorizontal} label="Altro" data-action="more" onClick={() => setOpen(!open)} active={open} />
      {open && (
        <div className="popover glass menu" role="menu">
          <button role="menuitem" onClick={run(() => void openWithPicker())}>
            <FileUp size={16} /> Apri PDF… <Kbd>Ctrl+O</Kbd>
          </button>
          <button role="menuitem" data-action="save-as" onClick={run(() => void saveAs())}>
            <Download size={16} /> Salva con nome… <Kbd>Ctrl+Maiusc+S</Kbd>
          </button>
          <button role="menuitem" data-action="restore" onClick={run(() => void restoreOriginal())}>
            <History size={16} /> Ripristina originale
          </button>
          <div className="menu-sep" />
          <div className="menu-row"><span>Tema</span><ThemeSwitch /></div>
        </div>
      )}
    </div>
  );
}

function ZoomControl() {
  const scale = useUi((s) => s.scale);
  return (
    <div className="capsule glass zoom">
      <IconButton icon={Minus} label="Riduci" shortcut="Ctrl −" tipSide="top" size={15} onClick={() => viewerApi.zoomBy(1 / 1.2)} />
      <button type="button" className="zoom-value" data-testid="zoom-value" onClick={() => viewerApi.zoomTo(1)} title="Zoom 100%">
        {Math.round(scale * 100)}%
      </button>
      <IconButton icon={Plus} label="Ingrandisci" shortcut="Ctrl +" tipSide="top" size={15} onClick={() => viewerApi.zoomBy(1.2)} />
      <IconButton icon={Maximize2} label="Adatta larghezza" shortcut="Ctrl+0" tipSide="top" size={15} onClick={() => viewerApi.fitWidth()} data-action="fit-width" />
    </div>
  );
}

function PageIndicator() {
  const page = useUi((s) => s.currentPage);
  const total = useDoc((s) => s.doc!.pageSizes.length);
  const [draft, setDraft] = useState<string | null>(null);
  useEffect(() => setDraft(null), [page]);
  return (
    <div className="capsule glass page-indicator">
      <input
        aria-label="Pagina corrente" data-testid="page-input" inputMode="numeric"
        value={draft ?? page + 1}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onFocus={(e) => e.target.select()}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            const n = Math.min(total, Math.max(1, Number(draft) || page + 1));
            viewerApi.scrollToPage(n - 1);
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <span>di {total}</span>
    </div>
  );
}

export function StatusCorner() {
  return (
    <div className="status-corner">
      <PageIndicator />
      <ZoomControl />
    </div>
  );
}

export function TopBar() {
  const name = useDoc((s) => s.doc!.name);
  const dirty = useDoc((s) => s.rev !== s.savedRev);
  const saving = useUi((s) => s.saving);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const set = useUi((s) => s.set);

  return (
    <header className="topbar">
      <div className="capsule glass">
        <IconButton icon={ChevronLeft} label="Chiudi documento" data-action="close" onClick={() => void closeDocument()} />
        <IconButton
          icon={PanelLeft} label="Miniature" active={sidebarOpen} data-action="sidebar"
          onClick={() => set({ sidebarOpen: !sidebarOpen })}
        />
        <div className="doc-title" title={name}>
          <span className={'dirty-dot' + (dirty ? ' on' : '')} data-testid="dirty" data-dirty={dirty} title={dirty ? 'Modifiche non salvate' : 'Tutto salvato'} />
          <span className="doc-name">{name}</span>
        </div>
      </div>
      <div className="capsule glass">
        <MarginControl />
        <IconButton icon={Search} label="Cerca" shortcut="Ctrl+F" onClick={() => set({ searchOpen: true })} data-action="search" />
        <MoreMenu />
        <button type="button" className="save-btn" onClick={() => void saveDocument()} disabled={saving} data-action="save">
          <Save size={15} strokeWidth={2.1} />
          {saving ? 'Salvataggio…' : dirty ? 'Salva' : 'Salvato'}
        </button>
      </div>
    </header>
  );
}
