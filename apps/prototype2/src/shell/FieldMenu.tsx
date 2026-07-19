import { useEffect } from 'react';

export interface FieldMenuState {
  x: number;
  y: number;
}

interface FieldMenuProps {
  menu: FieldMenuState | null;
  onClose: () => void;
  items: Array<{ id: string; label: string; hint?: string; run: () => void }>;
}

/** Right-click spatial menu on the empty field (Aurora idiom). */
export function FieldMenu({ menu, onClose, items }: FieldMenuProps) {
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = () => onClose();
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onDown);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - items.length * 44 - 24);

  return (
    <div
      className="field-menu pane nimi-material-glass-chrome bg-[var(--nimi-material-glass-chrome-bg)] border border-[var(--nimi-material-glass-chrome-border)] backdrop-blur-[var(--nimi-backdrop-blur-chrome)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-chrome"
      data-nimi-tone="overlay"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
    >
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className="field-menu-row"
          role="menuitem"
          onClick={() => {
            item.run();
            onClose();
          }}
        >
          <span>{item.label}</span>
          {item.hint ? <span className="t-mono">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
