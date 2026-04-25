import { describe, expect, it } from 'vitest';
import { validateSandboxSourcePolicy } from './handler-sandbox-policy.js';

describe('validateSandboxSourcePolicy', () => {
  it('accepts a default NAS handler without ambient APIs', () => {
    expect(validateSandboxSourcePolicy(`
      export default {
        async execute(ctx, projection) {
          projection.setSignal("gaze.x", 0.25);
          await projection.triggerMotion(ctx.activity?.name ?? "Idle");
        }
      };
    `)).toEqual({ ok: true });
  });

  it.each(['window', 'document', 'fetch', 'localStorage', 'globalThis', 'self', 'postMessage'])(
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

  it('rejects static and dynamic imports', () => {
    expect(validateSandboxSourcePolicy('import x from "x"; export default { execute() {} };').ok).toBe(false);
    expect(validateSandboxSourcePolicy('export default { async execute() { await import("x"); } };').ok).toBe(false);
  });

  it('rejects non-default module exports', () => {
    expect(validateSandboxSourcePolicy('export const x = 1; export default { execute() {} };').ok).toBe(false);
  });
});
