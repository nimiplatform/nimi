// Desktop public-for-web boundary: Realm platform client session helpers.
export {
  callRealmApi,
  emitRealmDataError,
} from '../../shell/renderer/infra/realm/realm-api';
export {
  configureWebRealmPlatformClient,
  isRealmPlatformClientReady,
} from '../../shell/renderer/infra/realm/realm-platform-session';
