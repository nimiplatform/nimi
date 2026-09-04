import type { CSSProperties, ReactNode } from 'react';
import { Avatar, Button, IconButton, NimiText, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import type { LucideIcon } from 'lucide-react';
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Compass,
  FileText,
  Images,
  Layers,
  Languages,
  Milestone,
  MessageSquare,
  Plus,
  Shield,
  Stamp,
  ScrollText,
  Users,
} from 'lucide-react';
import { worldInitial } from './world-list-atoms';

type IconProps = { size?: number; color?: string; strokeWidth?: number };

function kitIcon(Icon: LucideIcon, { size = 18, color = 'currentColor', strokeWidth = 1.6 }: IconProps) {
  return <Icon aria-hidden="true" size={size} color={color} strokeWidth={strokeWidth} />;
}

export function IconUsers(props: IconProps) {
  return kitIcon(Users, props);
}

export function IconBook(props: IconProps) {
  return kitIcon(BookOpen, props);
}

export function IconScene(props: IconProps) {
  return kitIcon(Images, props);
}

export function IconCompass(props: IconProps) {
  return kitIcon(Compass, props);
}

export function IconClock(props: IconProps) {
  return kitIcon(Clock3, props);
}

export function IconLayers(props: IconProps) {
  return kitIcon(Layers, props);
}

export function IconStamp(props: IconProps) {
  return kitIcon(Stamp, props);
}

export function IconMilestone(props: IconProps) {
  return kitIcon(Milestone, props);
}

export function IconFile(props: IconProps) {
  return kitIcon(FileText, props);
}

export function IconScrollText(props: IconProps) {
  return kitIcon(ScrollText, props);
}

export function IconShield(props: IconProps) {
  return kitIcon(Shield, props);
}

export function IconLanguages(props: IconProps) {
  return kitIcon(Languages, props);
}

export function IconChat(props: IconProps) {
  return kitIcon(MessageSquare, props);
}

export function IconArrow(props: IconProps) {
  return kitIcon(ArrowRight, props);
}

export function IconPlus(props: IconProps) {
  return kitIcon(Plus, props);
}

export function IconCheck(props: IconProps) {
  return kitIcon(Check, props);
}

export function IconChevron(props: IconProps) {
  return kitIcon(ChevronRight, props);
}

/** Avatar with a soft accent-tinted fallback, used across the world detail surface. */
export function PaperAvatar({
  name,
  imageUrl,
  size = 54,
}: {
  name: string;
  imageUrl?: string | null;
  size?: number;
}) {
  const radius = size >= 48 ? Math.round(size * 0.26) : '50%';
  return (
    <div
      aria-hidden="true"
      className="shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        border: '1.5px solid var(--nimi-border-subtle)',
        background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 10%, var(--nimi-surface-panel))',
      }}
    >
      <Avatar
        alt={name}
        src={imageUrl}
        size="lg"
        shape={size >= 48 ? 'rounded' : 'circle'}
        className="h-full w-full bg-transparent"
        fallbackClassName="items-end bg-transparent"
        fallback={(
          <span
            style={{
              paddingBottom: Math.round(size * 0.1),
              fontSize: Math.round(size * 0.42),
              fontWeight: 700,
              color: 'var(--nimi-text-primary)',
            }}
          >
            {worldInitial(name)}
          </span>
        )}
      />
    </div>
  );
}

/** Card section shell with the accent tick + section heading + "view all" action. */
export function PaperSection({
  id,
  testId,
  title,
  subtitle,
  action,
  children,
}: {
  id?: string;
  testId?: string;
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Surface
      as="section"
      tone="card"
      material="solid"
      elevation="base"
      padding="none"
      id={id}
      data-testid={testId}
      className="min-w-0 scroll-mt-20 p-6"
      style={{
        background: 'var(--nimi-surface-card)',
        borderColor: 'var(--nimi-border-subtle)',
        borderRadius: 'var(--nimi-radius-lg)',
        boxShadow: 'var(--nimi-elevation-base)',
      }}
    >
      <div className="mb-1 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span aria-hidden="true" className="h-[18px] w-1 shrink-0 rounded-[var(--nimi-radius-sm)]" style={{ background: 'var(--nimi-action-primary-bg)' }} />
          <NimiText
            as="h2"
            role="section-title"
            className="truncate text-xl font-bold"
            style={{ color: 'var(--nimi-text-primary)' }}
          >
            {title}
          </NimiText>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {subtitle ? (
        <NimiText role="helper" className="mb-4" style={{ color: 'var(--nimi-text-muted)' }}>
          {subtitle}
        </NimiText>
      ) : null}
      {children}
    </Surface>
  );
}

export function PaperViewAll({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <Button
      onClick={onClick}
      tone="ghost"
      size="sm"
      trailingIcon={<IconChevron size={14} color="currentColor" />}
      className="min-h-0 px-0 py-0 hover:bg-transparent"
      style={{ color: 'var(--nimi-action-primary-bg)' }}
    >
      {label}
    </Button>
  );
}

export function PaperTag({
  children,
  tone = 'accent',
}: {
  children: ReactNode;
  tone?: 'accent' | 'neutral';
}) {
  const palette = tone === 'accent'
    ? { color: 'var(--nimi-action-primary-bg)', background: 'color-mix(in srgb, var(--nimi-action-primary-bg) 14%, transparent)' }
    : { color: 'var(--nimi-text-muted)', background: 'color-mix(in srgb, var(--nimi-text-muted) 10%, transparent)' };
  return (
    <StatusBadge
      tone="neutral"
      shape="soft"
      className="whitespace-nowrap px-2 py-0 text-[10.5px] font-semibold"
      style={{
        ...palette,
      }}
    >
      {children}
    </StatusBadge>
  );
}

export const paperPrimaryButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--nimi-font-sans)',
  fontSize: 'var(--nimi-type-body-sm-size)',
  fontWeight: 'var(--nimi-type-label-weight)',
  padding: '8px 15px',
  borderRadius: 'var(--nimi-radius-action)',
  border: 'none',
  background: 'var(--nimi-action-primary-bg)',
  color: 'var(--nimi-action-primary-text)',
  cursor: 'pointer',
};

export const paperGhostButton: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  fontFamily: 'var(--nimi-font-sans)',
  fontSize: 'var(--nimi-type-body-sm-size)',
  fontWeight: 'var(--nimi-type-label-weight)',
  padding: 8,
  borderRadius: 'var(--nimi-radius-action)',
  border: '1px solid var(--nimi-border-subtle)',
  background: 'var(--nimi-surface-card)',
  color: 'var(--nimi-text-primary)',
  cursor: 'pointer',
};

export function PaperIconButton({
  label,
  icon,
  onClick,
  className,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <IconButton
      aria-label={label}
      title={label}
      onClick={onClick}
      icon={icon}
      tone="secondary"
      size="sm"
      className={cn('h-8 w-8', className)}
      style={{
        color: 'var(--nimi-text-primary)',
        borderColor: 'var(--nimi-border-subtle)',
        background: 'var(--nimi-surface-card)',
      }}
    />
  );
}
