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
const skipCtl = document.getElementById('skip-ctl');
const muteCtl = document.getElementById('mute-ctl');
const muteIco = document.getElementById('mute-ico');
const muteLabel = document.getElementById('mute-label');
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
const mineFlagBtn = document.getElementById('mine-flag');
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
const drawSizeEl = document.getElementById('draw-size');
const drawSizeDotEl = document.getElementById('draw-size-dot');
const statusEl = document.getElementById('status');
const orbEl = document.getElementById('orb');
const remoteAudio = document.getElementById('remote-audio');
const partnerNameEl = document.getElementById('partner-name');
const audioFlowEl = document.getElementById('audio-flow');
const flowOutEl = document.getElementById('flow-out');
const flowInEl = document.getElementById('flow-in');
const interestChipsEl = document.getElementById('interest-chips');
const icebreakerEl = document.getElementById('icebreaker');
const icebreakerTextEl = document.getElementById('icebreaker-text');
const icebreakerShuffleBtn = document.getElementById('icebreaker-shuffle');

// ICE config is fetched from the server (/ice) so it can include TURN relays
// for users on restrictive networks. Falls back to STUN-only if the fetch fails.
let ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

async function loadIceServers() {
  try {
    const res = await fetch('/ice', { cache: 'no-store' });
    const data = await res.json();
    if (data && Array.isArray(data.iceServers) && data.iceServers.length) {
      ICE_SERVERS = data.iceServers;
    }
  } catch (err) {
    console.warn('Falling back to STUN-only ICE:', err);
  }
}
loadIceServers();

let pc = null;
let localStream = null;
let isMuted = false;
let iceRestartTimer = null;
let lastInitiator = false;
let lastWithAudio = false;
let peerWasConnected = false;   // did this peer ever reach 'connected'? (for sounds)
let chatChannel = null;
let board = null;
let mineFlagMode = false;
let sudokuState = null;
let c4State = null;
let tttState = null;
let dbState = null;
let mode = 'idle';        // 'idle' | 'random' | 'room'
let textOnly = false;     // random text-only chat (no mic)
let currentRoom = null;
let partnerIdentity = null;
let partnerGuestId = null;
let partnerAnnounced = false; // have we shown the "now talking with X" line yet?
let iSentFriendReq = false;
let peerSentFriendReq = false;
let pendingCallTo = null;     // guestId we're ringing
let incomingCall = null;      // { fromSocket, mode, idn }
const onlineFriends = new Set();
let selectedInterest = 'any'; // what the user picked on the landing page
let matchSeed = 0;            // shared seed → identical icebreaker on both sides
let matchSharedInterest = 'any';
let icebreakerStep = 0;       // shuffle offset (kept in sync between peers)

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
let flowTimer = null;            // WebRTC-stats poller for the audio indicator
let flowPrev = { out: 0, in: 0 };

// Live audio-flow indicator: polls getStats() to show whether voice bytes are
// actually moving each direction, so a silent call is instantly diagnosable.
function startAudioFlow() {
  if (!audioFlowEl) return;
  audioFlowEl.classList.remove('hidden');
  setFlow(flowOutEl, false);
  setFlow(flowInEl, false);
  flowPrev = { out: 0, in: 0 };
  clearInterval(flowTimer);
  flowTimer = setInterval(pollAudioFlow, 1500);
}
function stopAudioFlow() {
  clearInterval(flowTimer);
  flowTimer = null;
  if (audioFlowEl) audioFlowEl.classList.add('hidden');
}
function setFlow(el, on) {
  if (el) el.classList.toggle('flowing', on);
}
async function pollAudioFlow() {
  if (!pc || pc.connectionState !== 'connected') return;
  try {
    const stats = await pc.getStats();
    let outBytes = 0, inBytes = 0;
    stats.forEach((r) => {
      if (r.type === 'outbound-rtp' && r.kind === 'audio') outBytes += r.bytesSent || 0;
      if (r.type === 'inbound-rtp' && r.kind === 'audio') inBytes += r.bytesReceived || 0;
    });
    setFlow(flowOutEl, outBytes > flowPrev.out);   // our mic is reaching them
    setFlow(flowInEl, inBytes > flowPrev.in);      // we're receiving their audio
    flowPrev = { out: outBytes, in: inBytes };
  } catch { /* getStats unsupported — leave indicator as-is */ }
}

// ---------- profanity filter ----------
const BAD_WORDS = ['fuck','shit','bitch','asshole','bastard','cunt','dick','slut','whore','nigger','faggot','retard'];
const badRe = new RegExp('\\b(' + BAD_WORDS.join('|') + ')\\b', 'gi');
function clean(text) {
  return String(text).replace(badRe, (m) => '*'.repeat(m.length));
}

// ---------- interests + icebreakers ----------
function interestLabel(id) {
  const it = (window.Prompts?.INTERESTS || []).find((x) => x.id === id);
  return it && it.id !== 'any' ? it.label : '';
}

function buildInterestChips() {
  if (!interestChipsEl || !window.Prompts) return;
  interestChipsEl.innerHTML = '';
  Prompts.INTERESTS.forEach((it) => {
    const b = document.createElement('button');
    b.className = 'interest-chip' + (it.id === selectedInterest ? ' active' : '');
    b.dataset.interest = it.id;
    b.innerHTML = `<span>${it.emoji}</span> ${it.label}`;
    b.addEventListener('click', () => {
      selectedInterest = it.id;
      buildInterestChips();
    });
    interestChipsEl.appendChild(b);
  });
}

// Both peers share matchSeed + icebreakerStep → identical prompt, no negotiation.
function currentIcebreaker() {
  const list = window.Prompts?.ICEBREAKERS || [];
  if (!list.length) return '';
  return list[(matchSeed + icebreakerStep) % list.length];
}

function showIcebreaker() {
  if (!icebreakerEl) return;
  icebreakerTextEl.textContent = currentIcebreaker();
  icebreakerEl.classList.remove('hidden');
}

function hideIcebreaker() {
  if (icebreakerEl) icebreakerEl.classList.add('hidden');
  icebreakerStep = 0;
}

// ---------- identity ----------
function selfIdentity() {
  return Identity.identityForId(guestId);
}

function showSelfIdentity() {
  const me = selfIdentity();
  selfIdentityEl.innerHTML = '';
  selfIdentityEl.title = 'You are ' + me.name;
  const av = document.createElement('span');
  av.className = 'id-avatar';
  av.textContent = me.emoji;
  av.style.background = me.color;
  const name = document.createElement('span');
  name.className = 'id-name';
  name.textContent = me.name;       // compact: just the name, no "You are"
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

// Crisp inline SVG icons for the add-friend button's four states.
const ADD_FRIEND_SVG = {
  add:  '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
  pending: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  friends: '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
};
function setAddFriendState(state, title) {
  addFriendBtn.innerHTML = ADD_FRIEND_SVG[state] || ADD_FRIEND_SVG.add;
  addFriendBtn.title = title;
  addFriendBtn.setAttribute('aria-label', title);
  addFriendBtn.classList.toggle('added', state === 'friends');
}

function resetFriendButton() {
  iSentFriendReq = false;
  peerSentFriendReq = false;
  partnerGuestId = null;
  setAddFriendState('add', 'Add friend');
  addFriendBtn.disabled = true;
}

function maybeMutualFriend() {
  if (iSentFriendReq && peerSentFriendReq && partnerGuestId && partnerIdentity) {
    addFriendRecord(partnerGuestId, partnerIdentity.name, partnerIdentity.emoji);
    setAddFriendState('friends', 'Friends');
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

function refreshOrb() {
  // 1-on-1 → show the partner's avatar; rooms → show your own; else empty.
  let idn = null;
  if (mode === 'room') idn = selfIdentity();
  else if (mode === 'random' && partnerIdentity) idn = partnerIdentity;
  if (idn) {
    orbEl.textContent = idn.emoji;
    orbEl.style.setProperty('--orb-tint', idn.color);
    orbEl.classList.add('has-avatar');
  } else {
    orbEl.textContent = '';
    orbEl.classList.remove('has-avatar');
  }
  // The partner's name is the focal label under the orb (1-on-1 only).
  if (partnerNameEl) {
    if (mode === 'random' && partnerIdentity) {
      partnerNameEl.textContent = partnerIdentity.name;
      partnerNameEl.style.color = partnerIdentity.color;
      partnerNameEl.classList.remove('hidden');
    } else {
      partnerNameEl.textContent = '';
      partnerNameEl.classList.add('hidden');
    }
  }
}

function setStatus(text, orbState) {
  statusEl.textContent = text;
  if (orbState) orbEl.className = 'orb ' + orbState;
  refreshOrb();
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
  skipCtl.classList.toggle('hidden', !inRandom);
  skipBtn.disabled = !inRandom;
  // Report — random only (1-on-1 has a single partner to report)
  reportBtn.classList.toggle('hidden', !inRandom);
  reportBtn.disabled = !inRandom;
  // Mute — any voice mode (not text-only random)
  const showMute = inRoom || (inRandom && !textOnly);
  muteCtl.classList.toggle('hidden', !showMute);
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
  muteIco.textContent = isMuted ? '🔇' : '🎙️';
  muteLabel.textContent = isMuted ? 'Unmute' : 'Mute';
  muteBtn.classList.toggle('muted', isMuted);
}

// ---------- chat rendering ----------
function appendMessage(text, who) {
  const div = document.createElement('div');
  div.className = 'msg ' + who;
  div.textContent = clean(text);
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  // Unread badge: a real incoming message while the user is on another tab.
  if (who === 'them' && activeTabName() !== 'chat') {
    const chatTab = document.querySelector('.tab[data-tab="chat"]');
    if (chatTab) chatTab.classList.add('has-notif');
  }
}

function activeTabName() {
  const t = document.querySelector('.tab.active');
  return t ? t.dataset.tab : 'chat';
}

function appendSystem(text) { appendMessage(text, 'system'); }

function clearChat() {
  messagesEl.innerHTML = '';
  chatInput.value = '';
  hideIcebreaker();
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
    mineFlagBtn.disabled = false;
    sudokuNewBtn.disabled = false;
    c4NewBtn.disabled = false;
    tttNewBtn.disabled = false;
    dbNewBtn.disabled = false;
    drawClearBtn.disabled = false;
    addFriendBtn.disabled = false;
    // Exchange persistent identity so BOTH sides derive the same name from the
    // same guestId. We announce the partner only after their hello arrives
    // (announcePartner), so the name shown matches what they call themselves.
    sendOverChannel({ type: 'hello', guestId });
    if (partnerGuestId) announcePartner();
  };
  channel.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { msg = { type: 'chat', text: e.data }; }
    if (msg.type === 'hello') {
      if (msg.guestId) {
        partnerGuestId = msg.guestId;
        partnerIdentity = Identity.identityForId(msg.guestId);
        refreshOrb();          // repaint orb + name with the REAL shared identity
        // Re-sync the status line now that we know the real name.
        if (pc && pc.connectionState === 'connected') {
          setStatus(textOnly ? 'Connected · start typing' : 'Connected · say hi 👋', 'live');
        }
        announcePartner();     // "You're now talking with X" — same name both sides
        const known = loadFriends().some((f) => f.id === partnerGuestId);
        if (known) {
          setAddFriendState('friends', 'Friends');
          addFriendBtn.disabled = true;
        }
      }
    } else if (msg.type === 'ice-shuffle') {
      icebreakerStep = msg.step || 0;
      showIcebreaker();
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
    mineFlagBtn.disabled = true;
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
    const w = parseInt(drawSizeEl.value, 10) || 4;
    drawApi.setWidth(w);
    drawSizeDotEl.style.setProperty('--dot', Math.min(w, 26) + 'px');
  }

  // Selecting a preset swatch or the eraser.
  function selectColor(color, swatchBtn) {
    drawPaletteEl.querySelectorAll('.swatch').forEach((b) => b.classList.remove('active'));
    if (swatchBtn) swatchBtn.classList.add('active');
    drawApi.setColor(color);
  }

  drawPaletteEl.innerHTML = '';
  const colors = [...Draw.COLORS, Draw.ERASER];
  colors.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'swatch' + (i === 0 ? ' active' : '') + (color === Draw.ERASER ? ' eraser' : '');
    btn.style.setProperty('--swatch-color', color === Draw.ERASER ? 'transparent' : color);
    btn.setAttribute('aria-label', color === Draw.ERASER ? 'Eraser' : 'Color ' + color);
    btn.addEventListener('click', () => selectColor(color, btn));
    drawPaletteEl.appendChild(btn);
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
    flagMode: mineFlagMode,
    onReveal: (x, y) => {
      if (!board || board.over) return;
      Minesweeper.revealCell(board, x, y);
      sendOverChannel({ type: 'reveal', x, y });
      renderGame();
    },
    onFlag: (x, y) => {
      if (!board || board.over) return;
      Minesweeper.toggleFlag(board, x, y);
      sendOverChannel({ type: 'flag', x, y });
      renderGame();
    },
  });
}

function setFlagMode(on) {
  mineFlagMode = on;
  if (mineFlagBtn) {
    mineFlagBtn.classList.toggle('active', on);
    mineFlagBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  renderGame();
}

function startGame(seed, broadcast) {
  board = Minesweeper.buildBoard(seed);
  setFlagMode(false);
  switchTab('mines');
  if (broadcast) sendOverChannel({ type: 'game-start', seed });
}

function switchTab(name) {
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  panels.forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== name));
  // Clear the unread badge when the user lands on Chat.
  if (name === 'chat') {
    const chatTab = document.querySelector('.tab[data-tab="chat"]');
    if (chatTab) chatTab.classList.remove('has-notif');
  }
  // Focus mode: on a game/canvas tab, shrink the orb/identity/controls so the
  // activity gets nearly the whole screen. Restore on the chat tab.
  appEl.classList.toggle('focus-mode', name !== 'chat');
  // The canvas size changes when focus-mode toggles, so re-measure it next frame.
  if (drawApi) requestAnimationFrame(() => drawApi.redrawAll());
}

function clearGame() {
  board = null;
  mineFlagMode = false;
  if (mineFlagBtn) { mineFlagBtn.classList.remove('active'); mineFlagBtn.setAttribute('aria-pressed', 'false'); }
  boardEl.innerHTML = '';
  gameStatusEl.textContent = 'Tap “New game” to start.';
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
      // autoGainControl + EC/NS clean up noisy/laggy mics on weak setups.
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    return localStream;
  } catch (err) {
    setStatus('Microphone access denied.', 'idle');
    throw err;
  }
}

// Enable Opus in-band FEC (forward error correction) so audio survives packet
// loss on weak connections. We ONLY touch the actual Opus payload's fmtp line —
// the previous version matched any "/111/" which could corrupt a different
// codec's line on browsers that assign Opus a non-111 payload, breaking audio
// entirely ("connected but silent"). Fails safe: returns the SDP unchanged if
// it can't confidently find Opus. DTX is intentionally NOT enabled — it can
// clip the start of speech on some devices.
function tuneAudioSdp(sdp) {
  try {
    if (!sdp || !sdp.sdp) return sdp;
    const s = sdp.sdp;
    // Find Opus's dynamic payload type from its rtpmap line.
    const m = s.match(/a=rtpmap:(\d+)\s+opus\/48000/i);
    if (!m) return sdp;                       // no Opus → leave SDP alone
    const pt = m[1];
    const lines = s.split(/\r?\n/);
    let hasFmtp = false;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('a=fmtp:' + pt + ' ')) {
        hasFmtp = true;
        if (!/useinbandfec=1/.test(lines[i])) lines[i] += ';useinbandfec=1';
      }
    }
    // If Opus had no fmtp line at all, add one right after its rtpmap.
    if (!hasFmtp) {
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('a=rtpmap:' + pt + ' opus')) {
          lines.splice(i + 1, 0, 'a=fmtp:' + pt + ' useinbandfec=1');
          break;
        }
      }
    }
    return new RTCSessionDescription({ type: sdp.type, sdp: lines.join('\r\n') });
  } catch (err) {
    console.warn('tuneAudioSdp skipped:', err);
    return sdp;                               // never let SDP tuning break the call
  }
}

function partnerName() {
  return partnerIdentity ? `${partnerIdentity.emoji} ${partnerIdentity.name}` : 'a stranger';
}

async function restartIce() {
  if (!pc || !lastInitiator) return; // only the offerer drives the restart
  try {
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(tuneAudioSdp(offer));
    socket.emit('signal', { type: 'offer', sdp: pc.localDescription });
  } catch (err) { console.warn('ICE restart failed:', err); }
}

function createPeer(initiator, withAudio) {
  lastInitiator = initiator;
  lastWithAudio = withAudio;
  peerWasConnected = false;
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });

  if (withAudio && localStream) {
    localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  }

  if (initiator) {
    setupChatChannel(pc.createDataChannel('chat'));
  } else {
    pc.ondatachannel = (e) => setupChatChannel(e.channel);
  }

  pc.ontrack = (e) => {
    remoteAudio.srcObject = e.streams[0];
    remoteAudio.muted = false;
    // Mobile browsers can silently block autoplay; nudge it and retry on the
    // first user gesture if it's blocked.
    const tryPlay = () => remoteAudio.play().catch(() => {});
    tryPlay();
    document.addEventListener('click', tryPlay, { once: true });
    document.addEventListener('touchend', tryPlay, { once: true });
  };

  pc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('signal', { type: 'ice', candidate: e.candidate });
  };

  pc.oniceconnectionstatechange = () => {
    if (!pc) return;
    // On a transient drop, try an ICE restart before giving up.
    if (pc.iceConnectionState === 'disconnected') {
      setStatus(`Reconnecting to ${partnerName()}…`, 'searching');
      clearTimeout(iceRestartTimer);
      iceRestartTimer = setTimeout(() => {
        if (pc && (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed')) restartIce();
      }, 2000);
    } else if (pc.iceConnectionState === 'failed') {
      restartIce();
    }
  };

  pc.onconnectionstatechange = () => {
    if (!pc) return;
    if (pc.connectionState === 'connected') {
      clearTimeout(iceRestartTimer);
      setStatus(textOnly ? 'Connected · start typing' : 'Connected · say hi 👋', 'live');
      if (!peerWasConnected) {
        peerWasConnected = true;
        if (window.Sounds) Sounds.connected();        // chime on first connect
        if (!textOnly) startAudioFlow();               // show live audio indicator
      }
    } else if (pc.connectionState === 'failed') {
      // Last resort: full restart attempt; if that can't run, surface it.
      restartIce();
      setStatus(`Connection trouble — retrying…`, 'searching');
    }
  };
}

function teardownPeer() {
  clearTimeout(iceRestartTimer);
  stopAudioFlow();
  // Disconnect chime only if a call was actually established (not on a plain skip
  // from the searching state, and not for text-only chats).
  if (peerWasConnected && !textOnly && window.Sounds) Sounds.disconnected();
  peerWasConnected = false;
  if (chatChannel) {
    try { chatChannel.close(); } catch {}
    chatChannel = null;
  }
  if (pc) { pc.close(); pc = null; }
  remoteAudio.srcObject = null;
  partnerIdentity = null;
  partnerAnnounced = false;
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
  hideIcebreaker();
  const tag = interestLabel(selectedInterest);
  setStatus(tag ? `Finding someone for ${tag.toLowerCase()}…` : (textOnly ? 'Finding someone to text…' : 'Finding someone to talk to…'), 'searching');
  socket.emit('find-partner', { mode: textOnly ? 'text' : 'voice', interest: selectedInterest });
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
  const peerPc = new RTCPeerConnection({ iceServers: ICE_SERVERS, iceCandidatePoolSize: 4 });
  if (localStream) localStream.getTracks().forEach((t) => peerPc.addTrack(t, localStream));
  if (!participants.has(peerId)) {
    participants.set(peerId, { color: colorForId(peerId), speaking: false, initiator });
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
    audio.muted = false;
    audio.play().catch(() => {});
    attachPeerAnalyser(peerId, e.streams[0]);
  };
  peerPc.onicecandidate = (e) => {
    if (e.candidate) socket.emit('room-signal', { to: peerId, type: 'ice', candidate: e.candidate });
  };
  // Recover a flaky room leg with an ICE restart (the side that offered drives it).
  peerPc.oniceconnectionstatechange = () => {
    if (!roomPeers.has(peerId)) return;
    if ((peerPc.iceConnectionState === 'failed' || peerPc.iceConnectionState === 'disconnected') && initiator) {
      setTimeout(async () => {
        if (!roomPeers.has(peerId)) return;
        if (peerPc.iceConnectionState === 'connected' || peerPc.iceConnectionState === 'completed') return;
        try {
          const offer = await peerPc.createOffer({ iceRestart: true });
          await peerPc.setLocalDescription(tuneAudioSdp(offer));
          socket.emit('room-signal', { to: peerId, type: 'offer', sdp: peerPc.localDescription });
        } catch (err) { console.warn('Room ICE restart failed:', err); }
      }, 1500);
    }
  };
  roomPeers.set(peerId, peerPc);
  if (initiator) {
    (async () => {
      const offer = await peerPc.createOffer();
      await peerPc.setLocalDescription(tuneAudioSdp(offer));
      socket.emit('room-signal', { to: peerId, type: 'offer', sdp: peerPc.localDescription });
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
      await peerPc.setLocalDescription(tuneAudioSdp(answer));
      socket.emit('room-signal', { to: from, type: 'answer', sdp: peerPc.localDescription });
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
  if (activeTabName() !== 'chat') {
    const chatTab = document.querySelector('.tab[data-tab="chat"]');
    if (chatTab) chatTab.classList.add('has-notif');
  }
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

async function handleMatch({ initiator, peerId, mode: matchedMode, seed, sharedInterest }) {
  pendingCallTo = null;
  // Do NOT derive identity from peerId (that's the ephemeral socket id, which
  // differs from the partner's persistent guestId — it would show a different
  // name than the partner sees for themselves). We learn the real identity from
  // the 'hello' message once the data channel opens. partnerIdentity may already
  // be set for an outgoing friend call (where we know the guestId).
  partnerAnnounced = false;
  matchSeed = seed || 0;
  matchSharedInterest = sharedInterest || 'any';
  const withAudio = matchedMode !== 'text';
  // Guarantee the mic is captured BEFORE we build the peer — otherwise we'd add
  // no audio track and the partner would hear silence. (Normally ensured in
  // startCall, but this protects the friend-call / re-match paths too.)
  if (withAudio && !localStream) {
    try { await ensureMic(); } catch { setStatus('Microphone blocked — they can’t hear you.', 'idle'); }
  }
  createPeer(initiator, withAudio);
  if (initiator) {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(tuneAudioSdp(offer));
    socket.emit('signal', { type: 'offer', sdp: pc.localDescription });
  }
  setStatus('Connecting…', 'searching');
}

async function handleSignal(data) {
  if (!pc) return;
  try {
    if (data.type === 'offer') {
      // Works for the initial offer AND ICE-restart offers (renegotiation).
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(tuneAudioSdp(answer));
      socket.emit('signal', { type: 'answer', sdp: pc.localDescription });
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
  btn.addEventListener('click', () => { if (window.Sounds) Sounds.unlock(); startCall(btn.dataset.start === 'text'); });
});
document.querySelectorAll('[data-room]').forEach((btn) => {
  if (btn.tagName === 'BUTTON') btn.addEventListener('click', () => { if (window.Sounds) Sounds.unlock(); joinRoom(btn.dataset.room); });
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
    setAddFriendState('pending', 'Friend request sent');
    addFriendBtn.disabled = true;
    appendSystem('Friend request sent — they need to tap the add-friend button too.');
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
mineFlagBtn.addEventListener('click', () => {
  if (!board || board.over) return;
  setFlagMode(!mineFlagMode);
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

// ---------- icebreakers + interest chips wiring ----------
buildInterestChips();

if (icebreakerShuffleBtn) {
  icebreakerShuffleBtn.addEventListener('click', () => {
    icebreakerStep++;
    showIcebreaker();
    sendOverChannel({ type: 'ice-shuffle', step: icebreakerStep });
  });
}
