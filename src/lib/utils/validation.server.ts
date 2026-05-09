import { error } from '@sveltejs/kit';
import { ZodError, type z } from 'zod';

export const formatZodError = (err: ZodError) =>
  err.issues.map((issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`).join('; ');

export const parseOrError = <Schema extends z.ZodTypeAny>(schema: Schema, value: unknown) => {
  const result = schema.safeParse(value);
  if (!result.success) {
    error(400, formatZodError(result.error));
  }
  return result.data as z.infer<Schema>;
};

export const parseJsonOrError = async <Schema extends z.ZodTypeAny>(
  request: Request,
  schema: Schema,
  invalidJsonMessage = 'Invalid request body'
) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    error(400, invalidJsonMessage);
  }
  return parseOrError(schema, body);
};

export const parseParamsOrError = <Schema extends z.ZodTypeAny>(schema: Schema, params: unknown) =>
  parseOrError(schema, params);

export const parseQueryOrError = <Schema extends z.ZodTypeAny>(schema: Schema, url: URL) =>
  parseOrError(schema, Object.fromEntries(url.searchParams));
