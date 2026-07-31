import { env } from '$env/dynamic/private';
import type { University, UniversityV2 } from '$lib/types';
import type { Db, Document } from 'mongodb';

export const LEGACY_UNIVERSITIES_COLLECTION = 'universities';
export const V2_UNIVERSITIES_COLLECTION = 'universities_v2';

export const getUniversitiesCollectionName = () =>
  env.UNIVERSITIES_COLLECTION === V2_UNIVERSITIES_COLLECTION
    ? V2_UNIVERSITIES_COLLECTION
    : LEGACY_UNIVERSITIES_COLLECTION;

export const isUniversityV2Enabled = () =>
  getUniversitiesCollectionName() === V2_UNIVERSITIES_COLLECTION;

export const getUniversitiesCollection = (db: Db) =>
  db.collection<Document>(getUniversitiesCollectionName());

const present = <T>(value: T | null | undefined): value is T =>
  value !== null && value !== undefined;

const campusAddressParts = (general: string[]) => ({
  province: general[1] || general[0] || '',
  city: general[2] || general[1] || general[0] || '',
  district: general[3] || null
});

export const toUniversityView = (document: Document): University => {
  if (!isUniversityV2Enabled()) return document as University;

  const university = document as UniversityV2;
  const profile = university.profile;
  const community = university.community;

  return {
    ...(university._id ? { _id: university._id } : {}),
    id: university.id,
    name: university.name,
    ...(university.slug ? { slug: university.slug } : {}),
    type: university.classification.academicLevel || 'University',
    majorCategory: university.classification.discipline,
    natureOfRunning: university.classification.ownership,
    affiliation: university.classification.affiliation || '',
    is985: university.china?.is985 ?? null,
    is211: university.china?.is211 ?? null,
    isDoubleFirstClass: university.china?.isDoubleFirstClass ?? null,
    campuses: university.campuses.map((campus) => ({
      id: campus.id,
      name: campus.name,
      ...campusAddressParts(campus.address.general),
      address: campus.address.detailed || campus.address.general.join(', '),
      location: campus.location
    })),
    ...(present(profile.backgroundColor) ? { backgroundColor: profile.backgroundColor } : {}),
    ...(present(profile.avatarUrl) ? { avatarUrl: profile.avatarUrl } : {}),
    ...(present(profile.avatarImageId) ? { avatarImageId: profile.avatarImageId } : {}),
    ...(present(profile.description) ? { description: profile.description } : {}),
    ...(present(university.website) ? { website: university.website } : {}),
    ...(present(community.postReadability) ? { postReadability: community.postReadability } : {}),
    ...(present(community.postWritability) ? { postWritability: community.postWritability } : {}),
    studentsCount: community.studentsCount,
    frequentingArcades: community.frequentingArcades,
    clubsCount: community.clubsCount,
    ...(present(university.updatedAt) ? { updatedAt: university.updatedAt } : {})
  };
};

export const findUniversityByIdOrSlug = async (db: Db, idOrSlug: string) => {
  const collection = getUniversitiesCollection(db);
  const document = await collection.findOne({
    $or: [{ id: idOrSlug }, { slug: idOrSlug }]
  });
  return document ? toUniversityView(document) : null;
};

export const universitySearchFields = () =>
  isUniversityV2Enabled()
    ? [
        'name',
        'slug',
        'names.translations',
        'names.native',
        'names.english',
        'names.aliases',
        'campuses.name',
        'campuses.address.general',
        'campuses.address.detailed'
      ]
    : ['name', 'slug', 'campuses.name'];
