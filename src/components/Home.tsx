import { FileText, FolderOpen, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { openDropped, openRecent, openWithPicker } from '../actions/fileActions';
import { listDraftKeys, listRecents, removeRecent, type RecentFile } from '../storage/db';
import { ThemeSwitch } from './TopBar';
import { Kbd } from './ui';

function timeAgo(t: number) {
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days === 0) return 'oggi';
  if (days === 1) return 'ieri';
  if (days < 30) return `${days} giorni fa`;
  return new Date(t).toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function Home() {
  const [recents, setRecents] = useState<RecentFile[]>([]);
  const [drafts, setDrafts] = useState<Set<string>>(new Set());
  const [over, setOver] = useState(false);

  useEffect(() => {
    void listRecents().then(setRecents).catch(() => undefined);
    void listDraftKeys().then(setDrafts).catch(() => undefined);
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setOver(false);
    void openDropped(e);
  };

  return (
    <main
      className={'home' + (over ? ' over' : '')}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={onDrop}
    >
      <div className="home-orbs" aria-hidden><i /><i /><i /></div>
      <div className="home-theme"><ThemeSwitch /></div>
      <section className="home-card glass">
        <img src={`${import.meta.env.BASE_URL}icons/icon.svg`} alt="" className="home-logo" width={64} height={64} />
        <h1>Vetro PDF</h1>
        <p className="home-sub">Scrivi, disegna e incolla immagini sui tuoi PDF. Tutto resta sul tuo computer.</p>
        <button type="button" className="drop-zone" onClick={() => void openWithPicker()} data-action="open">
          <FolderOpen size={26} strokeWidth={1.6} />
          <strong>Apri un PDF</strong>
          <span>oppure trascinalo qui <Kbd>Ctrl+O</Kbd></span>
        </button>
      </section>

      {recents.length > 0 && (
        <section className="recents" aria-label="File recenti">
          <h2>Recenti</h2>
          <div className="recent-grid">
            {recents.map((r) => (
              <div key={r.docKey} className="recent glass">
                <button type="button" className="recent-open" onClick={() => void openRecent(r)} data-recent={r.name}>
                  <span className="recent-thumb">
                    {r.thumbnail ? <img src={r.thumbnail} alt="" /> : <FileText size={26} strokeWidth={1.4} />}
                  </span>
                  <span className="recent-name" title={r.name}>{r.name}</span>
                  <span className="recent-meta">
                    {r.pages} {r.pages === 1 ? 'pagina' : 'pagine'} · {timeAgo(r.openedAt)}
                    {drafts.has(r.docKey) && <em> · bozza</em>}
                  </span>
                </button>
                <button
                  type="button" className="recent-remove" aria-label={`Rimuovi ${r.name} dai recenti`}
                  onClick={() => {
                    void removeRecent(r.docKey);
                    setRecents((list) => list.filter((x) => x.docKey !== r.docKey));
                  }}
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
