import { AccessToken, WebhookReceiver } from 'livekit-server-sdk';
import { randomUUID } from 'node:crypto';
import { query, withTransaction } from './db/pool.ts';
import { messagingRepo } from './db/messaging.ts';
import { publishCallEvent } from './realtime-events.ts';
import { HttpError } from './errors.ts';

const MAX_GROUP_CALL_PARTICIPANTS = 8;

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

function getLiveKitCredentials() {
  const apiKey = process.env.LIVEKIT_API_KEY?.trim() || 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET?.trim() || 'secret_secret_secret_secret_secret_32char';
  const url = process.env.LIVEKIT_URL?.trim() || 'wss://demo.livekit.cloud';
  return { apiKey, apiSecret, url };
}

export class CallingService {
  public async generateToken(
    userId: string,
    username: string,
    roomName: string,
  ): Promise<{ token: string; url: string }> {
    const { apiKey, apiSecret, url } = getLiveKitCredentials();

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
    const conv = await messagingRepo.getConversationById(conversationId, callerId);
    if (!conv) {
      throw new HttpError(404, 'Conversation not found.', 'CONVERSATION_NOT_FOUND');
    }

    const participants = conv.participants.filter((p) => !p.leftAt);
    if (participants.length < 2) {
      throw new HttpError(400, 'Conversation must have at least 2 active participants.', 'INVALID_PARTICIPANTS');
    }
    if (conv.type === 'group' && participants.length > MAX_GROUP_CALL_PARTICIPANTS) {
      throw new HttpError(
        400,
        `Group calling is limited to a maximum of ${MAX_GROUP_CALL_PARTICIPANTS} participants.`,
        'PARTICIPANT_LIMIT_EXCEEDED',
      );
    }

    const callId = `call_${randomUUID()}`;
    const roomName = `room_${callId}`;
    const now = Date.now();

    await withTransaction(async (client) => {
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
    });

    const callerUser = conv.participants.find((p) => p.userId === callerId)?.user;
    const recipientIds = participants.filter((p) => p.userId !== callerId).map((p) => p.userId);

    // Emit incoming call event via Socket.IO
    publishCallEvent({
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
      participants: participants.map((p) => ({
        id: p.userId,
        username: p.user?.username || '',
        name: p.user?.name || '',
        avatarUrl: p.user?.avatarUrl || '',
      })),
      event: 'incoming',
      recipientIds,
    });

    const callerToken = await this.generateToken(callerId, callerUser?.username || callerId, roomName);
    const callDetails = await this.getCallById(callId);

    return {
      call: callDetails!,
      token: callerToken.token,
      livekitUrl: callerToken.url,
    };
  }

  public async respondToCall(
    userId: string,
    callId: string,
    action: 'accept' | 'reject',
  ): Promise<{ call: CallSessionDetails; token?: string; livekitUrl?: string }> {
    const call = await this.getCallById(callId);
    if (!call) throw new HttpError(404, 'Call not found.', 'CALL_NOT_FOUND');
    if (call.status === 'ended') throw new HttpError(400, 'Call has already ended.', 'CALL_ENDED');

    const now = Date.now();
    await withTransaction(async (client) => {
      if (action === 'accept') {
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
      } else {
        await client.query(
          `UPDATE zunari_call_participants
           SET status = 'declined', left_at = $1
           WHERE call_id = $2 AND user_id = $3`,
          [now, callId, userId],
        );
        // If 1:1 and rejected, mark session as rejected
        const participants = await client.query<{ user_id: string; status: string }>(
          'SELECT user_id, status FROM zunari_call_participants WHERE call_id = $1',
          [callId],
        );
        if (participants.rows.length === 2) {
          await client.query(
            `UPDATE zunari_call_sessions SET status = 'rejected', ended_at = $1 WHERE id = $2`,
            [now, callId],
          );
        }
      }
    });

    const updated = await this.getCallById(callId);
    const conv = await messagingRepo.getConversationById(call.conversationId, userId);
    const callerUser = conv?.participants.find((p) => p.userId === call.callerId)?.user;
    const recipientIds = conv?.participants.map((p) => p.userId) || [];

    publishCallEvent({
      callId,
      conversationId: call.conversationId,
      roomName: call.roomName,
      type: call.type,
      status: updated!.status,
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
      event: action === 'accept' ? 'answered' : 'rejected',
      recipientIds,
      joinedUserId: action === 'accept' ? userId : undefined,
    });

    if (action === 'accept') {
      const user = conv?.participants.find((p) => p.userId === userId)?.user;
      const tokenRes = await this.generateToken(userId, user?.username || userId, call.roomName);
      return {
        call: updated!,
        token: tokenRes.token,
        livekitUrl: tokenRes.url,
      };
    }

    return { call: updated! };
  }

  public async endCall(userId: string, callId: string): Promise<CallSessionDetails> {
    const call = await this.getCallById(callId);
    if (!call) throw new HttpError(404, 'Call not found.', 'CALL_NOT_FOUND');

    const now = Date.now();
    await withTransaction(async (client) => {
      // Mark user left
      await client.query(
        `UPDATE zunari_call_participants
         SET status = 'left', left_at = $1
         WHERE call_id = $2 AND user_id = $3`,
        [now, callId, userId],
      );

      // Check remaining active
      const active = await client.query(
        "SELECT 1 FROM zunari_call_participants WHERE call_id = $1 AND status = 'joined'",
        [callId],
      );

      // If no active participants or caller ends a 1:1, end session
      if (active.rowCount === 0 || (call.participants.length === 2 && call.callerId === userId)) {
        const startTime = call.answeredAt || call.startedAt;
        const duration = Math.max(0, Math.floor((now - startTime) / 1000));
        await client.query(
          `UPDATE zunari_call_sessions
           SET status = 'ended', ended_at = $1, duration_seconds = $2
           WHERE id = $3`,
          [now, duration, callId],
        );
      }
    });

    const updated = await this.getCallById(callId);
    const conv = await messagingRepo.getConversationById(call.conversationId, userId);
    const callerUser = conv?.participants.find((p) => p.userId === call.callerId)?.user;
    const recipientIds = conv?.participants.map((p) => p.userId) || [];

    publishCallEvent({
      callId,
      conversationId: call.conversationId,
      roomName: call.roomName,
      type: call.type,
      status: updated!.status,
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
      event: updated!.status === 'ended' ? 'ended' : 'participant-left',
      recipientIds,
      leftUserId: userId,
    });

    return updated!;
  }

  public async getCallById(callId: string): Promise<CallSessionDetails | null> {
    const res = await query<{
      id: string;
      conversation_id: string;
      room_name: string;
      type: 'voice' | 'video';
      status: 'ringing' | 'active' | 'ended' | 'missed' | 'rejected';
      caller_id: string;
      started_at: string | number;
      answered_at: string | number | null;
      ended_at: string | number | null;
      duration_seconds: number;
    }>('SELECT * FROM zunari_call_sessions WHERE id = $1', [callId]);
    const r = res.rows[0];
    if (!r) return null;

    const partsRes = await query<{
      user_id: string;
      status: 'invited' | 'joined' | 'left' | 'declined' | 'missed';
      joined_at: string | number | null;
      left_at: string | number | null;
    }>('SELECT * FROM zunari_call_participants WHERE call_id = $1', [callId]);

    return {
      id: r.id,
      conversationId: r.conversation_id,
      roomName: r.room_name,
      type: r.type,
      status: r.status,
      callerId: r.caller_id,
      startedAt: Number(r.started_at),
      answeredAt: r.answered_at ? Number(r.answered_at) : null,
      endedAt: r.ended_at ? Number(r.ended_at) : null,
      durationSeconds: Number(r.duration_seconds),
      participants: partsRes.rows.map((p) => ({
        userId: p.user_id,
        status: p.status,
        joinedAt: p.joined_at ? Number(p.joined_at) : null,
        leftAt: p.left_at ? Number(p.left_at) : null,
      })),
    };
  }

  public async validateWebhook(
    body: string,
    authHeader?: string,
  ): Promise<{ event: string; room?: { name: string }; participant?: { identity: string } }> {
    const { apiKey, apiSecret } = getLiveKitCredentials();
    const receiver = new WebhookReceiver(apiKey, apiSecret);
    return receiver.receive(body, authHeader) as any;
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

    const callRes = await query<{ id: string }>('SELECT id FROM zunari_call_sessions WHERE room_name = $1', [
      roomName,
    ]);
    if (!callRes.rows[0]) return;
    const callId = callRes.rows[0].id;

    if (event.event === 'room_finished') {
      const now = Date.now();
      await query(
        "UPDATE zunari_call_sessions SET status = 'ended', ended_at = $1 WHERE id = $2 AND status <> 'ended'",
        [now, callId],
      );
    } else if (event.event === 'participant_left' && event.participant?.identity) {
      const now = Date.now();
      await query(
        "UPDATE zunari_call_participants SET status = 'left', left_at = $1 WHERE call_id = $2 AND user_id = $3",
        [now, callId, event.participant.identity],
      );
    }
  }
}

export const callingService = new CallingService();
