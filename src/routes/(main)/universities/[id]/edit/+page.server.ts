import { error, fail, isHttpError, isRedirect, redirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import { PostReadability, PostWritability, type University } from '$lib/types';
import { checkUniversityPermission, toPlainObject } from '$lib/utils';
import { loginRedirect } from '$lib/utils/scoped';
import { logUniversityChanges } from '$lib/utils/changelog.server';
import { resolve } from '$app/paths';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';
import meili from '$lib/db/meili.server';

export const load: PageServerLoad = async ({ params, url, parent }) => {
  const { id } = params;

  const { session } = await parent();
  const user = session?.user;

  if (!user) {
    throw loginRedirect(url);
  }

  try {
    const db = mongo.db();
    const universitiesCollection = db.collection('universities');

    // Try to find university by ID first, then by slug
    const university = (await universitiesCollection.findOne(
      {
        $or: [{ id }, { slug: id }]
      },
      { projection: { _id: 0 } }
    )) as unknown as University | null;

    if (!university) {
      error(404, m.university_not_found());
    }

    // Check permissions for the current user
    const userPermissions = await checkUniversityPermission(user, university, mongo);

    if (!userPermissions.canEdit) {
      error(403, m.privilege_insufficient());
    }

    return {
      university,
      user,
      userPermissions
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
  updateUniversity: async ({ request, locals, params }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    const user = session.user;
    let { id } = params;

    try {
      const formData = await request.formData();
      const name = formData.get('name') as string;
      const description = formData.get('description') as string;
      const website = formData.get('website') as string;
      const avatarUrl = formData.get('avatarUrl') as string;
      const backgroundColor = formData.get('backgroundColor') as string;
      const useCustomBackgroundColor = formData.get('useCustomBackgroundColor') === 'true';
      const slug = formData.get('slug') as string;
      const type = formData.get('type') as string;
      const majorCategory = formData.get('majorCategory') as string;
      const natureOfRunning = formData.get('natureOfRunning') as string;
      const affiliation = formData.get('affiliation') as string;
      const is985 = formData.get('is985') === 'on';
      const is211 = formData.get('is211') === 'on';
      const isDoubleFirstClass = formData.get('isDoubleFirstClass') === 'on';
      const postReadability = parseInt(formData.get('postReadability') as string);
      const postWritability = parseInt(formData.get('postWritability') as string);

      // Check permissions using new system
      const permissions = await checkUniversityPermission(user, id, mongo);
      if (!permissions.canEdit) {
        return fail(403, { message: m.privilege_insufficient() });
      }

      // Validation
      const errors: string[] = [];

      if (!name || name.trim().length === 0) {
        errors.push('University name is required');
      } else if (name.trim().length > 200) {
        errors.push('University name is too long (maximum 200 characters)');
      }

      if (!type || type.trim().length === 0) {
        errors.push('University type is required');
      }

      if (!affiliation || affiliation.trim().length === 0) {
        errors.push('Affiliation is required');
      }

      if (description && description.length > 2000) {
        errors.push('Description is too long (maximum 2000 characters)');
      }

      if (website && website.trim().length > 0) {
        try {
          new URL(website.trim());
        } catch {
          errors.push('Please enter a valid website URL');
        }
      }

      if (avatarUrl && avatarUrl.trim().length > 0) {
        try {
          new URL(avatarUrl.trim());
        } catch {
          errors.push('Please enter a valid avatar URL');
        }
      }

      if (backgroundColor && backgroundColor.trim().length > 0 && useCustomBackgroundColor) {
        const colorPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
        if (!colorPattern.test(backgroundColor.trim())) {
          errors.push('Please enter a valid color in hex format (e.g., #3b82f6)');
        }
      }

      if (postReadability === PostReadability.CLUB_MEMBERS) {
        errors.push('Invalid post readability setting');
      }

      if (postWritability === PostWritability.CLUB_MEMBERS) {
        errors.push('Invalid post writability setting');
      }

      if (errors.length > 0) {
        return fail(400, {
          message: m.validation_error(),
          errors,
          formData: {
            name: name?.trim() || '',
            description: description?.trim() || '',
            website: website?.trim() || '',
            avatarUrl: avatarUrl?.trim() || '',
            backgroundColor: backgroundColor?.trim() || '',
            useCustomBackgroundColor,
            slug: slug?.trim() || '',
            type: type?.trim() || '',
            majorCategory: majorCategory?.trim() || '',
            natureOfRunning: natureOfRunning?.trim() || '',
            affiliation: affiliation?.trim() || '',
            is985,
            is211,
            isDoubleFirstClass,
            postReadability,
            postWritability
          }
        });
      }

      const db = mongo.db();
      const universitiesCollection = db.collection('universities');

      // Get current university data for changelog comparison
      const currentUniversity = (await universitiesCollection.findOne(
        { $or: [{ id }, { slug: id }] },
        { projection: { _id: 0 } }
      )) as unknown as University | null;

      if (!currentUniversity) {
        return fail(404, { message: m.university_not_found() });
      }

      id = currentUniversity.id;

      // Check if slug is already taken (if provided and different from current)
      if (slug && slug.trim().length > 0) {
        const existingUniversity = await universitiesCollection.findOne({
          slug: slug.trim(),
          id: { $ne: id }
        });

        if (existingUniversity) {
          return fail(400, { message: m.this_slug_is_already_taken() });
        }
      }

      const updateData: Partial<University> & { updatedAt: Date } = {
        name: name.trim(),
        type: type.trim(),
        affiliation: affiliation.trim(),
        description: description?.trim() || undefined,
        website: website?.trim() || undefined,
        avatarUrl: avatarUrl?.trim() || undefined,
        slug: slug?.trim() || undefined,
        majorCategory: majorCategory?.trim() || null,
        natureOfRunning: natureOfRunning?.trim() || null,
        is985,
        is211,
        isDoubleFirstClass,
        postReadability,
        postWritability,
        updatedAt: new Date()
      };

      // Only update backgroundColor if user chose to set a custom color
      if (useCustomBackgroundColor && backgroundColor && backgroundColor.trim().length > 0) {
        updateData.backgroundColor = backgroundColor.trim();
      } else {
        updateData.backgroundColor = undefined; // Reset if not using custom color
      }

      // Log changes to changelog
      await logUniversityChanges(mongo, id, currentUniversity, updateData, {
        id: user.id!,
        name: user.name,
        image: user.image
      });

      await universitiesCollection.updateOne({ id }, { $set: updateData });
      await meili
        .index<University>('universities')
        .updateDocuments([toPlainObject({ ...currentUniversity, ...updateData })], {
          primaryKey: 'id'
        });

      redirect(302, resolve('/(main)/universities/[id]', { id }));
    } catch (err) {
      if (err && (isHttpError(err) || isRedirect(err))) {
        throw err;
      }
      console.error('Error updating university:', err);
      return fail(500, { message: m.failed_to_update_university() });
    }
  }
};
