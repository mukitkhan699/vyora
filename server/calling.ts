import { AccessToken, WebhookEvent, WebhookReceiver } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from './db/pool.ts';
import { messagingRepo } from './db/messaging.ts';
import { publishCallEvent } from './realtime-events.ts';
import { HttpError } from './errors.ts';
import { getLiveKitConfiguration } from './config.ts';

const MAX_GROUP_CALL_PARTICIPANTS = 8;

interface CallingServiceDependencies {
  query: typeof query;
  withTransaction: typeof withTransaction;
  messagingRepo: typeof messagingRepo;
  publishCallEvent: typeof publishCallEvent;
}

interface CallSessionRow {
  id: string;
  conversation_id: string;
  room_name: string;
  type: 'voice' | 'video';
  status: CallSessionDetails['status'];
  caller_id: string;
  started_at: string | number;
  answered_at: string | number | null;
  ended_at: string | number | null;
  duration_seconds: number;
}

interface CallParticipantRow {
  user_id: string;
  status: CallSessionDetails['participants'][number]['status'];
  joined_at: string | number | null;
  left_at: string | number | null;
}

export interface CallSessionDetails {
  id: string;
  conversationId: string;
  roomName: string;
  type: 'voice' | 'video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';
  callerId: string;
  startedAt: number;
  answeredAt: number | null;
  endedAt: number | null;
  durationSeconds: number;
  participants: Array<{
    userId: string;
    status: 'invited' | 'joined' | 'left' | 'declined' | 'missed';
    joinedAt: number | null;
    leftAt: number | null;
  }>;
}

export class CallingService {
  private readonly dependencies: CallingServiceDependencies;

  constructor(dependencies: Partial<CallingServiceDependencies> = {}) {
    this.dependencies = {
      query: dependencies.query ?? query,
      withTransaction: dependencies.withTransaction ?? withTransaction,
      messagingRepo: dependencies.messagingRepo ?? messagingRepo,
      publishCallEvent: dependencies.publishCallEvent ?? publishCallEvent,
    };
  }

  private async generateToken(
    userId: string,
    username: string,
    roomName: string,
  ): Promise<{ token: string; url: string }> {
    const { apiKey, apiSecret, url } = getLiveKitConfiguration();

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: username,
      ttl: 60 * 60, // 1 hour
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
    });

    return {
      token: await at.toJwt(),
      url,
    };
  }

  public async initiateCall(
    callerId: string,
    conversationId: string,
    type: 'voice' | 'video',
  ): Promise<{ call: CallSessionDetails; token: string; livekitUrl: string }> {
    const conv = await this.dependencies.messagingRepo.getConversationById(conversationId, callerId);
    if (!conv) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }

    const activeParticipants = conv.participants.filter((p) => !p.leftAt);
    if (!activeParticipants.some((participant) => participant.userId === callerId)) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }
    if (activeParticipants.length < 2) {
      throw new HttpError(400, 'Conversation must have at least 2 active participants.', 'INVALID_PARTICIPANTS');
    }
    if (conv.type === 'group' && activeParticipants.length > MAX_GROUP_CALL_PARTICIPANTS) {
      throw new HttpError(
        400,
        `Group calling is limited to a maximum of ${MAX_GROUP_CALL_PARTICIPANTS} participants.`,
        'PARTICIPANT_LIMIT_EXCEEDED',
      );
    }

    const callId = `call_${randomUUID()}`;
    const roomName = `room_${callId}`;
    const now = Date.now();

    const initiation = await this.dependencies.withTransaction(async (client) => {
      const membershipResult = await client.query<{ user_id: string }>(
        `SELECT user_id FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND left_at IS NULL
         FOR SHARE`,
        [conversationId],
      );
      const activeUserIds = new Set(membershipResult.rows.map((participant) => participant.user_id));
      const participants = activeParticipants.filter((participant) => activeUserIds.has(participant.userId));
      if (!activeUserIds.has(callerId)) {
        throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
      }
      if (participants.length < 2) {
        throw new HttpError(400, 'Conversation must have at least 2 active participants.', 'INVALID_PARTICIPANTS');
      }

      const callerUser = conv.participants.find((p) => p.userId === callerId)?.user;
      const callerToken = await this.generateToken(
        callerId,
        callerUser?.username || callerId,
        roomName,
      );

      await client.query(
        `INSERT INTO zunari_call_sessions
           (id, conversation_id, room_name, type, status, caller_id, started_at, duration_seconds)
         VALUES ($1, $2, $3, $4, 'ringing', $5, $6, 0)`,
        [callId, conversationId, roomName, type, callerId, now],
      );

      for (const p of participants) {
        const initialStatus = p.userId === callerId ? 'joined' : 'invited';
        const joinedAt = p.userId === callerId ? now : null;
        await client.query(
          `INSERT INTO zunari_call_participants
             (call_id, user_id, status, joined_at)
           VALUES ($1, $2, $3, $4)`,
          [callId, p.userId, initialStatus, joinedAt],
        );
      }
      return { participants, callerToken };
    });

    const callerUser = conv.participants.find((p) => p.userId === callerId)?.user;
    const recipientIds = initiation.participants
      .filter((p) => p.userId !== callerId)
      .map((p) => p.userId);

    // Emit incoming call event via Socket.IO
    this.dependencies.publishCallEvent({
      callId,
      conversationId,
      roomName,
      type,
      status: 'ringing',
      caller: {
        id: callerId,
        username: callerUser?.username || '',
        name: callerUser?.name || '',
        avatarUrl: callerUser?.avatarUrl || '',
      },
      participants: initiation.participants.map((p) => ({
        id: p.userId,
        username: p.user?.username || '',
        name: p.user?.name || '',
        avatarUrl: p.user?.avatarUrl || '',
      })),
      event: 'incoming',
      recipientIds,
    });

    const callDetails = await this.getCallById(callId);

    return {
      call: callDetails!,
      token: initiation.callerToken.token,
      livekitUrl: initiation.callerToken.url,
    };
  }

  public async respondToCall(
    userId: string,
    callId: string,
    action: 'accept' | 'reject',
  ): Promise<{ call: CallSessionDetails; token?: string; livekitUrl?: string }> {
    const now = Date.now();
    const call = await this.dependencies.withTransaction(async (client) => {
      const callResult = await client.query<CallSessionRow>(
        'SELECT * FROM zunari_call_sessions WHERE id = $1 FOR UPDATE',
        [callId],
      );
      const callRow = callResult.rows[0];
      if (!callRow) throw this.callNotFound();

      const participantResult = await client.query<CallParticipantRow>(
        `SELECT user_id, status, joined_at, left_at
         FROM zunari_call_participants
         WHERE call_id = $1 AND user_id = $2
         FOR UPDATE`,
        [callId, userId],
      );
      const participant = participantResult.rows[0];
      if (!participant) throw this.callNotFound();

      const membership = await client.query<{ username: string | null }>(
        `SELECT u.username
         FROM zunari_conversation_participants cp
         JOIN zunari_users u ON u.public_id = cp.user_id
         WHERE cp.conversation_id = $1 AND cp.user_id = $2 AND cp.left_at IS NULL
         FOR SHARE OF cp`,
        [callRow.conversation_id, userId],
      );
      if (!membership.rowCount) throw this.callNotFound();

      const participantRows = await client.query<CallParticipantRow>(
        `SELECT user_id, status, joined_at, left_at
         FROM zunari_call_participants
         WHERE call_id = $1`,
        [callId],
      );
      const authorizedCall = this.mapCall(callRow, participantRows.rows);
      this.assertCallRespondAllowed(authorizedCall, participant, action);
      const tokenRes =
        action === 'accept'
          ? await this.generateToken(
              userId,
              membership.rows[0]?.username || userId,
              authorizedCall.roomName,
            )
          : null;

      if (action === 'accept' && participant.status === 'invited') {
        await client.query(
          `UPDATE zunari_call_participants
           SET status = 'joined', joined_at = $1
           WHERE call_id = $2 AND user_id = $3`,
          [now, callId, userId],
        );
        await client.query(
          `UPDATE zunari_call_sessions
           SET status = 'active', answered_at = COALESCE(answered_at, $1)
           WHERE id = $2`,
          [now, callId],
        );
        participant.status = 'joined';
        participant.joined_at = now;
        const updatedParticipant = authorizedCall.participants.find((entry) => entry.userId === userId);
        if (updatedParticipant) {
          updatedParticipant.status = 'joined';
          updatedParticipant.joinedAt = now;
        }
        authorizedCall.status = 'active';
        authorizedCall.answeredAt ??= now;
      } else if (action === 'reject') {
        await client.query(
          `UPDATE zunari_call_participants
           SET status = 'declined', left_at = $1
           WHERE call_id = $2 AND user_id = $3`,
          [now, callId, userId],
        );
        participant.status = 'declined';
        participant.left_at = now;
        const updatedParticipant = authorizedCall.participants.find((entry) => entry.userId === userId);
        if (updatedParticipant) {
          updatedParticipant.status = 'declined';
          updatedParticipant.leftAt = now;
        }
        if (authorizedCall.participants.length === 2) {
          await client.query(
            `UPDATE zunari_call_sessions SET status = 'rejected', ended_at = $1 WHERE id = $2`,
            [now, callId],
          );
          authorizedCall.status = 'rejected';
          authorizedCall.endedAt = now;
        }
      }

      return { call: authorizedCall, tokenRes };
    });

    const { call: updatedCall, tokenRes } = call;
    const conv = await this.dependencies.messagingRepo.getConversationById(
      updatedCall.conversationId,
      userId,
    );
    const callerUser = conv?.participants.find((p) => p.userId === updatedCall.callerId)?.user;
    const recipientIds = conv?.participants.map((p) => p.userId) || [];

    this.dependencies.publishCallEvent({
      callId,
      conversationId: updatedCall.conversationId,
      roomName: updatedCall.roomName,
      type: updatedCall.type,
      status: updatedCall.status,
      caller: {
        id: updatedCall.callerId,
        username: callerUser?.username || '',
        name: callerUser?.name || '',
        avatarUrl: callerUser?.avatarUrl || '',
      },
      participants: (conv?.participants || []).map((p) => ({
        id: p.userId,
        username: p.user?.username || '',
        name: p.user?.name || '',
        avatarUrl: p.user?.avatarUrl || '',
      })),
      event: action === 'accept' ? 'answered' : 'rejected',
      recipientIds,
      joinedUserId: action === 'accept' ? userId : undefined,
    });

    if (action === 'accept') {
      if (!tokenRes) throw new Error('Authorized call token was not generated.');
      return {
        call: updatedCall,
        token: tokenRes.token,
        livekitUrl: tokenRes.url,
      };
    }

    return { call: updatedCall };
  }

  public async endCall(userId: string, callId: string): Promise<CallSessionDetails> {
    const now = Date.now();
    const call = await this.dependencies.withTransaction(async (client) => {
      const callResult = await client.query<CallSessionRow>(
        'SELECT * FROM zunari_call_sessions WHERE id = $1 FOR UPDATE',
        [callId],
      );
      const callRow = callResult.rows[0];
      if (!callRow) throw this.callNotFound();

      const participantResult = await client.query<CallParticipantRow>(
        `SELECT user_id, status, joined_at, left_at
         FROM zunari_call_participants
         WHERE call_id = $1 AND user_id = $2
         FOR UPDATE`,
        [callId, userId],
      );
      const participant = participantResult.rows[0];
      if (!participant) throw this.callNotFound();

      const membership = await client.query(
        `SELECT 1 FROM zunari_conversation_participants
         WHERE conversation_id = $1 AND user_id = $2 AND left_at IS NULL
         FOR SHARE`,
        [callRow.conversation_id, userId],
      );
      if (!membership.rowCount) throw this.callNotFound();

      const participantRows = await client.query<CallParticipantRow>(
        `SELECT user_id, status, joined_at, left_at
         FROM zunari_call_participants
         WHERE call_id = $1`,
        [callId],
      );
      const authorizedCall = this.mapCall(callRow, participantRows.rows);
      this.assertCallEndAllowed(authorizedCall, participant);

      await client.query(
        `UPDATE zunari_call_participants
         SET status = 'left', left_at = $1
         WHERE call_id = $2 AND user_id = $3`,
        [now, callId, userId],
      );
      participant.status = 'left';
      participant.left_at = now;
      const currentParticipant = authorizedCall.participants.find((entry) => entry.userId === userId);
      if (currentParticipant) {
        currentParticipant.status = 'left';
        currentParticipant.leftAt = now;
      }

      const active = await client.query(
        "SELECT 1 FROM zunari_call_participants WHERE call_id = $1 AND status = 'joined'",
        [callId],
      );

      if (active.rowCount === 0 || (authorizedCall.participants.length === 2 && authorizedCall.callerId === userId)) {
        const startTime = authorizedCall.answeredAt || authorizedCall.startedAt;
        const duration = Math.max(0, Math.floor((now - startTime) / 1000));
        await client.query(
          `UPDATE zunari_call_sessions
           SET status = 'ended', ended_at = $1, duration_seconds = $2
           WHERE id = $3`,
          [now, duration, callId],
        );
        authorizedCall.status = 'ended';
        authorizedCall.endedAt = now;
        authorizedCall.durationSeconds = duration;
      }

      return authorizedCall;
    });

    const conv = await this.dependencies.messagingRepo.getConversationById(call.conversationId, userId);
    const callerUser = conv?.participants.find((p) => p.userId === call.callerId)?.user;
    const recipientIds = conv?.participants.map((p) => p.userId) || [];

    this.dependencies.publishCallEvent({
      callId,
      conversationId: call.conversationId,
      roomName: call.roomName,
      type: call.type,
      status: call.status,
      caller: {
        id: call.callerId,
        username: callerUser?.username || '',
        name: callerUser?.name || '',
        avatarUrl: callerUser?.avatarUrl || '',
      },
      participants: (conv?.participants || []).map((p) => ({
        id: p.userId,
        username: p.user?.username || '',
        name: p.user?.name || '',
        avatarUrl: p.user?.avatarUrl || '',
      })),
      event: call.status === 'ended' ? 'ended' : 'participant-left',
      recipientIds,
      leftUserId: userId,
    });

    return call;
  }

  private callNotFound(): HttpError {
    return new HttpError(404, 'Call not found.', 'CALL_NOT_FOUND');
  }

  private assertCallRespondAllowed(
    call: CallSessionDetails,
    participant: CallParticipantRow,
    action: 'accept' | 'reject',
  ): void {
    if (call.status !== 'ringing' && call.status !== 'active') {
      throw new HttpError(409, 'Call is no longer available.', 'CALL_NOT_AVAILABLE');
    }
    if (action === 'accept') {
      if (
        participant.left_at !== null ||
        (participant.status !== 'invited' && participant.status !== 'joined')
      ) {
        throw new HttpError(409, 'Call is no longer available.', 'CALL_NOT_AVAILABLE');
      }
      return;
    }
    if (participant.status !== 'invited' || participant.left_at !== null) {
      throw new HttpError(409, 'Call is no longer available.', 'CALL_NOT_AVAILABLE');
    }
  }

  private assertCallEndAllowed(
    call: CallSessionDetails,
    participant: CallParticipantRow,
  ): void {
    if (
      (call.status !== 'ringing' && call.status !== 'active') ||
      participant.status !== 'joined' ||
      participant.left_at !== null
    ) {
      throw new HttpError(409, 'Call is no longer available.', 'CALL_NOT_AVAILABLE');
    }
  }

  private mapCall(call: CallSessionRow, participants: CallParticipantRow[]): CallSessionDetails {
    return {
      id: call.id,
      conversationId: call.conversation_id,
      roomName: call.room_name,
      type: call.type,
      status: call.status,
      callerId: call.caller_id,
      startedAt: Number(call.started_at),
      answeredAt: call.answered_at === null ? null : Number(call.answered_at),
      endedAt: call.ended_at === null ? null : Number(call.ended_at),
      durationSeconds: Number(call.duration_seconds),
      participants: participants.map((participant) => ({
        userId: participant.user_id,
        status: participant.status,
        joinedAt: participant.joined_at === null ? null : Number(participant.joined_at),
        leftAt: participant.left_at === null ? null : Number(participant.left_at),
      })),
    };
  }

  public async getCallById(callId: string): Promise<CallSessionDetails | null> {
    const res = await this.dependencies.query<CallSessionRow>(
      'SELECT * FROM zunari_call_sessions WHERE id = $1',
      [callId],
    );
    const r = res.rows[0];
    if (!r) return null;

    const partsRes = await this.dependencies.query<CallParticipantRow>(
      'SELECT * FROM zunari_call_participants WHERE call_id = $1',
      [callId],
    );

    return this.mapCall(r, partsRes.rows);
  }

  public async validateWebhook(
    body: string,
    authHeader?: string,
  ): Promise<WebhookEvent> {
    let apiKey: string;
    let apiSecret: string;
    try {
      ({ apiKey, apiSecret } = getLiveKitConfiguration());
    } catch {
      throw new HttpError(503, 'Webhook verification is unavailable.', 'WEBHOOK_UNAVAILABLE');
    }
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    return receiver.receive(body, authHeader);
  }

  /**
   * Reconcile LiveKit Webhook events (room_finished, participant_left, etc.)
   */
  public async handleWebhook(event: {
    event: string;
    room?: { name: string };
    participant?: { identity: string };
  }): Promise<void> {
    const roomName = event.room?.name;
    if (!roomName) return;

    const callRes = await this.dependencies.query<{ id: string }>('SELECT id FROM zunari_call_sessions WHERE room_name = $1', [
      roomName,
    ]);
    if (!callRes.rows[0]) return;
    const callId = callRes.rows[0].id;

    if (event.event === 'room_finished') {
      const now = Date.now();
      await this.dependencies.query(
        "UPDATE zunari_call_sessions SET status = 'ended', ended_at = $1 WHERE id = $2 AND status <> 'ended'",
        [now, callId],
      );
    } else if (event.event === 'participant_left' && event.participant?.identity) {
      const now = Date.now();
      await this.dependencies.query(
        "UPDATE zunari_call_participants SET status = 'left', left_at = $1 WHERE call_id = $2 AND user_id = $3",
        [now, callId, event.participant.identity],
      );
    }
  }
}

export const callingService = new CallingService();
