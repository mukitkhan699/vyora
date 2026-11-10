export interface MessageTiming {
  sendInitiated: number;
  serverReceived?: number;
  databaseCommitted?: number;
  recipientEventPublished?: number;
  recipientReceived?: number;
  recipientRendered?: number;
  clientId: string;
  conversationId: string;
}

interface TimingCallback {
  (event: 'serverReceived' | 'databaseCommitted' | 'recipientEventPublished' | 'recipientReceived' | 'recipientRendered', timing: MessageTiming): void;
}

const timings = new Map<string, MessageTiming>();
const callbacks: TimingCallback[] = [];

export function recordSendInitiated(clientId: string, conversationId: string): void {
  timings.set(clientId, {
    sendInitiated: performance.now(),
    clientId,
    conversationId,
  });
}

export function recordTiming(
  clientId: string,
  event: 'serverReceived' | 'databaseCommitted' | 'recipientEventPublished' | 'recipientReceived' | 'recipientRendered'
): void {
  const timing = timings.get(clientId);
  if (!timing) return;

  const now = performance.now();
  switch (event) {
    case 'serverReceived':
      timing.serverReceived = now;
      break;
    case 'databaseCommitted':
      timing.databaseCommitted = now;
      break;
    case 'recipientEventPublished':
      timing.recipientEventPublished = now;
      break;
    case 'recipientReceived':
      timing.recipientReceived = now;
      break;
    case 'recipientRendered':
      timing.recipientRendered = now;
      break;
  }
  callbacks.forEach((cb) => cb(event, timing));
}

export function getTiming(clientId: string): MessageTiming | undefined {
  return timings.get(clientId);
}

export function clearTiming(clientId: string): void {
  timings.delete(clientId);
}

export function onTiming(cb: TimingCallback): () => void {
  callbacks.push(cb);
  return () => {
    const idx = callbacks.indexOf(cb);
    if (idx >= 0) callbacks.splice(idx, 1);
  };
}

export function getAggregatedStats(): {
  avgSendLatency: number;
  avgServerLatency: number;
  avgDeliveryLatency: number;
  avgRenderLatency: number;
  sampleCount: number;
} {
  const completed = Array.from(timings.values()).filter((t) => t.recipientRendered);
  if (completed.length === 0) {
    return { avgSendLatency: 0, avgServerLatency: 0, avgDeliveryLatency: 0, avgRenderLatency: 0, sampleCount: 0 };
  }

  let totalSend = 0;
  let totalServer = 0;
  let totalDelivery = 0;
  let totalRender = 0;

  for (const t of completed) {
    if (t.serverReceived) totalSend += t.serverReceived - t.sendInitiated;
    if (t.databaseCommitted && t.serverReceived) totalServer += t.databaseCommitted - t.serverReceived;
    if (t.recipientReceived && t.databaseCommitted) totalDelivery += t.recipientReceived - t.databaseCommitted;
    if (t.recipientRendered && t.recipientReceived) totalRender += t.recipientRendered - t.recipientReceived;
  }

  const n = completed.length;
  return {
    avgSendLatency: totalSend / n,
    avgServerLatency: totalServer / n,
    avgDeliveryLatency: totalDelivery / n,
    avgRenderLatency: totalRender / n,
    sampleCount: n,
  };
}