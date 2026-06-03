import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(import.meta.dirname, '../src/shell-mode.ts'), 'utf8');

describe('shell mode primitives', () => {
  it('owns shell feature flags without retired mod toggles', () => {
    expect(source).toMatch(/enableRuntimeTab:\s*\w+/);
    expect(source).toMatch(/enableMenuBarShell/);
    expect(source).toMatch(/isMacDesktopEnvironment/);
    expect(source).not.toMatch(/enableModUi|enableModWorkspaceTabs|VITE_NIMI_ENABLE_MOD_DEVELOPER_UI/);
  });
});
