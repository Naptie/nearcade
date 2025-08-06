import { simpleParser, Source, ParsedMail } from 'mailparser';
import Imap from 'node-imap';
import { createHmac } from 'crypto';
import { createClient as createRedisClient } from 'redis';
import { MongoClient } from 'mongodb';
import { nanoid } from 'nanoid';
import dotenv from 'dotenv';

if (!('MONGODB_URI' in process.env)) {
  // Load environment variables for local development
  dotenv.config();
}

const { IMAP_HOST, IMAP_PORT, IMAP_USER, IMAP_PASSWORD, REDIS_URI, AUTH_SECRET, MONGODB_URI } =
  process.env;

// Utility to promisify imap.openBox
const openBoxAsync = (imap: Imap, boxName: string): Promise<Imap.Box> => {
  return new Promise((resolve, reject) => {
    imap.openBox(boxName, false, (err, box) => {
      if (err) reject(err);
      else resolve(box);
    });
  });
};

// Utility to promisify imap.search
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

// Redis client
const redis = createRedisClient({ url: REDIS_URI });

const ensureRedisConnected = async () => {
  if (!redis.isOpen) await redis.connect();
};

const report = async (key: string, value: string, expire: number = 60 * 60 * 24 /* 1 day */) => {
  console.log(`[Report] ${key} - ${value}`);
  await redis.set(key, value, { EX: expire });
};

// MongoDB client
const mongo = new MongoClient(MONGODB_URI!);

// Main polling function
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
      // Only search unseen messages
      const results = await searchAsync(imap, ['UNSEEN']);
      if (results.length === 0) {
        setTimeout(poll, 5000); // Poll every 5s
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
            // Mark the message as Seen
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

const getDomainFromWebsite = (website: string): string | null => {
  try {
    const hostname = new URL(website || '').hostname;
    const parts = hostname.split('.');
    return parts.length > 2 ? parts.slice(1).join('.') : hostname;
  } catch {
    return null;
  }
};

const isEmailDomainAccepted = (email: string, domain: string): boolean => {
  // Standardize domain and email
  const emailLower = email.trim().toLowerCase();
  const domainLower = domain.trim().toLowerCase();

  // 1. exact domain: @example.edu.cn
  if (emailLower.endsWith('@' + domainLower)) {
    return true;
  }

  // 2. subdomain: @[any].example.edu.cn
  // Match: @sub.example.edu.cn, @foo.bar.example.edu.cn, etc.
  const domainPattern = new RegExp(`@([a-zA-Z0-9._-]+\\.)+${domainLower.replace('.', '\\.')}$`);
  if (domainPattern.test(emailLower)) {
    return true;
  }

  return false;
};

const processEmail = async (parsed: ParsedMail) => {
  const subject: string = parsed.subject || '';
  if (!subject.startsWith('[nearcade] SSV ')) return;

  const body: string = parsed.text || '';
  const lines = body.split('\n').map((l) => l.trim());
  const univLine = lines.find((l) => l.startsWith('UNIV: '));
  const userLine = lines.find((l) => l.startsWith('USER: '));
  const hmacLine = lines.find((l) => l.startsWith('HMAC: '));

  if (!univLine || !userLine) return;

  const universityId = univLine.slice(6).trim();
  const userId = userLine.slice(6).trim();
  const givenHmac = hmacLine ? hmacLine.slice(6).trim() : '';

  // Calculate HMAC
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const calculatedHmac = createHmac('sha256', AUTH_SECRET!)
    .update(`${userId}|${universityId}|${today.toISOString()}`)
    .digest('hex');

  await ensureRedisConnected();

  const key = `nearcade:ssv:${universityId}:${userId}`;

  if (givenHmac !== calculatedHmac) {
    await report(key, 'hmac_mismatch');
    return;
  }

  // Now, check the domain
  // MongoDB logic
  const db = mongo.db();
  const universities = db.collection('universities');
  const collection = db.collection('university_members');

  // Fetch university doc for domain extraction
  const university = await universities.findOne({ id: universityId });
  if (!university || !university.website) {
    await report(key, 'underconfigured_university');
    return;
  }

  const domain = getDomainFromWebsite(university.website);
  const emailAddress = parsed.from?.value?.[0]?.address || '';
  if (!domain || !isEmailDomainAccepted(emailAddress, domain)) {
    await report(key, 'domain_mismatch');
    return;
  }

  const alreadyVerified = await collection.findOne({
    verificationEmail: emailAddress
  });

  if (alreadyVerified) {
    await report(key, 'already_verified');
    return;
  }

  await report(key, 'processing');

  const existing = await collection.findOne({ universityId, userId });

  if (existing) {
    await collection.updateOne(
      { universityId, userId },
      { $set: { verificationEmail: emailAddress } }
    );
  } else {
    await collection.insertOne({
      id: nanoid(),
      universityId,
      userId,
      memberType: 'student',
      verificationEmail: emailAddress,
      joinedAt: new Date()
    });
  }

  await report(key, 'success');
};

try {
  startPolling();
} catch (err) {
  console.error('Fatal error:', err);
  process.exit(1);
}
