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
  if (lowered.includes('daemon') || lowered.includes('runtime')) {
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
  const anchorId = normalizeMessage(input.consume.conversationAnchorId ?? input.launchContext?.conversationAnchorId ?? null);
  const fixtureId = normalizeMessage(input.consume.fixtureId ?? null) || 'default';

  if (input.bootstrapError && input.model.loadState !== 'loaded') {
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
      badge: 'Warming up',
      title: 'Preparing your desktop companion',
      summary: 'The local visual package is loading while the runtime binding is prepared through the desktop handoff.',
      recovery: 'Keep this surface open while desktop finalizes the live companion bind.',
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
	    return {
	      tone: 'degraded',
	      badge: 'Binding unavailable',
	      title: 'Interaction unavailable',
	      summary: `The visual embodiment is present, but the runtime interaction stream is not currently bound because the scoped binding is ${input.runtimeBinding.status}.`,
	      recovery: 'Relaunch from desktop once the runtime binding is available.',
	      accent: `Binding ${input.runtimeBinding.status}`,
	      stageLabel: 'Binding state',
	      stageValue: input.runtimeBinding.status,
	      meta: unavailableMeta(anchorId ? `Not bound (${shortenId(anchorId)})` : 'Not bound', 'Runtime unavailable'),
	      contextCards: [],
	    };
	  }

	  if (input.driver.status === 'error' || input.driver.status === 'stopped') {
    return {
      tone: 'degraded',
      badge: 'Connection paused',
      title: 'Interaction unavailable',
      summary: 'The visual embodiment is present, but the runtime interaction stream is not currently bound.',
      recovery: 'Relaunch from desktop once the runtime path is healthy.',
      accent: input.driver.status === 'error' ? 'Driver error' : 'Driver stopped',
      stageLabel: 'Driver state',
      stageValue: input.driver.status,
      meta: unavailableMeta(anchorId ? `Not bound (${shortenId(anchorId)})` : 'Not bound', input.driver.status === 'error' ? 'Driver error' : 'Runtime unavailable'),
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
    recovery: `Bound to agent ${agentValue} through the current desktop launch context.`,
    accent: readyAccent,
    stageLabel: 'Presence',
    stageValue: readyAccent,
    meta: [
      { label: 'Presence', value: executionState },
      { label: 'Posture', value: readyPosture },
      { label: 'Anchor', value: anchorId ? `Bound (${shortenId(anchorId)})` : 'Unavailable' },
      { label: 'Carrier', value: 'Runtime IPC' },
    ],
    contextCards: [
      { label: 'Current presence', value: readyPresence },
      { label: 'Runtime binding', value: anchorId ? `Bound (${shortenId(anchorId)})` : 'Bound' },
    ],
  };
}
