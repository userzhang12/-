import assert from 'node:assert/strict';
import test from 'node:test';
import { releaseManifest } from '../web/app/(site)/manifest.mjs';

const sample = {
  version: '0.1.0', channel: 'stable', file: 'jingxu-setup-0.1.0-x64.exe',
  sha256: 'f'.repeat(64), bytes: 4096, published: '2026-11-22', notes: '首版',
};

test('release manifest accepts only the installer belonging to its channel and version', () => {
  assert.equal(releaseManifest(sample, 'stable').file, sample.file);
  for (const key of ['../setup.exe', 'https://example.org/setup.exe', 'jingxu-setup-9.0.0-x64.exe']) {
    assert.throws(() => releaseManifest({ ...sample, file: key }, 'stable'));
  }
  assert.throws(() => releaseManifest(sample, 'beta'));
  assert.throws(() => releaseManifest({ ...sample, sha256: 'none' }, 'stable'));
  assert.throws(() => releaseManifest({ ...sample, bytes: -1 }, 'stable'));
});

test('unsigned preview filename cannot be used in a signed release manifest', async () => {
  const { previewManifest } = await import('../web/app/(site)/manifest.mjs');
  const preview = { ...sample, channel: 'preview', file: 'jingxu-test-setup-0.1.0-x64.exe' };
  assert.equal(previewManifest(preview).file, preview.file);
  assert.throws(() => previewManifest(sample));
  assert.throws(() => previewManifest({ ...preview, file: '../' + preview.file }));
  assert.throws(() => releaseManifest(preview, 'stable'));
  assert.throws(() => releaseManifest(preview, 'preview'));
});
