import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createSimulator } from '../scripts/simulator/server.mjs';

test('visual simulator routes dials and touch through the real SDK and resets isolated player state', { timeout: 20000 }, async t => {
  const simulator = await createSimulator({ port: 0 });
  t.after(() => simulator.close());
  const read = () => fetch(simulator.url + '/api/state').then(response => response.json());
  const post = async (endpoint, body, headers = {}) => {
    const response = await fetch(simulator.url + '/api/' + endpoint, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  };
  async function waitFor(predicate) {
    const deadline = Date.now() + 5000;
    do { const state = await read(); if (predicate(state)) return state; await delay(20); } while (Date.now() < deadline);
    throw new Error('Simulator did not reach expected state');
  }
  // Metadata is rendered before the separate artwork request completes.
  // Wait for the actual cover before inspecting the initial feedback snapshot.
  const initial = await waitFor(state => state.dials.every(entry => entry.feedback.track || entry.feedback.title) &&
    /^data:image\/png;base64,/.test(state.dials[0].feedback.artwork ?? ''));
  assert.equal((await fetch(simulator.url)).status, 200);
  assert.equal((await fetch(simulator.url + '/imgs/music.png')).status, 200);
  assert.equal((await fetch(simulator.url + '/package.json')).status, 404);
  assert.equal(initial.keys.length, 8);
  assert.equal(initial.dials.length, 4);
  assert.equal(initial.dials[0].feedback.track, 'Été à Montréal');
  assert.equal(initial.dials[1].feedback.value, '50%');
  assert.match(initial.dials[0].feedback.artwork, /^data:image\/png;base64,/);

  assert.equal((await post('event', { index: 0, type: 'rotate', ticks: 2 })).status, 200);
  await waitFor(state => state.trace.filter(row => row.event === 'Commande' && row.detail === 'next').length === 2);
  assert.equal((await read()).player.title.startsWith('Une chanson'), true);
  await post('event', { index: 0, type: 'rotate', ticks: -2 });
  await waitFor(state => state.player.title === 'Été à Montréal');
  await post('event', { index: 0, type: 'push' });
  await waitFor(state => state.player.state === 'paused');
  await post('event', { index: 0, type: 'touch', tapPos: [46, 67] });
  await waitFor(state => state.player.shuffle === true);
  await post('event', { index: 0, type: 'touch', tapPos: [137, 67] });
  await waitFor(state => state.player.title === 'Midnight Drive');
  await post('event', { index: 0, type: 'touch', tapPos: [75, 67] });
  await waitFor(state => state.player.title === 'Été à Montréal');
  await post('event', { index: 0, type: 'touch', tapPos: [108, 67] });
  await waitFor(state => state.player.state === 'playing');

  await post('config', { index: 3, action: 'volume', step: 10 });
  await post('event', { index: 3, type: 'rotate', ticks: 2 });
  await waitFor(state => state.player.volume === 70);
  await post('event', { index: 3, type: 'push' });
  await waitFor(state => state.player.volume === 0);
  await post('event', { index: 3, type: 'push' });
  await waitFor(state => state.player.volume === 70);
  await post('config', { index: 2, action: 'volume', step: 25 });
  await post('event', { index: 2, type: 'rotate', ticks: -4 });
  await waitFor(state => state.player.volume === 0);
  await post('key', { index: 7 });
  await waitFor(state => state.player.saved === 'yes');

  assert.equal((await post('scenario', { scenario: 'unknown' })).status, 200);
  await waitFor(state => state.dials[0].feedback.duration === '--:--');
  await post('scenario', { scenario: 'offline' });
  await waitFor(state => state.dials[0].feedback.track === 'Hors ligne');
  await post('event', { index: 1, type: 'rotate', ticks: 1 });
  await waitFor(state => state.dials[1].alerts > 0);
  assert.equal((await read()).player.online, false);
  await post('scenario', { scenario: 'reset' });
  const reset = await waitFor(state => state.dials[0].feedback.track === 'Été à Montréal' && state.dials[1].feedback.value === '50%');
  assert.equal(reset.player.online, true);
  assert.equal(reset.player.shuffle, false);
  assert.deepEqual(reset.dials.map(entry => entry.action), ['multimedia', 'volume', 'multimedia', 'volume']);
  assert.ok(reset.dials.every(entry => entry.settings.step === 5));

  assert.equal((await post('event', { index: 0, type: 'rotate', ticks: 999 })).status, 400);
  assert.equal((await post('event', { index: 0, type: 'touch', tapPos: [200, 20] })).status, 400);
  assert.equal((await post('config', { index: 0, action: 'arbitrary', step: 5 })).status, 400);
  assert.equal((await post('scenario', { scenario: 'offline' }, { origin: 'https://external.example' })).status, 403);
  assert.equal((await read()).player.online, true);
});
