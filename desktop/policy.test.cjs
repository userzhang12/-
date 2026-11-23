const assert = require('node:assert/strict');
const test = require('node:test');
const { endpoint, workbenchEndpoint, allowsNavigation, downloadName } = require('./policy.cjs');

test('packaged service and update feeds require HTTPS', () => {
  assert.equal(endpoint('https://app.example.com/').origin, 'https://app.example.com');
  assert.equal(endpoint('http://127.0.0.1:3000', true).hostname, '127.0.0.1');
  for (const url of ['http://127.0.0.1:3000', 'https://u:p@example.com', 'https://example.com/#route', 'file:///tmp/app']) {
    assert.throws(() => endpoint(url));
  }
  assert.throws(() => endpoint('http://example.com', true));
});

test('installation URLs open the workbench even with a public site URL in the configuration', () => {
  for (const path of ['/', '/download', '/download/', '/workbench']) {
    assert.equal(workbenchEndpoint('https://app.example.com' + path).href, 'https://app.example.com/workbench');
  }
  assert.equal(workbenchEndpoint('http://localhost:3000', true).pathname, '/workbench');
  assert.throws(() => workbenchEndpoint('http://app.example.com/'));
});

test('desktop window stays inside the configured service boundary', () => {
  const origin = 'https://app.example.com';
  assert(allowsNavigation(origin + '/api/projects/download', origin));
  for (const url of ['https://app.example.com.bad.test', 'http://app.example.com', 'javascript:alert(0)', 'https://u@app.example.com']) {
    assert(!allowsNavigation(url, origin));
  }
});

test('downloads always use a plain Windows-safe basename', () => {
  assert.equal(downloadName('../a.mp4'), '.._a.mp4');
  assert.equal(downloadName('NUL.mp4'), '_NUL.mp4');
  assert.equal(downloadName('短剧成片.mp4'), '短剧成片.mp4');
  assert.equal(downloadName('...'), 'jingxu-download');
});
