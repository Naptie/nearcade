import { implement } from '@orpc/server';
import { nanoid } from 'nanoid';
import { qbindContract } from '../contracts/qbind';
import type { ApiContext } from '../context';
import { apiError, rethrowApiError } from '../errors';
import { claimAndCompleteQbindToken, registerQbindToken } from '$lib/auth/qbind.server';
import { m } from '$lib/paraglide/messages';

const impl = implement(qbindContract).$context<ApiContext>();

export const qbindImplementation = {
  claim: impl.claim.handler(async ({ input, context }) => {
    const userId = context.session?.user?.id;

    if (!userId) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    // `input.token` is already known to be a well-formed token: the contract's
    // input schema holds the pattern, and oRPC validates the input before the
    // handler runs. Re-checking it here duplicated the pattern and could only
    // ever disagree with it.
    const token = input.token;

    try {
      const result = await claimAndCompleteQbindToken(token);
      if (result.status === 'success') {
        return { success: true, qq: result.qq };
      }
      if (result.status === 'invalid') {
        apiError('INTERNAL_SERVER_ERROR', m.qbind_invalid_qq());
      }
      apiError('NOT_FOUND', m.qbind_token_not_found());
    } catch (err) {
      rethrowApiError(err, m.qbind_verification_error());
    }
  }),

  issueToken: impl.issueToken.handler(async ({ context }) => {
    const userId = context.session?.user?.id;

    if (!userId) {
      apiError('UNAUTHORIZED', m.unauthorized());
    }

    const token = nanoid(32);
    await registerQbindToken(token, userId);

    return { token };
  })
};
