import { implement } from '@orpc/server';
import { meilisearchContract } from '../contracts/meilisearch';
import type { ApiContext } from '../context';
import { init } from '$lib/db/meili.server';
import mongo from '$lib/db/index.server';

const impl = implement(meilisearchContract).$context<ApiContext>();

export const meilisearchImplementation = {
  refresh: impl.refresh.handler(async () => {
    // The contract declares `guard: 'secret'`, so a caller that lacks
    // `SSC_SECRET` was already turned away by `enforceAuthGuard` — which runs
    // before the handler, and compares the same raw header the legacy handler
    // did. Re-checking it here only duplicated a rule that can drift.
    await init(mongo);

    return { success: true };
  })
};
