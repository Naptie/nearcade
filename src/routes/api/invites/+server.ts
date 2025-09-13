import { json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { InviteLink } from '$lib/types';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';

interface CreateInviteRequest {
  type: 'university' | 'club';
  targetId: string;
  title?: string | null;
  description?: string | null;
  expiresAt?: string | null;
  maxUses?: number | null;
  requireApproval?: boolean;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  try {
    const body: CreateInviteRequest = await request.json();
    const { type, targetId, title, description, expiresAt, maxUses, requireApproval } = body;

    // Validate input
    if (!type || !targetId) {
      error(400, 'Missing required fields');
    }

    if (!['university', 'club'].includes(type)) {
      error(400, 'Invalid invite type');
    }

    const db = mongo.db();

    // Check permissions - for now, allow any authenticated user to create invites
    // TODO: Add proper permission checks based on user role and target

    const inviteCode = nanoid(12);
    const invite: Omit<InviteLink, '_id'> = {
      id: nanoid(),
      code: inviteCode,
      type,
      targetId,
      createdBy: session.user.id!,
      title: title || null,
      description: description || null,
      maxUses: maxUses || null,
      currentUses: 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      requireApproval: requireApproval || false,
      isActive: true,
      createdAt: new Date()
    };

    const invitesCollection = db.collection<Omit<InviteLink, '_id'>>('invite_links');
    await invitesCollection.insertOne(invite);

    return json({ invite });
  } catch (err) {
    console.error('Error creating invite:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to create invite');
  }
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = await locals.auth();

  if (!session?.user) {
    error(401, 'Unauthorized');
  }

  try {
    const db = mongo.db();
    const invitesCollection = db.collection('invite_links');

    const type = url.searchParams.get('type');
    const targetId = url.searchParams.get('targetId');
    const createdBy = url.searchParams.get('createdBy');

    const query: Record<string, unknown> = {};
    if (type) query.type = type;
    if (targetId) query.targetId = targetId;
    if (createdBy) query.createdBy = createdBy;

    const invites = await invitesCollection.find(query).sort({ createdAt: -1 }).toArray();

    return json({ invites });
  } catch (err) {
    console.error('Error fetching invites:', err);
    error(500, 'Failed to fetch invites');
  }
};
