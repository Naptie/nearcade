import { error, fail } from '@sveltejs/kit';
import type { PageServerLoad, Actions } from './$types';
import type { Club } from '$lib/types';
import { checkClubPermission, loginRedirect, toPlainObject } from '$lib/utils';
import client from '$lib/db.server';

export const load: PageServerLoad = async ({ params, url, locals }) => {
  const { id } = params;
  const session = await locals.auth();

  if (!session || !session.user) {
    throw loginRedirect(url);
  }

  try {
    const db = client.db();
    const clubsCollection = db.collection<Club>('clubs');

    // Try to find club by ID first, then by slug
    let club = await clubsCollection.findOne({
      id: id
    });

    if (!club) {
      club = await clubsCollection.findOne({
        slug: id
      });
    }

    if (!club) {
      error(404, 'Club not found');
    }

    const userPermissions = await checkClubPermission(session.user, club, client);

    if (!userPermissions.canEdit) {
      error(403, { message: 'You do not have permission to edit this club' });
    }

    return {
      club: toPlainObject(club),
      userPermissions
    };
  } catch (err) {
    console.error('Error loading club for edit:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    error(500, 'Failed to load club data');
  }
};

export const actions: Actions = {
  default: async ({ request, params, locals }) => {
    const { id } = params;
    const session = await locals.auth();

    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
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
          message: 'Validation failed',
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
          message: 'Validation failed',
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

      const db = client.db();
      const clubsCollection = db.collection<Club>('clubs');

      // Get current club
      let club = await clubsCollection.findOne({
        id: id
      });

      if (!club) {
        club = await clubsCollection.findOne({
          slug: id
        });
      }

      if (!club) {
        return fail(404, { message: 'Club not found' });
      }

      if (!session?.user || !(await checkClubPermission(session.user, club, client)).canEdit) {
        return fail(403, { message: 'You do not have permission to edit this club' });
      }

      // Check if slug is unique (excluding current club)
      if (slug !== club.slug) {
        const existingClub = await clubsCollection.findOne({
          slug,
          id: { $ne: club.id }
        });
        if (existingClub) {
          return fail(400, { message: 'This slug is already taken' });
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

      await clubsCollection.updateOne({ id: club.id }, { $set: updateData });

      return {
        success: true,
        message: 'Club updated successfully',
        redirectSlug: slug.trim()
      };
    } catch (err) {
      console.error('Error updating club:', err);
      return fail(500, { message: 'Failed to update club' });
    }
  }
};
