import assert from 'node:assert/strict';
import test from 'node:test';
import { handleImageViewerOverlayClick, openImageViewer } from './mediaInteractions.ts';

test('opening a single or gallery image stops post navigation and selects that image', () => {
  for (const index of [0, 3]) {
    let propagationStopped = false;
    let selectedIndex = -1;
    openImageViewer(
      { stopPropagation: () => { propagationStopped = true; } },
      index,
      (selected) => { selectedIndex = selected; },
    );

    assert.equal(propagationStopped, true);
    assert.equal(selectedIndex, index);
  }
});

test('lightbox controls do not bubble into post navigation or close the viewer', () => {
  let propagationStopped = false;
  let closeCount = 0;
  const overlay = {};
  handleImageViewerOverlayClick(
    {
      target: {},
      currentTarget: overlay,
      stopPropagation: () => { propagationStopped = true; },
    },
    () => { closeCount += 1; },
  );

  assert.equal(propagationStopped, true);
  assert.equal(closeCount, 0);
});

test('clicking the lightbox backdrop closes it without bubbling to the post', () => {
  let propagationStopped = false;
  let closeCount = 0;
  const overlay = {};
  handleImageViewerOverlayClick(
    {
      target: overlay,
      currentTarget: overlay,
      stopPropagation: () => { propagationStopped = true; },
    },
    () => { closeCount += 1; },
  );

  assert.equal(propagationStopped, true);
  assert.equal(closeCount, 1);
});
