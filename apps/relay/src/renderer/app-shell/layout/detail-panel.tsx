// Detail panel — right-side panel for settings, Live2D buddy, etc.
// Per design.md §4: fixed-width side panel shell

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
    <aside className="flex min-h-0 w-80 flex-shrink-0 flex-col border-l border-border-subtle bg-bg-surface">
      <div className="flex shrink-0 items-center justify-between border-b border-border-subtle px-4 py-3">
        {title && (
          <span className="text-[13px] font-medium text-text-primary">{title}</span>
        )}
        <button
          onClick={onClose}
          className="p-1 rounded-lg text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition-colors duration-150 ml-auto"
        >
          <X size={16} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {children}
      </div>
    </aside>
  );
}
