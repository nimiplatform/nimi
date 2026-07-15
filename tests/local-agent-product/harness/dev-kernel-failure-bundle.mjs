import fs from 'node:fs';
import path from 'node:path';

const SECRET_TEXT = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/giu;
const SECRET_SCAN = /(?:bearer\s+[a-z0-9._~+/=-]+|(?:access|refresh|id)[_-]?token\s*[:=]|eyj[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\.)/iu;
const EMAIL_TEXT = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const WINDOWS_USER_PATH = /[A-Z]:\\Users\\[^\\\s]+/giu;
const UNIX_USER_PATH = /\/(?:Users|home)\/[^/\s]+/gu;
const FORBIDDEN_KEYS = /(?:password|token|cookie|credential|email)|^(?:secret|authorization|headers?|query|string|body)$/iu;

export async function persistDevKernelFailureBundle({
  artifactsRoot,
  executionMode,
  phase,
  error,
  sourceState,
  desktop,
  zhiyuConnections = [],
  readDesktopGrantProjection,
  runtimeService,
  processLedger,
  observations,
  observedPages,
}) {
  const target = path.join(path.resolve(artifactsRoot), 'sanitized-failure-bundle.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const liveZhiyu = zhiyuConnections.find((connection) => connection?.page && !connection.page.isClosed());
  const bundle = sanitizeValue({
    schemaVersion: 'nimi.dev-kernel-sanitized-failure/v1',
    acceptanceEligible: false,
    executionMode: boundedText(executionMode, 40),
    phase: boundedText(phase, 120),
    failedAt: new Date().toISOString(),
    typedError: projectTypedError(error),
    source: {
      digest: boundedText(sourceState?.sourceDigest, 128),
      nimiCommit: boundedText(sourceState?.nimiCommit, 64),
      realmCommit: boundedText(sourceState?.realmCommit, 64),
    },
    runtimeCandidate: projectRuntimeCandidate(runtimeService),
    processLedger: processLedger?.snapshot?.() || null,
    desktopGrantProjection: await safeRead(readDesktopGrantProjection),
    lastDom: {
      desktop: await projectPage(desktop?.page),
      zhiyu: await projectPage(liveZhiyu?.page),
    },
    lastEvidence: {
      zhiyu: await projectZhiyuEvidence(liveZhiyu?.page),
      observations: projectLastObservations(observations),
    },
    pages: projectObservedPages(observedPages),
  });
  const serialized = `${JSON.stringify(bundle, null, 2)}\n`;
  if (SECRET_SCAN.test(serialized) || /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu.test(serialized)) {
    throw new Error('dev-kernel-failure-bundle-redaction-failed');
  }
  fs.writeFileSync(target, serialized, { encoding: 'utf8', mode: 0o600 });
  return target;
}

async function projectPage(page) {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => ({
    title: document.title,
    lang: document.documentElement.lang,
    readyState: document.readyState,
    bodyText: (document.body?.innerText || '').replace(/\s+/gu, ' ').trim().slice(0, 4_000),
    visibleTestIds: [...document.querySelectorAll('[data-testid]')]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .slice(0, 100)
      .map((element) => element.getAttribute('data-testid') || ''),
  })).catch(() => null);
}

async function projectZhiyuEvidence(page) {
  if (!page || page.isClosed()) return null;
  return page.evaluate(() => {
    const evidence = window.__nimiZhiyuDevKernelEvidence;
    if (!evidence) return null;
    return {
      state: evidence.state,
      buildMarker: evidence.buildMarker,
      openPermission: evidence.openPermission,
      conversationPermissions: evidence.conversationPermissions,
      lastError: evidence.lastError,
      conversationAnchorPresent: Boolean(evidence.conversationAnchorId),
      transcriptCount: Array.isArray(evidence.transcript) ? evidence.transcript.length : 0,
    };
  }).catch(() => null);
}

async function safeRead(reader) {
  if (typeof reader !== 'function') return null;
  try {
    return await reader();
  } catch (error) {
    return { unavailable: true, typedError: projectTypedError(error) };
  }
}

function projectTypedError(error) {
  const record = error && typeof error === 'object' ? error : {};
  const message = error instanceof Error ? error.message : String(error || 'unknown');
  const reasonCode = boundedReason(record.reasonCode)
    || boundedReason(record.code)
    || boundedReason(record.cause?.reasonCode)
    || boundedReason(message.match(/\b(?:LOCAL_APP|PROTECTED_LOCAL|runtime|local-app)[A-Za-z0-9_-]*\b/iu)?.[0]);
  return {
    code: boundedReason(record.code) || safeErrorCode(message),
    reasonCode: reasonCode || 'unknown',
    message: sanitizeString(message).slice(0, 1_000),
  };
}

function projectRuntimeCandidate(service) {
  if (!service || typeof service !== 'object') return null;
  return {
    serviceName: boundedText(service.serviceName, 80),
    state: boundedText(service.state, 40),
    processId: Number.isSafeInteger(service.processId) ? service.processId : 0,
    runtimeCandidateId: boundedText(service.runtimeCandidateId, 160),
    runtimeBinarySha256: boundedText(service.runtimeBinarySha256, 64),
    runtimeBuildRecordSha256: boundedText(service.runtimeBuildRecordSha256, 64),
    sourceTreeSha256: boundedText(service.sourceTreeSha256, 64),
    checkpointCandidatePostureVerified: service.checkpointCandidatePostureVerified === true,
  };
}

function projectLastObservations(observations) {
  if (!observations || typeof observations !== 'object') return null;
  const entries = Object.entries(observations).slice(-12);
  return Object.fromEntries(entries);
}

function projectObservedPages(pages) {
  if (!Array.isArray(pages)) return [];
  return pages.slice(-20).map((page) => ({
    label: boundedText(page?.label, 120),
    authorizationHeaderObserved: page?.authorizationHeaderObserved === true,
    secretTextObserved: page?.secretTextObserved === true,
    consoleErrors: Array.isArray(page?.consoleErrors) ? page.consoleErrors.slice(-20) : [],
    pageErrors: Array.isArray(page?.pageErrors) ? page.pageErrors.slice(-20) : [],
  }));
}

function sanitizeValue(value, key = '') {
  if (FORBIDDEN_KEYS.test(key)) return '[REDACTED]';
  if (typeof value === 'string') return sanitizeString(value);
  if (Array.isArray(value)) return value.slice(0, 200).map((entry) => sanitizeValue(entry));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [entryKey, entryValue] of Object.entries(value).slice(0, 300)) {
    result[entryKey] = sanitizeValue(entryValue, entryKey);
  }
  return result;
}

function sanitizeString(value) {
  return String(value || '')
    .replace(SECRET_TEXT, '[REDACTED]')
    .replace(EMAIL_TEXT, '[REDACTED]')
    .replace(/\b(?:password|secret|credential)\s*[:=]\s*[^\s]+/giu, '[REDACTED]')
    .replace(WINDOWS_USER_PATH, '[LOCAL_USER_PATH]')
    .replace(UNIX_USER_PATH, '[LOCAL_USER_PATH]')
    .replace(/(https?:\/\/[^\s?#]+)[?#][^\s]*/giu, '$1?[REDACTED]');
}

function boundedText(value, maximum) {
  const text = sanitizeString(value).trim();
  return text.length <= maximum ? text : text.slice(0, maximum);
}

function boundedReason(value) {
  const reason = String(value || '').trim();
  return /^[A-Za-z][A-Za-z0-9_-]{0,127}$/u.test(reason) ? reason : '';
}

function safeErrorCode(message) {
  return boundedReason(String(message || '').match(/^([A-Za-z][A-Za-z0-9_-]{0,127})/u)?.[1]) || 'journey-failed';
}
