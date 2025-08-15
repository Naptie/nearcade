import { MongoClient } from 'mongodb';
import type { University, UniversityMember, Club } from '../src/lib/types';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('Error: MONGODB_URI environment variable is not set.');
  process.exit(1);
}

interface UniversityStats {
  studentsCount: number;
  frequentingArcades: number[];
  clubsCount: number;
}

/**
 * Calculate statistics for a single university
 */
const calculateUniversityStats = async (
  universityId: string,
  client: MongoClient
): Promise<UniversityStats> => {
  const db = client.db();
  const membersCollection = db.collection<UniversityMember>('university_members');
  const clubsCollection = db.collection<Club>('clubs');
  const usersCollection = db.collection('users');

  // 1. Count students (university members)
  const studentsCount = await membersCollection.countDocuments({
    universityId: universityId
  });

  // 2. Count clubs for this university
  const clubsCount = await clubsCollection.countDocuments({
    universityId: universityId
  });

  // 3. Find arcades frequented by at least 2 university members
  // Get all member user IDs for this university
  const memberUserIds = await membersCollection
    .find({ universityId: universityId })
    .project({ userId: 1 })
    .toArray();

  const userIds = memberUserIds.map((member) => member.userId);

  if (userIds.length === 0) {
    return {
      studentsCount,
      frequentingArcades: [],
      clubsCount
    };
  }

  // Get all frequenting arcades from university members
  const usersWithArcades = await usersCollection
    .find({
      id: { $in: userIds },
      frequentingArcades: { $exists: true, $ne: null, $not: { $size: 0 } }
    })
    .project({ frequentingArcades: 1 })
    .toArray();

  // Count how many times each arcade appears in user lists
  const arcadeFrequency = new Map<number, number>();
  usersWithArcades.forEach((user) => {
    if (user.frequentingArcades && Array.isArray(user.frequentingArcades)) {
      user.frequentingArcades.forEach((arcadeId: number) => {
        arcadeFrequency.set(arcadeId, (arcadeFrequency.get(arcadeId) || 0) + 1);
      });
    }
  });

  // Filter arcades that are frequented by at least 2 members
  const frequentingArcades = Array.from(arcadeFrequency.entries())
    .filter(([, count]) => count >= 2)
    .map(([arcadeId]) => arcadeId)
    .sort((a, b) => a - b); // Sort for consistency

  return {
    studentsCount,
    frequentingArcades,
    clubsCount
  };
};

/**
 * Update all university statistics
 */
const updateAllUniversityStats = async (client: MongoClient): Promise<void> => {
  console.log('Starting university statistics calculation...');

  const db = client.db();
  const universitiesCollection = db.collection<University>('universities');

  // Get all universities
  const universities = await universitiesCollection.find({}).toArray();

  if (universities.length === 0) {
    console.log('No universities found in database.');
    return;
  }

  console.log(`Found ${universities.length} universities to process.`);

  let processedCount = 0;
  let updatedCount = 0;
  let errors = 0;

  for (const university of universities) {
    try {
      processedCount++;

      if (processedCount % 10 === 0 || processedCount === universities.length) {
        console.log(
          `Progress: ${processedCount}/${universities.length} universities (${((processedCount / universities.length) * 100).toFixed(1)}%)`
        );
      }

      // Calculate stats for this university
      const stats = await calculateUniversityStats(university.id, client);

      // Update university with new stats
      const updateResult = await universitiesCollection.updateOne(
        { id: university.id },
        {
          $set: {
            studentsCount: stats.studentsCount,
            frequentingArcades: stats.frequentingArcades,
            clubsCount: stats.clubsCount,
            updatedAt: new Date()
          }
        }
      );

      if (updateResult.modifiedCount > 0) {
        updatedCount++;
      }

      // Log progress for specific universities
      if (stats.studentsCount > 0 || stats.clubsCount > 0 || stats.frequentingArcades.length > 0) {
        console.log(
          `  ${university.name}: ${stats.studentsCount} students, ${stats.clubsCount} clubs, ${stats.frequentingArcades.length} frequenting arcades (2+ members each)`
        );
      }
    } catch (error) {
      errors++;
      console.error(`Error processing university ${university.name} (${university.id}):`, error);
    }
  }

  console.log('\n=== University Statistics Update Complete ===');
  console.log(`Total universities processed: ${processedCount}`);
  console.log(`Universities updated: ${updatedCount}`);
  console.log(`Errors encountered: ${errors}`);

  if (errors > 0) {
    console.log(`\nWARNING: ${errors} universities had errors during processing.`);
  }
};

/**
 * Display summary statistics
 */
const displaySummaryStats = async (client: MongoClient): Promise<void> => {
  console.log('\n=== Summary Statistics ===');

  const db = client.db();
  const universitiesCollection = db.collection<University>('universities');

  // Get aggregate statistics
  const pipeline = [
    {
      $group: {
        _id: null,
        totalUniversities: { $sum: 1 },
        totalStudents: { $sum: { $ifNull: ['$studentsCount', 0] } },
        totalClubs: { $sum: { $ifNull: ['$clubsCount', 0] } },
        totalFrequentingArcades: {
          $sum: {
            $size: { $ifNull: ['$frequentingArcades', []] }
          }
        },
        universitiesWithStudents: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$studentsCount', 0] }, 0] }, 1, 0] }
        },
        universitiesWithClubs: {
          $sum: { $cond: [{ $gt: [{ $ifNull: ['$clubsCount', 0] }, 0] }, 1, 0] }
        },
        universitiesWithArcades: {
          $sum: {
            $cond: [{ $gt: [{ $size: { $ifNull: ['$frequentingArcades', []] } }, 0] }, 1, 0]
          }
        }
      }
    }
  ];

  const results = await universitiesCollection.aggregate(pipeline).toArray();

  if (results.length > 0) {
    const stats = results[0];
    console.log(`Total Universities: ${stats.totalUniversities}`);
    console.log(`Total Students: ${stats.totalStudents}`);
    console.log(`Total Clubs: ${stats.totalClubs}`);
    console.log(`Total Frequenting Arcades: ${stats.totalFrequentingArcades}`);
    console.log(`Universities with Students: ${stats.universitiesWithStudents}`);
    console.log(`Universities with Clubs: ${stats.universitiesWithClubs}`);
    console.log(`Universities with Frequenting Arcades: ${stats.universitiesWithArcades}`);
  }

  // Show top universities by various metrics
  console.log('\n=== Top Universities by Students ===');
  const topByStudents = await universitiesCollection
    .find({ studentsCount: { $gt: 0 } })
    .sort({ studentsCount: -1 })
    .limit(5)
    .project({ name: 1, studentsCount: 1 })
    .toArray();

  topByStudents.forEach((uni, index) => {
    console.log(`${index + 1}. ${uni.name}: ${uni.studentsCount} students`);
  });

  console.log('\n=== Top Universities by Clubs ===');
  const topByClubs = await universitiesCollection
    .find({ clubsCount: { $gt: 0 } })
    .sort({ clubsCount: -1 })
    .limit(5)
    .project({ name: 1, clubsCount: 1 })
    .toArray();

  topByClubs.forEach((uni, index) => {
    console.log(`${index + 1}. ${uni.name}: ${uni.clubsCount} clubs`);
  });

  console.log('\n=== Top Universities by Frequenting Arcades ===');
  const topByArcades = await universitiesCollection
    .find({
      frequentingArcades: { $exists: true, $not: { $size: 0 } }
    })
    .sort({
      frequentingArcades: -1 // Sort by array length in descending order
    })
    .limit(5)
    .project({
      name: 1,
      frequentingArcades: 1
    })
    .toArray();

  // Since MongoDB can't sort by array size directly in all versions, we'll sort manually
  const sortedByArcades = topByArcades
    .map((uni) => ({
      name: uni.name,
      arcadeCount: uni.frequentingArcades ? uni.frequentingArcades.length : 0
    }))
    .sort((a, b) => b.arcadeCount - a.arcadeCount)
    .slice(0, 5);

  sortedByArcades.forEach((uni, index) => {
    console.log(`${index + 1}. ${uni.name}: ${uni.arcadeCount} frequenting arcades`);
  });
};

// Main execution
(async () => {
  let client: MongoClient | undefined;

  try {
    console.log('Connecting to MongoDB...');
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    console.log('MongoDB connected successfully.');

    // Update all university statistics
    await updateAllUniversityStats(client);

    // Display summary
    await displaySummaryStats(client);

    console.log('\nUniversity statistics calculation completed successfully! 🎉');
  } catch (error) {
    console.error('An error occurred during script execution:', error);
    process.exit(1);
  } finally {
    if (client) {
      await client.close();
      console.log('MongoDB connection closed.');
    }
  }
})();
