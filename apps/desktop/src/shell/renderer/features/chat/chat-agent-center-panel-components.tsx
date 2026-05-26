import { type ReactElement, type ReactNode, type SVGProps } from 'react';
import { Toggle, Tooltip, cn } from '@nimiplatform/kit/ui';

export type AgentCenterSectionId = 'overview' | 'appearance' | 'behavior' | 'model' | 'cognition' | 'advanced';

type PillTone = 'ready' | 'warn' | 'muted' | 'checking' | 'err';

const AUTONOMY_MODE_OPTIONS = ['off', 'low', 'medium', 'high'] as const;

const PILL_CLASS: Record<PillTone, string> = {
  ready: 'bg-emerald-500/10 text-emerald-700',
  warn: 'bg-amber-500/15 text-amber-700',
  muted: 'bg-slate-400/15 text-slate-600',
  checking: 'bg-sky-500/10 text-sky-700',
  err: 'bg-red-500/10 text-red-700',
};

const PILL_DOT_CLASS: Record<PillTone, string> = {
  ready: 'bg-emerald-500',
  warn: 'bg-amber-500',
  muted: 'bg-slate-400',
  checking: 'bg-sky-500 animate-pulse',
  err: 'bg-red-500',
};

function StatusPill(props: { tone: PillTone; label: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 h-[24px] px-2.5 rounded-full text-[11.5px] font-medium tracking-tight', PILL_CLASS[props.tone])}>
      <span className={cn('h-1.5 w-1.5 rounded-full', PILL_DOT_CLASS[props.tone])} />
      {props.label}
    </span>
  );
}

function Group(props: { children: ReactNode; className?: string }) {
  return <section className={cn('mb-7 last:mb-0', props.className)}>{props.children}</section>;
}

function GroupHead(props: { title: string; right?: ReactNode }) {
  return (
    <header className="mb-3 flex items-baseline justify-between gap-2.5">
      <h3 className="m-0 min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-slate-900">{props.title}</h3>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </header>
  );
}

function Card(props: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('overflow-hidden rounded-[14px] border border-slate-200/90 bg-white', props.className)}>
      {props.children}
    </div>
  );
}

function StateRow(props: { label: string; value?: ReactNode; valueTone?: 'attn' | 'plain'; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3.5 first:border-t-0">
      <span className="text-[13px] font-medium text-slate-600">{props.label}</span>
      {props.right ? props.right : (
        <span className={cn('text-[13px] font-semibold tabular-nums', props.valueTone === 'attn' ? 'text-amber-700' : 'text-slate-900')}>
          {props.value}
        </span>
      )}
    </div>
  );
}

function Row(props: { label: string; desc?: string; right?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-3.5 first:border-t-0">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[13px] font-medium text-slate-900">{props.label}</span>
        {props.desc ? <span className="text-[12px] leading-[1.5] text-slate-600">{props.desc}</span> : null}
      </div>
      {props.right ? <div className="shrink-0">{props.right}</div> : null}
    </div>
  );
}

function KvGrid(props: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-x-6 gap-y-4 p-3.5', props.className)}>{props.children}</div>;
}

function Kv(props: { label: string; value: string; mono?: boolean; muted?: boolean; tone?: 'sky' }) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-500">{props.label}</label>
      <div
        className={cn(
          'mt-1 truncate text-[13px] font-semibold',
          props.mono && 'font-mono text-[12px] tabular-nums',
          props.muted && 'text-slate-500 font-normal',
          props.tone === 'sky' && 'text-sky-700',
          !props.muted && props.tone !== 'sky' && 'text-slate-900',
        )}
      >
        {props.value}
      </div>
    </div>
  );
}

type BtnVariant = 'default' | 'primary' | 'accent' | 'danger' | 'ghost';
type BtnSize = 'sm' | 'md' | 'lg';

const BTN_VARIANT: Record<BtnVariant, string> = {
  default: 'bg-white text-slate-900 border-slate-200/90 hover:border-slate-300',
  primary: 'bg-slate-900 text-white border-slate-900 hover:bg-slate-800',
  accent: 'bg-emerald-500 text-emerald-950 border-emerald-500 hover:bg-emerald-400 font-semibold',
  danger: 'bg-white text-red-700 border-red-300/60 hover:bg-red-50',
  ghost: 'bg-transparent border-transparent text-slate-600 hover:bg-slate-100',
};

const BTN_SIZE: Record<BtnSize, string> = {
  sm: 'h-[28px] px-2.5 text-[12px] rounded-lg',
  md: 'h-8 px-3 text-[12.5px] rounded-[10px]',
  lg: 'h-[38px] px-4 text-[13px] rounded-xl',
};

function Btn(
  props: {
    children: ReactNode;
    variant?: BtnVariant;
    size?: BtnSize;
    disabled?: boolean;
    onClick?: () => void;
    type?: 'button' | 'submit';
    className?: string;
  },
) {
  return (
    <button
      type={props.type ?? 'button'}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 whitespace-nowrap border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        BTN_SIZE[props.size ?? 'md'],
        BTN_VARIANT[props.variant ?? 'default'],
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

function WarnBanner(props: { children: ReactNode }) {
  return (
    <div className="mb-4 flex items-start gap-2.5 rounded-xl border border-amber-300/40 bg-gradient-to-br from-amber-500/10 to-red-500/[0.05] p-3.5 text-[12.5px] leading-[1.5] text-amber-900">
      <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
      <div>{props.children}</div>
    </div>
  );
}

export function AdvBlock(props: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
  /** Shows a small amber dot next to the title — surfaces unsaved changes inside the section. */
  dirty?: boolean;
  /** Optional inline action rendered next to the chevron (e.g. a refresh icon). Click bubbling
   *  is stopped so it never toggles the details element. */
  headerAction?: ReactNode;
}) {
  return (
    <details className="group mb-2.5 overflow-hidden rounded-xl border border-slate-200/90 bg-white" open={props.defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 text-[13px] font-semibold text-slate-900 hover:bg-slate-50/70 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-2">
          {props.title}
          {props.dirty ? (
            // Decorative dirty indicator — the actionable signal lives on the disabled Apply
            // button inside the section, so this dot is intentionally aria-hidden.
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          ) : null}
        </span>
        <span className="inline-flex items-center gap-2">
          {props.headerAction ? (
            <span
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              className="inline-flex"
            >
              {props.headerAction}
            </span>
          ) : null}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 text-slate-400 transition-transform group-open:rotate-90">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </span>
      </summary>
      <div className="border-t border-slate-200/90 px-4 pb-4 pt-3">{props.children}</div>
    </details>
  );
}

function ProgressHero(props: { setupDone: number; setupTotal: number; title: string; description: string; setupLabel: string; nextCta?: string; onNext?: () => void }) {
  const ratio = props.setupTotal > 0 ? Math.min(1, props.setupDone / props.setupTotal) : 0;
  const radius = 36;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - ratio);
  return (
    <div className="mb-6 flex items-center gap-5 rounded-[18px] border border-slate-200/90 bg-gradient-to-br from-white via-white to-emerald-50/70 p-5 shadow-[0_6px_18px_rgba(15,23,42,0.06)]">
      <div className="relative h-[84px] w-[84px] shrink-0">
        <svg width="84" height="84" className="-rotate-90">
          <circle cx="42" cy="42" r={radius} stroke="rgba(148,163,184,0.18)" strokeWidth="8" fill="none" />
          <circle
            cx="42"
            cy="42"
            r={radius}
            stroke="#4ECCA3"
            strokeWidth="8"
            strokeLinecap="round"
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 400ms ease' }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div>
            <div className="text-[22px] font-semibold leading-none tracking-tight text-slate-900 tabular-nums">
              {props.setupDone}
              <span className="text-[14px] text-slate-400">/{props.setupTotal}</span>
            </div>
            <div className="mt-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-slate-500">{props.setupLabel}</div>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="mb-1.5 text-[16px] font-semibold tracking-tight text-slate-900">{props.title}</h3>
        <p className="m-0 text-[13px] leading-[1.55] text-slate-600">{props.description}</p>
        {props.nextCta && props.onNext ? (
          <button
            type="button"
            onClick={props.onNext}
            className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-emerald-700 hover:underline"
          >
            {props.nextCta}
            <IconChevronRight className="h-3 w-3" />
          </button>
        ) : null}
      </div>
    </div>
  );
}

type ChecklistTone = 'done' | 'todo' | 'attn';

function ChecklistItem(props: {
  index: number;
  status: ChecklistTone;
  title: string;
  description?: string;
  pill: { tone: PillTone; label: string };
  onClick?: () => void;
}) {
  const numClass = props.status === 'done'
    ? 'bg-emerald-500/15 text-emerald-700'
    : props.status === 'attn'
      ? 'bg-amber-500/20 text-amber-700'
      : 'bg-white border-[1.5px] border-slate-300/80 text-slate-500';

  return (
    <button
      type="button"
      onClick={props.onClick}
      className="flex w-full cursor-pointer items-center gap-3.5 border-t border-slate-200/90 px-4 py-4 text-left transition-colors first:border-t-0 hover:bg-slate-50/70"
    >
      <div className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-semibold tabular-nums', numClass)}>
        {props.status === 'done' ? <IconCheck className="h-3 w-3" /> : props.status === 'attn' ? '!' : props.index}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold tracking-tight text-slate-900">{props.title}</div>
        {props.description ? (
          <div className="mt-1 text-[12.5px] leading-[1.5] text-slate-600">{props.description}</div>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2.5">
        <StatusPill tone={props.pill.tone} label={props.pill.label} />
        <IconChevronRight className="h-3.5 w-3.5 text-slate-400" />
      </div>
    </button>
  );
}

function ModePicker(props: {
  value: string;
  onChange: (mode: string) => void;
  disabled?: boolean;
  labels: Record<string, { title: string; sub: string }>;
}) {
  const litCount: Record<string, number> = { off: 0, low: 1, medium: 2, high: 4 };
  return (
    <div className="grid grid-cols-4 gap-1.5 p-3.5">
      {AUTONOMY_MODE_OPTIONS.map((mode) => {
        const selected = props.value === mode;
        const labels = props.labels[mode]!;
        return (
          <button
            key={mode}
            type="button"
            disabled={props.disabled}
            onClick={() => props.onChange(mode)}
            className={cn(
              'flex flex-col items-center gap-0.5 rounded-[10px] border px-2 py-2.5 text-center transition-all disabled:cursor-not-allowed disabled:opacity-50',
              selected
                // Match the runtime selection style: brand-tinted border + 6% accent fill + accent text.
                ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,transparent)] text-[var(--nimi-action-primary-bg)]'
                // Hover preview hints at the same brand-tinted selection state.
                : 'border-slate-200/90 bg-white text-slate-900 hover:border-[var(--nimi-action-primary-bg)] hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_4%,white)]',
            )}
          >
            <div className="mb-1 flex h-3.5 items-end gap-0.5">
              {[4, 8, 11, 14].map((h, idx) => {
                const lit = idx < litCount[mode]!;
                return (
                  <i
                    key={idx}
                    className={cn(
                      'block w-[3px] rounded-[1.5px] bg-current',
                      lit ? 'opacity-100' : 'opacity-40',
                    )}
                    style={{ height: h }}
                  />
                );
              })}
            </div>
            <div className={cn('text-[12px] font-semibold tracking-tight', selected && 'text-[var(--nimi-action-primary-bg)]')}>{labels.title}</div>
            <div className={cn('text-[10.5px]', selected ? 'text-[var(--nimi-action-primary-bg)] opacity-80' : 'text-slate-600 opacity-80')}>{labels.sub}</div>
          </button>
        );
      })}
    </div>
  );
}

/**
 * Bottom-of-card toggle row for proactive behavior. Disabled state surfaces the
 * blocking reason via a Tooltip on hover (Linear/Vercel-style: prevention only
 * appears when the user attempts the action).
 */
function ProactiveToggleRow(props: {
  checked: boolean;
  disabled: boolean;
  disabledHint: string | null;
  pending: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description: string;
  updatingLabel: string;
}) {
  const toggle = (
    <Toggle
      checked={props.checked}
      onChange={props.onChange}
      disabled={props.disabled}
    />
  );
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-200/90 px-4 py-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] font-medium text-slate-900">{props.label}</span>
        <span className="text-[12px] leading-[1.5] text-slate-600">
          {props.pending ? props.updatingLabel : props.description}
        </span>
      </div>
      {props.disabled && props.disabledHint ? (
        <Tooltip
          placement="top"
          content={<span className="text-[12px] leading-[1.4] text-slate-700">{props.disabledHint}</span>}
        >
          {toggle}
        </Tooltip>
      ) : toggle}
    </div>
  );
}

// ── Icons (inlined for zero dependency) ───────────────────────────────────

function IconCheck(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function IconAlertTriangle(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

// Section icons follow the nimi-kit shell pattern: 18×18 box, strokeWidth 2,
// Feather-style stroke geometry, currentColor (mirrors navigation-config.tsx).
function IconOverview(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

function IconAppearance(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconBehavior(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9.5 2A2.5 2.5 0 0 0 7 4.5v0A2.5 2.5 0 0 0 4.5 7v0A2.5 2.5 0 0 0 2 9.5v5A2.5 2.5 0 0 0 4.5 17v0A2.5 2.5 0 0 0 7 19.5v0A2.5 2.5 0 0 0 9.5 22h0A2.5 2.5 0 0 0 12 19.5V4.5A2.5 2.5 0 0 0 9.5 2z" />
      <path d="M14.5 2A2.5 2.5 0 0 1 17 4.5v0A2.5 2.5 0 0 1 19.5 7v0A2.5 2.5 0 0 1 22 9.5v5a2.5 2.5 0 0 1-2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5v0a2.5 2.5 0 0 1-2.5 2.5h0A2.5 2.5 0 0 1 12 19.5V4.5A2.5 2.5 0 0 1 14.5 2z" />
    </svg>
  );
}

function IconModel(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M15 2v2M15 20v2M2 15h2M20 15h2M9 2v2M9 20v2M2 9h2M20 9h2" />
    </svg>
  );
}

function IconCognition(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M9 18h6" />
      <path d="M10 22h4" />
      <path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2z" />
    </svg>
  );
}

function IconAdvanced(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="8" y="6" width="8" height="14" rx="4" />
      <path d="M12 20v-7" />
      <path d="M8 13H4M16 13h4M8 9H5M16 9h3M8 17H4M16 17h4" />
      <path d="M9 6a3 3 0 1 1 6 0" />
    </svg>
  );
}

const SECTION_ICONS: Record<AgentCenterSectionId, (p: SVGProps<SVGSVGElement>) => ReactElement> = {
  overview: IconOverview,
  appearance: IconAppearance,
  behavior: IconBehavior,
  model: IconModel,
  cognition: IconCognition,
  advanced: IconAdvanced,
};

// ── Status helpers ─────────────────────────────────────────────────────────

function attentionPillTone(tone: 'ready' | 'muted' | 'attention'): PillTone {
  return tone === 'ready' ? 'ready' : tone === 'attention' ? 'warn' : 'muted';
}


export {
  StatusPill,
  Group,
  GroupHead,
  Card,
  StateRow,
  Row,
  KvGrid,
  Kv,
  Btn,
  WarnBanner,
  ProgressHero,
  ChecklistItem,
  ModePicker,
  ProactiveToggleRow,
  SECTION_ICONS,
  attentionPillTone,
};
