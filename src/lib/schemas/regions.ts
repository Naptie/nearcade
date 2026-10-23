import { z } from 'zod';

/**
 * The region chain unified-geo resolved for a point.
 *
 * `region` is absent when the chain could not be resolved; `needsManualRegion`
 * then tells the caller the user has to pick a region by hand.
 *
 * The fields are shared by the geo and the regions contracts. Each contract
 * documents them the way its own endpoints do — the geo contract describes
 * every field, the regions contract describes none — so the shape lives here
 * without descriptions and each site decorates it as it needs.
 */
export const regionResolutionShape = {
  resolved: z.boolean(),
  region: z.array(z.string()).optional(),
  general: z.array(z.string()),
  detailed: z.string(),
  needsManualRegion: z.boolean().optional(),
  matchedBy: z.enum(['name', 'nearest']).optional()
};
