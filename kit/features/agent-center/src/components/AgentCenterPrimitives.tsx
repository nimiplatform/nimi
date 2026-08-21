import type { AriaAttributes, ComponentType, ReactNode } from 'react';
import {
  Bug,
  Brain,
  Check,
  ChevronRight,
  Cpu,
  Eye,
  Home,
  Lightbulb,
} from 'lucide-react';
import { StatusBadge, cn, type StatusTone } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import { agentCenterEnCatalog } from '../locales/index.js';
import type { AgentCenterSectionId } from '../types.js';

export type AgentCenterPillTone = 'ready' | 'warn' | 'muted' | 'checking' | 'err';
export type AgentCenterChecklistTone = 'done' | 'todo' | 'attn';

const PILL_STATUS_TONE: Record<AgentCenterPillTone, StatusTone> = {
  ready: 'success',
  warn: 'warning',
  muted: 'neutral',
  checking: 'info',
  err: 'danger',
};

const SECTION_ICONS: Record<AgentCenterSectionId, ComponentType<{ className?: string; 'aria-hidden'?: AriaAttributes['aria-hidden'] }>> = {
  overview: Home,
  appearance: Eye,
  behavior: Brain,
  'ai-config': Cpu,
  cognition: Lightbulb,
  advanced: Bug,
};

export const agentCenterInputClassName = cn(
  'h-8 min-w-0 rounded-[var(--nimi-radius-field)] border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-2.5 text-[length:var(--nimi-type-body-sm-size)] text-[var(--nimi-field-text)] outline-none',
  'transition-colors placeholder:text-[var(--nimi-field-placeholder)] focus:border-[var(--nimi-field-focus)]',
  FOCUS_RING_CLASS_NAME,
  'disabled:cursor-not-allowed disabled:opacity-[var(--nimi-opacity-disabled)]',
);

export { SECTION_ICONS };

export function cnAgentCenter(...inputs: Parameters<typeof cn>) {
  return cn(...inputs);
}

export function StatusPill(props: {
  readonly tone: AgentCenterPillTone;
  readonly label: string;
  readonly className?: string;
}) {
  const badge = (
    <StatusBadge
      className={cn('h-6 max-w-full', props.className)}
      shape="dot"
      tone={PILL_STATUS_TONE[props.tone]}
    >
      <span className="min-w-0 truncate">{props.label}</span>
    </StatusBadge>
  );
  // The pre-adapter checking pill pulsed its dot; StatusBadge's dot is static,
  // so the transient checking tone keeps its pulse at this adapter layer.
  return props.tone === 'checking'
    ? <span className="inline-flex max-w-full animate-pulse">{badge}</span>
    : badge;
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
        <h2 id={props.id} className="m-0 text-[length:var(--nimi-type-label-size)] font-semibold leading-[1.35] text-[var(--nimi-text-primary)]">
          {props.title}
        </h2>
        {props.description ? (
          <p className="m-0 mt-1 text-[length:var(--nimi-type-body-sm-size)] leading-[1.45] text-[var(--nimi-text-secondary)]">
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
    <div className={cn('min-w-0 overflow-hidden rounded-[14px] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]', props.className)}>
      {props.children}
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
      <div className="text-[length:var(--nimi-type-overline-size)] font-semibold text-[var(--nimi-text-muted)]">{props.label}</div>
      <div className={cn(
        'mt-1 min-w-0 truncate text-[length:var(--nimi-type-body-sm-size)] font-semibold',
        props.mono && 'font-mono text-[length:var(--nimi-type-mono-size)] tabular-nums',
        props.muted ? 'text-[var(--nimi-text-muted)]' : 'text-[var(--nimi-text-primary)]',
      )}>
        {props.value}
      </div>
    </div>
  );
}

export function ProgressHero(props: {
  readonly setupDone: number;
  readonly setupTotal: number;
  readonly title: string;
  readonly configLabel?: string;
}) {
  const ratio = props.setupTotal > 0 ? Math.min(1, props.setupDone / props.setupTotal) : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  return (
    <div
      className="mb-6 flex items-center gap-5 rounded-[18px] border border-[var(--nimi-border-subtle)] bg-gradient-to-br from-[var(--nimi-surface-card)] via-[var(--nimi-surface-card)] to-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)] p-5 shadow-[var(--nimi-elevation-base)]"
      data-agent-center-progress-hero="desktop-migrated"
    >
      <div className="relative h-[84px] w-[84px] shrink-0">
        <svg aria-hidden="true" className="-rotate-90" height="84" width="84">
          <circle cx="42" cy="42" fill="none" r={radius} stroke="var(--nimi-border-subtle)" strokeWidth="8" />
          <circle
            cx="42"
            cy="42"
            fill="none"
            r={radius}
            stroke="var(--nimi-action-primary-bg)"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            strokeWidth="8"
            style={{ transition: 'stroke-dashoffset var(--nimi-motion-slow) var(--nimi-motion-ease-standard)' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[length:var(--nimi-type-page-title-size)] font-semibold leading-none tracking-tight text-[var(--nimi-text-primary)] tabular-nums">
              {props.setupDone}
              <span className="text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-muted)]">/{props.setupTotal}</span>
            </div>
            <div className="mt-1.5 text-[length:var(--nimi-type-overline-size)] font-semibold uppercase tracking-[0.12em] text-[var(--nimi-text-muted)]">{props.configLabel || agentCenterEnCatalog['AgentCenter.progress.configLabel']}</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1.5 text-[length:var(--nimi-type-section-title-size)] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{props.title}</h3>
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
    ? 'border border-[var(--nimi-status-success-soft-border)] bg-[var(--nimi-status-success-soft-bg)] text-[var(--nimi-status-success-soft-text)]'
    : props.status === 'attn'
      ? 'border border-[var(--nimi-status-warning-soft-border)] bg-[var(--nimi-status-warning-soft-bg)] text-[var(--nimi-status-warning-soft-text)]'
      : 'border-[1.5px] border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-panel)] text-[var(--nimi-text-muted)]';
  return (
    <button
      className={cn(
        'flex w-full cursor-pointer items-center gap-3.5 border-t border-[var(--nimi-border-subtle)] px-4 py-4 text-left transition-colors first:border-t-0 hover:bg-[var(--nimi-action-ghost-hover)]',
        FOCUS_RING_CLASS_NAME,
      )}
      onClick={props.onClick}
      type="button"
    >
      <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[length:var(--nimi-type-caption-size)] font-semibold tabular-nums', markerClass)}>
        {props.status === 'done' ? <Check className="h-3 w-3" /> : props.status === 'attn' ? '!' : props.index}
      </span>
      <span className="grid min-w-0 flex-1 gap-1">
        <span className="min-w-0 truncate text-[length:var(--nimi-type-body-sm-size)] font-semibold tracking-tight text-[var(--nimi-text-primary)]">{props.title}</span>
        <span className="text-[length:var(--nimi-type-body-sm-size)] leading-[1.5] text-[var(--nimi-text-secondary)]">{props.description}</span>
      </span>
      <span className="flex shrink-0 items-center gap-2.5">
        <StatusPill label={props.pill.label} tone={props.pill.tone} />
        <ChevronRight className="h-3.5 w-3.5 text-[var(--nimi-text-muted)]" />
      </span>
    </button>
  );
}
