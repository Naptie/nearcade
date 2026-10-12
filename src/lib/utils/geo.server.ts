import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';

type CoordinateSystem = UnifiedGeoCoordinate['coordinateSystem'];

interface MapRouteResponse {
  success: true;
  coordinateSystem: CoordinateSystem;
}

interface CoordinateConversionResponse {
  success: true;
  coordinate: UnifiedGeoCoordinate;
}

/** Convert a point to the coordinate system selected by unified-geo's territory router. */
export async function convertToMapProfile(
  longitude: number,
  latitude: number,
  coordinateSystem: CoordinateSystem
): Promise<{ longitude: number; latitude: number; coordinateSystem: CoordinateSystem } | null> {
  const coordinate: UnifiedGeoCoordinate = { longitude, latitude, coordinateSystem };
  try {
    const profile = await requestUnifiedGeo<MapRouteResponse>('/maps/route', { coordinate });
    if (profile.coordinateSystem === coordinateSystem) {
      return { longitude, latitude, coordinateSystem };
    }

    const converted = await requestUnifiedGeo<CoordinateConversionResponse>('/geo/convert', {
      coordinate,
      targetCoordinateSystem: profile.coordinateSystem
    });
    return {
      longitude: converted.coordinate.longitude,
      latitude: converted.coordinate.latitude,
      coordinateSystem: converted.coordinate.coordinateSystem
    };
  } catch (cause) {
    console.error('Unified geo coordinate routing failed:', cause);
    return null;
  }
}
