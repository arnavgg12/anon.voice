// Shared drawing canvas — peer-to-peer over the chat DataChannel.
// Coordinates are normalized 0-1 so peers with different canvas sizes stay in
// sync. The eraser uses destination-out compositing (true erase to transparent)
// so it never leaves a colored stroke.

const COLORS = ['#7c6cff', '#ff5cab', '#46e0d0', '#ffd166', '#5fe08a', '#ffffff'];
const ERASER = 'eraser';

function setupDraw(canvas, opts) {
  const ctx = canvas.getContext('2d');

  let drawing = false;
  let lastX = 0, lastY = 0;
  let activeColor = COLORS[0];
  let activeWidth = 4;
  const segments = [];      // history; replayed on every (re)size
  let cssW = 0, cssH = 0;   // CSS-pixel size; 0 until first successful sizing

  // Size the backing store to the element's real rendered size × DPR.
  // Returns true if the canvas is visible/laid-out (so callers can lazily
  // size on first use — robust against tab-visibility timing).
  function ensureSized() {
    // Measure the PARENT wrap, not the canvas. The canvas's width/height
    // attributes (backing store) would otherwise feed back into its own
    // absolute box and cause a runaway. The wrap has a stable layout size.
    const host = canvas.parentElement || canvas;
    const rect = host.getBoundingClientRect();
    const pad = 8; // matches .draw-wrap padding / canvas inset
    const w = Math.max(0, rect.width  - pad * 2);
    const h = Math.max(0, rect.height - pad * 2);
    if (!w || !h) return false;
    const dpr = window.devicePixelRatio || 1;
    const wantW = Math.round(w * dpr);
    const wantH = Math.round(h * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH || cssW !== w) {
      cssW = w; cssH = h;
      canvas.width = wantW; canvas.height = wantH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);   // 1 unit = 1 CSS px
      repaint();
    }
    return true;
  }

  function strokeSeg(x1, y1, x2, y2, color, width) {
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

  function repaint() {
    ctx.clearRect(0, 0, cssW, cssH);
    for (const s of segments) strokeSeg(s.x1, s.y1, s.x2, s.y2, s.color, s.width);
  }

  // Apply + remember a segment (used for both local and remote draws).
  function drawSegment(x1, y1, x2, y2, color, width) {
    segments.push({ x1, y1, x2, y2, color, width });
    if (!cssW && !ensureSized()) return;   // lazily size on first paint
    strokeSeg(x1, y1, x2, y2, color, width);
  }

  // Normalized 0-1 pointer position from the SAME rect the drawing uses.
  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const x = Math.min(1, Math.max(0, (t.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (t.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function start(e) {
    e.preventDefault();
    ensureSized();                 // guarantee correct dimensions before drawing
    const p = pos(e);
    drawing = true;
    lastX = p.x; lastY = p.y;
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

  if (window.ResizeObserver) new ResizeObserver(() => ensureSized()).observe(canvas);
  window.addEventListener('resize', ensureSized);
  ensureSized();

  return {
    drawSegment,                                  // apply a remote segment
    setColor: (c) => { activeColor = c; },
    setWidth: (w) => { activeWidth = w; },
    clear: () => { segments.length = 0; if (cssW) ctx.clearRect(0, 0, cssW, cssH); },
    redrawAll: () => { ensureSized(); repaint(); },  // re-measure + repaint on tab show
  };
}

window.Draw = { setupDraw, COLORS, ERASER };
