// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@nimiplatform/nimi-kit/ui';
import { ParentosTextGenerateParamsEditor } from './parentos-model-config-editors.js';

describe('parentos-model-config-editors', () => {
  it('clears stale localModelId when a local binding model is edited manually', async () => {
    const onBindingChange = vi.fn();

    render(
      <TooltipProvider>
        <ParentosTextGenerateParamsEditor
          binding={{
            source: 'local',
            connectorId: '',
            model: 'local/Gemma-4-27B-it-Q4_K_M',
            modelId: 'local/Gemma-4-27B-it-Q4_K_M',
            localModelId: '01KLOCALCHAT',
          }}
          onBindingChange={onBindingChange}
          pickerAvailable
          params={{}}
          onChange={() => {}}
        />
      </TooltipProvider>,
    );

    const modelInput = screen.getByPlaceholderText('例如 gpt-5.4 / whisper-large-v3');
    fireEvent.change(modelInput, { target: { value: 'local/Gemma-4-27B-it-Q6_K' } });

    expect(onBindingChange).toHaveBeenLastCalledWith({
      source: 'local',
      connectorId: '',
      model: 'local/Gemma-4-27B-it-Q6_K',
      modelId: 'local/Gemma-4-27B-it-Q6_K',
      localModelId: undefined,
    });
  });
});
