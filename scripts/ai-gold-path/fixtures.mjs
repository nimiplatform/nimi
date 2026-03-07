import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';

const ENV_PATTERN = /\$\{([A-Z0-9_]+)\}/g;
const LEGACY_KEYS = new Set(['connectorId', 'connector_id']);
const REPO_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

export const GOLD_FIXTURE_DIR = path.join(REPO_ROOT, 'dev', 'fixtures', 'ai-gold-path');
export const GOLD_REPORT_PATH = path.join(REPO_ROOT, 'dev', 'report', 'ai-gold-path-report.yaml');
export const GOLD_GATE_LAYERS = ['L0', 'L1', 'L2', 'L3'];

function expandEnvPlaceholders(source) {
  return String(source || '').replace(ENV_PATTERN, (_, name) => String(process.env[name] || ''));
}

function collectEnvPlaceholders(source) {
  const matches = new Set();
  for (const match of String(source || '').matchAll(ENV_PATTERN)) {
    const envName = String(match[1] || '').trim();
    if (envName) {
      matches.add(envName);
    }
  }
  return [...matches];
}

function ensureNoLegacyKeys(value, trail = 'fixture') {
  if (!value || typeof value !== 'object') {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => ensureNoLegacyKeys(entry, `${trail}[${index}]`));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (LEGACY_KEYS.has(key)) {
      throw new Error(`${trail}.${key} is forbidden in gold fixtures`);
    }
    ensureNoLegacyKeys(nested, `${trail}.${key}`);
  }
}

function normalizeFixture(fixture, fixturePath) {
  const request = fixture?.request && typeof fixture.request === 'object' ? fixture.request : {};
  const envRequirements = Array.isArray(fixture?.env_requirements)
    ? fixture.env_requirements.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const normalized = {
    fixture_id: String(fixture?.fixture_id || '').trim(),
    capability: String(fixture?.capability || '').trim(),
    provider: String(fixture?.provider || '').trim(),
    model_id: String(fixture?.model_id || '').trim(),
    target_model_id: String(fixture?.target_model_id || '').trim(),
    voice_ref: fixture?.voice_ref && typeof fixture.voice_ref === 'object'
      ? {
        kind: String(fixture.voice_ref.kind || '').trim(),
        id: String(fixture.voice_ref.id || '').trim(),
      }
      : undefined,
    request,
    expected_assertions: fixture?.expected_assertions && typeof fixture.expected_assertions === 'object'
      ? fixture.expected_assertions
      : {},
    env_requirements: envRequirements,
    path: fixturePath,
  };

  if (!normalized.fixture_id) {
    throw new Error(`${fixturePath}: fixture_id is required`);
  }
  if (!normalized.capability) {
    throw new Error(`${fixturePath}: capability is required`);
  }
  if (!normalized.provider) {
    throw new Error(`${fixturePath}: provider is required`);
  }
  if (!normalized.model_id) {
    throw new Error(`${fixturePath}: model_id is required`);
  }

  const capability = normalized.capability;
  if (capability === 'text.generate' && !String(request.prompt || '').trim()) {
    throw new Error(`${fixturePath}: text.generate requires request.prompt`);
  }
  if (capability === 'text.embed' && (!Array.isArray(request.inputs) || request.inputs.length === 0)) {
    throw new Error(`${fixturePath}: text.embed requires request.inputs`);
  }
  if (capability === 'image.generate' && !String(request.prompt || '').trim()) {
    throw new Error(`${fixturePath}: image.generate requires request.prompt`);
  }
  if (capability === 'audio.synthesize' && !String(request.text || '').trim()) {
    throw new Error(`${fixturePath}: audio.synthesize requires request.text`);
  }
  const audioURI = String(request.audio_uri || '').trim();
  const audioPath = String(request.audio_path || '').trim();
  if (audioURI && audioPath) {
    throw new Error(`${fixturePath}: request.audio_uri and request.audio_path are mutually exclusive`);
  }
  if (capability === 'audio.transcribe' && !audioURI && !audioPath) {
    throw new Error(`${fixturePath}: audio.transcribe requires request.audio_uri or request.audio_path`);
  }
  if (capability === 'voice.clone') {
    if (!normalized.target_model_id) {
      throw new Error(`${fixturePath}: voice.clone requires target_model_id`);
    }
    if (!audioURI && !audioPath) {
      throw new Error(`${fixturePath}: voice.clone requires request.audio_uri or request.audio_path`);
    }
  }
  if (capability === 'voice.design') {
    if (!normalized.target_model_id) {
      throw new Error(`${fixturePath}: voice.design requires target_model_id`);
    }
    if (!String(request.instruction_text || '').trim()) {
      throw new Error(`${fixturePath}: voice.design requires request.instruction_text`);
    }
  }

  ensureNoLegacyKeys(normalized);
  normalized.request_digest = crypto.createHash('sha256')
    .update(JSON.stringify({
      fixture_id: normalized.fixture_id,
      capability: normalized.capability,
      provider: normalized.provider,
      model_id: normalized.model_id,
      target_model_id: normalized.target_model_id,
      voice_ref: normalized.voice_ref || null,
      request: normalized.request,
    }))
    .digest('hex');
  normalized.acceptance = String(normalized.expected_assertions?.acceptance || '').trim();
  normalized.gated = normalized.acceptance !== 'reserved';
  return normalized;
}

export function loadGoldFixture(fixturePath) {
  const absolutePath = path.isAbsolute(fixturePath)
    ? fixturePath
    : path.join(REPO_ROOT, fixturePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  const placeholderEnv = collectEnvPlaceholders(raw);
  const rawParsed = YAML.parse(raw) || {};
  const declaredEnv = Array.isArray(rawParsed?.env_requirements)
    ? rawParsed.env_requirements.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const requiredEnv = [...new Set([...declaredEnv, ...placeholderEnv])];
  const canResolveAllEnv = requiredEnv.every((key) => String(process.env[key] || '').trim().length > 0);
  const parsed = canResolveAllEnv
    ? (YAML.parse(expandEnvPlaceholders(raw)) || {})
    : rawParsed;
  if (!Array.isArray(parsed.env_requirements) || parsed.env_requirements.length === 0) {
    parsed.env_requirements = requiredEnv;
  } else {
    parsed.env_requirements = [...new Set([
      ...parsed.env_requirements.map((item) => String(item || '').trim()).filter(Boolean),
      ...requiredEnv,
    ])];
  }
  return normalizeFixture(parsed, absolutePath);
}

export function loadGoldFixtures() {
  return fs.readdirSync(GOLD_FIXTURE_DIR)
    .filter((entry) => entry.endsWith('.yaml'))
    .sort((left, right) => left.localeCompare(right))
    .map((entry) => loadGoldFixture(path.join(GOLD_FIXTURE_DIR, entry)));
}

export function missingFixtureEnv(fixture) {
  return fixture.env_requirements.filter((key) => String(process.env[key] || '').trim().length === 0);
}

function inferAudioMimeType(audioPath, explicitMimeType) {
  const explicit = String(explicitMimeType || '').trim();
  if (explicit) {
    return explicit;
  }
  const extension = path.extname(String(audioPath || '').trim()).toLowerCase();
  if (extension === '.wav') {
    return 'audio/wav';
  }
  if (extension === '.mp3') {
    return 'audio/mpeg';
  }
  if (extension === '.m4a') {
    return 'audio/mp4';
  }
  if (extension === '.ogg') {
    return 'audio/ogg';
  }
  return 'audio/wav';
}

export function loadGoldFixtureAudioInput(fixture) {
  const audioURI = String(fixture?.request?.audio_uri || '').trim();
  const audioPath = String(fixture?.request?.audio_path || '').trim();
  if (audioURI && audioPath) {
    throw new Error(`${fixture?.path || 'fixture'}: request.audio_uri and request.audio_path are mutually exclusive`);
  }
  if (audioPath) {
    const absolutePath = path.isAbsolute(audioPath)
      ? audioPath
      : path.join(path.dirname(String(fixture?.path || REPO_ROOT)), audioPath);
    const bytes = fs.readFileSync(absolutePath);
    if (!bytes.length) {
      throw new Error(`${absolutePath}: audio fixture file is empty`);
    }
    const mimeType = inferAudioMimeType(absolutePath, fixture?.request?.mime_type);
    return {
      kind: 'bytes',
      path: absolutePath,
      bytes: Uint8Array.from(bytes),
      base64: Buffer.from(bytes).toString('base64'),
      mimeType,
    };
  }
  if (audioURI) {
    return {
      kind: 'url',
      url: audioURI,
      mimeType: String(fixture?.request?.mime_type || '').trim() || undefined,
    };
  }
  return null;
}

export function supportsLocalChatLayer(fixture) {
  return (
    fixture.capability === 'text.generate'
    || fixture.capability === 'image.generate'
    || fixture.capability === 'audio.synthesize'
    || fixture.capability === 'audio.transcribe'
  );
}

export function runtimeEnvForFixture(fixture) {
  if (fixture.provider !== 'dashscope') {
    return {};
  }
  return {
    NIMI_RUNTIME_CLOUD_DASHSCOPE_BASE_URL: String(process.env.NIMI_LIVE_DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1').trim(),
    NIMI_RUNTIME_CLOUD_DASHSCOPE_API_KEY: String(process.env.NIMI_LIVE_DASHSCOPE_API_KEY || '').trim(),
  };
}

export function summarizeGoldReport(report) {
  const summary = {
    total_fixtures: Array.isArray(report?.fixtures) ? report.fixtures.length : 0,
    gated_fixtures: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    reserved: 0,
  };
  for (const fixture of report.fixtures || []) {
    if (!fixture.gated) {
      summary.reserved += 1;
      continue;
    }
    summary.gated_fixtures += 1;
    if (fixture.first_failing_layer) {
      const failingLayer = fixture.layers?.[fixture.first_failing_layer];
      if (failingLayer?.status === 'skipped') {
        summary.skipped += 1;
      } else {
        summary.failed += 1;
      }
      continue;
    }
    summary.passed += 1;
  }
  return summary;
}
