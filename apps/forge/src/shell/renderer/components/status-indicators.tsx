/**
 * Forge Status Indicators — maps domain statuses to kit StatusBadge tones.
 */

import { StatusBadge } from '@nimiplatform/nimi-kit/ui';
import type { StatusTone } from '@nimiplatform/nimi-kit/ui';

/* ------------------------------------------------------------------ */
/*  Status → Tone mapping tables                                       */
/* ------------------------------------------------------------------ */

const DRAFT_STATUS_TONE: Record<string, StatusTone> = {
  DRAFT: 'warning',
  SYNTHESIZE: 'info',
  REVIEW: 'info',
  PUBLISH: 'success',
  FAILED: 'danger',
};

const WORLD_STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  DRAFT: 'warning',
  PENDING_REVIEW: 'info',
  SUSPENDED: 'danger',
  ARCHIVED: 'neutral',
};

const AGENT_STATUS_TONE: Record<string, StatusTone> = {
  ACTIVE: 'success',
  INCUBATING: 'warning',
  READY: 'info',
  SUSPENDED: 'danger',
  FAILED: 'danger',
};

const OWNERSHIP_TONE: Record<string, StatusTone> = {
  MASTER_OWNED: 'info',
  WORLD_OWNED: 'neutral',
};

const WORKSPACE_STATUS_TONE: Record<string, StatusTone> = {
  OVERVIEW: 'neutral',
  WORLD_TRUTH: 'info',
  IMPORT: 'info',
  REVIEW: 'warning',
  AGENTS: 'info',
  PUBLISH: 'success',
  DRAFT: 'warning',
  REVIEWING: 'info',
  READY: 'success',
  FAILED: 'danger',
};

/* ------------------------------------------------------------------ */
/*  ForgeStatusBadge                                                   */
/* ------------------------------------------------------------------ */

export type ForgeBadgeDomain = 'draft' | 'world' | 'agent' | 'ownership' | 'workspace' | 'generic';

const TONE_TABLES: Record<ForgeBadgeDomain, Record<string, StatusTone>> = {
  draft: DRAFT_STATUS_TONE,
  world: WORLD_STATUS_TONE,
  agent: AGENT_STATUS_TONE,
  ownership: OWNERSHIP_TONE,
  workspace: WORKSPACE_STATUS_TONE,
  generic: {},
};

export function ForgeStatusBadge({
  domain,
  status,
  label,
  tone: overrideTone,
  className,
}: {
  domain: ForgeBadgeDomain;
  status: string;
  label?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const resolvedTone = overrideTone ?? TONE_TABLES[domain][status] ?? 'neutral';
  return (
    <StatusBadge tone={resolvedTone} className={className}>
      {label ?? status}
    </StatusBadge>
  );
}
