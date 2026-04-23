import type { ImageGenEntityContext } from '@renderer/data/image-gen-client.js';
import type {
  ForgeWorkspacePanel,
  ForgeWorkspaceSnapshot,
} from '@renderer/features/workbench/types.js';
import {
  type WorkbenchCanonicalPublishContext,
  resolveWorkbenchAgentPublishAssets,
  resolveWorkbenchWorldPublishAssets,
} from './workbench-asset-publish.js';

export type WorkbenchPanel = ForgeWorkspacePanel;
export type WorkbenchPageSnapshot = ForgeWorkspaceSnapshot;

export const PANELS: WorkbenchPanel[] = [
  'OVERVIEW',
  'WORLD_TRUTH',
  'ENRICHMENT',
  'IMPORT',
  'REVIEW',
  'AGENTS',
  'PUBLISH',
];

export const VISUAL_PHASE_LABELS: Record<string, string> = {
  composing_prompt: 'Composing prompt...',
  generating: 'Generating...',
  uploading: 'Uploading...',
  binding: 'Binding...',
};

export function buildWorkbenchWorldImageContext(
  snapshot: WorkbenchPageSnapshot,
  visualPrompt: string,
  target: 'world-banner' | 'world-icon',
): ImageGenEntityContext {
  return {
    target,
    worldName: snapshot.worldDraft.name || snapshot.workspace.title || '',
    worldDescription: snapshot.worldDraft.description || '',
    userPrompt: visualPrompt.trim() || undefined,
  };
}

export function isWorkbenchReviewReady(snapshot: WorkbenchPageSnapshot): boolean {
  return !snapshot.reviewState.hasPendingConflicts
    && !snapshot.reviewState.hasUnmappedCharacters
    && (
      snapshot.reviewState.agentBundles.length > 0
      || snapshot.reviewState.worldRules.length > 0
      || Boolean(snapshot.worldDraft.worldId)
    );
}

export function buildWorkbenchCompletenessIssues(input: {
  snapshot: WorkbenchPageSnapshot;
  userId?: string | null;
  publishContext?: WorkbenchCanonicalPublishContext;
  worldAssetsLoading?: boolean;
  worldAssetsFailed?: boolean;
  agentRosterLoading?: boolean;
  agentRosterFailed?: boolean;
}): string[] {
  const { snapshot } = input;
  const issues: string[] = [];
  if (!snapshot.worldDraft.tagline.trim()) issues.push('World tagline is required.');
  if (!snapshot.worldDraft.description.trim()) issues.push('World description is required.');
  if (!snapshot.worldDraft.genre.trim()) issues.push('World genre is required.');
  if (snapshot.worldDraft.themes.length === 0) issues.push('At least one world theme is required.');
  if (snapshot.worldDraft.worldId && input.worldAssetsLoading) {
    issues.push('Canonical world asset completeness is still loading.');
  } else if (snapshot.worldDraft.worldId && input.worldAssetsFailed) {
    issues.push('Canonical world asset completeness could not be loaded.');
  } else {
    issues.push(...resolveWorkbenchWorldPublishAssets({
      worldDraft: snapshot.worldDraft,
      context: input.publishContext,
    }).issues);
  }

  if (snapshot.worldDraft.worldId && input.agentRosterFailed) {
    issues.push('Canonical world-owned agent completeness could not be loaded.');
  }

  Object.values(snapshot.agentDrafts)
    .filter((draft) => draft.ownershipType === 'WORLD_OWNED')
    .forEach((draft) => {
      if (!draft.description.trim()) issues.push(`${draft.displayName}: description is required.`);
      if (!draft.scenario.trim()) issues.push(`${draft.displayName}: scenario is required.`);
      if (snapshot.worldDraft.worldId && input.agentRosterLoading) {
        return;
      }
      if (snapshot.worldDraft.worldId && input.agentRosterFailed) {
        return;
      }
      issues.push(...resolveWorkbenchAgentPublishAssets({
        userId: input.userId,
        agentDraft: draft,
        context: input.publishContext,
      }).issues);
    });

  return issues;
}
