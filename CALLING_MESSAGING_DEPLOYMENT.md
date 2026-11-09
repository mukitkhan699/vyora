# Zunari — Messaging & Calling System: Test Deployment & Operations Manual

This document details the configuration, deployment, verification, and operational guidelines for the complete Messaging and Calling system in Zunari.

---

## 1. Required Environment Variables

All variables below must be supplied securely server-side. Do not expose secrets or prefix them with `VITE_`.

| Variable | Description | Example / Default | Required In |
|---|---|---|---|
| `DATABASE_URL` | Neon PostgreSQL pooled connection string for application runtime queries. | `postgresql://user:pass@ep-xyz-pooler.us-east-2.aws.neon.tech/neondb?sslmode=require` | Production & Test |
| `DATABASE_URL_DIRECT` | Neon PostgreSQL direct unpooled connection string (required for running transactional schema migrations with advisory locks). | `postgresql://user:pass@ep-xyz.us-east-2.aws.neon.tech/neondb?sslmode=require` | Migration runner / Build |
| `B2_ENDPOINT` | Backblaze B2 S3 API endpoint. Must use HTTPS. | `https://s3.us-west-004.backblazeb2.com` | Production & Test |
| `B2_REGION` | Backblaze B2 storage region. | `us-west-004` | Production & Test |
| `B2_BUCKET` | Private B2 bucket name. | `zunari-media-private` | Production & Test |
| `B2_KEY_ID` | Backblaze Application Key ID. | `004xxxxxxxxxxxx0000000001` | Production & Test |
| `B2_APPLICATION_KEY` | Backblaze Application Key secret. | `K004xxxxxxxxxxxxxxxxxxxxxxx` | Production & Test |
| `LIVEKIT_URL` | LiveKit Cloud or Server WebSockets endpoint. | `wss://zunari-xxxx.livekit.cloud` | Calling |
| `LIVEKIT_API_KEY` | LiveKit Project API key. | `APIxxxxxxxxxxxx` | Calling |
| `LIVEKIT_API_SECRET` | LiveKit Project API secret key (minimum 32 characters). | `secret_xxxxxxxxxxxxxxxxxxxxxxxx` | Calling |
| `RATE_LIMIT_HMAC_SECRET` | Secret key for hashing client IP addresses in database rate limit tables. | `openssl rand -hex 32` | Production & Test |
| `APP_URL` | Origin of the main web application. | `https://zunari.example.com` | Production & Test |
| `ADMIN_ORIGIN` | Origin of the admin web application for CORS. | `https://admin-zunari.example.com` | Production & Test |
| `COOKIE_SECURE` | Enforces `Secure` flag on session cookies (`true` in production with HTTPS). | `true` | Production |

---

## 2. Render Startup Configuration & `DATABASE_URL_DIRECT` Architecture

### Architectural Separation
Normal application server startup (`npm start` or `npm run dev`) is completely decoupled from schema migration execution (`npm run db:migrate`):
1. **Application Server Runtime (`npm start`)**:
   - Operates entirely on the pooled `DATABASE_URL` via PgBouncer.
   - Does **not** require or validate `DATABASE_URL_DIRECT`.
   - On startup, executes `verifyDatabase()` to verify that all required tables exist (including `zunari_conversations_v2`, `zunari_messages_v2`, `zunari_call_sessions`).
   - If the database has not been migrated, it fails fast with an explicit error: `Zunari database schema is not installed or pending migrations. Run the approved migration command (npm run db:migrate).` This guarantees the application never runs against an unmigrated or broken schema.
2. **Migration Runner (`npm run db:migrate`)**:
   - Strictly enforces `DATABASE_URL_DIRECT`.
   - Connects directly to PostgreSQL (bypassing PgBouncer connection pooling) to acquire session-level advisory locks (`pg_advisory_lock`), execute DDL statements within transactions, and record migration checksums in `zunari_schema_migrations`.
   - If `DATABASE_URL_DIRECT` is absent, the migration command fails immediately with: `DATABASE_URL_DIRECT is required for migrations. Provide an unpooled PostgreSQL direct connection URL.`

### Step-by-Step Render Deployment Procedure
To safely execute migrations and start the application on Render:
1. In the **Render Dashboard -> Environment Settings**:
   - Set `DATABASE_URL` to your Neon pooled connection string (`...-pooler...`).
   - Set `DATABASE_URL_DIRECT` to your Neon direct unpooled connection string.
2. In the **Render Build Command**:
   ```bash
   npm ci --include=dev && npm run build
   ```
3. In the **Render Pre-Deploy Command** (under Settings -> Build & Deploy):
   ```bash
   npm run db:migrate
   ```
   *Why this is safe*: Render runs the Pre-Deploy command in a standalone ephemeral container before any new web server instances are started. If `npm run db:migrate` fails, the deployment is aborted immediately and existing web traffic is never routed to a broken deployment. Once migrations succeed, Render starts the web server container with `npm start`.

---

## 3. Database Migration Requirements (`006_complete_messaging_and_calling.sql`)

1. **Ordering & Idempotency**:
   - `006_complete_messaging_and_calling.sql` runs after migrations `001` through `005`.
   - The file contains guards (`to_regclass`) checking prerequisites.
   - All `CREATE TABLE IF NOT EXISTS` and `INDEX IF NOT EXISTS` are idempotent.
2. **Backfill Behavior**:
   - Existing 1:1 records from `zunari_conversations` and `zunari_messages` are cleanly migrated into `zunari_conversations_v2` and `zunari_messages_v2`.
   - The original tables are kept intact without data loss.
3. **Execution**:
   ```bash
   npm run db:migrate
   ```

---

## 4. LiveKit Cloud Setup Instructions

1. **Create Project**:
   - Sign up or log into [LiveKit Cloud](https://cloud.livekit.io/).
   - Create a project named `zunari-media`.
2. **Keys**:
   - Navigate to **Project Settings -> Keys**.
   - Copy the `WebSocket URL` (`wss://...`), `API Key`, and `API Secret`.
   - Add them to your environment variables as `LIVEKIT_URL`, `LIVEKIT_API_KEY`, and `LIVEKIT_API_SECRET`.
3. **Webhook Configuration**:
   - In LiveKit Cloud console, go to **Settings -> Webhooks**.
   - Add endpoint URL: `https://<YOUR_APP_DOMAIN>/api/calls/webhook`.
   - Select events: `room_finished`, `participant_joined`, `participant_left`.

---

## 5. Storage Lifecycle and Attachment Retention Rules

1. **Uploads**:
   - Media uploaded for chats uses purpose `message-attachment`. Supported formats: Images (JPEG, PNG, GIF, WebP), Video (MP4, WebM), Audio (MP3, OGG, WAV), Documents (PDF, text).
   - Maximum size: 25MB.
2. **Delivery Tracking**:
   - Every recipient's delivery and read timestamps are recorded individually in `zunari_attachment_deliveries`.
3. **Approved Cleanup**:
   - When all intended recipients have received the attachment, the temporary B2 object is queued and deleted from B2.
   - If an attachment remains unreceived after 7 days (`expires_at <= now()`), it is deleted from B2.
   - Message text, reactions, receipts, and history are **never deleted**.

---

## 6. Manual Test Scenarios

### Scenario A: 1-to-1 Private Messaging & Receipts
1. Open two browser windows: User A and User B.
2. User A opens Messages, selects User B, and sends "Hello B!".
3. Verify User B receives the message in real time without refreshing.
4. Verify User A's message indicator changes from single tick (Sent) to double tick (Delivered) and turns blue upon read.
5. User B reacts with an emoji (e.g. 👍); verify User A sees the reaction counter update instantly.

### Scenario B: Group Conversation & Participant Management
1. User A clicks the group icon and selects User B and User C to create "Launch Team".
2. User A sends a message; verify both User B and User C receive it.
3. User A opens Group Details and adds User D.
4. User B leaves the group; verify User B can no longer send messages, but historical messages remain intact.

### Scenario C: 1-to-1 Voice & Video Call
1. In a direct conversation between User A and User B, User A clicks the Video Call button.
2. User B sees the incoming call banner with "Incoming video transmission...".
3. User B clicks Accept.
4. Both participants connect to the LiveKit room, local & remote video tiles display, and call duration counter starts.
5. User A toggles microphone mute and camera off; verify state changes smoothly.
6. User B clicks End Call; verify both windows return to the chat view cleanly.

---

## 7. Known Limitations & Cost Assessment

1. **Free Tier Limitations**:
   - **Neon PostgreSQL**: Free tier provides 0.5 GB storage and auto-suspends on idle after 5 minutes. Cold-start connection delays (~1.5s) may occur on the first request after inactivity.
   - **Backblaze B2**: Free tier includes 10 GB storage and 3x free download bandwidth per day.
   - **LiveKit Cloud**: Free tier includes 50 GB/month data transfer and up to 100 simultaneous participant minutes/month.
2. **Group Call Participant Cap**:
   - Configured with a default limit of 8 concurrent participants per group call to protect server bandwidth and client CPU performance.
3. **E2E Encryption**:
   - In-transit encryption is enforced via WebRTC DTLS/SRTP for LiveKit and TLS for HTTPS/WSS. Application-level end-to-end payload encryption across browser storage is not currently implemented.
