/**
 * Full-screen WebGL2 composite for the Simulator's lunar field.
 *
 * The selected photographic plate remains the sole surface geometry/texture
 * authority. The shader applies bounded low-frequency modulation and renders
 * an independently textured Earth from the same celestial state.
 */

import { useEffect, useRef } from 'react';
import { usePrefersReducedMotion } from '@nimiplatform/kit/ui/motion';
import { SKY_FRAG, SKY_VERT } from './sky-shaders.ts';
import {
  deriveLunarSkyState,
  sceneTimeFromTimestamp,
} from './sky-math.ts';
import { useUi } from './ui-context.tsx';

const SCENE_SOURCE_ID = 'lunar-scene-clean.png';
const EARTH_SURFACE_SOURCE_ID = 'earth-asia-front-plate.png';
const EARTH_CLOUD_SOURCE_ID = 'earth-blue-marble-clouds.jpg';

const lunarSceneUrl = new URL(
  '../../assets/lunar-scene-clean.png',
  import.meta.url,
).href;
const earthSurfaceUrl = new URL(
  '../../assets/earth-asia-front-plate.png',
  import.meta.url,
).href;
const earthCloudUrl = new URL(
  '../../assets/earth-blue-marble-clouds.jpg',
  import.meta.url,
).href;

interface SkyCanvasProps {
  /** Authored synodic scene time; its cycle is normalized to [0,1). */
  sceneTime: number;
  /** When true, derive scene time continuously from the fixed UTC epoch. */
  autoTime: boolean;
  /** Visible light strength in the authored [0,2] range. */
  intensity: number;
  /** Playback gate: zero pauses; positive values run the authored cycle. */
  motion: number;
  /** Called when required GPU/resources are unavailable or lost. */
  onFallback: () => void;
}

const MAX_DEVICE_PIXEL_RATIO = 1.5;
const MAX_RENDER_PIXELS = 3_200_000;
const CONTINUOUS_FRAME_INTERVAL_MS = 1000 / 30;

function compile(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('failed to create shader');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`shader compile failed: ${log ?? 'unknown'}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  let vertexShader: WebGLShader | null = null;
  let fragmentShader: WebGLShader | null = null;
  const program = gl.createProgram();
  if (!program) throw new Error('failed to create program');
  try {
    vertexShader = compile(gl, gl.VERTEX_SHADER, vertexSource);
    fragmentShader = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(
        `program link failed: ${gl.getProgramInfoLog(program) ?? 'unknown'}`,
      );
    }
    return program;
  } catch (error) {
    gl.deleteProgram(program);
    throw error;
  } finally {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
  }
}

function uniformLocations(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  names: readonly string[],
): Record<string, WebGLUniformLocation | null> {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  );
}

export function SkyCanvas({
  sceneTime,
  autoTime,
  intensity,
  motion,
  onFallback,
}: SkyCanvasProps) {
  const { subscribeFamily } = useUi();
  const prefersReducedMotion = usePrefersReducedMotion();
  const effectiveMotion = prefersReducedMotion ? 0 : motion;
  const animateScene = autoTime && effectiveMotion > 0;

  const lastRenderedSceneTimeRef = useRef(sceneTime);
  const frozenAutoSceneTimeRef = useRef(sceneTime);
  const previousAnimateSceneRef = useRef(animateScene);
  const previousAutoTimeRef = useRef(autoTime);
  if (!autoTime) {
    frozenAutoSceneTimeRef.current = sceneTime;
  } else if (previousAnimateSceneRef.current && !animateScene) {
    frozenAutoSceneTimeRef.current = lastRenderedSceneTimeRef.current;
  } else if (!previousAutoTimeRef.current && !animateScene) {
    frozenAutoSceneTimeRef.current = sceneTime;
  }
  previousAnimateSceneRef.current = animateScene;
  previousAutoTimeRef.current = autoTime;

  const renderSceneTime = autoTime && !animateScene
    ? frozenAutoSceneTimeRef.current
    : sceneTime;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<WebGL2RenderingContext | null>(null);
  const dirtyRef = useRef(true);
  const requestDrawRef = useRef<() => void>(() => undefined);
  const paramsRef = useRef({
    sceneTime: renderSceneTime,
    autoTime,
    intensity,
    motion: effectiveMotion,
  });
  paramsRef.current = {
    sceneTime: renderSceneTime,
    autoTime,
    intensity,
    motion: effectiveMotion,
  };

  useEffect(() => {
    dirtyRef.current = true;
    requestDrawRef.current();
  }, [renderSceneTime, autoTime, intensity, effectiveMotion]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const ownerDocument = canvas.ownerDocument;
    const view = ownerDocument.defaultView ?? window;
    let gl: WebGL2RenderingContext | null = null;
    let program: WebGLProgram | null = null;
    let vertexArray: WebGLVertexArrayObject | null = null;
    let vertexBuffer: WebGLBuffer | null = null;
    let sceneTexture: WebGLTexture | null = null;
    let earthSurfaceTexture: WebGLTexture | null = null;
    let earthCloudTexture: WebGLTexture | null = null;
    let uniforms: Record<string, WebGLUniformLocation | null> = {};
    let sceneAspect = 1586 / 992;
    let sceneLoaded = false;
    let earthSurfaceLoaded = false;
    let earthCloudLoaded = false;
    let resourcesReady = false;
    let failed = false;
    let disposed = false;
    let raf = 0;
    let lastLoopMs: number | null = null;
    let frameAccumulatorMs = CONTINUOUS_FRAME_INTERVAL_MS;
    let hasPublishedReadyState = false;
    const assetImages: HTMLImageElement[] = [];

    canvas.dataset.skyRenderState = 'initializing';
    canvas.dataset.skyReady = 'false';
    canvas.dataset.skySceneReady = 'false';
    canvas.dataset.skyEarthReady = 'false';
    canvas.dataset.skyEarthSurfaceReady = 'false';
    canvas.dataset.skyEarthCloudReady = 'false';

    const releaseGlResources = () => {
      if (!gl) return;
      if (sceneTexture) gl.deleteTexture(sceneTexture);
      if (earthSurfaceTexture) gl.deleteTexture(earthSurfaceTexture);
      if (earthCloudTexture) gl.deleteTexture(earthCloudTexture);
      if (vertexBuffer) gl.deleteBuffer(vertexBuffer);
      if (vertexArray) gl.deleteVertexArray(vertexArray);
      if (program) gl.deleteProgram(program);
      sceneTexture = null;
      earthSurfaceTexture = null;
      earthCloudTexture = null;
      vertexBuffer = null;
      vertexArray = null;
      program = null;
    };

    const failToFallback = (renderState: 'fallback' | 'context-lost') => {
      if (failed || disposed) return;
      failed = true;
      if (raf) view.cancelAnimationFrame(raf);
      raf = 0;
      canvas.dataset.skyRenderState = renderState;
      canvas.dataset.skyReady = 'false';
      canvas.dataset.skySceneReady = 'false';
      canvas.dataset.skyEarthReady = 'false';
      canvas.dataset.skyEarthSurfaceReady = 'false';
      canvas.dataset.skyEarthCloudReady = 'false';
      onFallback();
    };

    const onContextLost = (event: Event) => {
      event.preventDefault();
      failToFallback('context-lost');
    };
    canvas.addEventListener('webglcontextlost', onContextLost);

    function scheduleDraw() {
      if (!failed && !disposed && !raf && !ownerDocument.hidden) {
        raf = view.requestAnimationFrame(loop);
      }
    }

    const updateResourceReadiness = () => {
      const earthReady = earthSurfaceLoaded && earthCloudLoaded;
      canvas.dataset.skySceneReady = sceneLoaded ? 'true' : 'false';
      canvas.dataset.skyEarthSurfaceReady =
        earthSurfaceLoaded ? 'true' : 'false';
      canvas.dataset.skyEarthCloudReady =
        earthCloudLoaded ? 'true' : 'false';
      canvas.dataset.skyEarthReady = earthReady ? 'true' : 'false';
      resourcesReady = sceneLoaded && earthReady;
      if (resourcesReady) {
        dirtyRef.current = true;
        scheduleDraw();
      }
    };

    try {
      gl = canvas.getContext('webgl2', {
        alpha: false,
        antialias: true,
      });
      if (!gl) throw new Error('webgl2 unavailable');

      const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
      const rendererName = debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : '';
      if (/swiftshader|llvmpipe|softpipe|software/iu.test(rendererName)) {
        throw new Error(`software webgl rasterizer: ${rendererName}`);
      }
      canvas.dataset.skyRenderer = 'lunar-hybrid-webgl';
      canvas.dataset.skyContext = 'webgl2';

      program = linkProgram(gl, SKY_VERT, SKY_FRAG);
      uniforms = uniformLocations(gl, program, [
        'u_sceneTex',
        'u_earthSurfaceTex',
        'u_earthCloudTex',
        'u_res',
        'u_sceneAspect',
        'u_sceneTime',
        'u_intensity',
        'u_earthshine',
        'u_sunDirection',
        'u_earthDirection',
        'u_cloudRotation',
      ]);

      vertexArray = gl.createVertexArray();
      vertexBuffer = gl.createBuffer();
      if (!vertexArray || !vertexBuffer) {
        throw new Error('failed to create fullscreen geometry');
      }
      gl.bindVertexArray(vertexArray);
      gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 3, -1, -1, 3]),
        gl.STATIC_DRAW,
      );
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

      sceneTexture = gl.createTexture();
      earthSurfaceTexture = gl.createTexture();
      earthCloudTexture = gl.createTexture();
      if (!sceneTexture || !earthSurfaceTexture || !earthCloudTexture) {
        throw new Error('failed to create lunar scene textures');
      }
      const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
      const configureTexture = (
        unit: number,
        texture: WebGLTexture,
        wrapS: number,
        internalFormat: number,
        placeholder: readonly [number, number, number, number],
      ) => {
        gl?.activeTexture((gl?.TEXTURE0 ?? 0) + unit);
        gl?.bindTexture(gl?.TEXTURE_2D ?? 0, texture);
        gl?.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_S,
          wrapS,
        );
        gl?.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_WRAP_T,
          gl.CLAMP_TO_EDGE,
        );
        gl?.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
        gl?.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MAG_FILTER,
          gl.LINEAR,
        );
        gl?.texImage2D(
          gl.TEXTURE_2D,
          0,
          internalFormat,
          1,
          1,
          0,
          gl.RGBA,
          gl.UNSIGNED_BYTE,
          new Uint8Array(placeholder),
        );
        gl?.generateMipmap(gl.TEXTURE_2D);
        if (anisotropy && gl) {
          const maximum = Number(gl.getParameter(
            anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT,
          ));
          gl.texParameterf(
            gl.TEXTURE_2D,
            anisotropy.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(8, maximum),
          );
        }
      };
      configureTexture(
        0,
        sceneTexture,
        gl.CLAMP_TO_EDGE,
        gl.SRGB8_ALPHA8,
        [18, 14, 28, 255],
      );
      configureTexture(
        1,
        earthSurfaceTexture,
        gl.REPEAT,
        gl.SRGB8_ALPHA8,
        [18, 34, 72, 255],
      );
      configureTexture(
        2,
        earthCloudTexture,
        gl.REPEAT,
        gl.RGBA8,
        [0, 0, 0, 255],
      );

      gl.useProgram(program);
      gl.uniform1i(uniforms.u_sceneTex, 0);
      gl.uniform1i(uniforms.u_earthSurfaceTex, 1);
      gl.uniform1i(uniforms.u_earthCloudTex, 2);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      glRef.current = gl;

      const ImageConstructor =
        canvas.ownerDocument.defaultView?.Image ?? Image;
      const loadAsset = (
        url: string,
        upload: (image: HTMLImageElement) => void,
      ) => {
        const image = new ImageConstructor();
        assetImages.push(image);
        image.decoding = 'async';
        image.onload = () => {
          if (disposed || failed || !glRef.current) return;
          try {
            upload(image);
            const uploadError = glRef.current.getError();
            if (uploadError !== glRef.current.NO_ERROR) {
              throw new Error(`texture upload failed: ${uploadError}`);
            }
            updateResourceReadiness();
          } catch {
            failToFallback('fallback');
          }
        };
        image.onerror = () => failToFallback('fallback');
        image.src = url;
      };

      loadAsset(lunarSceneUrl, (image) => {
        const context = glRef.current;
        if (!context || !sceneTexture) return;
        context.activeTexture(context.TEXTURE0);
        context.bindTexture(context.TEXTURE_2D, sceneTexture);
        context.pixelStorei(
          context.UNPACK_COLORSPACE_CONVERSION_WEBGL,
          context.BROWSER_DEFAULT_WEBGL,
        );
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.SRGB8_ALPHA8,
          context.RGBA,
          context.UNSIGNED_BYTE,
          image,
        );
        context.generateMipmap(context.TEXTURE_2D);
        sceneAspect = image.naturalWidth / Math.max(image.naturalHeight, 1);
        sceneLoaded = true;
      });

      loadAsset(earthSurfaceUrl, (image) => {
        const context = glRef.current;
        if (!context || !earthSurfaceTexture) return;
        context.activeTexture(context.TEXTURE1);
        context.bindTexture(context.TEXTURE_2D, earthSurfaceTexture);
        context.pixelStorei(
          context.UNPACK_COLORSPACE_CONVERSION_WEBGL,
          context.BROWSER_DEFAULT_WEBGL,
        );
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.SRGB8_ALPHA8,
          context.RGBA,
          context.UNSIGNED_BYTE,
          image,
        );
        context.generateMipmap(context.TEXTURE_2D);
        earthSurfaceLoaded = true;
      });

      loadAsset(earthCloudUrl, (image) => {
        const context = glRef.current;
        if (!context || !earthCloudTexture) return;
        context.activeTexture(context.TEXTURE2);
        context.bindTexture(context.TEXTURE_2D, earthCloudTexture);
        context.pixelStorei(
          context.UNPACK_COLORSPACE_CONVERSION_WEBGL,
          context.NONE,
        );
        context.pixelStorei(context.UNPACK_FLIP_Y_WEBGL, true);
        context.texImage2D(
          context.TEXTURE_2D,
          0,
          context.RGBA8,
          context.RGBA,
          context.UNSIGNED_BYTE,
          image,
        );
        context.generateMipmap(context.TEXTURE_2D);
        earthCloudLoaded = true;
      });
    } catch {
      releaseGlResources();
      glRef.current = null;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      failToFallback('fallback');
      return undefined;
    }

    const resize = () => {
      const context = glRef.current;
      const currentCanvas = canvasRef.current;
      if (!context || !currentCanvas || failed) return;
      const cssPixels = Math.max(
        1,
        currentCanvas.clientWidth * currentCanvas.clientHeight,
      );
      const pixelBudgetScale = Math.sqrt(MAX_RENDER_PIXELS / cssPixels);
      const dpr = Math.max(
        0.5,
        Math.min(
          view.devicePixelRatio || 1,
          MAX_DEVICE_PIXEL_RATIO,
          pixelBudgetScale,
        ),
      );
      const width = Math.max(
        1,
        Math.round(currentCanvas.clientWidth * dpr),
      );
      const height = Math.max(
        1,
        Math.round(currentCanvas.clientHeight * dpr),
      );
      if (
        currentCanvas.width !== width
        || currentCanvas.height !== height
      ) {
        currentCanvas.width = width;
        currentCanvas.height = height;
      }
      dirtyRef.current = true;
      scheduleDraw();
    };

    const draw = (continuous: boolean) => {
      const context = glRef.current;
      if (
        !context
        || !program
        || !vertexArray
        || !resourcesReady
        || failed
      ) {
        return;
      }
      const params = paramsRef.current;
      const liveSceneTime = params.autoTime && params.motion > 0
        ? sceneTimeFromTimestamp(Date.now())
        : params.sceneTime;
      lastRenderedSceneTimeRef.current = liveSceneTime;
      const skyState = deriveLunarSkyState(liveSceneTime);
      const [sunX, sunY, sunZ] = skyState.sunDirection;
      const [earthX, earthY, earthZ] = skyState.earthDirection;
      const width = context.canvas.width;
      const height = context.canvas.height;

      context.viewport(0, 0, width, height);
      context.useProgram(program);
      context.bindVertexArray(vertexArray);
      context.activeTexture(context.TEXTURE0);
      context.bindTexture(context.TEXTURE_2D, sceneTexture);
      context.activeTexture(context.TEXTURE1);
      context.bindTexture(context.TEXTURE_2D, earthSurfaceTexture);
      context.activeTexture(context.TEXTURE2);
      context.bindTexture(context.TEXTURE_2D, earthCloudTexture);
      context.uniform2f(uniforms.u_res, width, height);
      context.uniform1f(uniforms.u_sceneAspect, sceneAspect);
      context.uniform1f(uniforms.u_sceneTime, skyState.cycle);
      context.uniform1f(uniforms.u_intensity, params.intensity);
      context.uniform1f(uniforms.u_earthshine, skyState.earthshine);
      context.uniform3f(uniforms.u_sunDirection, sunX, sunY, sunZ);
      context.uniform3f(uniforms.u_earthDirection, earthX, earthY, earthZ);
      context.uniform1f(
        uniforms.u_cloudRotation,
        skyState.cloudRotation,
      );
      context.drawArrays(context.TRIANGLES, 0, 3);

      if (!hasPublishedReadyState) {
        const firstFrameError = context.getError();
        if (firstFrameError !== context.NO_ERROR) {
          failToFallback('fallback');
          return;
        }
      }

      if (!hasPublishedReadyState || !continuous) {
        canvas.dataset.skyFrameSceneTime = skyState.cycle.toFixed(6);
        canvas.dataset.skySunDirection = JSON.stringify(
          skyState.sunDirection.map((component) => (
            Number(component.toFixed(6))
          )),
        );
        canvas.dataset.skyEarthDirection = JSON.stringify(
          skyState.earthDirection.map((component) => (
            Number(component.toFixed(6))
          )),
        );
        canvas.dataset.skyEarthPhase = skyState.earthPhase.toFixed(6);
      }
      if (!hasPublishedReadyState) {
        hasPublishedReadyState = true;
        canvas.dataset.skyRenderState = 'ready';
        canvas.dataset.skyReady = 'true';
      }
    };

    function loop(nowMs: number) {
      raf = 0;
      if (ownerDocument.hidden || failed || disposed) return;
      const continuous =
        paramsRef.current.autoTime && paramsRef.current.motion > 0;
      if (continuous) {
        if (lastLoopMs === null) {
          lastLoopMs = nowMs;
        } else {
          const elapsed = Math.max(
            0,
            Math.min(
              nowMs - lastLoopMs,
              CONTINUOUS_FRAME_INTERVAL_MS * 4,
            ),
          );
          frameAccumulatorMs += elapsed;
          lastLoopMs = nowMs;
        }
        const frameDue =
          frameAccumulatorMs >= CONTINUOUS_FRAME_INTERVAL_MS;
        if (dirtyRef.current || frameDue) {
          dirtyRef.current = false;
          draw(true);
          frameAccumulatorMs = frameDue
            ? frameAccumulatorMs % CONTINUOUS_FRAME_INTERVAL_MS
            : 0;
        }
        scheduleDraw();
        return;
      }

      lastLoopMs = null;
      frameAccumulatorMs = CONTINUOUS_FRAME_INTERVAL_MS;
      if (dirtyRef.current) {
        dirtyRef.current = false;
        draw(false);
      }
    }

    const onVisibilityChange = () => {
      if (ownerDocument.hidden) {
        if (raf) view.cancelAnimationFrame(raf);
        raf = 0;
        lastLoopMs = null;
        frameAccumulatorMs = CONTINUOUS_FRAME_INTERVAL_MS;
        return;
      }
      dirtyRef.current = true;
      scheduleDraw();
    };

    requestDrawRef.current = scheduleDraw;
    resize();
    const unsubscribeResize = subscribeFamily('viewport', resize);
    const unsubscribeVisibility = subscribeFamily(
      'document_visibility',
      onVisibilityChange,
    );
    scheduleDraw();

    return () => {
      disposed = true;
      if (raf) view.cancelAnimationFrame(raf);
      unsubscribeResize?.();
      unsubscribeVisibility?.();
      canvas.removeEventListener('webglcontextlost', onContextLost);
      requestDrawRef.current = () => undefined;
      for (const image of assetImages) {
        image.onload = null;
        image.onerror = null;
      }
      glRef.current = null;
      releaseGlResources();
    };
    // The GPU lifecycle is owned by this canvas instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="sky-canvas"
      data-testid="lunar-sky-canvas"
      data-sun-visible="false"
      data-sky-scene-source={SCENE_SOURCE_ID}
      data-sky-earth-surface-source={EARTH_SURFACE_SOURCE_ID}
      data-sky-earth-cloud-source={EARTH_CLOUD_SOURCE_ID}
      aria-hidden="true"
    />
  );
}
