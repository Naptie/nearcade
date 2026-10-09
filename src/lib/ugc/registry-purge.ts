import type { Collection, Filter } from 'mongodb';
import type { UgcAuditRecord, UgcEntryRecord } from './types';

export interface UgcPurgeResult {
  occurrences: number;
  auditRecords: number;
}

const HASH_BATCH_SIZE = 500;

export const purgeUgcAuditHashesWithoutLiveOccurrences = async (
  entries: Collection<UgcEntryRecord>,
  audits: Collection<UgcAuditRecord>,
  hashes: Iterable<string>,
  options: {
    dryRun?: boolean;
    excludeOccurrenceIds?: readonly string[];
    liveHashes?: ReadonlySet<string>;
  } = {}
): Promise<number> => {
  const uniqueHashes = [...new Set(hashes)];
  let total = 0;
  for (let offset = 0; offset < uniqueHashes.length; offset += HASH_BATCH_SIZE) {
    const batch = uniqueHashes.slice(offset, offset + HASH_BATCH_SIZE);
    let liveHashes: Set<string>;
    if (options.dryRun && options.liveHashes) {
      liveHashes = new Set(batch.filter((hash) => options.liveHashes?.has(hash)));
    } else {
      const filter: Filter<UgcEntryRecord> = {
        hash: { $in: batch },
        auditStatus: { $ne: 'removed' },
        ...(options.excludeOccurrenceIds
          ? { _id: { $nin: [...options.excludeOccurrenceIds] } }
          : {})
      };
      const liveRows = await entries.find(filter, { projection: { hash: 1 } }).toArray();
      liveHashes = new Set(liveRows.map((row) => row.hash));
    }
    const eligible = batch.filter((hash) => !liveHashes.has(hash));
    if (eligible.length === 0) continue;
    if (options.dryRun) {
      total += await audits.countDocuments({ _id: { $in: eligible } });
    } else {
      const result = await audits.deleteMany({ _id: { $in: eligible } });
      total += result.deletedCount;
    }
  }
  return total;
};

export const purgeUgcOccurrences = async (
  entries: Collection<UgcEntryRecord>,
  audits: Collection<UgcAuditRecord>,
  filter: Filter<UgcEntryRecord>,
  options: { dryRun?: boolean; protectModerationRemoved?: boolean } = {}
): Promise<UgcPurgeResult> => {
  const rows = await entries.find(filter, { projection: { _id: 1, hash: 1 } }).toArray();
  return purgeUgcOccurrenceRows(entries, audits, rows, options);
};

export const purgeUgcOccurrenceRows = async (
  entries: Collection<UgcEntryRecord>,
  audits: Collection<UgcAuditRecord>,
  rows: ReadonlyArray<Pick<UgcEntryRecord, '_id' | 'hash'>>,
  options: {
    dryRun?: boolean;
    purgeAuditRecords?: boolean;
    protectModerationRemoved?: boolean;
  } = {}
): Promise<UgcPurgeResult> => {
  if (rows.length === 0) return { occurrences: 0, auditRecords: 0 };

  let occurrences = rows.length;
  if (!options.dryRun) {
    const guards: Filter<UgcEntryRecord>[] = rows.map(({ _id, hash }) => ({
      _id,
      hash,
      ...(options.protectModerationRemoved ? { auditStatus: { $ne: 'removed' } } : {})
    }));
    const result = await entries.deleteMany({ $or: guards });
    occurrences = result.deletedCount;
    if (occurrences === 0) return { occurrences, auditRecords: 0 };
  }

  if (options.purgeAuditRecords === false) {
    return { occurrences, auditRecords: 0 };
  }

  const candidateIds = rows.map((row) => row._id);
  const auditRecords = await purgeUgcAuditHashesWithoutLiveOccurrences(
    entries,
    audits,
    rows.map((row) => row.hash),
    {
      ...options,
      ...(options.dryRun ? { excludeOccurrenceIds: candidateIds } : {})
    }
  );

  return { occurrences, auditRecords };
};
