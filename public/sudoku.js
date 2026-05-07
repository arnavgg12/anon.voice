// Co-op Sudoku — peer-to-peer over the same WebRTC DataChannel.
// Shared seed → identical puzzle on both sides. Each fill broadcast to peer.
// Cells get colored by who filled them (you blue, partner green).

const SIZE = 9;
const REMOVE = 38; // ~43 clues — medium difficulty

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildSudoku(seed) {
  const rng = mulberry32(seed);
  // Base valid grid (shifted-row pattern)
  let g = [];
  for (let i = 0; i < SIZE; i++) {
    const row = [];
    for (let j = 0; j < SIZE; j++) {
      row.push(((i * 3 + Math.floor(i / 3) + j) % 9) + 1);
    }
    g.push(row);
  }
  // Validity-preserving transformations
  const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
  g = g.map((row) => row.map((v) => digits[v - 1]));
  for (let band = 0; band < 3; band++) {
    const order = shuffle([0, 1, 2], rng);
    const rows = order.map((o) => g[band * 3 + o]);
    for (let i = 0; i < 3; i++) g[band * 3 + i] = rows[i];
  }
  for (let stack = 0; stack < 3; stack++) {
    const order = shuffle([0, 1, 2], rng);
    for (let row = 0; row < SIZE; row++) {
      const cells = order.map((o) => g[row][stack * 3 + o]);
      for (let i = 0; i < 3; i++) g[row][stack * 3 + i] = cells[i];
    }
  }
  const bandOrder = shuffle([0, 1, 2], rng);
  g = bandOrder.flatMap((o) => [g[o * 3], g[o * 3 + 1], g[o * 3 + 2]]);
  const stackOrder = shuffle([0, 1, 2], rng);
  for (let row = 0; row < SIZE; row++) {
    g[row] = stackOrder.flatMap((o) => [g[row][o * 3], g[row][o * 3 + 1], g[row][o * 3 + 2]]);
  }

  const solution = g.map((r) => [...r]);

  // Punch out cells
  const positions = shuffle(Array.from({ length: 81 }, (_, i) => i), rng);
  const puzzle = g.map((r) => [...r]);
  for (let i = 0; i < REMOVE; i++) {
    const p = positions[i];
    puzzle[Math.floor(p / 9)][p % 9] = 0;
  }
  const givens = new Set();
  for (let i = 0; i < 81; i++) {
    if (puzzle[Math.floor(i / 9)][i % 9] !== 0) givens.add(i);
  }
  return { puzzle, solution, givens };
}

function checkConflicts(grid) {
  const c = new Set();
  // rows
  for (let i = 0; i < 9; i++) {
    const seen = new Map();
    for (let j = 0; j < 9; j++) {
      const v = grid[i][j];
      if (!v) continue;
      if (seen.has(v)) { c.add(i * 9 + j); c.add(i * 9 + seen.get(v)); }
      else seen.set(v, j);
    }
  }
  // cols
  for (let j = 0; j < 9; j++) {
    const seen = new Map();
    for (let i = 0; i < 9; i++) {
      const v = grid[i][j];
      if (!v) continue;
      if (seen.has(v)) { c.add(i * 9 + j); c.add(seen.get(v) * 9 + j); }
      else seen.set(v, i);
    }
  }
  // boxes
  for (let bi = 0; bi < 3; bi++) {
    for (let bj = 0; bj < 3; bj++) {
      const seen = new Map();
      for (let di = 0; di < 3; di++) {
        for (let dj = 0; dj < 3; dj++) {
          const i = bi * 3 + di, j = bj * 3 + dj;
          const v = grid[i][j];
          if (!v) continue;
          if (seen.has(v)) { c.add(i * 9 + j); c.add(seen.get(v)); }
          else seen.set(v, i * 9 + j);
        }
      }
    }
  }
  return c;
}

function isWon(grid) {
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      if (!grid[i][j]) return false;
    }
  }
  return checkConflicts(grid).size === 0;
}

function renderSudoku(state, gridEl, statusEl, onSelect) {
  const conflicts = checkConflicts(state.puzzle);
  gridEl.innerHTML = '';
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 9; j++) {
      const idx = i * 9 + j;
      const cell = document.createElement('div');
      cell.className = 'sudoku-cell';
      if (state.givens.has(idx)) cell.classList.add('given');
      if (conflicts.has(idx)) cell.classList.add('conflict');
      else if (state.filledBy[i][j] === 'me') cell.classList.add('by-me');
      else if (state.filledBy[i][j] === 'them') cell.classList.add('by-them');
      if (state.selected === idx) cell.classList.add('selected');
      if (j === 2 || j === 5) cell.classList.add('thick-right');
      if (i === 2 || i === 5) cell.classList.add('thick-bottom');
      const v = state.puzzle[i][j];
      if (v) cell.textContent = v;
      cell.addEventListener('click', () => onSelect(idx));
      gridEl.appendChild(cell);
    }
  }
  if (statusEl) {
    if (isWon(state.puzzle)) {
      statusEl.textContent = 'Solved together! 🎉';
    } else if (conflicts.size > 0) {
      statusEl.textContent = `${conflicts.size} cell${conflicts.size === 1 ? '' : 's'} in conflict`;
    } else {
      const filled = state.puzzle.flat().filter((v) => v !== 0).length;
      statusEl.textContent = `${81 - filled} cells left`;
    }
  }
}

window.Sudoku = { buildSudoku, checkConflicts, isWon, renderSudoku, SIZE };
