import { useEffect } from 'react';
import { listenForLaunchFiles, startDraftAutosave } from './actions/fileActions';
import { Dock } from './components/Dock';
import { Home } from './components/Home';
import { PropertiesPanel } from './components/PropertiesPanel';
import { SearchBar } from './components/SearchBar';
import { Sidebar } from './components/Sidebar';
import { StatusCorner, TopBar } from './components/TopBar';
import { Viewer } from './components/Viewer';
import { useDoc } from './store/docStore';
import { useUi } from './store/uiStore';
import { installGlobalShortcuts } from './tools/keyboard';

function useTheme() {
  const theme = useUi((s) => s.theme);
  useEffect(() => {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);
}

function Overlays() {
  const toasts = useUi((s) => s.toasts);
  const dialog = useUi((s) => s.dialog);
  const busy = useUi((s) => s.busy);
  const closeDialog = useUi((s) => s.closeDialog);
  return (
    <>
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => <div key={t.id} className={`toast glass ${t.tone}`} data-toast={t.tone}>{t.message}</div>)}
      </div>
      {busy && <div className="busy glass" role="status"><span className="spinner" />{busy}</div>}
      {dialog && (
        <div className="dialog-backdrop">
          <div className="dialog glass" role="alertdialog" aria-modal="true" aria-label={dialog.title}>
            <h2>{dialog.title}</h2>
            <p>{dialog.message}</p>
            <div className="dialog-actions">
              {dialog.actions.map((a) => (
                <button
                  key={a.id} type="button" autoFocus={a.tone === 'primary'} data-dialog-action={a.id}
                  className={`dialog-btn ${a.tone ?? ''}`} onClick={() => closeDialog(a.id)}
                >
                  {a.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default function App() {
  const hasDoc = useDoc((s) => !!s.doc);
  const openId = useDoc((s) => s.doc?.openId);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const searchOpen = useUi((s) => s.searchOpen);
  useTheme();

  useEffect(() => {
    listenForLaunchFiles();
    const stopDrafts = startDraftAutosave();
    const stopKeys = installGlobalShortcuts();
    return () => {
      stopDrafts();
      stopKeys();
    };
  }, []);

  return (
    <>
      {hasDoc ? (
        <div className={'workspace' + (sidebarOpen ? ' sidebar-open' : '')}>
          <Viewer key={openId} />
          {sidebarOpen && <Sidebar key={`s-${openId}`} />}
          <TopBar />
          {searchOpen && <SearchBar />}
          <div className="bottom-stack">
            <PropertiesPanel />
            <Dock />
          </div>
          <StatusCorner />
        </div>
      ) : <Home />}
      <Overlays />
    </>
  );
}
