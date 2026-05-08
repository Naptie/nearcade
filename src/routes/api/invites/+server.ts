import { isHttpError, isRedirect, json } from '@sveltejs/kit';
import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import type { InviteLink } from '$lib/types';
import { nanoid } from 'nanoid';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import { createInviteRequestSchema } from '$lib/schemas/invite';
import { validationMessage } from '$lib/schemas/common';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
  }

  try {
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = createInviteRequestSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues, m.missing_required_fields()));
    }

    const body = parsedBody.data;
    const { type, targetId, title, description, expiresAt, maxUses, requireApproval } = body;

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
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error creating invite:', err);
    error(500, m.failed_to_create_invite());
  }
};

export const GET: RequestHandler = async ({ url, locals }) => {
  const session = locals.session;

  if (!session?.user) {
    error(401, m.unauthorized());
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
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error fetching invites:', err);
    error(500, m.failed_to_fetch_invites());
  }
};
