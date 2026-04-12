import type { RealmOptions } from './client-types.js';
import { Realm } from './client.js';

export function createRealmClient(input: RealmOptions): Realm {
  return new Realm(input);
}
