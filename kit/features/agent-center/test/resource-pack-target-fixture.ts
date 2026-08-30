import type {
  AgentCenterResourcePackApplyMaterial,
  AgentCenterResourcePackTargetController,
  AgentCenterResourcePackTargetSnapshot,
  NimiLocalAppAgentHandle,
} from '../src/types.js';

const DEFAULT_STATE: AgentCenterResourcePackTargetSnapshot = Object.freeze({
  phase: 'default',
  reviewFileName: null,
  pendingTruth: null,
  effectiveResourceRef: null,
  mismatchReason: null,
  error: null,
});

export class TestResourcePackTargetController implements AgentCenterResourcePackTargetController {
  readonly calls: unknown[] = [];
  readonly #listeners = new Set<() => void>();
  #state = DEFAULT_STATE;
  #agentHandle: NimiLocalAppAgentHandle | null = null;
  #selectionRevision: string | null = null;
  #selectedResourceRef: string | null = null;
  #review: AgentCenterResourcePackApplyMaterial | null = null;
  #operationEpoch = 0;
  beginPreviewGate: Promise<void> | null = null;
  renderSelectedGate: Promise<void> | null = null;
  renderFailure: Error | null = null;

  getSnapshot = (): AgentCenterResourcePackTargetSnapshot => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  resetAgent(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string | null;
  }): void {
    this.calls.push(['resetAgent', input]);
    this.#operationEpoch += 1;
    this.#agentHandle = input.agentHandle;
    this.#selectionRevision = input.selectionRevision;
    this.#selectedResourceRef = input.selectedResourceRef;
    this.#review = null;
    this.#replace(DEFAULT_STATE);
  }

  async beginPreview(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly expectedRevision: string;
    readonly fileName: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<void> {
    this.calls.push(['beginPreview', { ...input, archiveBytes: Uint8Array.from(input.archiveBytes) }]);
    const operationEpoch = ++this.#operationEpoch;
    await this.beginPreviewGate;
    if (this.#operationEpoch !== operationEpoch) return;
    this.#requireContext(input.agentHandle, input.expectedRevision);
    this.#review = Object.freeze({
      agentHandle: input.agentHandle,
      expectedRevision: input.expectedRevision,
      archiveBytes: Uint8Array.from(input.archiveBytes),
    });
    this.#replace({
      ...DEFAULT_STATE,
      phase: 'preview',
      reviewFileName: input.fileName,
      effectiveResourceRef: this.#state.effectiveResourceRef,
    });
  }

  cancelPreview(): void {
    this.calls.push(['cancelPreview']);
    this.#operationEpoch += 1;
    this.#review = null;
    this.#replace(this.#selectedResourceRef && this.#state.effectiveResourceRef
      ? { ...DEFAULT_STATE, phase: 'selected', effectiveResourceRef: this.#selectedResourceRef }
      : this.#selectedResourceRef
        ? { ...DEFAULT_STATE, phase: 'fallback', mismatchReason: 'selected Resource Pack is not rendering' }
        : DEFAULT_STATE);
  }

  prepareApply(): AgentCenterResourcePackApplyMaterial {
    this.calls.push(['prepareApply']);
    if (!this.#review || this.#state.phase !== 'preview') throw new Error('preview required');
    this.#replace({
      ...DEFAULT_STATE,
      phase: 'apply-in-flight',
      reviewFileName: this.#state.reviewFileName,
      pendingTruth: 'selection-unchanged-candidate-not-applied',
      effectiveResourceRef: this.#state.effectiveResourceRef,
    });
    return Object.freeze({
      ...this.#review,
      archiveBytes: Uint8Array.from(this.#review.archiveBytes),
    });
  }

  applyFailed(message: string): void {
    this.calls.push(['applyFailed', message]);
    this.#review = null;
    this.#replace(this.#selectedResourceRef && this.#state.effectiveResourceRef
      ? {
          ...DEFAULT_STATE,
          phase: 'selected',
          effectiveResourceRef: this.#selectedResourceRef,
          error: message,
        }
      : this.#selectedResourceRef
        ? { ...DEFAULT_STATE, phase: 'fallback', mismatchReason: message, error: message }
        : { ...DEFAULT_STATE, error: message });
  }

  mutationOutcomeUnknown(kind: 'apply' | 'clear', message: string): void {
    this.calls.push(['mutationOutcomeUnknown', kind, message]);
    this.#review = null;
    this.#replace({
      ...this.#state,
      pendingTruth: kind === 'apply' ? 'apply-outcome-unknown' : 'clear-outcome-unknown',
      error: message,
    });
  }

  applyCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
  }): void {
    this.calls.push(['applyCommitted', input]);
    if (!this.#review || this.#review.agentHandle !== input.agentHandle) throw new Error('review Agent mismatch');
    const effectiveResourceRef = this.#state.effectiveResourceRef;
    this.#agentHandle = input.agentHandle;
    this.#selectionRevision = input.selectionRevision;
    this.#selectedResourceRef = input.selectedResourceRef;
    this.#review = null;
    this.#replace({
      ...DEFAULT_STATE,
      phase: 'render-pending',
      pendingTruth: 'selection-saved-not-effective',
      effectiveResourceRef,
    });
  }

  async renderSelected(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<boolean> {
    this.calls.push(['renderSelected', { ...input, archiveBytes: Uint8Array.from(input.archiveBytes) }]);
    await this.renderSelectedGate;
    if (this.renderFailure) throw this.renderFailure;
    if (this.#agentHandle !== input.agentHandle
      || this.#selectionRevision !== input.selectionRevision
      || this.#selectedResourceRef !== input.selectedResourceRef) return false;
    this.#replace({
      ...DEFAULT_STATE,
      phase: 'selected',
      effectiveResourceRef: input.selectedResourceRef,
    });
    return true;
  }

  selectedRenderFailed(message: string): void {
    this.calls.push(['selectedRenderFailed', message]);
    this.#replace({
      ...DEFAULT_STATE,
      phase: 'fallback',
      mismatchReason: message,
      error: message,
    });
  }

  clearCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
  }): void {
    this.calls.push(['clearCommitted', input]);
    this.#agentHandle = input.agentHandle;
    this.#selectionRevision = input.selectionRevision;
    this.#selectedResourceRef = null;
    this.#review = null;
    this.#replace(DEFAULT_STATE);
  }

  dispose(): void {
    this.calls.push(['dispose']);
    this.#operationEpoch += 1;
    this.#review = null;
    this.#listeners.clear();
    this.#replace(DEFAULT_STATE);
  }

  #requireContext(agentHandle: NimiLocalAppAgentHandle, revision: string): void {
    if (this.#agentHandle !== agentHandle || this.#selectionRevision !== revision) {
      throw new Error('stale Resource Pack context');
    }
  }

  #replace(state: AgentCenterResourcePackTargetSnapshot): void {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener();
  }
}
