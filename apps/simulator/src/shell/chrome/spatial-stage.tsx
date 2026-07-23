import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';

const TIDE_PANES = ['identity', 'agent', 'modules', 'grants', 'instances', 'worlds'] as const;
type TidePaneId = (typeof TIDE_PANES)[number];

interface SpatialStageProps {
  active: boolean;
  children: ReactNode;
  onContextMenu: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onExit: () => void;
}

const isTidePane = (value: string): value is TidePaneId =>
  TIDE_PANES.includes(value as TidePaneId);

/**
 * Keeps product UI as accessible DOM while adding a spatial camera for Tide.
 * Pointer movement updates camera variables without forcing React re-renders;
 * wheel and arrow input move focus through the pane constellation.
 */
export function SpatialStage({ active, children, onContextMenu, onExit }: SpatialStageProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const pendingPointer = useRef({ x: 0, y: 0 });
  const pointerFrame = useRef<number | null>(null);
  const lastWheelAt = useRef(0);
  const prefersReducedMotion = usePrefersReducedMotion();
  const [focus, setFocus] = useState<TidePaneId>('modules');

  const applyCamera = useCallback(() => {
    pointerFrame.current = null;
    const stage = stageRef.current;
    if (!stage) return;
    const { x, y } = pendingPointer.current;
    stage.style.setProperty('--tide-camera-yaw', `${x * 4.5}deg`);
    stage.style.setProperty('--tide-camera-pitch', `${y * -3.25}deg`);
    stage.style.setProperty('--tide-camera-x', `${x * -12}px`);
    stage.style.setProperty('--tide-camera-y', `${y * -8}px`);
  }, []);

  const resetCamera = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return;
    stage.style.setProperty('--tide-camera-yaw', '0deg');
    stage.style.setProperty('--tide-camera-pitch', '0deg');
    stage.style.setProperty('--tide-camera-x', '0px');
    stage.style.setProperty('--tide-camera-y', '0px');
  }, []);

  useEffect(() => {
    if (active) stageRef.current?.focus({ preventScroll: true });
    else resetCamera();
  }, [active, resetCamera]);

  useEffect(
    () => () => {
      if (pointerFrame.current !== null) cancelAnimationFrame(pointerFrame.current);
    },
    [],
  );

  const moveFocus = (direction: 1 | -1) => {
    setFocus((current) => {
      const index = TIDE_PANES.indexOf(current);
      return TIDE_PANES[(index + direction + TIDE_PANES.length) % TIDE_PANES.length];
    });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!active || prefersReducedMotion) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    pendingPointer.current = {
      x: ((event.clientX - bounds.left) / bounds.width - 0.5) * 2,
      y: ((event.clientY - bounds.top) / bounds.height - 0.5) * 2,
    };
    if (pointerFrame.current === null) pointerFrame.current = requestAnimationFrame(applyCamera);
  };

  const onWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!active || Math.abs(event.deltaY) < 8) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelAt.current < 280) return;
    lastWheelAt.current = now;
    moveFocus(event.deltaY > 0 ? 1 : -1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!active) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(1);
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onExit();
    }
  };

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!active) return;
    const pane = (event.target as HTMLElement).closest<HTMLElement>('[data-pane-id]');
    const paneId = pane?.dataset.paneId;
    if (!paneId || !isTidePane(paneId) || paneId === focus) return;
    event.preventDefault();
    event.stopPropagation();
    setFocus(paneId);
  };

  return (
    <div
      ref={stageRef}
      className="stage"
      data-tide={active}
      data-tide-focus={active ? focus : undefined}
      tabIndex={active ? 0 : -1}
      aria-label={active ? 'Tide 空间概览。使用滚轮或方向键切换焦点，按 Escape 返回。' : undefined}
      onClickCapture={onClickCapture}
      onContextMenu={onContextMenu}
      onKeyDown={onKeyDown}
      onPointerMove={onPointerMove}
      onPointerLeave={resetCamera}
      onWheel={onWheel}
    >
      {children}
    </div>
  );
}
