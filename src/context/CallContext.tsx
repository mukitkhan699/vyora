import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../services/api.ts';
import type { CallEventPayload } from '../types/index.ts';
import { useAuth } from './AuthContext.tsx';
import { useRealtime } from './RealtimeContext.tsx';
import { useToast } from '../components/common/ToastProvider.tsx';
import { IncomingCallScreen } from '../components/calling/IncomingCallScreen.tsx';
import { CallOverlay } from '../components/calling/CallOverlay.tsx';
import type { ActiveCallInfo, IncomingCallInfo, StartCallInput } from '../components/calling/types.ts';

interface CallContextType {
  incomingCall: IncomingCallInfo | null;
  activeCall: ActiveCallInfo | null;
  isBusy: boolean;
  startCall: (input: StartCallInput) => Promise<void>;
  acceptIncoming: () => Promise<void>;
  rejectIncoming: () => Promise<void>;
  endActiveCall: () => Promise<void>;
}

const CallContext = createContext<CallContextType | undefined>(undefined);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { currentUser } = useAuth();
  const { socket } = useRealtime();
  const { showToast } = useToast();
  const [incomingCall, setIncomingCall] = useState<IncomingCallInfo | null>(null);
  const [activeCall, setActiveCall] = useState<ActiveCallInfo | null>(null);

  const activeCallRef = useRef<ActiveCallInfo | null>(null);
  const incomingCallRef = useRef<IncomingCallInfo | null>(null);
  const endedBySelfRef = useRef(false);
  const handledCallIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    activeCallRef.current = activeCall;
  }, [activeCall]);

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  useEffect(() => {
    if (!socket || !currentUser?.id) return;

    const handleIncoming = (event: CallEventPayload) => {
      if (!event?.callId || event.caller?.id === currentUser.id) return;
      if (activeCallRef.current) {
        void api.respondToCall(event.callId, 'reject').catch(() => undefined);
        showToast(`Declined an incoming call from ${event.caller.name || event.caller.username} because you are already in a call.`, 'info');
        return;
      }
      if (incomingCallRef.current?.callId === event.callId) return;
      if (incomingCallRef.current) {
        void api.respondToCall(event.callId, 'reject').catch(() => undefined);
        showToast(
          `Declined another incoming call from ${event.caller.name || event.caller.username}.`,
          'info',
        );
        return;
      }

      const info: IncomingCallInfo = {
        callId: event.callId,
        conversationId: event.conversationId,
        roomName: event.roomName,
        type: event.type,
        caller: event.caller,
        title: event.caller.name,
        avatarUrl: event.caller.avatarUrl,
        participantCount: event.participants?.length,
      };
      setIncomingCall(info);

      void api
        .getConversation(event.conversationId)
        .then((response) => {
          setIncomingCall((prev) => {
            if (!prev || prev.callId !== event.callId) return prev;
            const conversation = response.conversation;
            return {
              ...prev,
              title:
                conversation.type === 'group'
                  ? conversation.title || 'Group call'
                  : prev.caller.name,
              avatarUrl:
                conversation.type === 'group'
                  ? conversation.avatarUrl || prev.avatarUrl
                  : prev.caller.avatarUrl,
              isGroup: conversation.type === 'group',
              participantCount:
                conversation.participants?.filter((participant) => !participant.leftAt).length ||
                prev.participantCount,
            };
          });
        })
        .catch(() => undefined);
    };

    const handleAnswered = (event: CallEventPayload) => {
      if (!event?.callId) return;
      if (activeCallRef.current?.callId === event.callId) {
        showToast('The call was answered.', 'success');
      }
    };

    const clearIfMatches = (callId: string, message?: string) => {
      const active = activeCallRef.current;
      const incoming = incomingCallRef.current;
      const matchesActive = active?.callId === callId;
      const matchesIncoming = incoming?.callId === callId;
      if (matchesActive) {
        setActiveCall(null);
        activeCallRef.current = null;
      }
      if (matchesIncoming) {
        setIncomingCall(null);
        incomingCallRef.current = null;
      }
      if (message && (matchesActive || matchesIncoming) && !endedBySelfRef.current) {
        showToast(message, 'info');
      }
      handledCallIdsRef.current.delete(callId);
      endedBySelfRef.current = false;
    };

    const handleRejected = (event: CallEventPayload) => {
      if (!event?.callId) return;
      clearIfMatches(event.callId, 'The call was declined.');
    };

    const handleEnded = (event: CallEventPayload) => {
      if (!event?.callId) return;
      clearIfMatches(event.callId, 'The call has ended.');
    };

    const handleParticipantLeft = (event: CallEventPayload) => {
      if (!event?.callId || !event.leftUserId) return;
      if (event.leftUserId === currentUser.id) return;
      const active = activeCallRef.current;
      if (active?.callId !== event.callId) return;
      if (!active.isGroup) {
        showToast('The other participant left the call.', 'info');
      }
    };

    const handleCallUpdate = (event: CallEventPayload) => {
      if (!event?.callId) return;
      if (event.status === 'ended' || event.status === 'rejected' || event.status === 'missed') {
        clearIfMatches(event.callId, event.status === 'rejected' ? 'The call was declined.' : 'The call has ended.');
      }
    };

    socket.on('call:incoming', handleIncoming);
    socket.on('call:answered', handleAnswered);
    socket.on('call:rejected', handleRejected);
    socket.on('call:ended', handleEnded);
    socket.on('call:participant-left', handleParticipantLeft);
    socket.on('call:update', handleCallUpdate);

    return () => {
      socket.off('call:incoming', handleIncoming);
      socket.off('call:answered', handleAnswered);
      socket.off('call:rejected', handleRejected);
      socket.off('call:ended', handleEnded);
      socket.off('call:participant-left', handleParticipantLeft);
      socket.off('call:update', handleCallUpdate);
    };
  }, [socket, currentUser?.id, showToast]);

  const startCall = useCallback(
    async (input: StartCallInput) => {
      if (activeCallRef.current) {
        const message = 'A call is already in progress. End it before starting another.';
        showToast(message, 'error');
        throw new Error(message);
      }
      try {
        const response = await api.initiateCall(input.conversationId, input.type);
        const call: ActiveCallInfo = {
          callId: response.call.id,
          conversationId: input.conversationId,
          roomName: response.call.roomName,
          token: response.token,
          livekitUrl: response.livekitUrl,
          type: input.type,
          title: input.title,
          subtitle: input.subtitle,
          avatarUrl: input.avatarUrl,
          isGroup: input.isGroup,
          participantCount: input.participantCount,
          direction: 'outgoing',
        };
        setActiveCall(call);
        activeCallRef.current = call;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to start the call.';
        showToast(message, 'error');
        throw error;
      }
    },
    [showToast],
  );

  const acceptIncoming = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    if (handledCallIdsRef.current.has(incoming.callId)) return;
    handledCallIdsRef.current.add(incoming.callId);
    try {
      const response = await api.respondToCall(incoming.callId, 'accept');
      if (!response.token || !response.livekitUrl) {
        throw new Error('The calling provider did not return a media token, so the call cannot be joined.');
      }
      let isGroup = incoming.isGroup || false;
      let title = incoming.title || incoming.caller.name;
      let avatarUrl = incoming.avatarUrl || incoming.caller.avatarUrl;
      let participantCount = incoming.participantCount;
      try {
        const conversationResponse = await api.getConversation(incoming.conversationId);
        const conversation = conversationResponse.conversation;
        isGroup = conversation.type === 'group';
        title = conversation.type === 'group' ? conversation.title || 'Group call' : incoming.caller.name;
        avatarUrl = conversation.type === 'group' ? conversation.avatarUrl || avatarUrl : incoming.caller.avatarUrl;
        participantCount =
          conversation.participants?.filter((participant) => !participant.leftAt).length || participantCount;
      } catch {
        // The caller identity is still sufficient to join the existing LiveKit room.
      }

      const call: ActiveCallInfo = {
        callId: incoming.callId,
        conversationId: incoming.conversationId,
        roomName: incoming.roomName,
        token: response.token,
        livekitUrl: response.livekitUrl,
        type: incoming.type,
        title,
        subtitle: `@${incoming.caller.username}`,
        avatarUrl,
        isGroup,
        participantCount,
        direction: 'incoming',
      };
      setIncomingCall(null);
      incomingCallRef.current = null;
      setActiveCall(call);
      activeCallRef.current = call;
    } catch (error) {
      handledCallIdsRef.current.delete(incoming.callId);
      setIncomingCall(null);
      incomingCallRef.current = null;
      showToast(error instanceof Error ? error.message : 'Unable to accept the call.', 'error');
      throw error;
    }
  }, [showToast]);

  const rejectIncoming = useCallback(async () => {
    const incoming = incomingCallRef.current;
    if (!incoming) return;
    setIncomingCall(null);
    incomingCallRef.current = null;
    try {
      await api.respondToCall(incoming.callId, 'reject');
    } catch {
      showToast('The call may have already ended.', 'info');
    }
  }, [showToast]);

  const endActiveCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    endedBySelfRef.current = true;
    setActiveCall(null);
    activeCallRef.current = null;
    try {
      await api.endCall(call.callId);
    } catch {
      // The session may already have been ended by the provider or another participant.
    }
  }, []);

  const value = useMemo(
    () => ({
      incomingCall,
      activeCall,
      isBusy: Boolean(incomingCall || activeCall),
      startCall,
      acceptIncoming,
      rejectIncoming,
      endActiveCall,
    }),
    [incomingCall, activeCall, startCall, acceptIncoming, rejectIncoming, endActiveCall],
  );

  return (
    <CallContext.Provider value={value}>
      {children}
      {incomingCall && !activeCall && currentUser && (
        <IncomingCallScreen
          incoming={incomingCall}
          onAccept={acceptIncoming}
          onDecline={rejectIncoming}
        />
      )}
      {activeCall && currentUser && (
        <CallOverlay
          call={activeCall}
          currentUser={currentUser}
          onEnd={endActiveCall}
          onError={(message) => showToast(message, 'error')}
        />
      )}
    </CallContext.Provider>
  );
};

export const useCall = (): CallContextType => {
  const context = useContext(CallContext);
  if (!context) throw new Error('useCall must be used within CallProvider');
  return context;
};
