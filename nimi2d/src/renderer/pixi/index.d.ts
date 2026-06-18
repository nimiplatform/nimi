import type { Nimi2DComposerSnapshot, Nimi2DRenderPlan } from '../../runtime/index.mjs';

export type Nimi2DPixiRendererReady = {
  renderer: 'pixi.js';
  layerRefs: string[];
  canvas: HTMLCanvasElement;
};

export type Nimi2DPixiRendererHandle = {
  readonly renderer: 'pixi.js';
  readonly layerRefs: string[];
  updateSnapshot(snapshot: Nimi2DComposerSnapshot): void;
  resize(width: number, height: number): void;
  destroy(): void;
};

export type Nimi2DPixiRendererInput = {
  host: { replaceChildren(...nodes: unknown[]): void };
  renderPlan: Nimi2DRenderPlan;
  initialSnapshot: Nimi2DComposerSnapshot;
  width: number;
  height: number;
  pixi?: unknown;
  onReady?: (ready: Nimi2DPixiRendererReady) => void;
};

export function createNimi2DPixiRenderer(input: Nimi2DPixiRendererInput): Promise<Nimi2DPixiRendererHandle>;
