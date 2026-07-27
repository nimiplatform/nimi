/**
 * Fullscreen living-sky background (WebGL2). Renders on demand; rAF only
 * while motion > 0. Ported from prototype2 with two simulator adaptations:
 *
 *  - the night-terrain texture is generated procedurally on a 2D canvas at
 *    startup (CSP pins `img-src 'none'`; the photo asset is not ported);
 *  - window resize / document visibility events ride the shell's admitted
 *    global-listener coordinator families (`viewport`,
 *    `document_visibility`) instead of ad hoc window/document listeners.
 */

import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import { SKY_FRAG, SKY_VERT } from './sky-shaders.ts';
import { useUi } from './ui-context.tsx';

interface SkyCanvasProps {
  /** [0,1) local time of day. */
  dayTime: number;
  /** Light strength, ~[0,2]. */
  intensity: number;
  /** Animation amplitude, [0,1]; 0 renders only on parameter change. */
  motion: number;
  /** Called once when WebGL2 is unavailable — caller should fall back to CSS. */
  onFallback: () => void;
}

const HORIZON = 0.45;
const TEX_WIDTH = 1024;
const TEX_HEIGHT = 512;

/** Deterministic PRNG so the generated terrain is stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Synthesizes the night-scape the shader grades: a deep indigo sky with
 * stars above the horizon line and layered mountain ridges below it. Ridge
 * luminance variation feeds the shader's pseudo-relief key light.
 */
function createSkyTerrainTexture(doc: Document): HTMLCanvasElement | null {
  const canvas = doc.createElement('canvas');
  canvas.width = TEX_WIDTH;
  canvas.height = TEX_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const horizonY = Math.round(TEX_HEIGHT * (1 - HORIZON));
  const random = mulberry32(0x5eed);

  const sky = ctx.createLinearGradient(0, 0, 0, horizonY);
  sky.addColorStop(0, '#150c30');
  sky.addColorStop(0.72, '#241544');
  sky.addColorStop(1, '#38204e');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, TEX_WIDTH, horizonY + 1);

  for (let i = 0; i < 220; i += 1) {
    const x = random() * TEX_WIDTH;
    const y = random() * horizonY * 0.94;
    const r = 0.4 + random() * 1.1;
    const a = 0.25 + random() * 0.6;
    ctx.fillStyle = `rgba(255, 242, 246, ${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Mountain ridges, far (lighter) to near (darker).
  const ridges = [
    { base: 0.02, amp: 0.055, color: '#31204a' },
    { base: 0.06, amp: 0.075, color: '#241637' },
    { base: 0.11, amp: 0.1, color: '#180e27' },
  ];
  for (const ridge of ridges) {
    const baseY = horizonY + ridge.base * TEX_HEIGHT;
    ctx.fillStyle = ridge.color;
    ctx.beginPath();
    ctx.moveTo(0, TEX_HEIGHT);
    ctx.lineTo(0, baseY);
    let y = baseY;
    for (let x = 0; x <= TEX_WIDTH; x += 8) {
      y += (random() - 0.5) * ridge.amp * TEX_HEIGHT * 0.36;
      y = Math.max(horizonY - 24, Math.min(baseY + ridge.amp * TEX_HEIGHT, y));
      ctx.lineTo(x, y);
    }
    ctx.lineTo(TEX_WIDTH, TEX_HEIGHT);
    ctx.closePath();
    ctx.fill();
  }

  // Scattered luminance bumps on the near ridge for the key-light dFdx.
  for (let i = 0; i < 90; i += 1) {
    const x = random() * TEX_WIDTH;
    const y = horizonY + random() * (TEX_HEIGHT - horizonY) * 0.5;
    const a = 0.04 + random() * 0.08;
    ctx.fillStyle = `rgba(190, 180, 220, ${a.toFixed(3)})`;
    ctx.fillRect(x, y, 2 + random() * 5, 1 + random() * 2);
  }

  return canvas;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create shader');
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log ?? 'unknown'}`);
  }
  return shader;
}

export function SkyCanvas({ dayTime, intensity, motion, onFallback }: SkyCanvasProps) {
  const { subscribeFamily } = useUi();
  const prefersReducedMotion = usePrefersReducedMotion();
  const effectiveMotion = prefersReducedMotion ? 0 : motion;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const uniformsRef = useRef<Record<string, WebGLUniformLocation | null>>({});
  const dirtyRef = useRef(true);
  const requestDrawRef = useRef<() => void>(() => undefined);
  const paramsRef = useRef({ dayTime, intensity, motion: effectiveMotion });
  paramsRef.current = { dayTime, intensity, motion: effectiveMotion };

  // Mark for redraw whenever driving params change.
  useEffect(() => {
    dirtyRef.current = true;
    requestDrawRef.current();
  }, [dayTime, intensity, effectiveMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const onContextLost = (event: Event) => {
      event.preventDefault();
      onFallback();
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let vertexShader: WebGLShader | null = null;
    let fragmentShader: WebGLShader | null = null;
    let buffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;

    const releaseGlResources = () => {
      if (!gl) return;
      if (texture) gl.deleteTexture(texture);
      if (buffer) gl.deleteBuffer(buffer);
      if (program) gl.deleteProgram(program);
      if (vertexShader) gl.deleteShader(vertexShader);
      if (fragmentShader) gl.deleteShader(fragmentShader);
      texture = null;
      buffer = null;
      program = null;
      vertexShader = null;
      fragmentShader = null;
    };

    try {
      gl = canvas.getContext('webgl2', { antialias: false, alpha: false });
      if (!gl) throw new Error('webgl2 unavailable');

      // Software rasterizers (SwiftShader/llvmpipe in headless CI) emit GPU
      // stall warnings and render the shader sky slowly; the CSS phase sky is
      // the better surface there.
      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : '';
      if (/swiftshader|llvmpipe|softpipe|software/iu.test(rendererName)) {
        throw new Error(`software webgl rasterizer: ${rendererName}`);
      }

      program = gl.createProgram();
      if (!program) throw new Error('failed to create program');
      vertexShader = compile(gl, gl.VERTEX_SHADER, SKY_VERT);
      fragmentShader = compile(gl, gl.FRAGMENT_SHADER, SKY_FRAG);
      gl.attachShader(program, vertexShader);
      gl.attachShader(program, fragmentShader);
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        throw new Error(`program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`);
      }
      gl.useProgram(program);
      gl.deleteShader(vertexShader);
      gl.deleteShader(fragmentShader);
      vertexShader = null;
      fragmentShader = null;

      buffer = gl.createBuffer();
      if (!buffer) throw new Error('failed to create vertex buffer');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      for (const name of ['u_res', 'u_texRes', 'u_tex', 'u_time', 'u_dayTime', 'u_intensity', 'u_motion', 'u_horizon']) {
        uniformsRef.current[name] = gl.getUniformLocation(program, name);
      }
      gl.uniform1i(uniformsRef.current.u_tex, 0);
      gl.uniform1f(uniformsRef.current.u_horizon, HORIZON);

      texture = gl.createTexture();
      if (!texture) throw new Error('failed to create sky texture');
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      const terrain = createSkyTerrainTexture(canvas.ownerDocument);
      if (!terrain) throw new Error('failed to synthesize sky terrain');
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, terrain);
      gl.uniform2f(uniformsRef.current.u_texRes, terrain.width, terrain.height);

      glRef.current = gl;
    } catch {
      releaseGlResources();
      glRef.current = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      onFallback();
      return undefined;
    }

    let raf = 0;
    const scheduleDraw = () => {
      if (!raf && !document.hidden) raf = window.requestAnimationFrame(loop);
    };

    const resize = () => {
      const g = glRef.current;
      const c = canvasRef.current;
      if (!g || !c) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const w = Math.max(1, Math.round(c.clientWidth * dpr));
      const h = Math.max(1, Math.round(c.clientHeight * dpr));
      if (c.width !== w || c.height !== h) {
        c.width = w;
        c.height = h;
        g.viewport(0, 0, w, h);
      }
      dirtyRef.current = true;
      scheduleDraw();
    };

    const draw = (nowMs: number) => {
      const g = glRef.current;
      if (!g) return;
      const p = paramsRef.current;
      const u = uniformsRef.current;
      g.uniform2f(u.u_res, g.canvas.width, g.canvas.height);
      g.uniform1f(u.u_time, nowMs / 1000);
      g.uniform1f(u.u_dayTime, p.dayTime);
      g.uniform1f(u.u_intensity, p.intensity);
      g.uniform1f(u.u_motion, p.motion);
      g.drawArrays(g.TRIANGLES, 0, 3);
    };

    const loop = (nowMs: number) => {
      raf = 0;
      if (document.hidden) return;
      // motion > 0 animates continuously; otherwise only redraw on change
      if (dirtyRef.current || paramsRef.current.motion > 0) {
        dirtyRef.current = false;
        draw(nowMs);
      }
      if (paramsRef.current.motion > 0) scheduleDraw();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        if (raf) window.cancelAnimationFrame(raf);
        raf = 0;
        return;
      }
      dirtyRef.current = true;
      scheduleDraw();
    };

    requestDrawRef.current = scheduleDraw;
    resize();
    const unsubscribeResize = subscribeFamily('viewport', resize);
    const unsubscribeVisibility = subscribeFamily('document_visibility', onVisibilityChange);
    scheduleDraw();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      unsubscribeResize?.();
      unsubscribeVisibility?.();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      requestDrawRef.current = () => undefined;
      glRef.current = null;
      releaseGlResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="sky-canvas" aria-hidden="true" />;
}
