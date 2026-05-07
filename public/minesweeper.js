// Minesweeper — peer-to-peer over the same WebRTC DataChannel as chat.
// Both peers seed an identical board, then each click is broadcast and
// applied locally on both sides. No server state.

const WIDTH = 10;
const HEIGHT = 10;
const MINES = 15;

function mulberry32(seed) {
  let s = seed | 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildBoard(seed) {
  const rng = mulberry32(seed);
  const total = WIDTH * HEIGHT;
  const mines = new Set();
  while (mines.size < MINES) {
    mines.add(Math.floor(rng() * total));
  }
  const cells = [];
  for (let i = 0; i < total; i++) {
    cells.push({ isMine: mines.has(i), adj: 0, revealed: false, flagged: false });
  }
  // adjacency
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = cells[y * WIDTH + x];
      if (c.isMine) continue;
      let n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= WIDTH || ny < 0 || ny >= HEIGHT) continue;
          if (cells[ny * WIDTH + nx].isMine) n++;
        }
      }
      c.adj = n;
    }
  }
  return { cells, seed, gameOver: false, won: false, revealedCount: 0 };
}

function revealCell(board, x, y) {
  if (board.gameOver) return;
  if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return;
  const c = board.cells[y * WIDTH + x];
  if (c.revealed || c.flagged) return;
  c.revealed = true;
  if (c.isMine) {
    board.gameOver = true;
    board.won = false;
    board.cells.forEach((cc) => { if (cc.isMine) cc.revealed = true; });
    return;
  }
  board.revealedCount++;
  if (c.adj === 0) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        revealCell(board, x + dx, y + dy);
      }
    }
  }
  if (board.revealedCount === WIDTH * HEIGHT - MINES) {
    board.gameOver = true;
    board.won = true;
  }
}

function toggleFlag(board, x, y) {
  if (board.gameOver) return;
  const c = board.cells[y * WIDTH + x];
  if (c.revealed) return;
  c.flagged = !c.flagged;
}

function renderBoard(board, container, statusEl, { onReveal, onFlag }) {
  container.innerHTML = '';
  container.style.gridTemplateColumns = `repeat(${WIDTH}, 1fr)`;
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const c = board.cells[y * WIDTH + x];
      const div = document.createElement('div');
      div.className = 'cell';
      if (c.revealed) {
        div.classList.add('revealed');
        if (c.isMine) {
          div.classList.add('mine');
          div.textContent = '💣';
        } else if (c.adj > 0) {
          div.textContent = c.adj;
          div.classList.add('n' + c.adj);
        }
      } else if (c.flagged) {
        div.classList.add('flagged');
        div.textContent = '🚩';
      }
      div.addEventListener('click', () => onReveal(x, y));
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        onFlag(x, y);
      });
      container.appendChild(div);
    }
  }
  if (statusEl) {
    if (board.gameOver) {
      statusEl.textContent = board.won ? 'You both won! 🎉' : '💥 Mine hit. Game over.';
    } else {
      const flagged = board.cells.filter((c) => c.flagged).length;
      statusEl.textContent = `${MINES - flagged} mines left`;
    }
  }
}

window.Minesweeper = { buildBoard, revealCell, toggleFlag, renderBoard, WIDTH, HEIGHT, MINES };
