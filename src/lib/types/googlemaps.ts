// Google Maps types for the nearcade application
export interface GoogleMapsContext {
  googleMaps: unknown | undefined; // Using unknown to avoid Google Maps types dependency
  error: string | null;
}

// Type for marker cluster (not implemented in initial version)
export interface GoogleMapsMarkerOptions {
  position: unknown; // google.maps.LatLngLiteral
  title: string;
  content: string;
  zIndex: number;
  map: unknown; // google.maps.Map
}

// Custom InfoWindow for shop details
export interface ShopInfoWindow {
  position: unknown; // google.maps.LatLngLiteral
  content: string;
  isOpen: boolean;
}
