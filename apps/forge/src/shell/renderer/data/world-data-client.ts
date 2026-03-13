/**
 * World Data Client — Forge adapter (FG-WORLD-002)
 *
 * Replaces World-Studio's hookClient.data.query() calls with
 * direct SDK realm client calls. Same function signatures as
 * World-Studio's data layer, enabling engine/generation code
 * to work unchanged.
 */

import { getPlatformClient } from '@runtime/platform-client.js';

function realm() {
  return getPlatformClient().realm;
}

// ── Draft Queries ──────────────────────────────────────────

export async function getMyWorldAccess() {
  return realm().worlds.worldControlControllerGetMyAccess();
}

export async function resolveWorldLanding() {
  return realm().worlds.worldControlControllerResolveLanding();
}

export async function createWorldDraft(payload: Record<string, unknown>) {
  return realm().worlds.worldControlControllerCreateDraft(payload);
}

export async function getWorldDraft(draftId: string) {
  return realm().worlds.worldControlControllerGetDraft(draftId);
}

export async function listWorldDrafts() {
  return realm().worlds.worldControlControllerListDrafts();
}

export async function updateWorldDraft(draftId: string, patch: Record<string, unknown>) {
  return realm().worlds.worldControlControllerUpdateDraft(draftId, patch);
}

export async function publishWorldDraft(draftId: string, payload?: Record<string, unknown>) {
  return realm().worlds.worldControlControllerPublishDraft(draftId, payload || {});
}

// ── Maintenance Queries ────────────────────────────────────

export async function getWorldMaintenance(worldId: string) {
  return realm().worlds.worldControlControllerGetMaintenance(worldId);
}

export async function updateWorldMaintenance(worldId: string, patch: Record<string, unknown>) {
  return realm().worlds.worldControlControllerUpdateMaintenance(worldId, patch);
}

export async function listMyWorlds() {
  return realm().worlds.worldControlControllerListMyWorlds();
}

export async function listWorldMutations(worldId: string) {
  return realm().worlds.worldControlControllerListWorldMutations(worldId);
}

// ── Events & Lorebooks ─────────────────────────────────────

export async function listWorldEvents(worldId: string) {
  return realm().worlds.worldControlControllerListWorldEvents(worldId);
}

export async function batchUpsertWorldEvents(worldId: string, payload: Record<string, unknown>) {
  return realm().worlds.worldControlControllerBatchUpsertWorldEvents(worldId, payload);
}

export async function deleteWorldEvent(worldId: string, eventId: string) {
  return realm().worlds.worldControlControllerDeleteWorldEvent(worldId, eventId);
}

export async function listWorldLorebooks(worldId: string) {
  return realm().worlds.worldControlControllerListWorldLorebooks(worldId);
}

export async function batchUpsertWorldLorebooks(worldId: string, payload: Record<string, unknown>) {
  return realm().worlds.worldControlControllerBatchUpsertWorldLorebooks(worldId, payload);
}

export async function deleteWorldLorebook(worldId: string, lorebookId: string) {
  return realm().worlds.worldControlControllerDeleteWorldLorebook(worldId, lorebookId);
}

// ── Visual Bindings ────────────────────────────────────────

export async function listWorldMediaBindings(worldId: string, query?: Record<string, unknown>) {
  return realm().worlds.worldControlControllerListWorldMediaBindings(worldId, query?.take as number | undefined, query?.slot as string | undefined);
}

export async function batchUpsertWorldMediaBindings(worldId: string, payload: Record<string, unknown>) {
  return realm().worlds.worldControlControllerBatchUpsertWorldMediaBindings(worldId, payload);
}

export async function deleteWorldMediaBinding(worldId: string, bindingId: string) {
  return realm().worlds.worldControlControllerDeleteWorldMediaBinding(worldId, bindingId);
}

// ── Creator Agents ─────────────────────────────────────────

export async function listCreatorAgents() {
  return realm().services.CreatorService.creatorControllerListAgents();
}

export async function createCreatorAgent(payload: Record<string, unknown>) {
  return realm().services.CreatorService.creatorControllerCreateAgent(payload);
}

export async function batchCreateCreatorAgents(payload: {
  items: Array<Record<string, unknown>>;
  continueOnError?: boolean;
}) {
  return realm().services.CreatorService.creatorControllerBatchCreateAgents(payload);
}

// ── Additional Queries (Narrative / Scenes) ────────────────

export async function listWorldNarrativeContexts(worldId: string, params?: Record<string, unknown>) {
  return realm().worlds.worldControlControllerListWorldNarrativeContexts(
    worldId,
    params?.take as number | undefined,
    params?.targetSubjectId as string | undefined,
  );
}

export async function listWorldScenes(worldId: string, params?: Record<string, unknown>) {
  return realm().worlds.worldControlControllerListWorldScenes(
    worldId,
    params?.take as number | undefined,
    params?.sceneIds as string[] | undefined,
  );
}
