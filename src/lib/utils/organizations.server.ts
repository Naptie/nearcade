type PostReadabilityValue = 0 | 1 | 2;
type PostWritabilityValue = 0 | 1 | 2 | 3;

const stripNullishFields = <T extends Record<string, unknown>>(
  value: T,
  keys: readonly string[]
) => {
  const normalized = { ...value };

  for (const key of keys) {
    if (normalized[key] === null || normalized[key] === undefined) {
      delete normalized[key];
    }
  }

  return normalized;
};

export const omitUndefinedFields = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== undefined)
  ) as Partial<T>;

export const buildNullishUnsetUpdate = <T extends Record<string, unknown>>(
  fields: T
): {
  $set?: Partial<T>;
  $unset?: Partial<Record<keyof T, ''>>;
} => {
  const $set = Object.fromEntries(
    Object.entries(fields).filter(
      ([, fieldValue]) => fieldValue !== null && fieldValue !== undefined
    )
  ) as Partial<T>;
  const $unset = Object.fromEntries(
    Object.entries(fields)
      .filter(([, fieldValue]) => fieldValue === null || fieldValue === undefined)
      .map(([fieldName]) => [fieldName, '' as const])
  ) as Partial<Record<keyof T, ''>>;

  return {
    ...(Object.keys($set).length > 0 ? { $set } : {}),
    ...(Object.keys($unset).length > 0 ? { $unset } : {})
  };
};

export const parsePostReadability = (value: FormDataEntryValue | null): PostReadabilityValue | null => {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (parsed === 0 || parsed === 1 || parsed === 2) {
    return parsed;
  }

  return null;
};

export const parsePostWritability = (value: FormDataEntryValue | null): PostWritabilityValue | null => {
  const parsed = Number.parseInt(String(value ?? ''), 10);

  if (parsed === 0 || parsed === 1 || parsed === 2 || parsed === 3) {
    return parsed;
  }

  return null;
};

const optionalCampusFieldNames = ['createdAt', 'updatedAt', 'createdBy', 'updatedBy'] as const;

const optionalUniversityFieldNames = [
  'slug',
  'backgroundColor',
  'avatarUrl',
  'avatarImageId',
  'description',
  'website',
  'postReadability',
  'postWritability',
  'studentsCount',
  'frequentingArcades',
  'clubsCount',
  'createdAt',
  'updatedAt'
] as const;

const optionalClubFieldNames = [
  'slug',
  'description',
  'avatarUrl',
  'avatarImageId',
  'backgroundColor',
  'website',
  'membersCount',
  'createdAt',
  'updatedAt',
  'createdBy'
] as const;

export const normalizeUniversityDocument = <
  T extends Record<string, unknown> & { campuses?: unknown }
>(
  university: T
) => {
  const normalized = stripNullishFields(university, optionalUniversityFieldNames);

  if (Array.isArray(normalized.campuses)) {
    normalized.campuses = normalized.campuses.map((campus) =>
      campus && typeof campus === 'object'
        ? stripNullishFields(campus as Record<string, unknown>, optionalCampusFieldNames)
        : campus
    ) as T['campuses'];
  }

  return normalized;
};

export const normalizeClubDocument = <T extends Record<string, unknown>>(club: T) =>
  stripNullishFields(club, optionalClubFieldNames);
