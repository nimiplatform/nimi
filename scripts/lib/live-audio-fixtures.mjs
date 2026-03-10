import { spawnSync } from 'node:child_process';

function fixtureErrorDetail(result, prefix) {
  if (result.error) {
    return `${prefix}: ${result.error.message}`;
  }
  return `${prefix}: ${String(result.stderr || result.stdout || 'unknown error').trim()}`;
}

export function prepareLiveAudioFixtures({
  cwd,
  env = process.env,
  strict = true,
} = {}) {
  const result = spawnSync(
    'node',
    ['scripts/live-audio-fixtures.mjs', '--prepare-only', '--json'],
    {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.error) {
    const detail = fixtureErrorDetail(result, 'prepare live audio fixtures failed');
    if (!strict) {
      return { payload: null, error: detail };
    }
    throw new Error(detail);
  }

  if (result.status !== 0) {
    const detail = fixtureErrorDetail(result, 'prepare live audio fixtures failed');
    if (!strict) {
      return { payload: null, error: detail };
    }
    throw new Error(detail);
  }

  try {
    return {
      payload: JSON.parse(String(result.stdout || '{}')),
      error: '',
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error || 'invalid live audio fixture payload');
    if (!strict) {
      return { payload: null, error: `prepare live audio fixtures failed: ${detail}` };
    }
    throw new Error(`prepare live audio fixtures failed: ${detail}`);
  }
}

export function mergeMissingEnv(targetEnv, fixturePayload) {
  const merged = { ...targetEnv };
  const fixtureEnv = fixturePayload?.env && typeof fixturePayload.env === 'object'
    ? fixturePayload.env
    : {};

  for (const [key, value] of Object.entries(fixtureEnv)) {
    if (String(merged[key] || '').trim()) {
      continue;
    }
    const nextValue = String(value || '').trim();
    if (nextValue) {
      merged[key] = nextValue;
    }
  }

  return merged;
}
