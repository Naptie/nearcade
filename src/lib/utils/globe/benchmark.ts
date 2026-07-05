import type maplibregl from 'maplibre-gl';

export type FpsSample = {
  fps: number;
  frameTimeMs: number;
  timestamp: number;
};

export type BenchmarkResult = {
  durationMs: number;
  frameCount: number;
  avgFps: number;
  minFps: number;
  p1LowFps: number;
  droppedFrames: number;
  stutters: number;
  samples: FpsSample[];
};

export type BenchmarkMovement = {
  center: [number, number];
  zoom: number;
  pitch?: number;
  bearing?: number;
  duration: number;
  /** Milliseconds to hold still after the movement eases, useful for tile settling. */
  holdMs?: number;
};

/** Default flight path that exercises globe, city zoom, and rotation. */
export const DEFAULT_BENCHMARK_MOVEMENTS: BenchmarkMovement[] = [
  { center: [80, 15], zoom: 3.2, pitch: 15, bearing: 10, duration: 2000, holdMs: 500 },
  { center: [116.4, 39.9], zoom: 8, pitch: 50, bearing: 30, duration: 3000, holdMs: 800 },
  { center: [-74, 40.7], zoom: 7, pitch: 55, bearing: -25, duration: 3000, holdMs: 800 },
  { center: [139.7, 35.7], zoom: 8, pitch: 50, bearing: 60, duration: 3000, holdMs: 800 },
  { center: [-0.1, 51.5], zoom: 7, pitch: 55, bearing: 15, duration: 3000, holdMs: 800 },
  { center: [80, 15], zoom: 3.2, pitch: 15, bearing: 10, duration: 2500, holdMs: 500 }
];

const DROP_FRAME_THRESHOLD_MS = 1000 / 60; // missed a 60 Hz frame
const STUTTER_THRESHOLD_MS = 1000 / 30; // missed a 30 Hz frame
const FPS_WINDOW_MS = 1000;

export class FpsMonitor {
  private rafId: number | null = null;
  private lastTimestamp: number = 0;
  private samples: FpsSample[] = [];
  private maxSamples: number;

  constructor(options: { maxSamples?: number } = {}) {
    this.maxSamples = options.maxSamples ?? 600;
  }

  start(): void {
    if (this.rafId !== null) return;
    this.lastTimestamp = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  clear(): void {
    this.samples = [];
  }

  snapshot(): FpsSample[] {
    return this.samples.slice();
  }

  getCurrentFps(): number {
    if (this.samples.length === 0) return 0;
    return this.samples[this.samples.length - 1].fps;
  }

  getAverageFps(windowMs = FPS_WINDOW_MS): number {
    const windowSamples = this.getRecentSamples(windowMs);
    if (windowSamples.length === 0) return 0;
    const totalTime = windowSamples.reduce((sum, s) => sum + s.frameTimeMs, 0);
    return totalTime > 0 ? (windowSamples.length * 1000) / totalTime : 0;
  }

  private getRecentSamples(windowMs: number): FpsSample[] {
    const now = performance.now();
    return this.samples.filter((s) => now - s.timestamp <= windowMs);
  }

  private tick = (timestamp: number) => {
    const frameTimeMs = timestamp - this.lastTimestamp;
    this.lastTimestamp = timestamp;
    const fps = frameTimeMs > 0 ? 1000 / frameTimeMs : 0;
    this.samples.push({ fps, frameTimeMs, timestamp });
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
    this.rafId = requestAnimationFrame(this.tick);
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function flyToAsync(map: maplibregl.Map, options: maplibregl.FlyToOptions): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => {
      map.off('moveend', finish);
      resolve();
    };
    map.once('moveend', finish);
    map.flyTo(options);
  });
}

export async function runGlobeBenchmark(
  map: maplibregl.Map,
  options: {
    fpsMonitor: FpsMonitor;
    movements?: BenchmarkMovement[];
    onProgress?: (progress: number) => void;
    onComplete?: (result: BenchmarkResult) => void;
    signal?: AbortSignal;
  }
): Promise<BenchmarkResult> {
  const movements = options.movements ?? DEFAULT_BENCHMARK_MOVEMENTS;
  const interactiveHandlers: Array<{
    name: string;
    disable: () => void;
    enable: () => void;
  }> = [];

  const handlerNames = [
    'dragPan',
    'dragRotate',
    'scrollZoom',
    'boxZoom',
    'keyboard',
    'doubleClickZoom',
    'touchZoomRotate'
  ] as const;

  for (const name of handlerNames) {
    const handler = (map as unknown as Record<string, { disable: () => void; enable: () => void }>)[
      name
    ];
    if (handler) {
      interactiveHandlers.push({
        name,
        disable: () => handler.disable(),
        enable: () => handler.enable()
      });
    }
  }

  interactiveHandlers.forEach((h) => h.disable());
  options.fpsMonitor.clear();
  const startTimestamp = performance.now();

  try {
    for (let i = 0; i < movements.length; i++) {
      if (options.signal?.aborted) break;

      const movement = movements[i];
      await flyToAsync(map, {
        center: movement.center,
        zoom: movement.zoom,
        pitch: movement.pitch ?? 0,
        bearing: movement.bearing ?? 0,
        duration: movement.duration,
        essential: true
      });

      if (movement.holdMs && movement.holdMs > 0) {
        await sleep(movement.holdMs);
      }

      options.onProgress?.((i + 1) / movements.length);
    }
  } finally {
    interactiveHandlers.forEach((h) => h.enable());
  }

  const endTimestamp = performance.now();
  const samples = options.fpsMonitor.snapshot();
  const result = computeBenchmarkResult(startTimestamp, endTimestamp, samples);
  options.onComplete?.(result);
  return result;
}

export function computeBenchmarkResult(
  startTimestamp: number,
  endTimestamp: number,
  samples: FpsSample[]
): BenchmarkResult {
  const relevant = samples.filter(
    (s) => s.timestamp >= startTimestamp && s.timestamp <= endTimestamp
  );
  const durationMs = endTimestamp - startTimestamp;
  const frameCount = relevant.length;

  if (frameCount === 0) {
    return {
      durationMs,
      frameCount: 0,
      avgFps: 0,
      minFps: 0,
      p1LowFps: 0,
      droppedFrames: 0,
      stutters: 0,
      samples: []
    };
  }

  const frameTimes = relevant.map((s) => s.frameTimeMs);
  const sortedFrameTimes = frameTimes.slice().sort((a, b) => b - a);
  const avgFrameTime = frameTimes.reduce((a, b) => a + b, 0) / frameCount;

  // Min FPS over 1-second sliding windows to ignore single-frame outliers.
  let minFps = Infinity;
  for (let i = 0; i < relevant.length; i++) {
    let windowTime = 0;
    let windowFrames = 0;
    for (let j = i; j < relevant.length; j++) {
      windowTime += relevant[j].frameTimeMs;
      windowFrames++;
      if (windowTime >= FPS_WINDOW_MS) break;
    }
    if (windowFrames > 0) {
      const windowFps = (windowFrames * 1000) / windowTime;
      if (windowFps < minFps) minFps = windowFps;
    }
  }
  if (!isFinite(minFps)) minFps = frameCount / (durationMs / 1000);

  // 1% low: average of the worst 1% frame times converted to FPS.
  const worstCount = Math.max(1, Math.ceil(frameCount * 0.01));
  const worstFrameTimeAvg =
    sortedFrameTimes.slice(0, worstCount).reduce((a, b) => a + b, 0) / worstCount;
  const p1LowFps = worstFrameTimeAvg > 0 ? 1000 / worstFrameTimeAvg : 0;

  const droppedFrames = frameTimes.filter((t) => t > DROP_FRAME_THRESHOLD_MS).length;
  const stutters = frameTimes.filter((t) => t > STUTTER_THRESHOLD_MS).length;

  return {
    durationMs,
    frameCount,
    avgFps: avgFrameTime > 0 ? 1000 / avgFrameTime : 0,
    minFps,
    p1LowFps,
    droppedFrames,
    stutters,
    samples: relevant
  };
}
