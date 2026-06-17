import { i18n } from '@renderer/i18n';

export type RealmPersonaSourceState = 'source_core_handoff_required';

export type RealmPersonaPrimaryAction = 'source_core_handoff_required';

export type RealmPersonaPrimaryActionLabel = {
  state: RealmPersonaSourceState;
  action: RealmPersonaPrimaryAction;
  label: string;
  disabled: boolean;
};

export type RealmPersonaSourceAdmissionProjection = {
  sourceCoreHandoffRequired: true;
};

export const realmPersonaSourceAdmissionQueryKey = ['realm-persona-source-admission'] as const;

export function realmPersonaSourceHandoffMessage(): string {
  return i18n.t('Explore.realmPersonaSourceAdmissionHandoffRequired', {
    defaultValue: 'RealmPersona source admission requires RuntimeSourceSnapshot materialization support.',
  });
}

export async function loadRealmPersonaSourceAdmissionProjection(): Promise<RealmPersonaSourceAdmissionProjection> {
  return { sourceCoreHandoffRequired: true };
}

export function resolveRealmPersonaSourceState(
  _sourceRef: string,
  _projection: RealmPersonaSourceAdmissionProjection | null | undefined,
): RealmPersonaSourceState {
  return 'source_core_handoff_required';
}

export function describeRealmPersonaPrimaryAction(
  state: RealmPersonaSourceState,
): RealmPersonaPrimaryActionLabel {
  return {
    state,
    action: 'source_core_handoff_required',
    label: i18n.t('Explore.realmPersonaSourceAdmissionPending', {
      defaultValue: 'Source admission pending',
    }),
    disabled: true,
  };
}
