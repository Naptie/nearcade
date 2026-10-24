import { ZodError } from 'zod';

/**
 * Render a Zod error as a single readable line.
 *
 * It is a pure function over the error, so it lives here rather than in
 * `validation.server.ts`: the API layer's error helpers are part of the
 * contract, and the contract is loaded in the browser.
 */export const formatZodError = (err: ZodError) =>
  err.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ');
