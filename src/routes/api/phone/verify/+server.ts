import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import mongo from '$lib/db/index.server';
import type { User } from '$lib/auth/types';
import { verifyPhoneOtp } from '$lib/sms/index.server';
import { m } from '$lib/paraglide/messages';

export const POST: RequestHandler = async ({ request, locals }) => {
  const session = locals.session;
  if (!session) {
    error(401, m.unauthorized());
  }

  const userId = session.user.id;

  let body: { phoneNumber?: string; countryCode?: string; code?: string };
  try {
    body = await request.json();
  } catch {
    error(400, 'Invalid request body');
  }

  const phoneNumber = body.phoneNumber?.trim();
  const countryCode = body.countryCode?.trim();
  const code = body.code?.trim();

  if (!phoneNumber || !countryCode || !code) {
    error(400, 'phoneNumber, countryCode, and code are required');
  }

  const result = await verifyPhoneOtp(phoneNumber, countryCode, code);
  if (!result.success) {
    error(502, result.error);
  }

  if (!result.verified) {
    return json({ success: false, verified: false });
  }

  // Bind the phone number to the user account
  const db = mongo.db();
  await db.collection<User>('users').updateOne(
    { id: userId },
    {
      $set: {
        phone: phoneNumber,
        phoneCountryCode: countryCode,
        updatedAt: new Date()
      }
    }
  );

  return json({ success: true, verified: true });
};
