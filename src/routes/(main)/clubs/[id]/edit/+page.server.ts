import { error, fail, isHttpError, isRedirect } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Club } from '$lib/types';
import { checkClubPermission, toPlainObject } from '$lib/utils';
import { loginRedirect } from '$lib/utils/scoped';
import mongo from '$lib/db/index.server';
import { m } from '$lib/paraglide/messages';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const { id } = params;
  const session = await locals.auth();

  if (!session || !session.user) {
    throw loginRedirect(url);
  }

  try {
    const db = mongo.db();
    const clubsCollection = db.collection<Club>('clubs');

    // Try to find club by ID first, then by slug
    const club = await clubsCollection.findOne({
      $or: [{ id }, { slug: id }]
    });

    if (!club) {
      error(404, m.club_not_found());
    }

    const userPermissions = await checkClubPermission(session.user, club, mongo);

    if (!userPermissions.canEdit) {
      error(403, m.you_do_not_have_permission_to_edit_this_club());
    }

    return {
      club: toPlainObject(club),
      userPermissions
    };
  } catch (err) {
    if (err && (isHttpError(err) || isRedirect(err))) {
      throw err;
    }
    console.error('Error loading club for edit:', err);
    error(500, m.error_failed_to_load_club_data());
  }
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    let { id } = params;
    const session = await locals.auth();

    if (!session || !session.user) {
      return fail(401, { message: m.unauthorized() });
    }

    try {
      const formData = await request.formData();
      const name = formData.get('name') as string;
      const slug = formData.get('slug') as string;
      const description = formData.get('description') as string;
      const website = formData.get('website') as string;
      const avatarUrl = formData.get('avatarUrl') as string;
      const backgroundColor = formData.get('backgroundColor') as string;
      const useCustomBackgroundColor = formData.get('useCustomBackgroundColor') === 'true';
      const acceptJoinRequests = formData.get('acceptJoinRequests') === 'on';
      const postReadability = parseInt(formData.get('postReadability') as string);
      const postWritability = parseInt(formData.get('postWritability') as string);

      if (!name?.trim() || !slug?.trim()) {
        return fail(400, {
          message: m.validation_error(),
          errors: ['Name and slug are required'],
          formData: {
            name: name?.trim() || '',
            slug: slug?.trim() || '',
            description: description?.trim() || '',
            website: website?.trim() || '',
            avatarUrl: avatarUrl?.trim() || '',
            backgroundColor: backgroundColor?.trim() || '',
            useCustomBackgroundColor,
            acceptJoinRequests,
            postReadability,
            postWritability
          }
        });
      }

      // Additional validation
      const errors: string[] = [];

      if (name.trim().length > 100) {
        errors.push('Club name is too long (maximum 100 characters)');
      }

      if (description && description.length > 1000) {
        errors.push('Description is too long (maximum 1000 characters)');
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

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        errors.push('Slug can only contain lowercase letters, numbers and hyphens');
      }

      if (errors.length > 0) {
        return fail(400, {
          message: m.validation_error(),
          errors,
          formData: {
            name: name?.trim() || '',
            slug: slug?.trim() || '',
            description: description?.trim() || '',
            website: website?.trim() || '',
            avatarUrl: avatarUrl?.trim() || '',
            backgroundColor: backgroundColor?.trim() || '',
            useCustomBackgroundColor,
            acceptJoinRequests,
            postReadability,
            postWritability
          }
        });
      }

      const db = mongo.db();
      const clubsCollection = db.collection<Club>('clubs');

      // Get current club
      const club = await clubsCollection.findOne({
        $or: [{ id }, { slug: id }]
      });

      if (!club) {
        return fail(404, { message: m.club_not_found() });
      }

      if (!session?.user || !(await checkClubPermission(session.user, club, mongo)).canEdit) {
        return fail(403, { message: m.you_do_not_have_permission_to_edit_this_club() });
      }

      id = club.id;

      // Check if slug is unique (excluding current club)
      if (slug !== club.slug) {
        const existingClub = await clubsCollection.findOne({
          slug,
          id: { $ne: id }
        });
        if (existingClub) {
          return fail(400, { message: m.this_slug_is_already_taken() });
        }
      }

      // Update club
      const updateData: Partial<Club> & { updatedAt: Date } = {
        name: name.trim(),
        slug: slug.trim(),
        description: description?.trim() || undefined,
        website: website?.trim() || undefined,
        avatarUrl: avatarUrl?.trim() || undefined,
        acceptJoinRequests,
        postReadability,
        postWritability,
        updatedAt: new Date()
      };

      // Only update backgroundColor if user chose to set a custom color
      if (useCustomBackgroundColor && backgroundColor && backgroundColor.trim().length > 0) {
        updateData.backgroundColor = backgroundColor.trim();
      } else {
        updateData.backgroundColor = undefined;
      }

      await clubsCollection.updateOne({ id }, { $set: updateData });

      return {
        success: true,
        redirectSlug: slug.trim()
      };
    } catch (err) {
      console.error('Error updating club:', err);
      return fail(500, { message: m.failed_to_update_club() });
    }
  }
};
