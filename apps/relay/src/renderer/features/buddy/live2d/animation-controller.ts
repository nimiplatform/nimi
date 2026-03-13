// RL-FEAT-005 — Live2D Animation Controller
// Reference: nimi-mods/runtime/buddy/src/live2d/animation-controller.ts
// Plugin architecture with priority-ordered execution

import type { Live2DModel } from 'pixi-live2d-display';

export interface AnimationPlugin {
  name: string;
  priority: number;
  update: (dt: number, params: Record<string, number>) => Record<string, number>;
  dispose?: () => void;
}

export interface AnimationController {
  addPlugin: (plugin: AnimationPlugin) => void;
  removePlugin: (name: string) => void;
  start: (model: Live2DModel) => void;
  stop: () => void;
  dispose: () => void;
}

export function createAnimationController(): AnimationController {
  const plugins: AnimationPlugin[] = [];
  let rafId: number | null = null;
  let lastTime = 0;
  let activeModel: Live2DModel | null = null;

  function tick(time: number) {
    if (!activeModel) return;
    const dt = (time - lastTime) / 1000;
    lastTime = time;

    // Collect parameter updates from all plugins
    let params: Record<string, number> = {};
    for (const plugin of plugins) {
      params = plugin.update(dt, params);
    }

    // Apply parameters to the Live2D model's core
    const coreModel = (activeModel as unknown as { internalModel?: { coreModel?: { setParameterValueById?: (id: string, value: number) => void } } })
      .internalModel?.coreModel;
    if (coreModel?.setParameterValueById) {
      for (const [key, value] of Object.entries(params)) {
        coreModel.setParameterValueById(key, value);
      }
    }

    rafId = requestAnimationFrame(tick);
  }

  return {
    addPlugin(plugin: AnimationPlugin) {
      plugins.push(plugin);
      plugins.sort((a, b) => a.priority - b.priority);
    },

    removePlugin(name: string) {
      const idx = plugins.findIndex((p) => p.name === name);
      if (idx >= 0) {
        plugins[idx].dispose?.();
        plugins.splice(idx, 1);
      }
    },

    start(model: Live2DModel) {
      activeModel = model;
      lastTime = performance.now();
      rafId = requestAnimationFrame(tick);
    },

    stop() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      activeModel = null;
    },

    dispose() {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      for (const plugin of plugins) {
        plugin.dispose?.();
      }
      plugins.length = 0;
      activeModel = null;
    },
  };
}

// ── Plugin Implementations ──────────────────────────────────────────────

export interface LipSyncPluginHandle {
  /** Set the target mouth-open value (0..1). Called from TTS audio analyser. */
  setTarget: (value: number) => void;
  plugin: AnimationPlugin;
}

/** Lip sync: audio volume → ParamMouthOpenY (priority 10) */
export function createLipSyncPlugin(): LipSyncPluginHandle {
  let mouthOpen = 0;
  const attack = 0.028; // 28ms attack
  const release = 0.050; // 50ms release
  let targetValue = 0;

  const plugin: AnimationPlugin = {
    name: 'lip-sync',
    priority: 10,
    update(dt, params) {
      // Smooth towards target with attack/release
      if (targetValue > mouthOpen) {
        mouthOpen = Math.min(mouthOpen + dt / attack, targetValue);
      } else {
        mouthOpen = Math.max(mouthOpen - dt / release, targetValue);
      }
      return { ...params, ParamMouthOpenY: mouthOpen };
    },
    dispose() {
      mouthOpen = 0;
      targetValue = 0;
    },
  };

  return {
    setTarget: (value: number) => { targetValue = value; },
    plugin,
  };
}

/** Auto-blink: 3-6s intervals, 80ms close / 40ms hold / 120ms open (priority 30) */
export function createBlinkPlugin(): AnimationPlugin {
  let timer = 0;
  let nextBlink = 3 + Math.random() * 3;
  let blinkPhase: 'open' | 'closing' | 'closed' | 'opening' = 'open';
  let phaseTimer = 0;

  function getBlinkValue(): number {
    switch (blinkPhase) {
      case 'open': return 1;
      case 'closing': return 1 - phaseTimer / 0.08;
      case 'closed': return 0;
      case 'opening': return phaseTimer / 0.12;
    }
  }

  return {
    name: 'blink',
    priority: 30,
    update(dt, params) {
      timer += dt;
      phaseTimer += dt;

      if (blinkPhase === 'open' && timer >= nextBlink) {
        blinkPhase = 'closing';
        phaseTimer = 0;
      } else if (blinkPhase === 'closing' && phaseTimer >= 0.08) {
        blinkPhase = 'closed';
        phaseTimer = 0;
      } else if (blinkPhase === 'closed' && phaseTimer >= 0.04) {
        blinkPhase = 'opening';
        phaseTimer = 0;
      } else if (blinkPhase === 'opening' && phaseTimer >= 0.12) {
        blinkPhase = 'open';
        phaseTimer = 0;
        timer = 0;
        nextBlink = 3 + Math.random() * 3;
      }

      const v = Math.max(0, Math.min(1, getBlinkValue()));
      return { ...params, ParamEyeLOpen: v, ParamEyeROpen: v };
    },
  };
}

/** Eye saccade: subtle random eye movement during idle (priority 40) */
export function createSaccadePlugin(): AnimationPlugin {
  let targetX = 0;
  let targetY = 0;
  let currentX = 0;
  let currentY = 0;
  let timer = 0;
  let nextMove = 1 + Math.random() * 2;

  return {
    name: 'saccade',
    priority: 40,
    update(dt, params) {
      timer += dt;
      if (timer >= nextMove) {
        targetX = (Math.random() - 0.5) * 0.6;
        targetY = (Math.random() - 0.5) * 0.4;
        timer = 0;
        nextMove = 1 + Math.random() * 2;
      }
      // Smooth interpolation
      currentX += (targetX - currentX) * Math.min(dt * 4, 1);
      currentY += (targetY - currentY) * Math.min(dt * 4, 1);
      return {
        ...params,
        ParamEyeBallX: (params.ParamEyeBallX ?? 0) + currentX,
        ParamEyeBallY: (params.ParamEyeBallY ?? 0) + currentY,
      };
    },
  };
}

/** Breath: sine-wave breathing animation (priority 50) */
export function createBreathPlugin(): AnimationPlugin {
  let timer = 0;
  return {
    name: 'breath',
    priority: 50,
    update(dt, params) {
      timer += dt;
      const breathValue = Math.sin(timer * 2) * 0.5 + 0.5;
      return { ...params, ParamBreath: breathValue };
    },
  };
}
