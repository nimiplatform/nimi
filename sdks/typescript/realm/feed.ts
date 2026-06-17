export const NIMI_REALM_FEED_SCOPES = [
  'personal',
  'friends',
] as const;

export type NimiRealmFeedScope = (typeof NIMI_REALM_FEED_SCOPES)[number];

export function isNimiRealmFeedScope(value: unknown): value is NimiRealmFeedScope {
  return NIMI_REALM_FEED_SCOPES.includes(value as NimiRealmFeedScope);
}
