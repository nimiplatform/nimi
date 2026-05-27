import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

const shellAuthPageSource = readFileSync(
  new URL('../../../kit/auth/src/components/shell-auth-page.tsx', import.meta.url),
  'utf8',
);

const shellAuthThemeSource = readFileSync(
  new URL('../../../kit/auth/src/theme/auth-theme.css', import.meta.url),
  'utf8',
);

test('shell auth page keeps scoped theme routing enabled', () => {
  assert.ok(
    shellAuthPageSource.includes('data-shell-auth-theme={appearance.theme}'),
    'ShellAuthPage must expose data-shell-auth-theme for scoped auth presentation themes',
  );
});

test('shell auth theme keeps the desktop scoped palette', () => {
  assert.ok(
    shellAuthThemeSource.includes(".nimi-shell-auth-root[data-shell-auth-theme='desktop']"),
    'auth theme must define a scoped desktop palette',
  );
  assert.ok(
    shellAuthThemeSource.includes('var(--nimi-ambient-mesh-base-start)'),
    'desktop auth palette must consume the canonical ambient mesh background tokens',
  );
  assert.doesNotMatch(shellAuthThemeSource, /relay-dark/u);
});
