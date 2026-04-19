import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { Float, Sparkles } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { VRMExpressionPresetName, VRMHumanBoneName, type VRM } from '@pixiv/three-vrm';
import type { AvatarVrmViewportComponentProps } from '@nimiplatform/nimi-kit/features/avatar/vrm';

import {
  resolveChatAgentAvatarVrmExpressionWeights,
  type ChatAgentAvatarVrmViewportState,
} from './chat-agent-avatar-vrm-viewport-state';
import type { ChatAgentAvatarVrmFramingResult } from './chat-agent-avatar-vrm-framing';
import type { LoadedVrmState } from './chat-agent-avatar-vrm-runtime';
import { recordGlobalVrmRenderLoopFrame } from './chat-agent-avatar-vrm-diagnostics';

type AnimatedAvatarObject = {
  rotation: { x: number; y: number };
  position: { y: number };
  scale: { setScalar: (value: number) => void };
};

type AnimatedEyeObject = {
  position: { x: number; y: number };
};

export function applyIdlePose(vrm: VRM) {
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
  verticalOffsetY,
}: {
  state: ChatAgentAvatarVrmViewportState;
  verticalOffsetY: number;
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
    const ambientWeight = THREE.MathUtils.clamp(1 - state.attentionInfluence * 0.82, 0.18, 1);
    if (groupRef.current) {
      groupRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.45 * state.motionSpeed) * state.bodyYawAmplitude * ambientWeight + followRef.current.headX;
      groupRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.28 * state.motionSpeed) * state.bodyPitchAmplitude * ambientWeight + followRef.current.headY;
      groupRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.65 * state.motionSpeed) * state.bodyLiftAmplitude * (0.55 + ambientWeight * 0.45);
    }
    if (shouldersRef.current) {
      const breathing = 1 + Math.sin(renderState.clock.elapsedTime * state.breathingSpeed) * state.breathingScaleAmount;
      shouldersRef.current.scale.setScalar(breathing);
    }
    if (groupRef.current && state.speakingPulseAmount > 0) {
      const speakingPulse = 1 + Math.sin(renderState.clock.elapsedTime * state.speakingPulseSpeed) * state.speakingPulseAmount;
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
    <group ref={groupRef} position={[0, -0.1 + verticalOffsetY, 0]}>
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
      <mesh position={[0, 0.44, 0.56]} scale={[1, state.mouthOpen, 0.08]}>
        <sphereGeometry args={[0.16, 24, 24]} />
        <meshBasicMaterial color={state.phase === 'speaking' ? state.accentColor : '#f97316'} transparent opacity={0.9} />
      </mesh>
      <mesh ref={leftEyeRef} position={[-0.22, 0.52, 0.54]} scale={[0.12, state.eyeOpen, 0.06]}>
        <sphereGeometry args={[1, 18, 18]} />
        <meshBasicMaterial color="#0f172a" />
      </mesh>
      <mesh ref={rightEyeRef} position={[0.22, 0.52, 0.54]} scale={[0.12, state.eyeOpen, 0.06]}>
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
  framing,
  verticalOffsetY,
}: {
  vrm: VRM;
  state: ChatAgentAvatarVrmViewportState;
  input: AvatarVrmViewportComponentProps['input'];
  framing: ChatAgentAvatarVrmFramingResult;
  verticalOffsetY: number;
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
  useFrame((renderState, delta) => {
    followRef.current.headX = THREE.MathUtils.damp(followRef.current.headX, state.headFollowX, 8.2, delta);
    followRef.current.headY = THREE.MathUtils.damp(followRef.current.headY, state.headFollowY, 8.2, delta);
    followRef.current.eyeX = THREE.MathUtils.damp(followRef.current.eyeX, state.eyeFollowX, 9.6, delta);
    followRef.current.eyeY = THREE.MathUtils.damp(followRef.current.eyeY, state.eyeFollowY, 9.6, delta);
    const ambientWeight = THREE.MathUtils.clamp(1 - state.attentionInfluence * 0.78, 0.24, 1);

    if (rootRef.current) {
      rootRef.current.rotation.y = Math.sin(renderState.clock.elapsedTime * 0.3 * state.motionSpeed) * state.bodyYawAmplitude * ambientWeight;
      rootRef.current.rotation.x = Math.cos(renderState.clock.elapsedTime * 0.22 * state.motionSpeed) * state.bodyPitchAmplitude * ambientWeight;
      rootRef.current.position.y = Math.sin(renderState.clock.elapsedTime * 0.4 * state.motionSpeed) * state.bodyLiftAmplitude * (0.65 + ambientWeight * 0.35);
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
        Math.sin(renderState.clock.elapsedTime * state.blinkSpeed) > 0.96
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
        position={[framing.positionX, framing.positionY + verticalOffsetY, framing.positionZ]}
        scale={framing.scale}
      />
    </group>
  );
}

export function VrmRenderLoopTelemetry({
  canvasEpoch,
  ready,
}: {
  canvasEpoch: number;
  ready: boolean;
}) {
  useFrame((renderState) => {
    recordGlobalVrmRenderLoopFrame({
      canvasEpoch,
      ready,
      gl: renderState.gl,
    });
  });
  return null;
}

export function AvatarScene({
  state,
  input,
  loadedVrm,
  framing,
  verticalOffsetY,
}: {
  state: ChatAgentAvatarVrmViewportState;
  input: AvatarVrmViewportComponentProps['input'];
  loadedVrm: LoadedVrmState;
  framing: ChatAgentAvatarVrmFramingResult | null;
  verticalOffsetY: number;
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
        <RuntimeVrmModel
          vrm={loadedVrm.vrm}
          state={state}
          input={input}
          framing={framing!}
          verticalOffsetY={verticalOffsetY}
        />
      ) : (
        <Float speed={state.motionSpeed} rotationIntensity={0.16} floatIntensity={0.22}>
          <AvatarBust state={state} verticalOffsetY={verticalOffsetY} />
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
