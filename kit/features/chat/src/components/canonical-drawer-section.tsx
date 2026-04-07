import type { ReactNode } from 'react';

export type CanonicalDrawerSectionProps = {
  title: string;
  hint?: string | null;
  children: ReactNode;
};

export function CanonicalDrawerSection({
  title,
  hint,
  children,
}: CanonicalDrawerSectionProps) {
  return (
    <section className="space-y-4 rounded-[24px] border border-slate-100 bg-white/92 p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
      <div className="group relative inline-block">
        <h3 className="cursor-default text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
          {title}
        </h3>
        {hint ? (
          <div className="pointer-events-none absolute left-0 top-full z-30 mt-1.5 hidden w-56 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[12px] leading-relaxed text-slate-500 shadow-lg group-hover:block">
            {hint}
          </div>
        ) : null}
      </div>
      {children}
    </section>
  );
}
