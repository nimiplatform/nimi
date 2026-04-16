import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@nimiplatform/nimi-kit/ui';
const RIGHT_COLUMN_CARD_BASE_CLASS = [
  'min-h-0 overflow-hidden rounded-[16px] shadow-[0_14px_34px_rgba(15,23,42,0.05)]',
  'bg-[linear-gradient(180deg,rgba(255,255,255,0.86),rgba(247,250,249,0.78))] backdrop-blur-sm',
].join(' ');

export function ChatRightColumn(props: {
  children: ReactNode;
  className?: string;
} & HTMLAttributes<HTMLElement>) {
  const { children, className, ...domProps } = props;
  return (
    <aside
      {...domProps}
      className={cn(
        'ml-2 flex min-h-0 w-[360px] shrink-0 flex-col gap-3',
        className,
      )}
      data-chat-right-column="true"
    >
      {children}
    </aside>
  );
}

export function ChatRightColumnCard(props: {
  children: ReactNode;
  className?: string;
  cardKey: 'primary' | 'status' | 'settings';
}) {
  return (
    <section
      className={cn(RIGHT_COLUMN_CARD_BASE_CLASS, props.className)}
      data-chat-right-card={props.cardKey}
    >
      {props.children}
    </section>
  );
}

export function ChatRightColumnCardTitle(props: {
  title: ReactNode;
  subtitle?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', props.className)}>
      <h2 className="text-sm font-semibold text-slate-900">{props.title}</h2>
      {props.subtitle ? (
        <p className="text-xs leading-5 text-slate-500">{props.subtitle}</p>
      ) : null}
    </div>
  );
}
