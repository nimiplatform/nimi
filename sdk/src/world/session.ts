import { nowIso } from '../internal/utils.js';
import type {
  WorldFixturePackage,
  WorldInspectRenderPlan,
  WorldInspectSession,
} from './types.js';

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function buildSessionId(
  fixture: WorldFixturePackage | null | undefined,
  renderPlan: WorldInspectRenderPlan | null | undefined,
): string {
  const worldId = normalizeString(fixture?.worldId) || normalizeString(renderPlan?.worldId);
  const manifestPath = normalizeString(fixture?.manifestPath) || normalizeString(renderPlan?.manifestPath);
  if (worldId && manifestPath) {
    return `inspect:${worldId}:${manifestPath}`;
  }
  if (worldId) {
    return `inspect:${worldId}`;
  }
  if (manifestPath) {
    return `inspect:${manifestPath}`;
  }
  return 'inspect:ephemeral';
}

export function createInspectWorldSession(input: {
  fixture?: WorldFixturePackage | null;
  renderPlan?: WorldInspectRenderPlan | null;
  attachments?: {
    activityId?: string;
    chatId?: string;
    agentId?: string;
  };
  sessionId?: string;
}): WorldInspectSession {
  const fixture = input.fixture || null;
  const renderPlan = input.renderPlan || null;
  const sessionId = normalizeString(input.sessionId) || buildSessionId(fixture, renderPlan);
  const timestamp = nowIso();
  const lifecycle = renderPlan?.capabilityRequirements.requiresSpzAsset
    && (renderPlan.spzUrl || renderPlan.spzLocalPath)
    ? 'ready'
    : 'degraded';
  return {
    sessionId,
    mode: 'inspect',
    worldId: normalizeString(fixture?.worldId) || normalizeString(renderPlan?.worldId) || undefined,
    manifestPath: normalizeString(fixture?.manifestPath) || normalizeString(renderPlan?.manifestPath) || undefined,
    fixture,
    renderPlan,
    attachments: {
      ...(normalizeString(input.attachments?.activityId) ? { activityId: normalizeString(input.attachments?.activityId) } : {}),
      ...(normalizeString(input.attachments?.chatId) ? { chatId: normalizeString(input.attachments?.chatId) } : {}),
      ...(normalizeString(input.attachments?.agentId) ? { agentId: normalizeString(input.attachments?.agentId) } : {}),
    },
    lifecycle,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export const session = {
  createInspectSession: createInspectWorldSession,
};
