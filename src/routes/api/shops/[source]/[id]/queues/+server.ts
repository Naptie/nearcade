import { error, json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Machine, QueueRecord, Shop, QueuePosition } from '$lib/types';
import { ShopSource } from '$lib/constants';
import { m } from '$lib/paraglide/messages';
import { toPlainArray } from '$lib/utils';
import { sendWeChatTemplateMessage } from '$lib/utils/index.server';
import type { User } from '@auth/sveltekit';
import { WECHAT_TEMPLATE_QUEUE_NOTIFICATION } from '$env/static/private';

// Helper to validate machine API secret and check shop binding
const validateMachineAuth = async (
  request: Request,
  shopSource: ShopSource,
  shopId: number
): Promise<Machine> => {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw error(401, m.unauthorized());
  }

  const apiSecret = authHeader.slice(7);
  const db = mongo.db();
  const machinesCollection = db.collection<Machine>('machines');

  const machine = await machinesCollection.findOne({
    apiSecret,
    isActivated: true
  });

  if (!machine) {
    throw error(401, m.invalid_machine_credentials());
  }

  // Validate machine is bound to the correct shop
  if (machine.shopSource !== shopSource || machine.shopId !== shopId) {
    throw error(403, m.machine_not_bound_to_shop());
  }

  return machine;
};

// Helper to find a member's position info across all queues
interface MemberPositionInfo {
  gameId: number;
  position: QueuePosition;
  queueIndex: number;
}

const findMemberPosition = (
  slotIndex: string,
  queues: Array<{ gameId: number; queue: QueuePosition[] }>
): MemberPositionInfo | null => {
  for (const queueRecord of queues) {
    for (let i = 0; i < queueRecord.queue.length; i++) {
      const position = queueRecord.queue[i];
      if (position.members.some((m) => m.slotIndex === slotIndex)) {
        return { gameId: queueRecord.gameId, position, queueIndex: i };
      }
    }
  }
  return null;
};

// Helper to get all unique slot indices across all queues
const getAllSlotIndices = (
  queues: Array<{ gameId: number; queue: QueuePosition[] }>
): Set<string> => {
  const indices = new Set<string>();
  for (const queueRecord of queues) {
    for (const position of queueRecord.queue) {
      for (const member of position.members) {
        indices.add(member.slotIndex);
      }
    }
  }
  return indices;
};

// Helper to send queue notification
const sendQueueNotification = async (
  userId: string | null,
  machineName: string | undefined,
  slotIndex: string,
  statusMessage: string,
  shopName: string
) => {
  if (!userId) return;

  try {
    await sendWeChatTemplateMessage(userId, WECHAT_TEMPLATE_QUEUE_NOTIFICATION, {
      shop: shopName,
      machine: machineName || '未知机台',
      slot: slotIndex,
      status: statusMessage
    });
  } catch (err) {
    console.error(
      `Failed to send WeChat queue notification to user ${userId} (slot: ${slotIndex}):`,
      err
    );
  }
};

interface QueueGameData {
  gameId: number;
  queue: QueuePosition[];
}

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const source = params.source.toLowerCase().trim() as ShopSource;
    const idRaw = params.id;
    const id = parseInt(idRaw);

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, m.invalid_shop_source());
    }

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    // Validate machine authentication and shop binding
    const machine = await validateMachineAuth(request, source, id);

    const body = (await request.json()) as {
      queues: QueueGameData[];
    };

    const { queues: newQueuesData } = body;

    if (!Array.isArray(newQueuesData)) {
      error(400, m.missing_required_parameters());
    }

    // Validate queue structure for all games
    for (const queueData of newQueuesData) {
      if (typeof queueData.gameId !== 'number' || !Array.isArray(queueData.queue)) {
        error(400, m.invalid_queue_format());
      }

      for (const position of queueData.queue) {
        if (
          typeof position.position !== 'number' ||
          !['playing', 'queued', 'deferred'].includes(position.status) ||
          !Array.isArray(position.members)
        ) {
          error(400, m.invalid_queue_format());
        }

        // Validate optional new fields
        if (position.machineName !== undefined && typeof position.machineName !== 'string') {
          error(400, m.invalid_queue_format());
        }

        if (position.isPublic !== undefined && typeof position.isPublic !== 'boolean') {
          error(400, m.invalid_queue_format());
        }

        for (const member of position.members) {
          if (
            typeof member.slotIndex !== 'string' ||
            (member.userId !== null && typeof member.userId !== 'string')
          ) {
            error(400, m.invalid_queue_format());
          }
        }
      }
    }

    // Verify shop exists and has the games
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({ source, id });

    if (!shop) {
      error(404, m.shop_not_found());
    }

    const shopGameIds = new Set(shop.games.map((g) => g.gameId));
    for (const queueData of newQueuesData) {
      if (!shopGameIds.has(queueData.gameId)) {
        error(404, m.games_missing_in_shop());
      }
    }

    // Get previous queue state for comparison
    const queuesCollection = db.collection<QueueRecord>('queues');
    const previousQueues = await queuesCollection
      .find({ shopSource: source, shopId: id })
      .toArray();

    // Build lookup maps for comparison
    const previousQueuesMap = new Map<number, QueuePosition[]>();
    for (const q of previousQueues) {
      previousQueuesMap.set(q.gameId, q.queue);
    }

    // Get all slot indices that existed before and after
    const previousSlots = getAllSlotIndices(
      previousQueues.map((q) => ({ gameId: q.gameId, queue: q.queue }))
    );
    const newSlots = getAllSlotIndices(newQueuesData);

    // Determine which slots are existing (not newly added or removed)
    // Note: Newly added or removed cards (condition a) should NOT receive notifications,
    // so we only process slots that exist in both previous and new queues
    const existingSlots = new Set([...newSlots].filter((s) => previousSlots.has(s)));

    // Process notifications for existing slots (those not newly added or removed)
    const notificationsToSend: Array<{
      userId: string | null;
      machineName: string | undefined;
      slotIndex: string;
      statusMessage: string;
    }> = [];

    for (const slotIndex of existingSlots) {
      const prevInfo = findMemberPosition(
        slotIndex,
        previousQueues.map((q) => ({ gameId: q.gameId, queue: q.queue }))
      );
      const newInfo = findMemberPosition(slotIndex, newQueuesData);

      if (!prevInfo || !newInfo) continue;

      const prevStatus = prevInfo.position.status;
      const newStatus = newInfo.position.status;
      const prevGameId = prevInfo.gameId;
      const newGameId = newInfo.gameId;
      const prevPosition = prevInfo.position.position;
      const newPosition = newInfo.position.position;
      const prevMembers = prevInfo.position.members.map((m) => m.slotIndex).sort();
      const newMembers = newInfo.position.members.map((m) => m.slotIndex).sort();

      // Get userId for this slot
      const member = newInfo.position.members.find((m) => m.slotIndex === slotIndex);
      const userId = member?.userId || null;
      const machineName = newInfo.position.machineName;

      let shouldNotify = false;
      let statusMessage = '';

      // Condition b: Status changes
      if (prevStatus !== newStatus) {
        if (prevStatus === 'queued' && newStatus === 'playing') {
          // queued -> playing: Notify "it's your turn"
          shouldNotify = true;
          statusMessage = '轮到您了！请前往机台开始游戏';
        } else if (
          (prevStatus === 'queued' && newStatus === 'deferred') ||
          (prevStatus === 'deferred' && newStatus === 'queued')
        ) {
          // Status switch between queued and deferred
          shouldNotify = true;
          statusMessage =
            newStatus === 'deferred' ? '您的排队状态已变更为延后' : '您的排队状态已恢复';
        }
        // playing -> any other: DO NOT notify (condition b)
      }

      // Condition c: Position progression within same queue
      if (
        !shouldNotify &&
        prevGameId === newGameId &&
        prevStatus === newStatus &&
        newPosition < prevPosition
      ) {
        shouldNotify = true;
        const ahead = newPosition - 1; // Position 1 means 0 ahead
        statusMessage = ahead === 0 ? '您是下一位！请准备' : `前面还有 ${ahead} 组`;
      }

      // Condition d: Queue switching (moved to different game)
      if (!shouldNotify && prevGameId !== newGameId) {
        const gameName = shop.games.find((g) => g.gameId === newGameId)?.name || '其他游戏';
        shouldNotify = true;
        statusMessage = `您已切换到 ${gameName} 的队列`;
      }

      // Condition e: Members list updated (new playmates)
      if (!shouldNotify && JSON.stringify(prevMembers) !== JSON.stringify(newMembers)) {
        shouldNotify = true;
        statusMessage = `您的同组玩家有变动，当前共 ${newMembers.length} 人`;
      }

      if (shouldNotify && userId) {
        notificationsToSend.push({
          userId,
          machineName,
          slotIndex,
          statusMessage
        });
      }
    }

    // Update all queue records
    const now = new Date();
    for (const queueData of newQueuesData) {
      await queuesCollection.updateOne(
        { shopSource: source, shopId: id, gameId: queueData.gameId },
        {
          $set: {
            queue: queueData.queue,
            updatedAt: now,
            updatedByMachineId: machine.id
          },
          $setOnInsert: {
            shopSource: source,
            shopId: id,
            gameId: queueData.gameId
          }
        },
        { upsert: true }
      );
    }

    // Send notifications asynchronously (don't await to avoid blocking response)
    // Note: Delivery is not guaranteed as notifications are fire-and-forget
    for (const notification of notificationsToSend) {
      sendQueueNotification(
        notification.userId,
        notification.machineName,
        notification.slotIndex,
        notification.statusMessage,
        shop.name
      ).catch((err) =>
        console.error(`Failed to queue notification for slot ${notification.slotIndex}:`, err)
      );
    }

    // notificationsQueued indicates how many notifications were attempted,
    // not necessarily how many were successfully delivered
    return json({ success: true, notificationsQueued: notificationsToSend.length });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error updating queue:', err);
    error(500, m.failed_to_update_queue());
  }
};

export const GET: RequestHandler = async ({ params }) => {
  try {
    const source = params.source.toLowerCase().trim() as ShopSource;
    const idRaw = params.id;
    const id = parseInt(idRaw);

    // Validate shop source
    if (!Object.values(ShopSource).includes(source)) {
      error(400, m.invalid_shop_source());
    }

    if (isNaN(id)) {
      error(400, m.invalid_shop_id());
    }

    const db = mongo.db();
    const queuesCollection = db.collection<QueueRecord>('queues');
    const usersCollection = db.collection<User>('users');

    // Get all queues for this shop
    const queues = await queuesCollection.find({ shopSource: source, shopId: id }).toArray();

    // Collect all user IDs from queues
    const userIds = new Set<string>();
    for (const queue of queues) {
      for (const position of queue.queue) {
        for (const member of position.members) {
          if (member.userId) {
            userIds.add(member.userId);
          }
        }
      }
    }

    // Fetch user data
    const users =
      userIds.size > 0
        ? await usersCollection
            .find(
              { id: { $in: Array.from(userIds) } },
              { projection: { id: 1, name: 1, displayName: 1, image: 1 } }
            )
            .toArray()
        : [];

    const userMap = new Map(users.map((u) => [u.id, u]));

    // Enrich queue data with user info
    const enrichedQueues = queues.map((queue) => ({
      ...queue,
      queue: queue.queue.map((position) => ({
        ...position,
        members: position.members.map((member) => ({
          ...member,
          user: member.userId ? userMap.get(member.userId) || null : null
        }))
      }))
    }));

    return json({
      success: true,
      queues: toPlainArray(enrichedQueues)
    });
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting queues:', err);
    error(500, m.failed_to_get_queues());
  }
};
