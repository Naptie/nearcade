import { json } from '@sveltejs/kit';
import { MONGODB_URI } from '$env/static/private';
import { error } from '@sveltejs/kit';
import { MongoClient } from 'mongodb';
import type { RequestHandler } from './$types';
import type { University, Campus } from '$lib/types';
import { areCoordinatesApproxEqual, calculateDistance } from '$lib/utils';

let client: MongoClient | undefined;
let clientPromise: Promise<MongoClient>;

if (!client) {
  client = new MongoClient(MONGODB_URI);
  clientPromise = client.connect();
}

export const GET: RequestHandler = async ({ url }) => {
  const query = url.searchParams.get('q');

  if (!query || query.trim().length === 0) {
    return json({ universities: [] });
  }

  try {
    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const universitiesCollection = db.collection('universities');

    let universities: University[];

    try {
      // Try Atlas Search first
      universities = (await universitiesCollection
        .aggregate([
          {
            $search: {
              index: 'default',
              compound: {
                should: [
                  {
                    text: {
                      query: query,
                      path: 'name',
                      score: { boost: { value: 2 } }
                    }
                  },
                  {
                    text: {
                      query: query,
                      path: 'campuses.name'
                    }
                  }
                ]
              }
            }
          },
          {
            $limit: 10
          }
        ])
        .toArray()) as unknown as University[];
    } catch (err) {
      if (
        err &&
        typeof err === 'object' &&
        'code' in err &&
        err.code !== 31082 /* SearchNotEnabled */
      ) {
        // If the error is not related to the index not existing, rethrow it
        throw err;
      }
      universities = (await universitiesCollection
        .find({
          $or: [
            { name: { $regex: query, $options: 'i' } },
            { 'campuses.name': { $regex: query, $options: 'i' } }
          ]
        })
        .limit(10)
        .toArray()) as unknown as University[];
    }

    return json({ universities });
  } catch (err) {
    console.error('Error searching universities:', err);
    throw error(500, 'Failed to search universities');
  }
};

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { name, location } = body;

    if (
      !name ||
      typeof name !== 'string' ||
      !location ||
      typeof location.latitude !== 'number' ||
      typeof location.longitude !== 'number'
    ) {
      throw error(
        400,
        'Invalid request body. Expected name (string) and location (object with latitude and longitude numbers)'
      );
    }

    // Parse the name to extract university name and campus name
    let universityName: string;
    let campusName: string | null = null;

    // Check for Chinese brackets first, then English brackets
    const chineseBracketMatch = name.match(/^(.+?)（(.*)）$/);
    const englishBracketMatch = name.match(/^(.+?)\(([^)]*)\)$/);

    if (chineseBracketMatch) {
      universityName = chineseBracketMatch[1].trim();
      campusName = chineseBracketMatch[2].trim() || null;
    } else if (englishBracketMatch) {
      universityName = englishBracketMatch[1].trim();
      campusName = englishBracketMatch[2].trim() || null;
    } else {
      universityName = name.trim();
    }

    const mongoClient = await clientPromise;
    const db = mongoClient.db();
    const universitiesCollection = db.collection('universities');

    // Find universities with exact name match
    const university = (await universitiesCollection.findOne({
      name: universityName
    })) as unknown as University;

    if (!university) {
      return json({ success: false, message: 'University not found', universityName, campusName });
    }

    // Check if campus exists (exact name match first, then closest coordinate match)
    let existingCampusIndex = -1;
    let wasApproxMatch = false;

    // First, check for exact name match
    if (campusName) {
      existingCampusIndex = university.campuses.findIndex((campus) => campus.name === campusName);
    }

    // If no exact name match, find the closest campus by distance and check if it's within tolerance
    if (existingCampusIndex === -1) {
      const campusesWithDistance = university.campuses.map((campus, index) => ({
        ...campus,
        index,
        distance: calculateDistance(
          campus.latitude,
          campus.longitude,
          location.latitude,
          location.longitude
        )
      }));

      // Sort by distance (closest first)
      campusesWithDistance.sort((a, b) => a.distance - b.distance);

      // Check if the closest campus is within tolerance
      if (
        campusesWithDistance.length > 0 &&
        areCoordinatesApproxEqual(
          campusesWithDistance[0].latitude,
          campusesWithDistance[0].longitude,
          location.latitude,
          location.longitude
        )
      ) {
        existingCampusIndex = campusesWithDistance[0].index;
        wasApproxMatch = true;
      }
    }

    if (existingCampusIndex !== -1) {
      // Update existing campus coordinates and name if it was an approximate match
      const updateFields: Record<string, number | string> = {
        [`campuses.${existingCampusIndex}.latitude`]: location.latitude,
        [`campuses.${existingCampusIndex}.longitude`]: location.longitude
      };

      if (wasApproxMatch && campusName !== null) {
        updateFields[`campuses.${existingCampusIndex}.name`] = campusName;
      }

      await universitiesCollection.updateOne(
        { name: universityName },
        {
          $set: updateFields
        }
      );

      return json({
        success: true,
        message: wasApproxMatch
          ? 'Campus coordinates and name updated (approximate match)'
          : 'Campus coordinates updated',
        universityName,
        campusName,
        action: 'updated',
        wasApproximateMatch: wasApproxMatch
      });
    } else {
      // Add new campus
      const newCampus: Campus = {
        name: campusName,
        latitude: location.latitude,
        longitude: location.longitude
      };
      await universitiesCollection.updateOne(
        { name: universityName },
        {
          $push: { campuses: newCampus } as never
        }
      );
      return json({
        success: true,
        message: 'New campus added',
        universityName,
        campusName,
        action: 'created'
      });
    }
  } catch (err) {
    console.error('Error updating university campus:', err);
    throw error(500, 'Failed to update university campus');
  }
};
