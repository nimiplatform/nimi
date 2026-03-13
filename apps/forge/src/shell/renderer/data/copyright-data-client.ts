/**
 * Copyright Data Client — Forge adapter (FG-COPYRIGHT-001..015)
 *
 * Registrations, licenses, attributions, and infringement reporting.
 * Copyright is deferred from the current Forge scope.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Registrations ───────────────────────────────────────────

export async function createRegistration(_payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function listRegistrations(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function getRegistration(_id: string): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function updateRegistration(_id: string, _payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function revokeRegistration(_id: string): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

// ── Licenses ────────────────────────────────────────────────

export async function createLicense(_payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function listLicenses(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function updateLicense(_id: string, _payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function revokeLicense(_id: string): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

// ── Attributions ────────────────────────────────────────────

export async function listAttributions(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function createAttribution(_payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function updateAttribution(_id: string, _payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

// ── Infringements ───────────────────────────────────────────

export async function submitInfringementReport(_payload: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function listInfringementReports(_params?: Record<string, unknown>): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}

export async function getInfringementReport(_id: string): Promise<unknown> {
  throw new Error('Copyright feature is deferred in the current Forge scope');
}
