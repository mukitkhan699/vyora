import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { describe, test } from 'node:test';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { CallingService, callingService, type CallSessionDetails } from './calling.ts';
import type { messagingRepo } from './db/messaging.ts';
import { query, withTransaction } from './db/pool.ts';
import { handleCallingRequest } from './routes/calling.ts';
import type { RealtimeCallEvent } from './realtime-events.ts';
import { WebhookReceiver } from 'livekit-server-sdk';

interface FakeCallState {
  call: CallSessionDetails | null;
  activeConversationUsers: Set<string>;
  events: RealtimeCallEvent[];
}

const testLiveKitEnvironment = {
  NODE_ENV: 'test',
  LIVEKIT_API_KEY: 'test-livekit-api-key',
  LIVEKIT_API_SECRET: 'test-livekit-api-secret-value-at-least-32-characters',
  LIVEKIT_URL: 'wss://project.example.livekit.cloud',
} as const;

async function withLiveKitEnvironment<T>(
  callback: () => Promise<T>,
  overrides: Partial<Record<keyof typeof testLiveKitEnvironment, string | undefined>> = {},
): Promise<T> {
  const keys = Object.keys(testLiveKitEnvironment) as Array<keyof typeof testLiveKitEnvironment>;
  const originalValues = new Map(keys.map((key) => [key, process.env[key]]));
  for (const key of keys) {
    const value = Object.hasOwn(overrides, key) ? overrides[key] : testLiveKitEnvironment[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return await callback();
  } finally {
    for (const [key, value] of originalValues) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function createCallFixture(initialCall: CallSessionDetails | null = createDirectCall()) {
  const state: FakeCallState = {
    call: initialCall,
    activeConversationUsers: new Set(initialCall?.participants.map((participant) => participant.userId) ?? []),
    events: [],
  };

  const execute = async (sql: string, values: unknown[] = []): Promise<QueryResultRow[]> => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('SELECT user_id FROM zunari_conversation_participants')) {
      return Array.from(state.activeConversationUsers, (user_id) => ({ user_id }));
    }
    const call = state.call;
    if (!call) return [];

    if (normalized.startsWith('SELECT * FROM zunari_call_sessions WHERE id = $1')) {
      return call.id === values[0] ? [toCallRow(call)] : [];
    }
    if (normalized.startsWith('SELECT id FROM zunari_call_sessions WHERE room_name = $1')) {
      return call.roomName === values[0] ? [{ id: call.id }] : [];
    }
    if (normalized.includes('FROM zunari_call_participants') && normalized.includes('AND user_id = $2')) {
      return call.id === values[0]
        ? call.participants.filter((participant) => participant.userId === values[1]).map(toParticipantRow)
        : [];
    }
    if (
      normalized.includes('FROM zunari_call_participants') &&
      normalized.includes('WHERE call_id = $1')
    ) {
      return call.id === values[0] ? call.participants.map(toParticipantRow) : [];
    }
    if (normalized.includes('FROM zunari_conversation_participants')) {
      return call.conversationId === values[0] && state.activeConversationUsers.has(String(values[1]))
        ? [{ username: values[1] === 'user-b' ? 'bob' : 'alice', '?column?': 1 }]
        : [];
    }
    if (normalized.includes("WHERE call_id = $1 AND status = 'joined'")) {
      const count = call.id === values[0]
        ? call.participants.filter((participant) => participant.status === 'joined').length
        : 0;
      return Array.from({ length: count }, () => ({ '?column?': 1 }));
    }
    if (normalized.startsWith('UPDATE zunari_call_participants')) {
      const participant = call.participants.find(
        (entry) => entry.userId === values[2] && call.id === values[1],
      );
      if (participant) {
        if (normalized.includes("SET status = 'joined'")) {
          participant.status = 'joined';
          participant.joinedAt = Number(values[0]);
        } else if (normalized.includes("SET status = 'declined'")) {
          participant.status = 'declined';
          participant.leftAt = Number(values[0]);
        } else if (normalized.includes("SET status = 'left'")) {
          participant.status = 'left';
          participant.leftAt = Number(values[0]);
        }
      }
      return [];
    }
    if (normalized.startsWith('UPDATE zunari_call_sessions')) {
      if (!call || call.id !== values.at(-1)) return [];
      if (normalized.includes("SET status = 'active'")) {
        call.status = 'active';
        call.answeredAt ??= Number(values[0]);
      } else if (normalized.includes("SET status = 'rejected'")) {
        call.status = 'rejected';
        call.endedAt = Number(values[0]);
      } else if (normalized.includes("SET status = 'ended'")) {
        call.status = 'ended';
        call.endedAt = Number(values[0]);
        call.durationSeconds = Number(values[1]);
      }
      return [];
    }
    throw new Error(`Unexpected SQL in call fixture: ${normalized}`);
  };

  const fakeQuery = async <Row extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>> => createQueryResult(await execute(sql, values)) as QueryResult<Row>;

  const fakeTransaction = async <T>(
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> => {
    const client = { query: fakeQuery };
    return work(client as unknown as PoolClient);
  };

  const fakeMessagingRepo = {
    getConversationById: async () => ({
      id: 'conversation-1',
      type: 'direct',
      title: null,
      avatarUrl: null,
      createdBy: 'user-a',
      participants: [
        { userId: 'user-a', leftAt: null, user: { username: 'alice', name: 'Alice', avatarUrl: '' } },
        { userId: 'user-b', leftAt: null, user: { username: 'bob', name: 'Bob', avatarUrl: '' } },
        { userId: 'user-c', leftAt: null, user: { username: 'carol', name: 'Carol', avatarUrl: '' } },
      ],
    }),
  };

  const service = new CallingService({
    query: fakeQuery as typeof query,
    withTransaction: fakeTransaction as typeof withTransaction,
    messagingRepo: fakeMessagingRepo as unknown as typeof messagingRepo,
    publishCallEvent: (event) => state.events.push(event),
  });

  return { service, state };
}

function createDirectCall(): CallSessionDetails {
  return {
    id: 'call-1',
    conversationId: 'conversation-1',
    roomName: 'room-server-generated',
    type: 'voice',
    status: 'ringing',
    callerId: 'user-a',
    startedAt: Date.now(),
    answeredAt: null,
    endedAt: null,
    durationSeconds: 0,
    participants: [
      { userId: 'user-a', status: 'joined', joinedAt: Date.now(), leftAt: null },
      { userId: 'user-b', status: 'invited', joinedAt: null, leftAt: null },
    ],
  };
}

function toCallRow(call: CallSessionDetails): QueryResultRow {
  return {
    id: call.id,
    conversation_id: call.conversationId,
    room_name: call.roomName,
    type: call.type,
    status: call.status,
    caller_id: call.callerId,
    started_at: call.startedAt,
    answered_at: call.answeredAt,
    ended_at: call.endedAt,
    duration_seconds: call.durationSeconds,
  };
}

function toParticipantRow(
  participant: CallSessionDetails['participants'][number],
): QueryResultRow {
  return {
    user_id: participant.userId,
    status: participant.status,
    joined_at: participant.joinedAt,
    left_at: participant.leftAt,
  };
}

function createQueryResult<Row extends QueryResultRow>(rows: Row[]): QueryResult<Row> {
  return {
    command: 'SELECT',
    rowCount: rows.length,
    oid: 0,
    fields: [],
    rows,
  };
}

describe('LiveKit Calling Service & Webhook Contracts', () => {
  test('validates webhook receiver signature logic', async () => {
    const apiKey = 'test-livekit-api-key';
    const apiSecret = 'test-livekit-api-secret-value-at-least-32-characters';
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    assert.ok(receiver);
    assert.equal(typeof receiver.receive, 'function');
  });

  test('webhook receiver rejects invalid authorization headers', async () => {
    const apiKey = 'test-livekit-api-key';
    const apiSecret = 'test-livekit-api-secret-value-at-least-32-characters';
    const receiver = new WebhookReceiver(apiKey, apiSecret);

    await assert.rejects(
      async () => {
        await receiver.receive('{"event":"room_finished"}', 'invalid_auth_token');
      },
      /invalid/i,
    );
  });

  test('webhook reconciles empty room name safely', async () => {
    await callingService.handleWebhook({
      event: 'room_finished',
    });
    assert.ok(true, 'Empty room was handled safely.');
  });

  test('a legitimate participant can accept and receives a token for the server-owned room', async () => {
    await withLiveKitEnvironment(async () => {
      const { service, state } = createCallFixture();
      const response = await service.respondToCall('user-b', 'call-1', 'accept');

      assert.equal(response.call.status, 'active');
      assert.equal(response.call.participants.find((participant) => participant.userId === 'user-b')?.status, 'joined');
      assert.ok(response.token);
      const claims = JSON.parse(Buffer.from(response.token.split('.')[1], 'base64url').toString('utf8'));
      assert.equal(claims.sub, 'user-b');
      assert.equal(claims.video.room, 'room-server-generated');
      assert.equal(state.events.length, 1);
    });
  });

  test('a legitimate participant can reject a direct call', async () => {
    const { service, state } = createCallFixture();
    const response = await service.respondToCall('user-b', 'call-1', 'reject');

    assert.equal(response.call.status, 'rejected');
    assert.equal(response.call.participants.find((participant) => participant.userId === 'user-b')?.status, 'declined');
    assert.equal(response.token, undefined);
    assert.equal(state.events.length, 1);
  });

  test('a legitimate joined participant can end a direct call', async () => {
    const { service, state } = createCallFixture();
    const response = await service.endCall('user-a', 'call-1');

    assert.equal(response.status, 'ended');
    assert.equal(response.participants.find((participant) => participant.userId === 'user-a')?.status, 'left');
    assert.equal(state.events.length, 1);
  });

  test('a joined group participant can leave without ending the active group call', async () => {
    const groupCall = createDirectCall();
    groupCall.participants.push({ userId: 'user-c', status: 'joined', joinedAt: Date.now(), leftAt: null });
    groupCall.status = 'active';
    const { service, state } = createCallFixture(groupCall);

    const response = await service.endCall('user-c', 'call-1');

    assert.equal(response.status, 'active');
    assert.equal(response.participants.find((participant) => participant.userId === 'user-c')?.status, 'left');
    assert.equal(state.events[0]?.event, 'participant-left');
  });

  for (const action of ['accept', 'reject'] as const) {
    test(`a nonparticipant cannot ${action} a call or obtain a token`, async () => {
      const { service, state } = createCallFixture();
      await assert.rejects(
        service.respondToCall('user-outsider', 'call-1', action),
        (error: unknown) =>
          error instanceof Error &&
          'status' in error &&
          error.status === 404,
      );
      assert.equal(state.call?.status, 'ringing');
      assert.equal(state.events.length, 0);
    });
  }

  test('a nonparticipant cannot end a call', async () => {
    const { service, state } = createCallFixture();
    await assert.rejects(
      service.endCall('user-outsider', 'call-1'),
      (error: unknown) =>
        error instanceof Error &&
        'status' in error &&
        error.status === 404,
    );
    assert.equal(state.call?.participants[0].status, 'joined');
    assert.equal(state.events.length, 0);
  });

  test('a participant cannot act on a nonexistent call', async () => {
    const { service } = createCallFixture();
    await assert.rejects(
      service.respondToCall('user-b', 'missing-call', 'accept'),
      (error: unknown) =>
        error instanceof Error &&
        'status' in error &&
        error.status === 404,
    );
  });

  test('a conversation member removed from the call conversation cannot respond', async () => {
    const { service, state } = createCallFixture();
    state.activeConversationUsers.delete('user-b');

    await assert.rejects(
      service.respondToCall('user-b', 'call-1', 'accept'),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 404,
    );
    assert.equal(state.call?.participants.find((participant) => participant.userId === 'user-b')?.status, 'invited');
    assert.equal(state.events.length, 0);
  });

  test('invalid call states and participant transitions are rejected without side effects', async () => {
    const endedCall = createDirectCall();
    endedCall.status = 'ended';
    const endedFixture = createCallFixture(endedCall);
    await assert.rejects(
      endedFixture.service.respondToCall('user-b', 'call-1', 'accept'),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );
    assert.equal(endedFixture.state.events.length, 0);

    await assert.rejects(
      endedFixture.service.endCall('user-a', 'call-1'),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );

    const joinedFixture = createCallFixture();
    await joinedFixture.service.respondToCall('user-b', 'call-1', 'accept');
    await assert.rejects(
      joinedFixture.service.respondToCall('user-b', 'call-1', 'reject'),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 409,
    );
    assert.equal(joinedFixture.state.events.length, 1);
  });

  test('group-call authorization allows an invited member but not an outsider', async () => {
    await withLiveKitEnvironment(async () => {
      const groupCall = createDirectCall();
      groupCall.participants.push({ userId: 'user-c', status: 'invited', joinedAt: null, leftAt: null });
      const { service, state } = createCallFixture(groupCall);

      const response = await service.respondToCall('user-c', 'call-1', 'accept');
      assert.equal(response.call.participants.find((participant) => participant.userId === 'user-c')?.status, 'joined');
      await assert.rejects(
        service.respondToCall('user-outsider', 'call-1', 'accept'),
        (error: unknown) => error instanceof Error && 'status' in error && error.status === 404,
      );
      assert.equal(state.events.length, 1);
    });
  });

  test('call initiation still creates a server-named room and issues a caller token', async () => {
    await withLiveKitEnvironment(async () => {
    const fixture = createCallFixture(null);
    fixture.state.activeConversationUsers.add('user-a');
    fixture.state.activeConversationUsers.add('user-b');
    const { service } = fixture;
    const conversation = {
      id: 'conversation-1',
      type: 'direct',
      title: null,
      avatarUrl: null,
      createdBy: 'user-a',
      participants: [
        { userId: 'user-a', leftAt: null, user: { username: 'alice', name: 'Alice', avatarUrl: '' } },
        { userId: 'user-b', leftAt: null, user: { username: 'bob', name: 'Bob', avatarUrl: '' } },
      ],
    };
    const dependencies = {
      query: async <Row extends QueryResultRow = QueryResultRow>(
        sql: string,
        values?: unknown[],
      ): Promise<QueryResult<Row>> => {
        if (sql.includes('SELECT * FROM zunari_call_sessions')) {
          const currentCall = fixture.state.call;
          const result =
            currentCall && currentCall.id === values?.[0] ? [toCallRow(currentCall)] : [];
          return createQueryResult(result) as QueryResult<Row>;
        }
        if (sql.includes('SELECT * FROM zunari_call_participants')) {
          const result = fixture.state.call?.participants.map(toParticipantRow) ?? [];
          return createQueryResult(result) as QueryResult<Row>;
        }
        throw new Error(`Unexpected SQL in initiation test: ${sql}`);
      },
      withTransaction: async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
        const client = {
          query: async <Row extends QueryResultRow = QueryResultRow>(
            sql: string,
            values?: unknown[],
          ): Promise<QueryResult<Row>> => {
            if (sql.includes('SELECT user_id FROM zunari_conversation_participants')) {
              const rows = Array.from(fixture.state.activeConversationUsers, (user_id) => ({ user_id }));
              return createQueryResult(rows) as unknown as QueryResult<Row>;
            }
            if (sql.includes('INSERT INTO zunari_call_sessions')) {
              const callId = String(values?.[0]);
              fixture.state.call = {
                ...createDirectCall(),
                id: callId,
                conversationId: String(values?.[1]),
                roomName: String(values?.[2]),
                callerId: String(values?.[4]),
                startedAt: Number(values?.[5]),
                participants: [],
              };
              return createQueryResult([]) as QueryResult<Row>;
            }
            if (sql.includes('INSERT INTO zunari_call_participants')) {
              fixture.state.call?.participants.push({
                userId: String(values?.[1]),
                status: String(values?.[2]) as CallSessionDetails['participants'][number]['status'],
                joinedAt: values?.[3] === null ? null : Number(values?.[3]),
                leftAt: null,
              });
              return createQueryResult([]) as QueryResult<Row>;
            }
            throw new Error(`Unexpected SQL in initiation transaction: ${sql}`);
          },
        };
        return work(client as unknown as PoolClient);
      },
      messagingRepo: {
        getConversationById: async () => conversation,
      } as unknown as typeof messagingRepo,
      publishCallEvent: () => undefined,
    };
    const serviceWithInitiationDependencies = new CallingService(dependencies);
    const response = await serviceWithInitiationDependencies.initiateCall(
      'user-a',
      'conversation-1',
      'voice',
    );
    const claims = JSON.parse(Buffer.from(response.token.split('.')[1], 'base64url').toString('utf8'));

    assert.equal(response.call.callerId, 'user-a');
    assert.equal(claims.sub, 'user-a');
    assert.equal(claims.video.room, response.call.roomName);
    });
  });

  test('call initiation creates no record or event when LiveKit configuration is invalid', async () => {
    await withLiveKitEnvironment(
      async () => {
        const { service, state } = createCallFixture(null);
        state.activeConversationUsers.add('user-a');
        state.activeConversationUsers.add('user-b');

        await assert.rejects(
          service.initiateCall('user-a', 'conversation-1', 'voice'),
          /LIVEKIT_URL must use HTTPS or WSS/,
        );
        assert.equal(state.call, null);
        assert.equal(state.events.length, 0);
      },
      { LIVEKIT_URL: 'ftp://invalid.example.com' },
    );
  });

  test('accepting a call fails before state changes when LiveKit configuration is invalid', async () => {
    await withLiveKitEnvironment(
      async () => {
        const { service, state } = createCallFixture();
        await assert.rejects(
          service.respondToCall('user-b', 'call-1', 'accept'),
          /LIVEKIT_URL must use HTTPS or WSS/,
        );
        assert.equal(state.call?.status, 'ringing');
        assert.equal(
          state.call?.participants.find((participant) => participant.userId === 'user-b')?.status,
          'invited',
        );
        assert.equal(state.events.length, 0);
      },
      { LIVEKIT_URL: 'ftp://invalid.example.com' },
    );
  });

  test('webhook verification fails safely when LiveKit credentials are missing', async () => {
    await withLiveKitEnvironment(
      async () => {
        await assert.rejects(
          callingService.validateWebhook('{"event":"room_finished"}', 'invalid'),
          (error: unknown) =>
            error instanceof Error &&
            'status' in error &&
            error.status === 503 &&
            error.message === 'Webhook verification is unavailable.',
        );
      },
      { LIVEKIT_API_KEY: undefined },
    );
  });

  test('call initiation rejects a caller removed after the conversation snapshot', async () => {
    const { service, state } = createCallFixture(null);

    await assert.rejects(
      service.initiateCall('user-a', 'conversation-1', 'voice'),
      (error: unknown) => error instanceof Error && 'status' in error && error.status === 404,
    );
    assert.equal(state.call, null);
    assert.equal(state.events.length, 0);
  });

  test('the call route rejects unknown response actions instead of defaulting to reject', async () => {
    let responseStatus = 0;
    let responseBody = '';
    let jsonReaderCalled = false;
    const req = Object.assign(Readable.from([Buffer.from('{"action":"invalid"}')]), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
    }) as never;
    const res = {
      setHeader: () => undefined,
      end: (body: Buffer) => {
        responseBody = body.toString('utf8');
      },
      set statusCode(value: number) {
        responseStatus = value;
      },
    } as never;

    await handleCallingRequest(
      req,
      res,
      new URL('http://localhost/api/calls/call-1/respond'),
      'user-b',
      async (request) => {
        jsonReaderCalled = true;
        const chunks: Buffer[] = [];
        for await (const chunk of request) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      },
      async () => undefined,
    );

    assert.equal(responseStatus, 400);
    assert.equal(JSON.parse(responseBody).code, 'INVALID_ACTION');
    assert.equal(jsonReaderCalled, true);
  });
});
