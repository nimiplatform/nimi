export const REALM_FEED_SCOPES = ['personal', 'friends', 'agent_activity'] as const;

export type RealmFeedScope = typeof REALM_FEED_SCOPES[number];

export function isRealmFeedScope(value: unknown): value is RealmFeedScope {
  return REALM_FEED_SCOPES.includes(value as RealmFeedScope);
}
