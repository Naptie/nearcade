import type { z } from 'zod';
import { RADIUS_OPTIONS } from '$lib/constants';
import { NOTIFICATION_TYPES } from '$lib/schemas/common';
import type {
  queueMemberSchema,
  queuePositionSchema,
  queueRecordSchema,
  queueStatusSchema,
  shopChangelogActionSchema,
  shopDeleteRequestSchema
} from '$lib/schemas/shops';
import type { postSchema, postVoteSchema } from '$lib/schemas/posts';
import type {
  attendanceRecordSchema,
  attendanceRegistrationSchema,
  attendanceReportRecordSchema
} from '$lib/schemas/attendance';
import type { AttendanceUser, Shop } from '$lib/types';

/**
 * Server-only types.
 *
 * The front end does not need these: they describe what the API layer reads
 * from MongoDB and Redis, and they are only ever used by server code. They
 * live here — in a `.server.ts` module, so SvelteKit refuses to let a client
 * import them — instead of in `$lib/types`, which is the shared bag the
 * browser bundle pulls from.
 */

// ── Attendance ─────────────────────────────────────────────────────────────
// Storage shapes, derived from `$lib/schemas/attendance` so the record types
// and the schemas cannot drift.

export type AttendanceRecord = z.infer<typeof attendanceRecordSchema>;

export type AttendanceReportRecord = z.infer<typeof attendanceReportRecordSchema>;

/** Attendance registration token stored in Redis */
export type AttendanceRegistration = z.infer<typeof attendanceRegistrationSchema>;

// ── Posts ──────────────────────────────────────────────────────────────────

export type Post = z.infer<typeof postSchema>;

export type PostVote = z.infer<typeof postVoteSchema>;

// ── Shop delete requests ───────────────────────────────────────────────────

export type ShopDeleteRequest = z.infer<typeof shopDeleteRequestSchema>;

export type ShopDeleteRequestVoteSummary = {
  favorVotes: number;
  againstVotes: number;
  userVote?: 'favor' | 'against' | null;
};

// ── Queues ─────────────────────────────────────────────────────────────────
// Storage shapes, derived from `$lib/schemas/shops` (beside the queue wire
// schemas they belong with).

export type QueueStatus = z.infer<typeof queueStatusSchema>;

/** Queue member (player slot) */
export type QueueMember = z.infer<typeof queueMemberSchema>;

/** Queue position (can have multiple players for multi-seat games) */
export type QueuePosition = z.infer<typeof queuePositionSchema>;

/** Queue record for a specific game in a shop */
export type QueueRecord = z.infer<typeof queueRecordSchema>;

// ── Misc ───────────────────────────────────────────────────────────────────

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type RadiusFilter = (typeof RADIUS_OPTIONS)[number];

export type ShopChangelogAction = z.infer<typeof shopChangelogActionSchema>;

/** Extended Shop type with attendance data */
export interface ShopWithAttendance extends Shop {
  totalAttendance?: number;
  currentReportedAttendance?: {
    reportedAt: string | Date;
    reportedBy: AttendanceUser;
    comment: string | null;
  } | null;
  isInAttendance?: boolean;
}
