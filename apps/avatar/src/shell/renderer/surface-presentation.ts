import type {
  AvatarAppState,
  AvatarAuthFailureReason,
} from './app-shell/app-store.js';

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
  auth: AvatarAppState['auth'];
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

function unavailableMeta(anchor: string, carrier: string): Array<{ label: string; value: string }> {
  return [
    { label: 'Presence', value: 'Unavailable' },
    { label: 'Posture', value: 'Unavailable' },
    { label: 'Anchor', value: anchor },
    { label: 'Carrier', value: carrier },
  ];
}

function humanizeAuthFailure(reason: AvatarAuthFailureReason | null): {
  title: string;
  summary: string;
  recovery: string;
  accent: string;
} {
  switch (reason) {
    case 'shared_session_missing':
      return {
        title: 'Desktop session ended',
        summary: 'The shared desktop session disappeared, so the avatar stopped its authenticated runtime path.',
        recovery: 'Reopen the avatar from desktop after signing in again.',
        accent: 'Session missing',
      };
    case 'shared_session_invalid':
      return {
        title: 'Session verification failed',
        summary: 'The shared desktop session is no longer valid for a trusted runtime binding.',
        recovery: 'Refresh your desktop session and relaunch this companion surface.',
        accent: 'Session invalid',
      };
    case 'shared_session_realm_mismatch':
      return {
        title: 'Desktop realm changed',
        summary: 'The current desktop session no longer matches the runtime realm used by this avatar surface.',
        recovery: 'Return to desktop, confirm the active realm, then relaunch the avatar.',
        accent: 'Realm changed',
      };
    case 'shared_session_user_mismatch':
      return {
        title: 'Desktop user changed',
        summary: 'The avatar stopped because the shared desktop session switched to a different user.',
        recovery: 'Launch a fresh avatar instance for the active desktop user.',
        accent: 'User changed',
      };
    default:
      return {
        title: 'Companion paused',
        summary: 'The companion surface is paused until desktop trust is restored.',
        recovery: 'Return to desktop and relaunch when the session is healthy again.',
        accent: 'Paused',
      };
  }
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
      summary: 'This avatar surface only opens from an explicit desktop handoff. No standalone agent fallback was used.',
      recovery: 'Start the avatar again from the desktop orchestrator.',
      accent: 'Handoff required',
    };
  }
  if (lowered.includes('auth') || lowered.includes('session')) {
    return {
      badge: 'Session required',
      title: 'Desktop session required',
      summary: 'The avatar could not establish a valid shared desktop session, so runtime consume stayed fail-closed.',
      recovery: 'Sign in from desktop and relaunch the avatar.',
      accent: 'Auth blocked',
    };
  }
  if (lowered.includes('daemon') || lowered.includes('runtime')) {
    return {
      badge: 'Runtime unavailable',
      title: 'Runtime connection blocked',
      summary: 'The avatar did not switch to mock mode. The real runtime path was unavailable, so startup stopped.',
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
  const boundOperator = normalizeMessage(input.auth.user?.displayName ?? null)
    || normalizeMessage(input.auth.user?.id ?? null)
    || 'Unavailable';
  const anchorId = normalizeMessage(input.consume.conversationAnchorId ?? input.launchContext?.conversationAnchorId ?? null);
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
      meta: unavailableMeta('Not bound', failure.badge === 'Runtime unavailable' ? 'Runtime unavailable' : 'Unavailable'),
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
          ? 'Binding launch'
          : 'Waiting for desktop handoff';
    return {
      tone: 'loading',
      badge: 'Booting',
      title: 'Preparing your desktop companion',
      summary: 'The avatar shell is coming online with a trusted launch handoff and runtime binding.',
      recovery: 'Keep this surface open while desktop finalizes the companion session.',
      accent: stageValue,
      stageLabel: 'Bring-up',
      stageValue,
      meta: unavailableMeta(
        waitingForLaunch ? 'Pending handoff' : 'Not bound',
        input.driver.status === 'starting' ? 'Binding runtime' : 'Not bound',
      ),
      contextCards: [],
    };
  }

  if (input.model.loadState === 'error') {
    return {
      tone: 'degraded',
      badge: 'Model blocked',
      title: 'Embodiment surface paused',
      summary: normalizeMessage(input.model.error) || 'The embodiment surface failed after shell bootstrap completed.',
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
      summary: statusText || 'This surface is running from an explicit fixture scenario, not a live desktop bind.',
      recovery: 'Fixture mode stays isolated from launch, auth, and runtime truth.',
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

  if (input.consume.authority === 'runtime' && input.auth.status !== 'authenticated') {
    const failure = humanizeAuthFailure(input.auth.failureReason);
    return {
      tone: 'degraded',
      badge: failure.accent,
      title: failure.title,
      summary: failure.summary,
      recovery: failure.recovery,
      accent: failure.accent,
      stageLabel: 'Trust state',
      stageValue: failure.accent,
      meta: unavailableMeta('Not bound', 'Binding closed'),
      contextCards: [],
    };
  }

  if (input.driver.status === 'error' || input.driver.status === 'stopped') {
    return {
      tone: 'degraded',
      badge: 'Connection paused',
      title: 'Companion stream paused',
      summary: 'The shell is still present, but the live companion stream is not currently running.',
      recovery: 'Relaunch from desktop once the runtime path is healthy.',
      accent: input.driver.status === 'error' ? 'Driver error' : 'Driver stopped',
      stageLabel: 'Driver state',
      stageValue: input.driver.status,
      meta: unavailableMeta('Unavailable', input.driver.status === 'error' ? 'Driver error' : 'Driver stopped'),
      contextCards: [],
    };
  }

  const readyAccent = readyPresence;
  const agentValue = shortenId(input.consume.agentId || input.launchContext?.agentId);
  return {
    tone: 'ready',
    badge: 'Live runtime',
    title: 'Desktop companion ready',
    summary: statusText
      || 'The avatar surface is pinned, transparent, and ready to stay present on the desktop.',
    recovery: `Bound to agent ${agentValue} with a trusted desktop launch context.`,
    accent: readyAccent,
    stageLabel: 'Presence cue',
    stageValue: readyAccent,
    meta: [
      { label: 'Presence', value: executionState },
      { label: 'Posture', value: readyPosture },
      { label: 'Anchor', value: anchorId ? `Bound (${shortenId(anchorId)})` : 'Unavailable' },
      { label: 'Carrier', value: 'Runtime bound' },
    ],
    contextCards: [
      { label: 'Current presence', value: readyPresence },
      { label: 'Bound operator', value: boundOperator },
    ],
  };
}
