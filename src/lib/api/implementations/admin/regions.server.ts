/**
 * The admin region tree: search it, update a node, delete one.
 *
 * Every write reloads the in-memory region cache, so the region hierarchy the
 * rest of the application reads never lags behind what the admin just changed.
 */

import { implement } from '@orpc/server';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  getAdminRegionChildren,
  initRegionCache,
  reloadRegionCache,
  searchAdminRegions
} from '$lib/regions/utils.server';
import type { Region } from '$lib/regions/types';
import { adminContract } from '../../contracts/admin';
import type { ApiContext } from '../../context';
import { apiError, rethrowApiError } from '../../errors';
import { siteAdmin } from './shared.server';

const impl = implement(adminContract).$context<ApiContext>();

export const adminRegionsImplementation = {
  /** `GET /api/admin/regions` */
  listRegions: impl.listRegions.use(siteAdmin).handler(async ({ input }) => {
    // The cache is initialised at server startup; awaiting here is a cheap,
    // idempotent safety net in case this endpoint is hit first.
    await initRegionCache(mongo);

    try {
      if (input.q !== undefined) {
        return { regions: searchAdminRegions(input.q) };
      }

      return { regions: getAdminRegionChildren(input.parentId) };
    } catch (err) {
      rethrowApiError(err, m.internal_server_error());
    }
  }),

  /** `PUT /api/admin/regions/{id}` */
  updateRegion: impl.updateRegion.use(siteAdmin).handler(async ({ input }) => {
    const regionId = input.id;
    if (!regionId) {
      apiError('BAD_REQUEST', m.region_id_required());
    }

    const { name, area, population, location } = input;

    try {
      const db = mongo.db();
      const regionsCollection = db.collection<Region>('regions');

      const existing = await regionsCollection.findOne({ id: regionId });
      if (!existing) {
        apiError('NOT_FOUND', m.region_not_found());
      }

      const update: Partial<Region> = {};
      if (name !== undefined) update.name = name;
      if (area !== undefined) update.area = area;
      if (population !== undefined) update.population = population;
      if (location !== undefined) update.location = location;

      if (Object.keys(update).length === 0) {
        apiError('BAD_REQUEST', m.no_fields_to_update());
      }

      await regionsCollection.updateOne(
        { id: regionId },
        { $set: { ...update, updatedAt: new Date() } }
      );

      await reloadRegionCache(mongo);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.region_save_failed());
    }
  }),

  /** `DELETE /api/admin/regions/{id}` */
  deleteRegion: impl.deleteRegion.use(siteAdmin).handler(async ({ input }) => {
    const regionId = input.id;
    if (!regionId) {
      apiError('BAD_REQUEST', m.region_id_required());
    }

    try {
      const db = mongo.db();
      const regionsCollection = db.collection<Region>('regions');

      const existing = await regionsCollection.findOne({ id: regionId });
      if (!existing) {
        apiError('NOT_FOUND', m.region_not_found());
      }

      const childCount = await regionsCollection.countDocuments({ parentId: regionId });
      if (childCount > 0) {
        apiError('BAD_REQUEST', m.region_delete_has_children());
      }

      const shopCount = await db.collection('shops').countDocuments({ 'address.region': regionId });
      if (shopCount > 0) {
        apiError('BAD_REQUEST', m.region_delete_in_use());
      }

      await regionsCollection.deleteOne({ id: regionId });

      await reloadRegionCache(mongo);

      return { success: true };
    } catch (err) {
      rethrowApiError(err, m.region_delete_failed());
    }
  })
};
