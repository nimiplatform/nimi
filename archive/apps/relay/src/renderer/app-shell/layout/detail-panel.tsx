// Detail panel — right-side settings panel
// Slides in from the right with subtle shadow separation

import { X } from 'lucide-react';

interface DetailPanelProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}

export function DetailPanel({ open, onClose, title, children }: DetailPanelProps) {
  if (!open) return null;

  return (
    <aside className="flex min-h-0 w-[360px] flex-shrink-0 flex-col overflow-hidden bg-[color:var(--nimi-surface-panel)] shadow-[-4px_0_16px_rgba(0,0,0,0.06)]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between px-5 py-3.5">
        {title && (
          <span className="text-[14px] font-semibold text-[color:var(--nimi-text-primary)]">{title}</span>
        )}
        <button
          onClick={onClose}
          className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-[color:var(--nimi-text-secondary)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-text-primary)_6%,transparent)] hover:text-[color:var(--nimi-text-primary)]"
        >
          <X size={15} />
        </button>
      </div>
      {/* Content */}
      <div className="flex min-h-0 flex-1 flex-col">
        {children}
      </div>
    </aside>
  );
}
