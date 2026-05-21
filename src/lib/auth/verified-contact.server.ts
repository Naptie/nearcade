import { error } from '@sveltejs/kit';

import { m } from '$lib/paraglide/messages';

import {
  getVerifiedContactStatus,
  hasBoundPhone,
  hasEmailAndPhone,
  type VerifiedContactUser
} from './verified-contact';

export { hasBoundPhone, hasEmailAndPhone };

export function requireEmailAndPhone(user?: VerifiedContactUser | null): void {
  const { eligible, hasPhone, hasVerifiedEmail } = getVerifiedContactStatus(user);

  if (eligible) {
    return;
  }

  const missingVerifiedEmail = !hasVerifiedEmail;
  const missingPhone = !hasPhone;

  if (missingVerifiedEmail && missingPhone) {
    error(403, m.verified_contact_required_for_contribution());
  }

  if (missingVerifiedEmail) {
    error(403, m.verified_email_required_for_contribution());
  }

  error(403, m.phone_binding_required_for_contribution());
}
