import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VRMExpressionPresetName, VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
  type ChatAgentAvatarVrmViewportState,
} from './chat-agent-avatar-vrm-viewport-state';

type AnimatedAvatarObject = {
  rotation: { x: number; y: number };
  position: { y: number };
  scale: { setScalar: (value: number) => void };
};

type LoadedVrmState =
  | { status: 'idle' | 'loading'; vrm: null; error: null }
  | { status: 'ready'; vrm: VRM; error: null }
  | { status: 'error'; vrm: null; error: string };

function AvatarBust({
  state,
}: {
  state: ChatAgentAvatarVrmViewportState;
}) {
  const groupRef = useRef<AnimatedAvatarObject | null>(null);
  const shouldersRef = useRef<AnimatedAvatarObject | null>(null);

  useFrame((renderState) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.45 * state.motionSpeed) * 0.18;
      groupRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.28 * state.motionSpeed) * 0.06;
      groupRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.65 * state.motionSpeed) * 0.08;
    }
    if (shouldersRef.current) {
      const breathing = 1 + Math.sin(renderState.clock.elapsedTime * (0.8 + state.amplitude * 0.6)) * (0.02 + state.amplitude * 0.018);
      shouldersRef.current.scale.setScalar(breathing);
    }
    if (groupRef.current && state.phase === 'speaking') {
      const speakingPulse = 1 + Math.sin(renderState.clock.elapsedTime * (4.2 + state.amplitude * 6)) * (0.018 + state.amplitude * 0.026);
      groupRef.current.scale.setScalar(speakingPulse);
    } else if (groupRef.current) {
      groupRef.current.scale.setScalar(1);
    }
  });

  return (
    <group ref={groupRef} position={[0, -0.1, 0]}>
      <mesh position={[0, -1.15, 0]} rotation={[0.25, 0, 0]}>
        <ringGeometry args={[1.1, 1.52, 64]} />
        <meshBasicMaterial color={state.glowColor} transparent opacity={0.18} />
      </mesh>
      <group ref={shouldersRef} position={[0, -0.55, 0]}>
        <mesh>
          <sphereGeometry args={[0.86, 48, 48, 0, Math.PI * 2, 0, Math.PI / 2.2]} />
          <meshStandardMaterial color={state.accentColor} roughness={0.38} metalness={0.05} emissive={state.accentColor} emissiveIntensity={0.08} />
        </mesh>
      </group>
      <mesh position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.62, 48, 48]} />
        <meshPhysicalMaterial color="#f8fafc" roughness={0.2} metalness={0.02} clearcoat={0.4} clearcoatRoughness={0.22} emissive={state.glowColor} emissiveIntensity={0.04} />
      </mesh>
      <mesh position={[0, 0.95, -0.06]}>
        <sphereGeometry args={[0.42, 48, 48]} />
        <meshStandardMaterial color={state.accentColor} roughness={0.46} metalness={0.02} emissive={state.accentColor} emissiveIntensity={0.11} />
      </mesh>
      <mesh position={[0, 0.44, 0.56]} scale={[1, 0.14 + state.amplitude * 0.18, 0.08]}>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshBasicMaterial color={state.phase === 'speaking' ? state.accentColor : '#f97316'} transparent opacity={0.9} />
      </mesh>
      <mesh position={[-0.22, 0.52, 0.54]} scale={[0.12, state.phase === 'thinking' ? 0.05 : 0.08, 0.06]}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0.22, 0.52, 0.54]} scale={[0.12, state.phase === 'thinking' ? 0.05 : 0.08, 0.06]}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      <mesh position={[0, 0.1, 0.64]} scale={[0.09, 0.18, 0.08]}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshStandardMaterial color="#f1f5f9" emissive={state.glowColor} emissiveIntensity={0.06} />
      </mesh>
    </group>
  );
}

function RuntimeVrmModel({
  vrm,
  state,
  input,
}: {
  vrm: VRM;
  state: ChatAgentAvatarVrmViewportState;
  input: AvatarVrmViewportComponentProps['input'];
}) {
  const rootRef = useRef<AnimatedAvatarObject | null>(null);
  const expressionWeights = useMemo(
    () => resolveChatAgentAvatarVrmExpressionWeights(input),
    [input],
  );
  const transform = useMemo(() => {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);
    const height = size.y > 0 ? size.y : 1.8;
    const scale = 2.85 / height;
    return {
      scale,
      position: new THREE.Vector3(
        -center.x * scale,
        -center.y * scale - 1.35,
        -center.z * scale,
      ),
    };
  }, [vrm]);

  useFrame((renderState, delta) => {
    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.3 * state.motionSpeed) * 0.1;
      rootRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.22 * state.motionSpeed) * 0.03;
      rootRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.4 * state.motionSpeed) * 0.04;
    }

    const expressionManager = vrm.expressionManager;
    if (expressionManager) {
      expressionManager.resetValues();
      for (const [name, weight] of Object.entries(expressionWeights)) {
        expressionManager.setValue(name as keyof typeof VRMExpressionPresetName | string, weight);
      }
      const blink = Math.max(
        0,
        Math.sin(renderState.clock.elapsedTime * (state.phase === 'speaking' ? 6 : 3.2)) > 0.96
          ? 0.95
          : 0,
      );
      if (blink > 0) {
        expressionManager.setValue(VRMExpressionPresetName.Blink, blink);
      }
    }

    vrm.update(delta);
  });

  return (
    <group ref={rootRef}>
      <primitive
        object={vrm.scene}
        position={[transform.position.x, transform.position.y, transform.position.z]}
        scale={transform.scale}
      />
    </group>
  );
}

function AvatarScene({
  state,
  input,
  loadedVrm,
}: {
  state: ChatAgentAvatarVrmViewportState;
  input: AvatarVrmViewportComponentProps['input'];
  loadedVrm: LoadedVrmState;
}) {
  return (
    <>
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#e0f2fe', 5, 10]} />
      <ambientLight intensity={0.65} />
      <directionalLight position={[2.5, 3, 3]} intensity={2.2} color="#ffffff" />
      <pointLight position={[-3, 1.5, 2]} intensity={1.4} color={state.accentColor} />
      <pointLight position={[0, -2, 2]} intensity={0.8} color={state.glowColor} />
      <Sparkles
        count={24}
        scale={3.2}
        size={2.2}
        speed={state.sparklesSpeed}
        color={state.glowColor}
        opacity={0.45}
      />
      {loadedVrm.status === 'ready' ? (
        <RuntimeVrmModel vrm={loadedVrm.vrm} state={state} input={input} />
      ) : (
        <Float speed={state.motionSpeed} rotationIntensity={0.16} floatIntensity={0.22}>
          <AvatarBust state={state} />
        </Float>
      )}
      <EffectComposer>
        <Bloom
          luminanceThreshold={0.18}
          mipmapBlur
          intensity={loadedVrm.status === 'ready'
            ? state.phase === 'speaking'
              ? 1.1 + state.amplitude * 0.3
              : 0.85
            : state.phase === 'speaking'
              ? 1.35 + state.amplitude * 0.5
              : 1.05}
          radius={0.72}
        />
      </EffectComposer>
    </>
  );
}

export default function ChatAgentAvatarVrmViewport({
  input,
  chrome = 'default',
}: AvatarVrmViewportComponentProps) {
  const state = useMemo(() => resolveChatAgentAvatarVrmViewportState(input), [input]);
  const assetUrl = useMemo(
    () => resolveChatAgentAvatarVrmAssetUrl(input.assetRef),
    [input.assetRef],
  );
  const [loadedVrm, setLoadedVrm] = useState<LoadedVrmState>({
    status: assetUrl ? 'loading' : 'idle',
    vrm: null,
    error: null,
  });

  useEffect(() => {
    if (!assetUrl) {
      setLoadedVrm({
        status: 'idle',
        vrm: null,
        error: null,
      });
      return undefined;
    }

    let active = true;
    let retainedVrm: VRM | null = null;
    setLoadedVrm({
      status: 'loading',
      vrm: null,
      error: null,
    });

    const loader = new GLTFLoader();
    loader.crossOrigin = 'anonymous';
    loader.register((parser) => new VRMLoaderPlugin(parser));

    loader.load(
      assetUrl,
      (gltf: GLTF) => {
        const vrm = gltf.userData.vrm as VRM | undefined;
        if (!vrm) {
          if (active) {
            setLoadedVrm({
              status: 'error',
              vrm: null,
              error: 'A VRM profile was requested, but the asset did not expose VRM data.',
            });
          }
          return;
        }

        retainedVrm = vrm;
        VRMUtils.rotateVRM0(vrm);
        vrm.scene.traverse((object: { frustumCulled: boolean }) => {
          object.frustumCulled = false;
        });

        if (!active) {
          VRMUtils.deepDispose(vrm.scene);
          return;
        }

        setLoadedVrm({
          status: 'ready',
          vrm,
          error: null,
        });
      },
      undefined,
      (error: unknown) => {
        if (!active) {
          return;
        }
        setLoadedVrm({
          status: 'error',
          vrm: null,
          error: error instanceof Error ? error.message : 'Failed to load VRM asset.',
        });
      },
    );

    return () => {
      active = false;
      if (retainedVrm) {
        VRMUtils.deepDispose(retainedVrm.scene);
      }
    };
  }, [assetUrl]);

  const showPosterFallback = chrome === 'minimal'
    && loadedVrm.status !== 'ready'
    && Boolean(input.posterUrl);

  return (
    <div
      className={cn(
        'relative flex h-full w-full items-center justify-center overflow-hidden',
        chrome === 'minimal'
          ? 'bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.98),rgba(239,250,248,0.92)_34%,rgba(214,235,247,0.84)_68%,rgba(186,230,253,0.34))]'
          : 'bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.98),rgba(224,231,255,0.88)_45%,rgba(186,230,253,0.7)_68%,rgba(14,165,233,0.16))]',
      )}
      data-desktop-agent-vrm-viewport="true"
    >
      {input.posterUrl ? (
        <img
          src={input.posterUrl}
          alt={input.label}
          className={cn(
            'absolute inset-0 h-full w-full object-cover saturate-150',
            chrome === 'minimal' ? 'opacity-[0.08]' : 'opacity-20',
          )}
        />
      ) : null}
      <span
        className={cn(
          'pointer-events-none absolute inset-0',
          chrome === 'minimal'
            ? 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.62),transparent_52%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_34%,rgba(15,23,42,0.05)_100%)]'
            : 'bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.58),transparent_54%)]',
        )}
      />
      <div className={cn(
        'absolute overflow-hidden border border-white/70 bg-white/18 shadow-[0_30px_80px_rgba(14,165,233,0.14)] backdrop-blur-[2px]',
        chrome === 'minimal'
          ? 'inset-x-[4%] inset-y-[3.5%] rounded-[28px] border-white/55 bg-white/12 shadow-[0_26px_64px_rgba(15,23,42,0.08)]'
          : 'inset-[6%] rounded-[46%]',
      )}>
        {showPosterFallback ? (
          <div className="relative h-full w-full overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.18),rgba(255,255,255,0.02))]">
            <img
              src={input.posterUrl || ''}
              alt={input.label}
              className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.94] saturate-[1.08]"
            />
            <span className="absolute inset-0 bg-[radial-gradient(circle_at_50%_14%,rgba(255,255,255,0.72),transparent_38%),linear-gradient(180deg,rgba(255,255,255,0.12),transparent_26%,rgba(15,23,42,0.08)_94%)]" />
            <span className="absolute inset-x-[12%] bottom-[8%] h-[22%] rounded-full bg-[radial-gradient(circle,rgba(255,255,255,0.24),rgba(14,165,233,0.12)_48%,transparent_78%)] blur-2xl" />
            <span className="absolute inset-x-0 bottom-0 h-[28%] bg-[linear-gradient(180deg,transparent,rgba(255,255,255,0.16)_18%,rgba(9,22,34,0.28))]" />
          </div>
        ) : (
          <Canvas
            camera={{ position: [0, 0.15, 4.4], fov: 28 }}
            dpr={[1, 1.8]}
            gl={{ antialias: true, alpha: true }}
          >
            <Suspense fallback={null}>
              <AvatarScene state={state} input={input} loadedVrm={loadedVrm} />
            </Suspense>
          </Canvas>
        )}
      </div>
      <span
        className={cn(
          'pointer-events-none absolute border',
          chrome === 'minimal' ? 'inset-x-[7%] inset-y-[6%] rounded-[24px]' : 'inset-[10%] rounded-[48%]',
        )}
        style={{
          borderColor: `${state.accentColor}38`,
          boxShadow: `0 0 0 1px ${state.glowColor}2a inset`,
        }}
      />
      {chrome === 'default' ? (
        <span className="absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-2 rounded-full border border-white/75 bg-slate-950/82 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-[0_10px_24px_rgba(15,23,42,0.18)]">
          <span
            className={cn(
              'inline-block h-1.5 w-1.5 rounded-full',
              state.phase === 'speaking' || state.phase === 'listening' ? 'animate-pulse' : '',
            )}
            style={{ background: state.glowColor }}
          />
          <span>{state.badgeLabel}</span>
        </span>
      ) : null}
      {chrome === 'default' && loadedVrm.status === 'loading' ? (
        <span className="absolute top-11 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
          Loading model
        </span>
      ) : null}
      {chrome === 'default' && loadedVrm.status === 'error' ? (
        <span
          className="absolute top-11 max-w-[72%] rounded-full border border-amber-200/80 bg-white/92 px-2.5 py-1 text-center text-[10px] font-semibold text-amber-700 shadow-[0_8px_20px_rgba(15,23,42,0.08)]"
          title={loadedVrm.error}
        >
          VRM fallback active
        </span>
      ) : null}
      {chrome === 'default' ? (
        <>
          <span className="absolute left-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] shadow-[0_8px_20px_rgba(14,165,233,0.12)]" style={{ color: state.accentColor }}>
            {loadedVrm.status === 'ready' ? 'VRM Live' : 'VRM'}
          </span>
          <span className="absolute right-3 top-3 rounded-full border border-white/75 bg-white/88 px-2.5 py-1 text-[10px] font-semibold text-slate-600 shadow-[0_8px_20px_rgba(15,23,42,0.08)]">
            {state.emotion}
          </span>
          <span className="absolute bottom-12 rounded-full border border-white/70 bg-white/86 px-2.5 py-1 text-[10px] font-semibold text-slate-700 shadow-[0_10px_24px_rgba(15,23,42,0.08)]">
            {state.assetLabel}
          </span>
        </>
      ) : null}
    </div>
  );
}
