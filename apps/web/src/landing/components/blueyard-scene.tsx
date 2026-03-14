import React, { useRef, useMemo, Suspense, useEffect, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Html, Line } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';

// 鼠标交互上下文
const mouse = { x: 0, y: 0, targetX: 0, targetY: 0 };

// 核心星尘组件 - 纯概率体积云模型
function NimiGalaxy({ count = 60000, isExploring }: { count?: number; isExploring: boolean }) {
  const pointsRef = useRef<InstanceType<typeof THREE.Points> | null>(null);
  const { camera } = useThree();
  
  // 粒子数据生成 - 纯概率体积云
  const particlesData = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const initialPositions = new Float32Array(count * 3);

    // 定义颜色渐变节点
    const colorCenter = new THREE.Color('#E0FFFF');    // 中心极亮青白
    const colorMidBlue = new THREE.Color('#00BFFF');   // 中间深天蓝
    const colorDeepBlue = new THREE.Color('#1E90FF');  // 深蓝
    const colorPurple = new THREE.Color('#8A2BE2');    // 蓝紫
    const colorMagenta = new THREE.Color('#FF00FF');   // 洋红点缀
    const colorEdge = new THREE.Color('#0B1D3A');      // 边缘暗蓝

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      
      // === 1. 半径分布 (集中在核心，向外平滑扩散) ===
      let r = Math.pow(Math.random(), 1.5) * 6.5;
      
      // === 2. 角度与旋臂骨架 (设定 4 条旋臂，但用极端的角散射把它们晕染成星云) ===
      const arms = 4;
      const armOffset = Math.floor(Math.random() * arms) * (Math.PI * 2 / arms);
      let angle = armOffset + r * 0.8; // 基础螺旋扭曲

      // 关键：极致的角散射 (Angular Scatter) 填补黑缝
      // 如果半径小于 2.0 (核心区)，使用极大的散射(15.0)彻底打碎十字架形状，融合成高能球体；
      // 外部区域恢复正常的散射拖尾。
      const angularScatter = Math.pow(Math.random() - 0.5, 3) * (r < 2.0 ? 15.0 : 5.0 + r * 0.5);
      angle += angularScatter; 

      // === 3. 重新定义厚度包络线 (Envelope) ===
      // 让中心云层顶部更平滑 (Dome Shape)
      // 凹陷碟片形状：中心微凹陷(约0.3)，越往外侧越高(最高约2.1)
      const envelope = 0.3 + (1 - Math.exp(-r / 1.8)) * 1.8;
      // 生成 [-1, 1] 的均匀随机数
      const randY = (Math.random() - 0.5) * 2.0;
      // 保留符号的非线性散布
      // 使用 1.5 次方让粒子倾向于集中在星盘中心平面，但依然能触及上下最大边界
      const yDistribution = Math.sign(randY) * Math.pow(Math.abs(randY), 1.5);
      // 最终 Y 轴高度
      const y = yDistribution * envelope;

      // === 4. 最终坐标 ===
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;

      // 保存位置
      positions[i3] = x;
      positions[i3 + 1] = y;
      positions[i3 + 2] = z;
      
      initialPositions[i3] = x;
      initialPositions[i3 + 1] = y;
      initialPositions[i3 + 2] = z;

      // === 颜色计算 - 根据半径做连续渐变 ===
      const radiusRatio = r / 6.5;
      let finalColor = new THREE.Color();
      
      // 连续颜色渐变，不分区
      if (radiusRatio < 0.15) {
        // 核心：极亮青白
        finalColor.copy(colorCenter);
        // 核心中心更亮
        if (radiusRatio < 0.05) {
          finalColor.lerp(new THREE.Color('#FFFFFF'), 0.3);
        }
      } else if (radiusRatio < 0.4) {
        // 内环：青白 -> 深天蓝
        const t = (radiusRatio - 0.15) / 0.25;
        finalColor.copy(colorCenter).lerp(colorMidBlue, t);
      } else if (radiusRatio < 0.7) {
        // 中环：深天蓝 -> 深蓝
        const t = (radiusRatio - 0.4) / 0.3;
        finalColor.copy(colorMidBlue).lerp(colorDeepBlue, t);
      } else if (radiusRatio < 0.85) {
        // 外环：深蓝 -> 紫色/洋红点缀
        const t = (radiusRatio - 0.7) / 0.15;
        // 随机选择紫色或洋红作为点缀
        const accentColor = Math.random() < 0.6 ? colorPurple : colorMagenta;
        finalColor.copy(colorDeepBlue).lerp(accentColor, t);
      } else {
        // 边缘：逐渐变暗
        const t = (radiusRatio - 0.85) / 0.15;
        const edgeMix = Math.random() < 0.5 ? colorPurple : colorMagenta;
        finalColor.copy(edgeMix).lerp(colorEdge, t * 0.7);
      }
      
      // 添加微妙的颜色扰动，让星云更自然
      const colorNoise = (Math.random() - 0.5) * 0.08;
      finalColor.r += colorNoise;
      finalColor.g += colorNoise * 0.8;
      finalColor.b += colorNoise * 1.2;

      colors[i3] = finalColor.r;
      colors[i3 + 1] = finalColor.g;
      colors[i3 + 2] = finalColor.b;

      // 大小 - 中心大、边缘小，随机闪烁
      const baseSize = r < 1.0 ? 0.009 : r < 3.0 ? 0.006 : 0.003;
      sizes[i] = baseSize * (0.5 + Math.random());
    }

    return { positions, colors, sizes, initialPositions };
  }, [count]);

  const positionAttribute = useMemo(() => new THREE.BufferAttribute(particlesData.positions, 3), [particlesData.positions]);
  const colorAttribute = useMemo(() => new THREE.BufferAttribute(particlesData.colors, 3), [particlesData.colors]);
  const sizeAttribute = useMemo(() => new THREE.BufferAttribute(particlesData.sizes, 1), [particlesData.sizes]);

  // 动画循环
  useFrame((state, delta) => {
    if (!pointsRef.current) return;
    
    const positions = pointsRef.current.geometry.attributes.position;
    if (!positions || !positions.array) return;
    
    const posArray = positions.array as Float32Array;
    const time = state.clock.elapsedTime;
    
    // 平滑鼠标跟随
    mouse.targetX += (mouse.x - mouse.targetX) * 0.05;
    mouse.targetY += (mouse.y - mouse.targetY) * 0.05;
    
    // 整体缓慢旋转 - 像流体一样
    pointsRef.current.rotation.y += delta * 0.03;
    
    // 相机移动（探索模式）
    if (isExploring) {
      const targetPos = new THREE.Vector3(0, 0, 2);
      camera.position.lerp(targetPos, delta * 0.5);
    } else {
      const targetPos = new THREE.Vector3(0, 2.5, 7);
      camera.position.lerp(targetPos, delta * 0.5);
    }
    
    // 轻微的呼吸脉动效果
    for (let i = 0; i < count; i++) {
      const i3 = i * 3;
      const ix = particlesData.initialPositions[i3] ?? 0;
      const iy = particlesData.initialPositions[i3 + 1] ?? 0;
      const iz = particlesData.initialPositions[i3 + 2] ?? 0;
      
      // 呼吸脉动 - 整体像活的一样
      const breathe = Math.sin(time * 0.5 + ix * 0.3) * 0.015;
      
      posArray[i3] = ix + breathe;
      posArray[i3 + 1] = iy + breathe * 0.5;
      posArray[i3 + 2] = iz + breathe;
    }
    
    positions.needsUpdate = true;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <primitive attach="attributes-position" object={positionAttribute} />
        <primitive attach="attributes-color" object={colorAttribute} />
        <primitive attach="attributes-size" object={sizeAttribute} />
      </bufferGeometry>
      <pointsMaterial
        size={0.006}
        vertexColors
        transparent
        opacity={0.9}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// 悬浮空间标签组件
const nodesData = [
  { id: 'world', title: 'World', subtitle: 'PERSISTENT', pos: [-3, 1.5, -2] as [number, number, number] },
  { id: 'agents', title: 'Agents', subtitle: 'AUTONOMOUS', pos: [2.5, 1.8, -3] as [number, number, number] },
  { id: 'memory', title: 'Memory', subtitle: 'SHARED', pos: [3.5, -1.2, 1.5] as [number, number, number] },
  { id: 'runtime', title: 'Runtime', subtitle: 'LOCAL EXECUTION', pos: [-2.5, -1.5, 2] as [number, number, number] }
];

function FloatingNodes() {
  return (
    <group>
      {nodesData.map((node) => (
        <group key={node.id} position={node.pos}>
          {/* 1. 连接线：从星系中心 (0,0,0) 连向节点位置 */}
          <Line
            points={[[0, 0, 0], node.pos]}
            color="rgba(255, 255, 255, 0.08)"
            lineWidth={0.5}
            transparent
          />
          {/* 2. 悬浮的 HTML 标签 */}
          <Html center distanceFactor={10} zIndexRange={[100, 0]}>
            <div style={{ 
              color: 'white', 
              fontFamily: 'system-ui, -apple-system, sans-serif', 
              textAlign: 'center', 
              pointerEvents: 'none', 
              userSelect: 'none',
              textShadow: '0 0 20px rgba(0, 255, 255, 0.5)'
            }}>
              <div style={{ 
                fontSize: '10px', 
                color: '#00ffff', 
                letterSpacing: '2px', 
                textTransform: 'uppercase', 
                marginBottom: '4px', 
                opacity: 0.8 
              }}>
                {node.subtitle}
              </div>
              <div style={{ 
                fontSize: '16px', 
                fontWeight: 300,
                letterSpacing: '1px'
              }}>
                {node.title}
              </div>
            </div>
          </Html>
        </group>
      ))}
    </group>
  );
}

// 主场景组件
export default function BlueYardScene() {
  const [isExploring, setIsExploring] = useState(false);
  const [showContent, setShowContent] = useState(true);

  // 鼠标追踪
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    };
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  const handleExplore = () => {
    setShowContent(false);
    setIsExploring(true);
  };

  return (
    <div className="relative w-full h-screen bg-[#020205] overflow-hidden">
      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, 2.5, 7], fov: 60 }}
        style={{ background: '#020205' }}
      >
        <Suspense fallback={null}>
          <NimiGalaxy count={60000} isExploring={isExploring} />
          <FloatingNodes />
          <OrbitControls
            enableDamping
            dampingFactor={0.05}
            enablePan={false}
            minDistance={2}
            maxDistance={15}
            maxPolarAngle={Math.PI / 2 + 0.3}
          />
          <EffectComposer>
            <Bloom
              intensity={1.5}
              luminanceThreshold={0.2}
              luminanceSmoothing={0.9}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>

      {/* UI 层 */}
      <div className="absolute inset-0 pointer-events-none">
        {/* 顶部 Logo */}
        <div className="absolute top-8 left-1/2 -translate-x-1/2 text-white text-sm tracking-[0.3em] font-light text-center">
          BLUE<br/>YARD
        </div>

        {/* 左侧主内容 */}
        {showContent && (
          <div className="absolute left-12 top-1/2 -translate-y-1/2 max-w-md text-white pointer-events-auto">
            <p className="text-xs tracking-[0.2em] uppercase mb-4 text-gray-300">
              Investing in founders creating the
            </p>
            <h1 className="text-6xl font-light leading-tight mb-6">
              FABRIC OF<br/>OUR FUTURE
            </h1>
            <p className="text-sm text-gray-300 leading-relaxed mb-8 max-w-sm">
              BlueYard backs founders at the earliest stages building the 
              interconnected elements that can become the fabric of our future. 
              A future where markets are open and decentralized, where we 
              have solved our largest planetary challenges, where knowledge 
              and data is liberated and humanity can live long and prosper.
            </p>
            <button 
              onClick={handleExplore}
              className="group flex items-center gap-3 text-xs tracking-[0.2em] uppercase hover:opacity-70 transition-opacity"
            >
              <span>Explore the future</span>
              <div className="w-10 h-10 rounded-full border border-white/30 flex items-center justify-center group-hover:bg-white/10 transition-colors">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </div>
            </button>
          </div>
        )}

        {/* 螺旋臂上的标签 - 跟随流体扭曲分布 */}
        {!isExploring && (
          <>
            <div className="absolute top-[35%] left-[55%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">Scenius</span>
              <span className="text-sm">WEB3</span>
            </div>
            <div className="absolute top-[45%] left-[35%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">Programmable</span>
              <span className="text-sm">BIOLOGY</span>
            </div>
            <div className="absolute top-[55%] left-[30%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">Breakthrough</span>
              <span className="text-sm">COMPUTATION &<br/>ENGINEERING</span>
            </div>
            <div className="absolute top-[60%] left-[50%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">Liberated</span>
              <span className="text-sm">DATA</span>
            </div>
            <div className="absolute top-[50%] left-[65%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">About</span>
              <span className="text-sm">BLUEYARD</span>
            </div>
            <div className="absolute top-[58%] left-[68%] text-white/60 text-xs tracking-wider">
              <span className="block text-[10px] uppercase mb-1">Access</span>
              <span className="text-sm">KNOWLEDGE &<br/>UPDATES</span>
            </div>
          </>
        )}

        {/* 右下角 Audio 按钮 */}
        <div className="absolute bottom-8 right-8 pointer-events-auto">
          <button className="flex items-center gap-2 text-white/60 text-xs tracking-wider hover:text-white transition-colors">
            <span>AUDIO</span>
            <div className="w-8 h-4 rounded-full border border-white/30 flex items-center px-0.5">
              <div className="w-3 h-3 rounded-full bg-white/60 ml-auto" />
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}
