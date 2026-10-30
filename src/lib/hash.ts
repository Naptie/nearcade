/**
 * SHA-256 digest of a string, lowercase hex.
 */
import { createHash } from 'node:crypto';

export const sha256Hex = (input: string): string =>
  createHash('sha256').update(input, 'utf8').digest('hex');
