import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { ReactNode } from 'react';

interface KPI {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  iconTone: string;
  iconBg: string;
  icon: ReactNode;
}

function Ic({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

interface DentalKPIStripProps {
  eruptedCount: number;
  eruptedTotal: number;
  permanentCount: number;
  cariesCount: number;
  recordCount: number;
}

export function DentalKPIStrip({ eruptedCount, eruptedTotal, permanentCount, cariesCount, recordCount }: DentalKPIStripProps) {
  const kpis: KPI[] = [
    {
      key: 'erupted',
      label: '已萌出',
      value: eruptedCount,
      unit: `/ ${eruptedTotal}`,
      iconTone: 'text-[var(--nimi-action-primary-bg)]',
      iconBg: 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)]',
      icon: (
        <Ic>
          <path d="M7 20h10M12 20V10" />
          <path d="M12 10c0-3 2-5 5-5 0 3-2 5-5 5zM12 10c0-3-2-5-5-5 0 3 2 5 5 5z" />
        </Ic>
      ),
    },
    {
      key: 'permanent',
      label: '恒牙',
      value: permanentCount,
      unit: '颗',
      iconTone: 'text-[var(--nimi-status-info)]',
      iconBg: 'bg-[color-mix(in_srgb,var(--nimi-status-info)_14%,transparent)]',
      icon: (
        <Ic>
          <path d="M12 3c-3 0-5 1.5-6 1.5S4 3.8 3.5 5.5C3 7.2 3.7 10 4.5 12c.4 1 .5 2 .7 3.5.2 1.4.4 3 .9 4.2.4 1 1 1.3 1.5 1.3.8 0 1-1 1.2-2.2.2-1.2.4-2.8.9-3.2.3-.3 2.3-.3 2.6 0 .5.4.7 2 .9 3.2.2 1.2.4 2.2 1.2 2.2.5 0 1.1-.3 1.5-1.3.5-1.2.7-2.8.9-4.2.2-1.5.3-2.5.7-3.5.8-2 1.5-4.8 1-6.5-.5-1.7-1.5-1-2.5-1S15 3 12 3z" />
        </Ic>
      ),
    },
    {
      key: 'caries',
      label: '龋齿',
      value: cariesCount,
      unit: '颗',
      iconTone: 'text-[var(--nimi-status-danger)]',
      iconBg: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_12%,transparent)]',
      icon: (
        <Ic>
          <circle cx="12" cy="12" r="10" />
          <path d="M12 8v4M12 16h.01" />
        </Ic>
      ),
    },
    {
      key: 'records',
      label: '记录',
      value: recordCount,
      unit: '条',
      iconTone: 'text-[var(--nimi-text-muted)]',
      iconBg: 'bg-[var(--nimi-surface-active)]',
      icon: (
        <Ic>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </Ic>
      ),
    },
  ];

  return (
    <div className="mb-5 grid grid-cols-4 gap-3">
      {kpis.map((k) => (
        <Surface
          key={k.key}
          tone="card"
          material="solid"
          elevation="raised"
          padding="md"
          className="flex items-center gap-3 rounded-2xl"
        >
          <div className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${k.iconBg} ${k.iconTone}`}>
            {k.icon}
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="text-[11px] tracking-[0.02em] text-[var(--nimi-text-muted)]">{k.label}</div>
            <div className="flex items-baseline gap-1">
              <div className="font-sans text-[22px] font-bold leading-[1.1] tracking-normal text-[var(--nimi-text-primary)] tabular-nums">
                {k.value}
              </div>
              <div className="font-mono text-[11px] text-[var(--nimi-text-muted)]">{k.unit}</div>
            </div>
          </div>
        </Surface>
      ))}
    </div>
  );
}
