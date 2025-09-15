import { base } from '$app/paths';
import { AMAP_SECRET } from '$env/static/private';
import { error, isHttpError, type RequestEvent } from '@sveltejs/kit';

export const handleAMapRequest = async ({ url, fetch }: RequestEvent) => {
  try {
    // Check if the secret is configured
    if (!AMAP_SECRET) {
      error(500, 'AMap secret not configured');
    }

    const pathname = url.pathname.replace(`${base}/_AMapService`, '');

    // Build the target URL - proxy to https://restapi.amap.com/
    const targetUrl = new URL(`https://restapi.amap.com${pathname}`);

    // Copy all existing query parameters
    for (const [key, value] of url.searchParams.entries()) {
      targetUrl.searchParams.set(key, value);
    }

    targetUrl.searchParams.set('jscode', AMAP_SECRET);

    // Make the proxied request
    const response = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Referer: 'https://restapi.amap.com/'
      }
    });

    if (!response.ok) {
      error(response.status, `AMap API request failed: ${response.statusText}`);
    }

    // Get the response data
    const data = await response.text();
    const contentType = response.headers.get('content-type') || 'application/json';

    // Return the proxied response
    return new Response(data, {
      status: response.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'public, max-age=300' // Cache for 5 minutes
      }
    });
  } catch (err) {
    console.error('AMap proxy error:', err);
    if (err && isHttpError(err)) {
      throw err;
    }
    error(500, 'Internal server error');
  }
};
