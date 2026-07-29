import { PUBLIC_GOOGLE_MAPS_API_KEY } from '$env/static/public';

let googleMapsPromise: Promise<typeof google.maps> | null = null;

const hasLegacyLibrary = (maps: typeof google.maps, library: string): boolean => {
  switch (library) {
    case 'core':
    case 'maps':
      return typeof maps.Map === 'function';
    case 'places':
      return typeof maps.places?.PlacesService === 'function';
    case 'marker':
      return typeof maps.marker?.AdvancedMarkerElement === 'function';
    default:
      return false;
  }
};

/**
 * Dynamically loads the Google Maps JavaScript API and, optionally, its libraries.
 * Uses a singleton pattern to avoid duplicate script injections.
 * Only call this in browser context when Google Maps is actually needed.
 */
export const loadGoogleMaps = async (libraries: string[] = []): Promise<typeof google.maps> => {
  if (!googleMapsPromise) {
    // If google.maps is already available (e.g. loaded by another means), resolve immediately
    if (typeof window !== 'undefined' && window.google?.maps) {
      googleMapsPromise = Promise.resolve(window.google.maps);
    } else {
      googleMapsPromise = new Promise<typeof google.maps>((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `https://maps.googleapis.com/maps/api/js?key=${PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places,marker`;
        script.async = true;
        script.defer = true;

        script.onload = () => {
          if (window.google?.maps) {
            resolve(window.google.maps);
          } else {
            googleMapsPromise = null;
            reject(new Error('Google Maps failed to initialize'));
          }
        };

        script.onerror = () => {
          googleMapsPromise = null;
          reject(new Error('Failed to load Google Maps script'));
        };

        document.head.appendChild(script);
      });
    }
  }

  const maps = await googleMapsPromise;
  if (typeof maps.importLibrary === 'function') {
    await Promise.all(libraries.map((library) => maps.importLibrary(library)));
  } else if (!libraries.every((library) => hasLegacyLibrary(maps, library))) {
    throw new Error('Google Maps loaded without the required libraries');
  }

  return maps;
};

/**
 * Returns true if Google Maps is already loaded and available.
 */
export const isGoogleMapsLoaded = (): boolean =>
  typeof window !== 'undefined' && !!window.google?.maps;
