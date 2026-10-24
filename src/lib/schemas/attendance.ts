import { z } from 'zod';
import { mongoIdSchema } from './common';

/**
 * Attendance records, as they are *stored*.
 *
 * These are storage shapes, not wire shapes: the timestamps are `Date` objects
 * and the identity is a MongoDB `_id`. They are deliberately not derived from
 * the attendance schemas in `./discover` — those describe the API response,
 * where the same data arrives with ISO strings and a projected id.
 *
 * They exist so `$lib/types/index.server.ts` can derive the record types rather
 * than hand-write them, which is the arrangement `shopDocumentSchema` already
 * has for shops. Nothing calls `.parse()` on them yet: adding validation to the
 * write path is a separate change, because it would start rejecting any
 * malformed document that is already being written today.
 */

/** One game's entry on an attendance record. */
export const attendanceGameEntrySchema = z.object({
  gameId: z.number(),
  name: z.string(),
  version: z.string()
});

/** One visit to a shop by one user. */
export const attendanceRecordSchema = z.object({
  // A real `_id`, not a string: every document in the live `attendances`
  // collection carries an ObjectId. The hand-written interface this replaced
  // said `_id?: string` and was simply wrong about the stored data.
  _id: mongoIdSchema,
  userId: z.string(),
  games: z.array(attendanceGameEntrySchema),
  attendedAt: z.date(),
  leftAt: z.date(),
  shopId: z.number()
});

/** One game's entry on an attendance report. */
export const attendanceReportGameEntrySchema = z.object({
  gameId: z.number(),
  name: z.string(),
  version: z.string(),
  currentAttendances: z.number()
});

/** A user-reported attendance count for a shop. */
export const attendanceReportRecordSchema = z.object({
  _id: mongoIdSchema,
  shopId: z.number(),
  games: z.array(attendanceReportGameEntrySchema),
  comment: z.string().nullable(),
  reportedBy: z.string(),
  reportedAt: z.date()
});

/** An attendance registration token, stored in Redis. */
export const attendanceRegistrationSchema = z.object({
  shopId: z.string(),
  machineId: z.string(),
  slotIndex: z.string(),
  expiresAt: z.string(),
  userId: z.string().optional()
});
