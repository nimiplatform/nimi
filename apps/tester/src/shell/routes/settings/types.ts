import type {
  NimiRuntimeConnectorProjection,
  NimiRuntimeModelCatalogProvider,
  NimiRuntimeRouteHostProviderHealth,
} from '@nimiplatform/sdk/runtime';
import type {
  NimiRealmCreatorEligibility,
  NimiRealmGroupChatListResult,
  NimiRealmNotificationListProjection,
  NimiRealmNotificationUnreadProjection,
  NimiRealmRequestDataExportOutput,
} from '@nimiplatform/sdk/realm';
import type { CommerceCurrencyBalances } from '@nimiplatform/kit/features/commerce/realm';
import type { RealmListChatsResultDto } from '@nimiplatform/kit/features/chat/realm';
import type { TesterRuntimeAgentTurnRunnerProjection } from '../../../tester/tester-runtime-agent-turn-runner';
import type { TesterRuntimeMediaGenerationRunnerProjection } from '../../../tester/tester-runtime-media-generation-runner';
import type { TesterRuntimeRouteHostAccessProjection } from '../../../tester/tester-runtime-route-host-access';

export type WalletProjectionState =
  | { status: 'idle'; balances: null; error: null }
  | { status: 'loading'; balances: CommerceCurrencyBalances | null; error: null }
  | { status: 'ready'; balances: CommerceCurrencyBalances; error: null }
  | { status: 'error'; balances: null; error: string };
export type GiftTransactionProjectionState =
  | { status: 'idle'; gift: null; error: null }
  | { status: 'loading'; gift: { id: string; giftStatus: string } | null; error: null }
  | { status: 'ready'; gift: { id: string; giftStatus: string }; error: null }
  | { status: 'error'; gift: null; error: string };

export type NotificationProjectionState =
  | { status: 'idle'; unread: null; error: null }
  | { status: 'loading'; unread: NimiRealmNotificationUnreadProjection | null; error: null }
  | { status: 'ready'; unread: NimiRealmNotificationUnreadProjection; error: null }
  | { status: 'error'; unread: null; error: string };

export type NotificationListProjectionState =
  | { status: 'idle'; list: null; error: null }
  | { status: 'loading'; list: NimiRealmNotificationListProjection | null; error: null }
  | { status: 'ready'; list: NimiRealmNotificationListProjection; error: null }
  | { status: 'error'; list: null; error: string };

export type ResourceUploadProjectionState =
  | { status: 'idle'; summary: null; error: null }
  | { status: 'loading'; summary: null; error: null }
  | { status: 'ready'; summary: { resourceId: string; status: string }; error: null }
  | { status: 'error'; summary: null; error: string };

export type AccountDataProjectionState =
  | { status: 'idle'; exportRequest: null; error: null }
  | { status: 'loading'; exportRequest: NimiRealmRequestDataExportOutput | null; error: null }
  | { status: 'ready'; exportRequest: NimiRealmRequestDataExportOutput; error: null }
  | { status: 'error'; exportRequest: null; error: string };

export type AccountSettingsProjectionState =
  | { status: 'idle'; eligibility: null; error: null }
  | { status: 'loading'; eligibility: NimiRealmCreatorEligibility | null; error: null }
  | { status: 'ready'; eligibility: NimiRealmCreatorEligibility; error: null }
  | { status: 'error'; eligibility: null; error: string };

export type HumanChatProjectionState =
  | { status: 'idle'; chats: null; error: null }
  | { status: 'loading'; chats: RealmListChatsResultDto | null; error: null }
  | { status: 'ready'; chats: RealmListChatsResultDto; error: null }
  | { status: 'error'; chats: null; error: string };

export type GroupChatProjectionState =
  | { status: 'idle'; groups: null; error: null }
  | { status: 'loading'; groups: NimiRealmGroupChatListResult | null; error: null }
  | { status: 'ready'; groups: NimiRealmGroupChatListResult; error: null }
  | { status: 'error'; groups: null; error: string };

export type ConnectorProjectionState =
  | { status: 'idle'; connectors: NimiRuntimeConnectorProjection[]; error: null }
  | { status: 'loading'; connectors: NimiRuntimeConnectorProjection[]; error: null }
  | { status: 'ready'; connectors: NimiRuntimeConnectorProjection[]; error: null }
  | { status: 'error'; connectors: NimiRuntimeConnectorProjection[]; error: string };

export type CatalogProjectionState =
  | { status: 'idle'; providers: NimiRuntimeModelCatalogProvider[]; error: null }
  | { status: 'loading'; providers: NimiRuntimeModelCatalogProvider[]; error: null }
  | { status: 'ready'; providers: NimiRuntimeModelCatalogProvider[]; error: null }
  | { status: 'error'; providers: NimiRuntimeModelCatalogProvider[]; error: string };

export type RuntimeCapabilityProjectionState =
  | { status: 'loading'; summary: null; error: null }
  | { status: 'ready'; summary: { capability: string; supported: boolean; ready: boolean; issueKind: string; reasonCode: string; setupStatus: string }; error: null }
  | { status: 'error'; summary: null; error: string };

export type RuntimeProviderHealthProjectionState =
  | { status: 'loading'; health: null; error: null }
  | { status: 'ready'; health: NimiRuntimeRouteHostProviderHealth; error: null }
  | { status: 'error'; health: null; error: string };

export type RuntimeRouteHostAccessProjectionState =
  | { status: 'loading'; projection: null; error: null }
  | { status: 'ready'; projection: TesterRuntimeRouteHostAccessProjection; error: null }
  | { status: 'error'; projection: null; error: string };

export type RuntimeAgentTurnRunnerProjectionState =
  | { status: 'loading'; projection: null; error: null }
  | { status: 'ready'; projection: TesterRuntimeAgentTurnRunnerProjection; error: null }
  | { status: 'error'; projection: null; error: string };

export type RuntimeMediaGenerationRunnerProjectionState =
  | { status: 'loading'; projection: null; error: null }
  | { status: 'ready'; projection: TesterRuntimeMediaGenerationRunnerProjection; error: null }
  | { status: 'error'; projection: null; error: string };
