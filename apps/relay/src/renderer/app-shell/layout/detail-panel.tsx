// Detail panel — right-side panel for settings, Live2D buddy, etc.
// Per design.md §4: 320px, bg-surface, slide-in animation

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
    <aside className="w-80 flex-shrink-0 bg-bg-surface border-l border-border-subtle overflow-y-auto animate-slide-in">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-subtle">
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
      <div className="p-4">
        {children}
      </div>
    </aside>
  );
}
