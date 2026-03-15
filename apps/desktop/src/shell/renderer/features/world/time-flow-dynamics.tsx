import React, { useRef, useMemo, Suspense, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, Center, Float, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

// Theme configuration based on time flow ratio
const getTheme = (ratio: number) => {
  if (ratio < 0.9) return {
    color: '#60A5FA', // Cold blue - dilated
    label: 'Dilated',
    speedFactor: 0.2,
  };
  if (ratio >= 0.9 && ratio <= 1.1) return {
    color: '#4ADE80', // Green - synced
    label: 'Synced',
    speedFactor: 1.0,
  };
  if (ratio > 1.1 && ratio <= 5.0) return {
    color: '#F97316', // Orange - flowing
    label: 'Flowing',
    speedFactor: 2.5,
  };
  return {
    color: '#EF4444', // Red - overclock
    label: 'Overclock',
    speedFactor: 5.0,
  };
};

// SVG Ring with ticks - drawn procedurally
const TicksRing = ({ color, speedFactor, isCompact }: { color: string; speedFactor: number; isCompact?: boolean }) => {
  const ringRef = useRef<any>(null);

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.5 * speedFactor;
    }
  });

  // Generate ticks
  const ticks = useMemo(() => {
    const items: any[] = [];
    const count = isCompact ? 40 : 60;
    const radius = isCompact ? 1.6 : 2.5;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const isMajor = i % 5 === 0;
      const innerR = isMajor ? radius * 0.88 : radius * 0.92;
      const outerR = radius;

      const x1 = Math.cos(angle) * innerR;
      const y1 = Math.sin(angle) * innerR;
      const x2 = Math.cos(angle) * outerR;
      const y2 = Math.sin(angle) * outerR;

      items.push(
        <line key={i}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={2}
              array={new Float32Array([x1, y1, 0, x2, y2, 0])}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial color={color} opacity={isMajor ? 0.8 : 0.4} transparent linewidth={isMajor ? 2 : 1} />
        </line>,
      );
    }
    return items;
  }, [color, isCompact]);

  // Labels (1x, 2x, etc.)
  const labels = useMemo(() => {
    if (isCompact) return []; // No labels in compact mode

    const items: any[] = [];
    const positions = [
      { text: '1x', angle: -Math.PI / 2 },
      { text: '2x', angle: 0 },
      { text: '2x', angle: Math.PI },
      { text: '1x', angle: Math.PI / 2 },
    ];

    positions.forEach((pos, i) => {
      const x = Math.cos(pos.angle) * 2.8;
      const y = Math.sin(pos.angle) * 2.8;
      items.push(
        <Text
          key={i}
          position={[x, y, 0]}
          fontSize={0.25}
          color={color}
          anchorX="center"
          anchorY="middle"
        >
          {pos.text}
        </Text>,
      );
    });
    return items;
  }, [color, isCompact]);

  const radius = isCompact ? 1.6 : 2.5;

  return (
    <group ref={ringRef}>
      {ticks}
      {labels}
      {/* Outer glow ring */}
      <mesh>
        <ringGeometry args={[radius, radius * 1.02, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

// Inner rotating ring
const InnerRing = ({ color, speedFactor, isCompact }: { color: string; speedFactor: number; isCompact?: boolean }) => {
  const ringRef = useRef<any>(null);

  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.75 * speedFactor;
    }
  });

  const innerRadius = isCompact ? 1.0 : 1.6;
  const outerRadius = isCompact ? 1.03 : 1.65;

  return (
    <mesh ref={ringRef}>
      <ringGeometry args={[innerRadius, outerRadius, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
};

// Main 3D Scene
const FlowRingScene = ({ ratio, isCompact }: { ratio: number; isCompact?: boolean }) => {
  const { color, speedFactor } = useMemo(() => getTheme(ratio), [ratio]);
  const particlesRef = useRef<any>(null);

  useFrame((_, delta) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.z += delta * 0.1 * speedFactor;
    }
  });

  const textSize = isCompact ? 0.6 : 1.0;
  const sparklesScale = isCompact ? 2 : 3;
  const sparklesCount = isCompact ? 20 : 30;

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color={color} />
      <pointLight position={[-10, -10, 5]} intensity={0.5} color="#ffffff" />

      <Center>
        {/* Outer ticks ring */}
        <TicksRing color={color} speedFactor={speedFactor} isCompact={isCompact} />

        {/* Inner ring */}
        <InnerRing color={color} speedFactor={speedFactor} isCompact={isCompact} />

        {/* Center ratio text with float animation */}
        <Float
          speed={1 * speedFactor}
          rotationIntensity={0.1}
          floatIntensity={0.2}
        >
          <Text
            fontSize={textSize}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
          >
            {`${ratio.toFixed(1)}x`}
          </Text>
        </Float>

        {/* Sparkles/particles */}
        <Sparkles
          ref={particlesRef}
          count={sparklesCount}
          scale={sparklesScale}
          size={1.5}
          speed={0.2 * speedFactor}
          color={color}
          opacity={0.6}
        />
      </Center>

      {/* Bloom effect for glow */}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.2}
          mipmapBlur
          intensity={isCompact ? 1.2 : 1.5}
          radius={0.6}
        />
      </EffectComposer>
    </>
  );
};

// Main Component
interface TimeFlowDynamicsProps {
  ratio?: number;
  className?: string;
  variant?: 'default' | 'compact';
}

export function TimeFlowDynamics({ ratio = 1.0, className = '', variant = 'default' }: TimeFlowDynamicsProps) {
  const { color, label } = useMemo(() => getTheme(ratio), [ratio]);
  const isCompact = variant === 'compact';
  const [showTooltip, setShowTooltip] = useState(false);

  return (
    <div
      className={`relative w-full h-full ${className}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 0, isCompact ? 5 : 8], fov: 50 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        className="cursor-pointer"
      >
        <Suspense fallback={null}>
          <FlowRingScene ratio={ratio} isCompact={isCompact} />
        </Suspense>
      </Canvas>

      {/* Tooltip - appears above the component to avoid being clipped */}
      {showTooltip && (
        <div className="absolute left-1/2 -translate-x-1/2 z-50 pointer-events-none bottom-full mb-2">
          <div className="flex flex-col gap-1.5 px-3 py-2 rounded-lg bg-[#0f1612]/95 border border-[#4ECCA3]/30 shadow-lg backdrop-blur-sm whitespace-nowrap">
            {/* Title in tooltip */}
            <div className="text-xs font-semibold tracking-wider" style={{ color }}>
              Time Flow Dynamics
            </div>
            <div className="w-full h-px bg-[#4ECCA3]/20" />
            <div className="text-xs text-[#e8f5ee]">
              Current: <span className="font-semibold" style={{ color }}>{ratio.toFixed(1)}x</span>
            </div>
            <div className="text-xs text-[#e8f5ee]">
              Status: <span className="font-semibold" style={{ color }}>{label}</span>
            </div>
          </div>
          {/* Tooltip arrow pointing down */}
          <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-[#0f1612]/95 border-r border-b border-[#4ECCA3]/30 rotate-45" />
        </div>
      )}
    </div>
  );
}

export default TimeFlowDynamics;
