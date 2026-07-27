import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readAuthSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), 'auth/src', relativePath), 'utf8');
}

describe('auth flow boundaries', () => {
  it('does not hand refresh tokens to renderer session or adapter APIs', () => {
    const authFlowSource = readAuthSource('hooks/use-auth-flow.ts');
    expect(authFlowSource).not.toMatch(/authSessionSetterRef\.current\(user, token, refreshToken\)/);
    const shellAuthPageSource = readAuthSource('components/shell-auth-page.tsx');
    expect(shellAuthPageSource).not.toMatch(
      /adapter\.(?:applyToken|persistSession)\([^)]*(?:accessToken|refreshToken)/s,
    );
  });
});
