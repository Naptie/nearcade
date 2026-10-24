/**
 * The prefix every nearcade API token carries.
 *
 * One family, two holders:
 *
 * - a **machine's** API secret, minted for a kiosk and bound to the shop it
 *   acts for;
 * - a **user's** API token, minted by the user in their own settings.
 *
 * Both travel as `Authorization: Bearer nk_…`, which is why the code that
 * recognises one of them recognises the prefix rather than the token itself.
 *
 * The module has no imports on purpose: the offline tools (the migration
 * script, the contract checks) read it under `tsx`, outside the Vite pipeline,
 * where `$env` and `$app` do not resolve.
 */
export const API_TOKEN_PREFIX = 'nk_';
