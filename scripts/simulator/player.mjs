// The simulator never discovers or launches a real Spotifast executable.
export const tracks = [
  { title: 'Été à Montréal', artists: 'Éléonore & François', duration: 224000, colors: ['#e1b898', '#7b423c', '#e4d4ad'] },
  { title: 'Midnight Drive', artists: 'The Northern Lights', duration: 197000, colors: ['#6097b5', '#18283c', '#ce9fa7'] },
  { title: 'Une chanson au titre très long pour tester les limites de l’écran', artists: 'Éléonore, François et les musiciens du dimanche', duration: 365000, colors: ['#b7bd89', '#3c5847', '#ecce9f'] }
];
export function cover(index) {
  const [a, b, c] = tracks[index % tracks.length].colors;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144"><rect width="144" height="144" fill="${a}"/><circle cx="104" cy="42" r="31" fill="${c}"/><path d="M-20 136 Q18 29 73 97 T168 58 V160 H-20" fill="${b}"/><path d="M-10 154 Q38 73 96 124 T172 99 V160 H-10" fill="${c}" opacity=".65"/></svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
}
export function createPlayer({ now = () => performance.now() } = {}) {
  let index = 0, position = 65000, sampledAt = now(), mode = 'normal';
  let state = 'playing', volume = 50, rememberedVolume = 50, shuffle = false, repeat = 'off', saved = 'no';
  function currentPosition() { return Math.min(tracks[index].duration, position + (state === 'playing' ? Math.max(0, now() - sampledAt) : 0)); }
  function freeze() { position = currentPosition(); sampledAt = now(); }
  function snapshot() {
    const track = tracks[index];
    return { state, title: state === 'stopped' ? '' : track.title, artists: state === 'stopped' ? '' : track.artists,
      album: 'Studio sessions', volume, shuffle, repeat, saved, artUrl: state === 'stopped' ? '' : 'demo:' + index,
      position: mode === 'unknown' ? undefined : currentPosition(), duration: mode === 'unknown' ? undefined : track.duration };
  }
  function reset() { index = 0; position = 65000; sampledAt = now(); mode = 'normal'; state = 'playing'; volume = rememberedVolume = 50; shuffle = false; repeat = 'off'; saved = 'no'; }
  return {
    snapshot,
    get online() { return mode !== 'offline'; },
    get scenarioName() { return mode; },
    scenario(value) {
      freeze(); mode = value;
      if (value === 'reset') reset();
      else if (value === 'long') { index = 2; position = 65000; state = 'playing'; }
      else if (value === 'stopped') { position = 0; state = 'stopped'; }
      else if (value === 'normal' && state === 'stopped') state = 'paused';
    },
    run(args) {
      if (mode === 'offline') throw new Error('Simulated player is offline');
      freeze();
      const [command, amount] = args;
      if (command === 'next' || command === 'previous') { index = (index + (command === 'next' ? 1 : tracks.length - 1)) % tracks.length; position = 0; saved = 'no'; }
      else if (command === 'play-pause') state = state === 'playing' ? 'paused' : 'playing';
      else if (command === 'play' || command === 'pause') state = command === 'play' ? 'playing' : 'paused';
      else if (command === 'volume-up' || command === 'volume-down') volume = Math.max(0, Math.min(100, volume + Number(amount) * (command === 'volume-up' ? 1 : -1)));
      else if (command === 'mute') { if (volume) { rememberedVolume = volume; volume = 0; } else volume = rememberedVolume || 50; }
      else if (command === 'shuffle') shuffle = !shuffle;
      else if (command === 'repeat') repeat = repeat === 'off' ? 'context' : repeat === 'context' ? 'track' : 'off';
      else if (command === 'like') saved = saved === 'yes' ? 'no' : 'yes';
      else throw new Error('Unsupported simulated command: ' + command);
      return snapshot();
    },
    open() { mode = 'normal'; }
  };
}
