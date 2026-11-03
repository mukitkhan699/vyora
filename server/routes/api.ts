import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { config } from '../config.ts';
import { dbAdapter } from '../db/adapter.ts';

export const apiRouter = Router();

// Middleware helper to get authenticated user ID from Bearer token, session header, or fallback
function getUserId(req: Request): string {
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7).trim();
    // Validate session in store
    const sessionUser = (dbAdapter as any).validateSessionSync ? (dbAdapter as any).validateSessionSync(token) : null;
    if (sessionUser) return sessionUser.id;
  }
  const explicitToken = req.headers['x-auth-token'] as string;
  const explicitUser = (req.headers['x-user-id'] as string);
  return explicitUser || 'user_mukit';
}

// In-memory binary file store managed entirely by the Node.js backend
interface StoredFile {
  id: string;
  filename: string;
  mimeType: string;
  data: Buffer;
  size: number;
  uploadedBy: string;
  createdAt: string;
}

const fileStorage = new Map<string, StoredFile>();

// ==========================================
// 0. BACKEND-CONTROLLED AUTHENTICATION ROUTES
// ==========================================

// Authenticate user credentials & issue backend session token
apiRouter.post('/auth/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username or Operator handle is required' });
    }

    const { user, token } = await dbAdapter.authenticate(username, password);

    res.json({
      success: true,
      token,
      user,
      message: `Welcome back, Operator @${user.username}`,
    });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
});

// Register new operator account on backend
apiRouter.post('/auth/register', async (req: Request, res: Response) => {
  try {
    const { username, name, password, avatarUrl, bio } = req.body;
    if (!username || !username.trim()) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const { user, token } = await dbAdapter.register({
      username,
      name,
      password,
      avatarUrl,
      bio,
    });

    res.status(201).json({
      success: true,
      token,
      user,
      message: `Operator @${user.username} successfully registered on VYORA Network`,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Registration failed' });
  }
});

// Validate current session against backend
apiRouter.get('/auth/session', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = (req.headers['x-auth-token'] as string) || (req.headers['x-user-id'] as string) || '';
    }

    if (!token) {
      return res.status(401).json({ authenticated: false, error: 'No active session token provided' });
    }

    const user = await dbAdapter.validateSession(token);
    if (!user) {
      return res.status(401).json({ authenticated: false, error: 'Session expired or invalid' });
    }

    res.json({
      authenticated: true,
      token,
      user,
    });
  } catch (err: any) {
    res.status(500).json({ authenticated: false, error: err.message });
  }
});

// Invalidate session on backend
apiRouter.post('/auth/logout', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    let token = '';
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    } else {
      token = (req.headers['x-auth-token'] as string) || '';
    }

    if (token) {
      await dbAdapter.logout(token);
    }

    res.json({ success: true, message: 'Operator session terminated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get demo accounts for quick testing
apiRouter.get('/auth/demo-accounts', (req: Request, res: Response) => {
  try {
    const accounts = dbAdapter.getDemoAccounts();
    res.json({
      accounts: accounts.map(a => ({
        ...a.user,
        defaultPassword: a.defaultPassword,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


// 1. App Configuration & Centralized Management
apiRouter.get('/config', (req: Request, res: Response) => {
  const dbStatus = dbAdapter.getStatus();
  res.json({
    appName: config.appName,
    appTagline: config.appTagline,
    appDescription: config.appDescription,
    brandIcon: config.brandIcon,
    defaultTheme: config.defaultTheme,
    defaultAccentColor: config.defaultAccentColor,
    maxPostLength: config.maxPostLength,
    enablePolls: config.enablePolls,
    enableBookmarks: config.enableBookmarks,
    enableDirectMessages: config.enableDirectMessages,
    allowMediaUploads: config.allowMediaUploads,
    enableTelemetryPulse: config.enableTelemetryPulse,
    cdnUrls: config.cdnUrls,
    databaseType: config.database.type,
    databaseStatus: dbStatus,
    endpoints: config.endpoints,
    fileEndpoints: {
      upload: '/api/upload',
      filesBase: '/api/files',
      mediaCatalog: '/api/media/catalog',
    },
    nodeVersion: process.version,
    serverUptime: Math.round(process.uptime()),
    isConfigManagedByBackend: true,
  });
});

// 2. Media Catalog & CDN Presets (Provided by Backend)
apiRouter.get('/media/catalog', (req: Request, res: Response) => {
  res.json({
    avatars: config.mediaCatalog.avatars,
    attachments: config.mediaCatalog.attachments,
    cdns: config.cdnUrls,
  });
});

// 3. File Upload Handler (Backend-Managed File Storage)
apiRouter.post('/upload', (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const { data, filename, mimeType: providedMime } = req.body;

    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'Missing file payload or data' });
    }

    let mimeType = providedMime || 'application/octet-stream';
    let base64Data = data;

    // Parse Data URL scheme if present (e.g., data:image/png;base64,....)
    if (data.startsWith('data:')) {
      const match = data.match(/^data:([a-zA-Z0-9\/+-]+);base64,(.+)$/);
      if (match) {
        mimeType = match[1];
        base64Data = match[2];
      }
    }

    const fileBuffer = Buffer.from(base64Data, 'base64');
    if (fileBuffer.length > config.fileConfig.uploadLimitBytes) {
      return res.status(413).json({
        error: `File exceeds maximum upload limit of ${Math.round(config.fileConfig.uploadLimitBytes / (1024 * 1024))}MB`,
      });
    }

    const fileId = `file_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const cleanFilename = filename || `${fileId}.${mimeType.split('/')[1] || 'bin'}`;

    const storedFile: StoredFile = {
      id: fileId,
      filename: cleanFilename,
      mimeType,
      data: fileBuffer,
      size: fileBuffer.length,
      uploadedBy: currentUserId,
      createdAt: new Date().toISOString(),
    };

    fileStorage.set(fileId, storedFile);

    // Provide the clean backend file URL and metadata to client
    const fileUrl = `/api/files/${fileId}`;

    res.status(201).json({
      success: true,
      fileId,
      url: fileUrl,
      filename: cleanFilename,
      mimeType,
      size: fileBuffer.length,
      createdAt: storedFile.createdAt,
    });
  } catch (err: any) {
    res.status(500).json({ error: `File upload failed: ${err.message}` });
  }
});

// 4. File Serving Route (Serves backend-hosted media & user uploads)
apiRouter.get('/files/:id', (req: Request, res: Response) => {
  const fileId = req.params.id;
  const file = fileStorage.get(fileId);

  if (!file) {
    return res.status(404).json({ error: 'File not found on backend server' });
  }

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', file.size);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Disposition', `inline; filename="${file.filename}"`);
  res.send(file.data);
});

// List uploaded files
apiRouter.get('/files', (req: Request, res: Response) => {
  const list = Array.from(fileStorage.values()).map(f => ({
    id: f.id,
    url: `/api/files/${f.id}`,
    filename: f.filename,
    mimeType: f.mimeType,
    size: f.size,
    uploadedBy: f.uploadedBy,
    createdAt: f.createdAt,
  }));
  res.json({ files: list });
});

// Provide transparent access to backend Node.js source code
apiRouter.get('/backend-code', (req: Request, res: Response) => {
  try {
    const files = [
      { name: 'server.ts', path: 'server.ts', description: 'Application entry point & static asset handler' },
      { name: 'server/config.ts', path: 'server/config.ts', description: 'Centralized environment & platform configuration' },
      { name: 'server/index.ts', path: 'server/index.ts', description: 'Express middleware, CORS & route registration' },
      { name: 'server/routes/api.ts', path: 'server/routes/api.ts', description: 'RESTful API controllers & validation' },
      { name: 'server/db/adapter.ts', path: 'server/db/adapter.ts', description: 'Unified data layer for PostgreSQL & resilient fallback' },
      { name: 'server/db/postgres.ts', path: 'server/db/postgres.ts', description: 'PostgreSQL connection pool & relational migrations' },
      { name: 'server/db/store.ts', path: 'server/db/store.ts', description: 'In-memory state engine & initial VYORA seed data' },
    ];

    const fileContents = files.map(f => {
      let content = '';
      try {
        content = fs.readFileSync(path.join(process.cwd(), f.path), 'utf-8');
      } catch (err: any) {
        content = `// Error reading ${f.path}: ${err.message}`;
      }
      return {
        ...f,
        code: content,
      };
    });

    res.json({ files: fileContents });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 2. CDN Health check endpoint
apiRouter.get('/cdn/health', async (req: Request, res: Response) => {
  const results = await Promise.all(
    config.cdnUrls.map(async (url) => {
      const startTime = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const response = await fetch(url, {
          method: 'HEAD',
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const latencyMs = Date.now() - startTime;
        return {
          url,
          name: new URL(url).hostname,
          status: response.ok || response.status < 500 ? 'active' : 'fallback',
          latencyMs,
          statusCode: response.status,
        };
      } catch (err: any) {
        return {
          url,
          name: new URL(url).hostname,
          status: 'offline',
          latencyMs: Date.now() - startTime,
          error: err.message,
        };
      }
    })
  );
  res.json({ cdns: results });
});

// 3. Posts Feed
apiRouter.get('/posts', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const feedType = (req.query.feed as 'for-you' | 'following') || 'for-you';
    const authorId = req.query.authorId as string | undefined;

    const posts = await dbAdapter.getPosts(currentUserId, feedType, authorId);
    res.json(posts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/posts', async (req: Request, res: Response) => {
  try {
    const authorId = getUserId(req);
    const { content, mediaUrls, pollOptions, replyToId, quotePostId } = req.body;

    if (!content || !content.trim()) {
      return res.status(400).json({ error: 'Post content cannot be empty' });
    }

    if (content.length > config.maxPostLength) {
      return res.status(400).json({ error: `Post exceeds maximum length of ${config.maxPostLength} characters` });
    }

    const newPost = await dbAdapter.createPost(
      authorId,
      content.trim(),
      mediaUrls,
      pollOptions,
      replyToId,
      quotePostId
    );

    res.status(201).json(newPost);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/posts/:id', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const result = await dbAdapter.getPostById(req.params.id, currentUserId);
    if (!result.post) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete('/posts/:id', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const success = await dbAdapter.deletePost(currentUserId, req.params.id);
    if (!success) {
      return res.status(404).json({ error: 'Post not found' });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(403).json({ error: err.message });
  }
});

// Like
apiRouter.post('/posts/:id/like', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const result = await dbAdapter.toggleLike(currentUserId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Repost
apiRouter.post('/posts/:id/repost', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const result = await dbAdapter.toggleRepost(currentUserId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Bookmark
apiRouter.post('/posts/:id/bookmark', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const result = await dbAdapter.toggleBookmark(currentUserId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Poll Vote
apiRouter.post('/posts/:id/poll/vote', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const { optionIndex } = req.body;
    if (typeof optionIndex !== 'number') {
      return res.status(400).json({ error: 'optionIndex must be a number' });
    }
    const updatedPost = await dbAdapter.votePoll(currentUserId, req.params.id, optionIndex);
    res.json(updatedPost);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 4. Users
apiRouter.get('/users', async (req: Request, res: Response) => {
  try {
    const users = await dbAdapter.getUsers();
    res.json(users);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/users/:username', async (req: Request, res: Response) => {
  try {
    const user = await dbAdapter.getUserByUsername(req.params.username);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }
    const currentUserId = getUserId(req);
    const isFollowing = await dbAdapter.isFollowing(currentUserId, user.id);
    res.json({ ...user, isFollowing });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put('/users/profile', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const updated = await dbAdapter.updateProfile(currentUserId, req.body);
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/users/:id/follow', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const result = await dbAdapter.toggleFollow(currentUserId, req.params.id);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 5. Bookmarks
apiRouter.get('/bookmarks', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const bookmarks = await dbAdapter.getBookmarks(currentUserId);
    res.json(bookmarks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 6. Notifications
apiRouter.get('/notifications', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const notifications = await dbAdapter.getNotifications(currentUserId);
    res.json(notifications);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/notifications/read-all', async (req: Request, res: Response) => {
  try {
    await dbAdapter.markNotificationsRead();
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 7. Direct Messages
apiRouter.get('/messages/:recipientId', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const messages = await dbAdapter.getMessages(currentUserId, req.params.recipientId);
    res.json(messages);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/messages', async (req: Request, res: Response) => {
  try {
    const currentUserId = getUserId(req);
    const { recipientId, text } = req.body;
    if (!text || !text.trim() || !recipientId) {
      return res.status(400).json({ error: 'recipientId and text are required' });
    }
    const message = await dbAdapter.sendMessage(currentUserId, recipientId, text.trim());
    res.status(201).json(message);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 8. Trends
apiRouter.get('/trends', async (req: Request, res: Response) => {
  try {
    const trends = await dbAdapter.getTrends();
    res.json(trends);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});
