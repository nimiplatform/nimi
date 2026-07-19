import { useEffect, useState } from 'react';
import { useSim, type BridgeState } from '../engine/SimContext';

function BridgePacket({ bridge }: { bridge: BridgeState }) {
  const { points, stage } = bridge;
  const target = stage === 'toAgent' ? points[1] : points[2];
  const [pos, setPos] = useState(points[0]);

  useEffect(() => {
    const r = requestAnimationFrame(() => setPos(target));
    return () => cancelAnimationFrame(r);
  }, [target]);

  return (
    <div
      className="bridge-packet"
      style={{ transform: `translate3d(${pos.x}px, ${pos.y}px, 0)` }}
      aria-hidden
    >
      <span className="bridge-orb" />
      <span className="bridge-label">context</span>
    </div>
  );
}

/** Floating base-agent presence: the context-bridge packet while migrating. */
export function AgentLayer() {
  const { state } = useSim();
  if (!state.bridge) return null;
  return <BridgePacket bridge={state.bridge} />;
}
