import { hasBoundEmail } from './email';

export type VerifiedContactUser = {
  email?: string | null;
  emailVerified?: boolean | null;
  phone?: string | null;
  phoneCountryCode?: string | null;
};

export function hasBoundPhone(user?: VerifiedContactUser | null): boolean {
  return !!user?.phone?.trim() && !!user?.phoneCountryCode?.trim();
}

export function hasEmailAndPhone(user?: VerifiedContactUser | null): boolean {
  return hasBoundEmail(user?.email) && user?.emailVerified === true && hasBoundPhone(user);
}

export function getVerifiedContactStatus(user?: VerifiedContactUser | null) {
  const hasVerifiedEmail = hasBoundEmail(user?.email) && user?.emailVerified === true;
  const hasPhone = hasBoundPhone(user);

  return {
    hasVerifiedEmail,
    hasPhone,
    eligible: hasVerifiedEmail && hasPhone
  };
}
