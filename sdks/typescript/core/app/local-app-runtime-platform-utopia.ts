import {
  assertExactProjectionKeys, assertExactKeys, canonicalString, decimalCursor, localAppProjectionError, projectTimestamp,
} from './local-app-runtime-platform-validation.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

export type NimiUtopiaPreset = 'island' | 'polar-station';
export type NimiUtopiaSettingsIntent =
  | { readonly kind: 'select-preset'; readonly preset: NimiUtopiaPreset }
  | { readonly kind: 'restore-default' }
  | { readonly kind: 'outdoor'; readonly open: boolean }
  | { readonly kind: 'public'; readonly enabled: boolean }
  | { readonly kind: 'solitude'; readonly agentHandle: string; readonly solitary: boolean };
export type NimiUtopiaSettingsUpdate = Readonly<{ expectedRevision: string; intent: NimiUtopiaSettingsIntent }>;
export type NimiUtopiaTime = Readonly<{ seconds: string; nanos: number }>;
export type NimiUtopiaSettings = Readonly<{
  revision: string; preset: NimiUtopiaPreset; presetVersion: string; outdoorOpen: boolean; publicParticipation: boolean;
}>;
export type NimiUtopiaFrame = Readonly<{
  title: string; place: string; startsAt: NimiUtopiaTime; endsAt: NimiUtopiaTime | null; interaction: boolean;
}>;
export type NimiUtopiaResident = Readonly<{
  agentHandle: NimiLocalAppAgentHandle; displayName: string; solitary: boolean;
  current: NimiUtopiaFrame | null; recent: NimiUtopiaFrame | null; next: NimiUtopiaFrame | null;
}>;
export type NimiUtopiaSharedActivity = Readonly<{
  activityRef: string; initiatorHandle: string; recipientHandle: string; place: string; activity: string;
  state: string; startsAt: NimiUtopiaTime | null; endsAt: NimiUtopiaTime | null; acceptedAt: NimiUtopiaTime | null;
}>;
export type NimiUtopiaSnapshot = Readonly<{
  settings: NimiUtopiaSettings; observedAt: NimiUtopiaTime;
  places: readonly Readonly<{ id: string; activities: readonly string[] }>[];
  residents: readonly NimiUtopiaResident[];
  occupancy: readonly Readonly<{ place: string; agentHandles: readonly string[] }>[];
  sharedActivities: readonly NimiUtopiaSharedActivity[];
}>;
export type NimiLocalAppUtopiaShell = Readonly<{
  snapshot: () => Promise<unknown>;
  update: (input: NimiUtopiaSettingsUpdate) => Promise<unknown>;
}>;
export type NimiLocalAppUtopiaClient = Readonly<{
  snapshot: () => Promise<NimiUtopiaSnapshot>;
  update: (input: NimiUtopiaSettingsUpdate) => Promise<NimiUtopiaSettings>;
}>;

function preset(value: unknown): NimiUtopiaPreset {
  if (value !== 'island' && value !== 'polar-station') localAppProjectionError('Utopia preset');
  return value;
}
function revision(value: unknown): string {
  const result = decimalCursor(value, 'Utopia revision');
  if (result === '0') localAppProjectionError('Utopia revision');
  return result;
}
function flag(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') localAppProjectionError(label);
  return value;
}
function timestamp(value: unknown): NimiUtopiaTime {
  const result = projectTimestamp(value, 'Utopia timestamp');
  if (!result) localAppProjectionError('Utopia timestamp');
  return Object.freeze(result);
}
function text(value: unknown, field: string, optional = false): string {
  const result = canonicalString(value, field);
  if ((!optional && !result) || result.length > 256 || result.includes('\0')) localAppProjectionError(field);
  return result;
}
function list<T>(value: unknown, field: string, project: (row: unknown) => T): readonly T[] {
  if (!Array.isArray(value)) localAppProjectionError(field);
  return Object.freeze(value.map(project));
}
function settings(value: unknown): NimiUtopiaSettings {
  assertExactProjectionKeys(value, ['revision', 'preset', 'presetVersion', 'outdoorOpen', 'publicParticipation'], 'Utopia settings');
  return Object.freeze({ revision: revision(value.revision), preset: preset(value.preset), presetVersion: revision(value.presetVersion),
    outdoorOpen: flag(value.outdoorOpen, 'Utopia outdoor condition'), publicParticipation: flag(value.publicParticipation, 'Utopia public participation') });
}
function frame(value: unknown): NimiUtopiaFrame | null {
  if (value === null) return null;
  assertExactProjectionKeys(value, ['title', 'place', 'startsAt', 'endsAt', 'interaction'], 'Utopia activity');
  return Object.freeze({ title: text(value.title, 'Utopia activity title'), place: text(value.place, 'Utopia place', true),
    startsAt: timestamp(value.startsAt), endsAt: value.endsAt === null ? null : timestamp(value.endsAt), interaction: flag(value.interaction, 'Utopia interaction') });
}
function snapshot(value: unknown): NimiUtopiaSnapshot {
  assertExactProjectionKeys(value, ['settings', 'observedAt', 'places', 'residents', 'occupancy', 'sharedActivities'], 'Utopia snapshot');
  return Object.freeze({
    settings: settings(value.settings), observedAt: timestamp(value.observedAt),
    places: list(value.places, 'Utopia places', row => {
      assertExactProjectionKeys(row, ['id', 'activities'], 'Utopia place');
      return Object.freeze({ id: text(row.id, 'Utopia place'), activities: list(row.activities, 'Utopia activities', activity => text(activity, 'Utopia activity')) });
    }),
    residents: list(value.residents, 'Utopia residents', row => {
      assertExactProjectionKeys(row, ['agentHandle', 'displayName', 'solitary', 'current', 'recent', 'next'], 'Utopia resident');
      const handle = text(row.agentHandle, 'Utopia Agent handle');
      if (!/^agent_ref_[\w-]{43}$/u.test(handle)) localAppProjectionError('Utopia Agent handle');
      return Object.freeze({ agentHandle: handle as NimiLocalAppAgentHandle, displayName: text(row.displayName, 'Utopia display name'),
        solitary: flag(row.solitary, 'Utopia solitude'), current: frame(row.current), recent: frame(row.recent), next: frame(row.next) });
    }),
    occupancy: list(value.occupancy, 'Utopia occupancy', row => {
      assertExactProjectionKeys(row, ['place', 'agentHandles'], 'Utopia occupancy');
      return Object.freeze({ place: text(row.place, 'Utopia place'), agentHandles: list(row.agentHandles, 'Utopia occupants', handle => text(handle, 'Utopia Agent handle')) });
    }),
    sharedActivities: list(value.sharedActivities, 'Utopia shared activity', row => {
      assertExactProjectionKeys(row, ['activityRef', 'initiatorHandle', 'recipientHandle', 'place', 'activity', 'state', 'startsAt', 'endsAt', 'acceptedAt'], 'Utopia shared activity');
      return Object.freeze({ activityRef: text(row.activityRef, 'Utopia shared reference'), initiatorHandle: text(row.initiatorHandle, 'Utopia initiator', true),
        recipientHandle: text(row.recipientHandle, 'Utopia recipient', true), place: text(row.place, 'Utopia shared place'), activity: text(row.activity, 'Utopia shared activity'),
        state: text(row.state, 'Utopia shared state'), startsAt: row.startsAt === null ? null : timestamp(row.startsAt), endsAt: row.endsAt === null ? null : timestamp(row.endsAt), acceptedAt: row.acceptedAt === null ? null : timestamp(row.acceptedAt) });
    }),
  });
}

// @nimi-authority: rule.nimi.sdks.feature-clients.utopia
export function createNimiLocalAppUtopiaClient(shell: NimiLocalAppUtopiaShell): NimiLocalAppUtopiaClient {
  return Object.freeze({
    snapshot: async () => snapshot(await shell.snapshot()),
    async update(input: NimiUtopiaSettingsUpdate) {
      assertExactKeys(input, ['expectedRevision', 'intent'], 'Utopia settings update');
      return settings(await shell.update({ expectedRevision: revision(input.expectedRevision), intent: input.intent }));
    },
  });
}
