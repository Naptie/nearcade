/**
 * The shared admin middlewares.
 *
 * `AnyMiddleware` declares the output type as `any`, so the middlewares can be
 * attached to any procedure — oRPC types a middleware against the procedure it
 * guards, and these only authorize the call.
 */
import { requireSiteAdmin, requireSiteAdminOrSecret } from '../../middleware/admin';

export const siteAdmin = requireSiteAdmin;

export const siteAdminOrSecret = requireSiteAdminOrSecret;
