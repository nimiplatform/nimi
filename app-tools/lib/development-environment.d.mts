export interface DevelopmentRealm {
  readonly name: 'official' | 'local';
  readonly apiOrigin: string;
  readonly realtimeOrigin: string;
  readonly webOrigin: string;
  readonly environmentId: string;
}
export function resolveDevelopmentRealm(selection?: 'official' | 'local', env?: Record<string, string | undefined>): DevelopmentRealm;
export function developmentRealmEnvironment(realm: DevelopmentRealm): Record<string, string>;
export function exactDevelopmentOrigin(value: string, label: string): string;
