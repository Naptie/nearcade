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

export const buildNullishUnsetUpdate = (fields: Record<string, unknown>) => {
  const $set = Object.fromEntries(
    Object.entries(fields).filter(
      ([, fieldValue]) => fieldValue !== null && fieldValue !== undefined
    )
  );
  const $unset = Object.fromEntries(
    Object.entries(fields)
      .filter(([, fieldValue]) => fieldValue === null || fieldValue === undefined)
      .map(([fieldName]) => [fieldName, ''])
  );

  return {
    ...(Object.keys($set).length > 0 ? { $set } : {}),
    ...(Object.keys($unset).length > 0 ? { $unset } : {})
  };
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
