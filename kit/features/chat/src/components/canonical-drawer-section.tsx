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
    <section className="space-y-3 rounded-[24px] border border-white/80 bg-white/88 p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
          {title}
        </h3>
        {hint ? (
          <p className="mt-1 text-sm text-gray-600">{hint}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}
