import { error, isHttpError, isRedirect, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import { storeFCMToken, removeFCMToken } from '$lib/notifications/fcm.server';
import { m } from '$lib/paraglide/messages';
import { fcmTokenActionSchema } from '$lib/schemas/notifications';
import { validationMessage } from '$lib/schemas/common';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;

  if (!session?.user?.id) {
    error(401, m.unauthorized());
  }

  try {
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null) {
      error(400, 'Invalid request body');
    }

    const parsedBody = fcmTokenActionSchema.safeParse(rawBody);
    if (!parsedBody.success) {
      error(400, validationMessage(parsedBody.error.issues, m.missing_token_or_action()));
    }

    const { token, action } = parsedBody.data;

    if (action === 'store') {
      await storeFCMToken(mongo, session.user.id, token);
      return json({ success: true, message: 'FCM token stored' });
    } else if (action === 'remove') {
      await removeFCMToken(mongo, session.user.id, token);
      return json({ success: true, message: 'FCM token removed' });
    } else {
      error(400, m.invalid_action());
    }
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error managing FCM token:', err);
    error(500, m.failed_to_manage_fcm_token());
  }
};
