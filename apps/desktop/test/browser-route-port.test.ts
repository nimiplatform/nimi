import assert from 'node:assert/strict';
import test from 'node:test';

test('browser route port retains navigation that happens before its first subscriber', async () => {
  const globalRecord = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis;
    PopStateEvent?: typeof PopStateEvent;
  };
  const previousWindow = globalRecord.window;
  const previousPopStateEvent = globalRecord.PopStateEvent;
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const location = {
    hash: '#/',
    origin: 'http://127.0.0.1:1420',
    href: 'http://127.0.0.1:1420/#/',
  };
  const history = {
    state: null as unknown,
    go(delta: number) {
      void delta;
    },
    pushState(state: unknown, _unused: string, href: string | URL | null) {
      history.state = state;
      updateLocation(String(href || ''));
    },
    replaceState(state: unknown, _unused: string, href: string | URL | null) {
      history.state = state;
      updateLocation(String(href || ''));
    },
  };
  const updateLocation = (href: string) => {
    location.hash = href.startsWith('#') ? href : `#${href}`;
    location.href = `${location.origin}/${location.hash}`;
  };
  const fakeWindow = {
    location,
    history,
    addEventListener(type: string, listener: (event: Event) => void) {
      const registered = listeners.get(type) || new Set();
      registered.add(listener);
      listeners.set(type, registered);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    dispatchEvent(event: Event) {
      for (const listener of listeners.get(event.type) || []) listener(event);
      return true;
    },
  };
  class FakePopStateEvent {
    readonly type: string;

    constructor(type: string) {
      this.type = type;
    }
  }

  globalRecord.window = fakeWindow as unknown as Window & typeof globalThis;
  globalRecord.PopStateEvent = FakePopStateEvent as unknown as typeof PopStateEvent;
  try {
    const { createDesktopBrowserRoutePort } = await import(
      '../src/shell/renderer/renderer/browser-route-port.js'
    );
    const route = createDesktopBrowserRoutePort();

    route.navigate({ to: '/login', replace: true });
    assert.equal(route.get().pathname, '/login');

    let notifications = 0;
    const unsubscribe = route.subscribe(() => {
      notifications += 1;
    });
    route.navigate({ to: '/settings', replace: false, state: { source: 'test' } });
    assert.equal(route.get().pathname, '/settings');
    assert.equal(
      (route.get().state as { source?: string } | null)?.source,
      'test',
    );
    assert.equal(notifications, 1);
    unsubscribe();
  } finally {
    if (previousWindow) globalRecord.window = previousWindow;
    else Reflect.deleteProperty(globalRecord, 'window');
    if (previousPopStateEvent) globalRecord.PopStateEvent = previousPopStateEvent;
    else Reflect.deleteProperty(globalRecord, 'PopStateEvent');
  }
});
