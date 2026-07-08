import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readKitFile(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('@nimiplatform/kit/auth/shell public boundary', () => {
  it('exports only the lightweight ShellAuthPage surface and required contracts', () => {
    const source = readKitFile('auth/src/shell/index.ts');

    expect(source).toContain('ShellAuthPage');
    expect(source).toContain('ShellAuthPageProps');
    expect(source).toContain('AuthPlatformAdapter');
    expect(source).not.toMatch(/DesktopShellAuthPage/u);
    expect(source).not.toMatch(/desktop-particle-background-light/u);
    expect(source).not.toMatch(/simplex-noise/u);
    expect(source).not.toMatch(/from ['"]three['"]/u);
  });

  it('publishes auth/shell as a dist-backed package export', () => {
    const packageJson = JSON.parse(readKitFile('package.json')) as {
      exports?: Record<string, { types?: string; import?: string; default?: string }>;
    };

    expect(packageJson.exports?.['./auth/shell']).toEqual({
      types: './dist/auth/shell/index.d.ts',
      import: './dist/auth/shell/index.js',
      default: './dist/auth/shell/index.js',
    });
  });
});
