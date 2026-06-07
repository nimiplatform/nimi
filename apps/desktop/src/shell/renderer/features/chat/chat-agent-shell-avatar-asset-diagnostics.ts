import type { AgentCenterAvatarAssetModule } from './chat-agent-center-avatar-config-types';
import type {
  AgentCenterAvatarAssetValidationResult,
  AgentCenterValidationIssue,
} from './chat-agent-center-local-config';

export type AvatarAssetReadinessStatus = 'ready' | 'checking' | 'missing' | 'invalid';

export type AvatarAssetValidationPresentation = {
  status: AvatarAssetReadinessStatus;
  validationStatus: string;
  selectedAssetId: string | null;
  backendKind: string;
  capabilityProfileRef: string | null;
  message: string | null;
  issueRows: string[];
};

function issueLabel(issue: AgentCenterValidationIssue): string {
  const code = issue.code.trim() || 'AVATAR_ASSET_VALIDATION_ISSUE';
  const path = issue.path?.trim();
  return path ? `${code} @ ${path}` : code;
}

function issueMessage(issue: AgentCenterValidationIssue): string {
  const message = issue.message.trim();
  return message ? `${issueLabel(issue)}: ${message}` : issueLabel(issue);
}

export function buildAvatarAssetValidationPresentation(input: {
  config: AgentCenterAvatarAssetModule | null;
  validation: AgentCenterAvatarAssetValidationResult | null;
  configured: boolean;
  valid: boolean;
  checking: boolean;
}): AvatarAssetValidationPresentation {
  const blockingIssues = input.validation?.errors || [];
  const warningIssues = input.validation?.warnings || [];
  const allIssues = [...blockingIssues, ...warningIssues];
  const capabilityProfileMissing = Boolean(
    input.configured
      && input.validation?.status === 'valid'
      && !input.config?.backend_capability_profile_ref,
  );
  const status: AvatarAssetReadinessStatus = input.valid
    ? 'ready'
    : input.checking
      ? 'checking'
      : input.configured
        ? 'invalid'
        : 'missing';
  let fallbackMessage: string | null = null;
  if (!input.configured) {
    fallbackMessage = 'Import a local Live2D folder or VRM file before opening Avatar.';
  } else if (capabilityProfileMissing) {
    fallbackMessage = 'Backend capability profile evidence is missing. Avatar launch remains blocked until Runtime/Avatar links backend evidence for the selected local asset.';
  } else if (input.validation?.status && input.validation.status !== 'valid') {
    fallbackMessage = `Avatar asset validation status: ${input.validation.status}`;
  }

  return {
    status,
    validationStatus: input.validation?.status || (input.configured ? 'unchecked' : 'selection_missing'),
    selectedAssetId: input.config?.local_avatar_asset_ref || null,
    backendKind: input.config?.backend_kind || 'live2d',
    capabilityProfileRef: input.config?.backend_capability_profile_ref || null,
    message: allIssues[0] ? issueMessage(allIssues[0]) : fallbackMessage,
    issueRows: allIssues.slice(0, 4).map(issueMessage),
  };
}
