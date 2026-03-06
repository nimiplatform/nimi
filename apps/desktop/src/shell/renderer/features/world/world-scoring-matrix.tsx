import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Environment } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';

interface ScoringData {
  activity?: number;
  consensus?: number;
  quality?: number;
  engagement?: number;
  scoreA?: number;
  scoreC?: number;
  scoreQ?: number;
  scoreE?: number;
  scoreEwma?: number;
}

// 3D Crystal Component - Smaller size for upper area
const CrystalModel = ({ data, color = '#4ECCA3' }: { data: ScoringData; color?: string }) => {
  const meshRef = useRef<any>(null);
  const edgesRef = useRef<any>(null);

  // Create geometry: Icosahedron with detail level 0 - medium size (1/3 smaller)
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(0.95, 0), []);

  // Create edges geometry for wireframe effect
  const edgesGeometry = useMemo(() => new THREE.EdgesGeometry(geometry, 15), [geometry]);

  // Rotation animation
  useFrame((_, delta) => {
    if (meshRef.current) {
      meshRef.current.rotation.y += delta * 0.15;
      meshRef.current.rotation.x += delta * 0.05;
    }
  });

  // Get values from data (fallback to 0)
  const scores = {
    Activity: data.scoreA ?? data.activity ?? 0,
    Consensus: data.scoreC ?? data.consensus ?? 0,
    Quality: data.scoreQ ?? data.quality ?? 0,
    Engagement: data.scoreE ?? data.engagement ?? 0,
  };

  // Labels positioned at specific vertices - adjusted for medium crystal
  const labelsData = [
    { name: 'Activity', score: scores.Activity, position: [0, 1.4, 0] as [number, number, number] },
    {
      name: 'Consensus',
      score: scores.Consensus,
      position: [1.3, 0, 0.4] as [number, number, number],
    },
    {
      name: 'Quality',
      score: scores.Quality,
      position: [-1.3, 0, 0.4] as [number, number, number],
    },
    {
      name: 'Engagement',
      score: scores.Engagement,
      position: [0, -1.4, 0] as [number, number, number],
    },
  ];

  return (
    <group ref={meshRef}>
      {/* Main crystal body - translucent faces */}
      <mesh geometry={geometry}>
        <meshPhysicalMaterial
          color={color}
          transmission={0.9}
          thickness={0.1}
          roughness={0.05}
          metalness={0.1}
          transparent
          opacity={0.25}
          envMapIntensity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Glowing edges */}
      <lineSegments ref={edgesRef} geometry={edgesGeometry}>
        <lineBasicMaterial color={color} toneMapped={false} linewidth={2} />
      </lineSegments>

      {/* Inner wireframe for more glow effect */}
      <mesh geometry={new THREE.IcosahedronGeometry(0.9, 0)}>
        <meshBasicMaterial color={color} transparent opacity={0.1} wireframe toneMapped={false} />
      </mesh>

      {/* Data labels */}
      {labelsData.map((label, index) => (
        <Html
          key={index}
          position={label.position}
          distanceFactor={1.5}
          transform
          sprite
          style={{
            color: color,
            fontFamily: 'var(--font-ui)',
            fontSize: '12px',
            textAlign: 'center',
            pointerEvents: 'none',
            userSelect: 'none',
            filter: `drop-shadow(0 0 4px ${color}80)`,
          }}
        >
          <div>
            <div
              style={{
                textTransform: 'uppercase',
                marginBottom: '2px',
                fontSize: '10px',
                letterSpacing: '0.5px',
                opacity: 0.9,
              }}
            >
              {label.name}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 'bold' }}>{label.score.toFixed(0)}</div>
          </div>
        </Html>
      ))}
    </group>
  );
};

// Scene wrapper
const Scene = ({ data }: { data: ScoringData }) => {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.2} />
      <directionalLight position={[2, 5, 2]} intensity={1} color="#ffffff" />
      <pointLight position={[-3, -3, -3]} intensity={0.5} color="#4ECCA3" />

      {/* Environment for reflections */}
      <Environment preset="city" />

      {/* Crystal model - centered position */}
      <group position={[0, 0, 0]}>
        <CrystalModel data={data} color="#4ECCA3" />
      </group>

      {/* Post-processing: Bloom effect */}
      <EffectComposer>
        <Bloom luminanceThreshold={0.5} luminanceSmoothing={0.9} intensity={1.5} radius={0.8} />
      </EffectComposer>
    </>
  );
};

// Main Component
interface WorldScoringMatrixProps {
  data: ScoringData;
  className?: string;
}

export function WorldScoringMatrix({ data, className = '' }: WorldScoringMatrixProps) {
  const ewmaScore = data.scoreEwma ?? 0;

  // Determine EWMA trend status
  const getEwmaStatus = (score: number) => {
    if (score >= 80) return { label: 'Excellent', color: '#4ADE80' };
    if (score >= 60) return { label: 'Good', color: '#4ECCA3' };
    if (score >= 40) return { label: 'Average', color: '#F97316' };
    return { label: 'Needs Attention', color: '#EF4444' };
  };

  const ewmaStatus = getEwmaStatus(ewmaScore);

  return (
    <div
      className={`relative w-full h-full flex flex-col rounded-[20px] overflow-hidden border border-[#4ECCA3]/20 ${className}`}
      style={{ background: 'linear-gradient(135deg, #0a1210 0%, #0d1f16 50%, #0a1412 100%)' }}
    >
      {/* Title with decorative lines */}
      <div className="pt-4 px-4 flex items-center z-10">
        <div className="flex-1 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/30 to-[#4ECCA3]/30" />
        <h3 className="mx-3 text-xs font-semibold tracking-wider text-[#4ECCA3] uppercase">
          World Scoring Matrix
        </h3>
        <div className="flex-1 h-px bg-gradient-to-l from-transparent via-[#4ECCA3]/30 to-[#4ECCA3]/30" />
      </div>

      {/* Upper Area: 3D Crystal - Full height canvas */}
      <div className="flex-1 min-h-[280px]">
        <Canvas
          camera={{ position: [0, 0, 4.2], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <Scene data={data} />
        </Canvas>
      </div>

      {/* Divider */}
      <div className="mx-4 h-px bg-gradient-to-r from-transparent via-[#4ECCA3]/20 to-transparent" />

      {/* Lower Area: EWMA Comprehensive Index */}
      <div className="p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-xs text-[#4ECCA3]/70 uppercase tracking-wider">
            Comprehensive Index
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <div className="text-2xl font-bold text-[#4ECCA3]">{ewmaScore.toFixed(2)}</div>
            <div className="text-[10px] text-[#e8f5ee]/40 mt-0.5">EWMA Score</div>
          </div>

          <div className="text-right">
            <div
              className="text-sm font-medium px-2.5 py-1 rounded-full border"
              style={{
                color: ewmaStatus.color,
                borderColor: `${ewmaStatus.color}40`,
                backgroundColor: `${ewmaStatus.color}10`,
              }}
            >
              {ewmaStatus.label}
            </div>
            <div className="text-[10px] text-[#e8f5ee]/40 mt-1">Trend Analysis</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="h-1.5 w-full bg-[#4ECCA3]/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(ewmaScore, 100)}%`,
                background: `linear-gradient(90deg, ${ewmaStatus.color}80, ${ewmaStatus.color})`,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default WorldScoringMatrix;
