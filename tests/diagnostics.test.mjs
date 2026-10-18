import test from 'node:test';
import assert from 'node:assert/strict';
import { createDiagnostics, diagnosticCategory, safeVersion } from '../src/diagnostics.mjs';

test('numeric versions accept the exact Spotifast prefix and reject other output', () => {
  for (const [input, expected] of [
    ['0.2.7', '0.2.7'], ['7.0.3.12345', '7.0.3.12345'], ['v0.13.3', '0.13.3'],
    ['spotifast 0.13.3\r\n', '0.13.3'], [' 7.0 ', '7.0'], ['1', '1']
  ]) assert.equal(safeVersion(input), expected);
  for (const input of [
    undefined, null, 7, {}, ['1.2.3'], 'unknown', '', '0.13.3-token', 'v1.2.3+secret',
    '0.13.3.1.2', '12345678901234567890', 'Spotify 0.13.3', 'Spotifast 0.13.3',
    'spotifast 0.13.3\nsecret', '1.2.3 https://example.test/token', 'C:\\Users\\alice\\0.13.3',
    '1.2.3\u0000', '1.2.3\n4.5.6', 'x'.repeat(10000)
  ]) assert.equal(safeVersion(input), 'unavailable');
});

test('classification uses exact known message keys with actionable localized keys', () => {
  for (const [messageKey, category, expectedMessageKey, actionKey] of [
    ['executableMissing', 'executable-missing', 'executableMissing', 'diagnosticActionCheckPath'],
    ['commandTimeout', 'timeout', 'commandTimeout', 'diagnosticActionRetry'],
    ['unavailable', 'unavailable', 'unavailable', 'diagnosticActionOpen'],
    ['notSignedIn', 'not-signed-in', 'diagnosticNotSignedIn', 'diagnosticActionSignIn'],
    ['noPlayback', 'no-playback', 'diagnosticNoPlayback', 'diagnosticActionPlay'],
    ['deviceUnavailable', 'device-unavailable', 'diagnosticDeviceUnavailable', 'diagnosticActionDevice'],
    ['incompleteResponse', 'invalid-response', 'unknownResponse', 'diagnosticActionRetry'],
    ['invalidUri', 'invalid-input', 'invalidUri', 'diagnosticActionSettings'],
    ['unknownRotation', 'invalid-action', 'unknownAction', 'diagnosticActionSettings'],
    ['unsupportedMultiAction', 'unsupported-action', 'unsupportedMultiAction', 'diagnosticActionSettings'],
    ['commandQueueBusy', 'busy', 'commandQueueBusy', 'diagnosticActionRetry'],
    ['commandExpired', 'expired', 'commandExpired', 'diagnosticActionRetry']
  ]) assert.deepEqual(diagnosticCategory({ messageKey }), { category, messageKey: expectedMessageKey, actionKey });
});

test('unknown text, prototype keys and misleading success messages stay generic', () => {
  for (const error of [
    new Error('not signed in; timeout; executableMissing; noPlayback'),
    { stderr: 'device unavailable', stdout: 'connected', code: 'ENOENT' },
    { messageKey: 'connected' }, { messageKey: '__proto__' }, { messageKey: 'constructor' },
    { messageKey: 'commandTimeout SECRET' }, { killed: 'true' }, { code: 'ETIMEDOUT SECRET' },
    'commandTimeout', null, undefined,
    { get messageKey() { throw new Error('private path'); } }
  ]) assert.deepEqual(diagnosticCategory(error), {
    category: 'unknown', messageKey: 'commandFailed', actionKey: 'diagnosticActionRetry'
  });
});

test('structured process timeout signals are categorized without storing process details', () => {
  for (const error of [{ killed: true }, { code: 'ETIMEDOUT' }]) {
    assert.equal(diagnosticCategory(error).category, 'timeout');
  }
  assert.equal(diagnosticCategory({ messageKey: 'executableMissing', killed: true }).category, 'executable-missing');
});

test('snapshot is entirely allowlisted, stripping personal paths, tokens and playback identifiers', () => {
  const sensitive = [
    'C:\\Users\\alice-personal\\AppData\\Spotifast.exe', 'alice-personal',
    'bearer-SECRET-TOKEN', 'https://private.test/?token=bearer-SECRET-TOKEN',
    'spotify:track:42PrivateTrack', 'Private song title', 'Private artist', 'private-device-id'
  ];
  const diagnostics = createDiagnostics({ now: () => 123 });
  diagnostics.recordError({
    messageKey: sensitive[0], message: sensitive.join(' '), stack: sensitive[1], token: sensitive[2],
    stderr: sensitive[3], stdout: sensitive[4], title: sensitive[5], artist: sensitive[6], device: sensitive[7],
    toJSON() { return { secret: sensitive }; }
  }, sensitive[7]);
  diagnostics.recordSuccess(sensitive[1]);
  const report = diagnostics.snapshot({
    pluginVersion: sensitive[0], hostVersion: sensitive[2], upstreamVersion: sensitive[3],
    detected: sensitive[1], pathMode: sensitive[0], online: sensitive[2], hasPlayback: sensitive[5],
    path: sensitive[0], username: sensitive[1], token: sensitive[2], track: sensitive[4],
    title: sensitive[5], artist: sensitive[6], device: sensitive[7], extra: { sensitive }
  });
  assert.deepEqual(report, {
    version: 1, pluginVersion: 'unavailable', hostVersion: 'unavailable', upstreamVersion: 'unavailable',
    detection: { found: null, pathMode: 'automatic' }, connection: 'offline', playback: 'none',
    lastSuccess: { scope: 'inspector', at: 123 },
    recentErrors: [{ scope: 'inspector', at: 123, category: 'unknown', messageKey: 'commandFailed', actionKey: 'diagnosticActionRetry' }],
    status: { category: 'unavailable', messageKey: 'unavailable', actionKey: 'diagnosticActionOpen' }
  });
  const serialized = JSON.stringify(report);
  for (const secret of sensitive) assert.ok(!serialized.includes(secret), secret);
  assert.deepEqual(JSON.parse(serialized), report);
});

test('history keeps only five recent errors, newest first, and the latest successful operation', () => {
  let now = 100;
  const diagnostics = createDiagnostics({ now: () => now });
  diagnostics.recordSuccess('status');
  for (let i = 0; i < 8; i++) { now++; diagnostics.recordError({ messageKey: 'commandTimeout' }, 'command'); }
  now++;
  diagnostics.recordSuccess('open');
  const report = diagnostics.snapshot();
  assert.equal(report.recentErrors.length, 5);
  assert.deepEqual(report.recentErrors.map(error => error.at), [108, 107, 106, 105, 104]);
  assert.ok(report.recentErrors.every(error => error.scope === 'command'));
  assert.deepEqual(report.lastSuccess, { scope: 'open', at: 109 });
});

test('snapshot and category results cannot mutate later diagnostics', () => {
  const diagnostics = createDiagnostics({ now: () => 42 });
  const error = { messageKey: 'executableMissing' };
  diagnostics.recordError(error, 'status');
  diagnostics.recordSuccess('inspector');
  error.messageKey = 'private-secret';
  const first = diagnostics.snapshot();
  first.lastSuccess.scope = 'private-secret';
  first.recentErrors[0].messageKey = 'private-secret';
  first.recentErrors.push({ messageKey: 'private-secret' });
  first.status.category = 'private-secret';
  const category = diagnosticCategory({ messageKey: 'executableMissing' });
  category.messageKey = 'private-secret';
  const second = diagnostics.snapshot();
  assert.equal(second.recentErrors.length, 1);
  assert.equal(second.recentErrors[0].messageKey, 'executableMissing');
  assert.equal(second.lastSuccess.scope, 'inspector');
  assert.equal(second.status.category, 'unavailable');
  assert.equal(diagnosticCategory({ messageKey: 'executableMissing' }).messageKey, 'executableMissing');
});

test('missing executable, offline connection, and absent playback have distinct status guidance', () => {
  const diagnostics = createDiagnostics();
  assert.equal(diagnostics.snapshot({ detected: false }).status.category, 'executable-missing');
  assert.equal(diagnostics.snapshot({ detected: true, online: false }).status.category, 'unavailable');
  const idle = diagnostics.snapshot({ detected: true, online: true, hasPlayback: false });
  assert.equal(idle.connection, 'online');
  assert.equal(idle.playback, 'none');
  assert.equal(idle.status.category, 'no-playback');
  const playing = diagnostics.snapshot({ detected: true, online: true, hasPlayback: true, pathMode: 'custom' });
  assert.equal(playing.playback, 'available');
  assert.equal(playing.detection.pathMode, 'custom');
  assert.equal(playing.status, null);
  assert.equal(diagnostics.snapshot({ online: false, hasPlayback: true }).playback, 'none');
  assert.equal(diagnostics.snapshot().lastSuccess, null);
});

test('timestamps reject nonnumeric values and invalid dates rather than serializing arbitrary data', () => {
  for (const value of ['private-time', NaN, Infinity, -1, 1.5, 8640000000000001, {}]) {
    const diagnostics = createDiagnostics({ now: () => value });
    diagnostics.recordError(new Error('private error'), 'status');
    diagnostics.recordSuccess('command');
    assert.equal(diagnostics.snapshot().lastSuccess.at, null);
    assert.equal(diagnostics.snapshot().recentErrors[0].at, null);
  }
  const brokenClock = createDiagnostics({ now: () => { throw new Error('private clock error'); } });
  brokenClock.recordSuccess('status');
  assert.equal(brokenClock.snapshot().lastSuccess.at, null);
});

test('all four allowed scopes survive and arbitrary scope types collapse to inspector', () => {
  const diagnostics = createDiagnostics({ now: () => 0 });
  for (const scope of ['status', 'command', 'open', 'inspector']) {
    diagnostics.recordSuccess(scope);
    diagnostics.recordError({}, scope);
    assert.equal(diagnostics.snapshot().lastSuccess.scope, scope);
    assert.equal(diagnostics.snapshot().recentErrors[0].scope, scope);
  }
  for (const scope of ['secret', '__proto__', {}, ['status'], null, undefined]) {
    diagnostics.recordSuccess(scope);
    assert.equal(diagnostics.snapshot().lastSuccess.scope, 'inspector');
  }
});
