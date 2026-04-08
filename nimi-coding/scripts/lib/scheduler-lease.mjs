import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import YAML from 'yaml';
import {
  ensureDir,
  exists,
  loadYamlFile,
  normalizeRel,
  timestampNow,
} from './doc-utils.mjs';

export const DEFAULT_SCHEDULER_LEASE_TTL_MS = 60 * 60 * 1000;

export const SCHEDULER_REFUSAL_CODES = Object.freeze({
  SCHEDULER_PREREQUISITES_MISSING: 'SCHEDULER_PREREQUISITES_MISSING',
  SCHEDULER_LEASE_ACTIVE: 'SCHEDULER_LEASE_ACTIVE',
  SCHEDULER_LEASE_INVALID: 'SCHEDULER_LEASE_INVALID',
  SCHEDULER_RUNTIME_FAILED: 'SCHEDULER_RUNTIME_FAILED',
  RUN_TERMINAL: 'RUN_TERMINAL',
  RUN_BLOCKED: 'RUN_BLOCKED',
  STATE_PRECONDITION_FAILED: 'STATE_PRECONDITION_FAILED',
});

function safeTopicKey(topicId) {
  return String(topicId || '').replace(/[^A-Za-z0-9._-]+/gu, '_');
}

function toEpochMs(value) {
  const epochMs = Date.parse(String(value || ''));
  return Number.isFinite(epochMs) ? epochMs : null;
}

function buildRefusal(code, message, details = {}) {
  return {
    code,
    message,
    details,
  };
}

function normalizeLeaseDoc(leaseDoc, leaseRef, now) {
  const errors = [];
  if (!leaseDoc || typeof leaseDoc !== 'object' || Array.isArray(leaseDoc)) {
    errors.push('scheduler lease file must contain a YAML mapping');
  }
  for (const key of ['topic_id', 'run_id', 'holder_id', 'acquired_at', 'expires_at']) {
    if (!leaseDoc?.[key] || typeof leaseDoc[key] !== 'string') {
      errors.push(`scheduler lease missing string field: ${key}`);
    }
  }
  if (leaseDoc?.updated_at !== undefined && typeof leaseDoc.updated_at !== 'string') {
    errors.push('scheduler lease updated_at must be a string when present');
  }

  const acquiredAtMs = toEpochMs(leaseDoc?.acquired_at);
  const expiresAtMs = toEpochMs(leaseDoc?.expires_at);
  const updatedAtMs = leaseDoc?.updated_at ? toEpochMs(leaseDoc.updated_at) : null;
  const nowMs = toEpochMs(now);
  if (acquiredAtMs === null) {
    errors.push('scheduler lease acquired_at must be a valid timestamp');
  }
  if (expiresAtMs === null) {
    errors.push('scheduler lease expires_at must be a valid timestamp');
  }
  if (leaseDoc?.updated_at && updatedAtMs === null) {
    errors.push('scheduler lease updated_at must be a valid timestamp');
  }
  if (acquiredAtMs !== null && expiresAtMs !== null && expiresAtMs <= acquiredAtMs) {
    errors.push('scheduler lease expires_at must be after acquired_at');
  }

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_LEASE_INVALID,
        'scheduler lease file is malformed',
        { lease_ref: leaseRef },
      ),
    };
  }

  const stale = nowMs !== null && expiresAtMs !== null ? expiresAtMs <= nowMs : false;
  return {
    ok: true,
    errors: [],
    lease: {
      contract: 'scheduler-lease.v1',
      topic_id: String(leaseDoc.topic_id),
      run_id: String(leaseDoc.run_id),
      holder_id: String(leaseDoc.holder_id),
      acquired_at: String(leaseDoc.acquired_at),
      updated_at: leaseDoc.updated_at ? String(leaseDoc.updated_at) : String(leaseDoc.acquired_at),
      expires_at: String(leaseDoc.expires_at),
    },
    lease_ref: leaseRef,
    stale,
    active: !stale,
  };
}

export function defaultSchedulerLeaseHolderId() {
  return `foreground-scheduler:${os.hostname()}:${process.pid}:${Date.now()}`;
}

export function schedulerLeaseRelPath(topicId) {
  return normalizeRel(path.join('.nimi-coding', 'scheduler-state', `${safeTopicKey(topicId)}.lease.yaml`));
}

export function readSchedulerLease(topicDir, options = {}) {
  const topicId = String(options.topicId || '');
  if (!topicId) {
    return {
      ok: false,
      errors: ['scheduler lease read requires topicId'],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_PREREQUISITES_MISSING,
        'scheduler lease requires topic_id',
      ),
    };
  }

  const leaseRef = schedulerLeaseRelPath(topicId);
  const leaseAbsPath = path.join(topicDir, leaseRef);
  if (!exists(leaseAbsPath)) {
    return {
      ok: true,
      errors: [],
      exists: false,
      active: false,
      stale: false,
      lease_ref: leaseRef,
      lease: null,
    };
  }

  let leaseDoc;
  try {
    leaseDoc = loadYamlFile(leaseAbsPath) || {};
  } catch (error) {
    return {
      ok: false,
      errors: [`invalid scheduler lease YAML: ${String(error.message || error)}`],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_LEASE_INVALID,
        'scheduler lease file is malformed',
        { lease_ref: leaseRef },
      ),
    };
  }

  const normalized = normalizeLeaseDoc(leaseDoc, leaseRef, options.now || timestampNow());
  if (!normalized.ok) {
    return {
      ...normalized,
      exists: true,
      active: false,
      stale: false,
      lease_ref: leaseRef,
      lease: null,
    };
  }

  return {
    ok: true,
    errors: [],
    exists: true,
    active: normalized.active,
    stale: normalized.stale,
    lease_ref: normalized.lease_ref,
    lease: normalized.lease,
  };
}

export function acquireSchedulerLease(topicDir, options = {}) {
  const topicId = String(options.topicId || '');
  const runId = String(options.runId || '');
  const holderId = String(options.holderId || defaultSchedulerLeaseHolderId());
  const ttlMs = Number(options.ttlMs ?? DEFAULT_SCHEDULER_LEASE_TTL_MS);
  const now = options.now || timestampNow();

  if (!topicId || !runId) {
    return {
      ok: false,
      errors: ['scheduler lease acquisition requires topicId and runId'],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_PREREQUISITES_MISSING,
        'scheduler lease acquisition requires topic_id and run_id',
      ),
    };
  }
  if (!Number.isInteger(ttlMs) || ttlMs < 1) {
    return {
      ok: false,
      errors: [`scheduler lease ttl must be an integer >= 1, got ${String(options.ttlMs)}`],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.STATE_PRECONDITION_FAILED,
        'scheduler lease ttl must be an integer >= 1',
        { requested_ttl_ms: options.ttlMs ?? null },
      ),
    };
  }

  const initialLease = readSchedulerLease(topicDir, { topicId, now });
  if (!initialLease.ok) {
    return initialLease;
  }
  if (initialLease.active) {
    return {
      ok: false,
      errors: [`active scheduler lease already exists for topic ${topicId}`],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_LEASE_ACTIVE,
        'active scheduler lease already exists for this topic',
        {
          topic_id: topicId,
          run_id: initialLease.lease?.run_id || null,
          holder_id: initialLease.lease?.holder_id || null,
          expires_at: initialLease.lease?.expires_at || null,
        },
      ),
      lease_ref: initialLease.lease_ref,
      lease: initialLease.lease,
    };
  }

  const expiresAt = new Date(toEpochMs(now) + ttlMs).toISOString();
  const leaseRef = schedulerLeaseRelPath(topicId);
  const leaseAbsPath = path.join(topicDir, leaseRef);
  const leaseDoc = {
    contract: 'scheduler-lease.v1',
    topic_id: topicId,
    run_id: runId,
    holder_id: holderId,
    acquired_at: now,
    updated_at: now,
    expires_at: expiresAt,
  };

  try {
    ensureDir(path.dirname(leaseAbsPath));
    if (initialLease.exists) {
      fs.rmSync(leaseAbsPath, { force: true });
    }
    fs.writeFileSync(leaseAbsPath, YAML.stringify(leaseDoc), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error && error.code === 'EEXIST') {
      const currentLease = readSchedulerLease(topicDir, { topicId, now });
      if (!currentLease.ok) {
        return currentLease;
      }
      return {
        ok: false,
        errors: ['concurrent scheduler lease acquisition detected'],
        refusal: buildRefusal(
          SCHEDULER_REFUSAL_CODES.SCHEDULER_LEASE_ACTIVE,
          'active scheduler lease already exists for this topic',
          {
            topic_id: topicId,
            run_id: currentLease.lease?.run_id || null,
            holder_id: currentLease.lease?.holder_id || null,
            expires_at: currentLease.lease?.expires_at || null,
          },
        ),
        lease_ref: currentLease.lease_ref,
        lease: currentLease.lease,
      };
    }
    return {
      ok: false,
      errors: [`scheduler lease acquisition failed: ${String(error.message || error)}`],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_RUNTIME_FAILED,
        'scheduler lease acquisition failed',
        { topic_id: topicId, run_id: runId },
      ),
    };
  }

  return {
    ok: true,
    errors: [],
    lease_ref: leaseRef,
    stale_recovered: Boolean(initialLease.exists && initialLease.stale),
    lease: {
      contract: 'scheduler-lease.v1',
      topic_id: topicId,
      run_id: runId,
      holder_id: holderId,
      acquired_at: now,
      updated_at: now,
      expires_at: expiresAt,
    },
  };
}

export function releaseSchedulerLease(topicDir, options = {}) {
  const topicId = String(options.topicId || '');
  const holderId = String(options.holderId || '');
  const runId = options.runId ? String(options.runId) : null;
  const releasedAt = options.now || timestampNow();
  const leaseRef = schedulerLeaseRelPath(topicId);
  const leaseAbsPath = path.join(topicDir, leaseRef);

  if (!topicId || !holderId) {
    return {
      ok: false,
      errors: ['scheduler lease release requires topicId and holderId'],
      refusal: buildRefusal(
        SCHEDULER_REFUSAL_CODES.SCHEDULER_PREREQUISITES_MISSING,
        'scheduler lease release requires topic_id and holder_id',
      ),
    };
  }

  const currentLease = readSchedulerLease(topicDir, { topicId, now: releasedAt });
  if (!currentLease.ok) {
    return currentLease;
  }
  if (!currentLease.exists) {
    return {
      ok: true,
      errors: [],
      released: false,
      released_at: releasedAt,
      lease_ref: leaseRef,
      lease: null,
    };
  }

  const holderMatches = currentLease.lease?.holder_id === holderId;
  const runMatches = runId === null || currentLease.lease?.run_id === runId;
  if (!holderMatches || !runMatches) {
    return {
      ok: true,
      errors: [],
      warnings: [
        'scheduler lease was not released because another holder or run now owns the lease',
      ],
      released: false,
      released_at: releasedAt,
      lease_ref: leaseRef,
      lease: currentLease.lease,
    };
  }

  fs.rmSync(leaseAbsPath, { force: true });
  return {
    ok: true,
    errors: [],
    released: true,
    released_at: releasedAt,
    lease_ref: leaseRef,
    lease: currentLease.lease,
  };
}
