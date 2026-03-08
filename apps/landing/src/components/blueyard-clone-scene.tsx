import React, { useRef, useMemo, Suspense, useState, useEffect } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { EffectComposer, Bloom, Noise, Vignette } from '@react-three/postprocessing';
import * as THREE from 'three';

// --- 1:1 复刻星系组件 (极致交互版) ---
function Galaxy({ state }: { state: 'hero' | 'explore' | 'detail' }) {
  const pointsRef = useRef<THREE.Points>(null);
  const { camera, mouse: mouse2D } = useThree();
  const count = 60000; // 优化后的粒子数量

  const mouse3D = useRef(new THREE.Vector3());
  const raycaster = useRef(new THREE.Raycaster());
  const interactionPlane = useMemo(() => new THREE.Plane(), []);

  const particlesData = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const initialPositions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const initialColors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      let r = Math.pow(Math.random(), 1.5) * 8.0;
      if (r > 1.0 && r < 1.6) r *= (Math.random() > 0.5 ? 1.6 : 0.6); 
      if (r > 3.5 && r < 4.5) r *= (Math.random() > 0.5 ? 1.3 : 0.8);

      const arms = 5;
      const armOffset = Math.floor(Math.random() * arms) * (Math.PI * 2 / arms);
      const scatter = Math.pow(Math.random() - 0.5, 3) * (r < 1.0 ? 12.0 : 4.0);
      const angle = armOffset + r * 1.4 + scatter;

      const envelope = 0.2 + Math.exp(-Math.pow(r, 2) / 3.0) * 1.2;
      const y = Math.pow((Math.random() - 0.5) * 2, 3) * envelope;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      positions[i3] = initialPositions[i3] = x;
      positions[i3 + 1] = initialPositions[i3 + 1] = y;
      positions[i3 + 2] = initialPositions[i3 + 2] = z;

      const c = new THREE.Color();
      if (r < 0.8) c.set('#ffffff');
      else if (r < 2.5) c.set('#00ffff');
      else c.set('#0055ff');

      initialColors[i3] = colors[i3] = c.r;
      initialColors[i3+1] = colors[i3+1] = c.g;
      initialColors[i3+2] = colors[i3+2] = c.b;
      sizes[i] = (r < 1.2 ? 0.012 : 0.008);
    }
    return { positions, initialPositions, colors, initialColors, sizes };
  }, [count]);

  const positionAttribute = useMemo(
    () => new THREE.BufferAttribute(particlesData.positions, 3),
    [particlesData.positions],
  );
  const colorAttribute = useMemo(
    () => new THREE.BufferAttribute(particlesData.colors, 3),
    [particlesData.colors],
  );
  const sizeAttribute = useMemo(
    () => new THREE.BufferAttribute(particlesData.sizes, 1),
    [particlesData.sizes],
  );

  const targetCamPos = useMemo(() => new THREE.Vector3(0, 2.5, 8), []);

  useFrame((stateObj, delta) => {
    if (!pointsRef.current) return;

    pointsRef.current.rotation.y += delta * 0.015;

    // 动态调整投影平面，确保全屏感应
    interactionPlane.setFromNormalAndCoplanarPoint(
      camera.getWorldDirection(new THREE.Vector3()).negate(),
      new THREE.Vector3(0, 0, 0)
    );
    raycaster.current.setFromCamera(mouse2D, camera);
    raycaster.current.ray.intersectPlane(interactionPlane, mouse3D.current);
    
    const localMouse = mouse3D.current.clone();
    pointsRef.current.worldToLocal(localMouse);

    const positionAttr = pointsRef.current.geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
    const colorAttr = pointsRef.current.geometry.getAttribute('color') as THREE.BufferAttribute | undefined;
    const sizeAttr = pointsRef.current.geometry.getAttribute('size') as THREE.BufferAttribute | undefined;
    if (!positionAttr || !colorAttr || !sizeAttr) {
      return;
    }

    const pos = positionAttr.array as Float32Array;
    const cols = colorAttr.array as Float32Array;
    const szs = sizeAttr.array as Float32Array;
    const initialPos = particlesData.initialPositions;
    const initialCols = particlesData.initialColors;

    // 强交互参数
    const influenceRadius = 0.2; 
    const sphereRadius = 0.15;   
    const followSpeed = 0.4;    

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const currentX = pos[i3] ?? 0;
      const currentY = pos[i3 + 1] ?? 0;
      const currentZ = pos[i3 + 2] ?? 0;
      const dx = currentX - localMouse.x;
      const dy = currentY - localMouse.y;
      const dz = currentZ - localMouse.z;
      const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
      const initialX = initialPos[i3] ?? 0;
      const initialY = initialPos[i3 + 1] ?? 0;
      const initialZ = initialPos[i3 + 2] ?? 0;
      const initialR = initialCols[i3] ?? 0;
      const initialG = initialCols[i3 + 1] ?? 0;
      const initialB = initialCols[i3 + 2] ?? 0;

      if (dist < influenceRadius) {
        // 汇聚到球壳
        const targetX = localMouse.x + (dx / (dist || 1)) * sphereRadius;
        const targetY = localMouse.y + (dy / (dist || 1)) * sphereRadius;
        const targetZ = localMouse.z + (dz / (dist || 1)) * sphereRadius;

        pos[i3] = currentX + (targetX - currentX) * followSpeed;
        pos[i3 + 1] = currentY + (targetY - currentY) * followSpeed;
        pos[i3 + 2] = currentZ + (targetZ - currentZ) * followSpeed;

        // 视觉增强：变亮变大
        cols[i3] = 1.0; 
        cols[i3 + 1] = 1.0;
        cols[i3 + 2] = 1.0;
        szs[i] = 0.025;
      } else {
        // 回归
        pos[i3] = currentX + (initialX - currentX) * 0.08;
        pos[i3 + 1] = currentY + (initialY - currentY) * 0.08;
        pos[i3 + 2] = currentZ + (initialZ - currentZ) * 0.08;
        
        cols[i3] = initialR;
        cols[i3 + 1] = initialG;
        cols[i3 + 2] = initialB;
        szs[i] = particlesData.sizes[i] ?? 0.008;
      }
    }
    positionAttr.needsUpdate = true;
    colorAttr.needsUpdate = true;
    sizeAttr.needsUpdate = true;

    if (state === 'hero') targetCamPos.set(0, 2.5, 8);
    else if (state === 'explore') targetCamPos.set(0, 0, 5.5);
    camera.position.lerp(targetCamPos, delta * 1.5);
    camera.lookAt(0, 0, 0);
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={positionAttribute} />
        <primitive attach="attributes-color" object={colorAttribute} />
        <primitive attach="attributes-size" object={sizeAttribute} />
      </bufferGeometry>
      <pointsMaterial size={0.008} vertexColors transparent opacity={0.9} sizeAttenuation depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
  );
}

export default function BlueyardCloneScene() {
  const [viewState, setViewState] = useState<'hero' | 'explore' | 'detail'>('hero');

  return (
    <div className="relative w-full h-screen bg-[#020205] overflow-hidden font-sans">
      <Canvas camera={{ position: [0, 2.5, 8], fov: 55 }} style={{ background: '#000000', position: 'absolute', top: 0, left: 0 }}>
        <Suspense fallback={null}>
          <Galaxy state={viewState} />
          <EffectComposer>
            <Bloom intensity={1.5} luminanceThreshold={0.2} luminanceSmoothing={0.9} />
            <Noise opacity={0.03} />
            <Vignette darkness={1.1} />
          </EffectComposer>
        </Suspense>
      </Canvas>

      <div className="absolute inset-0 z-10 pointer-events-none flex flex-col">
        <div className="w-full flex justify-between items-center px-12 py-10">
          <div className="w-32 pointer-events-auto">
            {viewState !== 'hero' && (
              <button onClick={() => setViewState('hero')} className="text-white/40 text-[10px] tracking-[0.3em] hover:text-white transition-colors"><span>←</span> BACK</button>
            )}
          </div>
          <div className="text-white text-[1.4rem] tracking-[0.8em] font-light text-center cursor-pointer pointer-events-auto" style={{ marginRight: '-0.8em' }} onClick={() => setViewState('hero')}>NIMI</div>
          <div className="w-32 flex justify-end pointer-events-auto">
            <button className="text-white/40 text-[10px] tracking-[0.2em] hover:text-white transition-colors">AUDIO</button>
          </div>
        </div>

        <div className={`absolute left-20 top-1/2 -translate-y-1/2 max-w-xl transition-all duration-1000 pointer-events-auto ${viewState === 'hero' ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-12 pointer-events-none'}`}>
          <p className="text-[10px] tracking-[0.4em] uppercase mb-8 text-white/40 font-light">Investing in founders creating the</p>
          <h1 className="text-[5.5rem] font-bold leading-[0.95] mb-10 text-white tracking-[-0.03em]">FABRIC OF<br/>OUR FUTURE</h1>
          <button onClick={() => setViewState('explore')} className="group flex items-center gap-6 text-[10px] tracking-[0.3em] uppercase text-white/80 hover:text-white transition-all">
            <span>Explore the future</span>
            <div className="w-12 h-12 rounded-full border border-white/20 flex items-center justify-center group-hover:border-white/40 transition-all duration-500">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
