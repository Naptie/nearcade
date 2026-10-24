import { implement } from '@orpc/server';
import { shopsContract } from '../../contracts/shops';
import type { ApiContext } from '../../context';

/**
 * Plumbing shared by the delete-request implementations.
 *
 * The procedures are spread across the `delete-requests-*` modules beside
 * this file, so the contract-bound builder they all write against is created
 * once, here: every module then binds to the same contract and the same
 * context type, and the assembled group is still checked against the contract
 * once, in `shops/index.ts`.
 */
export const impl = implement(shopsContract).$context<ApiContext>();
