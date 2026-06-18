import type { Nimi2DRenderPlan } from '../runtime/index.mjs';

export type Nimi2DDecodedImage = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
};

export type Nimi2DImageDecoder = (input: {
  src: string;
  layerRef: string;
}) => Promise<Nimi2DDecodedImage>;

export type Nimi2DVisualProofStats = {
  modelKind: 'nimi2d';
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  sampledPixels: number;
  visiblePixels: number;
  defaultOutfitVisiblePixels: number;
  baseBodyOnlyFrame: boolean;
  layerCount: number;
  defaultOutfitLayerCount: number;
  sampledPixelChecksum: number;
};

export type Nimi2DMountedVisualFrameStats = {
  modelKind: 'nimi2d';
  canvasWidth: number;
  canvasHeight: number;
  gridSize: number;
  sampledPixels: number;
  visiblePixels: number;
  sampledPixelChecksum: number;
};

export type Nimi2DMountedVisualFrameCapture = {
  stats: Nimi2DMountedVisualFrameStats;
  artifactId: string;
  dataUrl: string;
};

export type Nimi2DAlphaHitViewport = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Nimi2DAlphaHitProbe = {
  modelKind: 'nimi2d';
  layerCount: number;
  defaultOutfitLayerCount: number;
  isOpaqueAtClientPoint(clientX: number, clientY: number, threshold?: number): boolean | null;
};

export class Nimi2DVisualProofError extends Error {
  readonly stats: Nimi2DVisualProofStats;
}

export class Nimi2DMountedVisualFrameError extends Error {
  readonly stats: Nimi2DMountedVisualFrameStats;
}

export function captureNimi2DMountedVisualFrame(input: {
  canvas: HTMLCanvasElement;
  gridSize?: number;
}): Nimi2DMountedVisualFrameCapture;

export function createNimi2DAlphaHitProbe(input: {
  renderPlan: Nimi2DRenderPlan;
  decodeImage?: Nimi2DImageDecoder;
  viewport?: Nimi2DAlphaHitViewport | (() => Nimi2DAlphaHitViewport | null);
}): Promise<Nimi2DAlphaHitProbe>;

export function probeNimi2DVisualFrame(input: {
  renderPlan: Nimi2DRenderPlan;
  decodeImage?: Nimi2DImageDecoder;
  gridSize?: number;
}): Promise<Nimi2DVisualProofStats>;

export function assertNimi2DVisualFrame(stats: Nimi2DVisualProofStats): void;
