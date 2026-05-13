import { S } from '../../app-shell/page-style.js';

export function DentalHistoryActions({
  show,
  onScan,
  onAdd,
  scanTitle,
  scanLabel,
  addLabel,
}: {
  show: boolean;
  onScan: () => void;
  onAdd: () => void;
  scanTitle: string;
  scanLabel: string;
  addLabel: string;
}) {
  if (!show) return null;
  return (
    <div className="flex items-center justify-end gap-2 mb-3">
      <button
        onClick={onScan}
        title={scanTitle}
        className="flex items-center gap-1.5 text-[14px] font-medium hover:opacity-90 transition-opacity"
        style={{
          background: '#ffffff',
          color: S.text,
          border: '1px solid rgba(226,232,240,0.9)',
          boxShadow: '0 1px 2px rgba(15,23,42,0.04)',
          padding: '10px 16px',
          borderRadius: 12,
        }}
      >
        <span style={{ color: '#f59e0b', display: 'inline-flex' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10" />
          </svg>
        </span>
        {scanLabel}
      </button>
      <button
        onClick={onAdd}
        className="flex items-center gap-1.5 text-[14px] font-semibold text-white hover:opacity-90 transition-opacity"
        style={{
          background: S.accent,
          padding: '10px 16px',
          borderRadius: 12,
          boxShadow: '0 4px 12px rgba(78,204,163,0.35)',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        {addLabel}
      </button>
    </div>
  );
}
