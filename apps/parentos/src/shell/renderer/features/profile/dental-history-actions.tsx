import { Button } from '@nimiplatform/kit/ui';

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
      <Button
        onClick={onScan}
        title={scanTitle}
        tone="secondary"
        size="md"
      >
        <span className="inline-flex text-[var(--nimi-status-warning)]">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2M7 12h10" />
          </svg>
        </span>
        {scanLabel}
      </Button>
      <Button
        onClick={onAdd}
        tone="primary"
        size="md"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        {addLabel}
      </Button>
    </div>
  );
}
