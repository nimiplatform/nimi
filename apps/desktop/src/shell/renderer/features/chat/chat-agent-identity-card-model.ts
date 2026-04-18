import type { RuntimeAgentInspectSnapshot } from '@renderer/infra/runtime-agent-inspect';

function titleCaseWords(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function formatExecutionStateLabel(value: string | null | undefined): string | null {
  switch (value) {
    case 'chat-active':
      return 'Chat active';
    case 'life-pending':
      return 'Life pending';
    case 'life-running':
      return 'Life running';
    case 'suspended':
      return 'Suspended';
    case 'idle':
      return 'Idle';
    default:
      return value ? titleCaseWords(value.replace(/-/g, ' ')) : null;
  }
}

function formatLifecycleStatusLabel(value: string | null | undefined): string | null {
  switch (value) {
    case 'initializing':
      return 'Initializing';
    case 'suspended':
      return 'Suspended';
    case 'terminating':
      return 'Terminating';
    case 'terminated':
      return 'Terminated';
    case 'active':
      return 'Active';
    default:
      return value ? titleCaseWords(value.replace(/-/g, ' ')) : null;
  }
}

export function resolveAgentIdentityRuntimeStatusLabel(
  runtimeInspect: RuntimeAgentInspectSnapshot | null | undefined,
): string | null {
  if (!runtimeInspect) {
    return null;
  }
  const statusText = String(runtimeInspect.statusText || '').trim();
  if (statusText) {
    return statusText;
  }
  const executionLabel = formatExecutionStateLabel(runtimeInspect.executionState);
  if (executionLabel && runtimeInspect.executionState !== 'idle') {
    return executionLabel;
  }
  return formatLifecycleStatusLabel(runtimeInspect.lifecycleStatus);
}

export function resolveAgentIdentityRuntimeActivityLabel(
  runtimeInspect: RuntimeAgentInspectSnapshot | null | undefined,
): string | null {
  if (!runtimeInspect) {
    return null;
  }
  const executionLabel = formatExecutionStateLabel(runtimeInspect.executionState);
  const lifecycleLabel = formatLifecycleStatusLabel(runtimeInspect.lifecycleStatus);
  const parts = [executionLabel, lifecycleLabel].filter(Boolean) as string[];
  if (!parts.length) {
    return null;
  }
  const uniqueParts = parts.filter((part, index) => parts.indexOf(part) === index);
  const activityLabel = uniqueParts.join(' · ');
  return activityLabel === resolveAgentIdentityRuntimeStatusLabel(runtimeInspect)
    ? null
    : activityLabel;
}

export function resolveAgentIdentityAutonomyModeLabel(
  runtimeInspect: RuntimeAgentInspectSnapshot | null | undefined,
): string | null {
  switch (runtimeInspect?.autonomyMode) {
    case 'off':
      return 'Off';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    default:
      return null;
  }
}
