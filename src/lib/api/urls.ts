import { apiOrigin } from './origin';
import { procedurePath, type ContractOperationId } from './routes';

/**
 * The URLs of the API procedures, taken from the contract.
 *
 * A handful of endpoints cannot be called through the typed client: a
 * multipart upload needs the browser's upload-progress events and the
 * server's progress stream, neither of which the client exposes. They still
 * go through the contract — the path is looked up by the procedure's
 * `operationId` and its path parameters are filled in — so a URL can never
 * name an endpoint that does not exist, or spell a path the contract serves
 * differently.
 */

export { procedurePath };

/**
 * The URL of a procedure.
 *
 * The URL points at the REST surface, where the procedure is served under its
 * documented path. A deployment that points the front end at a separate API
 * host keeps working.
 *
 * @param operationId — the procedure's published `operationId`.
 * @param params — the values for the procedure's path parameters.
 * @param query — the query parameters to append.
 */
export const apiUrl = (
  operationId: ContractOperationId,
  params: Record<string, string | number> = {},
  query: Record<string, string | number | null | undefined> = {}
): string => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const path = procedurePath(operationId, params);
  const suffix = search.toString();
  const url = suffix ? `${path}?${suffix}` : path;

  return `${apiOrigin()}${url}`;
};
