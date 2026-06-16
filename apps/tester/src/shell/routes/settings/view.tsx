import { ProgressIndicator, Surface, Toggle, type TypedProjectionState } from '@nimiplatform/kit/ui';
import type { TesterProductControlProjection } from '../../../tester/tester-product-control-projection';
import type { TesterRealmAgentProfileProjection } from '../../../tester/tester-realm-agent-profile-projection';
import type { TesterRealmAuthProjection } from '../../../tester/tester-realm-auth-projection';
import type { TesterRealmLocalAgentIntentsProjection } from '../../../tester/tester-realm-local-agent-intents-projection';
import type { TesterRealmSocialFeedProjection } from '../../../tester/tester-realm-social-feed-projection';
import type { TesterWorldEvolutionSelectorReadProjection } from '../../../tester/tester-world-evolution-selector-read';
import type { TesterSettingsRealmKitProjections } from './realm-kit-projections';
import type { TesterSettingsRuntimeProjections } from './runtime-projections';
import type {
  AccountDataProjectionState,
  AccountSettingsProjectionState,
  CatalogProjectionState,
  ConnectorProjectionState,
  GiftTransactionProjectionState,
  GroupChatProjectionState,
  HumanChatProjectionState,
  NotificationListProjectionState,
  NotificationProjectionState,
  ResourceUploadProjectionState,
  RuntimeAgentTurnRunnerProjectionState,
  RuntimeCapabilityProjectionState,
  RuntimeMediaGenerationRunnerProjectionState,
  RuntimeProviderHealthProjectionState,
  RuntimeRouteHostAccessProjectionState,
  WalletProjectionState,
} from './types';
import { SettingsRealmRows } from './realm-rows';
import { SettingsRuntimeRows } from './runtime-rows';
import { SettingsSdkRows } from './sdk-rows';

export type SettingsRefreshAction = () => void | Promise<void>;

export type SettingsRouteViewProps = {
  readonly localDrafts: boolean;
  readonly setLocalDrafts: (value: boolean) => void;
  readonly evidenceMode: boolean;
  readonly setEvidenceMode: (value: boolean) => void;
  readonly walletProjection: WalletProjectionState;
  readonly refreshWalletProjection: SettingsRefreshAction;
  readonly giftTransactionProjection: GiftTransactionProjectionState;
  readonly refreshGiftTransactionProjection: SettingsRefreshAction;
  readonly notificationProjection: NotificationProjectionState;
  readonly refreshNotificationProjection: SettingsRefreshAction;
  readonly notificationListProjection: NotificationListProjectionState;
  readonly refreshNotificationListProjection: SettingsRefreshAction;
  readonly resourceUploadProjection: ResourceUploadProjectionState;
  readonly accountDataProjection: AccountDataProjectionState;
  readonly requestAccountDataExportProjection: SettingsRefreshAction;
  readonly accountSettingsProjection: AccountSettingsProjectionState;
  readonly refreshAccountSettingsProjection: SettingsRefreshAction;
  readonly humanChatProjection: HumanChatProjectionState;
  readonly refreshHumanChatProjection: SettingsRefreshAction;
  readonly groupChatProjection: GroupChatProjectionState;
  readonly refreshGroupChatProjection: SettingsRefreshAction;
  readonly connectorProjection: ConnectorProjectionState;
  readonly refreshConnectorProjection: SettingsRefreshAction;
  readonly catalogProjection: CatalogProjectionState;
  readonly refreshCatalogProjection: SettingsRefreshAction;
  readonly runtimeCapabilityProjection: RuntimeCapabilityProjectionState;
  readonly runtimeProviderHealthProjection: RuntimeProviderHealthProjectionState;
  readonly runtimeRouteHostAccessProjection: RuntimeRouteHostAccessProjectionState;
  readonly runtimeAgentTurnRunnerProjection: RuntimeAgentTurnRunnerProjectionState;
  readonly runtimeMediaGenerationRunnerProjection: RuntimeMediaGenerationRunnerProjectionState;
  readonly localRuntimeFacadeProjection: TypedProjectionState<string>;
  readonly permissionClientProjection: TypedProjectionState<{ scopeOwner: string; grantCount: number; firstState: string; requestState: string; revokeState: string }>;
  readonly realmDataSyncProjection: TypedProjectionState<string>;
  readonly worldEvolutionSelectorReadProjection: TypedProjectionState<TesterWorldEvolutionSelectorReadProjection>;
  readonly realmSocialFeedProjection: TypedProjectionState<TesterRealmSocialFeedProjection>;
  readonly realmAgentProfileProjection: TypedProjectionState<TesterRealmAgentProfileProjection>;
  readonly realmAuthProjection: TypedProjectionState<TesterRealmAuthProjection>;
  readonly realmLocalAgentIntentsProjection: TypedProjectionState<TesterRealmLocalAgentIntentsProjection>;
  readonly productControlProjection: TypedProjectionState<TesterProductControlProjection>;
  readonly realmKit: TesterSettingsRealmKitProjections;
  readonly runtime: TesterSettingsRuntimeProjections;
};

export function SettingsRouteView(props: SettingsRouteViewProps) {
  return (
    <Surface className="grid gap-3" material="glass-thin" tone="panel">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <h2 className="m-0 text-sm font-semibold tracking-normal text-[var(--nimi-text-primary)]">Settings</h2>
        <ProgressIndicator value={props.localDrafts ? 72 : 46} showValue />
      </div>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Local draft data</span>
        <Toggle checked={props.localDrafts} onChange={props.setLocalDrafts} />
      </label>
      <label className="flex min-w-0 flex-wrap items-center justify-between gap-3 text-sm text-[var(--nimi-text-secondary)]">
        <span>Evidence capture</span>
        <Toggle checked={props.evidenceMode} onChange={props.setEvidenceMode} />
      </label>
      <SettingsRealmRows {...props} />
      <SettingsRuntimeRows {...props} />
      <SettingsSdkRows {...props} />
    </Surface>
  );
}
