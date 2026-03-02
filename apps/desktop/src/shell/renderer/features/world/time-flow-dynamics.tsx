import React, { useRef, useMemo, Suspense } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text, Center, Float, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

// Theme configuration based on time flow ratio
const getTheme = (ratio: number) => {
  if (ratio < 0.9) return { 
    color: '#60A5FA', // Cold blue - dilated
    label: 'Dilated', 
    speedFactor: 0.2 
  };
  if (ratio >= 0.9 && ratio <= 1.1) return { 
    color: '#4ADE80', // Green - synced
    label: 'Synced', 
    speedFactor: 1.0 
  };
  if (ratio > 1.1 && ratio <= 5.0) return { 
    color: '#F97316', // Orange - flowing
    label: 'Flowing', 
    speedFactor: 2.5 
  };
  return { 
    color: '#EF4444', // Red - overclock
    label: 'Overclock', 
    speedFactor: 5.0 
  };
};

// SVG Ring with ticks - drawn procedurally
const TicksRing = ({ color, speedFactor }: { color: string; speedFactor: number }) => {
  const ringRef = useRef<THREE.Group>(null);
  
  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z -= delta * 0.5 * speedFactor;
    }
  });

  // Generate ticks
  const ticks = useMemo(() => {
    const items = [];
    const count = 60;
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const isMajor = i % 5 === 0;
      const innerR = isMajor ? 2.2 : 2.3;
      const outerR = 2.5;
      
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
        </line>
      );
    }
    return items;
  }, [color]);

  // Labels (1x, 2x, etc.)
  const labels = useMemo(() => {
    const items = [];
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
        </Text>
      );
    });
    return items;
  }, [color]);

  return (
    <group ref={ringRef}>
      {ticks}
      {labels}
      {/* Outer glow ring */}
      <mesh>
        <ringGeometry args={[2.5, 2.55, 64]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
};

// Inner rotating ring
const InnerRing = ({ color, speedFactor }: { color: string; speedFactor: number }) => {
  const ringRef = useRef<THREE.Mesh>(null);
  
  useFrame((_, delta) => {
    if (ringRef.current) {
      ringRef.current.rotation.z += delta * 0.75 * speedFactor;
    }
  });

  return (
    <mesh ref={ringRef}>
      <ringGeometry args={[1.6, 1.65, 64]} />
      <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} />
    </mesh>
  );
};

// Main 3D Scene
const FlowRingScene = ({ ratio }: { ratio: number }) => {
  const { color, label, speedFactor } = useMemo(() => getTheme(ratio), [ratio]);
  const particlesRef = useRef<THREE.Points>(null);
  
  useFrame((state, delta) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.z += delta * 0.1 * speedFactor;
    }
  });

  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.3} />
      <pointLight position={[10, 10, 10]} intensity={1.5} color={color} />
      <pointLight position={[-10, -10, 5]} intensity={0.5} color="#ffffff" />

      <Center>
        {/* Outer ticks ring */}
        <TicksRing color={color} speedFactor={speedFactor} />
        
        {/* Inner ring */}
        <InnerRing color={color} speedFactor={speedFactor} />
        
        {/* Center ratio text with float animation */}
        <Float 
          speed={1 * speedFactor} 
          rotationIntensity={0.1} 
          floatIntensity={0.2}
        >
          <Text
            fontSize={1.0}
            color={color}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor="#000000"
          >
            {`${ratio.toFixed(1)}x`}
          </Text>
        </Float>
        
        {/* Status label */}
        <Text
          fontSize={0.2}
          color="#9CA3AF"
          position={[0, -1.8, 0]}
          anchorX="center"
          anchorY="middle"
        >
          {`Status: ${label}`}
        </Text>

        {/* Sparkles/particles */}
        <Sparkles
          ref={particlesRef}
          count={30}
          scale={3}
          size={1.5}
          speed={0.2 * speedFactor}
          color={color}
          opacity={0.6}
        />
      </Center>

      {/* Bloom effect for glow */}
      <EffectComposer disableNormalPass>
        <Bloom 
          luminanceThreshold={0.2}
          mipmapBlur 
          intensity={1.5}
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
}

export function TimeFlowDynamics({ ratio = 1.0, className = '' }: TimeFlowDynamicsProps) {
  const { color, label } = useMemo(() => getTheme(ratio), [ratio]);
  
  return (
    <div 
      className={`relative w-full h-full min-h-[280px] rounded-2xl overflow-hidden bg-[#0A0E12] border border-[#4ECCA3]/10 ${className}`}
      style={{ background: 'radial-gradient(circle at center, #0d1f16 0%, #0a0f0c 100%)' }}
    >
      {/* Header */}
      <div className="absolute top-4 left-0 right-0 text-center z-10">
        <h3 className="text-sm font-semibold tracking-wider" style={{ color }}>
          Time Flow Dynamics
        </h3>
      </div>
      
      {/* 3D Canvas */}
      <Canvas 
        camera={{ position: [0, 0, 8], fov: 50 }} 
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <FlowRingScene ratio={ratio} />
        </Suspense>
      </Canvas>

      {/* Bottom status indicator */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center gap-2 text-xs text-[#9CA3AF]">
        <span className="px-2 py-1 rounded-full bg-[#4ECCA3]/10 border border-[#4ECCA3]/20">
          Current: {ratio.toFixed(1)}x
        </span>
        <span 
          className="px-2 py-1 rounded-full border"
          style={{ 
            backgroundColor: `${color}15`,
            borderColor: `${color}40`,
            color 
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}

export default TimeFlowDynamics;
