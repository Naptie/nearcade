import type { ZodTypeAny } from 'zod';
import type {
  ZodOpenApiOperationObject,
  ZodOpenApiPathItemObject,
  ZodOpenApiRequestBodyObject,
  ZodOpenApiResponseObject
} from 'zod-openapi';
import { bilingual, successResponseSchema } from './common';

export type ApiRouteDefinition = {
  pathItem: ZodOpenApiPathItemObject;
};

export const defineOpenApiRoute = (pathItem: ZodOpenApiPathItemObject): ApiRouteDefinition => ({
  pathItem
});

export const asComponent = <Schema extends ZodTypeAny>(schema: Schema, id: string) =>
  schema.meta({ id });

export const jsonContent = <Schema extends ZodTypeAny>(schema: Schema) => ({
  'application/json': {
    schema
  }
});

export const jsonRequestBody = <Schema extends ZodTypeAny>(
  schema: Schema,
  required = true
): ZodOpenApiRequestBodyObject => ({
  required,
  content: jsonContent(schema)
});

export const jsonResponse = <Schema extends ZodTypeAny>(
  description: string,
  schema: Schema
): ZodOpenApiResponseObject => ({
  description,
  content: jsonContent(schema)
});

export const bearerAuth = [{ bearerAuth: [] }] satisfies NonNullable<
  ZodOpenApiOperationObject['security']
>;

/** OAuth 2.1 security requirement — pass the scopes needed for the operation. */
export const oauth2Auth = (...scopes: string[]) =>
  [{ oauth2: scopes }] satisfies NonNullable<ZodOpenApiOperationObject['security']>;

/** Combined security: session cookie OR OAuth 2.1 Bearer token. */
export const sessionOrOAuth2 = (...scopes: string[]) =>
  [{}, { oauth2: scopes }] satisfies NonNullable<ZodOpenApiOperationObject['security']>;

export const successJsonResponse = (description = bilingual('成功', 'Success')) =>
  jsonResponse(description, successResponseSchema);
