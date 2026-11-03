import pg from 'pg';
import { config } from '../config.ts';

const { Pool } = pg;

export class PostgresService {
  private pool: pg.Pool | null = null;
  private isConnected = false;
  private connectionError: string | null = null;

  constructor() {
    this.initPool();
  }

  private initPool() {
    try {
      if (config.database.url) {
        this.pool = new Pool({
          connectionString: config.database.url,
          ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 5000,
        });
      } else if (config.database.host) {
        this.pool = new Pool({
          host: config.database.host,
          port: config.database.port,
          user: config.database.user,
          password: config.database.password,
          database: config.database.database,
          ssl: config.database.ssl ? { rejectUnauthorized: false } : undefined,
          connectionTimeoutMillis: 5000,
        });
      }

      if (this.pool) {
        this.pool.on('error', (err) => {
          console.warn('PostgreSQL idle client error:', err.message);
        });
      }
    } catch (err: any) {
      this.connectionError = err.message;
      console.warn('Could not initialize PostgreSQL pool:', err.message);
    }
  }

  public async connectAndMigrate(): Promise<boolean> {
    if (!this.pool) return false;
    try {
      const client = await this.pool.connect();
      try {
        await client.query(`
          CREATE TABLE IF NOT EXISTS users (
            id VARCHAR(64) PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            username VARCHAR(50) UNIQUE NOT NULL,
            avatar_url TEXT,
            banner_url TEXT,
            bio TEXT,
            location VARCHAR(100),
            website VARCHAR(200),
            verified BOOLEAN DEFAULT false,
            is_gold BOOLEAN DEFAULT false,
            followers_count INTEGER DEFAULT 0,
            following_count INTEGER DEFAULT 0,
            joined_date VARCHAR(50) NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS posts (
            id VARCHAR(64) PRIMARY KEY,
            author_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            content TEXT NOT NULL,
            media_urls TEXT[],
            poll_data JSONB,
            reply_to_id VARCHAR(64),
            quote_post_id VARCHAR(64),
            likes_count INTEGER DEFAULT 0,
            reposts_count INTEGER DEFAULT 0,
            replies_count INTEGER DEFAULT 0,
            views_count INTEGER DEFAULT 0,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS likes (
            user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            post_id VARCHAR(64) REFERENCES posts(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, post_id)
          );

          CREATE TABLE IF NOT EXISTS reposts (
            user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            post_id VARCHAR(64) REFERENCES posts(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, post_id)
          );

          CREATE TABLE IF NOT EXISTS bookmarks (
            user_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            post_id VARCHAR(64) REFERENCES posts(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, post_id)
          );

          CREATE TABLE IF NOT EXISTS follows (
            follower_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            following_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (follower_id, following_id)
          );

          CREATE TABLE IF NOT EXISTS notifications (
            id VARCHAR(64) PRIMARY KEY,
            recipient_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            sender_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            type VARCHAR(32) NOT NULL,
            post_id VARCHAR(64),
            post_content TEXT,
            read BOOLEAN DEFAULT false,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );

          CREATE TABLE IF NOT EXISTS messages (
            id VARCHAR(64) PRIMARY KEY,
            sender_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            recipient_id VARCHAR(64) REFERENCES users(id) ON DELETE CASCADE,
            text TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
          );
        `);
        this.isConnected = true;
        this.connectionError = null;
        console.log('PostgreSQL schema successfully verified and migrated.');
        return true;
      } finally {
        client.release();
      }
    } catch (err: any) {
      this.isConnected = false;
      this.connectionError = err.message;
      console.warn('PostgreSQL connection check failed, using fallback store:', err.message);
      return false;
    }
  }

  public getStatus() {
    return {
      connected: this.isConnected,
      type: 'PostgreSQL',
      details: this.isConnected 
        ? `Connected to ${config.database.database} at ${config.database.host}:${config.database.port}`
        : (this.connectionError ? `PostgreSQL offline: ${this.connectionError}` : 'PostgreSQL not configured in .env'),
    };
  }

  public getPool() {
    return this.pool;
  }
}

export const postgresService = new PostgresService();
