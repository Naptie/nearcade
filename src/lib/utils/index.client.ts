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

/**
 * Whether the device has a discrete / high-performance GPU (NVIDIA, AMD Radeon,
 * Apple Silicon). Detected via WEBGL_debug_renderer_info; falls back to false if
 * the extension is blocked or unavailable.
 */
export const HAS_DISCRETE_GPU = (() => {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (gl) {
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      if (ext) {
        const renderer = gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) as string;
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /(NVIDIA|GeForce|RTX|GTX|Radeon|Apple\s+M\d)/i.test(renderer);
      }
    }
  } catch {
    // WebGL unavailable or extension blocked.
  }
  return false;
})();
