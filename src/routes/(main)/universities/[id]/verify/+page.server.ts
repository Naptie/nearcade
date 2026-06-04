import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { University } from '$lib/types';
import { checkUniversityPermission } from '$lib/utils';
import { loginRedirect } from '$lib/utils/scoped';
import { resolve } from '$app/paths';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import {
  consumeStudentEmailVerificationToken,
  createStudentEmailVerificationRequest,
  getExpectedStudentEmailDomain,
  getPendingStudentEmailVerification,
  STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM,
  STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM,
  type StudentEmailVerificationError
} from '$lib/utils/universities-clubs/email.server';

const getVerificationPagePath = (university: Pick<University, 'id' | 'slug'>) =>
  resolve('/(main)/universities/[id]/verify', { id: university.slug || university.id });

const getUniversityPath = (university: Pick<University, 'id' | 'slug'>) =>
  resolve('/(main)/universities/[id]', { id: university.slug || university.id });

function withVerificationStatus(
  currentUrl: URL,
  status:
    | {
        success: true;
      }
    | {
        success: false;
        error: StudentEmailVerificationError;
      }
) {
  const nextUrl = new URL(currentUrl);
  nextUrl.searchParams.delete('token');
  nextUrl.searchParams.delete(STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM);
  nextUrl.searchParams.delete(STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM);

  if (status.success) {
    nextUrl.searchParams.set(STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM, '1');
  } else {
    nextUrl.searchParams.set(STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM, status.error);
  }

  return nextUrl.toString();
}

function getStudentVerificationErrorMessage(errorCode: StudentEmailVerificationError) {
  switch (errorCode) {
    case 'already_verified':
      return m.already_verified_description();
    case 'domain_mismatch':
      return m.domain_mismatch_description();
    case 'underconfigured_university':
      return m.underconfigured_university_description();
    case 'invalid_or_expired':
    default:
      return m.student_email_verification_error_invalid_or_expired();
  }
}

async function getUniversity(id: string) {
  const db = mongo.db();
  const universitiesCollection = db.collection('universities');

  let university = (await universitiesCollection.findOne(
    {
      id
    },
    { projection: { _id: 0 } }
  )) as University | null;

  if (!university) {
    university = (await universitiesCollection.findOne(
      {
        slug: id
      },
      { projection: { _id: 0 } }
    )) as University | null;
  }

  if (!university) {
    error(404, m.university_not_found());
  }

  return university;
}

export const load: PageServerLoad = async ({ params, url, parent }) => {
  const { id } = params;

  const { session } = await parent();
  const user = session?.user;

  if (!user) {
    throw loginRedirect(url);
  }

  try {
    const university = await getUniversity(id);
    const token = url.searchParams.get('token');

    if (token) {
      const verificationResult = await consumeStudentEmailVerificationToken({
        token,
        user,
        university
      });

      if (verificationResult.ok) {
        redirect(303, withVerificationStatus(url, { success: true }));
      }

      redirect(
        303,
        withVerificationStatus(url, {
          success: false,
          error: verificationResult.error
        })
      );
    }

    // Check permissions for the current user
    const { verificationEmail, verifiedAt, ...userPermissions } = await checkUniversityPermission(
      user,
      university,
      mongo
    );

    if (!userPermissions.canJoin) {
      redirect(302, getUniversityPath(university));
    }
    const verificationError = url.searchParams.get(
      STUDENT_EMAIL_VERIFICATION_ERROR_QUERY_PARAM
    ) as StudentEmailVerificationError | null;
    const verificationSucceeded =
      url.searchParams.get(STUDENT_EMAIL_VERIFICATION_SUCCESS_QUERY_PARAM) === '1' &&
      !verificationError;
    const pendingVerification = verificationEmail
      ? null
      : await getPendingStudentEmailVerification(university.id, user.id);

    return {
      university,
      user,
      userPermissions,
      expectedEmailDomain: getExpectedStudentEmailDomain(university.website),
      pendingVerification,
      verificationError,
      verificationSucceeded,
      verificationEmail,
      verifiedAt
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading university:', err);
    error(500, m.failed_to_load_university_data());
  }
};

export const actions: Actions = {
  sendVerificationEmail: async ({ request, locals, params, url }) => {
    const user = locals.session?.user;
    if (!user) {
      return fail(401, { message: m.unauthorized() });
    }

    let submittedEmail = '';

    try {
      const university = await getUniversity(params.id);
      const { verificationEmail, verifiedAt, ...userPermissions } = await checkUniversityPermission(
        user,
        university,
        mongo
      );

      if (!userPermissions.canJoin) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      if (verificationEmail && verifiedAt) {
        return fail(400, { message: m.already_verified_description() });
      }

      const formData = await request.formData();
      submittedEmail = String(formData.get('email') ?? '').trim();

      if (!submittedEmail) {
        return fail(400, {
          message: m.validation_error(),
          email: submittedEmail
        });
      }

      const verificationResult = await createStudentEmailVerificationRequest({
        user,
        university,
        email: submittedEmail,
        verificationBaseUrl: new URL(getVerificationPagePath(university), url.origin).toString(),
        request
      });

      if (!verificationResult.ok) {
        return fail(400, {
          message: getStudentVerificationErrorMessage(verificationResult.error),
          email: submittedEmail
        });
      }

      return {
        success: true,
        message: m.student_email_verification_sent(),
        email: verificationResult.pendingVerification.email
      };
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }

      console.error('Error sending student verification email:', err);
      return fail(500, {
        message: m.student_email_verification_error(),
        email: submittedEmail
      });
    }
  }
};
