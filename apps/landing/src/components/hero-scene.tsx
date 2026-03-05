import React, { useRef, useMemo, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { EffectComposer, Bloom, DepthOfField } from '@react-three/postprocessing';
import * as THREE from 'three';

// 1. 核心星系组件 - 5层星环花瓣状体积星云
function NimiGalaxy({ count = 35000 }: { count?: number }) {
  const pointsRef = useRef<THREE.Points>(null);

  const [positions, colors, sizes] = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);

    // 预定义每层的基础颜色
    const colorCore = new THREE.Color('#E0FFFF');      // 极亮青色 - 核心
    const colorInner = new THREE.Color('#00BFFF');     // 青蓝色 - 内环
    const colorMain = new THREE.Color('#1E90FF');      // 深邃蓝 - 主环
    const colorMainAccent = new THREE.Color('#00FFFF'); // 亮青色 - 主环点缀
    const colorOuterP = new THREE.Color('#8A2BE2');    // 暗紫色 - 外环
    const colorOuterM = new THREE.Color('#FF00FF');    // 洋红色 - 外环花瓣
    const colorDust = new THREE.Color('#0B1D3A');      // 暗蓝色 - 外围星尘

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      
      // === 步骤 1: 多层星环概率分布 ===
      const p = Math.random();
      let baseRadius: number;
      let yThickness: number;
      let baseYOffset: number;
      let baseColor: THREE.Color;
      let layerType: string;

      if (p < 0.1) {
        // 10%: 核心层 (Core) - 位于中心略高
        layerType = 'core';
        baseRadius = Math.random() * 0.5;
        yThickness = 1.8;
        baseYOffset = 0.3;
        baseColor = colorCore.clone();
      } else if (p < 0.3) {
        // 20%: 内环 1 - 略低于核心
        layerType = 'inner';
        baseRadius = 0.8 + Math.random() * 0.7; // 0.8 ~ 1.5
        yThickness = 1.2;
        baseYOffset = 0.1;
        baseColor = colorInner.clone();
      } else if (p < 0.6) {
        // 30%: 主环 2 (最亮) - 位于中间平面
        layerType = 'main';
        baseRadius = 2.0 + Math.random() * 1.0; // 2.0 ~ 3.0
        yThickness = 0.9;
        baseYOffset = 0.0;
        // 主环夹杂亮青色
        baseColor = Math.random() < 0.3 ? colorMainAccent.clone() : colorMain.clone();
      } else if (p < 0.85) {
        // 25%: 外环 3 (花瓣边缘) - 略低于中间
        layerType = 'outer';
        baseRadius = 3.5 + Math.random() * 1.0; // 3.5 ~ 4.5
        yThickness = 0.75;
        baseYOffset = -0.15;
        // 暗紫色和洋红色交织
        baseColor = Math.random() < 0.5 ? colorOuterP.clone() : colorOuterM.clone();
      } else {
        // 15%: 外围星尘 - 最下方弥散
        layerType = 'dust';
        baseRadius = 5.0 + Math.random() * 2.0; // 5.0 ~ 7.0
        yThickness = 1.2; // 外围重新变厚散开
        baseYOffset = -0.4;
        baseColor = colorDust.clone();
      }

      // === 步骤 2: 制造"花瓣状"波动 ===
      // 完全随机的初始角度
      const angle = Math.random() * Math.PI * 2;
      
      // 5个花瓣的起伏
      const petalOffset = Math.sin(angle * 5) * 0.3;
      
      // 加上局部噪点模糊边界
      const noiseOffset = (Math.random() - 0.5) * 0.5;
      let finalRadius = baseRadius + petalOffset + noiseOffset;
      
      // 确保半径不为负
      finalRadius = Math.max(0.02, finalRadius);

      // === 步骤 3: 修复纸片 Y 轴，重塑体积感 ===
      // 使用三次方：中间紧实，边缘飘逸，形成立体星云状
      const randomY = (Math.random() - 0.5) * 2; // -1 到 1
      const y = Math.pow(randomY, 3) * yThickness;
      
      // 额外添加螺旋扭曲，让各层之间有过渡
      const twistAngle = angle + finalRadius * 0.4;

      // === 步骤 4: 计算最终坐标 ===
      let x = Math.cos(twistAngle) * finalRadius;
      let z = Math.sin(twistAngle) * finalRadius;
      
      // 添加轻微弥散，避免太规整
      const scatter = 0.05 + finalRadius * 0.02;
      x += (Math.random() - 0.5) * scatter;
      z += (Math.random() - 0.5) * scatter;

      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;

      // === 步骤 5: 颜色混合与微调 ===
      let finalColor = baseColor.clone();
      
      // 随机颜色偏移，避免同层死板
      const colorNoise = (Math.random() - 0.5) * 0.15;
      finalColor.r += colorNoise;
      finalColor.g += colorNoise * 0.8;
      finalColor.b += colorNoise * 1.2;
      
      // 核心区域额外提亮
      if (layerType === 'core' && Math.random() < 0.3) {
        finalColor.lerp(new THREE.Color('#FFFFFF'), 0.3);
      }
      
      // 外围星尘混入背景色
      if (layerType === 'dust') {
        finalColor.lerp(new THREE.Color('#020205'), Math.random() * 0.5);
      }

      colors[i3] = finalColor.r;
      colors[i3 + 1] = finalColor.g;
      colors[i3 + 2] = finalColor.b;

      // === 步骤 6: 粒子大小 ===
      // 核心和主环稍大，外围极小
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
      
      // 偶尔出现闪烁的亮星
      sizes[i] = Math.random() > 0.99 ? baseSize * 2 : baseSize;
    }

    return [positions, colors, sizes];
  }, [count]);

  useFrame((_, delta) => {
    if (pointsRef.current) {
      // 缓慢优雅的自转
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

// 2. 主场景容器
const nodesData: Array<{
  id: string;
  title: string;
  subtitle: string;
  pos: [number, number, number];
}> = [
  { id: 'world', title: 'World', subtitle: 'PERSISTENT', pos: [-3, 1.5, -2] },
  { id: 'agents', title: 'Agents', subtitle: 'AUTONOMOUS', pos: [2.5, 1.8, -3] },
  { id: 'memory', title: 'Memory', subtitle: 'SHARED', pos: [3.5, -1.2, 1.5] },
  { id: 'runtime', title: 'Runtime', subtitle: 'LOCAL EXECUTION', pos: [-2.5, -1.5, 2] },
];

function FloatingNodes() {
  return (
    <>
      {nodesData.map((node) => (
        <React.Fragment key={node.id}>
          <Line
            points={[[0, 0, 0], node.pos]}
            color="rgba(255, 255, 255, 0.15)"
            lineWidth={1}
            transparent
          />
          <Html position={node.pos} center distanceFactor={10} zIndexRange={[100, 0]}>
            <div
              style={{
                color: 'white',
                fontFamily: 'sans-serif',
                textAlign: 'center',
                pointerEvents: 'none',
                userSelect: 'none',
              }}
            >
              <div
                style={{
                  fontSize: '10px',
                  color: '#00ffff',
                  letterSpacing: '2px',
                  textTransform: 'uppercase',
                  marginBottom: '4px',
                  opacity: 0.8,
                }}
              >
                {node.subtitle}
              </div>
              <div
                style={{
                  fontSize: '14px',
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                  textTransform: 'uppercase',
                  textShadow: '0 0 10px rgba(0, 255, 255, 0.35)',
                }}
              >
                {node.title}
              </div>
            </div>
          </Html>
        </React.Fragment>
      ))}
    </>
  );
}

export default function HeroScene() {
  return (
    <div style={{ width: '100%', height: '100%', background: '#020205' }}>
      <Canvas
        camera={{
          position: [2, 2.5, 8],
          fov: 50,
          rotation: [0, 0, 0],
        }}
      >
        <Suspense fallback={null}>
          {/* 星系整体向右偏移 */}
          <group position={[3, 0, -2]} rotation={[0, -0.3, 0]}>
            <NimiGalaxy count={35000} />
            <FloatingNodes />
          </group>

          <OrbitControls
            enableDamping={true}
            dampingFactor={0.05}
            enablePan={false}
            minDistance={3}
            maxDistance={20}
            maxPolarAngle={Math.PI / 2 + 0.5}
            target={[3, 0, -2]}
          />

          <EffectComposer>
            <Bloom
              intensity={1.2}
              luminanceThreshold={0.4}
              luminanceSmoothing={0.85}
            />
            <DepthOfField
              focusDistance={0.0}
              focalLength={0.02}
              bokehScale={1.5}
              height={480}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
