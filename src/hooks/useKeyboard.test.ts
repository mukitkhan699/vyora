import assert from 'node:assert/strict';
import test from 'node:test';
import { getVisualViewportBottomInset } from './useKeyboard.ts';

test('visual viewport inset measures only the area below the visible screen', () => {
  assert.equal(
    getVisualViewportBottomInset(
      { bottom: 800 },
      { height: 500, offsetTop: 0 },
    ),
    300,
  );
});

test('visual viewport inset accounts for a panned visible viewport', () => {
  assert.equal(
    getVisualViewportBottomInset(
      { bottom: 800 },
      { height: 500, offsetTop: 100 },
    ),
    200,
  );
});

test('visual viewport inset is zero when the layout already fits the visible screen', () => {
  assert.equal(
    getVisualViewportBottomInset(
      { bottom: 500 },
      { height: 500, offsetTop: 0 },
    ),
    0,
  );
});
