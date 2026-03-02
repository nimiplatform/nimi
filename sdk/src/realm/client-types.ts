import type { NimiError } from '../types/index.js';
import type {
  RealmGeneratedServiceRegistry,
  RealmRawRequestInput,
} from './generated/service-registry.js';

export type RealmConnectionState = {
  status: 'idle' | 'connecting' | 'ready' | 'closing' | 'closed';
  connectedAt?: string;
  lastReadyAt?: string;
};

export type RealmTelemetryEvent = {
  name: string;
  at: string;
  data?: Record<string, unknown>;
};

export type RealmTokenRefreshResult = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
};

export type RealmFetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RealmOptions = {
  baseUrl: string;
  auth?: {
    accessToken?: string | (() => Promise<string> | string);
    refreshToken?: string | (() => Promise<string> | string);
    onTokenRefreshed?: (result: RealmTokenRefreshResult) => void;
    onRefreshFailed?: (error: unknown) => void;
  };
  headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
  timeoutMs?: number;
  fetchImpl?: RealmFetchImpl;
  telemetry?: {
    enabled?: boolean;
    onEvent?: (event: RealmTelemetryEvent) => void;
  };
};

export type RealmRawModule = {
  request<T = unknown>(input: RealmRawRequestInput): Promise<T>;
};

type ServiceByName<Name extends string> = Name extends keyof RealmGeneratedServiceRegistry
  ? RealmGeneratedServiceRegistry[Name]
  : Record<string, never>;

export type RealmServiceRegistry = RealmGeneratedServiceRegistry;

export type MeTwoFactorService = NonNullable<RealmServiceRegistry['MeTwoFactorService']>;
export type SocialDefaultVisibilityService = NonNullable<RealmServiceRegistry['SocialDefaultVisibilityService']>;
export type SocialAttributesService = NonNullable<RealmServiceRegistry['SocialAttributesService']>;

export type RealmAuthApi = ServiceByName<'AuthService'>;

export type RealmUserApi = ServiceByName<'UserService'> & ServiceByName<'MeService'>;

export type RealmPostApi = ServiceByName<'PostService'>;

export type RealmWorldApi = ServiceByName<'WorldsService'> & ServiceByName<'WorldControlService'> & ServiceByName<'WorldRulesService'>;

export type RealmNotificationApi = ServiceByName<'NotificationService'>;

export type RealmMediaApi = ServiceByName<'MediaService'>;

export type RealmSearchApi = ServiceByName<'SearchService'>;

export type RealmTransitsApi = ServiceByName<'TransitsService'>;

export type RealmEventsModule = {
  on(name: 'error', handler: (event: { error: NimiError; at: string }) => void): () => void;
  once(name: 'error', handler: (event: { error: NimiError; at: string }) => void): () => void;
};

type Assert<T extends true> = T;

type _ListMessagesArgs = Parameters<RealmGeneratedServiceRegistry['HumanChatService']['listMessages']>;
type _SyncChatEventsArgs = Parameters<RealmGeneratedServiceRegistry['HumanChatService']['syncChatEvents']>;
type _WorldLevelAuditsArgs = Parameters<RealmGeneratedServiceRegistry['WorldsService']['worldControllerGetWorldLevelAudits']>;

type _GuardListMessagesFirstArg = Assert<_ListMessagesArgs[0] extends string ? true : false>;
type _GuardListMessagesSecondArg = Assert<_ListMessagesArgs[1] extends number | undefined ? true : false>;

type _GuardSyncChatEventsFirstArg = Assert<_SyncChatEventsArgs[0] extends string ? true : false>;
type _GuardSyncChatEventsSecondArg = Assert<_SyncChatEventsArgs[1] extends number | undefined ? true : false>;
type _GuardSyncChatEventsThirdArg = Assert<_SyncChatEventsArgs[2] extends number | undefined ? true : false>;

type _GuardWorldLevelAuditsFirstArg = Assert<_WorldLevelAuditsArgs[0] extends string ? true : false>;
type _GuardWorldLevelAuditsSecondArg = Assert<_WorldLevelAuditsArgs[1] extends number | undefined ? true : false>;
