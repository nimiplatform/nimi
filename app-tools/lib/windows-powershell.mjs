export function windowsPowerShellEnv(overrides = {}, baseEnv = process.env) {
  const env = { ...baseEnv, ...overrides };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === 'psmodulepath') delete env[key];
  }
  return env;
}
