// Dots and Boxes — peer-to-peer over the chat DataChannel.
// 5x5 dots = 4x4 = 16 boxes. Whoever closes a box gets it AND another turn.

const SIDE = 4;          // boxes per side
const N = SIDE + 1;      // dots per side
const STEP = 64;         // svg distance between dots
const PAD = 12;
const SVG_SIZE = (SIDE * STEP) + PAD * 2;

function emptyState(myPlayer) {
  return {
    hLines: Array.from({ length: N }, () => Array(SIDE).fill(0)),
    vLines: Array.from({ length: SIDE }, () => Array(N).fill(0)),
    boxes: Array.from({ length: SIDE }, () => Array(SIDE).fill(0)),
    currentPlayer: 1,
    myPlayer,
    winner: 0,
    scores: [0, 0],
  };
}

function applyLine(state, kind, row, col) {
  if (state.winner) return 0;
  const lines = kind === 'h' ? state.hLines : state.vLines;
  if (lines[row][col] !== 0) return 0;
  const player = state.currentPlayer;
  lines[row][col] = player;

  let completed = 0;
  const tryBox = (br, bc) => {
    if (br < 0 || br >= SIDE || bc < 0 || bc >= SIDE) return;
    if (state.boxes[br][bc] !== 0) return;
    if (
      state.hLines[br][bc] &&
      state.hLines[br + 1][bc] &&
      state.vLines[br][bc] &&
      state.vLines[br][bc + 1]
    ) {
      state.boxes[br][bc] = player;
      state.scores[player - 1]++;
      completed++;
    }
  };
  if (kind === 'h') { tryBox(row - 1, col); tryBox(row, col); }
  else { tryBox(row, col - 1); tryBox(row, col); }

  if (!completed) {
    state.currentPlayer = state.currentPlayer === 1 ? 2 : 1;
  }
  if (state.scores[0] + state.scores[1] === SIDE * SIDE) {
    if (state.scores[0] > state.scores[1]) state.winner = 1;
    else if (state.scores[1] > state.scores[0]) state.winner = 2;
    else state.winner = -1;
  }
  return completed;
}

function renderDotsBoxes(state, container, statusEl, onLine) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${SVG_SIZE} ${SVG_SIZE}`);
  svg.setAttribute('class', 'db-svg');

  // Box fills (drawn first, so they're behind everything)
  for (let r = 0; r < SIDE; r++) {
    for (let c = 0; c < SIDE; c++) {
      const owner = state.boxes[r][c];
      if (!owner) continue;
      const rect = document.createElementNS(NS, 'rect');
      rect.setAttribute('x', PAD + c * STEP);
      rect.setAttribute('y', PAD + r * STEP);
      rect.setAttribute('width', STEP);
      rect.setAttribute('height', STEP);
      rect.setAttribute('class', `db-box p${owner}`);
      svg.appendChild(rect);
    }
  }

  // Helper to draw a line + invisible fat hit area for click target
  const drawLine = (kind, r, c, x1, y1, x2, y2, owner) => {
    const visual = document.createElementNS(NS, 'line');
    visual.setAttribute('x1', x1); visual.setAttribute('y1', y1);
    visual.setAttribute('x2', x2); visual.setAttribute('y2', y2);
    visual.setAttribute('class', owner ? `db-line claimed p${owner}` : 'db-line empty');
    svg.appendChild(visual);
    if (!owner) {
      const hit = document.createElementNS(NS, 'line');
      hit.setAttribute('x1', x1); hit.setAttribute('y1', y1);
      hit.setAttribute('x2', x2); hit.setAttribute('y2', y2);
      hit.setAttribute('class', 'db-line-hit');
      hit.addEventListener('click', () => onLine(kind, r, c));
      svg.appendChild(hit);
    }
  };

  // Horizontal lines
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < SIDE; c++) {
      drawLine('h', r, c,
        PAD + c * STEP, PAD + r * STEP,
        PAD + (c + 1) * STEP, PAD + r * STEP,
        state.hLines[r][c]);
    }
  }
  // Vertical lines
  for (let r = 0; r < SIDE; r++) {
    for (let c = 0; c < N; c++) {
      drawLine('v', r, c,
        PAD + c * STEP, PAD + r * STEP,
        PAD + c * STEP, PAD + (r + 1) * STEP,
        state.vLines[r][c]);
    }
  }
  // Dots (on top)
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const dot = document.createElementNS(NS, 'circle');
      dot.setAttribute('cx', PAD + c * STEP);
      dot.setAttribute('cy', PAD + r * STEP);
      dot.setAttribute('r', 4);
      dot.setAttribute('class', 'db-dot');
      svg.appendChild(dot);
    }
  }

  container.innerHTML = '';
  container.appendChild(svg);

  if (statusEl) {
    const myScore = state.scores[state.myPlayer - 1];
    const theirScore = state.scores[state.myPlayer === 1 ? 1 : 0];
    if (state.winner === -1) {
      statusEl.textContent = `Tie ${myScore}-${theirScore}`;
    } else if (state.winner) {
      statusEl.textContent = state.winner === state.myPlayer
        ? `You won! ${myScore}-${theirScore} 🎉`
        : `They won. ${myScore}-${theirScore}`;
    } else if (state.currentPlayer === state.myPlayer) {
      statusEl.textContent = `Your turn (you ${myScore} - ${theirScore} them)`;
    } else {
      statusEl.textContent = `Their turn (you ${myScore} - ${theirScore} them)`;
    }
  }
}

window.DotsBoxes = { emptyState, applyLine, renderDotsBoxes, SIDE };
