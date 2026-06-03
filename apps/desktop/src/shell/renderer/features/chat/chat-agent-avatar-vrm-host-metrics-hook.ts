import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import {
  resolveChatAgentAvatarVrmViewportHostMetrics,
  type ChatAgentAvatarVrmFramingViewportSize,
  type ChatAgentAvatarVrmRuntimeLifecycleState,
  type ChatAgentAvatarVrmViewportHostMetrics,
} from './chat-agent-avatar-vrm-runtime';

type ChatAgentAvatarVrmHostMetricsHookInput = {
  setRuntimeLifecycle: Dispatch<SetStateAction<ChatAgentAvatarVrmRuntimeLifecycleState>>;
  viewportHostRef: RefObject<HTMLDivElement | null>;
};

export function useChatAgentAvatarVrmHostMetrics({
  setRuntimeLifecycle,
  viewportHostRef,
}: ChatAgentAvatarVrmHostMetricsHookInput): {
  lastRenderableFramingViewportSize: ChatAgentAvatarVrmFramingViewportSize | null;
  viewportHostMetrics: ChatAgentAvatarVrmViewportHostMetrics;
} {
  const [viewportHostMetrics, setViewportHostMetrics] = useState<ChatAgentAvatarVrmViewportHostMetrics>({
    width: 0,
    height: 0,
    renderable: true,
  });
  const [lastRenderableFramingViewportSize, setLastRenderableFramingViewportSize] = useState<ChatAgentAvatarVrmFramingViewportSize | null>(null);

  useEffect(() => {
    const host = viewportHostRef.current;
    if (!host) {
      return undefined;
    }

    const updateHostMetrics = () => {
      const nextMetrics = resolveChatAgentAvatarVrmViewportHostMetrics(host);
      setViewportHostMetrics((current) => (
        current.width === nextMetrics.width
        && current.height === nextMetrics.height
        && current.renderable === nextMetrics.renderable
          ? current
          : nextMetrics
      ));
    };

    updateHostMetrics();

    if (typeof ResizeObserver === 'undefined') {
      return undefined;
    }

    const observer = new ResizeObserver(() => {
      updateHostMetrics();
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
    };
  }, [viewportHostRef]);

  useEffect(() => {
    if (!viewportHostMetrics.renderable) {
      return;
    }
    setLastRenderableFramingViewportSize((current) => (
      current?.width === viewportHostMetrics.width && current?.height === viewportHostMetrics.height
        ? current
        : {
            width: viewportHostMetrics.width,
            height: viewportHostMetrics.height,
          }
    ));
  }, [viewportHostMetrics.height, viewportHostMetrics.renderable, viewportHostMetrics.width]);

  useEffect(() => {
    if (!viewportHostMetrics.renderable) {
      setRuntimeLifecycle((current) => (
        current.phase === 'failed'
          ? current
          : {
              ...current,
              phase: 'recovering',
              reason: 'host-not-renderable',
              error: null,
            }
      ));
      return;
    }
    setRuntimeLifecycle((current) => (
      current.reason === 'host-not-renderable'
        ? {
            ...current,
            phase: 'stable',
            reason: null,
            error: null,
          }
        : current
    ));
  }, [setRuntimeLifecycle, viewportHostMetrics.renderable]);

  return {
    lastRenderableFramingViewportSize,
    viewportHostMetrics,
  };
}
