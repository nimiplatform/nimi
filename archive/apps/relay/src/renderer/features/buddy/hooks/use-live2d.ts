// RL-FEAT-005 — Live2D hook
// RL-CORE-002 — Agent model binding determines which Live2D model loads

import { useEffect, useRef, useState, useCallback } from 'react';
import { createModelManager, type ModelState } from '../live2d/model-manager.js';
import {
  createAnimationController,
  createBlinkPlugin,
  createBreathPlugin,
  createLipSyncPlugin,
  createSaccadePlugin,
} from '../live2d/animation-controller.js';
import type { LipSyncPluginHandle } from '../live2d/animation-controller.js';
import { useLipSyncBridge } from '../live2d/lip-sync-bridge.js';
import { useAppStore } from '../../../app-shell/providers/app-store.js';

export function useLive2d() {
  const currentAgent = useAppStore((s) => s.currentAgent);
  const mouthTarget = useLipSyncBridge((s) => s.mouthTarget);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const managerRef = useRef<ReturnType<typeof createModelManager> | null>(null);
  const controllerRef = useRef<ReturnType<typeof createAnimationController> | null>(null);
  const lipSyncRef = useRef<LipSyncPluginHandle | null>(null);
  const [modelState, setModelState] = useState<ModelState>('idle');

  // Initialize manager + animation controller
  useEffect(() => {
    if (!canvasRef.current) return;

    const manager = createModelManager(setModelState);
    manager.mount(canvasRef.current);
    managerRef.current = manager;

    const controller = createAnimationController();
    controller.addPlugin(createBlinkPlugin());
    controller.addPlugin(createSaccadePlugin());
    controller.addPlugin(createBreathPlugin());

    // RL-FEAT-005: Add lip sync plugin for TTS → Live2D mouth sync
    const lipSync = createLipSyncPlugin();
    controller.addPlugin(lipSync.plugin);
    lipSyncRef.current = lipSync;

    controllerRef.current = controller;

    return () => {
      controller.dispose();
      manager.destroy();
      managerRef.current = null;
      controllerRef.current = null;
      lipSyncRef.current = null;
    };
  }, []);

  // Feed TTS audio volume into lip sync plugin
  useEffect(() => {
    lipSyncRef.current?.setTarget(mouthTarget);
  }, [mouthTarget]);

  // RL-CORE-002: Agent switch → unload old model, load new
  useEffect(() => {
    const manager = managerRef.current;
    const controller = controllerRef.current;
    if (!manager) return;

    // Stop animation and unload
    controller?.stop();
    manager.unloadModel();

    if (currentAgent?.live2dModelUrl) {
      manager.loadModel(currentAgent.live2dModelUrl).then(() => {
        const model = manager.getModel();
        if (model && controller) {
          controller.start(model);
        }
      });
    }
  }, [currentAgent?.id, currentAgent?.live2dModelUrl]);

  // RL-FEAT-005: Tap interaction — trigger tap animation on Live2D model
  const handleTap = useCallback((x: number, y: number) => {
    const model = managerRef.current?.getModel();
    if (model) {
      model.tap(x, y);
    }
  }, []);

  return { canvasRef, modelState, handleTap };
}
