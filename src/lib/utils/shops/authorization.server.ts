import type { Shop } from '$lib/types';

/**
 * Determines whether a user can perform write operations (edit, delete-request, upload/delete photos)
 * on a shop.
 *
 * Rules:
 * - Site admins can always perform write operations.
 * - If the shop is locked (`isLocked: true`), only site admins are allowed.
 * - If the shop is claimed (`isClaimed: true`), only site admins and the shop owner are allowed.
 * - Otherwise, any user with verified contact can perform write operations (caller's responsibility).
 *
 * Note: a missing or undefined `userType` is treated as a non-admin role.
 */
export const canModifyShop = (
  shop: Pick<Shop, 'isClaimed' | 'isLocked' | 'ownerId'>,
  user: { id: string; userType?: string }
): boolean => {
  const isAdmin = user.userType === 'site_admin';
  if (isAdmin) return true;
  if (shop.isLocked) return false;
  if (shop.isClaimed) return shop.ownerId === user.id;
  return true;
};
