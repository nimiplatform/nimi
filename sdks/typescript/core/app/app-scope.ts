// Application scope is an SDK composition concept for app-owned configuration.
// It is not an App Access declaration, operation selector, or authority claim.
export type NimiAppScopeKind = 'app';

export interface NimiAppScopeRef {
  readonly kind: NimiAppScopeKind;
  readonly ownerId: string;
  readonly surfaceId?: string;
}
