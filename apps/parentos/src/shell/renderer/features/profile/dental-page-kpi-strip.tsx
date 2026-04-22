import type { ReactNode } from 'react';
import { S } from '../../app-shell/page-style.js';

const MONO = '"JetBrains Mono", "SF Mono", ui-monospace, monospace';

interface KPI {
  key: string;
  label: string;
  value: number | string;
  unit: string;
  tone: string;
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
      tone: '#4ECCA3',
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
      tone: '#6366f1',
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
      tone: '#ec4899',
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
      tone: '#64748b',
      icon: (
        <Ic>
          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
          <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
        </Ic>
      ),
    },
  ];

  return (
    <div className="mb-5" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
      {kpis.map((k) => (
        <div
          key={k.key}
          style={{
            background: S.card,
            padding: '16px 18px',
            borderRadius: 20,
            boxShadow: '0 1px 2px rgba(15,23,42,0.03), 0 6px 18px rgba(15,23,42,0.04)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: 10,
              display: 'grid',
              placeItems: 'center',
              background: `${k.tone}22`,
              color: k.tone,
              flexShrink: 0,
            }}
          >
            {k.icon}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ fontSize: 11, color: '#64748b', letterSpacing: '0.02em' }}>{k.label}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: S.text, letterSpacing: '-0.02em' }}>{k.value}</div>
              <div style={{ fontSize: 11, color: '#64748b', fontFamily: MONO }}>{k.unit}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
