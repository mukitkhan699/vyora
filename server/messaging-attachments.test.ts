import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { matchesFileSignature } from './storage/b2.ts';

describe('Message Attachments & Storage Retention Contracts', () => {
  test('validates supported document and media file signatures', () => {
    const pdfBytes = Buffer.from('%PDF-1.5 test document');
    assert.equal(matchesFileSignature('application/pdf', pdfBytes), true);

    const textBytes = Buffer.from('Plain text message attachment');
    assert.equal(matchesFileSignature('text/plain', textBytes), true);

    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(matchesFileSignature('image/png', pngBytes), true);

    const mp4Bytes = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]);
    assert.equal(matchesFileSignature('video/mp4', mp4Bytes), true);
  });

  test('rejects mismatched and unsupported attachment file signatures', () => {
    const corruptedPdf = Buffer.from('NOT-A-PDF-HEADER');
    assert.equal(matchesFileSignature('application/pdf', corruptedPdf), false);

    const empty = Buffer.alloc(0);
    assert.equal(matchesFileSignature('application/pdf', empty), false);
    assert.equal(matchesFileSignature('video/mp4', empty), false);
  });
});
