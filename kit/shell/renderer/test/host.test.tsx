import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { NimiStandardShellCapabilityError } from '@nimiplatform/kit/shell/capabilities';

import {
  NimiRendererHostProvider,
  createNimiCanonicalRendererHostBindings,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  useNimiRendererHost,
  useNimiRendererTheme,
  type CreateNimiRendererHostBindingInput,
  type NimiRendererHostBindingV1,
  type NimiRendererHostResult,
  type NimiRendererHostMethodSpec,
  type NimiRendererOverlayLease,
  type NimiRendererOverlayPort,
} from '../src/host/index.js';

type TestMethods = {
  readonly 'nimi.shell.test.read': NimiRendererHostMethodSpec<
    { readonly key: string },
    { readonly value: string }
  >;
  readonly 'nimi.shell.test.write': NimiRendererHostMethodSpec<
    { readonly value: string },
    { readonly accepted: boolean }
  >;
};

interface HostFixture {
  readonly binding: NimiRendererHostBindingV1<TestMethods>;
  readonly theme: ReturnType<typeof createNimiRendererThemeController>;
  readonly rendererTarget: HTMLElement;
  readonly overlayTarget: HTMLElement;
  readonly calls: string[];
}

const mountedRoots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of mountedRoots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe('nimi.renderer.host/v1', () => {
  it('constructs one exact canonical envelope and rejects mutable or divergent aliases', () => {
    const host = createHostFixture(
      'scope-canonical',
      ['nimi.shell.test.read'],
      'light',
      'regular',
    );
    const app = Object.freeze({
      projection: Object.freeze({ get: () => ({ value: 'projection' }) }),
      commands: Object.freeze({ invoke: () => Promise.resolve({ accepted: true }) }),
      events: Object.freeze({ subscribe: () => () => {} }),
    });
    const route = Object.freeze({ current: () => '/' });
    const clock = Object.freeze({ now: () => 0 });
    const sdk = Object.freeze({ generateText: () => Promise.resolve({ text: 'fixture' }) });

    const canonical = createNimiCanonicalRendererHostBindings({
      scope: host.binding.facade.scope,
      capabilities: host.binding.facade.capabilities,
      localization: host.binding.facade.localization,
      kit: host.binding.facade,
      sdk,
      app,
      route,
      clock,
      surfaceLifecycle: host.binding.facade.surfaceLifecycle,
    });

    expect(Object.keys(canonical).sort()).toEqual([
      'app',
      'capabilities',
      'clock',
      'kit',
      'localization',
      'protocol',
      'route',
      'scope',
      'sdk',
      'surfaceLifecycle',
    ]);
    expect(canonical.protocol).toBe('nimi.renderer.host/v1');
    expect(canonical.scope).toBe(canonical.kit.scope);
    expect(canonical.capabilities).toBe(canonical.kit.capabilities);
    expect(Object.isFrozen(canonical)).toBe(true);
    expect(Object.isFrozen(canonical.app)).toBe(true);

    expect(() => createNimiCanonicalRendererHostBindings({
      scope: host.binding.facade.scope,
      capabilities: new Set(['nimi.shell.test.read']),
      localization: host.binding.facade.localization,
      kit: host.binding.facade,
      sdk,
      app,
      route,
      clock,
      surfaceLifecycle: host.binding.facade.surfaceLifecycle,
    })).toThrow('NIMI_RENDERER_HOST_CANONICAL_BINDING_CAPABILITIES_INVALID');

    expect(() => createNimiCanonicalRendererHostBindings({
      scope: host.binding.facade.scope,
      capabilities: host.binding.facade.capabilities,
      localization: { ...host.binding.facade.localization },
      kit: host.binding.facade,
      sdk,
      app,
      route,
      clock,
      surfaceLifecycle: host.binding.facade.surfaceLifecycle,
    })).toThrow('NIMI_RENDERER_HOST_CANONICAL_BINDING_KIT_ALIAS_INVALID');
  });

  it('isolates capability, theme, identity, overlay, and cleanup state per provider', async () => {
    const hostA = createHostFixture('scope-alpha', ['nimi.shell.test.read'], 'light', 'compact');
    const hostB = createHostFixture('scope-bravo', ['nimi.shell.test.write'], 'dark', 'regular');
    hostA.rendererTarget.dataset.nimiScheme = 'legacy';
    hostA.rendererTarget.classList.add('preexisting');

    const mountA = appendElement('mount-a');
    const mountB = appendElement('mount-b');
    const rootA = createRoot(mountA);
    const rootB = createRoot(mountB);
    mountedRoots.push(rootA, rootB);

    await act(async () => {
      rootA.render(provider(hostA.binding, <HostProbe label="a" />));
      rootB.render(provider(hostB.binding, <HostProbe label="b" />));
    });

    expect(document.querySelector('[data-probe="a"]')?.getAttribute('id'))
      .toBe('scope-alpha--id--field');
    expect(document.querySelector('[data-probe="b"]')?.getAttribute('id'))
      .toBe('scope-bravo--id--field');
    expect(document.querySelector('[data-probe="a"]')?.textContent).toContain('light:compact');
    expect(document.querySelector('[data-probe="b"]')?.textContent).toContain('dark:regular');

    expect(hostA.rendererTarget.dataset.nimiScheme).toBe('light');
    expect(hostA.overlayTarget.dataset.nimiScheme).toBe('light');
    expect(hostB.rendererTarget.dataset.nimiScheme).toBe('dark');
    expect(hostB.overlayTarget.dataset.nimiScheme).toBe('dark');
    expect(hostA.rendererTarget.getAttribute('dir')).toBe('ltr');
    expect(hostB.rendererTarget.getAttribute('dir')).toBe('rtl');
    expect(hostA.binding.facade.overlays.target).toBe(hostA.overlayTarget);
    expect(hostB.binding.facade.overlays.target).toBe(hostB.overlayTarget);
    expect((hostA.binding.facade.capabilities as Set<string>).add).toBeUndefined();
    expect((hostA.binding.facade.theme as { setSnapshot?: unknown }).setSnapshot).toBeUndefined();
    expect(Object.keys(hostA.binding.facade.theme).sort()).toEqual(['getSnapshot', 'subscribe']);
    const identityLocals = ['svg-gradient', 'form-label', 'radio-group', 'fragment-target'];
    const identitiesA = identityLocals.map((local) => hostA.binding.facade.scope.domId(local));
    const identitiesB = identityLocals.map((local) => hostB.binding.facade.scope.domId(local));
    expect(new Set([...identitiesA, ...identitiesB]).size).toBe(identityLocals.length * 2);
    expect(hostA.binding.facade.scope.globalName('radio-group'))
      .not.toBe(hostB.binding.facade.scope.globalName('radio-group'));

    await expect(hostA.binding.facade.invoke('nimi.shell.test.read', { key: 'one' }))
      .resolves.toEqual({ value: 'scope-alpha:one' });
    await expect(hostB.binding.facade.invoke('nimi.shell.test.write', { value: 'two' }))
      .resolves.toEqual({ accepted: true });
    expect(hostA.calls).toEqual(['nimi.shell.test.read']);
    expect(hostB.calls).toEqual(['nimi.shell.test.write']);

    await expect(hostA.binding.facade.invoke('nimi.shell.test.write', { value: 'denied' }))
      .rejects.toMatchObject({
        envelope: {
          code: 'capability-unavailable',
          reasonCode: 'renderer-host-capability-denied',
          source: 'host',
        },
      });
    expect(hostB.calls).toEqual(['nimi.shell.test.write']);

    await act(async () => {
      hostA.theme.setSnapshot({
        scheme: 'dark',
        accentPack: 'nimi-accent',
        density: 'expressive',
      });
    });
    expect(hostA.rendererTarget.dataset.nimiScheme).toBe('dark');
    expect(hostA.rendererTarget.dataset.nimiDensity).toBe('expressive');
    expect(hostB.rendererTarget.dataset.nimiScheme).toBe('dark');
    expect(hostB.rendererTarget.dataset.nimiDensity).toBeUndefined();

    await act(async () => rootA.unmount());
    mountedRoots.splice(mountedRoots.indexOf(rootA), 1);
    expect(hostA.rendererTarget.dataset.nimiScheme).toBe('legacy');
    expect(hostA.rendererTarget.classList.contains('preexisting')).toBe(true);
    expect(hostA.overlayTarget.dataset.nimiScheme).toBeUndefined();
    expect(hostB.rendererTarget.dataset.nimiScheme).toBe('dark');
    expect(Object.hasOwn(globalThis, '__NIMI_RENDERER_HOST__')).toBe(false);
  });

  it('maps every provider disposition to the closed standard-shell error surface', async () => {
    const dispositions = [
      ['unsupported', 'capability-unavailable'],
      ['capability-denied', 'capability-unavailable'],
      ['resource-exhausted', 'resource-exhausted'],
      ['invalid-input', 'invalid-payload'],
      ['host-unavailable', 'capability-unavailable'],
      ['effect-forbidden', 'forbidden-renderer-access'],
      ['internal', 'host-internal-error'],
    ] as const;

    for (const [disposition, standardCode] of dispositions) {
      const fixture = createHostFixture('scope-errors', ['nimi.shell.test.read'], 'light', 'regular', disposition);
      try {
        await fixture.binding.facade.invoke('nimi.shell.test.read', { key: 'failure' });
        throw new Error('expected renderer host call to fail');
      } catch (error) {
        expect(error).toBeInstanceOf(NimiStandardShellCapabilityError);
        expect((error as NimiStandardShellCapabilityError).envelope.code).toBe(standardCode);
        expect((error as NimiStandardShellCapabilityError).envelope.details)
          .toEqual({ method: 'nimi.shell.test.read' });
      }
    }
  });

  it('rejects ambiguous targets, undeclared capabilities, and non-opaque scope prefixes', () => {
    const fixture = createHostFixture('scope-valid', ['nimi.shell.test.read'], 'light', 'regular');
    const base = createBindingInput(
      'scope-valid-two',
      fixture.rendererTarget,
      fixture.overlayTarget,
      fixture.theme,
      ['nimi.shell.test.read'],
      [],
    );

    expect(() => createNimiRendererHostBinding({
      ...base,
      targets: { renderer: fixture.rendererTarget, overlay: fixture.rendererTarget },
    })).toThrow('NIMI_RENDERER_HOST_TARGETS_INVALID');
    expect(() => createNimiRendererHostBinding({
      ...base,
      capabilities: ['nimi.shell.test.write'],
    })).toThrow('NIMI_RENDERER_HOST_CAPABILITY_UNDECLARED');
    expect(() => createNimiRendererHostBinding({
      ...base,
      declaredMethods: ['nimi.shell.test.read', 'nimi.shell.test.read'],
    })).toThrow('NIMI_RENDERER_HOST_METHOD_DUPLICATE');
    expect(() => createNimiRendererHostBinding({
      ...base,
      opaqueScopePrefix: 'raw:instance:1',
    })).toThrow('NIMI_RENDERER_HOST_SCOPE_PREFIX_INVALID');
  });

  it('normalizes provider throws across operations, overlays, and lifecycle callbacks', async () => {
    const rendererTarget = appendElement('normalize-renderer');
    const overlayTarget = appendElement('normalize-overlay');
    const theme = createNimiRendererThemeController({
      scheme: 'light',
      accentPack: 'nimi-accent',
      density: 'regular',
    });
    const binding = createNimiRendererHostBinding({
      ...createBindingInput(
        'scope-normalize',
        rendererTarget,
        overlayTarget,
        theme,
        ['nimi.shell.test.read'],
        ['nimi.shell.test.read'],
      ),
      operations: {
        async invoke() {
          throw new Error('private operation detail');
        },
      },
      overlays: {
        target: overlayTarget,
        async acquire() {
          throw new Error('private overlay detail');
        },
      },
      surfaceLifecycle: {
        reportReadyCandidate() {
          throw new Error('private lifecycle detail');
        },
      },
    });

    await expect(binding.facade.invoke('nimi.shell.test.read', { key: 'value' }))
      .rejects.toMatchObject({ envelope: { code: 'host-internal-error' } });
    await expect(binding.facade.overlays.acquire(modalOptions()))
      .resolves.toEqual({ ok: false, error: { disposition: 'internal' } });
    expect(() => binding.facade.surfaceLifecycle.reportReadyCandidate({ contractId: 'main-ready' }))
      .toThrow(NimiStandardShellCapabilityError);
  });

  it('rejects extended host envelopes, lease surfaces, and malformed overlay nodes', async () => {
    const rendererTarget = appendElement('exact-renderer');
    const overlayTarget = appendElement('exact-overlay');
    const theme = createNimiRendererThemeController({
      scheme: 'light',
      accentPack: 'nimi-accent',
      density: 'regular',
    });
    let registerCalls = 0;
    const lease: NimiRendererOverlayLease = {
      state: () => 'open',
      registerNodes: () => {
        registerCalls += 1;
        return { ok: true, value: { registered: true } };
      },
      subscribeDismiss: () => ({ ok: true, value: () => undefined }),
      requestDismiss: async () => ({ ok: true, value: { requested: true } }),
      acknowledgeContentUnmounted: async () => ({ ok: true, value: { released: true } }),
    };
    const binding = createNimiRendererHostBinding({
      ...createBindingInput(
        'scope-exact',
        rendererTarget,
        overlayTarget,
        theme,
        ['nimi.shell.test.read'],
        ['nimi.shell.test.read'],
      ),
      operations: {
        async invoke() {
          return {
            ok: true,
            value: { value: 'not-admitted' },
            extension: true,
          } as unknown as NimiRendererHostResult<{ readonly value: string }>;
        },
      },
      overlays: {
        target: overlayTarget,
        async acquire() {
          return { ok: true, value: lease };
        },
      },
    });

    await expect(binding.facade.invoke('nimi.shell.test.read', { key: 'value' }))
      .rejects.toMatchObject({ envelope: { code: 'host-internal-error' } });
    const acquired = await binding.facade.overlays.acquire(modalOptions());
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    expect(acquired.value.registerNodes({
      trigger: null,
      content: overlayTarget,
      initialFocus: null,
      fallbackFocus: null,
      returnFocus: null,
      extension: true,
    } as never)).toEqual({ ok: false, error: { disposition: 'invalid-input' } });
    expect(registerCalls).toBe(0);

    const extendedLeaseBinding = createNimiRendererHostBinding({
      ...createBindingInput(
        'scope-exact-lease',
        appendElement('exact-lease-renderer'),
        appendElement('exact-lease-overlay'),
        theme,
        [],
        [],
      ),
      overlays: {
        target: document.getElementById('exact-lease-overlay') as HTMLElement,
        async acquire() {
          return { ok: true, value: { ...lease, extension: true } as never };
        },
      },
    });
    await expect(extendedLeaseBinding.facade.overlays.acquire(modalOptions()))
      .resolves.toEqual({ ok: false, error: { disposition: 'internal' } });
  });
});

function HostProbe({ label }: { readonly label: string }) {
  const host = useNimiRendererHost<TestMethods>();
  const theme = useNimiRendererTheme();
  return (
    <div
      data-probe={label}
      id={host.scope.domId('field')}
      data-global-name={host.scope.globalName('field')}
    >
      {`${theme.scheme}:${theme.density}:${[...host.capabilities].join(',')}`}
    </div>
  );
}

function provider(
  binding: NimiRendererHostBindingV1<TestMethods>,
  child: ReactElement,
): ReactElement {
  return <NimiRendererHostProvider binding={binding}>{child}</NimiRendererHostProvider>;
}

function createHostFixture(
  prefix: string,
  capabilities: readonly (keyof TestMethods & string)[],
  scheme: 'light' | 'dark',
  density: 'compact' | 'regular' | 'expressive',
  failureDisposition?: Parameters<typeof createBindingInput>[6],
): HostFixture {
  const rendererTarget = appendElement(`${prefix}-renderer`);
  const overlayTarget = appendElement(`${prefix}-overlay`);
  const theme = createNimiRendererThemeController({
    scheme,
    accentPack: 'nimi-accent',
    density,
  });
  const calls: string[] = [];
  const binding = createNimiRendererHostBinding(createBindingInput(
    prefix,
    rendererTarget,
    overlayTarget,
    theme,
    ['nimi.shell.test.read', 'nimi.shell.test.write'],
    capabilities,
    failureDisposition,
    calls,
  ));
  return { binding, theme, rendererTarget, overlayTarget, calls };
}

function createBindingInput(
  prefix: string,
  rendererTarget: HTMLElement,
  overlayTarget: HTMLElement,
  theme: ReturnType<typeof createNimiRendererThemeController>,
  declaredMethods: readonly (keyof TestMethods & string)[],
  capabilities: readonly (keyof TestMethods & string)[],
  failureDisposition?: 'unsupported' | 'capability-denied' | 'resource-exhausted'
    | 'invalid-input' | 'host-unavailable' | 'effect-forbidden' | 'internal',
  calls: string[] = [],
): CreateNimiRendererHostBindingInput<TestMethods> {
  const overlays: NimiRendererOverlayPort = {
    target: overlayTarget,
    async acquire() {
      return { ok: false, error: { disposition: 'unsupported' } };
    },
  };
  return {
    opaqueScopePrefix: prefix,
    declaredMethods,
    capabilities,
    localization: {
      locale: prefix.endsWith('bravo') ? 'ar' : 'en-US',
      language: prefix.endsWith('bravo') ? 'ar' : 'en',
      direction: prefix.endsWith('bravo') ? 'rtl' : 'ltr',
    },
    targets: { renderer: rendererTarget, overlay: overlayTarget },
    theme,
    operations: {
      async invoke(method, input) {
        calls.push(method);
        if (failureDisposition) return { ok: false, error: { disposition: failureDisposition } };
        if (method === 'nimi.shell.test.read') {
          return { ok: true, value: { value: `${prefix}:${input.key}` } };
        }
        return { ok: true, value: { accepted: input.value.length > 0 } };
      },
    },
    overlays,
    surfaceLifecycle: { reportReadyCandidate() {} },
  };
}

function modalOptions() {
  return {
    kind: 'dialog' as const,
    modal: true,
    dismissOnEscape: true,
    dismissOnOutsidePointer: true,
    returnFocus: true,
    initialFocusSemanticId: null,
    returnFocusSemanticId: null,
    scrollLock: 'simulator-root' as const,
    ariaLabel: 'Fixture dialog',
  };
}

function appendElement(id: string): HTMLElement {
  const element = document.createElement('div');
  element.id = id;
  document.body.append(element);
  return element;
}
