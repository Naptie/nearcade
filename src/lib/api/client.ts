import { createORPCClient } from '@orpc/client';
import { RPCLink } from '@orpc/client/fetch';
import type { ContractRouterClient } from '@orpc/contract';
import type { contractRouter } from './contracts';
import { apiOrigin } from './origin';
import { RPC_MOUNT } from './paths';

/**
 * The typed API client.
 *
 * Every procedure of the contract router is reachable through it, with its
 * input and output types derived from the contract. No URL is ever written by
 * hand and no response is ever cast.
 */
export type ApiClient = ContractRouterClient<typeof contractRouter>;

/**
 * Browser-side client.
 *
 * It talks to the RPC surface at `RPC_MOUNT` over plain HTTP, so cookies and
 * the session are forwarded automatically (same-origin requests carry
 * credentials by default).
 *
 * `PUBLIC_API_BASE` still wins over the current origin, the same way the
 * hand-written `fetch` calls did — a deployment that points the front end at a
 * separate API host keeps working. The rule itself lives in `apiOrigin()` so it
 * cannot drift from the other places that build an absolute URL.
 *
 * On the server use `createServerApiClient()` from
 * `src/lib/api/server-client.ts` instead — it calls the procedures in-process
 * and skips the HTTP round trip entirely.
 */
const rpcBaseUrl = () => {
  if (typeof location === 'undefined') {
    throw new Error(
      'The browser API client cannot be used on the server. Use createServerApiClient() from $lib/api/server-client instead.'
    );
  }
  return `${apiOrigin()}${RPC_MOUNT}`;
};

const link = new RPCLink({
  url: rpcBaseUrl
});

export const orpc: ApiClient = createORPCClient<ApiClient>(link);
