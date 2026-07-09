import type { AgentConversationAnchorBinding } from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/types';
import type { NimiRuntimeAgentSmokeProductPathEvidence } from '@nimiplatform/sdk/runtime';

export type { JsonObject };

export const SMOKE_STEP_TIMEOUT_MS = 15000;
export const SMOKE_BOOTSTRAP_TIMEOUT_MS = 60000;
export const SMOKE_SCENARIO_TIMEOUT_MS = 150000;

export type DesktopMacosSmokeDriverDeps = {
  waitForTestId: (id: string, timeoutMs?: number) => Promise<void>;
  waitForSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  waitForSelectorEnabled: (selector: string, timeoutMs?: number) => Promise<void>;
  waitForSelectorGone: (selector: string, timeoutMs?: number) => Promise<void>;
  clickByTestId: (id: string, timeoutMs?: number) => Promise<void>;
  clickSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  setValueBySelector: (selector: string, value: string, timeoutMs?: number) => Promise<void>;
  verifyRuntimeAccountProjection: () => Promise<void>;
  readAgentConversationAnchorBinding: (localAgentRef: string) => Promise<AgentConversationAnchorBinding | null>;
  clearAgentConversationAnchorBindings: () => Promise<void>;
  configureRuntimeTextRoute: () => Promise<void>;
  verifyRuntimeConversationAnchor: (input: {
    localAgentRef: string;
    ownerUserId: string;
    runtimeSourceRef: string;
    conversationAnchorId: string;
  }) => Promise<void>;
  readRuntimeProductPathEvidence: (input: {
    localAgentRef: string;
    ownerUserId: string;
    runtimeSourceRef: string;
    conversationAnchorId: string;
  }) => Promise<NimiRuntimeAgentSmokeProductPathEvidence>;
  readTextByTestId: (id: string) => Promise<string>;
  readAttributeByTestId: (id: string, name: string) => Promise<string | null>;
  onStepStart?: (step: string, steps: readonly string[]) => void;
  isReportOpen?: () => boolean;
  writeReport: (payload: DesktopMacosSmokeReportPayload) => Promise<void>;
  currentRoute: () => string;
  currentHtml: () => string;
};

export type DesktopMacosSmokeReportPayload = {
  ok: boolean;
  failedStep?: string;
  steps: string[];
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
  route?: string;
  htmlSnapshot?: string;
  details?: JsonObject;
};

export type DesktopMacosSmokeFailureReportPayload = DesktopMacosSmokeReportPayload & {
  ok: false;
  failedStep: string;
  errorMessage: string;
  route: string;
  htmlSnapshot: string;
};

function currentRouteSnapshot(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function currentHtmlSnapshot(): string {
  return document.documentElement.outerHTML;
}

export function buildDesktopMacosSmokeFailureReportPayload(input: {
  failedStep: string;
  message: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
  steps?: readonly string[];
}): DesktopMacosSmokeFailureReportPayload {
  return {
    ok: false,
    failedStep: input.failedStep,
    steps: input.steps?.length ? [...input.steps] : [input.failedStep],
    errorMessage: input.message,
    errorName: input.errorName,
    errorStack: input.errorStack,
    errorCause: input.errorCause,
    route: currentRouteSnapshot(),
    htmlSnapshot: currentHtmlSnapshot(),
  };
}

export function shouldStartDesktopMacosSmoke(input: {
  bootstrapReady: boolean;
  context: DesktopMacosSmokeContext | null;
  alreadyStarted: boolean;
}): boolean {
  return input.bootstrapReady
    && !input.alreadyStarted
    && Boolean(input.context?.enabled)
    && Boolean(input.context?.scenarioId);
}
