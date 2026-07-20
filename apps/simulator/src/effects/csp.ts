/**
 * Restrictive Simulator CSP generation from the emitted artifact inventory.
 *
 * Authority: P-SIM-018 and simulator-protocol.md §16.3. The semantic floor is
 * connect-src/worker-src/frame-src/object-src/base-uri/form-action 'none';
 * remaining sources are restricted to the Simulator origin and exact emitted
 * asset classes.
 */

export interface SimulatorArtifactAssetClasses {
  readonly script: boolean;
  readonly style: boolean;
  readonly image: boolean;
  readonly font: boolean;
  readonly media: boolean;
}

export const SIMULATOR_CSP_FLOOR: Readonly<Record<string, string>> = Object.freeze({
  'connect-src': "'none'",
  'worker-src': "'none'",
  'frame-src': "'none'",
  'object-src': "'none'",
  'base-uri': "'none'",
  'form-action': "'none'",
});

export function assetClassesFromFileList(files: readonly string[]): SimulatorArtifactAssetClasses {
  return {
    script: files.some((file) => file.endsWith('.js') || file.endsWith('.mjs')),
    style: files.some((file) => file.endsWith('.css')),
    image: files.some((file) => /\.(png|jpe?g|gif|webp|avif|svg|ico)$/u.test(file)),
    font: files.some((file) => /\.(woff2?|ttf|otf)$/u.test(file)),
    media: files.some((file) => /\.(mp4|webm|mp3|ogg|wav)$/u.test(file)),
  };
}

export function generateSimulatorCsp(classes: SimulatorArtifactAssetClasses): string {
  const directives: [string, string][] = [
    ['default-src', "'self'"],
    ['script-src', "'self'"],
    ['style-src', "'self' 'unsafe-inline'"],
    ['img-src', classes.image ? "'self' data:" : "'none'"],
    ['font-src', classes.font ? "'self'" : "'none'"],
    ['media-src', classes.media ? "'self'" : "'none'"],
    ['connect-src', SIMULATOR_CSP_FLOOR['connect-src']],
    ['worker-src', SIMULATOR_CSP_FLOOR['worker-src']],
    ['frame-src', SIMULATOR_CSP_FLOOR['frame-src']],
    ['object-src', SIMULATOR_CSP_FLOOR['object-src']],
    ['base-uri', SIMULATOR_CSP_FLOOR['base-uri']],
    ['form-action', SIMULATOR_CSP_FLOOR['form-action']],
  ];
  return directives.map(([name, value]) => `${name} ${value}`).join('; ');
}

export function simulatorCspSatisfiesFloor(policy: string): boolean {
  const directives = new Map<string, string>();
  for (const part of policy.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const space = trimmed.indexOf(' ');
    directives.set(
      space === -1 ? trimmed : trimmed.slice(0, space),
      space === -1 ? '' : trimmed.slice(space + 1).trim(),
    );
  }
  for (const [directive, floor] of Object.entries(SIMULATOR_CSP_FLOOR)) {
    const value = directives.get(directive);
    if (value === undefined || value !== floor) return false;
  }
  return true;
}
