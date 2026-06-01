import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tscBin = require.resolve('typescript/bin/tsc');

// Cross-platform tsc invocation for the tester behavior tests, which compile a
// small set of source files to a temp dir and import the result to assert real
// runtime behavior. Spawning `pnpm exec tsc` is not portable: on Windows pnpm
// resolves only as `pnpm.cmd`, which `execFileSync` cannot launch without a
// shell. Resolve the local TypeScript compiler entry and run it through the
// current Node binary so the tests run identically on every platform.
//
// `args` are the tsc flags/inputs (everything that previously followed
// `pnpm exec tsc`). `options` matches the execFileSync options the callers use.
export function buildWithTsc(args, options) {
  execFileSync(process.execPath, [tscBin, ...args], options);
}
