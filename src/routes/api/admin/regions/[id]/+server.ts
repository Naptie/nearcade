import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { reloadRegionCache } from '$lib/regions/utils.server';
import { m } from '$lib/paraglide/messages';
import { z } from 'zod';
import type { Region } from '$lib/regions/types';

const updateRegionSchema = z.object({
  name: z.record(z.string(), z.string()).optional(),
  area: z.number().min(0).nullable().optional(),
  population: z.number().min(0).nullable().optional(),
  location: z
    .object({
      type: z.literal('Point'),
      coordinates: z.tuple([z.number(), z.number()])
    })
    .nullable()
    .optional()
});

function requireSiteAdmin(session: App.Locals['session']) {
  if (!session?.user) {
    error(401, m.unauthorized());
  }
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }
}

export const PUT: RequestHandler = async ({ request, locals, params }) => {
  requireSiteAdmin(locals.session);

  const regionId = params.id;
  if (!regionId) {
    error(400, m.region_id_required());
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, m.invalid_request_body());
  }

  const parseResult = updateRegionSchema.safeParse(body);
  if (!parseResult.success) {
    console.error('Region update validation failed:', parseResult.error);
    error(400, m.invalid_request_body());
  }

  const { name, area, population, location } = parseResult.data;

  try {
    const db = mongo.db();
    const regionsCollection = db.collection<Region>('regions');

    const existing = await regionsCollection.findOne({ id: regionId });
    if (!existing) {
      error(404, m.region_not_found());
    }

    const update: Partial<Region> = {};
    if (name !== undefined) update.name = name;
    if (area !== undefined) update.area = area;
    if (population !== undefined) update.population = population;
    if (location !== undefined) update.location = location;

    if (Object.keys(update).length === 0) {
      error(400, m.no_fields_to_update());
    }

    await regionsCollection.updateOne(
      { id: regionId },
      { $set: { ...update, updatedAt: new Date() } }
    );

    await reloadRegionCache(mongo);

    return json({ success: true });
  } catch (err) {
    console.error('Error updating region:', err);
    if (err instanceof Response) throw err;
    error(500, m.region_save_failed());
  }
};

export const DELETE: RequestHandler = async ({ locals, params }) => {
  requireSiteAdmin(locals.session);

  const regionId = params.id;
  if (!regionId) {
    error(400, m.region_id_required());
  }

  try {
    const db = mongo.db();
    const regionsCollection = db.collection<Region>('regions');

    const existing = await regionsCollection.findOne({ id: regionId });
    if (!existing) {
      error(404, m.region_not_found());
    }

    const childCount = await regionsCollection.countDocuments({ parentId: regionId });
    if (childCount > 0) {
      error(400, m.region_delete_has_children());
    }

    const shopCount = await db.collection('shops').countDocuments({ 'address.region': regionId });
    if (shopCount > 0) {
      error(400, m.region_delete_in_use());
    }

    await regionsCollection.deleteOne({ id: regionId });

    await reloadRegionCache(mongo);

    return json({ success: true });
  } catch (err) {
    console.error('Error deleting region:', err);
    if (err instanceof Response) throw err;
    error(500, m.region_delete_failed());
  }
};
