// RL-FEAT-005 — Live2D Model Manager
// Reference: nimi-mods/runtime/buddy/src/live2d/model-manager.ts
// Renderer-only — no runtime or realm dependency

import * as PIXI from 'pixi.js';
import { Live2DModel } from 'pixi-live2d-display';

export type ModelState = 'idle' | 'loading' | 'ready' | 'error';

export interface ModelManager {
  mount: (canvas: HTMLCanvasElement) => void;
  loadModel: (modelUrl: string) => Promise<void>;
  unloadModel: () => void;
  getModel: () => Live2DModel | null;
  getState: () => ModelState;
  destroy: () => void;
}

// Register Live2D with PIXI ticker for automatic updates
Live2DModel.registerTicker(PIXI.Ticker);

export function createModelManager(
  onStateChange: (state: ModelState) => void,
): ModelManager {
  let state: ModelState = 'idle';
  let app: PIXI.Application | null = null;
  let model: Live2DModel | null = null;
  let canvas: HTMLCanvasElement | null = null;

  function setState(newState: ModelState) {
    state = newState;
    onStateChange(newState);
  }

  function fitModel(m: Live2DModel, a: PIXI.Application) {
    const { width, height } = a.screen;
    const scale = Math.min(width / m.width, height / m.height) * 0.9;
    m.scale.set(scale);
    m.x = (width - m.width * scale) / 2;
    m.y = (height - m.height * scale) / 2;
  }

  return {
    mount(targetCanvas: HTMLCanvasElement) {
      canvas = targetCanvas;
      app = new PIXI.Application({
        view: canvas,
        autoStart: true,
        backgroundAlpha: 0,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        resizeTo: canvas.parentElement ?? undefined,
      });
    },

    async loadModel(modelUrl: string) {
      if (!app) {
        throw new Error('Canvas not mounted');
      }
      setState('loading');
      try {
        const loaded = await Live2DModel.from(modelUrl, {
          autoInteract: false,
          autoUpdate: true,
        });
        model = loaded;
        app.stage.addChild(model as unknown as PIXI.DisplayObject);
        fitModel(model, app);
        setState('ready');
      } catch (err) {
        console.error('Failed to load Live2D model:', err);
        setState('error');
      }
    },

    unloadModel() {
      if (model && app) {
        app.stage.removeChild(model as unknown as PIXI.DisplayObject);
        model.destroy();
        model = null;
      }
      setState('idle');
    },

    getModel() {
      return model;
    },

    getState() {
      return state;
    },

    destroy() {
      if (model && app) {
        app.stage.removeChild(model as unknown as PIXI.DisplayObject);
        model.destroy();
        model = null;
      }
      if (app) {
        app.destroy(false, { children: true });
        app = null;
      }
      canvas = null;
      setState('idle');
    },
  };
}
