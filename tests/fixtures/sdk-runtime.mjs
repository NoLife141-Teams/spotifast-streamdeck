import streamDeck from '@elgato/streamdeck';
import { createRuntime } from '../../src/runtime.mjs';

let armedRequest, blockedRequest, releaseSnapshot;
process.on('message', message => {
  if (message.armSnapshot) { armedRequest = message.armSnapshot; process.send({ armed: armedRequest }); }
  if (message.releaseSnapshot) { releaseSnapshot(); }
});

// Arm only the named inspector request, never an unrelated background poll.
streamDeck.ui.onSendToPlugin(event => {
  if (event.payload.requestId === armedRequest) { blockedRequest = armedRequest; armedRequest = undefined; }
});

// Use the real SDK and wire protocol, but never invoke the user's player.
const client = {
  configure(value) { this.customPath = value; },
  async snapshot() {
    if (blockedRequest) {
      const requestId = blockedRequest; blockedRequest = undefined;
      await new Promise(resolve => { releaseSnapshot = resolve; process.send({ blocked: requestId }); });
      setImmediate(() => process.send({ released: requestId }));
    }
    return { state: 'paused', title: 'SDK test', artists: 'Test', artUrl: '', volume: 50, shuffle: false, repeat: 'off', saved: 'no' };
  },
  async run(args) { process.send({ command: args }); },
  async open() { throw Object.assign(new Error('Missing test executable'), { messageKey: 'executableMissing' }); }
};
await createRuntime(streamDeck, { client }).start();
streamDeck.ui.onDidAppear(event => process.send({ appeared: event.action.id }));
streamDeck.ui.onDidDisappear(event => process.send({ disappeared: event.action.id, current: streamDeck.ui.action?.id }));
process.send({ ready: true });
