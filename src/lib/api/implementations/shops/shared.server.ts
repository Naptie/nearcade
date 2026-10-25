import type { z } from 'zod';
import { shopPhotoSchema } from '$lib/schemas/shops';

/**
 * Plumbing shared by the shop implementations.
 *
 * The shop procedures are the only ones that read straight out of MongoDB and
 * hand the document over without parsing it first; everywhere else the value
 * is already plain and the shared `toWire` is enough.
 */

/** A photo document, as it is stored. */
export type ShopPhotoEntry = z.infer<typeof shopPhotoSchema>;

export { toPlainWire } from '../../wire.server';
