import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

if (process.platform === 'darwin' || process.platform === 'win32') {
  const crate = fileURLToPath(new URL('../../../kit/shell/protected-local-node/', import.meta.url));
  execFileSync('cargo', ['build', '--locked', '--target-dir', 'target'], { cwd: crate, stdio: 'inherit' });
}
