/**
 * Globe visual enhancements: cloud layer, night lights, ocean highlights and
 * atmosphere glow
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
 * Three.js SphereGeometry (default): along the equator, u increases eastward,
 * but the seam starts at 90°W instead of the date line.  A −90° rotation
 * around the y-axis shifts the seam to −180° without mirroring longitude,
 * so standard equirectangular textures align with MapLibre's basemap.
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

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Maximum opacity of the cloud layer (additive blend, so 1.0 = very bright). */
const MAX_CLOUD_OPACITY = 0;
/** Radius scale factor that floats the cloud sphere above the base globe surface. */
const CLOUD_ALTITUDE_SCALE = 1.004;
/** Blue-white tint applied to the cloud texture colour channel. */
const CLOUD_TINT_COLOR = new THREE.Color(0.88, 0.93, 1.0);
/** Maximum opacity of the night-lights overlay. */
const MAX_NIGHT_LIGHTS_OPACITY = 0.78;
/** Radius scale factor for the night-lights shell so it sits above the raster globe. */
const NIGHT_LIGHTS_ALTITUDE_SCALE = 1.0015;
/** Width of the smooth transition between day and night for city lights. */
const NIGHT_LIGHTS_TERMINATOR_SOFTNESS = 0.22;
/** Fade the night lights near the visible limb to avoid a hard edge. */
const NIGHT_LIGHTS_LIMB_SOFTNESS = 0.22;
/** Radius scale factor for the additive atmosphere shell. */
const ATMOSPHERE_ALTITUDE_SCALE = 1.035;
/** Base opacity of the atmosphere shell before fresnel shaping. */
const ATMOSPHERE_OPACITY = 0.62;
/** Sky-blue day-side atmosphere tint. */
const ATMOSPHERE_DAY_COLOR = new THREE.Color(0.34, 0.72, 1.0);
/** Deeper twilight tint used around the terminator and dark side. */
const ATMOSPHERE_NIGHT_COLOR = new THREE.Color(0.04, 0.16, 0.42);
/** Fresnel exponent for the atmosphere rim; higher values tighten the halo. */
const ATMOSPHERE_RIM_EXPONENT = 2.35;
/** Start of the atmosphere night→day color blend across the terminator. */
const ATMOSPHERE_DAY_TRANSITION_START = -0.3;
/** End of the atmosphere night→day color blend across the lit hemisphere. */
const ATMOSPHERE_DAY_TRANSITION_END = 0.45;
/** Minimum atmosphere brightness contribution when sunlight intensity is low. */
const ATMOSPHERE_SUN_BOOST_MIN = 0.75;
/** Maximum atmosphere brightness contribution when sunlight intensity is high. */
const ATMOSPHERE_SUN_BOOST_MAX = 1.15;

/** Strength of the bump-map normal perturbation in the specular shader. */
const DEFAULT_BUMP_SCALE = 0.0045;
/** Phong shininess exponent for ocean specular highlights. */
const SPECULAR_SHININESS = 90.0;
/** Overall strength of the ocean specular term after gloss/fresnel shaping. */
const SPECULAR_INTENSITY = 1.5;
/** Broadens the highlight so water reads less like polished metal. */
const SPECULAR_ROUGHNESS = 0.32;
/** Blend amount for view-angle fresnel shaping on the water highlight. */
const SPECULAR_FRESNEL_STRENGTH = 0.24;
/** Width of the terminator soft-transition band (in dot-product units). */
const TERMINATOR_SOFTNESS = 0.12;
/** Warm sunlight tint applied to specular highlights. */
const SUN_COLOR = new THREE.Color(1.0, 0.96, 0.88);
/** Shared default sunlight intensity for both the dev panel and shader layer. */
export const DEFAULT_SUNLIGHT_INTENSITY = 0.42;

// ─── Specular shader ──────────────────────────────────────────────────────────

const specularVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;
  void main() {
    // modelMatrix places the aligned sphere in MapLibre's unit-sphere ECEF.
    vNormal     = normalize(mat3(modelMatrix) * normal);
    vWorldPos   = (modelMatrix * vec4(position, 1.0)).xyz;
    vUv         = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const specularFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uSpecularMap;
  uniform sampler2D uBumpMap;
  uniform vec3      uCameraPos;
  uniform vec3      uSunDir;
  uniform vec3      uSunColor;
  uniform float     uOpacity;
  uniform float     uBumpScale;
  uniform float     uSpecularStrength;
  uniform float     uRoughness;
  uniform float     uFresnelStrength;
  uniform float     uDebugReflection;
  uniform vec2      uTexelSize;
  uniform float     uShininess;
  uniform float     uTerminatorSoftness;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
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

    // ── Camera-aware ocean specular ───────────────────────────────────────────
    float specStr   = texture2D(uSpecularMap, vUv).r;

    // Use the actual camera-to-fragment vector so the specular lobe lands where
    // the reflected sun ray is visible from the current view, not just near the limb.
    vec3 viewDir    = normalize(uCameraPos - vWorldPos);
    vec3 halfDir    = normalize(uSunDir + viewDir);
    vec3 reflectDir = reflect(-uSunDir, bN);
    float nDotL     = max(dot(bN, uSunDir), 0.0);
    float nDotV     = max(dot(bN, viewDir), 0.0);
    float nDotH     = max(dot(bN, halfDir), 0.0);

    float glossExponent = mix(uShininess, 18.0, uRoughness);
    float spec          = pow(nDotH, glossExponent);
    float fresnel       = 0.02 + 0.98 * pow(1.0 - nDotV, 5.0);
    fresnel             = mix(1.0, fresnel, uFresnelStrength);
    float reflectionHit = max(dot(viewDir, reflectDir), 0.0);
    float hotspot       = smoothstep(0.995, 0.9994, reflectionHit);

    // Suppress specular on the night side with a soft transition
    float sunlight = smoothstep(0.0, uTerminatorSoftness, nDotL);
    float visibility = smoothstep(0.0, 0.08, nDotV);
    spec *= sunlight * visibility * fresnel;

    if (uDebugReflection > 0.5) {
      vec3 debugColor = mix(vec3(0.02, 0.03, 0.08), vec3(0.07, 0.24, 0.30), sunlight);
      debugColor += vec3(0.95, 0.44, 0.06) * pow(nDotV, 3.0) * 0.35;
      debugColor = mix(debugColor, vec3(0.05, 0.98, 0.94), hotspot);
      gl_FragColor = vec4(debugColor, max(0.78 * uOpacity, hotspot));
      return;
    }

    float intensity = specStr * spec * uSpecularStrength * uOpacity;
    gl_FragColor    = vec4(uSunColor, intensity);
  }
`;

const nightLightsFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uNightMap;
  uniform vec3      uCameraPos;
  uniform vec3      uSunDir;
  uniform float     uOpacity;
  uniform float     uTerminatorSoftness;
  uniform float     uLimbSoftness;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float nDotL = dot(N, uSunDir);
    float nDotV = max(dot(N, viewDir), 0.0);

    // Full intensity on the night side, fading smoothly through the terminator.
    float nightSide = 1.0 - smoothstep(-uTerminatorSoftness, uTerminatorSoftness, nDotL);
    // Fade near the limb so the visible edge blends softly into the atmosphere.
    float limbFade = smoothstep(0.0, uLimbSoftness, nDotV);

    vec3 nightColor = texture2D(uNightMap, vUv).rgb;
    float alpha = max(max(nightColor.r, nightColor.g), nightColor.b) * nightSide * limbFade * uOpacity;
    gl_FragColor = vec4(nightColor, alpha);
  }
`;

const atmosphereFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3  uCameraPos;
  uniform vec3  uSunDir;
  uniform vec3  uDayColor;
  uniform vec3  uNightColor;
  uniform float uOpacity;
  uniform float uSunIntensity;

  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float nDotV = max(dot(N, viewDir), 0.0);
    float nDotL = dot(N, uSunDir);

    float rim = pow(1.0 - nDotV, ${ATMOSPHERE_RIM_EXPONENT.toFixed(2)});
    float dayMix = smoothstep(${ATMOSPHERE_DAY_TRANSITION_START}, ${ATMOSPHERE_DAY_TRANSITION_END}, nDotL);
    float sunBoost = mix(${ATMOSPHERE_SUN_BOOST_MIN.toFixed(2)}, ${ATMOSPHERE_SUN_BOOST_MAX.toFixed(2)}, clamp(uSunIntensity, 0.0, 1.0));
    vec3 color = mix(uNightColor, uDayColor, dayMix);
    float alpha = rim * uOpacity * mix(0.8, sunBoost, dayMix);

    gl_FragColor = vec4(color, alpha);
  }
`;

// ─── GlobeEnhancementsLayer ───────────────────────────────────────────────────

/**
 * Rotate Three.js SphereGeometry so that a standard equirectangular texture
 * lines up with MapLibre's globe: u=0 at the date line and u increases eastward.
 */
const EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y = -Math.PI / 2;

export class GlobeEnhancementsLayer {
  readonly id = 'globe-enhancements';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private cloudMesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private nightLightsMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private specMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private atmosphereMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;

  private map: maplibregl.Map | null = null;
  private loaded = false;
  private aborted = false;

  // Re-used every frame to avoid GC pressure
  private readonly _projection = new THREE.Matrix4();
  private readonly _view = new THREE.Matrix4();
  private readonly _cameraWorld = new THREE.Matrix4();
  private readonly _cameraPos = new THREE.Vector3();
  private readonly _sunDir = new THREE.Vector3();

  private sunAzimuthDeg = 0;
  private sunPolarDeg = 90;
  private sunlightIntensity = DEFAULT_SUNLIGHT_INTENSITY;
  private specularDebugEnabled = false;

  constructor(
    private readonly cloudUrl: string,
    private readonly nightLightsUrl: string,
    private readonly specularUrl: string,
    private readonly bumpUrl: string
  ) {}

  /** Update the sun direction to match MapLibre's light (azimuth/polar from getSunPosition). */
  setSun(azimuthDeg: number, polarDeg: number): void {
    this.sunAzimuthDeg = azimuthDeg;
    this.sunPolarDeg = polarDeg;
  }

  setDebug(enabled: boolean): void {
    this.specularDebugEnabled = enabled;
    this.map?.triggerRepaint();
  }

  setSunlightIntensity(intensity: number): void {
    this.sunlightIntensity = clamp01(intensity);
    this.map?.triggerRepaint();
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
    // Shift the default SphereGeometry seam from 90°W to the date line.
    this.cloudMesh.rotation.y = EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y;

    // ── Night lights ──────────────────────────────────────────────────────────
    const nightLightsGeom = new THREE.SphereGeometry(1, 64, 32);
    const nightLightsMat = new THREE.ShaderMaterial({
      uniforms: {
        uNightMap: { value: null },
        uCameraPos: { value: new THREE.Vector3(0, 0, 2) },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uOpacity: { value: 0 },
        uTerminatorSoftness: { value: NIGHT_LIGHTS_TERMINATOR_SOFTNESS },
        uLimbSoftness: { value: NIGHT_LIGHTS_LIMB_SOFTNESS }
      },
      vertexShader: specularVertexShader,
      fragmentShader: nightLightsFragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.nightLightsMesh = new THREE.Mesh(nightLightsGeom, nightLightsMat);
    this.nightLightsMesh.scale.setScalar(NIGHT_LIGHTS_ALTITUDE_SCALE);
    this.nightLightsMesh.rotation.y = EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y;

    // ── Specular + bump sphere ────────────────────────────────────────────────
    const specGeom = new THREE.SphereGeometry(1, 64, 32);
    const specMat = new THREE.ShaderMaterial({
      uniforms: {
        uSpecularMap: { value: null },
        uBumpMap: { value: null },
        uCameraPos: { value: new THREE.Vector3(0, 0, 2) },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uSunColor: { value: SUN_COLOR },
        uOpacity: { value: 0 },
        uBumpScale: { value: DEFAULT_BUMP_SCALE },
        uSpecularStrength: { value: SPECULAR_INTENSITY },
        uRoughness: { value: SPECULAR_ROUGHNESS },
        uFresnelStrength: { value: SPECULAR_FRESNEL_STRENGTH },
        uDebugReflection: { value: 0 },
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
    this.specMesh.rotation.y = EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y;

    // ── Atmosphere shell ──────────────────────────────────────────────────────
    const atmosphereGeom = new THREE.SphereGeometry(1, 64, 32);
    const atmosphereMat = new THREE.ShaderMaterial({
      uniforms: {
        uCameraPos: { value: new THREE.Vector3(0, 0, 2) },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uDayColor: { value: ATMOSPHERE_DAY_COLOR },
        uNightColor: { value: ATMOSPHERE_NIGHT_COLOR },
        uOpacity: { value: 0 },
        uSunIntensity: { value: this.sunlightIntensity }
      },
      vertexShader: specularVertexShader,
      fragmentShader: atmosphereFragmentShader,
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.atmosphereMesh = new THREE.Mesh(atmosphereGeom, atmosphereMat);
    this.atmosphereMesh.scale.setScalar(ATMOSPHERE_ALTITUDE_SCALE);

    this.scene.add(this.cloudMesh);
    this.scene.add(this.nightLightsMesh);
    this.scene.add(this.specMesh);
    this.scene.add(this.atmosphereMesh);

    // ── Load textures asynchronously ─────────────────────────────────────────
    const loader = new THREE.TextureLoader();
    Promise.all([
      loader.loadAsync(this.cloudUrl),
      loader.loadAsync(this.nightLightsUrl),
      loader.loadAsync(this.specularUrl),
      loader.loadAsync(this.bumpUrl)
    ])
      .then(([cloudTex, nightLightsTex, specTex, bumpTex]) => {
        if (this.aborted) {
          // Style was reloaded while textures were in flight — discard them.
          cloudTex.dispose();
          nightLightsTex.dispose();
          specTex.dispose();
          bumpTex.dispose();
          return;
        }
        cloudTex.colorSpace = THREE.SRGBColorSpace;
        cloudMat.map = cloudTex;
        cloudMat.needsUpdate = true;

        nightLightsTex.colorSpace = THREE.SRGBColorSpace;
        nightLightsMat.uniforms.uNightMap.value = nightLightsTex;
        specMat.uniforms.uSpecularMap.value = specTex;
        specMat.uniforms.uBumpMap.value = bumpTex;

        this.loaded = true;
      })
      .catch((err: unknown) => {
        console.warn('[GlobeEnhancements] texture load failed:', err);
      });
  }

  render(
    _gl: WebGLRenderingContext | WebGL2RenderingContext,
    options: CustomRenderMethodInput
  ): void {
    if (!this.loaded || !this.renderer || !this.scene || !this.camera || !this.map) return;

    const zoom = this.map.getZoom();
    // Opacity ramps from 0→1 between FADE_IN_ZOOM and FADE_OUT_ZOOM.
    const t = clamp01((FADE_OUT_ZOOM - zoom) / (FADE_OUT_ZOOM - FADE_IN_ZOOM));
    if (t <= 0) return;

    // ── Camera setup ──────────────────────────────────────────────────────────
    // In MapLibre 5.x the second argument is a CustomRenderMethodInput object.
    // modelViewProjectionMatrix is MapLibre's full globe MVP: it already includes
    // scale(globeRadiusPixels), sphere orientation and camera perspective.
    // Input space: unit sphere (radius 1 = globe surface, radius 1.004 = clouds).
    this.camera.projectionMatrix.fromArray(options.modelViewProjectionMatrix);
    this.camera.projectionMatrixInverse.copy(this.camera.projectionMatrix).invert();

    // Recover the globe-space view transform so the shader can use the actual
    // camera-to-fragment direction for specular reflection.
    this._projection.fromArray(options.projectionMatrix);
    this._view.copy(this._projection).invert().multiply(this.camera.projectionMatrix);
    this._cameraWorld.copy(this._view).invert();
    this._cameraPos.setFromMatrixPosition(this._cameraWorld);

    // ── Sun direction in MapLibre ECEF ────────────────────────────────────────
    // Derived by inverting getSunPosition(azimuthDeg, polarDeg) in Globe.svelte:
    //   sun_ECEF.x = sin(po)·sin(az)   [toward 90°E]
    //   sun_ECEF.y = −sin(po)·cos(az)  [toward north pole]
    //   sun_ECEF.z = −cos(po)          [toward prime meridian]
    const az = (this.sunAzimuthDeg * Math.PI) / 180;
    const po = (this.sunPolarDeg * Math.PI) / 180;
    this._sunDir.set(Math.sin(po) * Math.sin(az), -Math.sin(po) * Math.cos(az), -Math.cos(po));

    // ── Update material uniforms / opacity ────────────────────────────────────
    if (this.cloudMesh) {
      this.cloudMesh.material.opacity = t * MAX_CLOUD_OPACITY;
    }
    if (this.nightLightsMesh) {
      const u = this.nightLightsMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
      u.uOpacity.value = t * MAX_NIGHT_LIGHTS_OPACITY;
    }
    if (this.specMesh) {
      const u = this.specMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
      u.uDebugReflection.value = this.specularDebugEnabled ? 1 : 0;
      u.uOpacity.value = t * this.sunlightIntensity;
    }
    if (this.atmosphereMesh) {
      const u = this.atmosphereMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
      u.uSunIntensity.value = this.sunlightIntensity;
      u.uOpacity.value = t * ATMOSPHERE_OPACITY;
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
    if (this.nightLightsMesh) {
      this.nightLightsMesh.geometry.dispose();
      (this.nightLightsMesh.material.uniforms.uNightMap.value as THREE.Texture | null)?.dispose();
      this.nightLightsMesh.material.dispose();
      this.nightLightsMesh = null;
    }
    if (this.specMesh) {
      this.specMesh.geometry.dispose();
      const u = this.specMesh.material.uniforms;
      (u.uSpecularMap.value as THREE.Texture | null)?.dispose();
      (u.uBumpMap.value as THREE.Texture | null)?.dispose();
      this.specMesh.material.dispose();
      this.specMesh = null;
    }
    if (this.atmosphereMesh) {
      this.atmosphereMesh.geometry.dispose();
      this.atmosphereMesh.material.dispose();
      this.atmosphereMesh = null;
    }

    // Do NOT call renderer.dispose() — it would destroy the shared WebGL context.
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.map = null;
  }
}
