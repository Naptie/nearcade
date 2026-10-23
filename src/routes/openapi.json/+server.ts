import { base } from '$app/paths';
import type { RequestHandler } from './$types';
import { generateOpenApiDocument } from '$lib/api/openapi';
import { API_MOUNT } from '$lib/api/paths';

/**
 * The published OpenAPI document.
 *
 * It is generated from the contract router at runtime rather than written to
 * `static/` at build time, so the document can never drift from the code that
 * serves the API: there is exactly one generator, and it is the same one the
 * contract check uses.
 *
 * The document is expensive to build (every Zod schema has to be converted to
 * JSON Schema), so the serialized body is memoized for the lifetime of the
 * process. The contract cannot change while the process is alive, so the
 * memoized body is always the current one.
 */
let cached: Promise<{ body: string; etag: string }> | undefined;

const document = () =>
  (cached ??= generateOpenApiDocument(`${base}${API_MOUNT}`).then(async (doc) => {
    const body = JSON.stringify(doc);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body));
    const etag = `"${Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}"`;
    return { body, etag };
  }));

export const GET: RequestHandler = async ({ request }) => {
  const { body, etag } = await document();

  const headers = {
    'content-type': 'application/json; charset=utf-8',
    // A CDN may hold the document for 30 seconds; the ETag lets it revalidate
    // cheaply in between. The publish workflow waits for the deployment it
    // triggered before it reads this document, so a revalidation is cheap
    // enough that it can ask for the copy the live deployment actually serves.
    'cache-control': 'public, max-age=300, s-maxage=30',
    'access-control-allow-origin': '*',
    etag
  };

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, { status: 304, headers });
  }

  return new Response(body, { headers });
};
