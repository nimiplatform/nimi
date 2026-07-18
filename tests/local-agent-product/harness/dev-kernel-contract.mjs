export function isRuntimeObservedProcessMismatch(evidence) {
  if (evidence?.probeKind === 'raw-uncarried') {
    return evidence?.lastError?.reasonCode === 'runtime-service-untrusted'
      || (evidence?.lastError?.reasonCode === 'runtime-service-unavailable'
        && evidence?.fixedServiceStable === true
        && Number.isSafeInteger(evidence?.fixedServiceProcessId)
        && evidence.fixedServiceProcessId > 0
        && /^dev-kernel-runtime-[a-f0-9]{32}$/u.test(String(evidence?.runtimeCandidateId || '')));
  }
  return evidence?.lastError?.reasonCode === 'process-replaced';
}

const projectRevocationReasonCodes = new Set(['revoked', 'project-changed']);

export function isTypedProjectRevocationDenial(observation) {
  const denial = observation?.denial;
  return observation?.attempted === true
    && denial?.session?.sessionBound === false
    && [...projectRevocationReasonCodes].some((reason) => String(denial?.session?.reasonCode || '').includes(reason));
}

export function isRuntimeRestartUiTransition(observation) {
  return Number.isSafeInteger(observation?.before?.processId)
    && Number.isSafeInteger(observation?.after?.processId)
    && observation.before.processId > 0
    && observation.after.processId > 0
    && observation.before.processId !== observation.after.processId
    && observation?.unavailableUi?.state === 'runtime-unavailable'
    && typeof observation?.unavailableUi?.reasonCode === 'string'
    && observation.unavailableUi.reasonCode.trim().length > 0
    && observation?.recoveredUi?.state !== 'runtime-unavailable'
    && observation?.recoveredUi?.sessionBound === true
    && observation?.recoveredUi?.permissionPosture === 'unavailable';
}

export function beginObservedProcess({ connect, start }) {
  if (typeof connect !== 'function' || typeof start !== 'function') {
    throw new TypeError('beginObservedProcess requires connect and start callbacks');
  }
  const connectionPromise = Promise.resolve(connect());
  const handle = start();
  return { connectionPromise, handle };
}

export function resolveHostRustToolchainHomes({ env = process.env, hostHome = '' } = {}) {
  const configuredRustupHome = String(env.RUSTUP_HOME || '').trim();
  const configuredCargoHome = String(env.CARGO_HOME || '').trim();
  const normalizedHostHome = String(hostHome || '').trim();
  if ((!configuredRustupHome || !configuredCargoHome) && !path.isAbsolute(normalizedHostHome)) {
    throw new Error('an absolute host home is required to derive Rust toolchain roots');
  }
  const rustupHome = configuredRustupHome || path.join(normalizedHostHome, '.rustup');
  const cargoHome = configuredCargoHome || path.join(normalizedHostHome, '.cargo');
  if (!path.isAbsolute(rustupHome) || !path.isAbsolute(cargoHome)) {
    throw new Error('Rust toolchain roots must be absolute paths');
  }
  if (path.resolve(rustupHome) === path.resolve(cargoHome)) {
    throw new Error('RUSTUP_HOME and CARGO_HOME must remain distinct');
  }
  return { rustupHome: path.resolve(rustupHome), cargoHome: path.resolve(cargoHome) };
}

export async function waitForObservedProcessConnection({ connectionPromise, handle, label }) {
  if (!connectionPromise || !handle?.completed || !String(label || '').trim()) {
    throw new TypeError('observed process connection requires a promise, process handle, and label');
  }
  const exitedBeforeConnection = handle.completed.then((result) => {
    throw new Error(`${label} exited before its renderer became observable (code=${result.code}, signal=${result.signal || 'none'})`);
  });
  try {
    return await Promise.race([connectionPromise, exitedBeforeConnection]);
  } catch (cause) {
    const snapshot = typeof handle.snapshot === 'function' ? handle.snapshot() : {};
    const diagnostics = {
      code: snapshot.code ?? handle.child?.exitCode ?? null,
      signal: snapshot.signal ?? handle.child?.signalCode ?? null,
      stdoutPath: snapshot.stdoutPath || '',
      stderrPath: snapshot.stderrPath || '',
      stdoutTail: String(snapshot.stdout || '').slice(-4096),
      stderrTail: String(snapshot.stderr || '').slice(-4096),
    };
    throw new Error(`${label} renderer observation failed: ${JSON.stringify(diagnostics)}`, { cause });
  }
}

export function inspectNetworkAuthorityMaterial({ url = '', postData = '', headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(Object.entries(headers || {}).map(([key, value]) => (
    [String(key).toLowerCase(), String(value ?? '')]
  )));
  const authorizationHeaderObserved = Boolean(normalizedHeaders.authorization?.trim());
  const searchable = [
    String(url || ''),
    String(postData || ''),
    ...Object.entries(normalizedHeaders).flat(),
  ].join('\n');
  const secretTextObserved = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu.test(searchable);
  return { authorizationHeaderObserved, secretTextObserved };
}

const observedProcessRoles = new Set(['provider', 'realm', 'runtime', 'desktop', 'zhiyu']);

export function createObservedProcessLedger() {
  const events = [];
  const keys = new Set();
  return {
    observe(role, identity, details = {}) {
      if (!observedProcessRoles.has(role)) throw new Error(`unsupported observed process role ${role}`);
      const observedIdentity = String(identity || '').trim();
      if (!observedIdentity) throw new Error(`observed ${role} process identity is required`);
      const kind = String(details.kind || 'process-start');
      const key = `${role}\0${kind}\0${observedIdentity}`;
      if (keys.has(key)) return false;
      keys.add(key);
      events.push({ role, identity: observedIdentity, kind, ...details });
      return true;
    },
    snapshot() {
      const processStarts = { provider: 0, realm: 0, runtime: 0, desktop: 0, zhiyu: 0 };
      for (const event of events) processStarts[event.role] += 1;
      return { processStarts, events: structuredClone(events) };
    },
  };
}

export function assessObservedProcessBudget(processStarts, startLimits, minimums = {}) {
  const overages = [];
  const missing = [];
  for (const role of observedProcessRoles) {
    const observed = Number(processStarts?.[role]);
    const maximum = Number(startLimits?.[role]);
    const minimum = Number(minimums?.[role] || 0);
    if (!Number.isInteger(observed) || observed < 0) missing.push(`${role}:invalid`);
    else {
      if (!Number.isInteger(maximum) || observed > maximum) overages.push(`${role}:${observed}>${maximum}`);
      if (observed < minimum) missing.push(`${role}:${observed}<${minimum}`);
    }
  }
  return { ok: overages.length === 0 && missing.length === 0, overages, missing };
}

export function assessAccessibilityAudit(audit, { requiresInput = false } = {}) {
  const findings = [];
  const tree = Array.isArray(audit?.accessibility) ? audit.accessibility : [];
  const exposed = tree.filter((node) => node?.ignored !== true);
  const rootPresent = exposed.some((node) => /^(?:rootwebarea|webarea|document)$/iu.test(String(node?.role || '')));
  const interactive = exposed.filter((node) => /^(?:button|checkbox|combobox|link|menuitem|radio|searchbox|slider|switch|tab|textbox)$/iu.test(String(node?.role || '')));
  const unnamedInteractive = interactive.filter((node) => !String(node?.name || '').trim());
  if (!rootPresent) findings.push('missing-exposed-document-root');
  if (interactive.length === 0) findings.push('missing-exposed-interactive-control');
  if (unnamedInteractive.length > 0) findings.push(`unnamed-interactive-controls:${unnamedInteractive.length}`);
  if (!String(audit?.dom?.lang || '').trim()) findings.push('document-language-missing');
  if (!Number.isInteger(audit?.dom?.visibleButtons) || audit.dom.visibleButtons < 1) findings.push('visible-button-missing');
  if (requiresInput && (!Number.isInteger(audit?.dom?.inputs) || audit.dom.inputs < 1)) findings.push('input-control-missing');
  return {
    ok: findings.length === 0,
    findings,
    exposedNodeCount: exposed.length,
    interactiveControlCount: interactive.length,
  };
}
import path from 'node:path';
