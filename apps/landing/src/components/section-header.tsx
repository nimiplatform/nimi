import type { ReactNode } from 'react';

export type SectionHeaderProps = {
  title: string;
  subtitle: string;
  kicker?: string;
  align?: 'left' | 'center';
  actions?: ReactNode;
};

export function SectionHeader(props: SectionHeaderProps) {
  const alignClass = props.align === 'center' ? 'text-center' : 'text-left';
  const withActions = props.actions ? 'items-start gap-4 md:flex md:items-end md:justify-between' : '';

  return (
    <div className={`reveal ${withActions}`.trim()}>
      <div className={alignClass}>
        {props.kicker ? (
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-mint-300/90">{props.kicker}</p>
        ) : null}
        <h2 className="mt-3 text-balance text-3xl font-semibold tracking-tight text-white md:text-4xl">{props.title}</h2>
        <p className="mt-4 max-w-3xl text-base leading-7 text-slate-200/90">{props.subtitle}</p>
      </div>
      {props.actions ? <div className="mt-4 md:mt-0">{props.actions}</div> : null}
    </div>
  );
}
