import streamDeck from '@elgato/streamdeck';
import sharp from 'sharp';
import { createRuntime } from '../../src/runtime.mjs';
import { cover, createPlayer } from './player.mjs';

const player = createPlayer();
const covers = await Promise.all([0, 1, 2].map(async index => 'data:image/png;base64,' + (await sharp(Buffer.from(cover(index).split(',')[1], 'base64')).png().toBuffer()).toString('base64')));
const emit = value => { if (process.connected) process.send(value); };
const publish = () => emit({ player: { ...player.snapshot(), online: player.online, scenario: player.scenarioName } });
const client = {
  configure() {},
  async snapshot() { if (!player.online) throw new Error('Simulated offline scenario'); return player.snapshot(); },
  async run(args) { player.run(args); emit({ command: args }); publish(); },
  async open() { player.open(); emit({ command: ['open'] }); publish(); }
};
const runtime = createRuntime(streamDeck, { client, artwork: {
  async get(url) { const match = /^demo:([0-2])$/.exec(url ?? ''); return match ? covers[Number(match[1])] : undefined; }
} });
process.on('message', async message => {
  if (message.scenario) {
    try { player.scenario(message.scenario); publish(); await runtime.refresh(); emit({ ack: message.id }); }
    catch (error) { emit({ ack: message.id, error: error.message }); }
  }
});
await runtime.start();
publish();
emit({ ready: true });
setInterval(publish, 1000).unref();
process.on('disconnect', () => { runtime.stop(); process.exit(0); });
