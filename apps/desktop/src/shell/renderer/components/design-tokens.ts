export * from '@nimiplatform/nimi-kit/ui';

export type StateTone = 'selected' | 'danger';

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  selected: 'bg-[var(--nimi-surface-active)]',
  danger: 'bg-[color-mix(in_srgb,var(--nimi-status-danger)_var(--nimi-opacity-subtle-fill),transparent)]',
};
