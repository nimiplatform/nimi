import { GenerationPanel, type GenerationPanelProps } from './generation-panel.js';
import type { UseRuntimeGenerationPanelResult } from '../runtime.js';

export type RuntimeGenerationPanelProps = Omit<GenerationPanelProps, 'state' | 'statusItems'> & {
  runtimeState: UseRuntimeGenerationPanelResult;
};

export function RuntimeGenerationPanel({
  runtimeState,
  ...props
}: RuntimeGenerationPanelProps) {
  return (
    <GenerationPanel
      {...props}
      state={runtimeState.state}
      statusItems={runtimeState.statusItems}
    />
  );
}
