// Deterministic animal-avatar identities, derived from any id string.
// Same id -> same {emoji, name, color} on every client, so peers agree
// without exchanging anything (rooms). For 1-on-1 we exchange the id via a
// DataChannel hello, then both sides derive the same identity.

const ANIMALS = [
  ['🦊', 'Fox'], ['🐼', 'Panda'], ['🦉', 'Owl'], ['🐧', 'Penguin'],
  ['🐸', 'Frog'], ['🐺', 'Wolf'], ['🦝', 'Raccoon'], ['🐨', 'Koala'],
  ['🦁', 'Lion'], ['🐯', 'Tiger'], ['🐮', 'Cow'], ['🐷', 'Pig'],
  ['🐵', 'Monkey'], ['🐙', 'Octopus'], ['🦄', 'Unicorn'], ['🐢', 'Turtle'],
  ['🦅', 'Eagle'], ['🦋', 'Butterfly'], ['🐝', 'Bee'], ['🦔', 'Hedgehog'],
  ['🦢', 'Swan'], ['🦩', 'Flamingo'], ['🐬', 'Dolphin'], ['🦕', 'Dino'],
];

const ADJECTIVES = [
  'Brave', 'Calm', 'Swift', 'Witty', 'Cosmic', 'Mellow', 'Lucky', 'Sly',
  'Bold', 'Gentle', 'Quiet', 'Sunny', 'Jolly', 'Wild', 'Noble', 'Quirky',
  'Zen', 'Funky', 'Curious', 'Dapper', 'Breezy', 'Cozy', 'Spry', 'Plucky',
];

function hashId(id) {
  let h = 0;
  for (const ch of String(id || '')) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h);
}

function identityForId(id) {
  const h = hashId(id);
  const [emoji, animal] = ANIMALS[h % ANIMALS.length];
  const adj = ADJECTIVES[(Math.floor(h / ANIMALS.length)) % ADJECTIVES.length];
  const color = `hsl(${h % 360}, 70%, 66%)`;
  return { emoji, name: `${adj} ${animal}`, color, id };
}

window.Identity = { identityForId };
