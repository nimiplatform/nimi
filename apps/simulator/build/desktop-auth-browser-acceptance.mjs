const REAL_EFFECT_RESOURCE_TYPES = new Set(['fetch', 'xhr', 'websocket', 'eventsource']);
const FORBIDDEN_URL = /(?:\/api\/auth\/|oauth\/authorize|runtime|realm)/iu;

export function observeDesktopAuthRequests(page, simulatorOrigin) {
  const forbidden = [];
  const listener = (request) => {
    const url = request.url();
    const resourceType = request.resourceType();
    if (REAL_EFFECT_RESOURCE_TYPES.has(resourceType)
      || (!url.startsWith(`${simulatorOrigin}/`) && url !== simulatorOrigin)
      || (FORBIDDEN_URL.test(url) && resourceType !== 'script')) {
      forbidden.push({ resourceType, method: request.method(), url });
    }
  };
  page.on('request', listener);
  return Object.freeze({
    assertNone() {
      if (forbidden.length > 0) {
        throw new Error(`SIM_DESKTOP_AUTH_REAL_REQUEST:${JSON.stringify(forbidden)}`);
      }
    },
    dispose() { page.off('request', listener); },
  });
}

export async function assertDesktopAuthenticatedShells(page) {
  const desktops = page.locator('.simulator-surface[data-module-id="desktop"]');
  if (await desktops.count() !== 2) throw new Error('SIM_DESKTOP_AUTH_INSTANCE_COUNT');
  for (let index = 0; index < 2; index += 1) {
    const surface = desktops.nth(index);
    if (await surface.locator('[data-testid="main-shell"]:visible').count() !== 1
      || await surface.locator('[data-testid="login-screen"]:visible').count() !== 0
      || await surface.locator('[data-nimi-semantic-id="desktop-main-shell-primary"]:visible').count() !== 1) {
      throw new Error(`SIM_DESKTOP_AUTH_DEFAULT_SHELL:${index}`);
    }
  }
}

export async function assertNoBrowserAuthPersistence(page) {
  const persistence = await page.evaluate(async () => {
    const databases = typeof indexedDB?.databases === 'function'
      ? (await indexedDB.databases()).map((entry) => entry.name ?? '')
      : [];
    return {
      cookie: document.cookie,
      localStorage: Object.keys(localStorage),
      sessionStorage: Object.keys(sessionStorage),
      indexedDatabases: databases,
    };
  });
  if (persistence.cookie !== ''
    || persistence.localStorage.length !== 0
    || persistence.sessionStorage.length !== 0
    || persistence.indexedDatabases.length !== 0) {
    throw new Error(`SIM_DESKTOP_AUTH_PERSISTENCE:${JSON.stringify(persistence)}`);
  }
}

export async function exerciseDesktopAuthIsolation(page) {
  await assertDesktopAuthenticatedShells(page);
  const desktops = page.locator('.simulator-surface[data-module-id="desktop"]');
  const first = desktops.nth(0);
  const second = desktops.nth(1);
  const secondRootId = await second.locator('[data-nimi-semantic-id="desktop-main-root"]').getAttribute('id');
  const secondText = await second.innerText();
  const firstInstanceId = await first.getAttribute('data-instance-id');
  if (!firstInstanceId) throw new Error('SIM_DESKTOP_AUTH_INSTANCE_ID');
  await page.locator(`.simulator-windows__item[data-instance-id="${firstInstanceId}"]`).getByRole('button', { name: 'Full window' }).click();
  await page.getByRole('button', { name: 'Exit full window' }).waitFor({ timeout: 30_000 });

  await first.locator('[data-testid="desktop-account-menu-trigger"]').evaluate((node) => node.click());
  await first.locator('[data-testid="desktop-account-logout"]').evaluate((node) => node.click());
  await first.locator('[data-testid="login-screen"]:visible').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Exit full window' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.simulator-surface:not([hidden])').length === 6);
  if (await first.locator('[data-testid="main-shell"]:visible').count() !== 0
    || await second.locator('[data-testid="main-shell"]:visible').count() !== 1
    || await second.locator('[data-testid="login-screen"]:visible').count() !== 0
    || await second.locator('[data-nimi-semantic-id="desktop-main-root"]').getAttribute('id') !== secondRootId
    || await second.innerText() !== secondText) {
    throw new Error('SIM_DESKTOP_AUTH_LOGOUT_ISOLATION');
  }

  await first.locator('[data-testid="login-logo-trigger"]').evaluate((node) => node.click());
  await first.locator('[data-testid="main-shell"]:visible').waitFor({ timeout: 30_000 });
  await assertDesktopAuthenticatedShells(page);
  return Object.freeze({
    desktopInstanceCount: 2,
    defaultAuthenticated: true,
    firstLogoutIsolated: true,
    deterministicRelogin: true,
    secondRendererUnchanged: true,
  });
}
