export * from '@nimiplatform/nimi-ui';

export type StateTone = 'selected' | 'danger';

export const STATE_TONE_CLASS: Record<StateTone, string> = {
  selected: 'nimi-state--selected',
  danger: 'nimi-state--danger',
};
