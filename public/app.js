const socket = io();

// ---- Landing / app navigation ----
const landingEl = document.getElementById('landing');
const appEl = document.getElementById('app');
const goHomeBtn = document.getElementById('go-home');
const selfIdentityEl = document.getElementById('self-identity');
const heroOnlineEl = document.getElementById('hero-online');

// ---- Controls ----
const skipBtn = document.getElementById('skip');
const muteBtn = document.getElementById('mute');
const reportBtn = document.getElementById('report');
const addFriendBtn = document.getElementById('add-friend');

// ---- Friends ----
const friendsSectionEl = document.getElementById('friends-section');
const friendsListEl = document.getElementById('friends-list');
const callModalEl = document.getElementById('call-modal');
const callModalText = document.getElementById('call-modal-text');
const callModalEmoji = document.getElementById('call-modal-emoji');
const callAcceptBtn = document.getElementById('call-accept');
const callDeclineBtn = document.getElementById('call-decline');

// ---- Chat / rooms ----
const peerAudiosEl = document.getElementById('peer-audios');
const participantsEl = document.getElementById('participants');
const chatEl = document.getElementById('chat');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');

// ---- Games ----
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const boardEl = document.getElementById('board');
const gameStatusEl = document.getElementById('game-status');
const gameNewBtn = document.getElementById('game-new');
const sudokuGridEl = document.getElementById('sudoku-grid');
const sudokuStatusEl = document.getElementById('sudoku-status');
const sudokuNewBtn = document.getElementById('sudoku-new');
const sudokuPadBtns = document.querySelectorAll('.sudoku-pad button');
const c4GridEl = document.getElementById('c4-grid');
const c4StatusEl = document.getElementById('c4-status');
const c4NewBtn = document.getElementById('c4-new');
const tttGridEl = document.getElementById('ttt-grid');
const tttStatusEl = document.getElementById('ttt-status');
const tttNewBtn = document.getElementById('ttt-new');
const dbBoardEl = document.getElementById('db-board');
const dbStatusEl = document.getElementById('db-status');
const dbNewBtn = document.getElementById('db-new');
const drawCanvasEl = document.getElementById('draw-canvas');
const drawPaletteEl = document.getElementById('draw-palette');
const drawClearBtn = document.getElementById('draw-clear');
const drawColorEl = document.getElementById('draw-color');
const drawSizeEl = document.getElementById('draw-size');
const drawSizeDotEl = document.getElementById('draw-size-dot');
const statusEl = document.getElementById('status');
const orbEl = document.getElementById('orb');
const remoteAudio = document.getElementById('remote-audio');

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

let pc = null;
let localStream = null;
let isMuted = false;
let chatChannel = null;
let board = null;
let sudokuState = null;
let c4State = null;
let tttState = null;
let dbState = null;
let mode = 'idle';        // 'idle' | 'random' | 'room'
let textOnly = false;     // random text-only chat (no mic)
let currentRoom = null;
let partnerIdentity = null;
let partnerGuestId = null;
let iSentFriendReq = false;
let peerSentFriendReq = false;
let pendingCallTo = null;     // guestId we're ringing
let incomingCall = null;      // { fromSocket, mode, idn }
const onlineFriends = new Set();

// Persistent anonymous identity for this browser (enables friends w/o login)
let guestId = null;
try { guestId = localStorage.getItem('anonvoice_guest_id'); } catch {}
if (!guestId) {
  guestId = (window.crypto && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'g' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  try { localStorage.setItem('anonvoice_guest_id', guestId); } catch {}
}
const roomPeers = new Map();
let drawApi = null;
const participants = new Map();
let selfAnalyser = null;
let selfData = null;
let sharedAudioCtx = null;
let activityRafId = null;

// ---------- profanity filter ----------
const BAD_WORDS = ['fuck','shit','bitch','asshole','bastard','cunt','dick','slut','whore','nigger','faggot','retard'];
const badRe = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\b', 'gi');
function clean(text) {
  return String(text).replace(badRe, (m) => '*'.repeat(m.length));
}

// ---------- identity ----------
function selfIdentity() {
  return Identity.identityForId(guestId);
}

function showSelfIdentity() {
  const me = selfIdentity();
  selfIdentityEl.innerHTML = '';
  const av = document.createElement('span');
  av.className = 'id-avatar';
  av.textContent = me.emoji;
  av.style.background = me.color;
  const name = document.createElement('span');
  name.textContent = 'You are ' + me.name;
  selfIdentityEl.appendChild(av);
  selfIdentityEl.appendChild(name);
}

function colorForId(id) { return Identity.identityForId(id).color; }

// ---------- friends (localStorage) ----------
function loadFriends() {
  try { return JSON.parse(localStorage.getItem('anonvoice_friends') || '[]'); }
  catch { return []; }
}
function saveFriends(list) {
  try { localStorage.setItem('anonvoice_friends', JSON.stringify(list)); } catch {}
}
function addFriendRecord(id, name, emoji) {
  if (!id) return;
  const list = loadFriends();
  if (!list.some((f) => f.id === id)) {
    list.push({ id, name, emoji });
    saveFriends(list);
    socket.emit('watch-friends', { ids: [id] });
  }
  renderFriends();
}
function removeFriend(id) {
  saveFriends(loadFriends().filter((f) => f.id !== id));
  renderFriends();
}

function renderFriends() {
  const friends = loadFriends();
  if (!friends.length) { friendsSectionEl.classList.add('hidden'); return; }
  friendsSectionEl.classList.remove('hidden');
  friendsListEl.innerHTML = '';
  friends.forEach((f) => {
    const on = onlineFriends.has(f.id);
    const row = document.createElement('div');
    row.className = 'friend' + (on ? ' online' : '');

    const av = document.createElement('span');
    av.className = 'friend-av';
    av.style.background = Identity.identityForId(f.id).color;
    av.textContent = f.emoji;

    const name = document.createElement('span');
    name.className = 'friend-name';
    name.textContent = f.name;

    const status = document.createElement('span');
    status.className = 'friend-status';
    status.textContent = on ? 'online' : 'offline';

    const spacer = document.createElement('span');
    spacer.className = 'friend-spacer';

    const callV = document.createElement('button');
    callV.className = 'friend-call btn-primary';
    callV.textContent = '🎤';
    callV.title = on ? 'Voice call' : 'Offline';
    callV.disabled = !on;
    callV.addEventListener('click', () => callFriend(f, 'voice'));

    const callT = document.createElement('button');
    callT.className = 'friend-call btn-ghost';
    callT.textContent = '💬';
    callT.title = on ? 'Text chat' : 'Offline';
    callT.disabled = !on;
    callT.addEventListener('click', () => callFriend(f, 'text'));

    const rm = document.createElement('button');
    rm.className = 'friend-remove';
    rm.textContent = '✕';
    rm.title = 'Remove friend';
    rm.addEventListener('click', () => removeFriend(f.id));

    row.append(av, name, status, spacer, callV, callT, rm);
    friendsListEl.appendChild(row);
  });
}

function registerPresence() {
  socket.emit('register', { guestId });
  const ids = loadFriends().map((f) => f.id);
  if (ids.length) socket.emit('watch-friends', { ids });
  renderFriends();
}

function resetFriendButton() {
  iSentFriendReq = false;
  peerSentFriendReq = false;
  partnerGuestId = null;
  addFriendBtn.textContent = '＋';
  addFriendBtn.title = 'Add friend';
  addFriendBtn.classList.remove('added');
  addFriendBtn.disabled = true;
}

function maybeMutualFriend() {
  if (iSentFriendReq && peerSentFriendReq && partnerGuestId && partnerIdentity) {
    addFriendRecord(partnerGuestId, partnerIdentity.name, partnerIdentity.emoji);
    addFriendBtn.textContent = '✓';
    addFriendBtn.title = 'Friends';
    addFriendBtn.classList.add('added');
    addFriendBtn.disabled = true;
    appendSystem(`You're now friends with ${partnerIdentity.emoji} ${partnerIdentity.name}. Find each other from the home screen.`);
  }
}

async function callFriend(friend, m) {
  textOnly = m === 'text';
  mode = 'random';
  pendingCallTo = friend.id;
  enterApp();
  if (!textOnly) { try { await ensureMic(); } catch { goHome(); return; } }
  configureControls();
  partnerGuestId = friend.id;
  partnerIdentity = Identity.identityForId(friend.id);
  setStatus(`Calling ${friend.emoji} ${friend.name}…`, 'searching');
  socket.emit('call-friend', { toGuestId: friend.id, mode: m });
}

function closeCallModal() {
  callModalEl.classList.add('hidden');
  incomingCall = null;
}

function setStatus(text, orbState) {
  statusEl.textContent = text;
  if (orbState) orbEl.className = 'orb ' + orbState;
}

// ---------- navigation ----------
function enterApp() {
  landingEl.classList.add('app-hidden');
  appEl.classList.remove('app-hidden');
  showSelfIdentity();
  window.scrollTo(0, 0);
}

function goHome() {
  if (mode === 'room') leaveRoom(true);
  else if (mode === 'random') stopCall(true);
  appEl.classList.add('app-hidden');
  landingEl.classList.remove('app-hidden');
}

// ---------- controls ----------
function configureControls() {
  const inRandom = mode === 'random';
  const inRoom = mode === 'room';
  // Skip — random only
  skipBtn.classList.toggle('hidden', !inRandom);
  skipBtn.disabled = !inRandom;
  // Report — random only (1-on-1 has a single partner to report)
  reportBtn.classList.toggle('hidden', !inRandom);
  reportBtn.disabled = !inRandom;
  // Mute — any voice mode (not text-only random)
  const showMute = inRoom || (inRandom && !textOnly);
  muteBtn.classList.toggle('hidden', !showMute);
  muteBtn.disabled = !showMute;
  // Add friend — random (1-on-1) only; enabled once the channel + hello arrive
  addFriendBtn.classList.toggle('hidden', !inRandom);
  // Tabs: hide games in room mode
  document.querySelector('.tabs').classList.toggle('room-mode', inRoom);
  chatEl.classList.remove('hidden');
}

function applyMute() {
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  }
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', isMuted);
}

// ---------- chat rendering ----------
function appendMessage(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = clean(text);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function appendSystem(text) { appendMessage(text, 'system'); }

function clearChat() {
  messagesEl.innerHTML = '';
  chatInput.value = '';
  clearGame();
  switchTab('chat');
}

function sendOverChannel(obj) {
  if (chatChannel && chatChannel.readyState === 'open') {
    chatChannel.send(JSON.stringify(obj));
  }
}

function setupChatChannel(channel) {
  chatChannel = channel;
  channel.onopen = () => {
    chatInput.disabled = false;
    chatSend.disabled = false;
    gameNewBtn.disabled = false;
    sudokuNewBtn.disabled = false;
    c4NewBtn.disabled = false;
    tttNewBtn.disabled = false;
    dbNewBtn.disabled = false;
    drawClearBtn.disabled = false;
    addFriendBtn.disabled = false;
    // Exchange persistent identity so the displayed name is stable for friends
    sendOverChannel({ type: 'hello', guestId });
    if (partnerIdentity) {
      appendSystem(`You're now talking with ${partnerIdentity.emoji} ${partnerIdentity.name}.`);
    } else {
      appendSystem('Connected. Say hi.');
    }
  };
  channel.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { msg = { type: 'chat', text: e.data }; }
    if (msg.type === 'hello') {
      if (msg.guestId) {
        partnerGuestId = msg.guestId;
        partnerIdentity = Identity.identityForId(msg.guestId);
        const known = loadFriends().some((f) => f.id === partnerGuestId);
        if (known) {
          addFriendBtn.textContent = '✓';
          addFriendBtn.title = 'Friends';
          addFriendBtn.classList.add('added');
          addFriendBtn.disabled = true;
        }
      }
    } else if (msg.type === 'friend-add') {
      peerSentFriendReq = true;
      if (!iSentFriendReq && partnerIdentity) {
        appendSystem(`${partnerIdentity.emoji} ${partnerIdentity.name} wants to be friends — tap "Add friend" to connect.`);
      }
      maybeMutualFriend();
    } else if (msg.type === 'chat') {
      appendMessage(msg.text, 'them');
    } else if (msg.type === 'game-start') {
      startGame(msg.seed, false);
    } else if (msg.type === 'reveal') {
      if (board) { Minesweeper.revealCell(board, msg.x, msg.y); renderGame(); }
    } else if (msg.type === 'flag') {
      if (board) { Minesweeper.toggleFlag(board, msg.x, msg.y); renderGame(); }
    } else if (msg.type === 'sudoku-start') {
      startSudoku(msg.seed, false);
    } else if (msg.type === 'sudoku-fill') {
      applySudokuFill(msg.i, msg.j, msg.value, 'them');
    } else if (msg.type === 'c4-start') {
      startConnect4(false);
    } else if (msg.type === 'c4-drop') {
      if (c4State) doC4Drop(msg.col);
    } else if (msg.type === 'ttt-start') {
      startTTT(false);
    } else if (msg.type === 'ttt-move') {
      if (tttState) doTTTMove(msg.idx);
    } else if (msg.type === 'db-start') {
      startDotsBoxes(false);
    } else if (msg.type === 'db-line') {
      if (dbState) doDBLine(msg.kind, msg.row, msg.col);
    } else if (msg.type === 'draw-seg') {
      if (drawApi) drawApi.drawSegment(msg.x1, msg.y1, msg.x2, msg.y2, msg.color, msg.width);
    } else if (msg.type === 'draw-clear') {
      if (drawApi) drawApi.clear();
    }
  };
  channel.onclose = () => {
    chatInput.disabled = true;
    chatSend.disabled = true;
    gameNewBtn.disabled = true;
    sudokuNewBtn.disabled = true;
    c4NewBtn.disabled = true;
    tttNewBtn.disabled = true;
    dbNewBtn.disabled = true;
    drawClearBtn.disabled = true;
  };
}

function setupDrawingPanel() {
  if (drawApi) return;
  drawApi = Draw.setupDraw(drawCanvasEl, {
    onSegment: (x1, y1, x2, y2, color, width) => {
      sendOverChannel({ type: 'draw-seg', x1, y1, x2, y2, color, width });
    },
  });
  // Brush size from the slider, applied to whatever color is active.
  function applySize() {
    const w = parseInt(drawSizeEl.value, 10) || 3;
    drawApi.setWidth(w);
    drawSizeDotEl.style.setProperty('--dot', Math.min(w, 26) + 'px');
  }

  // Selecting a preset swatch or the eraser. Clears the custom-picker ring.
  function selectColor(color, swatchBtn) {
    drawPaletteEl.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
    document.querySelector('.draw-picker').classList.remove('active');
    if (swatchBtn) swatchBtn.classList.add('active');
    drawApi.setColor(color);
  }

  drawPaletteEl.innerHTML = '';
  const colors = [...Draw.COLORS, Draw.ERASER];
  colors.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (i === 0 ? ' active' : '') + (color === Draw.ERASER ? ' eraser' : '');
    btn.style.setProperty('--swatch-color', color);
    btn.setAttribute('aria-label', color === Draw.ERASER ? 'Eraser' : 'Color ' + color);
    btn.addEventListener('click', () => selectColor(color, btn));
    drawPaletteEl.appendChild(btn);
  });

  // Custom color picker.
  drawColorEl.addEventListener('input', () => {
    drawPaletteEl.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
    document.querySelector('.draw-picker').classList.add('active');
    drawApi.setColor(drawColorEl.value);
  });

  // Brush size slider.
  drawSizeEl.addEventListener('input', applySize);

  applySize();
}

drawClearBtn.addEventListener('click', () => {
  if (!drawApi) return;
  drawApi.clear();
  sendOverChannel({ type: 'draw-clear' });
});

setupDrawingPanel();

// ---------- minesweeper ----------
function renderGame() {
  if (!board) return;
  Minesweeper.renderBoard(board, boardEl, gameStatusEl, {
    onReveal: (x, y) => {
      if (!board || board.gameOver) return;
      Minesweeper.revealCell(board, x, y);
      sendOverChannel({ type: 'reveal', x, y });
      renderGame();
    },
    onFlag: (x, y) => {
      if (!board || board.gameOver) return;
      Minesweeper.toggleFlag(board, x, y);
      sendOverChannel({ type: 'flag', x, y });
      renderGame();
    },
  });
}

function startGame(seed, broadcast) {
  board = Minesweeper.buildBoard(seed);
  renderGame();
  switchTab('mines');
  if (broadcast) sendOverChannel({ type: 'game-start', seed });
}

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  if (name === 'draw' && drawApi) {
    requestAnimationFrame(() => drawApi.redrawAll());
  }
}

function clearGame() {
  board = null;
  boardEl.innerHTML = '';
  gameStatusEl.textContent = 'Click "New game" to start.';
  clearSudoku();
  clearConnect4();
}

function clearConnect4() {
  c4State = null;
  c4GridEl.innerHTML = '';
  c4StatusEl.textContent = 'Click "New game" to start.';
  clearTTT();
}

function clearTTT() {
  tttState = null;
  tttGridEl.innerHTML = '';
  tttStatusEl.textContent = 'Click "New game" to start.';
  clearDotsBoxes();
}

function clearDotsBoxes() {
  dbState = null;
  dbBoardEl.innerHTML = '';
  dbStatusEl.textContent = 'Click "New game" to start.';
}

function renderDBLocal() {
  if (!dbState) return;
  DotsBoxes.renderDotsBoxes(dbState, dbBoardEl, dbStatusEl, (kind, row, col) => {
    if (!dbState || dbState.winner) return;
    if (dbState.currentPlayer !== dbState.myPlayer) return;
    if (doDBLine(kind, row, col)) {
      sendOverChannel({ type: 'db-line', kind, row, col });
    }
  });
}

function doDBLine(kind, row, col) {
  if (!dbState || dbState.winner) return false;
  const lines = kind === 'h' ? dbState.hLines : dbState.vLines;
  if (lines[row][col] !== 0) return false;
  DotsBoxes.applyLine(dbState, kind, row, col);
  renderDBLocal();
  return true;
}

function startDotsBoxes(broadcast) {
  dbState = DotsBoxes.emptyState(broadcast ? 1 : 2);
  renderDBLocal();
  switchTab('db');
  if (broadcast) sendOverChannel({ type: 'db-start' });
}

function renderTTTLocal() {
  if (!tttState) return;
  TicTacToe.renderTTT(tttState, tttGridEl, tttStatusEl, (idx) => {
    if (!tttState || tttState.winner) return;
    if (tttState.currentPlayer !== tttState.myPlayer) return;
    if (tttState.board[idx] !== 0) return;
    if (doTTTMove(idx)) sendOverChannel({ type: 'ttt-move', idx });
  });
}

function doTTTMove(idx) {
  if (!tttState || tttState.winner) return false;
  if (tttState.board[idx] !== 0) return false;
  tttState.board[idx] = tttState.currentPlayer;
  const result = TicTacToe.evaluate(tttState.board);
  if (result.winner) {
    tttState.winner = result.winner;
    tttState.winLine = result.line;
  }
  tttState.currentPlayer = tttState.currentPlayer === 1 ? 2 : 1;
  renderTTTLocal();
  return true;
}

function startTTT(broadcast) {
  tttState = {
    board: TicTacToe.emptyBoard(),
    currentPlayer: 1,
    myPlayer: broadcast ? 1 : 2,
    winner: 0,
    winLine: null,
  };
  renderTTTLocal();
  switchTab('ttt');
  if (broadcast) sendOverChannel({ type: 'ttt-start' });
}

function renderC4Local() {
  if (!c4State) return;
  Connect4.renderConnect4(c4State, c4GridEl, c4StatusEl, (col) => {
    if (!c4State || c4State.winner) return;
    if (c4State.currentPlayer !== c4State.myPlayer) return;
    if (doC4Drop(col)) sendOverChannel({ type: 'c4-drop', col });
  });
}

function doC4Drop(col) {
  if (!c4State || c4State.winner) return false;
  const player = c4State.currentPlayer;
  const row = Connect4.dropPiece(c4State.board, col, player);
  if (row === -1) return false;
  const win = Connect4.winningCells(c4State.board, row, col, player);
  if (win) {
    c4State.winner = player;
    c4State.winningCells = win;
  } else if (Connect4.isFull(c4State.board)) {
    c4State.winner = -1;
  }
  c4State.currentPlayer = c4State.currentPlayer === 1 ? 2 : 1;
  renderC4Local();
  return true;
}

function startConnect4(broadcast) {
  c4State = {
    board: Connect4.emptyBoard(),
    currentPlayer: 1,
    myPlayer: broadcast ? 1 : 2,
    winner: 0,
    winningCells: null,
  };
  renderC4Local();
  switchTab('c4');
  if (broadcast) sendOverChannel({ type: 'c4-start' });
}

function clearSudoku() {
  sudokuState = null;
  sudokuGridEl.innerHTML = '';
  sudokuStatusEl.textContent = 'Click "New game" to start.';
}

function renderSudokuLocal() {
  if (!sudokuState) return;
  Sudoku.renderSudoku(sudokuState, sudokuGridEl, sudokuStatusEl, (idx) => {
    if (sudokuState.givens.has(idx)) return;
    sudokuState.selected = idx;
    renderSudokuLocal();
  });
}

function applySudokuFill(i, j, value, by) {
  if (!sudokuState) return;
  const idx = i * 9 + j;
  if (sudokuState.givens.has(idx)) return;
  sudokuState.puzzle[i][j] = value;
  sudokuState.filledBy[i][j] = value ? by : null;
  renderSudokuLocal();
}

function handleSudokuInput(value) {
  if (!sudokuState || sudokuState.selected === null) return;
  const i = Math.floor(sudokuState.selected / 9);
  const j = sudokuState.selected % 9;
  if (sudokuState.givens.has(sudokuState.selected)) return;
  applySudokuFill(i, j, value, 'me');
  sendOverChannel({ type: 'sudoku-fill', i, j, value });
}

function startSudoku(seed, broadcast) {
  const { puzzle, solution, givens } = Sudoku.buildSudoku(seed);
  sudokuState = {
    puzzle, solution, givens,
    filledBy: Array.from({ length: 9 }, () => Array(9).fill(null)),
    selected: null, seed,
  };
  renderSudokuLocal();
  switchTab('sudoku');
  if (broadcast) sendOverChannel({ type: 'sudoku-start', seed });
}

// ---------- mic / peer ----------
async function ensureMic() {
  if (localStream) return localStream;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true }
    });
    return localStream;
  } catch (err) {
    setStatus('Microphone access denied.', 'idle');
    throw err;
  }
}

function createPeer(initiator, withAudio) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  if (withAudio && localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  if (initiator) {
    setupChatChannel(pc.createDataChannel('chat'));
  } else {
    pc.ondatachannel = (e) => setupChatChannel(e.channel);
  }

  pc.ontrack = (e) => { remoteAudio.srcObject = e.streams[0]; };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { type: 'ice', candidate: e.candidate });
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      const partnerName = partnerIdentity ? `${partnerIdentity.emoji} ${partnerIdentity.name}` : 'a stranger';
      setStatus(textOnly ? `Connected with ${partnerName} — start typing.` : `Connected with ${partnerName}.`, 'live');
    } else if (pc.connectionState === 'failed') {
      setStatus('Connection failed.', 'idle');
    }
  };
}

function teardownPeer() {
  if (chatChannel) {
    try { chatChannel.close(); } catch {}
    chatChannel = null;
  }
  if (pc) { pc.close(); pc = null; }
  remoteAudio.srcObject = null;
  partnerIdentity = null;
  resetFriendButton();
  chatInput.disabled = true;
  chatSend.disabled = true;
}

// ---------- random (1-on-1) ----------
async function startCall(asText) {
  textOnly = !!asText;
  mode = 'random';
  enterApp();
  if (!textOnly) {
    try { await ensureMic(); } catch { goHome(); return; }
  }
  configureControls();
  setStatus(textOnly ? 'Finding someone to text…' : 'Finding someone to talk to…', 'searching');
  socket.emit('find-partner', { mode: textOnly ? 'text' : 'voice' });
}

function stopCall(silent) {
  teardownPeer();
  socket.emit('leave');
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  isMuted = false; applyMute();
  mode = 'idle';
  if (!silent) {
    setStatus('Pick a mode to begin.', 'idle');
    chatEl.classList.add('hidden');
    clearChat();
  }
}

// ---------- rooms ----------
async function joinRoom(roomName) {
  mode = 'room';
  currentRoom = roomName;
  enterApp();
  try { await ensureMic(); } catch { goHome(); return; }
  configureControls();
  switchTab('chat');
  chatInput.disabled = false;
  chatSend.disabled = false;
  setStatus(`Joining ${roomName}…`, 'searching');
  attachSelfAnalyser();
  startActivityLoop();
  renderParticipants();
  socket.emit('join-room', { room: roomName });
}

function leaveRoom(silent) {
  socket.emit('leave');
  for (const [, p] of roomPeers) p.close();
  roomPeers.clear();
  participants.clear();
  peerAudiosEl.innerHTML = '';
  participantsEl.classList.add('hidden');
  participantsEl.innerHTML = '';
  stopActivityLoop();
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  selfAnalyser = null; selfData = null;
  isMuted = false; applyMute();
  currentRoom = null;
  mode = 'idle';
  if (!silent) {
    setStatus('Pick a mode to begin.', 'idle');
    chatEl.classList.add('hidden');
    clearChat();
  }
}

function makeChip(id, isMe) {
  const idn = Identity.identityForId(id);
  const chip = document.createElement('span');
  chip.className = 'chip' + (isMe ? ' me' : '');
  chip.dataset.pid = id;
  chip.style.setProperty('--chip-color', idn.color);
  const dot = document.createElement('span');
  dot.className = 'chip-dot';
  dot.textContent = idn.emoji;
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = isMe ? 'you' : idn.name;
  chip.appendChild(dot);
  chip.appendChild(label);
  return chip;
}

function renderParticipants() {
  if (mode !== 'room') { participantsEl.classList.add('hidden'); return; }
  participantsEl.classList.remove('hidden');
  participantsEl.innerHTML = '';
  participantsEl.appendChild(makeChip(socket.id || 'me', true));
  for (const pid of participants.keys()) {
    participantsEl.appendChild(makeChip(pid, false));
  }
}

function ensureAudioCtx() {
  if (!sharedAudioCtx) sharedAudioCtx = new AudioContext();
  if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
}

function attachSelfAnalyser() {
  if (!localStream) return;
  ensureAudioCtx();
  const src = sharedAudioCtx.createMediaStreamSource(localStream);
  selfAnalyser = sharedAudioCtx.createAnalyser();
  selfAnalyser.fftSize = 512;
  src.connect(selfAnalyser);
  selfData = new Uint8Array(selfAnalyser.frequencyBinCount);
}

function attachPeerAnalyser(peerId, stream) {
  ensureAudioCtx();
  const src = sharedAudioCtx.createMediaStreamSource(stream);
  const analyser = sharedAudioCtx.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  const p = participants.get(peerId);
  if (p) { p.analyser = analyser; p.data = new Uint8Array(analyser.frequencyBinCount); }
}

function avgLevel(data, analyser) {
  if (!analyser || !data) return 0;
  analyser.getByteFrequencyData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  return sum / data.length;
}

const SPEAKING_THRESHOLD = 14;

function activityTick() {
  if (mode !== 'room') { activityRafId = null; return; }
  const setSpeaking = (sel, on) => {
    const el = participantsEl.querySelector(sel);
    if (!el) return;
    if (on !== el.classList.contains('speaking')) el.classList.toggle('speaking', on);
  };
  const selfLvl = avgLevel(selfData, selfAnalyser);
  setSpeaking('.chip.me', selfLvl > SPEAKING_THRESHOLD && !isMuted);
  for (const [pid, p] of participants) {
    const lvl = avgLevel(p.data, p.analyser);
    p.speaking = lvl > SPEAKING_THRESHOLD;
    setSpeaking(`.chip[data-pid="${CSS.escape(pid)}"]`, p.speaking);
  }
  activityRafId = requestAnimationFrame(activityTick);
}

function startActivityLoop() { if (!activityRafId) activityRafId = requestAnimationFrame(activityTick); }
function stopActivityLoop() { if (activityRafId) cancelAnimationFrame(activityRafId); activityRafId = null; }

function createRoomPeer(peerId, initiator) {
  const peerPc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  if (localStream) localStream.getTracks().forEach((t) => peerPc.addTrack(t, localStream));
  if (!participants.has(peerId)) {
    participants.set(peerId, { color: colorForId(peerId), speaking: false });
  }
  renderParticipants();
  peerPc.ontrack = (e) => {
    let audio = document.getElementById(`audio-${peerId}`);
    if (!audio) {
      audio = document.createElement('audio');
      audio.id = `audio-${peerId}`;
      audio.autoplay = true;
      audio.playsInline = true;
      peerAudiosEl.appendChild(audio);
    }
    audio.srcObject = e.streams[0];
    attachPeerAnalyser(peerId, e.streams[0]);
  };
  peerPc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('room-signal', { to: peerId, type: 'ice', candidate: e.candidate });
  };
  roomPeers.set(peerId, peerPc);
  if (initiator) {
    (async () => {
      const offer = await peerPc.createOffer();
      await peerPc.setLocalDescription(offer);
      socket.emit('room-signal', { to: peerId, type: 'offer', sdp: offer });
    })();
  }
  return peerPc;
}

function removeRoomPeer(peerId) {
  const p = roomPeers.get(peerId);
  if (p) { p.close(); roomPeers.delete(peerId); }
  document.getElementById(`audio-${peerId}`)?.remove();
  participants.delete(peerId);
  renderParticipants();
}

socket.on('room-joined', ({ room, peers }) => {
  setStatus(`In ${room} — ${peers.length + 1} here. Say hi.`, 'live');
  for (const peerId of peers) createRoomPeer(peerId, false);
});

socket.on('peer-joined', ({ peerId }) => {
  if (mode !== 'room') return;
  createRoomPeer(peerId, true);
});

socket.on('peer-left', ({ peerId }) => { removeRoomPeer(peerId); });

socket.on('room-count', ({ count }) => {
  if (mode === 'room' && currentRoom) {
    setStatus(`In ${currentRoom} — ${count} here.`, count > 1 ? 'live' : 'searching');
  }
});

socket.on('room-signal', async ({ from, type, sdp, candidate }) => {
  let peerPc = roomPeers.get(from);
  if (!peerPc && type === 'offer') peerPc = createRoomPeer(from, false);
  if (!peerPc) return;
  try {
    if (type === 'offer') {
      await peerPc.setRemoteDescription(new RTCSessionDescription(sdp));
      const answer = await peerPc.createAnswer();
      await peerPc.setLocalDescription(answer);
      socket.emit('room-signal', { to: from, type: 'answer', sdp: answer });
    } else if (type === 'answer') {
      await peerPc.setRemoteDescription(new RTCSessionDescription(sdp));
    } else if (type === 'ice') {
      await peerPc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (err) { console.warn('Room signal error:', err); }
});

socket.on('room-text', ({ from, text }) => {
  const idn = Identity.identityForId(from);
  const div = document.createElement('div');
  div.className = 'msg them';
  const sender = document.createElement('span');
  sender.className = 'msg-sender';
  sender.style.color = idn.color;
  sender.textContent = idn.emoji + ' ' + idn.name;
  div.appendChild(sender);
  div.appendChild(document.createElement('br'));
  div.appendChild(document.createTextNode(clean(text)));
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
});

socket.on('lobby-counts', (counts) => {
  document.querySelectorAll('.count[data-room]').forEach((el) => {
    el.textContent = counts[el.dataset.room] ?? 0;
  });
});

socket.on('online', ({ count }) => {
  if (heroOnlineEl) heroOnlineEl.textContent = count;
});

// ---- friends / presence ----
function doRegister() { registerPresence(); }
if (socket.connected) doRegister();
socket.on('connect', doRegister);

socket.on('friends-presence', ({ online: ids }) => {
  (ids || []).forEach((id) => onlineFriends.add(id));
  renderFriends();
});
socket.on('friend-presence', ({ id, online: isOn }) => {
  if (isOn) onlineFriends.add(id); else onlineFriends.delete(id);
  renderFriends();
});

socket.on('friend-call', ({ fromGuestId, fromSocket, mode: m }) => {
  const idn = Identity.identityForId(fromGuestId || fromSocket);
  incomingCall = { fromSocket, mode: m, idn };
  callModalEmoji.textContent = idn.emoji;
  callModalText.textContent = `${idn.name} wants to ${m === 'text' ? 'text you' : 'talk'}.`;
  callModalEl.classList.remove('hidden');
});
socket.on('friend-call-cancelled', closeCallModal);
socket.on('friend-unavailable', () => {
  pendingCallTo = null;
  setStatus('They’re offline right now.', 'idle');
});
socket.on('friend-declined', () => {
  pendingCallTo = null;
  setStatus('Call declined.', 'idle');
});

socket.on('room-full', ({ room, cap }) => {
  setStatus(`${room} is full (${cap} max). Try again later.`, 'idle');
  if (mode === 'room') leaveRoom();
});

socket.on('skip-cooldown', ({ ms }) => {
  const sec = Math.ceil(ms / 1000);
  setStatus(`Slow down — try again in ${sec}s.`, 'searching');
  skipBtn.disabled = true;
  setTimeout(() => { if (mode === 'random') skipBtn.disabled = false; }, ms);
});

async function handleMatch({ initiator, peerId, mode: matchedMode }) {
  pendingCallTo = null;
  // partnerIdentity may already be set (friend call); else placeholder from socket id
  if (!partnerIdentity && peerId) partnerIdentity = Identity.identityForId(peerId);
  const withAudio = matchedMode !== 'text';
  createPeer(initiator, withAudio);
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('signal', { type: 'offer', sdp: offer });
  }
  setStatus('Connecting…', 'searching');
}

async function handleSignal(data) {
  if (!pc) return;
  try {
    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('signal', { type: 'answer', sdp: answer });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'ice') {
      await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
    }
  } catch (err) { console.warn('Signal error:', err); }
}

socket.on('waiting', () => setStatus(textOnly ? 'Waiting for someone to text…' : 'Waiting for a stranger…', 'searching'));
socket.on('matched', handleMatch);
socket.on('signal', handleSignal);
socket.on('partner-left', () => {
  teardownPeer();
  clearChat();
  setStatus('They left. Finding someone new…', 'searching');
  socket.emit('find-partner', { mode: textOnly ? 'text' : 'voice' });
});

// ---------- landing / control wiring ----------
document.querySelectorAll('[data-start]').forEach((btn) => {
  btn.addEventListener('click', () => startCall(btn.dataset.start === 'text'));
});
document.querySelectorAll('[data-room]').forEach((btn) => {
  if (btn.tagName === 'BUTTON') btn.addEventListener('click', () => joinRoom(btn.dataset.room));
});

goHomeBtn.addEventListener('click', () => { if (pendingCallTo) socket.emit('cancel-call', { toGuestId: pendingCallTo }); goHome(); });

muteBtn.addEventListener('click', () => { isMuted = !isMuted; applyMute(); });

addFriendBtn.addEventListener('click', () => {
  if (mode !== 'random' || addFriendBtn.disabled) return;
  iSentFriendReq = true;
  sendOverChannel({ type: 'friend-add' });
  if (peerSentFriendReq) {
    maybeMutualFriend();
  } else {
    addFriendBtn.textContent = '⏳';
    addFriendBtn.title = 'Friend request sent';
    addFriendBtn.disabled = true;
    appendSystem('Friend request sent — they need to tap ＋ too.');
  }
});

callAcceptBtn.addEventListener('click', async () => {
  if (!incomingCall) return;
  const { fromSocket, mode: m, idn } = incomingCall;
  closeCallModal();
  textOnly = m === 'text';
  mode = 'random';
  enterApp();
  if (!textOnly) { try { await ensureMic(); } catch { goHome(); return; } }
  configureControls();
  partnerIdentity = idn;
  setStatus('Connecting…', 'searching');
  socket.emit('call-response', { toSocket: fromSocket, accept: true, mode: m });
});

callDeclineBtn.addEventListener('click', () => {
  if (incomingCall) socket.emit('call-response', { toSocket: incomingCall.fromSocket, accept: false, mode: incomingCall.mode });
  closeCallModal();
});

skipBtn.addEventListener('click', () => {
  if (mode !== 'random') return;
  teardownPeer();
  clearChat();
  setStatus('Finding someone new…', 'searching');
  socket.emit('find-partner', { mode: textOnly ? 'text' : 'voice' });
});

reportBtn.addEventListener('click', () => {
  if (mode !== 'random') return;
  socket.emit('report');
  teardownPeer();
  clearChat();
  setStatus('Reported. Finding someone new…', 'searching');
  socket.emit('find-partner', { mode: textOnly ? 'text' : 'voice' });
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;
  if (mode === 'room') {
    socket.emit('room-text', { text });
    appendMessage(text, 'me');
  } else {
    if (!chatChannel || chatChannel.readyState !== 'open') return;
    sendOverChannel({ type: 'chat', text });
    appendMessage(text, 'me');
  }
  chatInput.value = '';
});

tabs.forEach((tab) => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));

gameNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  startGame((Math.random() * 0x7fffffff) | 0, true);
});
sudokuNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  startSudoku((Math.random() * 0x7fffffff) | 0, true);
});
c4NewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  startConnect4(true);
});
tttNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  startTTT(true);
});
dbNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  startDotsBoxes(true);
});

sudokuPadBtns.forEach((btn) => {
  btn.addEventListener('click', () => handleSudokuInput(parseInt(btn.dataset.value, 10) || 0));
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput) return;
  const activeTab = document.querySelector('.tab.active')?.dataset.tab;
  if (!activeTab) return;

  if (activeTab === 'sudoku' && sudokuState) {
    if (e.key >= '1' && e.key <= '9') {
      handleSudokuInput(parseInt(e.key, 10)); e.preventDefault();
    } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
      handleSudokuInput(0); e.preventDefault();
    } else if (e.key.startsWith('Arrow')) {
      if (sudokuState.selected === null) sudokuState.selected = 40;
      else {
        const i = Math.floor(sudokuState.selected / 9), j = sudokuState.selected % 9;
        let ni = i, nj = j;
        if (e.key === 'ArrowUp' && i > 0) ni--;
        if (e.key === 'ArrowDown' && i < 8) ni++;
        if (e.key === 'ArrowLeft' && j > 0) nj--;
        if (e.key === 'ArrowRight' && j < 8) nj++;
        sudokuState.selected = ni * 9 + nj;
      }
      renderSudokuLocal(); e.preventDefault();
    }
  } else if (activeTab === 'c4' && c4State && !c4State.winner) {
    if (e.key >= '1' && e.key <= '7' && c4State.currentPlayer === c4State.myPlayer) {
      const col = parseInt(e.key, 10) - 1;
      if (doC4Drop(col)) sendOverChannel({ type: 'c4-drop', col });
      e.preventDefault();
    }
  } else if (activeTab === 'ttt' && tttState && !tttState.winner) {
    if (e.key >= '1' && e.key <= '9' && tttState.currentPlayer === tttState.myPlayer) {
      const idx = parseInt(e.key, 10) - 1;
      if (tttState.board[idx] === 0 && doTTTMove(idx)) sendOverChannel({ type: 'ttt-move', idx });
      e.preventDefault();
    }
  }
});
