import { browser } from '$app/environment';
import { base } from '$app/paths';
import { page } from '$app/state';
import { env } from '$env/dynamic/public';

/**
 * The absolute prefix that every URL to this deployment's HTTP surface starts
 * with.
 *
 * Two deployments have to keep working: the default one, where the front end
 * and the API are served from the same origin under `paths.base`, and one where
 * `PUBLIC_API_BASE` points the front end at a separate API host. The rule that
 * chooses between them is written once here — it was previously repeated at
 * every call site, and each copy that drifted would have sent one class of
 * request to the wrong host.
 *
 * Returns `''` during server-side rendering, where no public origin is known
 * yet: a relative URL is correct there, because the browser resolves it against
 * the origin it actually reached.
 */
export const apiOrigin = (): string =>
  env.PUBLIC_API_BASE || (browser ? `${page.url.origin}${base}` : '');
