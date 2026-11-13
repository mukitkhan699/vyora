import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';

const source = readFileSync(new URL('./db/messaging.ts', import.meta.url), 'utf8');
const membershipMigration = readFileSync(
  new URL('./db/migrations/008_conversation_membership_epochs.sql', import.meta.url),
  'utf8',
);

function methodSource(methodName: string): string {
  const start = source.indexOf(`public async ${methodName}(`);
  assert.notEqual(start, -1, `Missing ${methodName} implementation.`);
  const nextMethod = source.indexOf('\n  public async ', start + 1);
  return source.slice(start, nextMethod < 0 ? undefined : nextMethod);
}

describe('Conversation membership publication locks', () => {
  test('direct conversation rejoin locks the conversation before reactivating members', () => {
    const body = methodSource('getOrCreateDirectConversation');
    assert.ok(
      body.indexOf('lockConversationForMembershipChange(client, existing.rows[0].id)') <
        body.indexOf('SET left_at = NULL'),
    );
    assert.match(body, /SET left_at = NULL, joined_at = \$3[\s\S]*left_at IS NOT NULL/);
  });

  test('group addition locks the conversation before inserting or reactivating members', () => {
    const body = methodSource('addGroupParticipants');
    assert.match(body, /SELECT type FROM zunari_conversations_v2 WHERE id = \$1 FOR UPDATE/);
    assert.match(body, /DO UPDATE SET left_at = NULL, joined_at = \$3/);
  });

  test('group removal, leaving, and owner promotion share the conversation update lock', () => {
    const body = methodSource('removeGroupParticipant');
    assert.match(
      body,
      /SELECT type, created_by FROM zunari_conversations_v2 WHERE id = \$1 FOR UPDATE/,
    );
    assert.match(body, /SET left_at = \$1[\s\S]*?SET role = 'owner'/);
  });

  test('all participant left_at writes are confined to the coordinated paths', () => {
    const leftAtWrites = [...source.matchAll(/SET left_at\s*=/g)];
    assert.equal(leftAtWrites.length, 3);
    const coordinatedMethods = [
      methodSource('getOrCreateDirectConversation'),
      methodSource('addGroupParticipants'),
      methodSource('removeGroupParticipant'),
    ].join('\n');
    assert.equal([...coordinatedMethods.matchAll(/SET left_at\s*=/g)].length, 3);
  });

  test('database trigger coordinates direct membership updates and changes rejoin epochs', () => {
    assert.match(
      membershipMigration,
      /BEFORE UPDATE OF left_at OR DELETE[\s\S]*EXECUTE FUNCTION zunari_coordinate_conversation_membership_change/,
    );
    assert.match(
      membershipMigration,
      /FROM zunari_conversations_v2[\s\S]*FOR UPDATE[\s\S]*NEW\.membership_epoch := gen_random_uuid\(\)/,
    );
  });
});
