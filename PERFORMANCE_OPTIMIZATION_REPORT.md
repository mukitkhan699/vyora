# Zunari Performance Optimization Report

## Summary

Implemented a shared, account-scoped in-memory query cache for frequently reused API resources, wired it into the main social views, and removed private API responses from Service Worker Cache Storage. Messaging continues to use its existing account-scoped IndexedDB cache. The conversation preview query now selects only the latest message per conversation in SQL.

## Bottlenecks found

- Feed, profile, explore, notifications, bookmarks, post details, and sidebar components fetched directly on mount. App tab switching unmounts views, so returning to a view repeated those requests.
- Several resources had overlapping callers: trends in Explore and the right sidebar; user lists in authentication and Explore; notifications in authentication and the notification view; and the `for-you` feed in Timeline, Explore, and profiles.
- Views set loading state on every mount, even when the same data had just been loaded.
- Explore downloaded the existing feed and user-list resources and filtered them in the browser; there is no search-specific client query or pagination API in these call sites.
- The Service Worker cached every successful API GET response and could return those responses offline. That included private, account-specific data. The old worker also contained TypeScript syntax in a `.js` file and an `await` in a non-async handler.
- `getLastMessagesForConversations` selected matching message rows and reduced them in application code, despite needing only one latest message per conversation.
- Existing messaging reads already use account-keyed IndexedDB, and live message edits, deletes, receipts, and reactions update local state/storage through Socket.IO listeners.

## Architecture and coverage

`src/services/queryCache.ts` provides keyed snapshots, in-flight request deduplication, TTL expiry, stale-while-revalidate, subscriptions, mutation updates, bounded memory use, and protection against late responses repopulating a cleared account cache. `src/services/api.ts` applies the cache to allowlisted GET resources; `src/hooks/useApiQuery.ts` exposes cached data to React views so stale data can render without a blocking skeleton.

| Resource | Policy |
|---|---:|
| App config | 5 minutes |
| Trends | 60 seconds |
| User directory and username profiles | 60 seconds |
| Feed pages, profile posts, and post details | 30 seconds |
| Bookmarks | 20 seconds |
| Notifications | 15 seconds |
| Auth/session, admin, conversation/message APIs | Not cached by this layer |

Messaging retains its existing persistent IndexedDB cache, partitioned by account ID and cleared on logout. Feed, profile, notification, and other private API data remain memory-only: no access token, session, or private response is persisted across reloads. On account changes, the in-memory cache is cleared and each request key is scoped to the current account and cache generation.

## Invalidation and real-time behavior

- Like/repost/bookmark results update matching cached posts. Create/delete operations update feed, profile-post, bookmark, and post-detail caches; reply counts and thread replies are kept in step.
- Profile edits update profile/user-directory and embedded post-author data. Follow changes update the user/profile entries and revalidate the following feed.
- Mark-all-read updates cached notification records and the unread count.
- Like, repost, bookmark, and follow controls update optimistically and restore the prior value if the mutation fails.
- Existing messaging Socket.IO listeners update the active message list and account-scoped local store instead of refetching full message histories. Feed/notification socket events were not added because no matching client event contract was found in the audited call sites.
- The Service Worker now caches only the app shell and build assets. It deletes the prior `zunari-v1` cache to remove legacy API entries and never intercepts API or Socket.IO requests.

## Backend change

The conversation preview query now returns at most one latest-message row per conversation, rather than returning all matching messages for application-side reduction. For `N` matching messages and `K` conversations, transferred/processed result rows fall from `N` to at most `K`; this does not establish a reduction in database scan work. No schema/index change was made without an examined query plan.

## Request counts and loading measurements

No authenticated browser/network trace or before/after runtime page timing was available in this environment. The following are call-site-derived counts, not measured production traffic. Counts assume revisits occur within the stated TTL and a successful first load.

| Navigation/resource flow | Before: mount-triggered requests | After: network requests |
|---|---:|---:|
| Home → Explore → Home (`for-you` feed) | 3 | 1 within 30 seconds (2 fewer; 67% reduction) |
| Sidebar → Explore trends | 2 | 1 within 60 seconds |
| Auth notification count → Notifications view | 2 | 1 within 15 seconds |
| Auth user list → Explore people | 2 | 1 within 60 seconds |
| Revisit a loaded profile (profile + posts) | 2 per visit | 0 foreground requests within TTL; stale content revalidates in background |

The cache unit test verifies that two simultaneous callers invoke one loader, and that stale content is returned before the background refresh completes. Warm cache hits resolve from memory; cached views report no initial loading state. Cold-load and end-to-end rendering timings were not measured.

## Verification

- `pnpm test`: 273 tests passed.
- `pnpm build`: public and admin production builds passed. Vite still warns that the main public JavaScript bundle is about 1.2 MB (about 323 KB gzip).
- `pnpm typecheck:server` and `pnpm typecheck:tests`: passed.
- Focused TypeScript check of changed frontend modules: passed.
- `node --check public/sw.js`, `git diff --check`, and five query-cache unit tests: passed.
- Full `pnpm lint` remains failing on existing unrelated issues in admin components, ZCC files, and design tokens; no errors were reported for the changed frontend modules.
- A separately invoked messaging cache-manager test cannot run in plain Node because IndexedDB is unavailable in that test environment; the configured project test suite passed.

## Remaining work and bottlenecks

- Feed/search endpoints and views still lack cursor pagination/infinite scrolling. Explore filters existing responses client-side; changing this needs a coordinated API contract and should be measured before implementation.
- Conversation list retrieval remains unpaginated. Receipt updates and attachment delivery still contain repeated database operations identified in the audit.
- Some realtime events are emitted to overlapping rooms, and presence updates are globally broadcast; changing fanout requires checking client delivery semantics.
- Database indexes were not added without query plans/production cardinality data. The latest-message SQL change still needs an `EXPLAIN ANALYZE` benchmark.
- The public JavaScript bundle exceeds Vite's 500 KB warning threshold; code splitting and image delivery remain candidates.
- Runtime request counts, payload sizes, and page-load timings should be captured with an authenticated browser session before making stronger performance claims.
