const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Converts a Base64URL string back into an integer.
 */
const base64UrlToInt = (str: string): number => {
  let result = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const charValue = BASE64_CHARS.indexOf(char);
    if (charValue === -1) {
      throw new Error(`Invalid Base64URL character: ${char}`);
    }
    result = result * 64 + charValue;
  }
  return result;
};

/**
 * Converts a Base64URL-encoded string back to a standard string (via UTF-8).
 */
const base64UrlToString = (str: string): string => {
  // Convert back to standard Base64
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');

  // Add padding back
  while (base64.length % 4) {
    base64 += '=';
  }

  const binaryString = atob(base64);

  // Convert binary string to Uint8Array
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  const decoder = new TextDecoder();
  return decoder.decode(bytes);
};

/**
 * Decompresses a 'd' parameter string into its components.
 * @param d The raw, non-decoded 'd' parameter value.
 * @returns An object with the decompressed data.
 */
export const decompressLocationData = (
  d: string
): {
  latitude: number;
  longitude: number;
  radius: number;
  name: string;
} => {
  if (d.length < 11) {
    throw new Error('Invalid discovery string: too short.');
  }

  // 1. Extract prefix and name data
  const prefix = d.substring(0, 11);
  const nameData = d.substring(11);

  // 2. Decode prefix
  const latStr = prefix.substring(0, 5);
  const lonStr = prefix.substring(5, 10);
  const radStr = prefix.substring(10, 11);

  const latInt = base64UrlToInt(latStr);
  const lonInt = base64UrlToInt(lonStr);
  const radInt = base64UrlToInt(radStr);

  const latitude = (latInt - 90_000_000) / 1_000_000;
  const longitude = (lonInt - 180_000_000) / 1_000_000;
  const radius = radInt + 1;

  // 3. Decode name
  let name: string;
  if (nameData.startsWith('!')) {
    // It's standard URL-encoded. Strip '!' and decode.
    const standardEncodedName = nameData.substring(1);
    name = decodeURIComponent(standardEncodedName);
  } else {
    // It's our custom Base64URL.
    name = base64UrlToString(nameData);
  }

  return {
    // Format to 6 decimal places as in the original URL
    latitude: parseFloat(latitude.toFixed(6)),
    longitude: parseFloat(longitude.toFixed(6)),
    radius,
    name
  };
};
