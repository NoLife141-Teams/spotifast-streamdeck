import streamDeck from '@elgato/streamdeck';
import { createRuntime } from '../../src/runtime.mjs';

// Use the real SDK and wire protocol, but never invoke the user's player.
const client = {
  configure(value) { this.customPath = value; },
  async snapshot() { return { state: 'paused', title: 'SDK test', artists: 'Test', artUrl: '', volume: 50, shuffle: false, repeat: 'off', saved: 'no' }; },
  async run(args) { process.send({ command: args }); },
  async open() { throw Object.assign(new Error('Missing test executable'), { messageKey: 'executableMissing' }); }
};
await createRuntime(streamDeck, { client }).start();
process.send({ ready: true });
