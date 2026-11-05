<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Zunari

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/a7a57c47-7bac-4327-bbd0-7069371fe47b

## Run Locally

**Prerequisites:** Node.js 22+ and private Neon PostgreSQL and Backblaze B2 buckets.

1. Install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL`, `B2_ENDPOINT`, `B2_REGION`,
   `B2_BUCKET`, `B2_KEY_ID`, and `B2_APPLICATION_KEY`. Keep these values server-side.
3. Configure the B2 bucket as private. Its CORS rules must allow your app origin to send
   `PUT` requests with the `Content-Type` header.
4. Review the SQL files in `server/db/migrations/` and take a database backup.
5. After separately approving database writes, apply migrations with `npm run db:migrate`.
6. To preserve existing SQLite accounts and sessions, review the import report from
   `npm run db:import-sqlite`. After separately approving database writes, apply the
   import with `npm run db:import-sqlite -- --apply`. The import aborts on conflicts.
7. Optionally add the built-in demo accounts and sample posts with `npm run db:seed-demo`.
   This is an explicit write command; do not run it against production without approval.
8. Start local development with `npm run dev`. For production, build the frontend and
   compiled backend with `npm run build`, then start it with `npm start`. The production
   runtime requires Node.js and the production dependencies; it does not require `tsx`.

The application does not run migrations or insert demo data automatically. Its API
requires the migrated Zunari schema at startup. Existing SQLite files are never modified
or removed.

The legacy SQLite database contains accounts, sessions, and password-reset records only.
Posts, follows, messages, and other social records were previously held in process memory,
so records lost when the old process stopped cannot be imported. New social activity is
persisted in PostgreSQL.

## Database rollback

Migrations are forward-only and do not drop or truncate data. If a deployment fails,
stop the application and restore the pre-migration database backup into a separate
database, then point `DATABASE_URL` at that restored database. Do not roll back by
dropping tables or deleting migration records. Fixes to an applied schema must use a
new, additive migration.

## Media uploads

The frontend requests a short-lived upload URL, uploads directly to the private B2 bucket,
then asks the backend to verify and register the object. App media references remain
`/api/files/<id>`; the backend checks visibility and returns a short-lived signed download.
Abandoned or incomplete uploads are cleaned up by the server.

## Realtime messages

Socket.IO authenticates with the existing session cookie. Message records are committed
before recipient events are emitted. The HTTP message API remains available for initial
history and as a reconnect fallback.
