import { AMAP_SECRET } from '$env/static/private';
import { error, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = async ({ url, fetch }) => {
	try {
		// Check if the secret is configured
		if (!AMAP_SECRET) {
			throw error(500, 'Amap secret not configured');
		}

		const pathname = url.pathname.replace('/_AMapService', '');
		
		// Build the target URL - proxy to https://restapi.amap.com/
		const targetUrl = new URL(`https://restapi.amap.com${pathname}`);
		
		// Copy all existing query parameters
		for (const [key, value] of url.searchParams.entries()) {
			targetUrl.searchParams.set(key, value);
		}
		
		targetUrl.searchParams.set('jscode', AMAP_SECRET);

        console.log('Proxied Amap request:', targetUrl.toString());

		// Make the proxied request
		const response = await fetch(targetUrl.toString(), {
			method: 'GET',
			headers: {
				'User-Agent': 'Mozilla/5.0 (compatible; Nearcade-Proxy/1.0)',
				'Accept': 'application/json, text/plain, */*',
				'Accept-Language': 'en-US,en;q=0.9,zh;q=0.8',
				'Referer': 'https://restapi.amap.com/'
			}
		});

		if (!response.ok) {
			throw error(response.status, `Amap API request failed: ${response.statusText}`);
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
		console.error('Amap proxy error:', err);
		
		// If it's already a SvelteKit error, re-throw it
		if (err && typeof err === 'object' && 'status' in err) {
			throw err;
		}
		
		// Otherwise, return a generic server error
		throw error(500, 'Internal server error');
	}
};
