import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateModelPickerSelectionAdapterSource,
} from './check-runtime-target-identity-v2.mjs';

const validAdapterSource = `
export function pickerSelectionToTargetRef(selection) {
  if (selection.source === 'cloud') {
    const providerModelId = normalizeText(selection.providerModelId) || normalizeText(selection.model);
    return { kind: 'cloud-connector', providerModelId };
  }

  const profileBindingId = normalizeText(selection.profileBindingId);
  const readinessRef = normalizeText(selection.readinessRef);
  if (profileBindingId && readinessRef) {
    return null;
  }
  if (profileBindingId) {
    return { kind: 'local-runtime', version: 'v2', profileBindingId };
  }
  return readinessRef ? { kind: 'local-runtime', version: 'v2', readinessRef } : null;
}
`;

test('model picker adapter hard-cut check accepts the v2-only local branch', () => {
  assert.deepEqual(validateModelPickerSelectionAdapterSource(validAdapterSource), []);
});

test('model picker adapter hard-cut check rejects localModelId profileBindingId fallback', () => {
  const source = validAdapterSource.replace(
    'const profileBindingId = normalizeText(selection.profileBindingId);',
    'const profileBindingId = normalizeText(selection.profileBindingId) || normalizeText(selection.localModelId);',
  );

  assert.match(
    validateModelPickerSelectionAdapterSource(source).join('\n'),
    /must not mint local-runtime refs from localModelId/,
  );
});

test('model picker adapter hard-cut check rejects display model local identity fallback', () => {
  const source = validAdapterSource.replace(
    'return readinessRef ? { kind: \'local-runtime\', version: \'v2\', readinessRef } : null;',
    'return readinessRef ? { kind: \'local-runtime\', version: \'v2\', readinessRef } : { kind: \'local-runtime\', version: \'v2\', profileBindingId: normalizeText(selection.model) };',
  );

  assert.match(
    validateModelPickerSelectionAdapterSource(source).join('\n'),
    /must not mint local-runtime refs from display model/,
  );
});

test('model picker adapter hard-cut check rejects missing ambiguous-ref guard', () => {
  const source = validAdapterSource.replace(
    `  if (profileBindingId && readinessRef) {
    return null;
  }
`,
    '',
  );

  assert.match(
    validateModelPickerSelectionAdapterSource(source).join('\n'),
    /must fail closed when local picker selection carries both profileBindingId and readinessRef/,
  );
});
