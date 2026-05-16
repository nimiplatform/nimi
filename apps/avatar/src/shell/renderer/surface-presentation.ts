import type { AvatarAppState } from './app-shell/app-store.js';

export type SurfaceTone = 'loading' | 'ready' | 'degraded' | 'error';

export type SurfacePresentation = {
  tone: SurfaceTone;
  badge: string;
  title: string;
  summary: string;
  recovery: string;
  accent: string;
  stageLabel: string;
  stageValue: string;
  meta: Array<{ label: string; value: string }>;
  contextCards: Array<{ label: string; value: string }>;
};

type DeriveSurfacePresentationInput = {
  bootstrapError: string | null;
  bootstrapComplete: boolean;
  shell: AvatarAppState['shell'];
  model: AvatarAppState['model'];
  driver: AvatarAppState['driver'];
  consume: AvatarAppState['consume'];
  runtimeBinding: AvatarAppState['runtime']['binding'];
  launchContext: AvatarAppState['launch']['context'];
  bundle: AvatarAppState['bundle'];
};

function normalizeMessage(value: string | null): string {
  return String(value || '').trim();
}

function toSentenceCase(value: string): string {
  const normalized = normalizeMessage(value);
  if (!normalized) {
    return 'Unavailable';
  }
  const withSpaces = normalized.replaceAll('_', ' ').toLowerCase();
  return withSpaces.charAt(0).toUpperCase() + withSpaces.slice(1);
}

function shortenId(value: string | null | undefined): string {
  const normalized = normalizeMessage(value ?? null);
  if (!normalized) {
    return 'Unavailable';
  }
  return normalized.length > 14
    ? `${normalized.slice(0, 8)}…${normalized.slice(-4)}`
    : normalized;
}

function formatRuntimeBindingReason(reason: string): {
  label: string;
  recovery: string;
} | null {
  const lowered = reason.toLowerCase();
  if (lowered.includes('runtime_daemon_prepare') || lowered.includes('runtime_bridge_daemon')) {
    return {
      label: 'Local Runtime daemon is not ready',
      recovery: 'Restore the local Runtime daemon, then relaunch this surface from desktop.',
    };
  }
  if (lowered.includes('account_session_unavailable')
    || lowered.includes('account_session_status')
    || lowered.includes('runtime_account_session_unavailable')) {
    return {
      label: 'Runtime account session is not authenticated',
      recovery: 'Sign in through the desktop account flow, then relaunch this surface.',
    };
  }
  if (lowered.includes('account_access_token')
    || lowered.includes('runtime_account_access_token_unavailable')) {
    return {
      label: 'Runtime declined to issue an access token',
      recovery: 'Re-authenticate from the desktop account flow, then relaunch this surface.',
    };
  }
  if (lowered.includes('runtime_scoped_binding')
    || lowered.includes('app_grant_invalid')
    || lowered.includes('attach_active_scoped_runtime_binding')
    || lowered.includes('check_runtime_scoped_binding_admission')) {
    return {
      label: 'Runtime rejected the avatar scoped binding',
      recovery: 'Confirm Runtime authorization for this avatar app, then relaunch this surface.',
    };
  }
  if (lowered.includes('conversation_context')) {
    return {
      label: 'Runtime did not return a conversation anchor',
      recovery: 'Check the agent and Runtime anchor service, then relaunch this surface.',
    };
  }
  if (lowered.includes('avatar_package_manifest')) {
    return {
      label: 'Avatar package manifest is not available',
      recovery: 'Verify the agent visual package, then relaunch this surface.',
    };
  }
  if (lowered.includes('driver_create') || lowered.includes('driver_start')) {
    return {
      label: 'Runtime driver failed to start',
      recovery: 'Inspect the Runtime daemon logs, then relaunch this surface.',
    };
  }
  return null;
}

function unavailableMeta(anchor: string, carrier: string): Array<{ label: string; value: string }> {
  return [
    { label: 'Presence', value: 'Unavailable' },
    { label: 'Posture', value: 'Unavailable' },
    { label: 'Anchor', value: anchor },
    { label: 'Carrier', value: carrier },
  ];
}

function classifyBootstrapError(error: string): {
  badge: string;
  title: string;
  summary: string;
  recovery: string;
  accent: string;
} {
  const lowered = error.toLowerCase();
  if (lowered.includes('launch context')) {
    return {
      badge: 'Launch required',
      title: 'Launch from desktop',
      summary: 'This companion only opens from an explicit desktop handoff. No standalone agent fallback was used.',
      recovery: 'Start the avatar again from the desktop orchestrator.',
      accent: 'Handoff required',
    };
  }
  if (
    lowered.includes('app_grant_invalid')
    || lowered.includes('attach_active_scoped_runtime_binding')
    || lowered.includes('principal_unauthorized')
    || lowered.includes('check_request_and_app_auth')
  ) {
    return {
      badge: 'Runtime unavailable',
      title: 'Runtime authorization blocked',
      summary: 'The runtime interaction path rejected this avatar request. The visual embodiment stays local and does not switch to mock mode.',
      recovery: 'Re-establish Runtime app authorization from desktop, then relaunch this surface.',
      accent: 'Runtime auth blocked',
    };
  }
  if (lowered.includes('daemon') || lowered.includes('runtime') || lowered.includes('driver_start')) {
    return {
      badge: 'Runtime unavailable',
      title: 'Runtime connection blocked',
      summary: 'The runtime interaction path was unavailable. The visual embodiment stays local and does not switch to mock mode.',
      recovery: 'Restore the runtime daemon, then launch again from desktop.',
      accent: 'Runtime blocked',
    };
  }
  return {
    badge: 'Surface unavailable',
    title: 'Avatar surface unavailable',
    summary: 'The companion shell stopped before it could establish a trusted ready state.',
    recovery: 'Return to desktop, correct the issue, and relaunch this surface.',
    accent: 'Startup blocked',
  };
}

export function deriveSurfacePresentation(
  input: DeriveSurfacePresentationInput,
): SurfacePresentation {
  const bundleActivity = normalizeMessage(input.bundle?.activity?.name ?? null);
  const statusText = normalizeMessage(input.bundle?.status_text ?? null);
  const executionState = toSentenceCase(input.bundle?.execution_state ?? '');
  const postureFamily = normalizeMessage(input.bundle?.posture.action_family ?? null);
  const readyPresence = bundleActivity || statusText || executionState;
  const readyPosture = postureFamily || 'Unavailable';
  const anchorId = normalizeMessage(input.consume.conversationAnchorId ?? null);
  const fixtureId = normalizeMessage(input.consume.fixtureId ?? null) || 'default';

  if (input.bootstrapError) {
    const failure = classifyBootstrapError(input.bootstrapError);
    return {
      tone: 'error',
      badge: failure.badge,
      title: failure.title,
      summary: failure.summary,
      recovery: failure.recovery,
      accent: failure.accent,
      stageLabel: 'Startup state',
      stageValue: failure.accent,
      meta: unavailableMeta('Not ready', failure.badge === 'Runtime unavailable' ? 'Runtime unavailable' : 'Unavailable'),
      contextCards: [],
    };
  }

  if (!input.bootstrapComplete) {
    const waitingForLaunch = !input.launchContext;
    const stageValue = !input.shell.shellReady
      ? 'Preparing shell'
      : input.driver.status === 'starting'
        ? 'Starting runtime link'
        : input.launchContext
          ? 'Preparing launch'
          : 'Waiting for desktop handoff';
    return {
      tone: 'loading',
      badge: 'Warming up',
      title: 'Preparing your desktop companion',
      summary: 'The local visual package is loading while the first-party Runtime path is prepared from the desktop handoff.',
      recovery: 'Keep this surface open while Runtime prepares the live companion path.',
      accent: stageValue,
      stageLabel: 'Bring-up',
      stageValue,
      meta: unavailableMeta(
        waitingForLaunch ? 'Pending handoff' : 'Not ready',
        input.driver.status === 'starting' ? 'Preparing Runtime' : 'Not ready',
      ),
      contextCards: [],
    };
  }

  if (input.model.loadState === 'error') {
    return {
      tone: 'degraded',
      badge: 'Model blocked',
      title: 'Embodiment surface paused',
      summary: normalizeMessage(input.model.error) || 'The embodiment layer failed after shell bootstrap completed.',
      recovery: 'Reload the avatar from desktop after the model package is healthy again.',
      accent: 'Model unavailable',
      stageLabel: 'Model state',
      stageValue: 'Unavailable',
      meta: unavailableMeta('Unavailable', 'Surface blocked'),
      contextCards: [],
    };
  }

  if (input.consume.authority === 'fixture') {
    return {
      tone: 'ready',
      badge: 'Fixture mode',
      title: 'Fixture companion ready',
      summary: statusText || 'This shell is running from an explicit fixture scenario, not a live desktop bind.',
      recovery: 'Fixture mode stays isolated from launch and runtime truth.',
      accent: readyPresence,
      stageLabel: 'Fixture cue',
      stageValue: readyPresence,
      meta: [
        { label: 'Presence', value: readyPresence },
        { label: 'Posture', value: readyPosture },
        { label: 'Anchor', value: 'Not bound' },
        { label: 'Carrier', value: `Fixture surface (${fixtureId})` },
      ],
      contextCards: [
        { label: 'Presence script', value: readyPresence },
        { label: 'Operator scope', value: 'Not bound' },
      ],
    };
  }

  if (input.runtimeBinding.status !== 'active') {
    const reason = normalizeMessage(input.runtimeBinding.reason);
    const mapped = reason ? formatRuntimeBindingReason(reason) : null;
    const summaryReason = mapped
      ? ` ${mapped.label}.`
      : reason ? ` Reason: ${toSentenceCase(reason)}.` : '';
    const recovery = mapped
      ? mapped.recovery
      : 'Sign in through the Runtime-backed desktop account flow or restore Runtime, then relaunch from desktop.';
    const stageValue = mapped
      ? mapped.label
      : reason ? toSentenceCase(reason) : toSentenceCase(input.runtimeBinding.status);
    return {
      tone: 'degraded',
      badge: 'Runtime unavailable',
      title: 'Interaction unavailable',
      summary: `The visual embodiment is present, but the first-party Runtime interaction path is not ready.${summaryReason}`,
      recovery,
      accent: `Runtime ${input.runtimeBinding.status}`,
      stageLabel: 'Runtime state',
      stageValue,
      meta: unavailableMeta(anchorId ? `Not ready (${shortenId(anchorId)})` : 'Not ready', 'Runtime unavailable'),
      contextCards: [],
    };
  }

  if (input.driver.status === 'error' || input.driver.status === 'stopped') {
    return {
      tone: 'degraded',
      badge: 'Connection paused',
      title: 'Interaction unavailable',
      summary: 'The visual embodiment is present, but the first-party Runtime interaction path is currently paused.',
      recovery: 'Relaunch from desktop once the runtime path is healthy.',
      accent: input.driver.status === 'error' ? 'Driver error' : 'Driver stopped',
      stageLabel: 'Driver state',
      stageValue: input.driver.status,
      meta: unavailableMeta(anchorId ? `Not ready (${shortenId(anchorId)})` : 'Not ready', input.driver.status === 'error' ? 'Driver error' : 'Runtime unavailable'),
      contextCards: [],
    };
  }

  const readyAccent = readyPresence;
  const agentValue = shortenId(input.consume.agentId || input.launchContext?.agentId);
  return {
    tone: 'ready',
    badge: 'Live companion',
    title: 'Desktop companion ready',
    summary: statusText
      || 'Present on the desktop and ready to continue on the current anchor.',
    recovery: `Ready for agent ${agentValue} through the current desktop launch context.`,
    accent: readyAccent,
    stageLabel: 'Presence',
    stageValue: readyAccent,
    meta: [
      { label: 'Presence', value: executionState },
      { label: 'Posture', value: readyPosture },
      { label: 'Anchor', value: anchorId ? `Ready (${shortenId(anchorId)})` : 'Unavailable' },
      { label: 'Carrier', value: 'Runtime IPC' },
    ],
    contextCards: [
      { label: 'Current presence', value: readyPresence },
      { label: 'Runtime path', value: anchorId ? `Ready (${shortenId(anchorId)})` : 'Ready' },
    ],
  };
}
