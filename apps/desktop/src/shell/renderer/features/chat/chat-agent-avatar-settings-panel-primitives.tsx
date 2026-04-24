import type { ReactNode } from 'react';
import type { AvatarPresentationProfile } from '@nimiplatform/nimi-kit/features/avatar/headless';
type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

export function formatBackendLabel(
  value: AvatarPresentationProfile['backendKind'] | null | undefined,
  t: TranslateFn,
): string {
  switch (value) {
    case 'vrm':
      return t('Chat.avatarBackendVrmLabel', { defaultValue: 'VRM' });
    case 'live2d':
      return t('Chat.avatarBackendLive2dLabel', { defaultValue: 'Live2D' });
    case 'sprite2d':
      return t('Chat.avatarBackendSprite2dLabel', { defaultValue: 'Sprite 2D' });
    case 'canvas2d':
      return t('Chat.avatarBackendCanvas2dLabel', { defaultValue: 'Canvas 2D' });
    case 'video':
      return t('Chat.avatarBackendVideoLabel', { defaultValue: 'Video' });
    default:
      return t('Chat.avatarBackendUnboundLabel', { defaultValue: 'Unbound' });
  }
}
export function SectionCard(props: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_95%,var(--nimi-surface-panel))] p-4 shadow-[0_10px_22px_rgba(15,23,42,0.04)]">
      <div className="space-y-1">
        <h3 className="text-[13px] font-semibold text-[var(--nimi-text-primary)]">{props.title}</h3>
        <p className="text-xs leading-5 text-[var(--nimi-text-muted)]">{props.description}</p>
      </div>
      {props.children}
    </section>
  );
}
export function DetailRow(props: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--nimi-text-muted)]">
        {props.label}
      </span>
      <span className="max-w-[65%] break-all text-right text-xs text-[var(--nimi-text-primary)]">
        {props.value}
      </span>
    </div>
  );
}
export function formatLaunchModeLabel(value: 'existing' | 'open_new', t: TranslateFn): string {
  return value === 'existing'
    ? t('Chat.avatarSessionLinkModeExisting', { defaultValue: 'existing' })
    : t('Chat.avatarSessionLinkModeOpenNew', { defaultValue: 'open_new' });
}
