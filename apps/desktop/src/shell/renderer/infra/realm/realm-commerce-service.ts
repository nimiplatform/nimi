import {
  createRealmCommerceGiftService,
  type RealmCommerceGiftService,
} from '@nimiplatform/kit/features/commerce/realm';
import { getDesktopRealm } from '../sdk/desktop-nimi-client-session';

export function getDesktopRealmCommerceGiftService(): RealmCommerceGiftService {
  return createRealmCommerceGiftService({
    generated: getDesktopRealm().generated,
  });
}
