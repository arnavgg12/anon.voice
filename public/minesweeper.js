// Minesweeper — co-op over the WebRTC DataChannel. Rebuilt from scratch.
//
// Both peers build an identical board from a shared seed and replay each
// other's moves (reveal / flag). The model is fully deterministic and the
// two move types are commutative, so peers stay in sync no matter the order
// moves arrive — even if both tap at the same instant. No server state.
//
// Mobile input is the part the old version got wrong: it waited on a synthetic
// `click` after `touchend`, which mobile browsers delay/suppress, so taps did
// nothing. Here a clean tap fires on `touchend`; a drag is treated as a scroll;
// a long-press (or the flag-mode toggle, or right-click) places a flag.

(function () {
  const COLS = 9;
  const ROWS = 9;
  const MINES = 10;

  function mulberry32(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const at = (x, y) => y * COLS + x;
  const inBounds = (x, y) => x >= 0 && x < COLS && y >= 0 && y < ROWS;

  function buildBoard(seed) {
    const cells = [];
    for (let i = 0; i < COLS * ROWS; i++) {
      cells.push({ mine: false, adj: 0, revealed: false, flagged: false });
    }
    // Seeded mine placement via a shuffle of indices (identical on both peers).
    const order = Array.from({ length: COLS * ROWS }, (_, i) => i);
    const rng = mulberry32(seed);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let i = 0; i < MINES; i++) cells[order[i]].mine = true;

    // Adjacency counts.
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = cells[at(x, y)];
        if (c.mine) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (inBounds(x + dx, y + dy) && cells[at(x + dx, y + dy)].mine) n++;
          }
        }
        c.adj = n;
      }
    }
    return { cols: COLS, rows: ROWS, mines: MINES, cells, seed, over: false, won: false, revealedCount: 0 };
  }

  // Iterative flood-reveal. Returns nothing; mutates the board.
  function revealCell(board, x, y) {
    if (board.over || !inBounds(x, y)) return;
    const first = board.cells[at(x, y)];
    if (first.revealed || first.flagged) return;

    const stack = [[x, y]];
    while (stack.length) {
      const [cx, cy] = stack.pop();
      const c = board.cells[at(cx, cy)];
      if (c.revealed || c.flagged) continue;
      c.revealed = true;
      if (c.mine) {
        board.over = true;
        board.won = false;
        for (const cc of board.cells) if (cc.mine) cc.revealed = true;
        return;
      }
      board.revealedCount++;
      if (c.adj === 0) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const nx = cx + dx, ny = cy + dy;
            if (inBounds(nx, ny)) {
              const n = board.cells[at(nx, ny)];
              if (!n.revealed && !n.flagged) stack.push([nx, ny]);
            }
          }
        }
      }
    }
    if (board.revealedCount === COLS * ROWS - MINES) {
      board.over = true;
      board.won = true;
    }
  }

  function toggleFlag(board, x, y) {
    if (board.over || !inBounds(x, y)) return;
    const c = board.cells[at(x, y)];
    if (c.revealed) return;
    c.flagged = !c.flagged;
  }

  function flagsUsed(board) {
    let n = 0;
    for (const c of board.cells) if (c.flagged) n++;
    return n;
  }

  // Render the board into `container`.
  // opts: { onReveal(x,y), onFlag(x,y), flagMode,
  //         cursor:{x,y}|null,            // YOUR keyboard cursor (highlight)
  //         peerCursor:{x,y,color}|null } // partner's cursor (tinted ring)
  function renderBoard(board, container, statusEl, opts) {
    opts = opts || {};
    const flagMode = !!opts.flagMode;
    const cur = opts.cursor;
    const peer = opts.peerCursor;
    container.style.setProperty('--cols', COLS);
    container.innerHTML = '';

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = board.cells[at(x, y)];
        const el = document.createElement('div');
        el.className = 'ms-cell';
        if (c.revealed) {
          el.classList.add('open');
          if (c.mine) { el.classList.add('mine'); el.textContent = '💣'; }
          else if (c.adj > 0) { el.textContent = String(c.adj); el.classList.add('n' + c.adj); }
        } else if (c.flagged) {
          el.classList.add('flag');
          el.textContent = '🚩';
        }
        if (cur && cur.x === x && cur.y === y) el.classList.add('cursor');
        if (peer && peer.x === x && peer.y === y) {
          el.classList.add('peer-cursor');
          if (peer.color) el.style.setProperty('--peer', peer.color);
        }

        const primary = () => (flagMode ? opts.onFlag : opts.onReveal) && (flagMode ? opts.onFlag(x, y) : opts.onReveal(x, y));
        const flag = () => opts.onFlag && opts.onFlag(x, y);

        // Robust touch: act on touchend, treat movement as scroll, long-press = flag.
        let viaTouch = false, moved = false, longFired = false, longTimer = null, sx = 0, sy = 0;
        el.addEventListener('touchstart', (e) => {
          viaTouch = true; moved = false; longFired = false;
          const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
          longTimer = setTimeout(() => { longFired = true; longTimer = null; flag(); }, 420);
        }, { passive: true });
        el.addEventListener('touchmove', (e) => {
          const t = e.touches[0];
          if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) {
            moved = true;
            if (longTimer) { clearTimeout(longTimer); longTimer = null; }
          }
        }, { passive: true });
        el.addEventListener('touchend', (e) => {
          if (longTimer) { clearTimeout(longTimer); longTimer = null; }
          if (moved || longFired) return;  // scrolled, or already flagged
          e.preventDefault();              // suppress the ghost click
          primary();
        });
        el.addEventListener('touchcancel', () => { if (longTimer) { clearTimeout(longTimer); longTimer = null; } });
        el.addEventListener('click', () => {
          if (viaTouch) { viaTouch = false; return; }  // touch already handled it
          primary();
        });
        el.addEventListener('contextmenu', (e) => { e.preventDefault(); flag(); });

        container.appendChild(el);
      }
    }

    if (statusEl) {
      if (board.over) {
        statusEl.textContent = board.won ? '🎉 Cleared it — together!' : '💥 Boom. Hit a mine.';
      } else {
        statusEl.textContent = `${MINES - flagsUsed(board)} 💣 left`;
      }
    }
  }

  window.Minesweeper = { buildBoard, revealCell, toggleFlag, renderBoard, COLS, ROWS, MINES };
})();
