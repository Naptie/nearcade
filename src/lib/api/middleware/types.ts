/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Middleware } from '@orpc/server';
import type { Context } from '@orpc/server';
import type { ApiContext } from '$lib/api/context';

/**
 * A middleware that can be attached to any procedure.
 *
 * oRPC's `Middleware` type is contravariant in its input type, so a middleware
 * declared with a concrete input type cannot be attached to a procedure whose
 * schema is not known at the point of declaration. `unknown` for the input and
 * `any` for the output make the middleware attachable everywhere while still
 * letting the procedure's own types flow through.
 */
export type AnyMiddleware<TOutContext extends Context = ApiContext> = Middleware<
  ApiContext,
  TOutContext,
  unknown,
  any,
  any,
  any
>;
