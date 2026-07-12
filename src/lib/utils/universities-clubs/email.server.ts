import { nanoid } from 'nanoid';
import type { User } from '$lib/auth/types';
import mongo from '$lib/db/index.server';
import redis, { ensureConnected } from '$lib/db/redis.server';
import { sendStudentVerificationLinkEmail } from '$lib/auth/email.server';
import type { University, UniversityMember } from '$lib/types';
import { updateUserType } from '$lib/utils';

export const STUDENT_EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24;
export const STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM = 'studentEmailVerified';
export const STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM = 'studentEmailError';

export type StudentEmailVerificationError =
  'already_verified' | 'domain_mismatch' | 'invalid_or_expired' | 'underconfigured_university';

export type PendingStudentEmailVerification = {
  token: string;
  email: string;
  expiresAt: string;
};

type StudentVerificationTokenPayload = {
  userId: string;
  universityId: string;
  email: string;
};

const getPendingVerificationKey = (universityId: string, userId: string) =>
  `nearcade:ssv:pending:${universityId}:${userId}`;

const getVerificationTokenKey = (token: string) => `nearcade:ssv:token:${token}`;

function normalizeStudentEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isDomainMatch(actualDomain: string, expectedDomain: string): boolean {
  const normalizedActualDomain = actualDomain.trim().toLowerCase();
  const normalizedExpectedDomain = expectedDomain.trim().toLowerCase();

  return (
    normalizedActualDomain === normalizedExpectedDomain ||
    normalizedActualDomain.endsWith(`.${normalizedExpectedDomain}`)
  );
}

function parseRedisJson<T>(value: string | null): T | null {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

export function getExpectedStudentEmailDomain(website?: string | null): string | null {
  try {
    const hostname = new URL(website || '').hostname.trim().toLowerCase();
    const parts = hostname.split('.');
    return parts.length > 2 ? parts.slice(1).join('.') : hostname;
  } catch {
    return null;
  }
}

export function matchesStudentEmailDomain(email: string, expectedDomain: string): boolean {
  const normalizedEmail = normalizeStudentEmail(email);
  const atIndex = normalizedEmail.lastIndexOf('@');

  if (atIndex <= 0 || atIndex === normalizedEmail.length - 1) {
    return false;
  }

  return isDomainMatch(normalizedEmail.slice(atIndex + 1), expectedDomain);
}

export async function getPendingStudentEmailVerification(
  universityId: string,
  userId: string
): Promise<PendingStudentEmailVerification | null> {
  await ensureConnected();
  const key = getPendingVerificationKey(universityId, userId);
  const pendingVerification = parseRedisJson<PendingStudentEmailVerification>(await redis.get(key));

  if (!pendingVerification) {
    return null;
  }

  if (!pendingVerification.token || !pendingVerification.email || !pendingVerification.expiresAt) {
    await redis.del(key);
    return null;
  }

  return pendingVerification;
}

export async function createStudentEmailVerificationRequest({
  user,
  university,
  email,
  verificationBaseUrl,
  request
}: {
  user: User;
  university: Pick<University, 'id' | 'name' | 'website'>;
  email: string;
  verificationBaseUrl: string;
  request?: Request;
}): Promise<
  | {
      ok: true;
      pendingVerification: PendingStudentEmailVerification;
    }
  | {
      ok: false;
      error: StudentEmailVerificationError;
    }
> {
  const normalizedEmail = normalizeStudentEmail(email);
  const expectedDomain = getExpectedStudentEmailDomain(university.website);

  if (!expectedDomain) {
    return { ok: false, error: 'underconfigured_university' };
  }

  if (!matchesStudentEmailDomain(normalizedEmail, expectedDomain)) {
    return { ok: false, error: 'domain_mismatch' };
  }

  await ensureConnected();

  const db = mongo.db();
  const universityMembersCollection = db.collection<UniversityMember>('university_members');
  const existingVerification = await universityMembersCollection.findOne({
    verificationEmail: normalizedEmail
  });

  if (
    existingVerification &&
    (existingVerification.userId !== user.id || existingVerification.universityId !== university.id)
  ) {
    return { ok: false, error: 'already_verified' };
  }

  const existingPendingVerification = await getPendingStudentEmailVerification(
    university.id,
    user.id
  );
  const token = nanoid(48);
  const pendingVerification = {
    token,
    email: normalizedEmail,
    expiresAt: new Date(Date.now() + STUDENT_EMAIL_VERIFICATION_TTL_SECONDS * 1000).toISOString()
  };
  const verificationUrl = new URL(verificationBaseUrl);
  verificationUrl.searchParams.set('token', token);

  try {
    await Promise.all([
      redis.set(
        getPendingVerificationKey(university.id, user.id),
        JSON.stringify(pendingVerification),
        {
          EX: STUDENT_EMAIL_VERIFICATION_TTL_SECONDS
        }
      ),
      redis.set(
        getVerificationTokenKey(token),
        JSON.stringify({
          userId: user.id,
          universityId: university.id,
          email: normalizedEmail
        } satisfies StudentVerificationTokenPayload),
        {
          EX: STUDENT_EMAIL_VERIFICATION_TTL_SECONDS
        }
      ),
      ...(existingPendingVerification?.token
        ? [redis.del(getVerificationTokenKey(existingPendingVerification.token))]
        : [])
    ]);

    await sendStudentVerificationLinkEmail({
      user: {
        email: user.email ?? normalizedEmail,
        name: user.name,
        displayName: user.displayName,
        image: user.image
      },
      universityName: university.name,
      email: normalizedEmail,
      url: verificationUrl.toString(),
      request
    });
  } catch (error) {
    await Promise.all([
      redis.del(getPendingVerificationKey(university.id, user.id)),
      redis.del(getVerificationTokenKey(token))
    ]);
    throw error;
  }

  return {
    ok: true,
    pendingVerification
  };
}

export async function consumeStudentEmailVerificationToken({
  token,
  user,
  university
}: {
  token: string;
  user: User;
  university: Pick<University, 'id' | 'website'>;
}): Promise<
  | {
      ok: true;
    }
  | {
      ok: false;
      error: StudentEmailVerificationError;
    }
> {
  await ensureConnected();

  const payload = parseRedisJson<StudentVerificationTokenPayload>(
    await redis.get(getVerificationTokenKey(token))
  );

  if (!payload || payload.userId !== user.id || payload.universityId !== university.id) {
    return { ok: false, error: 'invalid_or_expired' };
  }

  const expectedDomain = getExpectedStudentEmailDomain(university.website);
  if (!expectedDomain) {
    return { ok: false, error: 'underconfigured_university' };
  }

  if (!matchesStudentEmailDomain(payload.email, expectedDomain)) {
    return { ok: false, error: 'domain_mismatch' };
  }

  const db = mongo.db();
  const universityMembersCollection = db.collection<UniversityMember>('university_members');
  const existingVerification = await universityMembersCollection.findOne({
    verificationEmail: payload.email
  });

  if (
    existingVerification &&
    (existingVerification.userId !== user.id || existingVerification.universityId !== university.id)
  ) {
    return { ok: false, error: 'already_verified' };
  }

  const existingMembership = await universityMembersCollection.findOne({
    universityId: university.id,
    userId: user.id
  });
  const verifiedAt = new Date();

  if (existingMembership) {
    await universityMembersCollection.updateOne(
      { universityId: university.id, userId: user.id },
      {
        $set: {
          verificationEmail: payload.email,
          verifiedAt
        }
      }
    );
  } else {
    const memberCount = await universityMembersCollection.countDocuments({
      universityId: university.id
    });

    await universityMembersCollection.insertOne({
      id: nanoid(),
      universityId: university.id,
      userId: user.id,
      memberType: memberCount < 2 ? 'admin' : 'student',
      verificationEmail: payload.email,
      verifiedAt,
      joinedAt: verifiedAt
    });

    await updateUserType(user.id, mongo);
  }

  await Promise.all([
    redis.del(getVerificationTokenKey(token)),
    redis.del(getPendingVerificationKey(university.id, user.id))
  ]);

  return { ok: true };
}
