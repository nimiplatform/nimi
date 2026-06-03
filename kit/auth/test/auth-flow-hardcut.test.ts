import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readAuthSource(relativePath: string): string {
  return readFileSync(path.join(process.cwd(), 'auth/src', relativePath), 'utf8');
}

describe('auth flow hard-cuts', () => {
  it('does not forward refresh tokens into renderer auth session setters', () => {
    const authFlowSource = readAuthSource('hooks/use-auth-flow.ts');

    expect(authFlowSource).toMatch(/setAuthSession: \(user, token\) => authSessionSetterRef\.current\(user, token\)/);
    expect(authFlowSource).not.toMatch(/authSessionSetterRef\.current\(user, token, refreshToken\)/);
    expect(authFlowSource).toMatch(/void adapter\.applyToken\(''\)/);
  });

  it('does not expose the removed desktop callback authorize view or persisted-session probe', () => {
    const authFlowSource = readAuthSource('hooks/use-auth-flow.ts');
    const authTypesSource = readAuthSource('types/auth-types.ts');

    expect(authFlowSource).not.toMatch(/desktopCallbackRequest/);
    expect(authFlowSource).not.toMatch(/desktopProbeStatus/);
    expect(authFlowSource).not.toMatch(/desktop_authorize/);
    expect(authFlowSource).not.toMatch(/restoreSession\?\.\(\)/);
    expect(authTypesSource).not.toMatch(/DesktopCallbackRequest/);
  });

  it('does not keep the removed web-session relay token exchange path', () => {
    const authMenuHandlersExtSource = readAuthSource('logic/auth-menu-handlers-ext.ts');
    const shellAuthPageSource = readAuthSource('components/shell-auth-page.tsx');

    expect(authMenuHandlersExtSource)
      .not.toMatch(/export\s+async\s+function\s+handleConfirmDesktopAuthorization/);
    expect(authMenuHandlersExtSource).not.toMatch(/submitDesktopCallbackResult/);
    expect(shellAuthPageSource).not.toMatch(/result\.accessToken/);
    expect(shellAuthPageSource).not.toMatch(/result\.refreshToken/);
    expect(shellAuthPageSource).not.toMatch(/adapter\.applyToken\(result\./);
  });

  it('keeps the email password setup view in the embedded auth type model', () => {
    const authTypesSource = readAuthSource('types/auth-types.ts');

    expect(authTypesSource).toMatch(/\|\s*'email_set_password'/);
    expect(authTypesSource).toMatch(/export type EmbeddedAuthStage = 'logo' \| 'email' \| 'credential'/);
  });

  it('keeps inline embedded auth stages and clears temporary onboarding auth', () => {
    const authFlowSource = readAuthSource('hooks/use-auth-flow.ts');

    expect(authFlowSource).toMatch(/const \[embeddedStage, setEmbeddedStage\] = useState<EmbeddedAuthStage>\('logo'\)/);
    expect(authFlowSource).toMatch(/const \[showAlternatives, setShowAlternatives\] = useState\(false\)/);
    expect(authFlowSource).toMatch(/const \[twoFactorReturnView, setTwoFactorReturnView\] = useState<AuthView>\('main'\)/);
    expect(authFlowSource).toMatch(/const clearPendingOnboardingState = \(\) => \{/);
    expect(authFlowSource).toMatch(/void adapter\.applyToken\(''\)/);
    expect(authFlowSource).toMatch(/if \(view === 'email_otp_verify'\) \{\s*setOtpCode\(''\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
    expect(authFlowSource).toMatch(/else if \(view === 'email_set_password'\) \{\s*clearPendingOnboardingState\(\);\s*clearOtpFlowState\(\);\s*setView\('main'\);\s*setEmbeddedStage\('credential'\);/s);
    expect(authFlowSource).toMatch(/else if \(view === 'email_2fa'\) \{\s*setTempToken\(''\);\s*setTwoFactorCode\(''\);/s);
    expect(authFlowSource).toMatch(/else if \(view === 'wallet_select'\) \{\s*setView\('main'\);\s*setEmbeddedStage\('email'\);\s*setShowAlternatives\(true\);/s);
  });

  it('keeps inline credential and OTP view contracts', () => {
    const authViewEmailSource = readAuthSource('components/auth-view-email.tsx');

    expect(authViewEmailSource).toMatch(/export function AuthViewEmailLogin/);
    expect(authViewEmailSource).toMatch(/data-testid=\{testIds\?\.passwordInput\}/);
    expect(authViewEmailSource).toMatch(/data-testid=\{testIds\?\.otpButton\}/);
    expect(authViewEmailSource).toMatch(/t\('Auth\.useEmailCodeInstead'\)/);
    expect(authViewEmailSource).toMatch(/export function AuthViewEmailSetPassword/);
    expect(authViewEmailSource).toMatch(/t\('Auth\.setPasswordHint'\)/);
    expect(authViewEmailSource).toMatch(/t\('Auth\.verifyAndContinue'\)/);
  });
});
