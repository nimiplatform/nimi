import { useEffect } from 'react';
import { useSim } from '../engine/SimContext';

/** Right-side tinted result card (the appointment-card idiom): appears when
 * a flow commits, auto-dismisses. */
export function ToastFloat() {
  const { state, dismissToast } = useSim();
  const toast = state.toast;

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(dismissToast, 4200);
    return () => window.clearTimeout(t);
  }, [toast, dismissToast]);

  if (!toast) return null;
  return (
    <aside
      className="toast-float nimi-material-glass-regular bg-[var(--nimi-material-glass-regular-bg)] backdrop-blur-[var(--nimi-backdrop-blur-regular)] backdrop-saturate-[var(--nimi-backdrop-saturate)]"
      data-nimi-material="glass-regular"
      data-nimi-tone="overlay"
      role="status"
    >
      <span className="toast-orb" />
      <div className="toast-body">
        <b>{toast.title}</b>
        <span className="t-caption">{toast.detail}</span>
      </div>
      <button type="button" className="toast-close" title="关闭" onClick={dismissToast}>
        ✕
      </button>
    </aside>
  );
}
