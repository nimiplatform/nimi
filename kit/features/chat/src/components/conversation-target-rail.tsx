import type { ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';

export type ConversationTargetRailProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

export function ConversationTargetRail({
  title,
  description,
  actions,
  children,
  className,
}: ConversationTargetRailProps) {
  return (
    <aside
      className={cn(
        'flex w-full min-w-0 flex-col',
        'border-l border-slate-200/50',
        'bg-white/60 backdrop-blur-lg',
        className,
      )}
    >
      {title || description || actions ? (
        <div className="space-y-3 px-5 pt-5 pb-4">
          {title ? (
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-400">
              {title}
            </h2>
          ) : null}
          {description ? <div className="text-sm text-slate-600">{description}</div> : null}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 px-5 pb-5">{children}</div>
    </aside>
  );
}
