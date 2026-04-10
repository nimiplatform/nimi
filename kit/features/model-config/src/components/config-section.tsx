import type { ReactNode } from 'react';

export function ConfigSection(props: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
        {props.title}
      </h3>
      {props.children}
      <div className="border-b border-slate-100" />
    </div>
  );
}

export function ConfigAccordionSection(props: {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div>
      <button
        type="button"
        onClick={props.onToggle}
        className="flex w-full items-center justify-between py-2.5"
      >
        <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
          {props.title}
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={[
            'shrink-0 text-slate-300 transition-transform duration-200',
            props.expanded ? 'rotate-180' : '',
          ].join(' ')}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {props.expanded ? (
        <div className="pb-3">
          {props.children}
        </div>
      ) : null}
      <div className="border-b border-slate-100" />
    </div>
  );
}

export function DisabledConfigNote(props: { label: string }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50/60 px-3 py-4 text-center text-[11px] text-gray-500">
      {props.label}
    </div>
  );
}
