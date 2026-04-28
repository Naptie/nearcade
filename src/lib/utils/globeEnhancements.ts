/**
 * Globe visual enhancements: cloud layer and specular ocean highlights
 * rendered as a MapLibre custom layer sharing the same WebGL context.
 *
 * Coordinate-system notes
 * ─────────────────────────────────────────────────────────────────────
 * MapLibre world space (globe mode): x = east (+), y = south (+), z = altitude (+).
 * World coordinates are in units of `worldSize = 512 · 2^zoom`.
 *   · Globe centre  = (mc.x · ws,  mc.y · ws,  0)
 *   · Globe radius  = ws / (2π)
 *
 * Three.js SphereGeometry local space: y = north (+), x → lon 0°, z → lon 90°W.
 * Standard equirectangular textures (u=0 → lon −180°) align with the geometry
 * exactly — no extra rotation is needed.
 *
 * Model matrix M maps unit sphere → MapLibre world space:
 *   M = | R   0   0   cx |
 *       | 0  −R   0   cy |   ← y-flip: Three.js +y (north) → MapLibre −y (northward)
 *       | 0   0   R   0  |
 *       | 0   0   0   1  |
 *
 * Sun direction in Three.js sphere space from MapLibre's getSunPosition output
 * (azimuthDeg, polarDeg):
 *   sun = (−cos(polar), −sin(polar)·cos(az), −sin(polar)·sin(az))
 */

import * as THREE from 'three';
import type maplibregl from 'maplibre-gl';

/** Zoom level below which enhancements are fully opaque. */
const FADE_IN_ZOOM = 1.0;
/** Zoom level above which enhancements are fully transparent. */
const FADE_OUT_ZOOM = 6.5;

/** Standard Web Mercator x in [0, 1]. */
function mercatorX(lngDeg: number): number {
  return (lngDeg + 180) / 360;
}

/** Standard Web Mercator y in [0, 1] (0 = north). */
function mercatorY(latDeg: number): number {
  const φ = (latDeg * Math.PI) / 180;
  return (1 - Math.log(Math.tan(φ) + 1 / Math.cos(φ)) / Math.PI) / 2;
}

// ─── Specular shader ──────────────────────────────────────────────────────────

const specularVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    vNormal     = normalize(normal);
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const specularFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSpecularMap;
  uniform sampler2D uBumpMap;
  uniform vec3      uSunDir;
  uniform float     uOpacity;
  uniform float     uBumpScale;
  uniform vec2      uTexelSize;

  varying vec3 vNormal;
  varying vec2 vUv;

  void main() {
    // ── Tangent frame for bump perturbation ───────────────────────────────────
    vec3 N  = normalize(vNormal);
    // Cross with world-up to obtain a tangent along the longitude direction.
    // At the poles the cross product degenerates, so we fall back to (1,0,0).
    vec3 up = vec3(0.0, 1.0, 0.0);
    vec3 T  = normalize(cross(up, N));
    if (length(T) < 0.001) T = vec3(1.0, 0.0, 0.0);
    vec3 B  = normalize(cross(N, T));

    // Central-difference gradient of the bump (height) map
    float hR = texture2D(uBumpMap, vUv + vec2( uTexelSize.x,       0.0)).r;
    float hL = texture2D(uBumpMap, vUv - vec2( uTexelSize.x,       0.0)).r;
    float hU = texture2D(uBumpMap, vUv + vec2(       0.0,  uTexelSize.y)).r;
    float hD = texture2D(uBumpMap, vUv - vec2(       0.0,  uTexelSize.y)).r;
    float dx = (hR - hL) * uBumpScale;
    float dy = (hU - hD) * uBumpScale;
    vec3 bN  = normalize(N + dx * T + dy * B);

    // ── Phong specular ────────────────────────────────────────────────────────
    float specStr   = texture2D(uSpecularMap, vUv).r;

    // For a globe seen from outside, the outward normal is a good approximation
    // of the view direction towards the camera.
    vec3 viewDir    = N;
    vec3 reflectDir = reflect(-uSunDir, bN);
    float spec      = pow(max(dot(viewDir, reflectDir), 0.0), 40.0);

    // Suppress specular on the night side with a soft transition
    float nDotL     = dot(bN, uSunDir);
    spec           *= smoothstep(0.0, 0.12, nDotL);

    float intensity = specStr * spec * uOpacity;
    // Warm sunlight tint
    gl_FragColor    = vec4(1.0, 0.96, 0.88, intensity);
  }
`;

// ─── GlobeEnhancementsLayer ───────────────────────────────────────────────────

export class GlobeEnhancementsLayer {
  readonly id = 'globe-enhancements';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private cloudMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private specMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;

  private map: maplibregl.Map | null = null;
  private loaded = false;
  private aborted = false;

  // Re-used every frame to avoid GC pressure
  private readonly _M = new THREE.Matrix4();
  private readonly _fullMatrix = new THREE.Matrix4();
  private readonly _sunDir = new THREE.Vector3();

  private sunAzimuthDeg = 0;
  private sunPolarDeg = 90;

  constructor(
    private readonly cloudUrl: string,
    private readonly specularUrl: string,
    private readonly bumpUrl: string
  ) {}

  /** Update the sun direction to match MapLibre's light (azimuth/polar from getSunPosition). */
  setSun(azimuthDeg: number, polarDeg: number): void {
    this.sunAzimuthDeg = azimuthDeg;
    this.sunPolarDeg = polarDeg;
  }

  // ── CustomLayerInterface callbacks ─────────────────────────────────────────

  onAdd(map: maplibregl.Map, gl: WebGL2RenderingContext): void {
    this.map = map;
    this.aborted = false;
    this.loaded = false;

    // Share MapLibre's canvas & WebGL context — no extra canvas needed.
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl,
      antialias: true
    });
    this.renderer.autoClear = false;

    this.camera = new THREE.Camera();
    // Prevent Three.js from overwriting the camera matrix from position/rotation.
    this.camera.matrixAutoUpdate = false;

    this.scene = new THREE.Scene();

    // ── Cloud sphere (geometry shared, scale applied in model matrix) ─────────
    const cloudGeom = new THREE.SphereGeometry(1, 64, 32);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.88, 0.93, 1.0), // slight blue-white cloud tint
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
    // 0.4 % larger radius so the cloud layer floats above the globe surface
    // and the model matrix scaling takes care of the absolute size.
    this.cloudMesh.scale.setScalar(1.004);

    // ── Specular + bump sphere ────────────────────────────────────────────────
    const specGeom = new THREE.SphereGeometry(1, 64, 32);
    const specMat = new THREE.ShaderMaterial({
      uniforms: {
        uSpecularMap: { value: null },
        uBumpMap: { value: null },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uOpacity: { value: 0 },
        uBumpScale: { value: 0.007 },
        // Texel size matches the 10 240 × 5 120 bump map resolution
        uTexelSize: { value: new THREE.Vector2(1 / 10240, 1 / 5120) }
      },
      vertexShader: specularVertexShader,
      fragmentShader: specularFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.specMesh = new THREE.Mesh(specGeom, specMat);

    this.scene.add(this.cloudMesh);
    this.scene.add(this.specMesh);

    // ── Load textures asynchronously ─────────────────────────────────────────
    const loader = new THREE.TextureLoader();
    Promise.all([
      loader.loadAsync(this.cloudUrl),
      loader.loadAsync(this.specularUrl),
      loader.loadAsync(this.bumpUrl)
    ])
      .then(([cloudTex, specTex, bumpTex]) => {
        if (this.aborted) {
          // Style was reloaded while textures were in flight — discard them.
          cloudTex.dispose();
          specTex.dispose();
          bumpTex.dispose();
          return;
        }
        cloudTex.colorSpace = THREE.SRGBColorSpace;
        cloudMat.map = cloudTex;
        cloudMat.needsUpdate = true;

        specMat.uniforms.uSpecularMap.value = specTex;
        specMat.uniforms.uBumpMap.value = bumpTex;

        this.loaded = true;
      })
      .catch((err: unknown) => {
        console.warn('[GlobeEnhancements] texture load failed:', err);
      });
  }

  render(_gl: WebGL2RenderingContext, matrix: Float32Array): void {
    if (!this.loaded || !this.renderer || !this.scene || !this.camera || !this.map) return;

    const zoom = this.map.getZoom();
    // Opacity ramps from 0→1 between FADE_IN_ZOOM and FADE_OUT_ZOOM.
    const t = Math.max(0, Math.min(1, (FADE_OUT_ZOOM - zoom) / (FADE_OUT_ZOOM - FADE_IN_ZOOM)));
    if (t <= 0) return;

    // ── Globe geometry in MapLibre world space ────────────────────────────────
    const worldSize = 512 * Math.pow(2, zoom);
    const { lng, lat } = this.map.getCenter();
    const cx = mercatorX(lng) * worldSize;
    const cy = mercatorY(lat) * worldSize;
    const R = worldSize / (2 * Math.PI); // globe radius in world units

    // Model matrix: unit sphere at origin → globe in MapLibre world space.
    // The −R on the diagonal flips Three.js +y (north pole) so it maps to the
    // MapLibre −y direction (northward = smaller mercator-y value).
    this._M.set(R, 0, 0, cx, 0, -R, 0, cy, 0, 0, R, 0, 0, 0, 0, 1);

    // Combined: maplibreMatrix × M_globe
    this._fullMatrix.fromArray(matrix).multiply(this._M);

    // ── Sun direction in Three.js sphere space ────────────────────────────────
    // getSunPosition returns azimuth (compass bearing, 0=N) and polar (from zenith).
    // Conversion to Three.js sphere space (x→lon0°, y→north, z→lon90°W):
    //   sun = (−cos(polar), −sin(polar)·cos(az), −sin(polar)·sin(az))
    const az = (this.sunAzimuthDeg * Math.PI) / 180;
    const po = (this.sunPolarDeg * Math.PI) / 180;
    this._sunDir
      .set(-Math.cos(po), -Math.sin(po) * Math.cos(az), -Math.sin(po) * Math.sin(az))
      .normalize();

    // ── Update material uniforms / opacity ────────────────────────────────────
    if (this.cloudMesh) {
      this.cloudMesh.material.opacity = t * 0.52;
    }
    if (this.specMesh) {
      const u = this.specMesh.material.uniforms;
      u.uSunDir.value.copy(this._sunDir);
      u.uOpacity.value = t;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    this.camera.projectionMatrix.copy(this._fullMatrix);
    this.camera.projectionMatrixInverse.copy(this._fullMatrix).invert();

    // resetState() tells Three.js that the WebGL state may have changed (MapLibre
    // rendered before us) without actually issuing any WebGL calls.
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
  }

  onRemove(): void {
    this.aborted = true;
    this.loaded = false;

    if (this.cloudMesh) {
      this.cloudMesh.geometry.dispose();
      this.cloudMesh.material.map?.dispose();
      this.cloudMesh.material.dispose();
      this.cloudMesh = null;
    }
    if (this.specMesh) {
      this.specMesh.geometry.dispose();
      const u = this.specMesh.material.uniforms;
      (u.uSpecularMap.value as THREE.Texture | null)?.dispose();
      (u.uBumpMap.value as THREE.Texture | null)?.dispose();
      this.specMesh.material.dispose();
      this.specMesh = null;
    }

    // Do NOT call renderer.dispose() — it would destroy the shared WebGL context.
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.map = null;
  }
}
