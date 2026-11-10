import type { User } from '../../types/index.ts';

export interface IncomingCallInfo {
  callId: string;
  conversationId: string;
  roomName: string;
  type: 'voice' | 'video';
  caller: Pick<User, 'id' | 'username' | 'name' | 'avatarUrl'>;
  title?: string;
  avatarUrl?: string;
  isGroup?: boolean;
  participantCount?: number;
}

export interface ActiveCallInfo {
  callId: string;
  conversationId: string;
  roomName: string;
  token: string;
  livekitUrl: string;
  type: 'voice' | 'video';
  title: string;
  subtitle?: string;
  avatarUrl?: string;
  isGroup: boolean;
  participantCount?: number;
  direction: 'outgoing' | 'incoming';
}

export interface StartCallInput {
  conversationId: string;
  type: 'voice' | 'video';
  title: string;
  subtitle?: string;
  avatarUrl?: string;
  isGroup: boolean;
  participantCount?: number;
}
