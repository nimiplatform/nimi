import { useEffect, useRef } from 'react';
import { useUi, type ChromeFieldMenu } from './ui-context.tsx';

export type { ChromeFieldMenu as FieldMenuState } from './ui-context.tsx';

interface FieldMenuProps {
  items: Array<{ id: string; label: string; hint?: string; run: () => void }>;
}

/** Right-click spatial menu on the empty field (Aurora idiom). Dismissal
 * rides the shell's admitted `pointer_dismissal` listener family. */
export function FieldMenu({ items }: FieldMenuProps) {
  const { fieldMenu: menu, setFieldMenu, subscribeFamily } = useUi();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menu) return undefined;
    const unsubscribe = subscribeFamily('pointer_dismissal', (event) => {
      const e = event as Partial<PointerEvent>;
      if (e.type !== 'pointerdown') return;
      const target = e.target instanceof Node ? e.target : null;
      if (target && menuRef.current?.contains(target)) return;
      setFieldMenu(null);
    });
    return () => unsubscribe?.();
  }, [menu, setFieldMenu, subscribeFamily]);

  if (!menu) return null;
  const x = Math.min(menu.x, window.innerWidth - 240);
  const y = Math.min(menu.y, window.innerHeight - items.length * 44 - 24);

  return (
    <div
      ref={menuRef}
      className="field-menu pane"
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
            setFieldMenu(null);
          }}
        >
          <span>{item.label}</span>
          {item.hint ? <span className="t-mono">{item.hint}</span> : null}
        </button>
      ))}
    </div>
  );
}
