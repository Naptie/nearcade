import type { RequestEvent } from '@sveltejs/kit';
import type { AuthSession, User } from '$lib/auth/types';

/**
 * Context handed to every nearcade API procedure.
 *
 * It carries the SvelteKit request event so that procedure implementations can
 * keep using the exact same primitives the legacy `+server.ts` handlers used
 * (`event.locals`, `event.url`, `event.request`, `event.fetch`, cookies), while
 * the *contract* owns the validated input and output.
 */
export interface ApiContext {
  /** The SvelteKit request event backing this call. */
  event: RequestEvent;
  /** Session resolved by `hooks.server.ts` (cookie session or OAuth bearer). */
  session: AuthSession | null;
  /** Signed-in user, when there is one. */
  user: User | null;
  /**
   * Scopes granted to the OAuth access token that authorized this call.
   *
   * `null` means the call did **not** use an OAuth bearer token — it used a
   * first-party session cookie, an `nk_` API key, or `SSC_SECRET`. Those
   * bypass the OAuth scope matrix entirely and must keep doing so.
   */
  oauthScopes: string[] | null;
  /**
   * Response headers the procedure wants to set. Provided by oRPC's
   * `ResponseHeadersPlugin`, which is installed on both handlers.
   */
  resHeaders?: Headers;
}

/** Build the API context from a SvelteKit request event. */
export const createApiContext = (event: RequestEvent): ApiContext => ({
  event,
  session: event.locals.session ?? null,
  user: event.locals.user ?? null,
  oauthScopes: event.locals.oauthScopes ?? null
});
