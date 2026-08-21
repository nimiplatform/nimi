import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NimiJsonObject } from '@nimiplatform/kit/core/sdk-contract';
import {
  CapabilityDefaultsEditor,
  type CapabilityDefaultsEditorCopy,
} from '../src/components/capability-defaults-editor.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COPY: CapabilityDefaultsEditorCopy = {
  label: 'Default parameters',
  hint: 'hint',
  unsetLabel: 'Not set',
  trueLabel: 'True',
  falseLabel: 'False',
  listPlaceholder: 'One per line',
  localEffectivePlaceholder: (value: string) => `Engine ${value}`,
  cloudEffectivePlaceholder: 'Provider decides',
  randomValue: 'random',
};

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function EditorHarness(props: {
  readonly initialValue: NimiJsonObject;
  readonly onCommit: (value: NimiJsonObject) => void;
}) {
  const [value, setValue] = useState<NimiJsonObject>(props.initialValue);
  return (
    <CapabilityDefaultsEditor
      capabilityContract="text.generate"
      value={value}
      onChange={(next) => {
        props.onCommit(next);
        setValue(next);
      }}
      copy={COPY}
      route="local"
      effectiveDefaults={null}
    />
  );
}

async function renderEditor(
  initialValue: NimiJsonObject,
  onCommit: (value: NimiJsonObject) => void,
): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<EditorHarness initialValue={initialValue} onCommit={onCommit} />);
    await Promise.resolve();
  });
  return container;
}

// jsdom sanitizes intermediate number-input states ("0.", "-") to "" through the
// prototype value setter, so install an own data property to simulate real typing.
async function typeValue(input: HTMLInputElement, value: string): Promise<void> {
  await act(async () => {
    Object.defineProperty(input, 'value', { configurable: true, writable: true, value });
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

async function blur(input: HTMLInputElement): Promise<void> {
  await act(async () => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    await Promise.resolve();
  });
}

function parameterInput(node: HTMLElement, path: string): HTMLInputElement {
  const input = node.querySelector(`[data-nimi-default-parameter="${path}"] input`) as HTMLInputElement;
  expect(input).toBeTruthy();
  return input;
}

describe('CapabilityDefaultsEditor numeric fields', () => {
  it('keeps an intermediate decimal draft and commits the complete decimal', async () => {
    const onCommit = vi.fn();
    const node = await renderEditor({}, onCommit);
    const temperature = parameterInput(node, 'temperature');

    await typeValue(temperature, '0');
    expect(onCommit).toHaveBeenLastCalledWith({ temperature: 0 });

    await typeValue(temperature, '0.');
    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(temperature.value).toBe('0.');

    await typeValue(temperature, '0.7');
    expect(onCommit).toHaveBeenLastCalledWith({ temperature: 0.7 });
    expect(onCommit).toHaveBeenCalledTimes(2);
    expect(temperature.value).toBe('0.7');
  });

  it('keeps a lone minus sign draft and commits negative numbers', async () => {
    const onCommit = vi.fn();
    const node = await renderEditor({}, onCommit);
    const presencePenalty = parameterInput(node, 'presencePenalty');

    await typeValue(presencePenalty, '-');
    expect(onCommit).not.toHaveBeenCalled();
    expect(presencePenalty.value).toBe('-');

    await typeValue(presencePenalty, '-1.5');
    expect(onCommit).toHaveBeenLastCalledWith({ presencePenalty: -1.5 });
    expect(presencePenalty.value).toBe('-1.5');
  });

  it('reverts an unparsable draft to the committed value on blur', async () => {
    const onCommit = vi.fn();
    const node = await renderEditor({ temperature: 0.5 }, onCommit);
    const temperature = parameterInput(node, 'temperature');
    expect(temperature.value).toBe('0.5');

    await typeValue(temperature, '0.');
    expect(onCommit).not.toHaveBeenCalled();
    expect(temperature.value).toBe('0.');

    await blur(temperature);
    expect(onCommit).not.toHaveBeenCalled();
    expect(temperature.value).toBe('0.5');
  });

  it('clears the value when the draft is emptied', async () => {
    const onCommit = vi.fn();
    const node = await renderEditor({ temperature: 0.5 }, onCommit);
    const temperature = parameterInput(node, 'temperature');

    await typeValue(temperature, '');
    expect(onCommit).toHaveBeenLastCalledWith({});
    expect(temperature.value).toBe('');
  });

  it('rejects non-integer commits on integer fields and reverts on blur', async () => {
    const onCommit = vi.fn();
    const node = await renderEditor({}, onCommit);
    const topK = parameterInput(node, 'topK');

    await typeValue(topK, '3.5');
    expect(onCommit).not.toHaveBeenCalled();
    expect(topK.value).toBe('3.5');

    await blur(topK);
    expect(topK.value).toBe('');

    await typeValue(topK, '3');
    expect(onCommit).toHaveBeenLastCalledWith({ topK: 3 });
    expect(topK.value).toBe('3');
  });
});
