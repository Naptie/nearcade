// Google Maps types for the nearcade application
export interface GoogleMapsContext {
  googleMaps: any | undefined; // Using any to avoid Google Maps types dependency
  error: string | null;
}

// Type for marker cluster (not implemented in initial version)
export interface GoogleMapsMarkerOptions {
  position: any; // google.maps.LatLngLiteral
  title: string;
  content: string;
  zIndex: number;
  map: any; // google.maps.Map
}

// Custom InfoWindow for shop details
export interface ShopInfoWindow {
  position: any; // google.maps.LatLngLiteral
  content: string;
  isOpen: boolean;
}