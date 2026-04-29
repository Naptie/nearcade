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
const FADE_IN_ZOOM = 4.0;
/** Zoom level above which enhancements are fully transparent. */
const FADE_OUT_ZOOM = 8.0;

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

/** Maximum opacity of the cloud layer (currently left at 0 so night lights / atmosphere stay readable). */
const MAX_CLOUD_OPACITY = 1;
/** Radius scale factor that floats the cloud sphere above the base globe surface. */
const CLOUD_ALTITUDE_SCALE = 1.006;
/** Blue-white tint applied to the cloud texture colour channel. */
const CLOUD_TINT_COLOR = new THREE.Color(0.88, 0.93, 1.0);
/** Warm sunlight tint applied to illuminated cloud tops. */
const CLOUD_DAY_COLOR = new THREE.Color(1.0, 0.99, 0.96);
/** Cooler blue tint applied to clouds away from direct sunlight. */
const CLOUD_TWILIGHT_COLOR = new THREE.Color(0.67, 0.79, 0.93);
/** sin(lat) above which the cloud polar-fade begins (hides equirectangular stretching). */
const CLOUD_POLAR_FADE_START = 0.88;
/** sin(lat) at which the cloud polar-fade is fully transparent. */
const CLOUD_POLAR_FADE_END = 0.93;
/** Fade out the cloud shell near the visible limb to avoid a paper-cutout edge. */
const CLOUD_LIMB_FADE_SOFTNESS = 0.16;
/** Start of the cloud night→day color blend across the terminator. */
const CLOUD_DAY_TRANSITION_START = -0.25;
/** End of the cloud night→day color blend across the lit hemisphere. */
const CLOUD_DAY_TRANSITION_END = 0.35;
/** Minimum cloud brightness when only atmospheric fill light remains. */
const CLOUD_AMBIENT_LIGHT_MIN = 0.38;
/** Maximum cloud brightness under direct sun. */
const CLOUD_AMBIENT_LIGHT_MAX = 1.0;
/** Radius scale factor for the cloud-shadow receiver shell. */
const CLOUD_SHADOW_ALTITUDE_SCALE = 1.0;
/** Default opacity of the cloud-shadow overlay. */
export const DEFAULT_CLOUD_SHADOW_OPACITY = 0.8;
/** Maximum opacity of the night-lights overlay. */
const MAX_NIGHT_LIGHTS_OPACITY = 1;
/** Radius scale factor for the night-lights shell so it sits above the raster globe. */
const NIGHT_LIGHTS_ALTITUDE_SCALE = 1.0015;
/** Fraction of the basemap retained in the dominant blend mode; the rest is suppressed so city lights can win visually. */
const NIGHT_LIGHTS_DOMINANT_BASEMAP_RETENTION = 0.35;
/** Width of the smooth transition between day and night for city lights. */
const NIGHT_LIGHTS_TERMINATOR_SOFTNESS = 0.22;
/** Fade the night lights near the visible limb to avoid a hard edge. */
const NIGHT_LIGHTS_LIMB_SOFTNESS = 0.22;
/** Radius scale factor for the additive atmosphere shell. */
const ATMOSPHERE_ALTITUDE_SCALE = 1.012;
/** Base opacity of the atmosphere shell before fresnel shaping. */
const ATMOSPHERE_OPACITY = 1;
/** Sky-blue day-side atmosphere tint. */
const ATMOSPHERE_DAY_COLOR = new THREE.Color(0.34, 0.72, 1.0);
/** Deeper twilight tint used around the terminator and dark side. */
const ATMOSPHERE_NIGHT_COLOR = new THREE.Color(0.08, 0.24, 0.48);
/** Fresnel exponent for the atmosphere rim; higher values tighten the halo. */
const ATMOSPHERE_RIM_EXPONENT = 2.35;
/** Start of the atmosphere night→day color blend across the terminator. */
const ATMOSPHERE_DAY_TRANSITION_START = -0.3;
/** End of the atmosphere night→day color blend across the lit hemisphere. */
const ATMOSPHERE_DAY_TRANSITION_END = 0.45;
/** Minimum atmosphere brightness contribution when sunlight intensity is low. */
const ATMOSPHERE_SUN_BOOST_MIN = 0.2;
/** Maximum atmosphere brightness contribution when sunlight intensity is high. */
const ATMOSPHERE_SUN_BOOST_MAX = 0.6;

/** Strength of the bump-map normal perturbation in the specular shader. */
const DEFAULT_BUMP_SCALE = 0.0045;
/** Phong shininess exponent for ocean specular highlights. */
const SPECULAR_SHININESS = 120.0;
/** Overall strength of the ocean specular term after gloss/fresnel shaping. */
const SPECULAR_INTENSITY = 1.2;
/** Broadens the highlight so water reads less like polished metal. */
const SPECULAR_ROUGHNESS = 0.64;
/** Blend amount for view-angle fresnel shaping on the water highlight. */
const SPECULAR_FRESNEL_STRENGTH = 0.16;
/** Width of the terminator soft-transition band (in dot-product units). */
const TERMINATOR_SOFTNESS = 0.16;
/** Warm sunlight tint applied to specular highlights. */
const SUN_COLOR = new THREE.Color(1.0, 0.92, 0.72);
/** Fixed specular/sunlight intensity used internally by the shader layer. */
const DEFAULT_SUNLIGHT_INTENSITY = 1;

/** Names of the individual Three.js mesh layers that can be toggled. */
export type GlobeLayerName = 'clouds' | 'cloudShadow' | 'nightLights' | 'specular' | 'atmosphere';

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
  uniform float     uDominantBlend;
  uniform float     uDominantDimStrength;
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
    float nightMask = nightSide * limbFade;

    vec3 nightColor = texture2D(uNightMap, vUv).rgb;
    float alpha = max(max(nightColor.r, nightColor.g), nightColor.b) * nightMask * uOpacity;

    if (uDominantBlend > 0.5) {
      // In dominant mode, dim the basemap across the dark hemisphere while
      // keeping the city-light color contribution tied to the texture itself.
      float dimAlpha = nightMask * uDominantDimStrength;
      gl_FragColor = vec4(nightColor * alpha, dimAlpha);
      return;
    }

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

const cloudFragmentShader = /* glsl */ `
  precision highp float;

  uniform sampler2D uCloudMap;
  uniform vec3      uDayColor;
  uniform vec3      uTwilightColor;
  uniform vec3      uCameraPos;
  uniform vec3      uSunDir;
  uniform float     uOpacity;
  uniform float     uPolarFadeStart;
  uniform float     uPolarFadeEnd;
  uniform float     uLimbFadeSoftness;
  uniform float     uDayTransitionStart;
  uniform float     uDayTransitionEnd;
  uniform float     uAmbientLightMin;
  uniform float     uAmbientLightMax;

  varying vec3 vNormal;
  varying vec3 vWorldPos;
  varying vec2 vUv;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float nDotL = dot(N, uSunDir);
    float nDotV = max(dot(N, viewDir), 0.0);
    float cloudDensity = texture2D(uCloudMap, vUv).r;

    // Fade out near poles to hide equirectangular texture stretching.
    // vNormal.y = sin(lat): 0 at equator, ±1 at poles.
    float absLatSin = abs(N.y);
    float polarFade = 1.0 - smoothstep(uPolarFadeStart, uPolarFadeEnd, absLatSin);
    float limbFade = smoothstep(0.0, uLimbFadeSoftness, nDotV);
    float dayMix = smoothstep(uDayTransitionStart, uDayTransitionEnd, nDotL);
    float light = mix(uAmbientLightMin, uAmbientLightMax, dayMix);
    vec3 cloudColor = mix(uTwilightColor, uDayColor, dayMix) * light;

    float alpha = cloudDensity * uOpacity * polarFade * limbFade;
    gl_FragColor = vec4(cloudColor, alpha);
  }
`;

const cloudShadowFragmentShader = /* glsl */ `
  precision highp float;

  #define PI 3.14159265358979323846

  uniform sampler2D uCloudMap;
  uniform vec3      uSunDir;
  uniform float     uOpacity;
  uniform float     uCloudAltitude;
  uniform float     uPolarFadeStart;
  uniform float     uPolarFadeEnd;

  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    vec3 N = normalize(vNormal);
    vec3 L = uSunDir;

    // Only cast shadows on the lit hemisphere.
    float nDotL = dot(N, L);
    float dayFactor = smoothstep(-0.05, 0.12, nDotL);
    if (dayFactor <= 0.0) discard;

    // Intersect the sun ray from this fragment with the cloud sphere.
    // P is on the shadow sphere (radius ≈ CLOUD_SHADOW_ALTITUDE_SCALE),
    // cloud sphere has radius uCloudAltitude (= CLOUD_ALTITUDE_SCALE).
    vec3 P = vWorldPos;
    float pLen2 = dot(P, P);
    float pDotL = dot(P, L);
    float R = uCloudAltitude;
    // t² + 2*(P·L)*t + (|P|²−R²) = 0 → discriminant = (P·L)²−(|P|²−R²)
    float disc = pDotL * pDotL - (pLen2 - R * R);
    if (disc < 0.0) discard;

    // Forward intersection along the sun direction.
    float t = -pDotL + sqrt(max(disc, 0.0));
    if (t < 0.0) discard;

    // Normalise intersection point to get the ECEF direction.
    vec3 Q = normalize(P + t * L);

    // Convert ECEF direction to equirectangular UV.
    // In MapLibre ECEF: x = sin(lng)*cos(lat), z = cos(lng)*cos(lat),
    // so atan(Q.x, Q.z) = lng, giving u=0 at lng=-PI (date line).
    // The cloud mesh has rotation.y = -PI/2 which shifts its seam from 90°W
    // to the date line, so its vUv also has u=0 at the date line — same
    // convention, no extra rotation needed here.
    float lng = atan(Q.x, Q.z);
    float lat = asin(clamp(Q.y, -1.0, 1.0));
    float u = lng / (2.0 * PI) + 0.5;
    float v = lat / PI + 0.5;

    float cloudDensity = texture2D(uCloudMap, vec2(u, v)).r;
    float absLatSin = abs(Q.y);
    float polarFade = 1.0 - smoothstep(uPolarFadeStart, uPolarFadeEnd, absLatSin);
    float shadowAlpha = cloudDensity * uOpacity * dayFactor * polarFade;
    if (shadowAlpha <= 0.0) discard;
    gl_FragColor = vec4(0.0, 0.0, 0.0, shadowAlpha);
  }
`;

// ─── GlobeVisualsLayer ───────────────────────────────────────────────────

/**
 * Rotate Three.js SphereGeometry so that a standard equirectangular texture
 * lines up with MapLibre's globe: u=0 at the date line and u increases eastward.
 */
const EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y = -Math.PI / 2;

export class GlobeVisualsLayer {
  readonly id = 'globe-visuals';
  readonly type = 'custom' as const;
  readonly renderingMode = '3d' as const;

  private renderer: THREE.WebGLRenderer | null = null;
  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;

  private cloudMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  private cloudShadowMesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
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
  private _cloudShadowOpacity = DEFAULT_CLOUD_SHADOW_OPACITY;

  /** Visibility state stored before onAdd so it survives style reloads. */
  private readonly _meshVisibility: Record<GlobeLayerName, boolean> = {
    clouds: true,
    cloudShadow: true,
    nightLights: true,
    specular: true,
    atmosphere: true
  };

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

  setSunlightIntensity(intensity: number): void {
    this.sunlightIntensity = clamp01(intensity);
    this.map?.triggerRepaint();
  }

  /** Toggle visibility of an individual Three.js enhancement mesh. */
  setMeshVisible(name: GlobeLayerName, visible: boolean): void {
    this._meshVisibility[name] = visible;
    const mesh = this._getMeshByName(name);
    if (mesh) {
      mesh.visible = visible;
      this.map?.triggerRepaint();
    }
  }

  /** Set the opacity of the cloud-shadow overlay (0–1). */
  setCloudShadowOpacity(opacity: number): void {
    this._cloudShadowOpacity = clamp01(opacity);
    if (this.cloudShadowMesh) {
      this.cloudShadowMesh.material.uniforms.uOpacity.value = this._cloudShadowOpacity;
      this.map?.triggerRepaint();
    }
  }

  private _getMeshByName(name: GlobeLayerName): THREE.Mesh | null {
    switch (name) {
      case 'clouds':
        return this.cloudMesh;
      case 'cloudShadow':
        return this.cloudShadowMesh;
      case 'nightLights':
        return this.nightLightsMesh;
      case 'specular':
        return this.specMesh;
      case 'atmosphere':
        return this.atmosphereMesh;
    }
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
    const cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uCloudMap: { value: null },
        uDayColor: { value: CLOUD_DAY_COLOR.clone().multiply(CLOUD_TINT_COLOR) },
        uTwilightColor: { value: CLOUD_TWILIGHT_COLOR.clone().multiply(CLOUD_TINT_COLOR) },
        uCameraPos: { value: new THREE.Vector3(0, 0, 2) },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uOpacity: { value: 0 },
        uPolarFadeStart: { value: CLOUD_POLAR_FADE_START },
        uPolarFadeEnd: { value: CLOUD_POLAR_FADE_END },
        uLimbFadeSoftness: { value: CLOUD_LIMB_FADE_SOFTNESS },
        uDayTransitionStart: { value: CLOUD_DAY_TRANSITION_START },
        uDayTransitionEnd: { value: CLOUD_DAY_TRANSITION_END },
        uAmbientLightMin: { value: CLOUD_AMBIENT_LIGHT_MIN },
        uAmbientLightMax: { value: CLOUD_AMBIENT_LIGHT_MAX }
      },
      vertexShader: specularVertexShader,
      fragmentShader: cloudFragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: true
    });
    this.cloudMesh = new THREE.Mesh(cloudGeom, cloudMat);
    // CLOUD_ALTITUDE_SCALE makes the cloud sphere 0.4% larger than the base globe.
    this.cloudMesh.scale.setScalar(CLOUD_ALTITUDE_SCALE);
    // Shift the default SphereGeometry seam from 90°W to the date line.
    this.cloudMesh.rotation.y = EQUIRECTANGULAR_ALIGNMENT_ROTATION_Y;
    this.cloudMesh.renderOrder = 40;
    this.cloudMesh.visible = this._meshVisibility.clouds;

    // ── Cloud shadow sphere ───────────────────────────────────────────────────
    const cloudShadowGeom = new THREE.SphereGeometry(1, 64, 32);
    const cloudShadowMat = new THREE.ShaderMaterial({
      uniforms: {
        uCloudMap: { value: null },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uOpacity: { value: this._cloudShadowOpacity },
        uCloudAltitude: { value: CLOUD_ALTITUDE_SCALE },
        uPolarFadeStart: { value: CLOUD_POLAR_FADE_START },
        uPolarFadeEnd: { value: CLOUD_POLAR_FADE_END }
      },
      vertexShader: specularVertexShader,
      fragmentShader: cloudShadowFragmentShader,
      transparent: true,
      blending: THREE.NormalBlending,
      depthWrite: false,
      depthTest: false,
      side: THREE.FrontSide
    });
    this.cloudShadowMesh = new THREE.Mesh(cloudShadowGeom, cloudShadowMat);
    // Render the shadow as an overlay on the visible globe hemisphere rather
    // than as depth-tested geometry, so it does not fight the earth surface.
    this.cloudShadowMesh.scale.setScalar(CLOUD_SHADOW_ALTITUDE_SCALE);
    this.cloudShadowMesh.renderOrder = 10;
    this.cloudShadowMesh.visible = this._meshVisibility.cloudShadow;

    // ── Night lights ──────────────────────────────────────────────────────────
    const nightLightsGeom = new THREE.SphereGeometry(1, 64, 32);
    const nightLightsMat = new THREE.ShaderMaterial({
      uniforms: {
        uNightMap: { value: null },
        uCameraPos: { value: new THREE.Vector3(0, 0, 2) },
        uSunDir: { value: new THREE.Vector3(0, 0, 1) },
        uOpacity: { value: 0 },
        uDominantBlend: { value: 0 },
        uDominantDimStrength: { value: 1 - NIGHT_LIGHTS_DOMINANT_BASEMAP_RETENTION },
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
    // Hardcode the dominant blend: src*alpha + dst*(1−srcAlpha).
    nightLightsMat.blending = THREE.CustomBlending;
    nightLightsMat.blendEquation = THREE.AddEquation;
    nightLightsMat.blendSrc = THREE.OneFactor;
    nightLightsMat.blendDst = THREE.OneMinusSrcAlphaFactor;
    nightLightsMat.blendSrcAlpha = THREE.ZeroFactor;
    nightLightsMat.blendDstAlpha = THREE.OneFactor;
    nightLightsMat.blendEquationAlpha = THREE.AddEquation;
    nightLightsMat.uniforms.uDominantBlend.value = 1;
    nightLightsMat.needsUpdate = true;
    this.nightLightsMesh.renderOrder = 20;
    this.nightLightsMesh.visible = this._meshVisibility.nightLights;

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
    this.specMesh.renderOrder = 30;
    this.specMesh.visible = this._meshVisibility.specular;

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
      // FrontSide renders the outer face of the sphere. At the globe centre,
      // N·V ≈ 1 → rim ≈ 0 (transparent — the satellite map shows through).
      // At the limb, N·V ≈ 0 → rim ≈ 1 (bright halo).
      // BackSide caused every visible fragment to have N·V = 0, creating a
      // uniform filled circle and also inverted the sun-boost direction.
      side: THREE.FrontSide,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false
    });
    this.atmosphereMesh = new THREE.Mesh(atmosphereGeom, atmosphereMat);
    this.atmosphereMesh.scale.setScalar(ATMOSPHERE_ALTITUDE_SCALE);
    this.atmosphereMesh.renderOrder = 50;
    this.atmosphereMesh.visible = this._meshVisibility.atmosphere;

    // Render order: shadow → night lights → specular → clouds → atmosphere
    this.scene.add(this.cloudShadowMesh);
    this.scene.add(this.nightLightsMesh);
    this.scene.add(this.specMesh);
    this.scene.add(this.cloudMesh);
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
        cloudMat.uniforms.uCloudMap.value = cloudTex;
        // Cloud shadow samples the same texture.
        cloudShadowMat.uniforms.uCloudMap.value = cloudTex;

        nightLightsTex.colorSpace = THREE.SRGBColorSpace;
        nightLightsMat.uniforms.uNightMap.value = nightLightsTex;
        specMat.uniforms.uSpecularMap.value = specTex;
        specMat.uniforms.uBumpMap.value = bumpTex;

        this.loaded = true;
      })
      .catch((err: unknown) => {
        console.warn('[GlobeVisuals] texture load failed:', err);
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
      const u = this.cloudMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
      u.uOpacity.value = t * MAX_CLOUD_OPACITY;
    }
    if (this.cloudShadowMesh) {
      const u = this.cloudShadowMesh.material.uniforms;
      u.uSunDir.value.copy(this._sunDir);
      // uOpacity is set separately by setCloudShadowOpacity; scale by t for zoom fade.
      u.uOpacity.value = t * this._cloudShadowOpacity;
    }
    if (this.nightLightsMesh) {
      const u = this.nightLightsMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
      u.uOpacity.value = t * MAX_NIGHT_LIGHTS_OPACITY;
      u.uDominantDimStrength.value = t * (1 - NIGHT_LIGHTS_DOMINANT_BASEMAP_RETENTION);
    }
    if (this.specMesh) {
      const u = this.specMesh.material.uniforms;
      u.uCameraPos.value.copy(this._cameraPos);
      u.uSunDir.value.copy(this._sunDir);
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
      // Dispose the cloud texture here (shared with cloud shadow — dispose only once).
      (this.cloudMesh.material.uniforms.uCloudMap.value as THREE.Texture | null)?.dispose();
      this.cloudMesh.material.dispose();
      this.cloudMesh = null;
    }
    if (this.cloudShadowMesh) {
      this.cloudShadowMesh.geometry.dispose();
      // Cloud texture already disposed above; clear the reference only.
      this.cloudShadowMesh.material.uniforms.uCloudMap.value = null;
      this.cloudShadowMesh.material.dispose();
      this.cloudShadowMesh = null;
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
