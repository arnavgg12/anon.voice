const socket = io();

const toggleBtn = document.getElementById('toggle');
const muteBtn = document.getElementById('mute');
const skipBtn = document.getElementById('skip');
const chatEl = document.getElementById('chat');
const messagesEl = document.getElementById('messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatSend = document.getElementById('chat-send');
const tabs = document.querySelectorAll('.tab');
const panels = document.querySelectorAll('.tab-panel');
const boardEl = document.getElementById('board');
const gameStatusEl = document.getElementById('game-status');
const gameNewBtn = document.getElementById('game-new');
const sudokuGridEl = document.getElementById('sudoku-grid');
const sudokuStatusEl = document.getElementById('sudoku-status');
const sudokuNewBtn = document.getElementById('sudoku-new');
const sudokuPadBtns = document.querySelectorAll('.sudoku-pad button');
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

function setStatus(text, orbState) {
  statusEl.textContent = text;
  if (orbState) orbEl.className = 'orb ' + orbState;
}

function setActive(active) {
  if (active) {
    toggleBtn.textContent = 'Stop';
    toggleBtn.classList.remove('primary');
    toggleBtn.classList.add('danger');
    muteBtn.disabled = false;
    skipBtn.disabled = false;
    chatEl.classList.remove('hidden');
  } else {
    toggleBtn.textContent = 'Start';
    toggleBtn.classList.remove('danger');
    toggleBtn.classList.add('primary');
    muteBtn.disabled = true;
    skipBtn.disabled = true;
    chatEl.classList.add('hidden');
    clearChat();
  }
}

function applyMute() {
  if (localStream) {
    localStream.getAudioTracks().forEach((t) => (t.enabled = !isMuted));
  }
  muteBtn.textContent = isMuted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', isMuted);
}

function appendMessage(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = text;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

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
    appendMessage('Connected. Say hi.', 'system');
  };
  channel.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { msg = { type: 'chat', text: e.data }; }
    if (msg.type === 'chat') {
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
    }
  };
  channel.onclose = () => {
    chatInput.disabled = true;
    chatSend.disabled = true;
    gameNewBtn.disabled = true;
    sudokuNewBtn.disabled = true;
  };
}

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
}

function clearGame() {
  board = null;
  boardEl.innerHTML = '';
  gameStatusEl.textContent = 'Click "New game" to start.';
  clearSudoku();
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
    puzzle,
    solution,
    givens,
    filledBy: Array.from({ length: 9 }, () => Array(9).fill(null)),
    selected: null,
    seed,
  };
  renderSudokuLocal();
  switchTab('sudoku');
  if (broadcast) sendOverChannel({ type: 'sudoku-start', seed });
}

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

function createPeer(initiator) {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  if (initiator) {
    setupChatChannel(pc.createDataChannel('chat'));
  } else {
    pc.ondatachannel = (e) => setupChatChannel(e.channel);
  }

  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      socket.emit('signal', { type: 'ice', candidate: e.candidate });
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      setStatus('Connected — say hi.', 'live');
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
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteAudio.srcObject = null;
  chatInput.disabled = true;
  chatSend.disabled = true;
}

async function startCall() {
  try {
    await ensureMic();
  } catch {
    return;
  }
  setStatus('Looking for someone…', 'searching');
  setActive(true);
  socket.emit('find-partner');
}

function stopCall() {
  teardownPeer();
  socket.emit('leave');
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  isMuted = false;
  applyMute();
  setStatus('Click Start to begin.', 'idle');
  setActive(false);
}

async function handleMatch({ initiator }) {
  createPeer(initiator);
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
  } catch (err) {
    console.warn('Signal error:', err);
  }
}

socket.on('waiting', () => setStatus('Waiting for a stranger…', 'searching'));
socket.on('matched', handleMatch);
socket.on('signal', handleSignal);
socket.on('partner-left', () => {
  teardownPeer();
  clearChat();
  setStatus('They left. Finding someone new…', 'searching');
  socket.emit('find-partner');
});

toggleBtn.addEventListener('click', () => {
  if (localStream) stopCall();
  else startCall();
});

muteBtn.addEventListener('click', () => {
  isMuted = !isMuted;
  applyMute();
});

skipBtn.addEventListener('click', () => {
  teardownPeer();
  clearChat();
  setStatus('Finding someone new…', 'searching');
  socket.emit('find-partner');
});

chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text || !chatChannel || chatChannel.readyState !== 'open') return;
  sendOverChannel({ type: 'chat', text });
  appendMessage(text, 'me');
  chatInput.value = '';
});

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

gameNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  const seed = (Math.random() * 0x7fffffff) | 0;
  startGame(seed, true);
});

sudokuNewBtn.addEventListener('click', () => {
  if (!chatChannel || chatChannel.readyState !== 'open') return;
  const seed = (Math.random() * 0x7fffffff) | 0;
  startSudoku(seed, true);
});

sudokuPadBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    handleSudokuInput(parseInt(btn.dataset.value, 10) || 0);
  });
});

document.addEventListener('keydown', (e) => {
  if (document.activeElement === chatInput) return;
  const activeTab = document.querySelector('.tab.active');
  if (!activeTab || activeTab.dataset.tab !== 'sudoku') return;
  if (!sudokuState) return;
  if (e.key >= '1' && e.key <= '9') {
    handleSudokuInput(parseInt(e.key, 10));
    e.preventDefault();
  } else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') {
    handleSudokuInput(0);
    e.preventDefault();
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
    renderSudokuLocal();
    e.preventDefault();
  }
});

setActive(false);
