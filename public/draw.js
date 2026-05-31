// Shared drawing canvas — peer-to-peer over the chat DataChannel.
// Coordinates are normalized 0-1 so peers with different canvas sizes stay in
// sync. Each line segment is one message. The eraser is a special token that
// uses destination-out compositing (true erase) so it never leaves a colored
// stroke regardless of the canvas background.

const COLORS = ['#7c6cff', '#ff5cab', '#46e0d0', '#ffd166', '#5fe08a', '#ffffff'];
const ERASER = 'eraser';

function setupDraw(canvas, opts) {
  const ctx = canvas.getContext('2d');

  let drawing = false;
  let lastX = 0, lastY = 0;
  let activeColor = COLORS[0];
  let activeWidth = 4;
  const segments = [];      // history; replayed on every resize
  let cssW = 0, cssH = 0;   // CSS pixel size — the single source of truth

  // Match the backing store to the element's real rendered size × DPR.
  // Re-run on resize / tab-show via ResizeObserver so a hidden (0×0) canvas
  // gets correctly sized the moment it becomes visible — this is what fixes
  // both the "tiny canvas" and the "draws offset from the cursor" bugs.
  function resize() {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    cssW = rect.width;
    cssH = rect.height;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 1 unit = 1 CSS px
    redrawAll();
  }

  function strokeSeg(x1, y1, x2, y2, color, width) {
    if (!cssW || !cssH) return;
    const erase = color === ERASER;
    ctx.globalCompositeOperation = erase ? 'destination-out' : 'source-over';
    ctx.strokeStyle = erase ? 'rgba(0,0,0,1)' : color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 * cssW, y1 * cssH);
    ctx.lineTo(x2 * cssW, y2 * cssH);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
  }

  function redrawAll() {
    ctx.clearRect(0, 0, cssW, cssH);
    for (const s of segments) strokeSeg(s.x1, s.y1, s.x2, s.y2, s.color, s.width);
  }

  // Apply a segment locally + remember it (used for both local + remote draws).
  function drawSegment(x1, y1, x2, y2, color, width) {
    segments.push({ x1, y1, x2, y2, color, width });
    strokeSeg(x1, y1, x2, y2, color, width);
  }

  // Normalized 0-1 pointer position from the LIVE rect (matches what we draw
  // with, because cssW/cssH track the same rect via the observer).
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const x = Math.min(1, Math.max(0, (t.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (t.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function start(e) {
    e.preventDefault();
    const p = pos(e);
    drawing = true;
    lastX = p.x; lastY = p.y;
    // a dot so a single tap registers
    drawSegment(p.x, p.y, p.x + 0.0005, p.y + 0.0005, activeColor, activeWidth);
    opts.onSegment(p.x, p.y, p.x + 0.0005, p.y + 0.0005, activeColor, activeWidth);
  }

  function move(e) {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e);
    drawSegment(lastX, lastY, p.x, p.y, activeColor, activeWidth);
    opts.onSegment(lastX, lastY, p.x, p.y, activeColor, activeWidth);
    lastX = p.x; lastY = p.y;
  }

  function end() { drawing = false; }

  canvas.addEventListener('mousedown', start);
  canvas.addEventListener('mousemove', move);
  window.addEventListener('mouseup', end);
  canvas.addEventListener('touchstart', start, { passive: false });
  canvas.addEventListener('touchmove', move, { passive: false });
  canvas.addEventListener('touchend', end);
  canvas.addEventListener('touchcancel', end);

  // Keep the canvas correctly sized whenever it changes size or becomes visible.
  if (window.ResizeObserver) {
    new ResizeObserver(() => resize()).observe(canvas);
  }
  window.addEventListener('resize', resize);
  resize();

  return {
    drawSegment,                                   // apply a remote segment
    setColor: (c) => { activeColor = c; },
    setWidth: (w) => { activeWidth = w; },
    clear: () => { segments.length = 0; ctx.clearRect(0, 0, cssW, cssH); },
    redrawAll: resize,                             // re-measure + repaint
  };
}

window.Draw = { setupDraw, COLORS, ERASER };
