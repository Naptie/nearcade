import { z } from 'zod';

/**
 * The region chain a point resolved to.
 *
 * `chain` is absent when the chain could not be resolved; `needsManualRegion`
 * then tells the caller the user has to pick a region by hand.
 *
 * The fields live here without descriptions, and the contract that publishes
 * them decorates each one as it needs.
 */
export const regionResolutionShape = {
  resolved: z.boolean(),
  chain: z.array(z.string()).optional(),
  general: z.array(z.string()),
  detailed: z.string(),
  needsManualRegion: z.boolean().optional(),
  matchedBy: z.enum(['name', 'nearest']).optional()
};
