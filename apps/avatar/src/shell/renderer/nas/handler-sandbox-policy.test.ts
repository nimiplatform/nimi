import { describe, expect, it } from 'vitest';
import { validateSandboxSourcePolicy } from './handler-sandbox-policy.js';

describe('validateSandboxSourcePolicy', () => {
  it('accepts a default NAS handler without ambient APIs', () => {
    expect(validateSandboxSourcePolicy(`
      export default {
        async execute(ctx, projection) {
          await projection.setExpression("focus");
          await projection.triggerMotion(ctx.activity?.name ?? "Idle", { loop: false });
        }
      };
    `)).toEqual({ ok: true });
  });

  it('accepts authority-owned cue projection methods', () => {
    expect(validateSandboxSourcePolicy(`
      export default {
        async execute(ctx, projection) {
          projection.setSignal("ParamMouthOpenY", 1, 0.5);
          projection.addSignal("ParamMouthOpenY", -0.25);
          projection.getSignal("ParamMouthOpenY");
          projection.setPose("lean_in", true);
          projection.clearPose();
          projection.stopMotion();
          projection.clearExpression();
          await projection.wait(120);
          projection.getSurfaceBounds();
        }
      };
    `)).toEqual({ ok: true });
  });

  it('rejects app-local projection calls on creator-facing NAS handlers', () => {
    const result = validateSandboxSourcePolicy(`
      export default {
        async execute(ctx, projection) {
          projection.applyMotion({ routeId: "Idle" });
        }
      };
    `);
    expect(result).toEqual({
      ok: false,
      reason: 'NAS handler projection method is outside the authority-owned cue surface: applyMotion',
    });
  });

  it('rejects branch-local Live2D extension shortcuts', () => {
    const result = validateSandboxSourcePolicy(`
      export default {
        async execute(ctx, projection, options) {
          options.extension.live2d.setParameter("ParamMouthOpenY", 1);
        }
      };
    `);
    expect(result).toEqual({
      ok: false,
      reason: 'NAS handler must use authority-owned projection methods instead of branch-local extension.live2d shortcuts',
    });
  });

  it('rejects retired creator capability declarations', () => {
    const result = validateSandboxSourcePolicy(`
      export default {
        requires: ['live2d-extension'],
        async execute(ctx, projection) {
          projection.setSignal("ParamMouthOpenY", 1);
        }
      };
    `);
    expect(result).toEqual({
      ok: false,
      reason: 'NAS handler capability declarations are retired for creator code; use authority-owned projection methods',
    });
  });

  it('rejects unsupported creator capability declarations', () => {
    const result = validateSandboxSourcePolicy(`
      export default {
        requires: ['unknown-capability'],
        async execute(ctx, projection) {
          projection.setExpression("focus");
        }
      };
    `);
    expect(result).toEqual({
      ok: false,
      reason: 'NAS handler capability declarations are retired for creator code; use authority-owned projection methods',
    });
  });

  it.each([
    'window',
    'document',
    'fetch',
    'localStorage',
    'sessionStorage',
    'indexedDB',
    'caches',
    'XMLHttpRequest',
    'WebSocket',
    'EventSource',
    'globalThis',
    'self',
    'postMessage',
    'eval',
    'Function',
    'constructor',
  ])(
    'rejects ambient global access to %s',
    (identifier) => {
      const result = validateSandboxSourcePolicy(`
        export default {
          async execute() {
            ${identifier};
          }
        };
      `);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toContain(identifier);
      }
    },
  );

  it('rejects computed ambient global access', () => {
    const result = validateSandboxSourcePolicy(`
      export default {
        async execute() {
          const makeFn = ({})["constructor"]["constructor"];
          return makeFn("return 1")();
        }
      };
    `);
    expect(result).toEqual({
      ok: false,
      reason: 'NAS sandbox forbids computed ambient global access: constructor',
    });
  });

  it('rejects package, side-effect, dynamic, and out-of-tree imports', () => {
    expect(validateSandboxSourcePolicy('import x from "x"; export default { execute() {} };').ok).toBe(false);
    expect(validateSandboxSourcePolicy('import "x"; export default { execute() {} };').ok).toBe(false);
    expect(validateSandboxSourcePolicy('export default { async execute() { await import("x"); } };').ok).toBe(false);
    expect(validateSandboxSourcePolicy(
      'import { x } from "../outside.js"; export default { execute() { x(); } };',
      { allowLibImports: true },
    ).ok).toBe(false);
  });

  it('admits only named static imports from runtime/nimi/lib when explicitly allowed', () => {
    expect(validateSandboxSourcePolicy(
      'import { clamp } from "../lib/clamp.js"; export default { execute() { clamp(1, 0, 2); } };',
      { allowLibImports: true, sourcePath: '/model/runtime/nimi/activity/happy.js' },
    )).toEqual({ ok: true });
    expect(validateSandboxSourcePolicy(
      'import clamp from "../lib/clamp.js"; export default { execute() { clamp(1, 0, 2); } };',
      { allowLibImports: true, sourcePath: '/model/runtime/nimi/activity/happy.js' },
    ).ok).toBe(false);
  });

  it('allows ctx.app.window without admitting ambient window access', () => {
    expect(validateSandboxSourcePolicy(
      'export default { update(ctx, projection) { projection.triggerMotion(String(ctx.app.window.width)); } };',
      { sourcePath: '/model/runtime/nimi/continuous/eye_tracker.js' },
    )).toEqual({ ok: true });
    expect(validateSandboxSourcePolicy(
      'export default { execute() { return window.innerWidth; } };',
      { sourcePath: '/model/runtime/nimi/activity/happy.js' },
    )).toEqual({
      ok: false,
      reason: 'NAS sandbox forbids ambient global access: window',
    });
  });

  it('rejects non-default module exports', () => {
    expect(validateSandboxSourcePolicy('export const x = 1; export default { execute() {} };').ok).toBe(false);
  });

  it('rejects source paths outside runtime/nimi and non-js sources', () => {
    expect(validateSandboxSourcePolicy('export default { execute() {} };', {
      sourcePath: '/model/runtime/nimi/activity/happy.ts',
    }).ok).toBe(false);
    expect(validateSandboxSourcePolicy('export default { execute() {} };', {
      sourcePath: '/model/runtime/other/happy.js',
    }).ok).toBe(false);
  });
});
