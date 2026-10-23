/**
 * Public path of the self-hosted API reference script bundle.
 *
 * The interactive reference is served at `/api/docs`, and its script bundle is
 * published as a plain static asset rather than loaded from a CDN — the
 * reference therefore keeps working offline and in networks where the CDN is
 * unreachable.
 *
 * It sits at the site root next to `openapi.json`, which is the published
 * description of the API: that document is generated at runtime from the
 * contract router and served from `/openapi.json`, so the two describe the
 * same API by construction.
 *
 * `scripts/generate-api-reference.ts` publishes the bundle at this path and
 * reads the constant from here, so the build step and the document that points
 * at it can never disagree. This module deliberately has no imports: the build
 * script imports it outside the SvelteKit module graph, where `$app/*` and the
 * other virtual modules do not resolve.
 */
export const API_REFERENCE_SCRIPT = '/api-reference.js';
