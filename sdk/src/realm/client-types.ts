import type { NimiError } from '../types/index.js';
import type {
  RealmGeneratedServiceRegistry,
  RealmRawRequestInput,
} from './generated/service-registry.js';
import type { components } from './generated/schema.js';

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

export type RealmAuthOptions = {
  accessToken?: string | (() => Promise<string> | string);
  refreshToken?: string | (() => Promise<string> | string);
  onTokenRefreshed?: (result: RealmTokenRefreshResult) => void;
  onRefreshFailed?: (error: unknown) => void;
};

export type RealmRetryOptions = {
  maxRetries?: number;
  retryableStatuses?: number[];
  backoffMs?: number;
  maxBackoffMs?: number;
};

export type RealmOptions = {
  baseUrl: string;
  auth?: RealmAuthOptions | null;
  headers?: Record<string, string> | (() => Promise<Record<string, string>> | Record<string, string>);
  retry?: RealmRetryOptions;
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

export type RealmServiceRegistry = RealmGeneratedServiceRegistry;

export type MeTwoFactorService = NonNullable<RealmServiceRegistry['MeTwoFactorService']>;
export type SocialDefaultVisibilityService = NonNullable<RealmServiceRegistry['SocialDefaultVisibilityService']>;

export type RealmEventsModule = {
  on(name: 'error', handler: (event: { error: NimiError; at: string }) => void): () => void;
  once(name: 'error', handler: (event: { error: NimiError; at: string }) => void): () => void;
};

type Assert<T extends true> = T;
type IsEqual<A, B> = (
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
);

type _ListMessagesArgs = Parameters<RealmGeneratedServiceRegistry['HumanChatService']['listMessages']>;
type _SyncChatEventsArgs = Parameters<RealmGeneratedServiceRegistry['HumanChatService']['syncChatEvents']>;
type _WorldLevelAuditsArgs = Parameters<RealmGeneratedServiceRegistry['WorldsService']['worldControllerGetWorldLevelAudits']>;
type _PasswordLoginArgs = Parameters<RealmGeneratedServiceRegistry['AuthService']['passwordLogin']>;

type _GetMeResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeService']['getMe']>>;
type _UpdateMeResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['MeService']['updateMe']>>;
type _ListMessagesResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['HumanChatService']['listMessages']>>;
type _StartChatResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['HumanChatService']['startChat']>>;
type _WorldDetailResult = Awaited<ReturnType<RealmGeneratedServiceRegistry['WorldsService']['worldControllerGetWorld']>>;

type _GuardListMessagesFirstArg = Assert<_ListMessagesArgs[0] extends string ? true : false>;
type _GuardListMessagesSecondArg = Assert<_ListMessagesArgs[1] extends number | undefined ? true : false>;

type _GuardSyncChatEventsFirstArg = Assert<_SyncChatEventsArgs[0] extends string ? true : false>;
type _GuardSyncChatEventsSecondArg = Assert<_SyncChatEventsArgs[1] extends number | undefined ? true : false>;
type _GuardSyncChatEventsThirdArg = Assert<_SyncChatEventsArgs[2] extends number | undefined ? true : false>;

type _GuardWorldLevelAuditsFirstArg = Assert<_WorldLevelAuditsArgs[0] extends string ? true : false>;
type _GuardWorldLevelAuditsSecondArg = Assert<_WorldLevelAuditsArgs[1] extends number | undefined ? true : false>;

type _GuardPasswordLoginBody = Assert<IsEqual<
  _PasswordLoginArgs[0],
  components['schemas']['PasswordLoginDto']
>>;
type _GuardGetMeResult = Assert<IsEqual<
  _GetMeResult,
  components['schemas']['UserPrivateDto']
>>;
type _GuardUpdateMeResult = Assert<IsEqual<
  _UpdateMeResult,
  components['schemas']['UserPrivateDto']
>>;
type _GuardListMessagesResult = Assert<IsEqual<
  _ListMessagesResult,
  components['schemas']['ListMessagesResultDto']
>>;
type _GuardStartChatResult = Assert<IsEqual<
  _StartChatResult,
  components['schemas']['StartChatResultDto']
>>;
type _GuardWorldDetailResult = Assert<IsEqual<
  _WorldDetailResult,
  components['schemas']['WorldDetailDto']
>>;
