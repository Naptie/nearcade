import { simpleParser, Source, ParsedMail } from 'mailparser';
import Imap from 'node-imap';
import { createHmac } from 'crypto';
import { createClient as createRedisClient } from 'redis';
import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';
import type { UserType, UniversityMember, ClubMember } from '../src/lib/types';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, REDIS_URI, AUTH_SECRET, MONGODB_URI } =
  process.env;

// --- NEW HELPER FUNCTIONS FOR SECURITY ---

/**
 * Parses authentication headers to verify the sender's authenticity.
 * @param headers The headers map from the parsed email.
 * @returns An object with the verified domain and sender address if DMARC passes, otherwise null.
 */
const getVerifiedSenderInfo = (
  headers: ParsedMail['headers']
): { verifiedDomain: string; senderAddress: string } | null => {
  // The `authentication-results` header is added by the receiving server (e.g., Google, Microsoft)
  // and contains a summary of SPF, DKIM, and DMARC checks. It cannot be forged by the sender.
  const authResultsHeader = headers.get('authentication-results');
  const authResults = Array.isArray(authResultsHeader)
    ? authResultsHeader.join(' ')
    : authResultsHeader?.toString();

  if (!authResults || !authResults.includes('dmarc=pass')) {
    // If DMARC did not pass, we cannot trust the sender's `From` address. Reject the email.
    console.log('[Security] DMARC check failed or header not found.');
    return null;
  }

  // DMARC=pass means the `header.from` domain is authentic.
  const domainMatch = authResults.match(/header\.from=([\w.-]+)/);
  const verifiedDomain = domainMatch?.[1];

  if (!verifiedDomain) {
    console.log('[Security] Could not extract verified domain from DMARC pass.');
    return null;
  }

  // The `received-spf` header contains the `envelope-from` address, which is more reliable
  // than the display `From` header. This is the address we should use for verification.
  const spfHeader = headers.get('received-spf');
  const spfResults = Array.isArray(spfHeader) ? spfHeader.join(' ') : spfHeader?.toString();
  const senderMatch = spfResults?.match(/envelope-from=([^;]+)/);
  const senderAddress = senderMatch?.[1];

  if (!senderAddress) {
    console.log('[Security] Could not extract envelope-from address.');
    return null;
  }

  console.log(`[Security] Verified domain: ${verifiedDomain}, sender: ${senderAddress}`);
  return { verifiedDomain, senderAddress };
};

/**
 * Checks if the authenticated domain matches the expected university domain.
 * @param authDomain The domain verified by DMARC.
 * @param expectedDomain The university's domain from your database.
 * @returns True if the domains match exactly or if authDomain is a subdomain.
 */
const isDomainMatch = (authDomain: string, expectedDomain: string): boolean => {
  const authLower = authDomain.trim().toLowerCase();
  const expectedLower = expectedDomain.trim().toLowerCase();

  // 1. Exact match (e.g., "example.edu.cn" === "example.edu.cn")
  if (authLower === expectedLower) {
    return true;
  }

  // 2. Subdomain match (e.g., "mail.example.edu.cn" ends with ".example.edu.cn")
  if (authLower.endsWith('.' + expectedLower)) {
    return true;
  }

  return false;
};

const openBoxAsync = (imap: Imap, boxName: string): Promise<Imap.Box> => {
  return new Promise((resolve, reject) => {
    imap.openBox(boxName, false, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
};

const searchAsync = (imap: Imap, criteria: string[]): Promise<number[]> => {
  return new Promise((resolve, reject) => {
    imap.search(criteria, (err, results) => {
      if (err) reject(err);
      else resolve(results);
    });
  });
};

const parseEmail = (stream: Source): Promise<ParsedMail> => {
  return simpleParser(stream);
};

const redis = createRedisClient({ url: REDIS_URI });

const ensureRedisConnected = async () => {
  if (!redis.isOpen) await redis.connect();
};

const report = async (key: string, value: string, expire: number = 60 * 60 * 24) => {
  console.log(`[Report] ${key} - ${value}`);
  await redis.set(key, value, { EX: expire });
};

const mongo = new MongoClient(MONGODB_URI!);

const getDomainFromWebsite = (website: string): string | null => {
  try {
    const hostname = new URL(website || '').hostname;
    const parts = hostname.split('.');
    return parts.length > 2 ? parts.slice(1).join('.') : hostname;
  } catch {
    return null;
  }
};

const updateUserType = async (userId: string): Promise<void> => {
  const db = mongo.db();
  const universityMembersCollection = db.collection('university_members');
  const clubMembersCollection = db.collection('club_members');
  const usersCollection = db.collection('users');

  // Get all memberships for this user
  const universityMemberships = await universityMembersCollection
    .find<UniversityMember>({ userId })
    .toArray();
  const clubMemberships = await clubMembersCollection.find<ClubMember>({ userId }).toArray();

  // Determine highest privilege
  let newUserType: UserType | undefined = undefined;

  // Check for admin roles
  const isSiteAdmin = (await usersCollection.findOne({ id: userId }))?.userType === 'site_admin';
  const isUniversityAdmin = universityMemberships.some((m) => m.memberType === 'admin');
  const isClubAdmin = clubMemberships.some((m) => m.memberType === 'admin');

  if (isSiteAdmin) {
    newUserType = 'site_admin';
  } else if (isUniversityAdmin) {
    newUserType = 'school_admin';
  } else if (isClubAdmin) {
    newUserType = 'club_admin';
  } else {
    // Check for moderator roles
    const isUniversityModerator = universityMemberships.some((m) => m.memberType === 'moderator');
    const isClubModerator = clubMemberships.some((m) => m.memberType === 'moderator');

    if (isUniversityModerator) {
      newUserType = 'school_moderator';
    } else if (isClubModerator) {
      newUserType = 'club_moderator';
    } else {
      // Check for member roles
      if (universityMemberships.some((m) => m.memberType === 'student')) {
        newUserType = 'student';
      }
    }
  }

  // Update user type
  await usersCollection.updateOne({ id: userId }, { $set: { userType: newUserType } });
};

const startPolling = () => {
  const imap = new Imap({
    user: IMAP_USER!,
    password: IMAP_PASSWORD!,
    host: IMAP_HOST,
    port: Number(IMAP_PORT),
    tls: true,
    tlsOptions: { rejectUnauthorized: false }
  });

  imap.once('ready', async () => {
    await openBoxAsync(imap, 'INBOX');
    poll();
  });

  imap.once('error', (err) => {
    console.error('IMAP error:', err);
    setTimeout(() => startPolling(), 10_000);
  });

  imap.once('end', () => {
    console.log('IMAP connection ended');
    setTimeout(() => startPolling(), 10_000);
  });

  imap.connect();

  const poll = async () => {
    try {
      const results = await searchAsync(imap, ['UNSEEN']);
      if (results.length === 0) {
        setTimeout(poll, 5000);
        return;
      }

      const fetch = imap.fetch(results, { bodies: '' });

      fetch.on('message', (msg, seqno) => {
        const chunks: Buffer[] = [];
        msg.on('body', (stream) => {
          stream.on('data', (chunk) => {
            chunks.push(Buffer.from(chunk));
          });
        });

        msg.once('end', async () => {
          try {
            const mailBuffer = Buffer.concat(chunks);
            const parsed = await parseEmail(mailBuffer);
            await processEmail(parsed);
          } catch (err) {
            console.error('Processing error:', err);
          } finally {
            imap.addFlags(seqno, '\\Seen', (err) => {
              if (err) {
                console.error(`Failed to mark message ${seqno} as read:`, err);
              }
            });
          }
        });
      });

      fetch.once('end', () => {
        setTimeout(poll, 2000);
      });
    } catch (err) {
      console.error('Polling error:', err);
      setTimeout(poll, 10000);
    }
  };
};

/**
 * Processes a single email after it has been parsed.
 * Includes security checks before processing verification logic.
 * @param parsed The parsed email object from mailparser.
 */
const processEmail = async (parsed: ParsedMail) => {
  const subject: string = parsed.subject || '';
  if (!subject.startsWith('[nearcade] SSV ')) {
    console.log('[Parser] Ignoring email with subject:', subject);
    return;
  }

  const body: string = parsed.text || '';
  const lines = body.split('\n').map((l) => l.trim());
  const univLine = lines.find((l) => l.startsWith('UNIV: '));
  const userLine = lines.find((l) => l.startsWith('USER: '));
  const hmacLine = lines.find((l) => l.startsWith('HMAC: '));

  if (!univLine || !userLine) {
    console.log('[Parser] Ignoring email with body:', body);
    return;
  }

  const universityId = univLine.slice(6).trim();
  const userId = userLine.slice(6).trim();
  const givenHmac = hmacLine ? hmacLine.slice(6).trim() : '';

  const key = `nearcade:ssv:${universityId}:${userId}`;
  await ensureRedisConnected();
  await report(key, 'processing');

  // Security checks

  // 1. Verify email authenticity and get trusted sender info.
  const verifiedInfo = getVerifiedSenderInfo(parsed.headers);
  if (!verifiedInfo) {
    await report(key, 'untrusted_sender');
    return;
  }
  const { verifiedDomain, senderAddress } = verifiedInfo;

  // 2. Check HMAC to verify request integrity.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const calculatedHmac = createHmac('sha256', AUTH_SECRET!)
    .update(`${userId}|${universityId}|${today.toISOString()}`)
    .digest('hex');

  if (givenHmac !== calculatedHmac) {
    await report(key, 'hmac_mismatch');
    return;
  }

  // Database operations

  const db = mongo.db();
  const universities = db.collection('universities');
  const collection = db.collection('university_members');

  const university = await universities.findOne({ id: universityId });
  if (!university || !university.website) {
    await report(key, 'underconfigured_university');
    return;
  }

  // 3. Compare the *verified* domain against the university's expected domain.
  const expectedDomain = getDomainFromWebsite(university.website);
  if (!expectedDomain || !isDomainMatch(verifiedDomain, expectedDomain)) {
    await report(key, 'domain_mismatch');
    return;
  }

  // 4. Use the *verified* sender address to check for existing users.
  const alreadyVerified = await collection.findOne({
    verificationEmail: senderAddress
  });

  if (alreadyVerified) {
    await report(key, 'already_verified');
    return;
  }

  const existing = await collection.findOne({ universityId, userId });

  if (existing) {
    await collection.updateOne(
      { universityId, userId },
      { $set: { verificationEmail: senderAddress } }
    );
  } else {
    const memberCount = await collection.countDocuments({ universityId });

    await collection.insertOne({
      id: nanoid(),
      universityId,
      userId,
      memberType: memberCount < 2 ? 'admin' : 'student',
      verificationEmail: senderAddress,
      joinedAt: new Date()
    });

    await updateUserType(userId);
  }

  await report(key, 'success');
};

try {
  startPolling();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
