import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { INITIAL_USERS } from './store.ts';
import { closeDatabase, getPool, verifyDatabase } from './pool.ts';

interface LegacyUser {
  id: number;
  username: string;
  email: string | null;
  password_hash: string;
  email_verified: number;
  created_at: number;
}

interface LegacySession {
  token_hash: string;
  user_id: number | null;
  csrf_token: string;
  created_at: number;
  expires_at: number;
}

interface LegacyReset {
  token_hash: string;
  user_id: number;
  created_at: number;
  expires_at: number;
  used_at: number | null;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = process.env.AUTH_DATABASE_PATH || path.join(rootDir, 'data', 'auth.db');
const shouldApply = process.argv.includes('--apply');

async function run(): Promise<void> {
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const userRows = source.prepare(
      'SELECT id, username, email, password_hash, email_verified, created_at FROM users ORDER BY id',
    ).all();
    const users: LegacyUser[] = userRows.map((row) => ({
      id: Number(row.id),
      username: String(row.username),
      email: row.email === null ? null : String(row.email),
      password_hash: String(row.password_hash),
      email_verified: Number(row.email_verified),
      created_at: Number(row.created_at),
    }));
    const sessionRows = source.prepare(
      'SELECT token_hash, user_id, csrf_token, created_at, expires_at FROM sessions ORDER BY created_at',
    ).all();
    const sessions: LegacySession[] = sessionRows.map((row) => ({
      token_hash: String(row.token_hash),
      user_id: row.user_id === null ? null : Number(row.user_id),
      csrf_token: String(row.csrf_token),
      created_at: Number(row.created_at),
      expires_at: Number(row.expires_at),
    }));
    const resetRows = source.prepare(
      'SELECT token_hash, user_id, created_at, expires_at, used_at FROM password_resets ORDER BY created_at',
    ).all();
    const resets: LegacyReset[] = resetRows.map((row) => ({
      token_hash: String(row.token_hash),
      user_id: Number(row.user_id),
      created_at: Number(row.created_at),
      expires_at: Number(row.expires_at),
      used_at: row.used_at === null ? null : Number(row.used_at),
    }));

    await verifyDatabase();
    const pool = getPool();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const importedUsers: LegacyUser[] = [];
      const existingUsers = await client.query<LegacyUser>(
        `SELECT id, username, email, password_hash, email_verified, created_at
         FROM zunari_users`,
      );
      const byId = new Map(existingUsers.rows.map((row) => [Number(row.id), row]));
      const byUsername = new Map(existingUsers.rows.map((row) => [row.username.toLowerCase(), row]));
      const byEmail = new Map(
        existingUsers.rows.filter((row) => row.email).map((row) => [row.email!.toLowerCase(), row]),
      );

      for (const user of users) {
        const existing = byId.get(user.id);
        const usernameConflict = byUsername.get(user.username.toLowerCase());
        const emailConflict = user.email ? byEmail.get(user.email.toLowerCase()) : undefined;
        if (existing || usernameConflict || emailConflict) {
          if (
            !existing ||
            Number(existing.id) !== user.id ||
            existing.username !== user.username ||
            existing.email !== user.email ||
            existing.password_hash !== user.password_hash ||
            Boolean(existing.email_verified) !== Boolean(user.email_verified) ||
            Number(existing.created_at) !== user.created_at
          ) {
            throw new Error('Conflicting account data.');
          }
          continue;
        }
        importedUsers.push(user);
      }

      const importedSessions: LegacySession[] = [];
      const existingSessions = await client.query<LegacySession>(
        'SELECT token_hash, user_id, csrf_token, created_at, expires_at FROM zunari_sessions',
      );
      const sessionsByHash = new Map(existingSessions.rows.map((row) => [row.token_hash, row]));
      for (const session of sessions) {
        const existing = sessionsByHash.get(session.token_hash);
        if (existing) {
          if (
            Number(existing.user_id) !== Number(session.user_id) ||
            existing.csrf_token !== session.csrf_token ||
            Number(existing.created_at) !== session.created_at ||
            Number(existing.expires_at) !== session.expires_at
          ) {
            throw new Error('Conflicting session data.');
          }
        } else {
          importedSessions.push(session);
        }
      }

      const importedResets: LegacyReset[] = [];
      const existingResets = await client.query<LegacyReset>(
        'SELECT token_hash, user_id, created_at, expires_at, used_at FROM zunari_password_resets',
      );
      const resetsByHash = new Map(existingResets.rows.map((row) => [row.token_hash, row]));
      for (const reset of resets) {
        const existing = resetsByHash.get(reset.token_hash);
        if (existing) {
          if (
            Number(existing.user_id) !== reset.user_id ||
            Number(existing.created_at) !== reset.created_at ||
            Number(existing.expires_at) !== reset.expires_at ||
            (existing.used_at === null ? null : Number(existing.used_at)) !== reset.used_at
          ) {
            throw new Error('Conflicting password reset data.');
          }
        } else {
          importedResets.push(reset);
        }
      }

      if (shouldApply) {
        for (const user of importedUsers) {
          const seededProfile = INITIAL_USERS.find(
            (candidate) => candidate.username.toLowerCase() === user.username.toLowerCase(),
          );
          const joinedDate = seededProfile?.joinedDate ||
            `Joined ${new Date(user.created_at).toLocaleDateString('en-US', {
              month: 'long',
              year: 'numeric',
            })}`;
          await client.query(
            `INSERT INTO zunari_users
               (id, public_id, username, name, email, password_hash, email_verified,
                created_at, joined_date, avatar_url, banner_url, bio, location, website,
                verified, is_gold, followers_count, following_count)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
            [
              user.id,
              seededProfile?.id || `user_auth_${user.id}`,
              user.username,
              seededProfile?.name || user.username.charAt(0).toUpperCase() + user.username.slice(1),
              user.email,
              user.password_hash,
              Boolean(user.email_verified),
              user.created_at,
              joinedDate,
              seededProfile?.avatarUrl || INITIAL_USERS[0].avatarUrl,
              seededProfile?.bannerUrl || INITIAL_USERS[0].bannerUrl || null,
              seededProfile?.bio || 'New Zunari member',
              seededProfile?.location || null,
              seededProfile?.website || null,
              seededProfile?.verified || false,
              Boolean(seededProfile?.isGold),
              seededProfile?.followersCount || 0,
              seededProfile?.followingCount || (seededProfile ? 0 : 1),
            ],
          );
        }
        for (const session of importedSessions) {
          await client.query(
            `INSERT INTO zunari_sessions (token_hash, user_id, csrf_token, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              session.token_hash,
              session.user_id,
              session.csrf_token,
              session.created_at,
              session.expires_at,
            ],
          );
        }
        for (const reset of importedResets) {
          await client.query(
            `INSERT INTO zunari_password_resets
               (token_hash, user_id, created_at, expires_at, used_at)
             VALUES ($1, $2, $3, $4, $5)`,
            [reset.token_hash, reset.user_id, reset.created_at, reset.expires_at, reset.used_at],
          );
        }
        const importedCustomIds = importedUsers
          .filter(
            (user) =>
              !INITIAL_USERS.some(
                (seed) => seed.username.toLowerCase() === user.username.toLowerCase(),
              ),
          )
          .map((user) => `user_auth_${user.id}`);
        if (importedCustomIds.length) {
          await client.query(
            `INSERT INTO zunari_follows (follower_id, following_id, created_at)
             SELECT user_row.public_id, 'user_mukit', $1
             FROM zunari_users user_row
             WHERE user_row.public_id = ANY($2::text[])
               AND EXISTS (SELECT 1 FROM zunari_users WHERE public_id = 'user_mukit')
             ON CONFLICT DO NOTHING`,
            [Date.now(), importedCustomIds],
          );
        }
        await client.query(`
          SELECT setval(
            pg_get_serial_sequence('zunari_users', 'id')::regclass,
            GREATEST(
              COALESCE((SELECT MAX(id) FROM zunari_users), 1),
              nextval(pg_get_serial_sequence('zunari_users', 'id')::regclass)
            ),
            true
          )
        `);
      }

      await client.query(shouldApply ? 'COMMIT' : 'ROLLBACK');
      console.info(
        `${shouldApply ? 'Imported' : 'Validated'} SQLite records: ` +
          `${users.length} accounts (${importedUsers.length} new), ` +
          `${sessions.length} sessions (${importedSessions.length} new), ` +
          `${resets.length} password resets (${importedResets.length} new).`,
      );
      if (!shouldApply) {
        console.info('Dry run only. Re-run with --apply after reviewing the counts.');
      }
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    source.close();
  }
}

try {
  await run();
} catch {
  console.error('SQLite import validation failed. No source data was changed.');
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
