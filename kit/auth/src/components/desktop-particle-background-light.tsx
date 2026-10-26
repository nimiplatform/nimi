import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { createNoise3D } from 'simplex-noise';
import { allowsParticleMotion } from './particle-background-policy.js';
import { particleCellKey, visitParticleNeighbors } from './particle-background-neighbors.js';

type ParticleBackgroundProfile = 'desktop' | 'web';

const BASE_PARTICLE_CONFIG = {
  particleCount: 500,
  connectDistance: 110,
  baseSpeed: 0.5,
  noiseScale: 0.003,
  timeScale: 0.2,
  mouseRepelRadius: 180,
  mouseRepelForce: 1.5,
  cohesionForce: 0.08,
  separationForce: 2.5,
  separationDistance: 30,
  centerAttractForce: 0.45,
  centerStopRadius: 60,
  centerVortexForce: 1.2,
  hoverNoiseScale: 0.006,
} as const;

function resolveParticleConfig(profile: ParticleBackgroundProfile) {
  if (profile === 'web') {
    // Web viewport is usually larger; increase density/speed to keep desktop-like perception.
    return {
      ...BASE_PARTICLE_CONFIG,
      particleCount: 1000,
      connectDistance: 118,
      baseSpeed: 0.62,
      mouseRepelRadius: 190,
    };
  }
  return { ...BASE_PARTICLE_CONFIG };
}

function readResolvedColorToken(element: HTMLElement, tokenName: string): string | null {
  const value = window.getComputedStyle(element).getPropertyValue(tokenName).trim();
  if (!value || value === 'initial') {
    return null;
  }
  return value;
}

export function DesktopParticleBackgroundLight(
  { isLogoHovered = false, profile = 'desktop' }: { isLogoHovered?: boolean; profile?: ParticleBackgroundProfile },
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isHoveredRef = useRef(isLogoHovered);

  useEffect(() => {
    isHoveredRef.current = isLogoHovered;
  }, [isLogoHovered]);

  useEffect(() => {
    if (!containerRef.current) return;
    if (!allowsParticleMotion({
      matchMedia: window.matchMedia?.bind(window),
      navigator: window.navigator,
    })) {
      return;
    }

    const container = containerRef.current;
    const particleColor = readResolvedColorToken(container, '--nimi-action-primary-bg');
    const lineColor = readResolvedColorToken(container, '--nimi-text-inverse');
    if (!particleColor || !lineColor) {
      return;
    }

    let pointerX = 0;
    let pointerY = 0;
    let hasPointer = false;
    let pointerPending = false;

    const createParticleScene = (initialWidth: number, initialHeight: number, initialPixelRatio: number) => {
      let width = initialWidth;
      let height = initialHeight;
      let pixelRatio = initialPixelRatio;
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(50, width / height, 1, 1000);
      camera.position.z = 500;

      const renderer = (() => {
        try {
          return new THREE.WebGLRenderer({
            alpha: true,
            antialias: true,
            powerPreference: 'low-power',
          });
        } catch {
          return null;
        }
      })();
      if (!renderer) {
        return null;
      }
      renderer.setPixelRatio(pixelRatio);
      renderer.setSize(width, height);
      renderer.setClearColor(0x000000, 0);
      container.appendChild(renderer.domElement);

      const tuning = resolveParticleConfig(profile);
      const CONFIG = {
        ...tuning,
        particleColor: new THREE.Color(particleColor),
        lineColor: new THREE.Color(lineColor),
      };

      const noise3D = createNoise3D();
      const connectDistanceSq = CONFIG.connectDistance * CONFIG.connectDistance;
      const spatialBuckets = new Map<number, number[]>();
      const cellCoords = new Int32Array(CONFIG.particleCount * 2);
      const bucketPool: number[][] = [];
      let bucketPoolIndex = 0;
      function acquireBucket(): number[] {
        if (bucketPoolIndex < bucketPool.length) {
          const b = bucketPool[bucketPoolIndex++]!;
          b.length = 0;
          return b;
        }
        const b: number[] = [];
        bucketPool.push(b);
        bucketPoolIndex++;
        return b;
      }
      function computeCurl(x: number, y: number, z: number, result: { x: number; y: number }) {
        const eps = 0.1;
        result.x = (noise3D(x, y + eps, z) - noise3D(x, y - eps, z)) / (2 * eps);
        result.y = -(noise3D(x + eps, y, z) - noise3D(x - eps, y, z)) / (2 * eps);
      }
      const curl = { x: 0, y: 0 };

      const particleGeometry = new THREE.BufferGeometry();
      const particlePositions = new Float32Array(CONFIG.particleCount * 3);
      const particleSizes = new Float32Array(CONFIG.particleCount);
      const flockingForces = new Float32Array(CONFIG.particleCount * 2);

      const visibleHeight = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
      const visibleWidth = visibleHeight * camera.aspect;

      for (let i = 0; i < CONFIG.particleCount; i++) {
        const x = (Math.random() - 0.5) * visibleWidth * 1.5;
        const y = (Math.random() - 0.5) * visibleHeight * 1.5;
        const z = (Math.random() - 0.5) * 100;
        particlePositions[i * 3] = x;
        particlePositions[i * 3 + 1] = y;
        particlePositions[i * 3 + 2] = z;
        particleSizes[i] = Math.random() < 0.3 ? 7.0 : 4.0;
      }

      particleGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(particlePositions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      particleGeometry.setAttribute('size', new THREE.BufferAttribute(particleSizes, 1));

      const particleMaterial = new THREE.ShaderMaterial({
        uniforms: { color: { value: CONFIG.particleColor } },
        vertexShader: `
              attribute float size;
              void main() {
                  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                  gl_PointSize = size * (300.0 / -mvPosition.z);
                  gl_Position = projectionMatrix * mvPosition;
              }
          `,
        fragmentShader: `
              uniform vec3 color;
              void main() {
                  float r = distance(gl_PointCoord, vec2(0.5));
                  if (r > 0.5) discard;
                  gl_FragColor = vec4(color, 0.8);
              }
          `,
        transparent: true,
        depthWrite: false,
      });

      const particles = new THREE.Points(particleGeometry, particleMaterial);
      scene.add(particles);

      const MAX_LINES = CONFIG.particleCount * 6;
      const lineGeometry = new THREE.BufferGeometry();
      const linePositions = new Float32Array(MAX_LINES * 6);
      const lineOpacities = new Float32Array(MAX_LINES * 2);
      const lineParticleIndices = new Int32Array(MAX_LINES * 2);

      lineGeometry.setAttribute(
        'position',
        new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage),
      );
      lineGeometry.setAttribute(
        'opacity',
        new THREE.BufferAttribute(lineOpacities, 1).setUsage(THREE.DynamicDrawUsage),
      );

      const lineMaterial = new THREE.ShaderMaterial({
        uniforms: {
          color: { value: CONFIG.lineColor },
          uMouse: { value: new THREE.Vector3(9999, 9999, 0) },
          uRadius: { value: CONFIG.mouseRepelRadius * 1.8 },
        },
        vertexShader: `
              uniform vec3 uMouse;
              uniform float uRadius;
              attribute float opacity;
              varying float vOpacity;
              void main() {
                  float dist = distance(position, uMouse);
                  float baseOpacity = opacity * 0.15;
                  float boost = smoothstep(uRadius, 0.0, dist);
                  vOpacity = baseOpacity + (opacity * boost * 0.4);
                  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              }
          `,
        fragmentShader: `
              uniform vec3 color;
              varying float vOpacity;
              void main() {
                  gl_FragColor = vec4(color, min(vOpacity, 0.3));
              }
          `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });

      const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
      scene.add(lines);

      const mouse = new THREE.Vector2(9999, 9999);
      const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
      const raycaster = new THREE.Raycaster();
      const mouse3D = new THREE.Vector3();

      let elapsed = 0;

      const render = (delta: number) => {
        if (pointerPending) {
          pointerPending = false;
          const rect = container.getBoundingClientRect();
          mouse.x = ((pointerX - rect.left) / width) * 2 - 1;
          mouse.y = -((pointerY - rect.top) / height) * 2 + 1;
          raycaster.setFromCamera(mouse, camera);
          raycaster.ray.intersectPlane(plane, mouse3D);
        }
        elapsed += delta;
        const time = elapsed * CONFIG.timeScale;

        lineMaterial.uniforms['uMouse']?.value.copy(mouse3D);

        const positions = particles.geometry.attributes['position']!.array as Float32Array;
        flockingForces.fill(0);

        let lineIndex = 0;
        const linePosArray = lineGeometry.attributes['position']!.array as Float32Array;
        const lineOpArray = lineGeometry.attributes['opacity']!.array as Float32Array;
        const registerPair = (i: number, j: number) => {
          const i3 = i * 3;
          const j3 = j * 3;
          const dx = positions[i3]! - positions[j3]!;
          const dy = positions[i3 + 1]! - positions[j3 + 1]!;
          const dz = positions[i3 + 2]! - positions[j3 + 2]!;
          const distSq = dx * dx + dy * dy + dz * dz;

          if (distSq >= connectDistanceSq) {
            return;
          }

          const dist = Math.sqrt(distSq);
          if (lineIndex < MAX_LINES) {
            const alpha = 1.0 - dist / CONFIG.connectDistance;
            const l2 = lineIndex * 2;
            lineParticleIndices[l2] = i;
            lineParticleIndices[l2 + 1] = j;
            lineOpArray[l2] = alpha * 0.25;
            lineOpArray[l2 + 1] = alpha * 0.25;
            lineIndex++;
          }

          if (dist <= 0.1) {
            return;
          }

          const forceCohesion = (dist / CONFIG.connectDistance) * CONFIG.cohesionForce;
          const fx = (dx / dist) * forceCohesion;
          const fy = (dy / dist) * forceCohesion;
          flockingForces[i * 2]! -= fx;
          flockingForces[i * 2 + 1]! -= fy;
          flockingForces[j * 2]! += fx;
          flockingForces[j * 2 + 1]! += fy;

          if (dist >= CONFIG.separationDistance) {
            return;
          }

          const forceSep = (1.0 - dist / CONFIG.separationDistance) * CONFIG.separationForce;
          const sx = (dx / dist) * forceSep;
          const sy = (dy / dist) * forceSep;
          flockingForces[i * 2]! += sx;
          flockingForces[i * 2 + 1]! += sy;
          flockingForces[j * 2]! -= sx;
          flockingForces[j * 2 + 1]! -= sy;
        };

        // Bucket particles into local cells so each frame only compares nearby neighbors.
        spatialBuckets.clear();
        bucketPoolIndex = 0;
        for (let i = 0; i < CONFIG.particleCount; i++) {
          const i3 = i * 3;
          const cx = Math.floor(positions[i3]! / CONFIG.connectDistance);
          const cy = Math.floor(positions[i3 + 1]! / CONFIG.connectDistance);
          cellCoords[i * 2] = cx;
          cellCoords[i * 2 + 1] = cy;
          const key = particleCellKey(cx, cy);
          const bucket = spatialBuckets.get(key);
          if (bucket) {
            bucket.push(i);
          } else {
            const b = acquireBucket();
            b.push(i);
            spatialBuckets.set(key, b);
          }
        }

        visitParticleNeighbors(spatialBuckets, cellCoords, CONFIG.particleCount, registerPair);

        lineGeometry.setDrawRange(0, lineIndex * 2);
        lineGeometry.attributes['opacity']!.needsUpdate = true;

        const visibleHeightLocal = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
        const visibleWidthLocal = visibleHeightLocal * camera.aspect;
        const boundX = visibleWidthLocal / 2 + 50;
        const boundY = visibleHeightLocal / 2 + 50;

        const isHovered = isHoveredRef.current;
        const currentNoiseScale = isHovered ? CONFIG.hoverNoiseScale : CONFIG.noiseScale;

        for (let i = 0; i < CONFIG.particleCount; i++) {
          const i3 = i * 3;
          let px = positions[i3]!;
          let py = positions[i3 + 1]!;

          computeCurl(px * currentNoiseScale, py * currentNoiseScale, time, curl);
          const vx = curl.x * 50 * CONFIG.baseSpeed;
          const vy = curl.y * 50 * CONFIG.baseSpeed;

          const fx = flockingForces[i * 2]!;
          const fy = flockingForces[i * 2 + 1]!;

          let mx = 0;
          let my = 0;

          if (isHovered) {
            const dcx = -px;
            const dcy = -py;
            const distCenter = Math.sqrt(dcx * dcx + dcy * dcy);
            const safeDistCenter = Math.max(distCenter, 0.001);

            if (distCenter > CONFIG.centerStopRadius) {
              const strength = (distCenter - CONFIG.centerStopRadius) * 0.05 * CONFIG.centerAttractForce;
              mx = (dcx / safeDistCenter) * strength * 100;
              my = (dcy / safeDistCenter) * strength * 100;
            } else if (distCenter > 5) {
              mx = (dcy / safeDistCenter) * CONFIG.centerVortexForce * 50;
              my = (-dcx / safeDistCenter) * CONFIG.centerVortexForce * 50;
              const pushStrength = (1.0 - distCenter / CONFIG.centerStopRadius) * 20;
              mx -= (dcx / safeDistCenter) * pushStrength;
              my -= (dcy / safeDistCenter) * pushStrength;
            }

            const wave = Math.sin(time * 2 + i) * 5;
            mx += (dcy / safeDistCenter) * wave;
            my += (-dcx / safeDistCenter) * wave;
          } else {
            const dx = px - mouse3D.x;
            const dy = py - mouse3D.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < CONFIG.mouseRepelRadius * CONFIG.mouseRepelRadius) {
              const dist = Math.sqrt(distSq);
              const force = (1 - dist / CONFIG.mouseRepelRadius) * CONFIG.mouseRepelForce * 100;
              const angle = Math.atan2(dy, dx);
              mx = Math.cos(angle) * force;
              my = Math.sin(angle) * force;
            }
          }

          px += (vx + fx + mx) * delta;
          py += (vy + fy + my) * delta;

          if (px > boundX) px -= boundX * 2;
          else if (px < -boundX) px += boundX * 2;
          else if (py > boundY) py -= boundY * 2;
          else if (py < -boundY) py += boundY * 2;

          positions[i3] = px;
          positions[i3 + 1] = py;
        }

        // Edges and dots use the same integrated positions so endpoints cannot lag by one update.
        for (let line = 0; line < lineIndex; line++) {
          const from = lineParticleIndices[line * 2]! * 3;
          const to = lineParticleIndices[line * 2 + 1]! * 3;
          const offset = line * 6;
          linePosArray[offset] = positions[from]!;
          linePosArray[offset + 1] = positions[from + 1]!;
          linePosArray[offset + 2] = positions[from + 2]!;
          linePosArray[offset + 3] = positions[to]!;
          linePosArray[offset + 4] = positions[to + 1]!;
          linePosArray[offset + 5] = positions[to + 2]!;
        }
        lineGeometry.attributes['position']!.needsUpdate = true;
        particles.geometry.attributes['position']!.needsUpdate = true;
        renderer.render(scene, camera);
      };

      return {
        render,
        resize(nextWidth: number, nextHeight: number, nextPixelRatio: number) {
          const sizeChanged = width !== nextWidth || height !== nextHeight;
          const pixelRatioChanged = pixelRatio !== nextPixelRatio;
          if (!sizeChanged && !pixelRatioChanged) return;
          width = nextWidth;
          height = nextHeight;
          pixelRatio = nextPixelRatio;
          if (sizeChanged) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
          }
          if (pixelRatioChanged) renderer.setPixelRatio(pixelRatio);
          if (sizeChanged) renderer.setSize(width, height);
          pointerPending = hasPointer;
        },
        dispose() {
          container.removeChild(renderer.domElement);
          renderer.dispose();
          scene.clear();
          particleGeometry.dispose();
          lineGeometry.dispose();
          particleMaterial.dispose();
          lineMaterial.dispose();
        },
      };
    };

    let particleScene: ReturnType<typeof createParticleScene> | undefined;
    let frameId: number | null = null;
    let previousFrame = performance.now();
    let sizePending = true;
    let disposed = false;
    const isPaused = () => document.hidden;

    const animate = (now: number) => {
      frameId = null;
      if (disposed || isPaused()) return;
      if (sizePending) {
        sizePending = false;
        const width = container.clientWidth;
        const height = container.clientHeight;
        // A zero-size mount waits for the observer instead of creating an invalid camera/context.
        if (width <= 0 || height <= 0) return;
        const pixelRatio = Math.min(window.devicePixelRatio, 2);
        if (particleScene === undefined) {
          particleScene = createParticleScene(width, height, pixelRatio);
        } else {
          particleScene?.resize(width, height, pixelRatio);
        }
      }
      if (!particleScene) return;
      const delta = Math.min((now - previousFrame) / 1000, 0.1);
      previousFrame = now;
      particleScene.render(delta);
      frameId = requestAnimationFrame(animate);
    };

    const syncAnimation = () => {
      if (disposed || particleScene === null) return;
      if (isPaused()) {
        if (frameId !== null) cancelAnimationFrame(frameId);
        frameId = null;
      } else if (frameId === null) {
        sizePending = true;
        pointerPending = hasPointer;
        previousFrame = performance.now();
        frameId = requestAnimationFrame(animate);
      }
    };
    document.addEventListener('visibilitychange', syncAnimation);

    const onResize = () => {
      sizePending = true;
      pointerPending = hasPointer;
      syncAnimation();
    };
    window.addEventListener('resize', onResize);
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(container);
    const onMouseMove = (event: MouseEvent) => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      hasPointer = true;
      pointerPending = true;
    };
    window.addEventListener('mousemove', onMouseMove);
    syncAnimation();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('visibilitychange', syncAnimation);
      if (frameId !== null) cancelAnimationFrame(frameId);
      particleScene?.dispose();
    };
  }, [profile]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 pointer-events-none"
      style={{ opacity: 0.8 }}
    />
  );
}
