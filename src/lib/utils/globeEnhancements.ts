/**
 * Globe visual enhancements: cloud layer and specular ocean highlights
 * rendered as a MapLibre custom layer sharing the same WebGL context.
 *
 * Coordinate-system notes (MapLibre 5.x globe mode)
 * ─────────────────────────────────────────────────────────────────────
 * In globe mode `CustomRenderMethodInput.modelViewProjectionMatrix` is the
 * full globe MVP matrix built by MapLibre's VerticalPerspectiveTransform:
 *
 *   globeMatrix = perspective
 *               × translate(0, 0, −ccd)        ← camera back
 *               × rotateZ/X/Z(bearing/pitch/roll)
 *               × translate(0, 0, −R_px)        ← move to globe centre
 *               × rotateX(lat_c) × rotateY(−lng_c)   ← orient so map centre faces camera
 *               × scale(R_px)                   ← unit sphere → globe size
 *
 * Input space: the unit sphere at the globe centre, in MapLibre's ECEF:
 *   (+x) → 90 °E, equator
 *   (+y) → north pole
 *   (+z) → prime meridian, equator
 *
 * No Mercator model matrix is needed — a unit sphere (radius 1) is already
 * the globe; cloud sphere is radius 1.004.
 *
 * Texture alignment
 * ─────────────────────────────────────────────────────────────────────
 * Three.js SphereGeometry (default): phi=0 (u=0) → +z (prime meridian);
 * increasing phi increases u westward.  Equirectangular: u=0 → −180°
 * (date line); increasing u → eastward.  Two corrections:
 *   1. Flip UV u-coordinates: u → 1−u  (reverses east/west direction)
 *   2. mesh.rotation.y = π              (shifts seam by 180°: u=0 → date line)
 * Combined: u=0 → −180°, u increases eastward. ✓
 *
 * Sun direction in MapLibre ECEF from getSunPosition(azimuthDeg, polarDeg):
 *   sun = (sin(po)·sin(az),  −sin(po)·cos(az),  −cos(po))
 */

import * as THREE from 'three';
import type { CustomRenderMethodInput } from 'maplibre-gl';
import type maplibregl from 'maplibre-gl';

/** Zoom level below which enhancements are fully opaque. */
const FADE_IN_ZOOM = 1.0;
/** Zoom level above which enhancements are fully transparent. */
const FADE_OUT_ZOOM = 6.5;

/** Maximum opacity of the cloud layer (additive blend, so 1.0 = very bright). */
const MAX_CLOUD_OPACITY = 0.52;
/** Radius scale factor that floats the cloud sphere above the base globe surface. */
const CLOUD_ALTITUDE_SCALE = 1.004;
/** Blue-white tint applied to the cloud texture colour channel. */
const CLOUD_TINT_COLOR = new THREE.Color(0.88, 0.93, 1.0);

/** Strength of the bump-map normal perturbation in the specular shader. */
const DEFAULT_BUMP_SCALE = 0.007;
/** Phong shininess exponent for ocean specular highlights. */
const SPECULAR_SHININESS = 40.0;
/** Width of the terminator soft-transition band (in dot-product units). */
const TERMINATOR_SOFTNESS = 0.12;
/** Warm sunlight tint applied to specular highlights. */
const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.88);

// ─── Specular shader ──────────────────────────────────────────────────────────

const specularVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec2 vUv;
  void main() {
    // normalMatrix transforms local normals into view/ECEF space so that
    // the sun-direction dot product is computed in a consistent space.
    vNormal     = normalize(normalMatrix * normal);
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const specularFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSpecularMap;
  uniform sampler2D uBumpMap;
  uniform vec3      uSunDir;
  uniform vec3      uSunColor;
  uniform float     uOpacity;
  uniform float     uBumpScale;
  uniform vec2      uTexelSize;
  uniform float     uShininess;
  uniform float     uTerminatorSoftness;

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
    float spec      = pow(max(dot(viewDir, reflectDir), 0.0), uShininess);

    // Suppress specular on the night side with a soft transition
    float nDotL     = dot(bN, uSunDir);
    spec           *= smoothstep(0.0, uTerminatorSoftness, nDotL);

    float intensity = specStr * spec * uOpacity;
    gl_FragColor    = vec4(uSunColor, intensity);
  }
`;

// ─── GlobeEnhancementsLayer ───────────────────────────────────────────────────

/**
 * Flip the u-component of every UV coordinate in a geometry so that
 * u → 1−u.  This reverses the east/west direction of the sphere mapping,
 * making Three.js SphereGeometry compatible with equirectangular textures
 * when combined with a 180° rotation around the y-axis.
 */
function flipUVs(geom: THREE.SphereGeometry): void {
  const uvAttr = geom.attributes.uv;
  for (let i = 0; i < uvAttr.count; i++) {
    uvAttr.setX(i, 1.0 - uvAttr.getX(i));
  }
  uvAttr.needsUpdate = true;
}

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

  onAdd(map: maplibregl.Map, gl: WebGLRenderingContext | WebGL2RenderingContext): void {
    this.map = map;
    this.aborted = false;
    this.loaded = false;

    // Share MapLibre's canvas & WebGL context — no extra canvas needed.
    // Three.js types only declare WebGLRenderingContext for the context option but
    // it accepts WebGL2 at runtime.  Cast via unknown to satisfy the declaration.
    this.renderer = new THREE.WebGLRenderer({
      canvas: map.getCanvas(),
      context: gl as unknown as WebGLRenderingContext,
      antialias: true
    });
    this.renderer.autoClear = false;

    this.camera = new THREE.Camera();
    // Prevent Three.js from overwriting the camera matrix from position/rotation.
    this.camera.matrixAutoUpdate = false;

    this.scene = new THREE.Scene();

    // ── Cloud sphere ──────────────────────────────────────────────────────────
    const cloudGeom = new THREE.SphereGeometry(1, 64, 32);
    // Flip UV u-coordinates (u → 1−u) so equirectangular textures map west→east.
    // Combined with the 180° y-rotation below this aligns u=0 with −180° (date line).
    flipUVs(cloudGeom);
    const cloudMat = new THREE.MeshBasicMaterial({
      color: CLOUD_TINT_COLOR,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
    // CLOUD_ALTITUDE_SCALE makes the cloud sphere 0.4% larger than the base globe.
    this.cloudMesh.scale.setScalar(CLOUD_ALTITUDE_SCALE);
    // Rotate 180° around y so phi=0 (Three.js u=0) aligns with the date line
    // instead of the prime meridian.  Together with the UV flip this gives a
    // pixel-accurate equirectangular mapping.
    this.cloudMesh.rotation.y = Math.PI;

    // ── Specular + bump sphere ────────────────────────────────────────────────
    const specGeom = new THREE.SphereGeometry(1, 64, 32);
    flipUVs(specGeom);
    const specMat = new THREE.ShaderMaterial({
      uniforms: {
        uSpecularMap: { value: null },
        uBumpMap: { value: null },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uSunColor: { value: SUN_COLOR },
        uOpacity: { value: 0 },
        uBumpScale: { value: DEFAULT_BUMP_SCALE },
        // Texel size matches the 10 240 × 5 120 bump map resolution
        uTexelSize: { value: new THREE.Vector2(1 / 10240, 1 / 5120) },
        uShininess: { value: SPECULAR_SHININESS },
        uTerminatorSoftness: { value: TERMINATOR_SOFTNESS }
      },
      vertexShader: specularVertexShader,
      fragmentShader: specularFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.specMesh = new THREE.Mesh(specGeom, specMat);
    this.specMesh.rotation.y = Math.PI;

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

  render(_gl: WebGLRenderingContext | WebGL2RenderingContext, options: CustomRenderMethodInput): void {
    if (!this.loaded || !this.renderer || !this.scene || !this.camera || !this.map) return;

    const zoom = this.map.getZoom();
    // Opacity ramps from 0→1 between FADE_IN_ZOOM and FADE_OUT_ZOOM.
    const t = Math.max(0, Math.min(1, (FADE_OUT_ZOOM - zoom) / (FADE_OUT_ZOOM - FADE_IN_ZOOM)));
    if (t <= 0) return;

    // ── Camera setup ──────────────────────────────────────────────────────────
    // In MapLibre 5.x the second argument is a CustomRenderMethodInput object.
    // modelViewProjectionMatrix is MapLibre's full globe MVP: it already includes
    // scale(globeRadiusPixels), sphere orientation and camera perspective.
    // Input space: unit sphere (radius 1 = globe surface, radius 1.004 = clouds).
    this.camera.projectionMatrix.fromArray(options.modelViewProjectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // ── Sun direction in MapLibre ECEF ────────────────────────────────────────
    // Derived by inverting getSunPosition(azimuthDeg, polarDeg) in Globe.svelte:
    //   sun_ECEF.x = sin(po)·sin(az)   [toward 90°E]
    //   sun_ECEF.y = −sin(po)·cos(az)  [toward north pole]
    //   sun_ECEF.z = −cos(po)          [toward prime meridian]
    const az = (this.sunAzimuthDeg * Math.PI) / 180;
    const po = (this.sunPolarDeg * Math.PI) / 180;
    this._sunDir.set(
      Math.sin(po) * Math.sin(az),
      -Math.sin(po) * Math.cos(az),
      -Math.cos(po)
    );

    // ── Update material uniforms / opacity ────────────────────────────────────
    if (this.cloudMesh) {
      this.cloudMesh.material.opacity = t * MAX_CLOUD_OPACITY;
    }
    if (this.specMesh) {
      const u = this.specMesh.material.uniforms;
      u.uSunDir.value.copy(this._sunDir);
      u.uOpacity.value = t;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    // resetState() tells Three.js that the WebGL state may have changed (MapLibre
    // rendered before us) without actually issuing any WebGL calls.
    this.renderer.resetState();
    this.renderer.render(this.scene, this.camera);
    // Ask MapLibre to schedule another frame so the effects remain visible
    // even when the map is not being actively panned or zoomed.
    this.map.triggerRepaint();
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
