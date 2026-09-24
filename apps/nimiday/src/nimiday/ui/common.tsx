import { useState, type ReactNode } from 'react';
import {
  ActionMenu,
  Avatar,
  Button,
  IconButton,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Surface,
  type NimiMenuItem,
} from '@nimiplatform/kit/ui';
import {
  Baby,
  CalendarRange,
  Check,
  ClipboardCheck,
  Gift,
  HandHeart,
  Heart,
  HeartHandshake,
  House,
  Inbox,
  Moon,
  MoreHorizontal,
  PawPrint,
  ShoppingBasket,
  Sparkles,
  Stethoscope,
  Sunrise,
  UserRound,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { CircleKind, LifeItem, RunState } from '../domain/types.js';
import { useCopy } from '../app/context.js';

export const CIRCLE_ICONS: Readonly<Record<CircleKind, LucideIcon>> = {
  child: Baby,
  elder: HandHeart,
  partner: Heart,
  self: UserRound,
  home: House,
  pet: PawPrint,
  health: Stethoscope,
  money: Wallet,
  other: Sparkles,
};

export const SKILL_ICONS: Readonly<Record<string, LucideIcon>> = {
  sunrise: Sunrise,
  moon: Moon,
  'calendar-range': CalendarRange,
  'clipboard-check': ClipboardCheck,
  'shopping-basket': ShoppingBasket,
  gift: Gift,
  inbox: Inbox,
  'heart-handshake': HeartHandshake,
  sparkles: Sparkles,
};

export function SkillIcon({ icon, size = 18 }: { readonly icon: string; readonly size?: number }) {
  const Icon = SKILL_ICONS[icon] ?? Sparkles;
  return <Icon size={size} strokeWidth={1.8} aria-hidden="true" />;
}

export function CircleIcon({ kind, size = 18 }: { readonly kind: CircleKind; readonly size?: number }) {
  const Icon = CIRCLE_ICONS[kind];
  return (
    <span className="nd-circle-icon" data-kind={kind}>
      <Icon size={size} strokeWidth={1.8} aria-hidden="true" />
    </span>
  );
}

export function Card({
  title,
  hint,
  action,
  children,
  className,
  testId,
}: {
  readonly title?: ReactNode;
  readonly hint?: ReactNode;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly testId?: string;
}) {
  return (
    <Surface tone="card" elevation="base" padding="md" className={`nd-card ${className ?? ''}`} data-testid={testId}>
      {title || action ? (
        <div className="nd-card-head">
          {title ? <h2 className="nd-card-title">{title}</h2> : <span />}
          {action}
        </div>
      ) : null}
      {hint ? <p className="nd-card-hint">{hint}</p> : null}
      {children}
    </Surface>
  );
}

export function Chip({ tone, children }: { readonly tone?: 'info' | 'success' | 'warning' | 'danger' | 'accent'; readonly children: ReactNode }) {
  return <span className="nd-chip" data-tone={tone}>{children}</span>;
}

export function AgentAvatar({ name, url, size = 'md' }: { readonly name: string; readonly url: string | null; readonly size?: 'sm' | 'md' | 'lg' }) {
  return (
    <Avatar
      src={url}
      alt={name}
      size={size}
      tone="accent"
      fallback={<span aria-hidden="true">{[...name.trim()][0] ?? '·'}</span>}
    />
  );
}

export function CheckButton({ checked, label, onClick }: { readonly checked: boolean; readonly label: string; readonly onClick: () => void }) {
  return (
    <button type="button" className="nd-check" data-checked={checked} aria-label={label} title={label} onClick={onClick}>
      {checked ? <Check size={13} strokeWidth={3} aria-hidden="true" /> : null}
    </button>
  );
}

export function MenuButton({
  label,
  items,
  trigger,
}: {
  readonly label: string;
  readonly items: readonly (NimiMenuItem | null | false)[];
  readonly trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const entries = items.filter((item): item is NimiMenuItem => Boolean(item)).map((item) => ({
    ...item,
    onSelect: () => {
      setOpen(false);
      item.onSelect?.();
    },
  }));
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? <IconButton tone="ghost" size="sm" aria-label={label} title={label} icon={<MoreHorizontal size={16} aria-hidden="true" />} />}
      </PopoverTrigger>
      <PopoverContent align="end">
        <ActionMenu items={entries} ariaLabel={label} />
      </PopoverContent>
    </Popover>
  );
}

export function RunStateChip({ state }: { readonly state: RunState }) {
  const copy = useCopy();
  const tone = state === 'done' ? 'success' : state === 'failed' || state === 'interrupted' ? 'danger' : state === 'missed' ? 'warning' : state === 'running' || state === 'queued' ? 'info' : state === 'waiting-start' ? 'accent' : undefined;
  return <Chip tone={tone}>{copy.run.states[state]}</Chip>;
}

export function OriginNote({ item }: { readonly item: LifeItem }) {
  const copy = useCopy();
  if (item.origin.by === 'agent') return <span>{copy.item.addedBy.agent(item.origin.agentName)}</span>;
  if (item.origin.by === 'rhythm') return <span>{copy.item.addedBy.rhythm}</span>;
  return null;
}

export function PageHead({ title, sub, action }: { readonly title: ReactNode; readonly sub?: ReactNode; readonly action?: ReactNode }) {
  return (
    <div className="nd-page-head">
      <div>
        <h1 className="nd-page-title">{title}</h1>
        {sub ? <p className="nd-page-sub">{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function TextButton({ children, onClick }: { readonly children: ReactNode; readonly onClick: () => void }) {
  return <button type="button" className="nd-link" onClick={onClick}>{children}</button>;
}

export function Hint({ children }: { readonly children: ReactNode }) {
  return <p className="nd-empty">{children}</p>;
}

export function PrimaryButton(props: React.ComponentProps<typeof Button>) {
  return <Button tone="primary" size="sm" {...props} />;
}
