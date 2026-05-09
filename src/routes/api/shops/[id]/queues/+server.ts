import { error, json, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { Machine, QueueRecord, Shop, QueuePosition } from '$lib/types';
import { m } from '$lib/paraglide/messages';
import { getOrigin, sendWeChatTemplateMessage } from '$lib/utils/index.server';
import type { User } from '$lib/auth/types';
import { WECHAT_TEMPLATE_QUEUE_NOTIFICATION } from '$env/static/private';
import { toPlainObject } from '$lib/utils';
import {
  queueReportResponseSchema,
  queuesListResponseSchema,
  queuesPostBodySchema,
  shopIdParamSchema
} from '$lib/schemas/shops';
import { parseJsonOrError, parseParamsOrError } from '$lib/utils/validation.server';

// Helper to validate machine API secret and check shop binding
const validateMachineAuth = async (request: Request, shopId: number): Promise<Machine> => {
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
  if (machine.shopId !== shopId) {
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
  shop: Shop,
  request: Request
) => {
  if (!userId) return;

  try {
    await sendWeChatTemplateMessage(
      userId,
      WECHAT_TEMPLATE_QUEUE_NOTIFICATION,
      {
        shop: shop.name,
        machine: machineName || '未知机台',
        slot: slotIndex,
        status: statusMessage
      },
      `${getOrigin(request)}/shops/${shop.id}`
    );
  } catch (err) {
    console.error(
      `Failed to send WeChat queue notification to user ${userId} (slot: ${slotIndex}):`,
      err
    );
  }
};

export const POST: RequestHandler = async ({ params, request }) => {
  try {
    const { id } = parseParamsOrError(shopIdParamSchema, params);

    // Validate machine authentication and shop binding
    const machine = await validateMachineAuth(request, id);

    const body = await parseJsonOrError(request, queuesPostBodySchema);

    const { queues: newQueuesData } = body;

    // Verify shop exists and has the games
    const db = mongo.db();
    const shopsCollection = db.collection<Shop>('shops');
    const shop = await shopsCollection.findOne({ id });

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
    const previousData = await queuesCollection.findOne({ shopId: id });
    const previousQueues = previousData ? previousData.games : [];

    // Create a Map of the final state to ensure we retain unchanged queues
    const finalQueuesMap = new Map<number, QueuePosition[]>();

    for (const prevQueue of previousQueues) {
      finalQueuesMap.set(prevQueue.gameId, prevQueue.queue);
    }

    for (const newQueue of newQueuesData) {
      finalQueuesMap.set(newQueue.gameId, newQueue.queue);
    }

    const mergedQueues = Array.from(finalQueuesMap.entries()).map(([gameId, queue]) => ({
      gameId,
      queue
    }));

    // Get all slot indices that existed before and after
    // We compare previous state vs the *partial update* (newQueuesData) for notifications.
    // This ensures we only generate notifications for the games that actually reported changes.
    const previousSlots = getAllSlotIndices(
      previousQueues.map((q) => ({ gameId: q.gameId, queue: q.queue }))
    );
    const newSlots = getAllSlotIndices(newQueuesData);

    // Determine which slots are existing (not newly added or removed)
    const existingSlots = new Set([...newSlots].filter((s) => previousSlots.has(s)));

    // Process notifications for existing slots within the updated queues
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
      // We look up the new position in the change set.
      // If a user moved to a queue not in the change set, we won't notify here, which is safer for partial updates.
      const newInfo = findMemberPosition(slotIndex, newQueuesData);

      if (!prevInfo || !newInfo) continue;

      const prevStatus = prevInfo.position.status;
      const newStatus = newInfo.position.status;
      const prevMachineName = prevInfo.position.machineName;
      const newMachineName = newInfo.position.machineName;
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
          shouldNotify = true;
          statusMessage = '轮到您了！请前往机台开始游戏';
        } else if (
          (prevStatus === 'queued' && newStatus === 'deferred') ||
          (prevStatus === 'deferred' && newStatus === 'queued')
        ) {
          shouldNotify = true;
          statusMessage =
            newStatus === 'deferred' ? '您的排队状态已变更为延后' : '您的排队状态已恢复';
        }
      }

      // Condition c: Position progression within same queue
      if (
        !shouldNotify &&
        prevMachineName === newMachineName &&
        prevStatus === newStatus &&
        newPosition < prevPosition
      ) {
        shouldNotify = true;
        const ahead = newPosition - 1;
        statusMessage = ahead === 0 ? '您是下一位！请准备' : `前面还有 ${ahead} 组`;
      }

      // Condition d: Queue switching
      if (!shouldNotify && prevMachineName !== newMachineName) {
        shouldNotify = true;
        statusMessage = `您已切换到 ${newMachineName} 的队列`;
      }

      // Condition e: Members list updated
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

    // Update all queue records with the MERGED data
    const now = new Date();
    await queuesCollection.updateOne(
      { shopId: id },
      {
        $set: {
          games: mergedQueues,
          updatedAt: now,
          updatedBy: machine.id
        },
        $setOnInsert: {
          shopId: id
        }
      },
      { upsert: true }
    );

    // Send notifications asynchronously
    for (const notification of notificationsToSend) {
      sendQueueNotification(
        notification.userId,
        notification.machineName,
        notification.slotIndex,
        notification.statusMessage,
        shop,
        request
      ).catch((err) =>
        console.error(`Failed to queue notification for slot ${notification.slotIndex}:`, err)
      );
    }

    const response = queueReportResponseSchema.parse({
      success: true,
      notificationsQueued: notificationsToSend.length
    });

    return json(response);
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
    const { id } = parseParamsOrError(shopIdParamSchema, params);

    const db = mongo.db();
    const queuesCollection = db.collection<QueueRecord>('queues');
    const usersCollection = db.collection<User>('users');

    // Get all queues for this shop
    const data = await queuesCollection.findOne({ shopId: id });
    const queues = data ? data.games : [];

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

    const response = queuesListResponseSchema.parse(
      toPlainObject({
        success: true,
        queues: enrichedQueues
      })
    );

    return json(response);
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error getting queues:', err);
    error(500, m.failed_to_get_queues());
  }
};
