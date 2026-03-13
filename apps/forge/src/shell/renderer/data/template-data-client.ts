/**
 * Template Data Client — Forge adapter (FG-TEMPLATE-001..008)
 *
 * World template browsing, creation, forking, and rating.
 * Template workflows are deferred from the current Forge scope.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Templates ───────────────────────────────────────────────

export async function createTemplate(_payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function browseTemplates(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function listMyTemplates(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function getTemplate(_id: string): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function updateTemplate(_id: string, _payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function archiveTemplate(_id: string): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function forkTemplate(_id: string): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}

export async function rateTemplate(_id: string, _payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Template marketplace is deferred in the current Forge scope');
}
