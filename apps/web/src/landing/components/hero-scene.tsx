import { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// Ambient hero galaxy: 5-layer star ring + petal-shaped volumetric nebula.
// Mounted as a non-interactive background layer per L11 + D3.5.
// FloatingNodes + OrbitControls + EffectComposer (Bloom/DOF) removed in W2:
// - FloatingNodes had hardcoded English labels (L9 violation) + ambient
//   decorative-only design has no labels.
// - OrbitControls inappropriate for a background layer (no user interaction
//   with the scene; pointer-events-none on the wrapper).
// - Bloom/DepthOfField postprocessing dropped to keep the lazy bundle small;
//   the bare additive-blended particles already produce the desired glow.
function NimiGalaxy({ count = 35000 }: { count?: number }) {
  const pointsRef = useRef<InstanceType<typeof THREE.Points> | null>(null);

  const [positions, colors, sizes] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    const colorCore = new THREE.Color('#E0FFFF');
    const colorInner = new THREE.Color('#00BFFF');
    const colorMain = new THREE.Color('#1E90FF');
    const colorMainAccent = new THREE.Color('#00FFFF');
    const colorOuterP = new THREE.Color('#8A2BE2');
    const colorOuterM = new THREE.Color('#FF00FF');
    const colorDust = new THREE.Color('#0B1D3A');

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      const p = Math.random();
      let baseRadius: number;
      let yThickness: number;
      let baseYOffset: number;
      let baseColor = colorCore.clone();
      let layerType: 'core' | 'inner' | 'main' | 'outer' | 'dust';

      if (p < 0.1) {
        layerType = 'core';
        baseRadius = Math.random() * 0.5;
        yThickness = 1.8;
        baseYOffset = 0.3;
        baseColor = colorCore.clone();
      } else if (p < 0.3) {
        layerType = 'inner';
        baseRadius = 0.8 + Math.random() * 0.7;
        yThickness = 1.2;
        baseYOffset = 0.1;
        baseColor = colorInner.clone();
      } else if (p < 0.6) {
        layerType = 'main';
        baseRadius = 2.0 + Math.random() * 1.0;
        yThickness = 0.9;
        baseYOffset = 0.0;
        baseColor = Math.random() < 0.3 ? colorMainAccent.clone() : colorMain.clone();
      } else if (p < 0.85) {
        layerType = 'outer';
        baseRadius = 3.5 + Math.random() * 1.0;
        yThickness = 0.75;
        baseYOffset = -0.15;
        baseColor = Math.random() < 0.5 ? colorOuterP.clone() : colorOuterM.clone();
      } else {
        layerType = 'dust';
        baseRadius = 5.0 + Math.random() * 2.0;
        yThickness = 1.2;
        baseYOffset = -0.4;
        baseColor = colorDust.clone();
      }

      const angle = Math.random() * Math.PI * 2;
      const petalOffset = Math.sin(angle * 5) * 0.3;
      const noiseOffset = (Math.random() - 0.5) * 0.5;
      let finalRadius = baseRadius + petalOffset + noiseOffset;
      finalRadius = Math.max(0.02, finalRadius);

      const randomY = (Math.random() - 0.5) * 2;
      const y = Math.pow(randomY, 3) * yThickness + baseYOffset;

      const twistAngle = angle + finalRadius * 0.4;
      let x = Math.cos(twistAngle) * finalRadius;
      let z = Math.sin(twistAngle) * finalRadius;

      const scatter = 0.05 + finalRadius * 0.02;
      x += (Math.random() - 0.5) * scatter;
      z += (Math.random() - 0.5) * scatter;

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      const finalColor = baseColor.clone();

      const colorNoise = (Math.random() - 0.5) * 0.15;
      finalColor.r += colorNoise;
      finalColor.g += colorNoise * 0.8;
      finalColor.b += colorNoise * 1.2;

      if (layerType === 'core' && Math.random() < 0.3) {
        finalColor.lerp(new THREE.Color('#FFFFFF'), 0.3);
      }

      if (layerType === 'dust') {
        finalColor.lerp(new THREE.Color('#020205'), Math.random() * 0.5);
      }

      colors[i3] = finalColor.r;
      colors[i3 + 1] = finalColor.g;
      colors[i3 + 2] = finalColor.b;

      let baseSize: number;
      if (layerType === 'core') {
        baseSize = 0.008 + Math.random() * 0.004;
      } else if (layerType === 'main') {
        baseSize = 0.006 + Math.random() * 0.003;
      } else if (layerType === 'dust') {
        baseSize = 0.003 + Math.random() * 0.002;
      } else {
        baseSize = 0.004 + Math.random() * 0.003;
      }

      sizes[i] = Math.random() > 0.99 ? baseSize * 2 : baseSize;
    }

    return [positions, colors, sizes];
  }, [count]);

  useFrame((_, delta) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y -= delta * 0.01;
    }
  });

  const positionAttribute = useMemo(() => new THREE.BufferAttribute(positions, 3), [positions]);
  const colorAttribute = useMemo(() => new THREE.BufferAttribute(colors, 3), [colors]);
  const sizeAttribute = useMemo(() => new THREE.BufferAttribute(sizes, 1), [sizes]);

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={positionAttribute} />
        <primitive attach="attributes-color" object={colorAttribute} />
        <primitive attach="attributes-size" object={sizeAttribute} />
      </bufferGeometry>
      <pointsMaterial
        size={0.005}
        vertexColors
        transparent
        opacity={0.8}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

export type HeroSceneProps = {
  /** Number of particles. Default 35000 per W2 design perf budget. */
  particleCount?: number;
};

/**
 * Ambient hero galaxy scene. Mounted as a non-interactive background layer
 * via React.lazy + Suspense in HeroSection. Wrapper enforces
 * pointer-events-none + transparent so page gradient + overlay content
 * remain interactive.
 */
export function HeroScene({ particleCount = 35000 }: HeroSceneProps = {}) {
  return (
    <div
      className="pointer-events-none h-full w-full"
      aria-hidden="true"
      style={{ background: 'transparent' }}
    >
      <Canvas
        camera={{
          position: [2, 2.5, 8],
          fov: 50,
        }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <Suspense fallback={null}>
          <group position={[3, 0, -2]} rotation={[0, -0.3, 0]}>
            <NimiGalaxy count={particleCount} />
          </group>
        </Suspense>
      </Canvas>
    </div>
  );
}

export default HeroScene;
