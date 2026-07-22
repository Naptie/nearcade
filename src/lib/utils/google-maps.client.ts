import { PUBLIC_GOOGLE_MAPS_API_KEY } from '$env/static/public';

let googleMapsPromise: Promise<typeof google.maps> | null = null;

/**
 * Dynamically loads the Google Maps JavaScript API.
 * Uses a singleton pattern to avoid duplicate script injections.
 * Only call this in browser context when Google Maps is actually needed.
 */
export const loadGoogleMaps = (): Promise<typeof google.maps> => {
  if (googleMapsPromise) return googleMapsPromise;

  // If google.maps is already available (e.g. loaded by another means), resolve immediately
  if (typeof window !== 'undefined' && window.google?.maps) {
    googleMapsPromise = Promise.resolve(window.google.maps);
    return googleMapsPromise;
  }

  googleMapsPromise = new Promise<typeof google.maps>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places&loading=async`;
    script.async = true;
    script.defer = true;

    // The async loading API resolves google.maps.importLibrary
    script.onload = () => {
      if (window.google?.maps) {
        resolve(window.google.maps);
      } else {
        reject(new Error('Google Maps failed to initialize'));
      }
    };

    script.onerror = () => {
      googleMapsPromise = null;
      reject(new Error('Failed to load Google Maps script'));
    };

    document.head.appendChild(script);
  });

  return googleMapsPromise;
};

/**
 * Returns true if Google Maps is already loaded and available.
 */
export const isGoogleMapsLoaded = (): boolean =>
  typeof window !== 'undefined' && !!window.google?.maps;
