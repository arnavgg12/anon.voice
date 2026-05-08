// Shared drawing canvas — peer-to-peer over the chat DataChannel.
// Coordinates are normalized 0-1 so peers with different canvas sizes
// stay in sync. Each line segment is one message.

const COLORS = ['#6c8eff', '#ff6b6b', '#5fd17a', '#ffd166'];
const ERASER = '#1a1f2c';

function setupDraw(canvas, opts) {
  const ctx = canvas.getContext('2d');
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  let drawing = false;
  let lastX = 0, lastY = 0;
  let activeColor = COLORS[0];
  let activeWidth = 3;
  const segments = []; // accumulated history; replayed on resize/visibility

  function applyDPR() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // hidden — try later
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // Replay everything we know about
    for (const s of segments) drawNow(s.x1, s.y1, s.x2, s.y2, s.color, s.width, rect);
  }

  function pos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    const x = (t.clientX - rect.left) / rect.width;
    const y = (t.clientY - rect.top) / rect.height;
    return { x, y };
  }

  function drawNow(x1, y1, x2, y2, color, width, rect) {
    rect = rect || canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x1 * rect.width, y1 * rect.height);
    ctx.lineTo(x2 * rect.width, y2 * rect.height);
    ctx.stroke();
  }

  function drawSegment(x1, y1, x2, y2, color, width) {
    segments.push({ x1, y1, x2, y2, color, width });
    drawNow(x1, y1, x2, y2, color, width);
  }

  function start(e) {
    e.preventDefault();
    const p = pos(e);
    drawing = true;
    lastX = p.x; lastY = p.y;
    // tiny dot so single taps register
    drawSegment(p.x, p.y, p.x + 0.0001, p.y + 0.0001, activeColor, activeWidth);
    opts.onSegment(p.x, p.y, p.x + 0.0001, p.y + 0.0001, activeColor, activeWidth);
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

  applyDPR();
  window.addEventListener('resize', applyDPR);

  return {
    drawSegment, // for applying remote segments
    setColor: (c) => { activeColor = c; },
    setWidth: (w) => { activeWidth = w; },
    clear: () => {
      segments.length = 0;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },
    redrawAll: applyDPR,
  };
}

window.Draw = { setupDraw, COLORS, ERASER };
