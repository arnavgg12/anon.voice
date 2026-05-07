// Connect 4 — peer-to-peer over the chat DataChannel.
// Whoever clicks "New game" plays as red (player 1) and goes first.
// Each drop is broadcast; both sides apply locally and stay in sync.

const COLS = 7;
const ROWS = 6;

function emptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(0));
}

function dropPiece(board, col, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r][col] === 0) {
      board[r][col] = player;
      return r;
    }
  }
  return -1;
}

function winningCells(board, lastRow, lastCol, player) {
  if (lastRow < 0) return null;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [[lastRow, lastCol]];
    for (let k = 1; k < 4; k++) {
      const r = lastRow + dr * k, c = lastCol + dc * k;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
      cells.push([r, c]);
    }
    for (let k = 1; k < 4; k++) {
      const r = lastRow - dr * k, c = lastCol - dc * k;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[r][c] !== player) break;
      cells.unshift([r, c]);
    }
    if (cells.length >= 4) return cells;
  }
  return null;
}

function isFull(board) {
  return board[0].every((c) => c !== 0);
}

function renderConnect4(state, gridEl, statusEl, onDrop) {
  gridEl.innerHTML = '';
  const winSet = new Set();
  if (state.winningCells) {
    state.winningCells.forEach(([r, c]) => winSet.add(r * COLS + c));
  }
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = document.createElement('div');
      cell.className = 'c4-cell';
      const piece = document.createElement('div');
      piece.className = 'c4-piece';
      const v = state.board[r][c];
      if (v === 1) piece.classList.add('p1');
      else if (v === 2) piece.classList.add('p2');
      if (winSet.has(r * COLS + c)) piece.classList.add('win');
      cell.appendChild(piece);
      cell.dataset.col = c;
      cell.addEventListener('click', () => onDrop(c));
      gridEl.appendChild(cell);
    }
  }
  if (statusEl) {
    if (state.winner === -1) {
      statusEl.textContent = "Draw.";
    } else if (state.winner) {
      statusEl.textContent = state.winner === state.myPlayer ? 'You won! 🎉' : 'They won.';
    } else if (state.currentPlayer === state.myPlayer) {
      statusEl.textContent = `Your turn (${state.myPlayer === 1 ? 'red' : 'yellow'}).`;
    } else {
      statusEl.textContent = `Their turn (${state.myPlayer === 1 ? 'yellow' : 'red'}).`;
    }
  }
}

window.Connect4 = { emptyBoard, dropPiece, winningCells, isFull, renderConnect4, COLS, ROWS };
