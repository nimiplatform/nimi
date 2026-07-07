import type { AriaAttributes, ComponentType, ReactNode } from 'react';
import {
  AlertTriangle,
  Bug,
  Brain,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  Home,
  Lightbulb,
} from 'lucide-react';
import { cn } from '@nimiplatform/kit/ui';
import type {
  AgentCenterCapabilityState,
  AgentCenterSectionId,
  AgentCenterStatusTone,
} from '../types.js';

export type AgentCenterPillTone = 'ready' | 'warn' | 'muted' | 'checking' | 'err';
export type AgentCenterChecklistTone = 'done' | 'todo' | 'attn';

const PILL_CLASS: Record<AgentCenterPillTone, string> = {
  ready: 'bg-emerald-500/10 text-emerald-700',
  warn: 'bg-amber-500/15 text-amber-700',
  muted: 'bg-slate-400/15 text-slate-600',
  checking: 'bg-sky-500/10 text-sky-700',
  err: 'bg-red-500/10 text-red-700',
};

const PILL_DOT_CLASS: Record<AgentCenterPillTone, string> = {
  ready: 'bg-emerald-500',
  warn: 'bg-amber-500',
  muted: 'bg-slate-400',
  checking: 'bg-sky-500 animate-pulse',
  err: 'bg-red-500',
};

const SECTION_ICONS: Record<AgentCenterSectionId, ComponentType<{ className?: string; 'aria-hidden'?: AriaAttributes['aria-hidden'] }>> = {
  overview: Home,
  appearance: Eye,
  behavior: Brain,
  model: Cpu,
  cognition: Lightbulb,
  advanced: Bug,
};

export const agentCenterInputClassName = cn(
  'h-8 min-w-0 rounded-[8px] border border-slate-200 bg-white px-2.5 text-[12.5px] text-slate-900 outline-none',
  'transition-colors placeholder:text-slate-400 focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/10',
  'disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
);

export const agentCenterSelectClassName = cn(
  agentCenterInputClassName,
  'appearance-auto',
);

export { SECTION_ICONS };

export function cnAgentCenter(...inputs: Parameters<typeof cn>) {
  return cn(...inputs);
}

export function pillToneForStatus(tone: AgentCenterStatusTone): AgentCenterPillTone {
  switch (tone) {
    case 'ready':
      return 'ready';
    case 'attention':
      return 'warn';
    case 'failed':
      return 'err';
    case 'loading':
      return 'checking';
    default:
      return 'muted';
  }
}

export function pillToneForCapability(capability: AgentCenterCapabilityState): AgentCenterPillTone {
  switch (capability.readinessState) {
    case 'ready':
      return 'ready';
    case 'unavailable':
      return 'err';
    case 'not_configured':
      return capability.required ? 'warn' : 'muted';
    default:
      return 'checking';
  }
}

export function StatusPill(props: {
  readonly tone: AgentCenterPillTone;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span className={cn(
      'inline-flex h-6 max-w-full items-center gap-1.5 rounded-full px-2.5 text-[11.5px] font-medium tracking-tight',
      PILL_CLASS[props.tone],
      props.className,
    )}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', PILL_DOT_CLASS[props.tone])} />
      <span className="min-w-0 truncate">{props.label}</span>
    </span>
  );
}

export function SectionHeader(props: {
  readonly id: string;
  readonly title: string;
  readonly description?: ReactNode;
  readonly right?: ReactNode;
}) {
  return (
    <header className="mb-3 flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 id={props.id} className="m-0 text-[15px] font-semibold leading-[1.35] text-slate-950">
          {props.title}
        </h2>
        {props.description ? (
          <p className="m-0 mt-1 text-[12.5px] leading-[1.45] text-slate-600">
            {props.description}
          </p>
        ) : null}
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </header>
  );
}

export function SectionShell(props: {
  readonly labelledBy: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <section aria-labelledby={props.labelledBy} className={cn('grid min-w-0 gap-3', props.className)}>
      {props.children}
    </section>
  );
}

export function Card(props: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn('min-w-0 overflow-hidden rounded-[14px] border border-slate-200/90 bg-white', props.className)}>
      {props.children}
    </div>
  );
}

export function SoftCard(props: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        'min-w-0 rounded-[18px] border border-slate-200/80 bg-white/80 shadow-[0_16px_34px_rgba(15,23,42,0.05)]',
        props.className,
      )}
    >
      {props.children}
    </div>
  );
}

export function StateRow(props: {
  readonly label: string;
  readonly value?: ReactNode;
  readonly right?: ReactNode;
  readonly valueTone?: 'plain' | 'attn';
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3.5 first:border-t-0">
      <span className="min-w-0 text-[13px] font-medium text-slate-600">{props.label}</span>
      {props.right ? props.right : (
        <span className={cn(
          'min-w-0 truncate text-right text-[13px] font-semibold tabular-nums',
          props.valueTone === 'attn' ? 'text-amber-700' : 'text-slate-950',
        )}>
          {props.value}
        </span>
      )}
    </div>
  );
}

export function Row(props: {
  readonly label: string;
  readonly desc?: ReactNode;
  readonly right?: ReactNode;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3.5 first:border-t-0">
      <div className="grid min-w-0 gap-1">
        <span className="min-w-0 truncate text-[13px] font-semibold text-slate-950">{props.label}</span>
        {props.desc ? <span className="text-[12.5px] leading-[1.45] text-slate-600">{props.desc}</span> : null}
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </div>
  );
}

export function KvGrid(props: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={cn('grid grid-cols-2 gap-x-5 gap-y-4 p-3.5', props.className)}>{props.children}</div>;
}

export function Kv(props: {
  readonly label: string;
  readonly value: ReactNode;
  readonly mono?: boolean;
  readonly muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-semibold text-slate-500">{props.label}</div>
      <div className={cn(
        'mt-1 min-w-0 truncate text-[13px] font-semibold',
        props.mono && 'font-mono text-[12px] tabular-nums',
        props.muted ? 'text-slate-500' : 'text-slate-950',
      )}>
        {props.value}
      </div>
    </div>
  );
}

type ButtonVariant = 'default' | 'primary' | 'accent' | 'ghost';

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string> = {
  default: 'border-slate-200/90 bg-white text-slate-900 hover:border-slate-300 hover:bg-slate-50',
  primary: 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
  accent: 'border-emerald-500 bg-emerald-500 text-emerald-950 hover:bg-emerald-400',
  ghost: 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100',
};

export function AgentButton(props: {
  readonly children: ReactNode;
  readonly variant?: ButtonVariant;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
  readonly type?: 'button' | 'submit';
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly dataAttrs?: Record<string, string | boolean>;
}) {
  return (
    <button
      aria-label={props.ariaLabel}
      className={cn(
        'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[10px] border px-3 text-[12.5px] font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-45',
        BUTTON_VARIANT_CLASS[props.variant ?? 'default'],
        props.className,
      )}
      disabled={props.disabled}
      onClick={props.onClick}
      title={props.title}
      type={props.type ?? 'button'}
      {...props.dataAttrs}
    >
      {props.children}
    </button>
  );
}

export function Notice(props: {
  readonly tone?: 'warn' | 'info';
  readonly children: ReactNode;
}) {
  const tone = props.tone ?? 'info';
  return (
    <div className={cn(
      'flex min-w-0 items-start gap-2.5 rounded-[12px] border p-3 text-[12.5px] leading-[1.45]',
      tone === 'warn'
        ? 'border-amber-300/50 bg-amber-50 text-amber-900'
        : 'border-slate-200 bg-slate-50 text-slate-700',
    )}>
      <AlertTriangle className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warn' ? 'text-amber-600' : 'text-slate-500')} />
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

export function ProgressHero(props: {
  readonly setupDone: number;
  readonly setupTotal: number;
  readonly title: string;
  readonly description: ReactNode;
}) {
  const ratio = props.setupTotal > 0 ? Math.min(1, props.setupDone / props.setupTotal) : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  return (
    <div
      className="mb-6 flex items-center gap-5 rounded-[18px] border border-slate-200/90 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 shadow-[0_6px_18px_rgba(15,23,42,0.06)]"
      data-agent-center-progress-hero="desktop-migrated"
    >
      <div className="relative h-[84px] w-[84px] shrink-0">
        <svg aria-hidden="true" className="-rotate-90" height="84" width="84">
          <circle cx="42" cy="42" fill="none" r={radius} stroke="rgba(148,163,184,0.18)" strokeWidth="8" />
          <circle
            cx="42"
            cy="42"
            fill="none"
            r={radius}
            stroke="#4ECCA3"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="8"
            style={{ transition: 'stroke-dashoffset 400ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[22px] font-semibold leading-none tracking-tight text-slate-950 tabular-nums">
              {props.setupDone}
              <span className="text-[14px] text-slate-400">/{props.setupTotal}</span>
            </div>
            <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">Config</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1.5 text-[16px] font-semibold tracking-tight text-slate-950">{props.title}</h3>
        <p className="m-0 text-[13px] leading-[1.55] text-slate-600">{props.description}</p>
      </div>
    </div>
  );
}

export function ChecklistItem(props: {
  readonly index: number;
  readonly status: AgentCenterChecklistTone;
  readonly title: string;
  readonly description: ReactNode;
  readonly pill: { readonly tone: AgentCenterPillTone; readonly label: string };
  readonly onClick: () => void;
}) {
  const markerClass = props.status === 'done'
    ? 'border border-emerald-500/20 bg-emerald-500/15 text-emerald-700'
    : props.status === 'attn'
      ? 'border border-amber-500/20 bg-amber-500/15 text-amber-700'
      : 'border-[1.5px] border-slate-300/80 bg-white text-slate-500';
  return (
    <button
      className="flex w-full cursor-pointer items-center gap-3.5 border-t border-slate-200/90 px-4 py-4 text-left transition-colors first:border-t-0 hover:bg-slate-50/70"
      onClick={props.onClick}
      type="button"
    >
      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums', markerClass)}>
        {props.status === 'done' ? <Check className="h-3 w-3" /> : props.status === 'attn' ? '!' : props.index}
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="min-w-0 truncate text-[13px] font-semibold tracking-tight text-slate-950">{props.title}</span>
        <span className="text-[12.5px] leading-[1.5] text-slate-600">{props.description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <StatusPill label={props.pill.label} tone={props.pill.tone} />
        <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
      </span>
    </button>
  );
}

export function ModePicker(props: {
  readonly value: string;
  readonly disabled?: boolean;
  readonly onChange: (value: string) => void;
}) {
  const labels: Record<string, { title: string; sub: string; bars: number }> = {
    off: { title: 'Off', sub: 'manual', bars: 0 },
    low: { title: 'Low', sub: 'light', bars: 1 },
    medium: { title: 'Medium', sub: 'balanced', bars: 2 },
    high: { title: 'High', sub: 'active', bars: 4 },
  };
  return (
    <div className="grid grid-cols-4 gap-1.5 p-3.5">
      {Object.entries(labels).map(([mode, meta]) => {
        const selected = props.value === mode;
        return (
          <button
            className={cn(
              'grid min-h-[66px] place-items-center gap-1 rounded-[10px] border px-2 py-2 text-center transition-colors',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-emerald-400 bg-emerald-500/10 text-emerald-700'
                : 'border-slate-200/90 bg-white text-slate-900 hover:border-emerald-300 hover:bg-emerald-50/50',
            )}
            disabled={props.disabled}
            key={mode}
            onClick={() => props.onChange(mode)}
            type="button"
          >
            <span className="mb-0.5 flex h-4 items-end gap-0.5">
              {[4, 8, 11, 14].map((height, index) => (
                <i
                  className={cn('block w-[3px] rounded-[2px] bg-current', index < meta.bars ? 'opacity-100' : 'opacity-35')}
                  key={height}
                  style={{ height }}
                />
              ))}
            </span>
            <span className="text-[12px] font-semibold">{meta.title}</span>
            <span className={cn('text-[10.5px]', selected ? 'text-emerald-700/80' : 'text-slate-500')}>{meta.sub}</span>
          </button>
        );
      })}
    </div>
  );
}
