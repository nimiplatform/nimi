import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VRMExpressionPresetName, VRMHumanBoneName, VRMLoaderPlugin, VRMUtils, type VRM } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';
import { cn } from '@nimiplatform/nimi-kit/ui';
import {
  parseDesktopAgentAvatarAssetRef,
  type DesktopAgentAvatarAssetRef,
  resolveChatAgentAvatarVrmAssetUrl,
  resolveChatAgentAvatarVrmExpressionWeights,
  resolveChatAgentAvatarVrmViewportState,
  type ChatAgentAvatarVrmViewportState,
} from './chat-agent-avatar-vrm-viewport-state';
import type { ChatAgentAvatarPointerInteractionState } from './chat-agent-avatar-pointer-interaction';
import { readDesktopAgentAvatarResourceAsset } from '@renderer/bridge/runtime-bridge/chat-agent-avatar-store';

type AnimatedAvatarObject = {
  rotation: { x: number; y: number };
  position: { y: number };
  scale: { setScalar: (value: number) => void };
};

type AnimatedEyeObject = {
  position: { x: number; y: number };
};

type LoadedVrmState =
  | { status: 'idle' | 'loading'; vrm: null; error: null }
  | { status: 'ready'; vrm: VRM; error: null }
  | { status: 'error'; vrm: null; error: string };

type ChatAgentAvatarVrmViewportProps = AvatarVrmViewportComponentProps & {
  pointerInteraction?: ChatAgentAvatarPointerInteractionState | null;
};

function applyIdlePose(vrm: VRM) {
  const humanoid = vrm.humanoid;
  const leftUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftUpperArm);
  const rightUpperArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightUpperArm);
  const leftLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftLowerArm);
  const rightLowerArm = humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightLowerArm);
  const spine = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Spine);
  const chest = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Chest);
  const neck = humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck);

  if (leftUpperArm) {
    leftUpperArm.rotation.z = THREE.MathUtils.degToRad(58);
    leftUpperArm.rotation.x = THREE.MathUtils.degToRad(8);
  }
  if (rightUpperArm) {
    rightUpperArm.rotation.z = THREE.MathUtils.degToRad(-58);
    rightUpperArm.rotation.x = THREE.MathUtils.degToRad(8);
  }
  if (leftLowerArm) {
    leftLowerArm.rotation.z = THREE.MathUtils.degToRad(-18);
    leftLowerArm.rotation.y = THREE.MathUtils.degToRad(4);
  }
  if (rightLowerArm) {
    rightLowerArm.rotation.z = THREE.MathUtils.degToRad(18);
    rightLowerArm.rotation.y = THREE.MathUtils.degToRad(-4);
  }
  if (spine) {
    spine.rotation.x = THREE.MathUtils.degToRad(3);
  }
  if (chest) {
    chest.rotation.x = THREE.MathUtils.degToRad(2);
  }
  if (neck) {
    neck.rotation.x = THREE.MathUtils.degToRad(-2);
  }
}

function AvatarBust({
  state,
}: {
  state: ChatAgentAvatarVrmViewportState;
}) {
  const groupRef = useRef<AnimatedAvatarObject | null>(null);
  const shouldersRef = useRef<AnimatedAvatarObject | null>(null);
  const leftEyeRef = useRef<AnimatedEyeObject | null>(null);
  const rightEyeRef = useRef<AnimatedEyeObject | null>(null);
  const followRef = useRef({ headX: 0, headY: 0, eyeX: 0, eyeY: 0 });

  useFrame((renderState, delta) => {
    followRef.current.headX = THREE.MathUtils.damp(followRef.current.headX, state.headFollowX, 8.8, delta);
    followRef.current.headY = THREE.MathUtils.damp(followRef.current.headY, state.headFollowY, 8.8, delta);
    followRef.current.eyeX = THREE.MathUtils.damp(followRef.current.eyeX, state.eyeFollowX, 10.2, delta);
    followRef.current.eyeY = THREE.MathUtils.damp(followRef.current.eyeY, state.eyeFollowY, 10.2, delta);
    const ambientWeight = THREE.MathUtils.clamp(1 - state.pointerInfluence * 0.82, 0.18, 1);
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.45 * state.motionSpeed) * 0.18 * ambientWeight + followRef.current.headX;
      groupRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.28 * state.motionSpeed) * 0.06 * ambientWeight + followRef.current.headY;
      groupRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.65 * state.motionSpeed) * 0.08 * (0.55 + ambientWeight * 0.45);
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
    if (leftEyeRef.current) {
      leftEyeRef.current.position.x = -0.22 + followRef.current.eyeX;
      leftEyeRef.current.position.y = 0.52 + followRef.current.eyeY;
    }
    if (rightEyeRef.current) {
      rightEyeRef.current.position.x = 0.22 + followRef.current.eyeX;
      rightEyeRef.current.position.y = 0.52 + followRef.current.eyeY;
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
      <mesh ref={leftEyeRef} position={[-0.22, 0.52, 0.54]} scale={[0.12, state.phase === 'thinking' ? 0.05 : 0.08, 0.06]}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      <mesh ref={rightEyeRef} position={[0.22, 0.52, 0.54]} scale={[0.12, state.phase === 'thinking' ? 0.05 : 0.08, 0.06]}>
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
  input: ChatAgentAvatarVrmViewportProps['input'];
}) {
  const rootRef = useRef<AnimatedAvatarObject | null>(null);
  const followRef = useRef({ headX: 0, headY: 0, eyeX: 0, eyeY: 0 });
  const expressionWeights = useMemo(
    () => resolveChatAgentAvatarVrmExpressionWeights(input),
    [input],
  );
  const bones = useMemo(() => ({
    neck: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Neck),
    head: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.Head),
    leftEye: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.LeftEye),
    rightEye: vrm.humanoid.getNormalizedBoneNode(VRMHumanBoneName.RightEye),
  }), [vrm]);
  const transform = useMemo(() => {
    const box = new THREE.Box3().setFromObject(vrm.scene);
    const size = new THREE.Vector3();
    box.getSize(size);
    const height = size.y > 0 ? size.y : 1.8;
    const scale = 2.95 / height;
    const desiredBottom = -2.02;
    return {
      scale,
      position: new THREE.Vector3(
        -(box.min.x + size.x / 2) * scale,
        desiredBottom - box.min.y * scale,
        -(box.min.z + size.z / 2) * scale + 0.08,
      ),
    };
  }, [vrm]);

  useFrame((renderState, delta) => {
    followRef.current.headX = THREE.MathUtils.damp(followRef.current.headX, state.headFollowX, 8.2, delta);
    followRef.current.headY = THREE.MathUtils.damp(followRef.current.headY, state.headFollowY, 8.2, delta);
    followRef.current.eyeX = THREE.MathUtils.damp(followRef.current.eyeX, state.eyeFollowX, 9.6, delta);
    followRef.current.eyeY = THREE.MathUtils.damp(followRef.current.eyeY, state.eyeFollowY, 9.6, delta);
    const ambientWeight = THREE.MathUtils.clamp(1 - state.pointerInfluence * 0.78, 0.24, 1);

    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.3 * state.motionSpeed) * 0.1 * ambientWeight;
      rootRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.22 * state.motionSpeed) * 0.03 * ambientWeight;
      rootRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.4 * state.motionSpeed) * 0.04 * (0.65 + ambientWeight * 0.35);
    }
    if (bones.neck) {
      bones.neck.rotation.x = THREE.MathUtils.degToRad(-2) + followRef.current.headY * 0.42;
      bones.neck.rotation.y = followRef.current.headX * 0.55;
    }
    if (bones.head) {
      bones.head.rotation.x = followRef.current.headY * 0.75;
      bones.head.rotation.y = followRef.current.headX * 0.82;
    }
    if (bones.leftEye) {
      bones.leftEye.rotation.x = followRef.current.eyeY;
      bones.leftEye.rotation.y = followRef.current.eyeX;
    }
    if (bones.rightEye) {
      bones.rightEye.rotation.x = followRef.current.eyeY;
      bones.rightEye.rotation.y = followRef.current.eyeX;
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
  input: ChatAgentAvatarVrmViewportProps['input'];
  loadedVrm: LoadedVrmState;
}) {
  return (
    <>
      <color attach="background" args={['#edf3f7']} />
      <fog attach="fog" args={['#e5eef4', 6.8, 11.8]} />
      <ambientLight intensity={0.74} color="#f5f8fb" />
      <directionalLight position={[1.45, 2.8, 4.2]} intensity={1.08} color="#fff5ea" />
      <directionalLight position={[-2.2, 1.9, 2.7]} intensity={0.42} color="#d9e9fa" />
      <pointLight position={[0.3, 1.2, -2.4]} intensity={0.18} color="#c7e5ff" />
      <pointLight position={[0, -1.1, 2.1]} intensity={0.08} color={state.glowColor} />
      <Sparkles
        count={6}
        scale={2.8}
        size={1.2}
        speed={Math.max(0.08, state.sparklesSpeed * 0.32)}
        color={state.glowColor}
        opacity={0.08}
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
          luminanceThreshold={0.92}
          mipmapBlur
          intensity={loadedVrm.status === 'ready'
            ? state.phase === 'speaking'
              ? 0.045 + state.amplitude * 0.02
              : 0.01
            : state.phase === 'speaking'
              ? 0.08 + state.amplitude * 0.03
              : 0.02}
          radius={0.26}
        />
      </EffectComposer>
    </>
  );
}

export default function ChatAgentAvatarVrmViewport({
  input,
  chrome = 'default',
  pointerInteraction,
}: ChatAgentAvatarVrmViewportProps) {
  const state = useMemo(
    () => resolveChatAgentAvatarVrmViewportState(input, pointerInteraction),
    [input, pointerInteraction],
  );
  const desktopAssetRef = useMemo<DesktopAgentAvatarAssetRef | null>(
    () => parseDesktopAgentAvatarAssetRef(input.assetRef),
    [input.assetRef],
  );
  const networkAssetUrl = useMemo(
    () => resolveChatAgentAvatarVrmAssetUrl(input.assetRef),
    [input.assetRef],
  );
  const [assetUrl, setAssetUrl] = useState<string | null>(networkAssetUrl);
  const [loadedVrm, setLoadedVrm] = useState<LoadedVrmState>({
    status: assetUrl ? 'loading' : 'idle',
    vrm: null,
    error: null,
  });

  useEffect(() => {
    if (!desktopAssetRef) {
      setAssetUrl(networkAssetUrl);
      return undefined;
    }
    let active = true;
    let objectUrl: string | null = null;

    setAssetUrl(null);
    setLoadedVrm({
      status: 'loading',
      vrm: null,
      error: null,
    });

    void readDesktopAgentAvatarResourceAsset(desktopAssetRef.resourceId)
      .then((asset) => {
        if (!active) {
          return;
        }
        const binary = Uint8Array.from(atob(asset.base64), (character) => character.charCodeAt(0));
        objectUrl = URL.createObjectURL(new Blob([binary], { type: asset.mimeType || 'model/gltf-binary' }));
        setAssetUrl(objectUrl);
      })
      .catch((error: unknown) => {
        if (!active) {
          return;
        }
        setLoadedVrm({
          status: 'error',
          vrm: null,
          error: error instanceof Error ? error.message : 'Failed to load desktop avatar asset.',
        });
      });

    return () => {
      active = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [desktopAssetRef, networkAssetUrl]);

  useEffect(() => {
    if (!assetUrl) {
      setLoadedVrm((previous) => previous.status === 'loading'
        ? previous
        : {
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
        applyIdlePose(vrm);
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

  const debugLines = chrome === 'minimal' && loadedVrm.status !== 'ready'
    ? [
      `status: ${loadedVrm.status}`,
      `assetRef: ${input.assetRef || 'none'}`,
      `assetUrl: ${assetUrl || 'none'}`,
      loadedVrm.error ? `error: ${loadedVrm.error}` : null,
    ].filter(Boolean)
    : [];

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
      data-avatar-pointer-hovered={pointerInteraction?.hovered ? 'true' : 'false'}
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
            camera={{ position: [0, 0.58, 5.05], fov: 25 }}
            dpr={[1, 1.8]}
            gl={{ antialias: true, alpha: true }}
            onCreated={({ gl }) => {
              gl.outputColorSpace = THREE.SRGBColorSpace;
              gl.toneMapping = THREE.ACESFilmicToneMapping;
              gl.toneMappingExposure = 0.92;
            }}
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
      {chrome === 'minimal' && debugLines.length > 0 ? (
        <div
          className="absolute inset-x-3 bottom-3 rounded-2xl border border-amber-200/70 bg-white/88 px-3 py-2 text-[10px] leading-4 text-amber-900 shadow-[0_10px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm"
          data-avatar-vrm-debug="true"
        >
          {debugLines.map((line) => (
            <div key={line} className="truncate font-mono">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
