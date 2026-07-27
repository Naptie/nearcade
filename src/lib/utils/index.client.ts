export const IS_IOS = (() => {
  const iosQuirkPresent = () => {
    const audio = new Audio();
    audio.volume = 0.5;
    return audio.volume === 1; // volume cannot be changed from "1" on iOS 12 and below
  };

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAppleDevice = navigator.userAgent.includes('Macintosh');
  const isTouchScreen = navigator.maxTouchPoints >= 1; // true for iOS 13 (and hopefully beyond)

  return isIOS || (isAppleDevice && (isTouchScreen || iosQuirkPresent()));
})();

export const IS_ANDROID_OR_IOS =
  IS_IOS ||
  (() => {
    if (/windows phone/i.test(navigator.userAgent)) {
      return false;
    }
    if (/android/i.test(navigator.userAgent)) {
      return true;
    }
    return false;
  })();

export const IS_LOW_DATA =
  'connection' in navigator &&
  navigator.connection &&
  (navigator.connection as { saveData: boolean }).saveData === true;

const GLOBE_PERFORMANCE_CACHE_KEY = 'nearcade-globe-performance-v1';
const GLOBE_BENCHMARK_SIZE = 512;
const GLOBE_BENCHMARK_DRAWS = 4;
const GLOBE_MAX_BENCHMARK_MS = 34;

const createGlobeBenchmarkProgram = (gl: WebGL2RenderingContext): WebGLProgram | null => {
  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader;
    gl.deleteShader(shader);
    return null;
  };

  const vertex = compile(
    gl.VERTEX_SHADER,
    `#version 300 es
      in vec2 aPosition;
      void main() { gl_Position = vec4(aPosition, 0.0, 1.0); }`
  );
  const fragment = compile(
    gl.FRAGMENT_SHADER,
    `#version 300 es
      precision highp float;
      out vec4 outColor;
      void main() {
        vec2 p = gl_FragCoord.xy * 0.003;
        float value = 0.0;
        for (int i = 0; i < 48; i++) {
          p = mat2(0.80, -0.60, 0.60, 0.80) * p + vec2(0.02, 0.03);
          value += sin(p.x) * cos(p.y);
        }
        outColor = vec4(vec3(value * 0.02 + 0.5), 1.0);
      }`
  );
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex);
    if (fragment) gl.deleteShader(fragment);
    return null;
  }

  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) return program;
  gl.deleteProgram(program);
  return null;
};

/**
 * Determines whether the browser-selected high-performance WebGL adapter can
 * sustain a small GPU workload.
 *
 * The result is cached per tab. The actual MapLibre context also requests
 * `powerPreference: 'high-performance'`, so the probe and map ask the browser
 * for the same adapter policy.
 */
export const canRenderGlobeLanding = async (): Promise<boolean> => {
  try {
    const cached = sessionStorage.getItem(GLOBE_PERFORMANCE_CACHE_KEY);
    if (cached !== null) return cached === '1';
  } catch {
    // Storage can be disabled; run the short calibration without caching.
  }

  let passed: boolean;
  let gl: WebGL2RenderingContext | null = null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = GLOBE_BENCHMARK_SIZE;
    canvas.height = GLOBE_BENCHMARK_SIZE;
    gl = canvas.getContext('webgl2', {
      powerPreference: 'high-performance'
    });
    if (!gl || gl.getParameter(gl.MAX_TEXTURE_SIZE) < 4096) {
      passed = false;
    } else {
      const program = createGlobeBenchmarkProgram(gl);
      const buffer = gl.createBuffer();
      if (!program || !buffer) {
        passed = false;
      } else {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
        const position = gl.getAttribLocation(program, 'aPosition');
        gl.useProgram(program);
        gl.enableVertexAttribArray(position);
        gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

        // Warm shader compilation and driver setup before timing GPU throughput.
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.finish();

        const start = performance.now();
        for (let i = 0; i < GLOBE_BENCHMARK_DRAWS; i++) gl.drawArrays(gl.TRIANGLES, 0, 3);
        // readPixels forces completion of submitted work; without it the CPU
        // could measure command submission rather than rendering speed.
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
        passed = performance.now() - start <= GLOBE_MAX_BENCHMARK_MS;

        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
      }
    }
  } catch {
    passed = false;
  } finally {
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  }

  try {
    sessionStorage.setItem(GLOBE_PERFORMANCE_CACHE_KEY, passed ? '1' : '0');
  } catch {
    // Storage is optional for this optimization.
  }
  return passed;
};
