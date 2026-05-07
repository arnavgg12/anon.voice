// Tic-Tac-Toe — peer-to-peer over the chat DataChannel.
// Whoever clicks "New game" plays X and goes first.

const LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],   // rows
  [0, 3, 6], [1, 4, 7], [2, 5, 8],   // cols
  [0, 4, 8], [2, 4, 6],              // diagonals
];

function emptyBoard() {
  return Array(9).fill(0);
}

function evaluate(board) {
  for (const line of LINES) {
    const [a, b, c] = line;
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line };
    }
  }
  if (board.every((v) => v)) return { winner: -1, line: null };
  return { winner: 0, line: null };
}

function renderTTT(state, gridEl, statusEl, onPlay) {
  gridEl.innerHTML = '';
  const winSet = new Set(state.winLine || []);
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = 'ttt-cell';
    if (winSet.has(i)) cell.classList.add('win');
    if (state.board[i] === 1) { cell.classList.add('p1'); cell.textContent = '✕'; }
    else if (state.board[i] === 2) { cell.classList.add('p2'); cell.textContent = '○'; }
    cell.addEventListener('click', () => onPlay(i));
    gridEl.appendChild(cell);
  }
  if (statusEl) {
    if (state.winner === -1) statusEl.textContent = 'Draw.';
    else if (state.winner) statusEl.textContent = state.winner === state.myPlayer ? 'You won! 🎉' : 'They won.';
    else if (state.currentPlayer === state.myPlayer) statusEl.textContent = `Your turn (${state.myPlayer === 1 ? '✕' : '○'}).`;
    else statusEl.textContent = `Their turn (${state.myPlayer === 1 ? '○' : '✕'}).`;
  }
}

window.TicTacToe = { emptyBoard, evaluate, renderTTT };
