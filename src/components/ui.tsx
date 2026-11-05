import type { LucideIcon } from 'lucide-react';
import { Check, Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { HIGHLIGHT_COLORS, QUICK_COLORS, useUi } from '../store/uiStore';

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>;
}

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  active?: boolean;
  tipSide?: 'top' | 'bottom';
  size?: number;
}

/** Pulsante a icona con tooltip e scorciatoia. */
export function IconButton({ icon: Icon, label, shortcut, active, tipSide = 'bottom', size = 18, className, ...rest }: IconButtonProps) {
  return (
    <span className={`tip-host tip-${tipSide}`}>
      <button
        type="button" aria-label={label} aria-pressed={active}
        className={`icon-btn${active ? ' active' : ''} ${className ?? ''}`} {...rest}
      >
        <Icon size={size} strokeWidth={1.9} />
      </button>
      <span className="tip" role="tooltip">{label}{shortcut && <Kbd>{shortcut}</Kbd>}</span>
    </span>
  );
}

export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);
  return { open, setOpen, ref };
}

export function ColorRow({ value, onChange, highlight, label = 'Colore' }: {
  value: string; onChange: (c: string) => void; highlight?: boolean; label?: string;
}) {
  const recents = useUi((s) => s.prefs.recentColors);
  const pushRecent = useUi((s) => s.pushRecentColor);
  const palette = highlight ? HIGHLIGHT_COLORS : QUICK_COLORS;
  const lower = value.toLowerCase();
  const extra = recents.filter((c) => !palette.includes(c)).slice(0, 4);

  const swatch = (c: string, key: string) => (
    <button
      key={key} type="button" className={'swatch' + (lower === c ? ' selected' : '')}
      style={{ background: c }} aria-label={`${label} ${c}`} onClick={() => onChange(c)}
    >
      {lower === c && <Check size={12} strokeWidth={3} color={isLight(c) ? '#1c1c1e' : '#fff'} />}
    </button>
  );

  return (
    <div className="color-row" role="group" aria-label={label}>
      {palette.map((c) => swatch(c, c))}
      {extra.length > 0 && <span className="divider-v" />}
      {extra.map((c) => swatch(c, 'r' + c))}
      <label className="swatch picker tip-host tip-top" aria-label="Scegli un colore">
        <Pipette size={13} />
        <input
          type="color" value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={(e) => pushRecent(e.target.value)}
        />
        <span className="tip" role="tooltip">Altro colore</span>
      </label>
    </div>
  );
}

function isLight(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return ((v >> 16 & 255) * 299 + (v >> 8 & 255) * 587 + (v & 255) * 114) / 1000 > 170;
}

export function Slider({ label, value, min, max, step, onChange, onCommit, format, testId }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; onCommit?: () => void; format?: (v: number) => string; testId?: string;
}) {
  return (
    <label className="slider">
      <span className="slider-label">{label}</span>
      <input
        type="range" min={min} max={max} step={step} value={value} data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onCommit} onKeyUp={onCommit}
        style={{ ['--fill' as string]: `${((value - min) / (max - min)) * 100}%` }}
      />
      <span className="slider-value">{format ? format(value) : value}</span>
    </label>
  );
}
