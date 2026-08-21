import type { ReactNode } from 'react';
import { Surface, cn } from '@nimiplatform/kit/ui';

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalTargetPane` or `CanonicalRightSidebar` instead.
 */
export type ConversationTargetRailProps = {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
};

/**
 * @deprecated Legacy conversation shell family. The canonical shell
 * (`CanonicalConversationShell`) is the UI truth source for shared chat
 * surfaces; use `CanonicalTargetPane` or `CanonicalRightSidebar` instead.
 */
export function ConversationTargetRail({
  title,
  description,
  actions,
  children,
  className,
}: ConversationTargetRailProps) {
  return (
    <Surface
      as="aside"
      material="glass-regular"
      tone="panel"
      elevation="base"
      padding="none"
      className={cn(
        'flex w-full min-w-0 flex-col',
        'rounded-none border-0 border-l shadow-none',
        className,
      )}
    >
      {title || description || actions ? (
        <div className="space-y-3 px-5 pt-5 pb-4">
          {title ? (
            <h2 className="text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.2em] text-[var(--nimi-text-muted)]">
              {title}
            </h2>
          ) : null}
          {description ? <div className="text-sm text-[var(--nimi-text-secondary)]">{description}</div> : null}
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 px-5 pb-5">{children}</div>
    </Surface>
  );
}
