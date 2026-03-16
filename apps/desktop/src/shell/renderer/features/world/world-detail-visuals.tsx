import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CultivationRingsData,
  RealmConstellationData,
  WorldSemanticRealm,
} from './world-detail-types.js';
import { usePrefersReducedMotion } from './world-detail-primitives.js';

const visualMotionStyles = `
  @keyframes orbit-spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @keyframes orbit-spin-reverse {
    from { transform: rotate(360deg); }
    to { transform: rotate(0deg); }
  }

  @keyframes star-pulse {
    0%, 100% { opacity: 0.5; transform: scale(0.98); }
    50% { opacity: 1; transform: scale(1.04); }
  }
`;

function VisualShell({
  title,
  subtitle,
  dataTestId,
  tooltip,
  children,
  footer,
  className = '',
}: {
  title: string;
  subtitle?: string | null;
  dataTestId: string;
  tooltip?: string | null;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid={dataTestId}
      className={`relative overflow-hidden rounded-[22px] border border-[#4ECCA3]/15 bg-[#0a0f0c]/64 p-5 backdrop-blur-sm ${className}`}
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/40 to-transparent" />
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold tracking-[0.08em] text-[#4ECCA3]">{title}</h4>
          {subtitle ? <p className="mt-1 text-xs text-[#d8efe4]/50">{subtitle}</p> : null}
        </div>
        {tooltip ? (
          <div className="max-w-[220px] rounded-xl border border-[#4ECCA3]/12 bg-black/24 px-3 py-2 text-[11px] leading-relaxed text-[#d8efe4]/72">
            {tooltip}
          </div>
        ) : null}
      </div>
      <style>{visualMotionStyles}</style>
      {children}
      {footer ? <div className="mt-4">{footer}</div> : null}
    </section>
  );
}

function levelRingColor(index: number) {
  if (index <= 1) return '#4ECCA3';
  if (index <= 3) return '#86f0ca';
  if (index <= 5) return '#dffdf2';
  const highlight = ['#FFD700', '#FFF3B0', '#FFFFFF'];
  return highlight[(index - 6) % highlight.length];
}

export function CultivationRingsCard({
  data,
  title,
  subtitle,
}: {
  data: CultivationRingsData;
  title: string;
  subtitle?: string | null;
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const hoveredLevel = hoveredIndex != null ? data.levels[hoveredIndex] : null;

  return (
    <VisualShell
      title={title}
      subtitle={subtitle}
      dataTestId="world-detail-cultivation-rings"
      tooltip={hoveredLevel ? [hoveredLevel.name, hoveredLevel.description, hoveredLevel.extra].filter(Boolean).join(' · ') : data.systemDescription ?? null}
      footer={data.extraSystems.length ? (
        <div className="flex flex-wrap gap-2">
          {data.extraSystems.map((system) => (
            <span
              key={system.name}
              className="rounded-full border border-[#4ECCA3]/16 bg-[#4ECCA3]/10 px-2.5 py-1 text-[11px] text-[#86f0ca]"
            >
              {system.name}
            </span>
          ))}
        </div>
      ) : null}
    >
      <div className="flex items-center justify-center">
        <svg viewBox="0 0 280 280" className="h-[280px] w-[280px] overflow-visible">
          <defs>
            <radialGradient id="cultivation-core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#dffdf2" stopOpacity="0.95" />
              <stop offset="50%" stopColor="#4ECCA3" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#4ECCA3" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="140" cy="140" r="28" fill="url(#cultivation-core)" />
          {data.levels.map((level, index) => {
            const radius = 42 + (index * 8.5);
            const stroke = hoveredIndex === index ? 5 + Math.min(index * 0.2, 1.5) : 3 + Math.min(index * 0.25, 3);
            const color = levelRingColor(index);
            const dimmed = hoveredIndex != null && hoveredIndex !== index;
            const duration = `${12 + (index * 2.2)}s`;
            const animationName = index % 2 === 0 ? 'orbit-spin' : 'orbit-spin-reverse';
            return (
              <g
                key={level.name}
                style={{
                  transformOrigin: '140px 140px',
                  animation: prefersReducedMotion ? undefined : `${animationName} ${duration} linear infinite`,
                }}
              >
                <circle
                  cx="140"
                  cy="140"
                  r={radius}
                  fill="none"
                  stroke={color}
                  strokeWidth={stroke}
                  opacity={dimmed ? 0.28 : hoveredIndex === index ? 0.96 : 0.78}
                  strokeLinecap="round"
                  style={{ filter: `drop-shadow(0 0 4px ${color})` }}
                />
                <circle
                  cx="140"
                  cy="140"
                  r={radius}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={stroke + 10}
                  onMouseEnter={() => setHoveredIndex(index)}
                  onMouseLeave={() => setHoveredIndex(null)}
                  style={{ cursor: 'pointer' }}
                />
              </g>
            );
          })}
          <circle
            cx="140"
            cy="140"
            r="7"
            fill="#dffdf2"
            opacity="0.88"
            style={{
              filter: 'drop-shadow(0 0 10px rgba(223, 253, 242, 0.9))',
              animation: prefersReducedMotion ? undefined : 'star-pulse 4s ease-in-out infinite',
            }}
          />
          <foreignObject x="74" y="102" width="132" height="76">
            <div className="flex h-full flex-col items-center justify-center text-center">
              <div className="text-sm font-semibold text-[#dffdf2]">{data.systemName || t('WorldDetail.xianxia.v2.coreRules.powerSystem')}</div>
              <div className="mt-1 text-xs text-[#86f0ca]">
                {t('WorldDetail.xianxia.v2.visuals.cultivationLevelCount', { count: data.levels.length })}
              </div>
            </div>
          </foreignObject>
        </svg>
      </div>
    </VisualShell>
  );
}

function layoutRealms(realms: WorldSemanticRealm[]) {
  const centerX = 180;
  const centerY = 150;
  const radius = 106;
  if (realms.length === 1) {
    return [{ x: centerX, y: centerY }];
  }
  if (realms.length === 2) {
    return [{ x: centerX - 74, y: centerY }, { x: centerX + 74, y: centerY }];
  }
  if (realms.length === 3) {
    return [
      { x: centerX, y: centerY - 72 },
      { x: centerX - 68, y: centerY + 50 },
      { x: centerX + 68, y: centerY + 50 },
    ];
  }
  if (realms.length === 4) {
    return [
      { x: centerX, y: centerY - 86 },
      { x: centerX - 82, y: centerY },
      { x: centerX + 82, y: centerY },
      { x: centerX, y: centerY + 86 },
    ];
  }
  return realms.map((_, index) => {
    const angle = ((Math.PI * 2) / realms.length) * index - (Math.PI / 2);
    return {
      x: centerX + (Math.cos(angle) * radius),
      y: centerY + (Math.sin(angle) * (radius * 0.72)),
    };
  });
}

function realmStyle(accessibility?: string | null) {
  switch (accessibility) {
    case 'OPEN':
      return { radius: 28, fill: '#4ECCA3', glow: '0 0 18px rgba(78, 204, 163, 0.75)', opacity: 1 };
    case 'RESTRICTED':
      return { radius: 22, fill: '#6fd8b4', glow: '0 0 12px rgba(78, 204, 163, 0.4)', opacity: 0.82 };
    case 'SEALED':
      return { radius: 16, fill: '#315f4f', glow: '0 0 8px rgba(78, 204, 163, 0.12)', opacity: 0.65 };
    default:
      return { radius: 20, fill: '#4ECCA3', glow: '0 0 10px rgba(78, 204, 163, 0.28)', opacity: 0.76 };
  }
}

function ConstellationPill({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full border border-[#4ECCA3]/18 bg-[#4ECCA3]/10 px-2.5 py-1 text-[11px] text-[#86f0ca]">
      <span className="text-[#c5f7e6]/55">{label}</span>
      <span className="ml-1 font-medium text-[#dffdf2]">{value}</span>
    </span>
  );
}

export function RealmConstellationCard({
  data,
  title,
  subtitle,
}: {
  data: RealmConstellationData;
  title: string;
  subtitle?: string | null;
}) {
  const { t } = useTranslation();
  const prefersReducedMotion = usePrefersReducedMotion();
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const points = useMemo(() => layoutRealms(data.realms), [data.realms]);
  const hoveredRealm = hoveredIndex != null ? data.realms[hoveredIndex] : null;
  const meta = [
    data.topologyType ? { label: t('WorldDetail.xianxia.v2.coreRules.topologyType'), value: data.topologyType } : null,
    data.boundary ? { label: t('WorldDetail.xianxia.v2.coreRules.topologyBoundary'), value: data.boundary } : null,
    data.dimensions ? { label: t('WorldDetail.xianxia.v2.coreRules.topologyDimensions'), value: data.dimensions } : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <VisualShell
      title={title}
      subtitle={subtitle}
      dataTestId="world-detail-realm-constellation"
      className="flex h-full flex-col"
      tooltip={hoveredRealm ? [hoveredRealm.name, hoveredRealm.accessibility, hoveredRealm.description].filter(Boolean).join(' · ') : null}
      footer={meta.length ? (
        <div className="flex flex-wrap gap-2">
          {meta.map((item) => <ConstellationPill key={item.label} label={item.label} value={item.value} />)}
        </div>
      ) : null}
    >
      {data.realms.length ? (
        <div className="relative min-h-[420px] flex-1 overflow-hidden rounded-[18px] border border-[#4ECCA3]/10 bg-[radial-gradient(circle_at_top,rgba(22,44,34,0.9),rgba(7,11,9,0.98))]">
          <div
            className="absolute inset-0 opacity-40"
            style={{
              backgroundImage: 'radial-gradient(circle, rgba(78, 204, 163, 0.4) 1px, transparent 1px)',
              backgroundSize: '38px 38px',
            }}
          />
          <svg viewBox="0 0 360 320" className="relative h-full w-full">
            {points.map((point, index) => (
              points.slice(index + 1).map((target, targetIndex) => {
                const targetOffset = index + targetIndex + 1;
                const isActive = hoveredIndex == null || hoveredIndex === index || hoveredIndex === targetOffset;
                const curveX = (point.x + target.x) / 2;
                const curveY = Math.min(point.y, target.y) - 28;
                return (
                  <path
                    key={`${index}-${targetOffset}`}
                    d={`M ${point.x} ${point.y} Q ${curveX} ${curveY} ${target.x} ${target.y}`}
                    fill="none"
                    stroke="rgba(78, 204, 163, 0.24)"
                    strokeWidth={isActive ? 1.5 : 1}
                    opacity={isActive ? 0.75 : 0.2}
                  />
                );
              })
            ))}
            {data.realms.map((realm, index) => {
              const point = points[index];
              if (!point) {
                return null;
              }
              const style = realmStyle(realm.accessibility);
              const dimmed = hoveredIndex != null && hoveredIndex !== index;
              return (
                <g
                  key={realm.name}
                  style={{
                    transformOrigin: `${point.x}px ${point.y}px`,
                    animation: prefersReducedMotion ? undefined : `star-pulse ${4 + (index % 3)}s ease-in-out infinite`,
                  }}
                >
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={style.radius + 10}
                    fill="rgba(78, 204, 163, 0.08)"
                    opacity={dimmed ? 0.16 : 0.45}
                  />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={style.radius}
                    fill={style.fill}
                    opacity={dimmed ? 0.2 : style.opacity}
                    style={{ filter: `drop-shadow(${style.glow})` }}
                  />
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={style.radius + 8}
                    fill="transparent"
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                    style={{ cursor: 'pointer' }}
                  />
                  <text
                    x={point.x}
                    y={point.y + style.radius + 22}
                    textAnchor="middle"
                    className="fill-[#dffdf2] text-[11px] font-medium"
                    opacity={dimmed ? 0.4 : 0.9}
                  >
                    {realm.name}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>
      ) : (
        <div className="rounded-[18px] border border-dashed border-[#4ECCA3]/14 bg-black/18 px-4 py-6 text-sm text-[#d8efe4]/50">
          {t('WorldDetail.xianxia.v2.visuals.constellationEmpty')}
        </div>
      )}
    </VisualShell>
  );
}
