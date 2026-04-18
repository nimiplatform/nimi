import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Surface } from '@nimiplatform/nimi-kit/ui';

export const textMain = '#1e293b';
export const textMuted = '#475569';
export const textSoft = '#94a3b8';

export function Cd({
  children,
  cls = '',
  style,
  material = 'glass-regular',
}: {
  children: ReactNode;
  cls?: string;
  style?: CSSProperties;
  material?: 'glass-regular' | 'glass-thick';
}) {
  return (
    <Surface
      as="div"
      material={material}
      padding="none"
      tone="card"
      className={`p-7 transition-transform hover:-translate-y-0.5 ${cls}`}
      style={style}
    >
      {children}
    </Surface>
  );
}

export function Hdr({ title, to, link = '查看全部' }: { title: string; to?: string; link?: string }) {
  return (
    <div className="mb-5 flex items-center justify-between">
      <h3 className="text-[15px] font-semibold" style={{ color: textMain }}>{title}</h3>
      {to ? <Link to={to} className="text-[11px] font-medium transition-colors hover:text-[#1e293b]" style={{ color: textMuted }}>{link}</Link> : null}
    </div>
  );
}
