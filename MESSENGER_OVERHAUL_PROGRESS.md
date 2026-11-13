# Zunari Messenger — Complete Overhaul Progress

Last updated: 2026-11-11
Branch: `feature/messenger-complete-overhaul`
Repository: https://github.com/mukitkhan699/vyora.git
Local path: `/home/kali/vyora` (lowercase — `/home/Kali/vyora` does not exist)

> This file is the handoff contract for Kilo. Update it after every meaningful checkpoint.

---

## 1. Status snapshot

- Phase A (audit): complete.
- Phase B (design tokens / UI architecture): complete — dark tokens aligned to the approved palette.
- Phase C (core messenger redesign): complete for shell, list, header, bubbles, composer, empty states.
- Phase D (remaining UI): mostly complete; manual responsive QA pending.
- Phase E (messaging / persistence / offline): complete — all 16 confirmed defects repaired.
- Phase F (attachments / groups / security): complete — authorization, eviction, and cleanup fixes landed.
- Phase G (performance / testing): complete — lint, server typecheck, build, and 110 tests pass.

Safe checkpoint commits are listed in §10.

---

## 2. Environment / commands

`npm` is NOT installed on this machine. Use **pnpm**.

```bash
cd /home/kali/vyora
pnpm run lint            # tsc --noEmit
pnpm test                # 110 tests (88 baseline + utility/security contracts)
pnpm run typecheck:server
pnpm run build           # vite build + tsc server + copy migrations
```

IndexedDB tests under `src/lib/messaging/*.test.ts` are **still not** part of `pnpm test`.
Node has no IndexedDB; those tests need `fake-indexeddb` or a browser runner.
`src/utils/messaging.test.ts` **is now included** in `pnpm test`.

---

## 3. Architecture (as found)

- React 19 + TypeScript + Vite, Tailwind v4 (`src/index.css` custom `z-*` tokens/utilities).
- Backend: Node + Express-like custom router, Socket.IO (`server/realtime.ts`), PostgreSQL (`server/db/*`), Backblaze B2 (`server/storage/*`).
- Client cache: IndexedDB via `src/lib/messaging/*` (`zunari-messaging`, v1).
- Virtualisation: `@tanstack/react-virtual` in `src/components/messages/VirtualizedMessageList.tsx`.
- Existing Zunari dark/champagne token set already exists in `src/index.css`.

---

## 4. Confirmed bugs and root causes

> Repair status: all 16 items below are fixed on this branch. The text is kept as an audit trail.

### Critical (messaging data loss / stale UI)

1. **Initial messenger data is never fetched directly.**
   `MessagesView.refreshConversations()` only calls `loadConversations()` which reads IndexedDB.
   `loadMessages()` only reads IndexedDB. Server data reaches IndexedDB only indirectly through
   `useSyncStatus` (rendered by `OfflineIndicator`) and its background `syncAll()`.
   React state is not notified when that background sync finishes, so the inbox/messages can stay
   empty or stale until another event triggers a refresh.
   **Root cause:** cache-first loaders have no network phase and no change notification.

2. **Malformed IndexedDB compound-index ranges.**
   `message-store.getMessages()` and `getMessagesForSync()` use
   `IDBKeyRange.only(conversationId)` on the compound index
   `conversationId_createdAt (['conversationId','createdAt'])`.
   A string key never matches an array index key, so cached messages are never returned.
   **Root cause:** wrong key range for compound index.

3. **`saveConversation()` drops `lastMessage`.**
   `src/hooks/useMessagingDB.ts` destructures `lastMessage` out and never stores it.
   After navigation/refresh the inbox preview is blank even though the conversation row exists.
   **Root cause:** conversion to `StoredConversation` omits `lastMessage`.

4. **Sent messages are not persisted.**
   `handleSend()` updates React state and `saveConversation()` but never calls `saveMessage(response.message)`.
   Switching conversations/refreshing loses the message until another server sync happens.
   **Root cause:** missing IndexedDB write in the send success path.

5. **Optimistic messages are not persisted, and outbox sends do not reconcile.**
   Offline/failed optimistic messages exist only in React state. `useOutbox.processOutbox()`
   sends the message and removes the outbox row but discards the server response and never
   updates local messages/conversation. Refresh loses queued/failed messages visually.
   Additionally outbox retry exhaustion (`MAX_RETRIES`) **deletes** the unsent message — violates
   “never silently discard unsynchronized user messages”.
   **Root cause:** outbox processor is disconnected from the messaging cache/UI.

6. **Two independent outbox processors run concurrently** (`useOutbox` every 5 s and
   `useMessagingDB` sync engine every 10 s). Idempotency prevents duplicate server rows, but
   UI/cache updates race and only one path persists results.
   **Root cause:** duplicated responsibility.

7. **Realtime edit/delete/receipt/reaction events do not update the UI.**
   Active-conversation listeners for `message-edit`/`message-delete` only write IndexedDB;
   receipt/reaction handlers are empty. Duplicate global listeners exist too.
   **Root cause:** incomplete event handlers; no state update.

8. **Inactive-conversation incoming messages are not persisted as conversation metadata.**
   `conversation:message-notification` only refreshes conversations from IndexedDB; nothing
   updates the stored `lastMessage`/`unreadCount`.
   **Root cause:** notification path does not persist.

9. **Cached messages lose sender and reply context.** `StoredMessage` has no `sender` or
   `replyToMessage`, so cached group names/avatars and quoted replies disappear offline.
   **Root cause:** incomplete serialization model.

10. **Nested scroll containers break virtualisation.**
    `MessagesView` wraps `VirtualizedMessageList`, which creates its own `overflow-y-auto`
    with `height:100%`. `scrollRef` (the outer container) therefore never scrolls, so
    auto-scroll-to-bottom, “new messages” jump, and older-message scroll restoration do not work.
    **Root cause:** parent and virtualizer disagree about the scroll element.

### Security / authorization

11. **IDOR in reactions.** `toggleReaction()` validates conversation membership but never checks
    that `messageId` belongs to that conversation. A member of conversation A can add/remove
    reactions on a message in conversation B if they know its id.
12. **IDOR in receipts.** `recordReceipts()` validates membership but not that the supplied
    message ids belong to the conversation; a user can write receipts for foreign messages.
13. **Duplicate realtime publish on idempotent send.** `sendMessage()` returns an existing row for
    a repeated `clientId`, and the route publishes it again to recipients (duplicate notification
    / refresh churn). Needs a `duplicate` signal so the route can skip publishing (or publish a
    harmless ack).
14. **Historical message leak after leaving.** `getLastMessage()` does not filter by the
    participant's `left_at`, so a departed member can receive messages created after they left via
    conversation detail. `getMessages()` already applies the historical cut-off and is the model
    to follow.

### Product-policy gaps (do not change policy)

15. Group message deletion is currently allowed immediately. Policy says deletion only after all
    recipients have received the message. Needs enforcement + clear error handling.
16. Undelivered attachment TTL is 7 days (already implemented in `sendMessage` and cleanup).
    File-size policy is configurable (currently client hard-codes 10 MB; server config exists).

---

## 5. Design decisions / tokens

Direction: premium dark, 80% minimal / 20% personality, restrained champagne accent.

Current tokens live in `src/index.css` under `:root, .theme-dark` (`--z-*`).
Refinements applied in this branch:

- `--z-bg: #111315`
- `--z-surface: #171A1D`
- `--z-surface-2: #1B1E21`
- `--z-surface-3: #24282C`
- `--z-text: #E8E6E0`
- `--z-text-secondary: #A4A6A7`
- `--z-accent: #D5B77A`
- borders: translucent warm grey derived from `#303438`
- bubble-in `#1B1E21`, bubble-out `#2A2620` with champagne border
- typography: system UI stack with optional Inter/SF Pro first; `z-display` tightened tracking
- motion: 160–240 ms, respects `prefers-reduced-motion`

---

## 6. Files created / modified

Created:
- `MESSENGER_OVERHAUL_PROGRESS.md`
- `server/messaging-security.test.ts`

Modified:
- `package.json` (test suite includes messaging utility + security contracts)
- `src/index.css` (dark `--z-*` tokens aligned to the approved palette)
- `src/lib/messaging/database.ts` (sender/reply snapshots on `StoredMessage`)
- `src/lib/messaging/message-store.ts` (compound key ranges + conversation guards)
- `src/lib/messaging/sync-engine.ts` (exported converters; outbox ownership removed)
- `src/hooks/useMessagingDB.ts` (persist `lastMessage`, sender/reply; single outbox owner)
- `src/hooks/useCacheFirstLoaders.ts` (cache-first + server reconciliation + persistence)
- `src/hooks/useOutbox.ts` (single processor, recovery, never discards, reconciles cache/UI)
- `src/components/messages/MessagesView.tsx` (network phase, persistence, realtime handlers, retry)
- `src/components/messages/VirtualizedMessageList.tsx` (single scroll container, dynamic measurement)
- `src/components/messages/MessageComposer.tsx` (offline queueing enabled)
- `server/db/messaging.ts` (IDOR fixes, duplicate signal, left_at cutoff, group delete policy)
- `server/routes/messaging.ts` (duplicate publish guard, socket eviction)
- `server/realtime.ts` (typing authorization, per-socket membership, eviction helper)
- `server/storage/attachments.ts` (delete-before-mark cleanup with retry)
- `server/storage/b2.ts` (attachment download respects `left_at`)

---

## 7. Tests executed (exact results)

Baseline before changes (main @ 655bd89):

- `pnpm run lint` → PASS (tsc --noEmit, no output)
- `pnpm test` → PASS 88 / 88, 17 suites, 0 fail, ~10 s

Current branch (`feature/messenger-complete-overhaul`):

- `pnpm run lint` → PASS (tsc --noEmit, no output)
- `pnpm run typecheck:server` → PASS
- `pnpm test` → PASS 110 / 110, 26 suites, 0 fail, ~14 s
- `pnpm run build` → PASS (client + server + migrations copied; only the pre-existing Vite `__dirname` and chunk-size warnings)

---

## 8. Database / migrations

- No schema changes made or planned for the messenger repairs. Fixes are client cache + backend
  authorization/query logic. Any schema change requires explicit approval.
- IndexedDB: adding optional `sender`/`replyToMessage` fields to the existing `messages` object
  store does not require a version bump (schemaless values). No destructive upgrade.

---

## 9. Known risks / assumptions

- `/home/Kali/vyora` is case-sensitive; real path is `/home/kali/vyora`.
- Backend integration tests requiring Neon/B2 are not runnable here; only unit/contract tests run.
- Calling changes are out of scope for deployment; test-only.
- `useSyncStatus` is global via `OfflineIndicator`; changing its sync cadence affects the whole app.
- The repo already contains substantial prior Zunari redesign work; this branch refines and
  repairs rather than discarding it.

---

## 10. Commits / checkpoints

- (baseline) `655bd89` on `main`
- Branch created: `feature/messenger-complete-overhaul`
- See `git log --oneline main..HEAD` for this branch’s commits.

---

## 11. Exact next tasks (priority order)

1. ~~Fix IndexedDB compound ranges and persist `lastMessage`, sender, reply context.~~ DONE
2. ~~Add network phase to conversation/message loaders; notify React after sync/outbox.~~ DONE
3. ~~Persist optimistic/sent/edited/deleted/reacted messages; reconcile outbox sends.~~ DONE
4. ~~Single outbox processor; never discard failed messages; surface retry.~~ DONE
5. ~~Handle realtime edit/delete/receipt/reaction/notification events in state + cache.~~ DONE
6. ~~Fix virtualised scroll integration (single scroll container).~~ DONE
7. ~~Backend: reaction/receipt ownership checks, duplicate-send publish guard, historical last
   message cutoff, group deletion policy.~~ DONE
8. ~~UI polish pass on tokens, list/header/bubbles/composer/empty states.~~ DONE
   Remaining: manual responsive QA at 360 / 768 / 1280 px and keyboard-only pass.
9. ~~Run lint/tests/build; add regression tests; update this file.~~ DONE
10. Manual QA against a live backend (send/edit/delete/react/receipt, offline queue, reconnect,
    group add/remove/leave, attachment expiry, two-browser realtime).
11. Review `git diff` and create a checkpoint commit **only when explicitly requested**.

---

## 12. Verification for Kilo

```bash
cd /home/kali/vyora
git status
git branch --show-current          # feature/messenger-complete-overhaul
pnpm run lint
pnpm test
pnpm run build
```

Manual two-user flow (needs configured `.env` with Neon + B2):
1. User A sends text/attachment to User B; B sees it live.
2. Refresh B: history + preview persist.
3. B goes offline, sends; refresh while offline → message still shown as pending.
4. Reconnect → queued message sends once (no duplicate), status updates to sent/delivered/read.
5. Edit/delete/reaction reflect live on both clients and survive refresh.
6. Group: create, add/remove member, unread counts, leave; deletion policy enforced.
7. Long history: 100 / 1,000 / 5,000 / 10,000 messages — scroll and load older.
