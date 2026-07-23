import { useEffect } from 'react';
import { useUi } from './ui-context.tsx';

/** Right-side tinted result card (the appointment-card idiom): appears when
 * a shell action commits, auto-dismisses. */
export function ToastFloat() {
  const { toast, dismissToast } = useUi();

  useEffect(() => {
    if (!toast) return undefined;
    const t = window.setTimeout(dismissToast, 4200);
    return () => window.clearTimeout(t);
  }, [toast, dismissToast]);

  if (!toast) return null;
  return (
    <aside
      className="toast-float"
      data-nimi-material="glass-regular"
      data-nimi-tone="overlay"
      role="status"
    >
      <span className="toast-orb" />
      <div className="toast-body">
        <b>{toast.title}</b>
        <span className="t-caption">{toast.detail}</span>
      </div>
      <button type="button" className="toast-close" title="关闭" aria-label="关闭" onClick={dismissToast}>
        ✕
      </button>
    </aside>
  );
}
