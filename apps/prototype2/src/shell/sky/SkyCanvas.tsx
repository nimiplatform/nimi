import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import skyNightUrl from '../../assets/sky-night.png';
import { SKY_FRAG, SKY_VERT } from './skyShaders';

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

/** Fullscreen living-sky background. Renders on demand; rAF only while motion > 0. */
export function SkyCanvas({ dayTime, intensity, motion, onFallback }: SkyCanvasProps) {
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
    if (!canvas) return;

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
    let image: HTMLImageElement | null = null;

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
      // 1x1 placeholder until the photo loads
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([21, 12, 48, 255]));
      gl.uniform2f(uniformsRef.current.u_texRes, 1, 1);

      image = new Image();
      image.src = skyNightUrl;
      image.onload = () => {
        const g = glRef.current;
        if (!g || !texture || !image) return;
        g.bindTexture(g.TEXTURE_2D, texture);
        g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL, true);
        g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, image);
        g.uniform2f(uniformsRef.current.u_texRes, image.naturalWidth, image.naturalHeight);
        dirtyRef.current = true;
        requestDrawRef.current();
      };

      glRef.current = gl;
    } catch {
      releaseGlResources();
      glRef.current = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      onFallback();
      return;
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
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibilityChange);
    scheduleDraw();

    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      if (image) image.onload = null;
      requestDrawRef.current = () => undefined;
      glRef.current = null;
      releaseGlResources();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={canvasRef} className="sky-canvas" aria-hidden="true" />;
}
