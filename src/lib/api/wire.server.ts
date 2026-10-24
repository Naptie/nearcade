import type { z } from 'zod';
import { toPlainArray, toPlainObject } from '$lib/utils';

/**
 * Hand a MongoDB document to the oRPC layer.
 *
 * oRPC validates a procedure's output in the same direction it parses a
 * request body, so a handler returns the *plain* document — the one whose
 * dates are ISO strings — and the contract turns it into the response body.
 * `toPlainObject` / `toPlainArray` produce exactly that at run time; the
 * assertion lines the type up with the contract's input type.
 *
 * It is one call because the two-step form (`toWire(schema, toPlainObject(x))`)
 * asks the caller to know whether the document is an object or an array. The
 * plainifiers recurse, so one call covers a document with nested arrays and
 * documents alike.
 *
 * The module is server-only: it reaches into the Mongo-shaped helpers, which
 * the browser bundle must not carry. The type-only counterpart for a value
 * that is already plain is `toWire` in `./errors`.
 */
export const toPlainWire = <Schema extends z.ZodTypeAny>(
  schema: Schema,
  doc: unknown
): z.input<Schema> => {
  const plain = Array.isArray(doc)
    ? toPlainArray(doc as Array<Record<string, unknown>>)
    : toPlainObject(doc as Record<string, unknown>);
  return plain as unknown as z.input<Schema>;
};
