/**
 * Validate stored documents against the storage schemas.
 *
 * `$lib/schemas/attendance.ts` and `$lib/schemas/queues.ts` describe what the
 * attendance and queue records are supposed to look like, but nothing calls
 * `.parse()` on them: the write paths still insert whatever they are handed.
 * Before any of that can be tightened, the collections have to be checked
 * against the schemas, because a document written before the schema existed is
 * exactly the kind of thing validation would start rejecting.
 *
 * This is read-only. It never writes.
 *
 * Usage:
 *   pnpm exec tsx ./scripts/check-storage-records.ts            # every document
 *   pnpm exec tsx ./scripts/check-storage-records.ts --limit 500
 *   MONGODB_URI=... pnpm exec tsx ./scripts/check-storage-records.ts
 */
import { config } from 'dotenv';
import { MongoClient } from 'mongodb';
import type { z } from 'zod';

config({ path: process.cwd() + '/.env' });

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg === -1 ? 0 : Number(process.argv[limitArg + 1] ?? 0);

/** Field names a schema declares, for spotting undeclared extras. */
const declaredKeys = (schema: z.ZodTypeAny): Set<string> =>
  new Set(Object.keys((schema as unknown as { shape: Record<string, unknown> }).shape ?? {}));

interface Report {
  collection: string;
  total: number;
  scanned: number;
  failed: number;
  extras: Map<string, number>;
  issues: Map<string, number>;
  examples: { id: string; issues: string[] }[];
}

async function check(
  db: import('mongodb').Db,
  collection: string,
  schema: z.ZodTypeAny
): Promise<Report> {
  const col = db.collection(collection);
  const total = await col.estimatedDocumentCount();
  const cursor = col.find({});
  if (LIMIT > 0) cursor.limit(LIMIT);

  const known = declaredKeys(schema);
  const report: Report = {
    collection,
    total,
    scanned: 0,
    failed: 0,
    extras: new Map(),
    issues: new Map(),
    examples: []
  };

  for await (const doc of cursor) {
    report.scanned++;
    for (const key of Object.keys(doc)) {
      if (!known.has(key)) report.extras.set(key, (report.extras.get(key) ?? 0) + 1);
    }
    const result = schema.safeParse(doc);
    if (!result.success) {
      report.failed++;
      for (const i of result.error.issues) {
        const key = `${i.path.join('.') || '(root)'}: ${i.message}`;
        report.issues.set(key, (report.issues.get(key) ?? 0) + 1);
      }
      if (report.examples.length < 3) {
        report.examples.push({
          id: String(doc._id ?? '(no _id)'),
          issues: result.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
        });
      }
    }
  }
  return report;
}

function print(r: Report) {
  const pct = r.scanned ? ((r.failed / r.scanned) * 100).toFixed(2) : '0.00';
  const mark = r.failed === 0 ? 'OK  ' : 'FAIL';
  console.log(
    `  ${mark} ${r.collection.padEnd(20)} total≈${String(r.total).padEnd(8)} scanned=${String(r.scanned).padEnd(8)} invalid=${r.failed} (${pct}%)`
  );
  if (r.extras.size) {
    const top = [...r.extras.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    console.log(`       undeclared fields: ${top.map(([k, v]) => `${k}x${v}`).join(', ')}`);
  }
  if (r.issues.size) {
    console.log('       issue histogram:');
    for (const [k, v] of [...r.issues.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`         ${v} x ${k}`);
    }
  }
  for (const ex of r.examples) {
    console.log(`       e.g. ${ex.id}`);
    for (const i of ex.issues) console.log(`         - ${i}`);
  }
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not set (expected in .env or the environment)');
    process.exit(1);
  }

  const { attendanceRecordSchema, attendanceReportRecordSchema } =
    await import('../src/lib/schemas/attendance');
  const {
    queueRecordSchema,
    shopDocumentSchema,
    shopChangelogEntrySchema,
    shopDeleteRequestSchema,
    shopPhotoSchema
  } = await import('../src/lib/schemas/shops');
  const {
    clubSchema,
    clubMemberSchema,
    organizationChangelogEntrySchema,
    universitySchema,
    universityMemberSchema
  } = await import('../src/lib/schemas/organizations');
  const { postSchema, postVoteSchema } = await import('../src/lib/schemas/posts');
  const { commentSchema, commentVoteSchema } = await import('../src/lib/schemas/comments');
  const { imageAssetSchema } = await import('../src/lib/schemas/images');

  /**
   * Every collection that is typed by a schema (`collection<X>('name')`), so a
   * schema that misdescribes the stored documents shows up here.
   */
  const targets: [string, z.ZodTypeAny][] = [
    ['attendances', attendanceRecordSchema],
    ['attendance_reports', attendanceReportRecordSchema],
    ['queues', queueRecordSchema],
    ['shops', shopDocumentSchema],
    ['shop_changelog', shopChangelogEntrySchema],
    ['shop_delete_requests', shopDeleteRequestSchema],
    ['images', imageAssetSchema],
    ['clubs', clubSchema],
    ['universities', universitySchema],
    ['club_members', clubMemberSchema],
    ['university_members', universityMemberSchema],
    ['changelog', organizationChangelogEntrySchema],
    ['posts', postSchema],
    ['post_votes', postVoteSchema],
    ['comments', commentSchema],
    ['comment_votes', commentVoteSchema],
    ['shop_photos', shopPhotoSchema]
  ];

  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  try {
    const db = client.db(process.env.MONGODB_DB || process.env.DB_NAME || undefined);
    console.log(
      `database: ${db.databaseName}${LIMIT ? `  (limit ${LIMIT} per collection)` : ''}\n`
    );

    const reports: Report[] = [];
    for (const [name, schema] of targets) reports.push(await check(db, name, schema));
    for (const r of reports) print(r);

    const bad = reports.reduce((n, r) => n + r.failed, 0);
    const scanned = reports.reduce((n, r) => n + r.scanned, 0);
    console.log(
      `\nscanned ${scanned} document(s) across ${reports.length} collection(s); ` +
        (bad === 0 ? 'all satisfy their schema.' : `${bad} do NOT satisfy their schema.`)
    );
  } finally {
    await client.close();
  }
}

await main();
