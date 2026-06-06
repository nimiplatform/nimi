export const NIMI_REALM_FEED_SCOPES = [
  'personal',
  'friends',
  'agent_activity',
] as const;

export type NimiRealmFeedScope = (typeof NIMI_REALM_FEED_SCOPES)[number];

export function isNimiRealmFeedScope(value: unknown): value is NimiRealmFeedScope {
  return NIMI_REALM_FEED_SCOPES.includes(value as NimiRealmFeedScope);
}
