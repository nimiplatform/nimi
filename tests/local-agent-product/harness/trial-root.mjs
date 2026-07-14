import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { TRIAL_IDENTITY_FILE, TRIAL_ROOT_PREFIX, writeHarnessOwnerMarker } from './sandbox-hygiene.mjs';

function safeId(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'trial';
}

function createRoot(prefix, identity) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${TRIAL_ROOT_PREFIX}${safeId(prefix)}-`));
  const candidateId = identity.journeyTrialId || identity.suiteTrialId;
  const trialIdentity = { ...identity, candidateId };
  fs.writeFileSync(path.join(root, TRIAL_IDENTITY_FILE), `${JSON.stringify(trialIdentity, null, 2)}\n`, { mode: 0o600 });
  writeHarnessOwnerMarker(root, { candidateId });
  const paths = {
    root,
    realm: path.join(root, 'realm'),
    runtimeState: path.join(root, 'runtime-state'),
    // Harness scratch data only. Fixed-service First Run replaces this with
    // the Runtime-projected, candidate-bound proposal; this path is never
    // Product Control or Runtime authority.
    runtimeData: path.join(root, 'Nimi'),
    standardShellData: path.join(root, 'standard-shell-data'),
    appDataRoaming: path.join(root, 'appdata-roaming'),
    appDataLocal: path.join(root, 'appdata-local'),
    desktopUserData: path.join(root, 'desktop-user-data'),
    zhiyuUserData: path.join(root, 'zhiyu-user-data'),
    providerRaw: path.join(root, 'provider-raw'),
    artifacts: path.join(root, 'artifacts'),
    control: path.join(root, 'control'),
  };
  for (const value of Object.values(paths)) if (value !== root) fs.mkdirSync(value, { recursive: true });
  return { identity: trialIdentity, paths };
}

export function createIsolatedJourneyRoot({ journeyId, tier, batch, repeatIndex }) {
  const journeyTrialId = `${journeyId}:${tier}:${batch}:${repeatIndex}`;
  const suffix = randomBytes(8).toString('hex');
  const logicalIdentity = {
    accountId: `user-e2e-${suffix}`,
    worldId: `world-runtime-live-${suffix}`,
    sourceId: `source-runtime-live-${suffix}`,
    personaSourceId: `persona-runtime-live-${suffix}`,
    entityId: `entity-runtime-live-${suffix}`,
    resourceId: `resource-runtime-live-avatar-${suffix}`,
    disabledSourceId: `character-acceptance-missing-hash-${suffix}`,
  };
  return createRoot(`${journeyId}-r${repeatIndex}`, {
    journeyTrialId,
    journeyId,
    tier,
    batch,
    repeatIndex,
    logicalIdentity,
  });
}

export function journeyIdentityEnv(trial) {
  const identity = trial?.identity?.logicalIdentity;
  if (!identity) throw new Error('Journey trial is missing logical identity');
  return {
    NIMI_LOCAL_AGENT_PRODUCT_ACCOUNT_ID: identity.accountId,
    NIMI_LOCAL_AGENT_PRODUCT_WORLD_ID: identity.worldId,
    NIMI_LOCAL_AGENT_PRODUCT_SOURCE_ID: identity.sourceId,
    NIMI_LOCAL_AGENT_PRODUCT_PERSONA_SOURCE_ID: identity.personaSourceId,
    NIMI_LOCAL_AGENT_PRODUCT_ENTITY_ID: identity.entityId,
    NIMI_LOCAL_AGENT_PRODUCT_RESOURCE_ID: identity.resourceId,
    NIMI_LOCAL_AGENT_PRODUCT_DISABLED_SOURCE_ID: identity.disabledSourceId,
  };
}

export function createIsolatedSuiteRoot({ suiteId, layers }) {
  const suiteTrialId = `${suiteId}:${Date.now()}`;
  return createRoot(suiteId, { suiteTrialId, suiteId, layers });
}

export function removeIsolatedTrialRoot(trial) {
  fs.rmSync(trial.paths.root, {
    recursive: true,
    force: true,
    maxRetries: process.platform === 'win32' ? 10 : 0,
    retryDelay: process.platform === 'win32' ? 200 : 100,
  });
}
