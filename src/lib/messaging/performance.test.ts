import assert from 'node:assert/strict';
import { describe, test, before, after, beforeEach } from 'node:test';
import {
  recordSendInitiated,
  recordTiming,
  getTiming,
  clearTiming,
  getAggregatedStats,
} from './performance.ts';

describe('Performance Instrumentation', () => {
  beforeEach(() => {
    // Clear all timings before each test
    // Note: In real usage, timings are per-clientId and auto-cleared
  });

  describe('Timing Recording', () => {
    test('records send initiated timestamp', () => {
      const clientId = 'test_client_1';
      const conversationId = 'conv_test';
      
      recordSendInitiated(clientId, conversationId);
      const timing = getTiming(clientId);
      
      assert.ok(timing);
      assert.equal(timing.clientId, clientId);
      assert.equal(timing.conversationId, conversationId);
      assert.ok(timing.sendInitiated > 0);
    });

    test('records subsequent timing events', () => {
      const clientId = 'test_client_2';
      const conversationId = 'conv_test';
      
      recordSendInitiated(clientId, conversationId);
      recordTiming(clientId, 'serverReceived');
      recordTiming(clientId, 'databaseCommitted');
      
      const timing = getTiming(clientId);
      assert.ok(timing);
      assert.ok(timing!.serverReceived);
      assert.ok(timing!.databaseCommitted);
      assert.ok(timing!.serverReceived > timing!.sendInitiated);
      assert.ok(timing!.databaseCommitted > timing!.serverReceived);
    });

    test('returns undefined for unknown clientId', () => {
      const timing = getTiming('nonexistent_client');
      assert.equal(timing, undefined);
    });

    test('clears timing data', () => {
      const clientId = 'test_client_3';
      recordSendInitiated(clientId, 'conv_test');
      assert.ok(getTiming(clientId));
      
      clearTiming(clientId);
      assert.equal(getTiming(clientId), undefined);
    });
  });

  describe('Aggregated Stats', () => {
    test('returns zero stats when no completed timings', () => {
      const stats = getAggregatedStats();
      assert.equal(stats.avgSendLatency, 0);
      assert.equal(stats.avgServerLatency, 0);
      assert.equal(stats.avgDeliveryLatency, 0);
      assert.equal(stats.avgRenderLatency, 0);
      assert.equal(stats.sampleCount, 0);
    });

    test('calculates average latencies', () => {
      // Add multiple completed timings
      for (let i = 0; i < 3; i++) {
        const clientId = `stats_client_${i}`;
        const base = Date.now() + i * 1000;
        
        recordSendInitiated(clientId, 'conv_test');
        recordTiming(clientId, 'serverReceived');
        recordTiming(clientId, 'databaseCommitted');
        recordTiming(clientId, 'recipientEventPublished');
        recordTiming(clientId, 'recipientReceived');
        recordTiming(clientId, 'recipientRendered');
        
        // Manually set precise times for testing
        const timing = getTiming(clientId);
        if (timing) {
          timing.sendInitiated = base;
          timing.serverReceived = base + 50;
          timing.databaseCommitted = base + 80;
          timing.recipientEventPublished = base + 100;
          timing.recipientReceived = base + 150;
          timing.recipientRendered = base + 200;
        }
      }
      
      const stats = getAggregatedStats();
      assert.equal(stats.sampleCount, 3);
      assert.ok(stats.avgSendLatency > 0);
      assert.ok(stats.avgServerLatency > 0);
      assert.ok(stats.avgDeliveryLatency > 0);
      assert.ok(stats.avgRenderLatency > 0);
    });
  });
});