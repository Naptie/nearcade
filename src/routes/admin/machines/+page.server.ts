import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { Machine, Shop } from '$lib/types';
import { serialNumber, toPlainArray, toPlainObject } from '$lib/utils';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { nanoid } from 'nanoid';
import { ShopSource } from '$lib/constants';

export const load: PageServerLoad = async ({ locals, url }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  // Only site admins can manage machines
  if (session.user.userType !== 'site_admin') {
    error(403, m.access_denied());
  }

  const search = url.searchParams.get('search') || '';
  const page = parseInt(url.searchParams.get('page') || '1');
  const limit = 20;
  const skip = (page - 1) * limit;

  const db = mongo.db();

  // Build search query
  const searchQuery: Record<string, unknown> = {};
  if (search.trim()) {
    searchQuery.$or = [
      { name: { $regex: search.trim(), $options: 'i' } },
      { serialNumber: { $regex: search.trim(), $options: 'i' } }
    ];
  }

  // Fetch machines with shop data
  const machinesCollection = db.collection<Machine>('machines');
  const machines = await machinesCollection
    .aggregate([
      { $match: searchQuery },
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit + 1 },
      {
        $lookup: {
          from: 'shops',
          let: { shopSource: '$shopSource', shopId: '$shopId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$source', '$$shopSource'] }, { $eq: ['$id', '$$shopId'] }]
                }
              }
            }
          ],
          as: 'shop'
        }
      },
      { $unwind: { path: '$shop', preserveNullAndEmptyArrays: true } }
    ])
    .toArray();

  const hasMore = machines.length > limit;
  if (hasMore) {
    machines.pop();
  }

  // Get machine statistics
  const totalMachines = await machinesCollection.countDocuments();
  const activatedMachines = await machinesCollection.countDocuments({ isActivated: true });

  return {
    machines: toPlainArray(machines as (Machine & { shop?: Shop })[]),
    search,
    currentPage: page,
    hasMore,
    machineStats: {
      total: totalMachines,
      activated: activatedMachines
    }
  };
};

export const actions = {
  create: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session?.user || session.user.userType !== 'site_admin') {
      return fail(403, { error: m.access_denied() });
    }

    const formData = await request.formData();
    const name = formData.get('name')?.toString().trim();
    const shopSource = formData.get('shopSource')?.toString().trim() as ShopSource;
    const shopIdStr = formData.get('shopId')?.toString().trim();

    if (!name || !shopSource || !shopIdStr) {
      return fail(400, { error: m.missing_required_fields() });
    }

    const shopId = parseInt(shopIdStr);
    if (isNaN(shopId)) {
      return fail(400, { error: m.invalid_shop_id() });
    }

    // Validate shop source
    if (!Object.values(ShopSource).includes(shopSource)) {
      return fail(400, { error: m.invalid_shop_source() });
    }

    const db = mongo.db();

    // Check if shop exists
    const shop = await db.collection<Shop>('shops').findOne({ source: shopSource, id: shopId });
    if (!shop) {
      return fail(404, { error: m.shop_not_found() });
    }

    const machinesCollection = db.collection<Machine>('machines');

    const machine: Machine = {
      id: nanoid(),
      name,
      shopSource,
      shopId,
      serialNumber: serialNumber(),
      isActivated: false,
      createdAt: new Date(),
      updatedAt: new Date()
    };

    await machinesCollection.insertOne(machine);

    return { success: true, machine: toPlainObject(machine) };
  },

  update: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session?.user || session.user.userType !== 'site_admin') {
      return fail(403, { error: m.access_denied() });
    }

    const formData = await request.formData();
    const machineId = formData.get('machineId')?.toString().trim();
    const name = formData.get('name')?.toString().trim();

    if (!machineId || !name) {
      return fail(400, { error: m.missing_required_fields() });
    }

    const db = mongo.db();
    const machinesCollection = db.collection<Machine>('machines');

    const result = await machinesCollection.updateOne(
      { id: machineId },
      { $set: { name, updatedAt: new Date() } }
    );

    if (result.matchedCount === 0) {
      return fail(404, { error: m.machine_not_found() });
    }

    return { success: true };
  },

  delete: async ({ request, locals }) => {
    const session = await locals.auth();
    if (!session?.user || session.user.userType !== 'site_admin') {
      return fail(403, { error: m.access_denied() });
    }

    const formData = await request.formData();
    const machineId = formData.get('machineId')?.toString().trim();

    if (!machineId) {
      return fail(400, { error: m.missing_required_fields() });
    }

    const db = mongo.db();
    const machinesCollection = db.collection<Machine>('machines');

    // Get the machine to find its shop
    const machine = await machinesCollection.findOne({ id: machineId });
    if (!machine) {
      return fail(404, { error: m.machine_not_found() });
    }

    // If the machine was activated, remove the claimed status from the shop
    if (machine.isActivated) {
      await db
        .collection<Shop>('shops')
        .updateOne(
          { source: machine.shopSource, id: machine.shopId },
          { $unset: { isClaimed: '' }, $set: { updatedAt: new Date() } }
        );
    }

    await machinesCollection.deleteOne({ id: machineId });

    return { success: true };
  }
} satisfies Actions;
