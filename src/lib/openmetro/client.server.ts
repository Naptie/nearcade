import { env } from '$env/dynamic/public';
import { createClient } from 'openmetro-client';

/** Default live API — used when `PUBLIC_OPENMETRO_API_BASE` is unset/empty. */
export const DEFAULT_OPENMETRO_API_BASE = 'https://openmetro.phi.zone';

export const getOpenMetroApiBase = (): string =>
  env.PUBLIC_OPENMETRO_API_BASE?.trim() || DEFAULT_OPENMETRO_API_BASE;

export const createOpenMetroClient = (baseUrl: string = getOpenMetroApiBase()) =>
  createClient(baseUrl);

export type OpenMetroClient = ReturnType<typeof createOpenMetroClient>;
