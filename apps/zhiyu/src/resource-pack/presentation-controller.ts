import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';

import type { ParsedZhiyuResourcePack } from './contract.js';
import { parseZhiyuResourcePack } from './parse.js';
import {
  createZhiyuResourcePackRender,
  type ZhiyuResourcePackRender,
  type ZhiyuResourcePackImageDecoder,
  type ZhiyuResourcePackResourceUrlFactory,
} from './render.js';

export type ZhiyuResourcePackPresentationPhase =
  | 'default'
  | 'selected'
  | 'preview'
  | 'apply-in-flight'
  | 'render-pending'
  | 'fallback';

export type ZhiyuResourcePackPendingTruth =
  | 'selection-unchanged-candidate-not-applied'
  | 'selection-saved-not-effective'
  | 'apply-outcome-unknown'
  | 'clear-outcome-unknown'
  | null;

export type ZhiyuResourcePackPresentationState = Readonly<{
  generation: number;
  phase: ZhiyuResourcePackPresentationPhase;
  agentHandle: NimiLocalAppAgentHandle | null;
  selectionRevision: string | null;
  selectedResourceRef: string | null;
  effectiveResourceRef: string | null;
  effectiveSource: 'default' | 'selected' | 'preview' | 'last-safe';
  scopedCssText: string | null;
  reviewFileName: string | null;
  pendingTruth: ZhiyuResourcePackPendingTruth;
  mismatchReason: string | null;
  error: string | null;
}>;

export type ZhiyuResourcePackApplyMaterial = Readonly<{
  agentHandle: NimiLocalAppAgentHandle;
  expectedRevision: string;
  archiveBytes: Uint8Array;
}>;

type Review = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly expectedRevision: string;
  readonly fileName: string;
  readonly archiveBytes: Uint8Array;
  render: ZhiyuResourcePackRender | null;
};

// @nimi-authority: rule.nimi.zhiyu.local-partner-surface.r018
export class ZhiyuResourcePackPresentationController {
  readonly #listeners = new Set<() => void>();
  readonly #urlFactory?: ZhiyuResourcePackResourceUrlFactory;
  readonly #imageDecoder?: ZhiyuResourcePackImageDecoder;
  #state: ZhiyuResourcePackPresentationState = initialState();
  #review: Review | null = null;
  #selectedRender: ZhiyuResourcePackRender | null = null;
  #operationEpoch = 0;

  constructor(options: {
    readonly urlFactory?: ZhiyuResourcePackResourceUrlFactory;
    readonly imageDecoder?: ZhiyuResourcePackImageDecoder;
  } = {}) {
    this.#urlFactory = options.urlFactory;
    this.#imageDecoder = options.imageDecoder;
  }

  getSnapshot = (): ZhiyuResourcePackPresentationState => this.#state;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  resetAgent(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string | null;
  }): void {
    this.#operationEpoch += 1;
    this.#destroyReview();
    this.#destroySelectedRender();
    this.#replace({
      ...initialState(this.#state.generation + 1),
      agentHandle: input.agentHandle,
      selectionRevision: input.selectionRevision,
      selectedResourceRef: input.selectedResourceRef,
    });
  }

  async beginPreview(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly expectedRevision: string;
    readonly fileName: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<void> {
    this.#requireContext(input.agentHandle, input.expectedRevision);
    const operationEpoch = ++this.#operationEpoch;
    const generation = this.#state.generation + 1;
    if (this.#review) {
      this.#destroyReview();
      this.#replace(this.#lastSafeState(generation));
    }
    const parsed = await parseZhiyuResourcePack(input.archiveBytes.slice());
    if (this.#operationEpoch !== operationEpoch
      || this.#state.agentHandle !== input.agentHandle
      || this.#state.selectionRevision !== input.expectedRevision) {
      return;
    }
    const render = await this.#createRender(parsed);
    if (this.#operationEpoch !== operationEpoch
      || this.#state.agentHandle !== input.agentHandle
      || this.#state.selectionRevision !== input.expectedRevision) {
      render.dispose();
      return;
    }
    this.#destroyReview();
    this.#review = {
      agentHandle: input.agentHandle,
      expectedRevision: input.expectedRevision,
      fileName: input.fileName,
      archiveBytes: input.archiveBytes.slice(),
      render,
    };
    this.#replace({
      ...this.#state,
      generation,
      phase: 'preview',
      effectiveSource: 'preview',
      scopedCssText: render.cssText,
      reviewFileName: input.fileName,
      pendingTruth: null,
      mismatchReason: null,
      error: null,
    });
  }

  cancelPreview(): void {
    this.#operationEpoch += 1;
    if (!this.#review) return;
    this.#destroyReview();
    this.#replace(this.#lastSafeState(this.#state.generation + 1));
  }

  prepareApply(): ZhiyuResourcePackApplyMaterial {
    const review = this.#review;
    if (!review || this.#state.phase !== 'preview') {
      throw new Error('A current Resource Pack preview is required before Apply.');
    }
    this.#requireContext(review.agentHandle, review.expectedRevision);
    review.render?.dispose();
    review.render = null;
    this.#replace({
      ...this.#lastSafeState(this.#state.generation + 1),
      phase: 'apply-in-flight',
      reviewFileName: review.fileName,
      pendingTruth: 'selection-unchanged-candidate-not-applied',
    });
    return Object.freeze({
      agentHandle: review.agentHandle,
      expectedRevision: review.expectedRevision,
      archiveBytes: review.archiveBytes.slice(),
    });
  }

  applyFailed(message: string): void {
    this.#destroyReview();
    this.#replace({
      ...this.#lastSafeState(this.#state.generation + 1),
      error: message,
    });
  }

  mutationOutcomeUnknown(kind: 'apply' | 'clear', message: string): void {
    const phase = this.#state.phase;
    this.#destroyReview();
    this.#replace({
      ...this.#lastSafeState(this.#state.generation + 1),
      phase,
      pendingTruth: kind === 'apply' ? 'apply-outcome-unknown' : 'clear-outcome-unknown',
      error: message,
    });
  }

  applyCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
  }): void {
    if (!this.#review || this.#review.agentHandle !== input.agentHandle) {
      throw new Error('Committed Resource Pack does not match the current review Agent.');
    }
    this.#destroyReview();
    this.#replace({
      ...this.#lastSafeState(this.#state.generation + 1),
      phase: 'render-pending',
      agentHandle: input.agentHandle,
      selectionRevision: input.selectionRevision,
      selectedResourceRef: input.selectedResourceRef,
      pendingTruth: 'selection-saved-not-effective',
    });
  }

  async renderSelected(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
    readonly archiveBytes: Uint8Array;
  }): Promise<boolean> {
    const generation = this.#state.generation + 1;
    if (!this.#matchesSelected(input)) return false;
    const parsed = await parseZhiyuResourcePack(input.archiveBytes.slice());
    const render = await this.#createRender(parsed);
    if (!this.#matchesSelected(input)) {
      render.dispose();
      return false;
    }
    this.#destroySelectedRender();
    this.#selectedRender = render;
    this.#replace({
      ...this.#state,
      generation,
      phase: 'selected',
      effectiveResourceRef: input.selectedResourceRef,
      effectiveSource: 'selected',
      scopedCssText: render.cssText,
      reviewFileName: null,
      pendingTruth: null,
      mismatchReason: null,
      error: null,
    });
    return true;
  }

  selectedRenderFailed(message: string): void {
    this.#destroyReview();
    this.#destroySelectedRender();
    this.#replace({
      ...this.#state,
      generation: this.#state.generation + 1,
      phase: 'fallback',
      effectiveResourceRef: null,
      effectiveSource: 'default',
      scopedCssText: null,
      reviewFileName: null,
      pendingTruth: null,
      mismatchReason: message,
      error: message,
    });
  }

  clearCommitted(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
  }): void {
    if (this.#state.agentHandle !== input.agentHandle) return;
    this.#destroyReview();
    this.#destroySelectedRender();
    this.#replace({
      ...initialState(this.#state.generation + 1),
      agentHandle: input.agentHandle,
      selectionRevision: input.selectionRevision,
    });
  }

  dispose(): void {
    this.#operationEpoch += 1;
    this.#destroyReview();
    this.#destroySelectedRender();
    this.#listeners.clear();
    this.#state = initialState(this.#state.generation + 1);
  }

  #matchesSelected(input: {
    readonly agentHandle: NimiLocalAppAgentHandle;
    readonly selectionRevision: string;
    readonly selectedResourceRef: string;
  }): boolean {
    return this.#state.agentHandle === input.agentHandle
      && this.#state.selectionRevision === input.selectionRevision
      && this.#state.selectedResourceRef === input.selectedResourceRef;
  }

  #requireContext(agentHandle: NimiLocalAppAgentHandle, selectionRevision: string): void {
    if (this.#state.agentHandle !== agentHandle || this.#state.selectionRevision !== selectionRevision) {
      throw new Error('Resource Pack review is stale for the current Agent or presentation revision.');
    }
  }

  #lastSafeState(generation: number): ZhiyuResourcePackPresentationState {
    const hasSelectedRender = Boolean(this.#selectedRender && this.#state.effectiveResourceRef);
    return Object.freeze({
      ...this.#state,
      generation,
      phase: hasSelectedRender ? 'selected' : 'default',
      effectiveSource: hasSelectedRender ? 'last-safe' : 'default',
      scopedCssText: hasSelectedRender ? this.#selectedRender!.cssText : null,
      reviewFileName: null,
      pendingTruth: null,
      mismatchReason: null,
      error: null,
    });
  }

  #createRender(pack: ParsedZhiyuResourcePack): Promise<ZhiyuResourcePackRender> {
    return createZhiyuResourcePackRender(
      pack,
      this.#urlFactory,
      this.#imageDecoder,
    );
  }

  #destroyReview(): void {
    this.#review?.render?.dispose();
    this.#review = null;
  }

  #destroySelectedRender(): void {
    this.#selectedRender?.dispose();
    this.#selectedRender = null;
  }

  #replace(state: ZhiyuResourcePackPresentationState): void {
    this.#state = Object.freeze(state);
    for (const listener of this.#listeners) listener();
  }
}

function initialState(generation = 0): ZhiyuResourcePackPresentationState {
  return Object.freeze({
    generation,
    phase: 'default',
    agentHandle: null,
    selectionRevision: null,
    selectedResourceRef: null,
    effectiveResourceRef: null,
    effectiveSource: 'default',
    scopedCssText: null,
    reviewFileName: null,
    pendingTruth: null,
    mismatchReason: null,
    error: null,
  });
}
