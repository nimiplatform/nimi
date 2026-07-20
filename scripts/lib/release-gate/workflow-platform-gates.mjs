import { normalizeCommand, splitShellCommands } from './command-expander.mjs';

const REQUIRED_PLATFORM = new Map([
  ['not_macos', { id: 'macos', pattern: /macos|darwin/iu }],
  ['not_windows', { id: 'windows', pattern: /windows|win32/iu }],
  ['not_linux', { id: 'linux', pattern: /ubuntu|linux/iu }],
]);

export function checkPlatformSpecificGateConsumers(registry, workflows) {
  const errors = [];
  for (const gate of registry.gates ?? []) {
    const platform = REQUIRED_PLATFORM.get(gate.skip_when?.condition);
    if (!platform || !(gate.tiers ?? []).includes('release')) continue;

    const matches = [];
    for (const { fileName, document } of workflows) {
      for (const [jobId, job] of Object.entries(document?.jobs ?? {})) {
        for (const [stepIndex, step] of (job?.steps ?? []).entries()) {
          if (typeof step?.run !== 'string') continue;
          const commands = splitShellCommands(step.run);
          if (!commands.includes(normalizeCommand(gate.command))) continue;
          const platformEvidence = `${JSON.stringify(job?.['runs-on'] ?? '')} ${String(step?.if ?? '')}`;
          matches.push({ fileName, jobId, stepIndex: stepIndex + 1, platformEvidence });
        }
      }
    }

    if (matches.length === 0) {
      errors.push(`${gate.id}: platform-specific release gate has no workflow consumer`);
      continue;
    }
    if (!matches.some((match) => platform.pattern.test(match.platformEvidence))) {
      errors.push(
        `${gate.id}: workflow consumer does not prove ${platform.id} runner selection`,
      );
    }
  }
  return errors;
}
