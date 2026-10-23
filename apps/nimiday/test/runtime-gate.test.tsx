// @vitest-environment jsdom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { RuntimeGate, runtimeGateIssue, type RuntimeGateProjection } from '../src/shell/runtime-gate.js';
import { copyFor } from '../src/nimiday/i18n/index.js';
import { readLanguagePreference, rememberLanguagePreference, useAppLanguage } from '../src/nimiday/i18n/language-preference.js';
import type { LanguagePreference } from '../src/nimiday/domain/types.js';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

const untrusted = {
  status: 'unavailable', reasonCode: 'runtime-service-untrusted', message: 'Identity rejected',
  actionHint: 'restart_fixed_runtime_service', retryable: false,
} as const;
const toError = (error: unknown) => ({ status: 'unavailable' as const, reasonCode: 'connection-check-failed', message: String(error) });

it('checks again, prevents duplicate requests, retains the latest refusal, and only mounts the App after ready', async () => {
  const waiting: Array<(value: RuntimeGateProjection) => void> = [];
  const resolve = vi.fn(() => new Promise<RuntimeGateProjection>(done => waiting.push(done)));
  const clear = vi.fn();
  const mounted = vi.fn();
  function Product() { useEffect(mounted, []); return <div data-product>Ready</div>; }
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container);
  const render = (language: 'zh' | 'en') => root.render(<RuntimeGate appTitle="NimiDay" copy={copyFor(language).runtimeGate}
    resolve={resolve} clear={clear} toError={toError}><Product /></RuntimeGate>);
  try {
    await act(async () => { render('zh'); });
    expect(container.textContent).toContain('正在连接 Nimi');
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(mounted).not.toHaveBeenCalled();
    // The carrier can mark a new status check retryable while trust is still refused.
    // The UI must still ask the user to check again after repairing the service.
    await act(async () => { waiting.shift()!({ ...untrusted, retryable: true }); });
    expect(container.querySelector('h1')!.textContent).toBe('无法验证 Nimi 服务');
    expect(container.querySelector('details')!.open).toBe(false);
    expect(container.querySelector('button')!.textContent).toContain('重新检查');
    await act(async () => { render('en'); });
    expect(container.querySelector('h1')!.textContent).toBe('Unable to verify the Nimi service');
    expect(resolve).toHaveBeenCalledTimes(1);
    await act(async () => { container.querySelector('button')!.click(); container.querySelector('button')!.click(); });
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(clear).toHaveBeenCalledTimes(2);
    expect(container.querySelector('button')!.disabled).toBe(true);
    expect(mounted).not.toHaveBeenCalled();
    await act(async () => { waiting.shift()!({ ...untrusted, reasonCode: 'runtime-service-unavailable', retryable: true }); });
    expect(container.querySelector('h1')!.textContent).toBe('Unable to connect to Nimi');
    expect(container.textContent).toContain('Still unable to connect');
    await act(async () => { container.querySelector('button')!.click(); });
    await act(async () => { waiting.shift()!({ status: 'ready' }); });
    expect(mounted).toHaveBeenCalledTimes(1);
    await act(async () => { render('zh'); });
    expect(mounted).toHaveBeenCalledTimes(1);
    expect(resolve).toHaveBeenCalledTimes(3);
  } finally { await act(async () => root.unmount()); container.remove(); }
});

it('shows a rejected check as a failure and ignores a late check from an obsolete effect', async () => {
  let complete!: (value: RuntimeGateProjection) => void;
  const old = () => new Promise<RuntimeGateProjection>(done => { complete = done; });
  const refused = async () => { throw new Error('Carrier refused'); };
  const clear = vi.fn();
  const container = document.createElement('div'); const root = createRoot(container);
  const render = (resolve: () => Promise<RuntimeGateProjection>) => root.render(<RuntimeGate appTitle="NimiDay"
    copy={copyFor('zh').runtimeGate} clear={clear} toError={toError} resolve={resolve}><div data-product /></RuntimeGate>);
  try {
    await act(async () => { render(old); });
    await act(async () => { render(refused); });
    expect(container.querySelector('button')!.disabled).toBe(false);
    expect(container.querySelector('details')!.textContent).toContain('Carrier refused');
    await act(async () => { complete({ status: 'ready' }); });
    expect(container.querySelector('[data-product]')).toBeNull();
    expect(container.querySelector('h1')).not.toBeNull();
  } finally { await act(async () => root.unmount()); }
});

it.each([
  ['runtime-service-untrusted', 'untrusted'], ['runtime-service-repair-required', 'repair'],
  ['runtime-service-unavailable', 'unavailable'], ['runtime-unauthenticated', 'session'],
  ['account-changed', 'session'], ['local-development-registration-required', 'registration'],
  ['project-changed', 'project'], ['access-denied', 'access'], ['protected-carrier-required', 'carrier'],
  ['new-unknown-error', 'unknown'],
])('uses reason-specific guidance for %s', (reason, expected) => { expect(runtimeGateIssue(reason)).toBe(expected); });

it('uses the remembered App language before loading, follows explicit choices and tracks the system for auto', async () => {
  const languages = vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  rememberLanguagePreference('zh');
  function Language({ preference }: { preference?: LanguagePreference }) { return <span>{useAppLanguage(preference)}</span>; }
  const container = document.createElement('div'); const root = createRoot(container);
  try {
    await act(async () => root.render(<Language />));
    expect(container.textContent).toBe('zh');
    await act(async () => rememberLanguagePreference('en'));
    expect(container.textContent).toBe('en');
    await act(async () => root.render(<Language preference="zh" />));
    expect(container.textContent).toBe('zh');
    await act(async () => { rememberLanguagePreference('auto'); root.render(<Language />); });
    expect(container.textContent).toBe('en');
    languages.mockReturnValue(['zh-CN']);
    await act(async () => { window.dispatchEvent(new Event('languagechange')); });
    expect(container.textContent).toBe('zh');
    expect(readLanguagePreference()).toBe('auto');
  } finally { await act(async () => root.unmount()); }
});

it('keeps language startup usable when preference storage is unavailable', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable'); });
  expect(readLanguagePreference()).toBe('auto');
  expect(() => rememberLanguagePreference('zh')).not.toThrow();
});
