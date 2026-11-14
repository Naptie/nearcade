import { requestUnifiedGeo, type UnifiedGeoCoordinate } from '$lib/utils/unified-geo.server';

type CoordinateSystem = UnifiedGeoCoordinate['coordinateSystem'];

interface TerritoryResolutionResponse {
  success: true;
  territory: {
    datum: CoordinateSystem;
  };
}

interface CoordinateConversionResponse {
  success: true;
  coordinate: UnifiedGeoCoordinate;
}

/** Resolve the territory datum (WGS84 or GCJ02) for a point via POST /geo/resolve. */
export async function resolveTerritoryDatum(
  longitude: number,
  latitude: number,
  coordinateSystem: CoordinateSystem = 'WGS84'
): Promise<CoordinateSystem> {
  const response = await requestUnifiedGeo<TerritoryResolutionResponse>('/geo/resolve', {
    coordinate: { longitude, latitude, coordinateSystem }
  });
  return response.territory.datum;
}

/** Convert a point to the coordinate system selected by unified-geo's territory router. */
export async function convertToMapProfile(
  longitude: number,
  latitude: number,
  coordinateSystem: CoordinateSystem
): Promise<{ longitude: number; latitude: number; coordinateSystem: CoordinateSystem } | null> {
  const coordinate: UnifiedGeoCoordinate = { longitude, latitude, coordinateSystem };
  try {
    const targetCoordinateSystem = await resolveTerritoryDatum(
      longitude,
      latitude,
      coordinateSystem
    );
    if (targetCoordinateSystem === coordinateSystem) {
      return { longitude, latitude, coordinateSystem };
    }

    const converted = await requestUnifiedGeo<CoordinateConversionResponse>('/geo/convert', {
      coordinate,
      targetCoordinateSystem
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
