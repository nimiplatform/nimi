(function () {
  const acceptanceUrl = new URL(window.location.href);
  if (acceptanceUrl.searchParams.get('nimiElectronSdkAcceptance') !== '1') {
    acceptanceUrl.searchParams.set('nimiElectronSdkAcceptance', '1');
    window.location.replace(acceptanceUrl.href);
    return;
  }
  if (window.__NIMI_TESTER_TAURI_SHARED_AUTH_PROBE_STARTED__) return;
  window.__NIMI_TESTER_TAURI_SHARED_AUTH_PROBE_STARTED__ = true;
  const invoke = window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const waitFor = async (read, label, timeoutMs = 60000) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = read();
      if (value) return value;
      await sleep(100);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const visible = (element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== 'hidden' && style.display !== 'none' && rect.width > 0 && rect.height > 0;
  };
  const accessibleName = (element) => {
    const labelledBy = element.getAttribute('aria-labelledby');
    const labelledText = labelledBy ? labelledBy.split(/\s+/u).map((id) => document.getElementById(id)?.textContent || '').join(' ') : '';
    const label = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || '' : '';
    return [element.getAttribute('aria-label'), labelledText, label, element.getAttribute('title'), element.getAttribute('placeholder'), element.textContent]
      .map((value) => String(value || '').trim()).find(Boolean) || '';
  };
  const inspect = () => {
    const controls = [...document.querySelectorAll('button, input, textarea, select, a[href], [role="button"]')].filter(visible);
    const inputText = [...document.querySelectorAll('input, textarea')].map((element) => String(element.value || '')).join('\n');
    const readableText = `${document.body?.innerText || ''}\n${inputText}`;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      lang: document.documentElement.lang || null,
      landmarkCount: document.querySelectorAll('main, [role="main"], section[aria-label]').length,
      visibleControlCount: controls.length,
      disabledControlCount: controls.filter((element) => element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true').length,
      unlabeledControls: controls.filter((element) => !accessibleName(element)).map((element) => element.outerHTML.slice(0, 240)),
      smallControls: controls.filter((element) => !element.hasAttribute('disabled'))
        .map((element) => ({ name: accessibleName(element), rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width < 20 || rect.height < 20)
        .map(({ name, rect }) => ({ name, width: Math.round(rect.width), height: Math.round(rect.height) })),
      horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      chineseVisible: /[\u3400-\u9fff]/u.test(readableText),
      longTextVisible: readableText.includes('共享账户授权由运行时统一托管'),
      bodyText: String(document.body?.innerText || '').slice(0, 5000),
    };
  };
  const write = (command, payload) => invoke(command, { payload });
  const run = async () => {
    if (typeof invoke !== 'function') throw new Error('Tauri invoke bridge unavailable');
    const hook = await waitFor(() => window.__NIMI_TESTER_ELECTRON_SDK_ACCEPTANCE__, 'SDK acceptance hook');
    const runtimeReady = await hook.runtimeReady();
    const installedProjection = await hook.installedProjection();
    const installedArtifactRead = await hook.installedArtifactRead();
    try {
      await waitFor(
        () => document.querySelector('[data-testid="nimi-tester-workbench"]'),
        'Tester product workbench',
        15000,
      );
    } catch (error) {
      throw new Error(`${error.message}; runtimeReady=${JSON.stringify(runtimeReady)} installedProjection=${JSON.stringify(installedProjection)} installedArtifactRead=${JSON.stringify(installedArtifactRead)} body=${String(document.body?.innerText || '').slice(0, 3000)}`);
    }
    const sessionCommands = await Promise.all(['auth_session_load', 'auth_session_save', 'auth_session_clear'].map(async (command) => {
      try {
        await invoke(command, {});
        return { command, denied: false };
      } catch (error) {
        return { command, denied: true, message: error instanceof Error ? error.message : String(error) };
      }
    }));
    const textStudioNav = await waitFor(
      () => [...document.querySelectorAll('[data-workbench-rail-item]')]
        .find((element) => element.getAttribute('aria-label') === 'Text Studio'),
      'Text Studio navigation',
    );
    textStudioNav.click();
    const input = await waitFor(
      () => document.querySelector('textarea[aria-label="Text Studio request"]:not([disabled])'),
      'Text Studio request input',
    );
    const longChinese = '共享账户授权由运行时统一托管；这个长文本用于验证窄屏换行、中文可读性以及输入框在真实 Tauri 桌面外壳中的可用性。';
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, longChinese);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-workbench-account-trigger]')?.click();
    await waitFor(() => document.querySelector('[data-workbench-account-panel]'), 'account panel');
    const desktopOwnedAccountControlDisabled = document.querySelectorAll('[data-workbench-account-panel] button:disabled').length > 0;
    const desktop = inspect();
    await write('tester_renderer_probe_ping', { stage: 'shared-auth-desktop-ready' });
    await sleep(5000);
    await invoke('tester_acceptance_window_set_size', { width: 400, height: 760 });
    await sleep(800);
    const narrow = inspect();
    await write('tester_renderer_probe_ping', { stage: 'shared-auth-narrow-ready' });
    await sleep(5000);
    const projectionAfterInteraction = await hook.installedProjection();
    const artifactAfterInteraction = await hook.installedArtifactRead();
    const browserProjection = {
      localStorage: { ...localStorage },
      sessionStorage: { ...sessionStorage },
      html: document.documentElement.outerHTML,
      bodyText: document.body?.innerText || '',
      windowStrings: Object.fromEntries(Object.getOwnPropertyNames(window).flatMap((key) => {
        try {
          const value = window[key];
          return typeof value === 'string' && value.length < 4096 ? [[key, value]] : [];
        } catch { return []; }
      })),
    };
    const raw = JSON.stringify({ browserProjection, runtimeReady, installedProjection, installedArtifactRead });
    const tokenLeakFindings = [];
    if (/Bearer\s+[A-Za-z0-9._~-]{12,}/u.test(raw)) tokenLeakFindings.push('Bearer-shaped credential in renderer projection');
    if (/refresh[_-]?token["'=:\s]+[A-Za-z0-9._~-]{8,}/iu.test(raw)) tokenLeakFindings.push('refresh-token-shaped credential in renderer projection');
    const problems = window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__ || [];
    await write('tester_renderer_probe_report_write', {
      stage: 'shared-auth-complete',
      ok: true,
      runtimeReady,
      installedProjection,
      installedArtifactRead,
      sessionCommands,
      desktopOwnedAccountControlDisabled,
      interaction: { kind: 'workbench-input-and-account-owner', value: input.value, usable: !input.disabled },
      accessibility: { desktop, narrow },
      failure: { observed: true, installedProjection: projectionAfterInteraction, installedArtifactRead: artifactAfterInteraction },
      tokenLeak: { passed: tokenLeakFindings.length === 0, findings: tokenLeakFindings, inspected: ['DOM', 'localStorage', 'sessionStorage', 'window string globals', 'acceptance hook results'] },
      consoleErrors: problems.filter((item) => item.kind === 'console.error'),
      pageErrors: problems.filter((item) => item.kind !== 'console.error'),
    });
  };
  run().catch((error) => write('tester_renderer_probe_report_write', {
    stage: 'shared-auth-complete',
    ok: false,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : { message: String(error) },
    body: String(document.body?.innerText || '').slice(0, 6000),
    workbench: document.querySelector('[data-testid="nimi-tester-workbench"]')?.outerHTML.slice(0, 12000) || null,
    railItems: [...document.querySelectorAll('[data-workbench-rail-item]')].map((element) => ({
      ariaLabel: element.getAttribute('aria-label'),
      text: String(element.textContent || '').trim(),
      outerHTML: element.outerHTML.slice(0, 1000),
    })),
    textareas: [...document.querySelectorAll('textarea')].map((element) => ({
      ariaLabel: element.getAttribute('aria-label'),
      disabled: element.disabled,
      outerHTML: element.outerHTML.slice(0, 1000),
    })),
    documentElement: document.documentElement.outerHTML.slice(0, 12000),
    problems: window.__NIMI_TESTER_SHELL_ACCEPTANCE_PROBLEMS__ || [],
  }));
})();
