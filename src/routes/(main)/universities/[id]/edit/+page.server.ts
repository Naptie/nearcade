import { error, fail, redirect } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { MongoClient } from 'mongodb';
import type { PageServerLoad, Actions } from './$types';
import type { University } from '$lib/types';
import { checkUniversityPermission } from '$lib/utils';
import { logUniversityChanges } from '$lib/changelog.server';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const load: PageServerLoad = async ({ params, parent }) => {
  const { id } = params;

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const universitiesCollection = db.collection('universities');

    // Try to find university by ID first, then by slug
    let university = (await universitiesCollection.findOne(
      {
        id: id
      },
      { projection: { _id: 0 } }
    )) as unknown as University | null;

    if (!university) {
      university = (await universitiesCollection.findOne(
        {
          slug: id
        },
        { projection: { _id: 0 } }
      )) as unknown as University | null;
    }

    if (!university) {
      throw error(404, 'University not found');
    }

    const parentData = await parent();
    const user = parentData.session?.user;

    if (!user) {
      throw error(401, 'Authentication required');
    }

    // Check permissions for the current user
    const userPermissions = await checkUniversityPermission(user.id!, university.id, mongoClient);

    if (!userPermissions.canEdit) {
      throw error(403, 'Insufficient privileges');
    }

    return {
      university,
      user,
      userPermissions
    };
  } catch (err) {
    console.error('Error loading university:', err);
    if (err && typeof err === 'object' && 'status' in err) {
      throw err;
    }
    throw error(500, 'Failed to load university data');
  }
};

export const actions: Actions = {
  updateUniversity: async ({ request, locals, params }) => {
    const session = await locals.auth();
    if (!session || !session.user) {
      return fail(401, { message: 'Unauthorized' });
    }

    const user = session.user;
    const { id } = params;

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

      const mongoClient = await clientPromise;

      // Check permissions using new system
      const permissions = await checkUniversityPermission(user.id!, id, mongoClient);
      if (!permissions.canEdit) {
        return fail(403, { message: 'Insufficient privileges' });
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

      if (errors.length > 0) {
        return fail(400, {
          message: 'Validation failed',
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
            isDoubleFirstClass
          }
        });
      }

      const db = mongoClient.db();
      const universitiesCollection = db.collection('universities');

      // Get current university data for changelog comparison
      const currentUniversity = (await universitiesCollection.findOne(
        { id },
        { projection: { _id: 0 } }
      )) as unknown as University | null;

      if (!currentUniversity) {
        return fail(404, { message: 'University not found' });
      }

      // Check if slug is already taken (if provided and different from current)
      if (slug && slug.trim().length > 0) {
        const existingUniversity = await universitiesCollection.findOne({
          slug: slug.trim(),
          id: { $ne: id }
        });

        if (existingUniversity) {
          return fail(400, { message: 'This URL slug is already taken' });
        }
      }

      const updateData: Partial<University> & { updatedAt: Date } = {
        name: name.trim(),
        type: type.trim(),
        affiliation: affiliation.trim(),
        description: description?.trim() || null,
        website: website?.trim() || null,
        avatarUrl: avatarUrl?.trim() || null,
        slug: slug?.trim() || null,
        majorCategory: majorCategory?.trim() || null,
        natureOfRunning: natureOfRunning?.trim() || null,
        is985,
        is211,
        isDoubleFirstClass,
        updatedAt: new Date()
      };

      // Only update backgroundColor if user chose to set a custom color
      if (useCustomBackgroundColor && backgroundColor && backgroundColor.trim().length > 0) {
        updateData.backgroundColor = backgroundColor.trim();
      } else {
        updateData.backgroundColor = null; // Reset if not using custom color
      }

      // Log changes to changelog
      await logUniversityChanges(mongoClient, id, currentUniversity, updateData, {
        id: user.id!,
        name: user.name,
        image: user.image
      });

      await universitiesCollection.updateOne({ id }, { $set: updateData });

      throw redirect(302, `/universities/${id}`);
    } catch (err) {
      if (err && typeof err === 'object' && 'status' in err && 'location' in err) {
        throw err; // Re-throw redirect
      }
      console.error('Error updating university:', err);
      return fail(500, { message: 'Failed to update university' });
    }
  }
};
