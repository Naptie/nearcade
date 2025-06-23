import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => {
  // Check if the parameter is a valid floating-point number for coordinates
  // This regex matches decimal numbers with optional minus sign
  // Optimized for latitude/longitude values
  const coordRegex = /^-?\d+(?:\.\d+)?$/;

  if (!coordRegex.test(param)) {
    return false;
  }

  // Parse the coordinate value
  const coord = parseFloat(param);

  // Check if it's a valid number (not NaN or infinite)
  if (isNaN(coord) || !isFinite(coord)) {
    return false;
  }

  // Validate coordinate ranges:
  // Latitude: -90 to +90 degrees
  // Longitude: -180 to +180 degrees
  // Since this matcher is for both, we use the wider longitude range
  return coord >= -180 && coord <= 180;
};
