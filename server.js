const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// ICE config endpoint. STUN finds your public address; TURN *relays* media
// when a direct path is impossible (symmetric NAT, strict firewalls, some
// mobile carriers) — without it, ~10-15% of users can't connect at all.
//
// By default we ship free, open TURN relays (OpenRelay by Metered). For
// production reliability set your own via env vars — NO secrets in the repo:
//   TURN_URLS="turn:turn.example.com:3478,turns:turn.example.com:5349"
//   TURN_USERNAME="..."   TURN_CREDENTIAL="..."
function iceServers() {
  const list = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];
  if (process.env.TURN_URLS) {
    list.push({
      urls: process.env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean),
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    });
  } else {
    // Free public fallback so strict-NAT users still connect out of the box.
    list.push(
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    );
  }
  return list;
}

app.get('/ice', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ iceServers: iceServers() });
});

const server = http.createServer(app);
const io = new Server(server);

// Waiting pools per mode. Each entry: { socket, interest, since }.
// Interest-aware matching: prefer someone who shares an interest tag; after a
// short grace window, fall back to anyone so nobody waits forever.
const pools = { voice: [], text: [] };
const GRACE_MS = 4000;       // try hard to interest-match for the first 4s
const partners = new Map();

let matchSeed = 1;           // monotonic seed so matched pairs share a prompt index
const ROOMS = new Set(['lounge', 'chill']);
const ROOM_CAP = 5;
let reportCount = 0;

function removeFromPools(socketId) {
  for (const m of Object.keys(pools)) {
    pools[m] = pools[m].filter((e) => e.socket.id !== socketId);
  }
}

// Best waiting partner for `me`: same interest first, then either-"any",
// then (only past the grace window) literally anyone still waiting.
function pickPartner(pool, me) {
  const now = Date.now();
  let best = pool.find((e) => e.socket.connected && e.interest === me.interest && me.interest !== 'any');
  if (!best) best = pool.find((e) => e.socket.connected && (e.interest === 'any' || me.interest === 'any'));
  if (!best) best = pool.find((e) => e.socket.connected && (now - e.since) > GRACE_MS);
  return best || null;
}

function emitMatch(aSock, bSock, mode, interestA, interestB) {
  partners.set(aSock.id, bSock.id);
  partners.set(bSock.id, aSock.id);
  const seed = matchSeed++;
  const shared = (interestA && interestA !== 'any') ? interestA
               : (interestB && interestB !== 'any') ? interestB : 'any';
  aSock.emit('matched', { initiator: true,  peerId: bSock.id, mode, seed, sharedInterest: shared });
  bSock.emit('matched', { initiator: false, peerId: aSock.id, mode, seed, sharedInterest: shared });
}

// Sweep: pair anyone still waiting EVEN WITH NO NEW ARRIVALS. Without this,
// two people who picked different interests would wait forever, since matching
// otherwise only runs when a new person calls find-partner.
function sweepPools() {
  const now = Date.now();
  for (const mode of Object.keys(pools)) {
    let pool = pools[mode].filter((e) => e.socket.connected);
    pool.sort((a, b) => a.since - b.since);
    const used = new Set();
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const me = pool[i];
      let j = -1;
      for (let k = i + 1; k < pool.length; k++) {
        if (!used.has(k) && pool[k].interest === me.interest && me.interest !== 'any') { j = k; break; }
      }
      if (j === -1) for (let k = i + 1; k < pool.length; k++) {
        if (!used.has(k) && (pool[k].interest === 'any' || me.interest === 'any')) { j = k; break; }
      }
      if (j === -1 && (now - me.since) > GRACE_MS) {
        for (let k = i + 1; k < pool.length; k++) { if (!used.has(k)) { j = k; break; } }
      }
      if (j !== -1) { used.add(i); used.add(j); emitMatch(me.socket, pool[j].socket, mode, me.interest, pool[j].interest); }
    }
    pools[mode] = pool.filter((_, idx) => !used.has(idx));
  }
}
setInterval(sweepPools, 1500);

// Friends / presence (in-memory; friend lists themselves live in each client's
// localStorage — the server only knows who is online right now).
const online = new Map();       // guestId  -> socketId
const socketGuest = new Map();  // socketId -> guestId
const watchers = new Map();     // guestId  -> Set<socketId> (who wants presence updates)

function cleanupPartner(socket) {
  const partnerId = partners.get(socket.id);
  if (partnerId) {
    partners.delete(socket.id);
    partners.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner) partner.emit('partner-left');
  }
  removeFromPools(socket.id);
}

function leaveRoom(socket) {
  const room = socket.data?.room;
  if (!room) return;
  socket.to(room).emit('peer-left', { peerId: socket.id });
  socket.leave(room);
  socket.data.room = null;
  io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room)?.size || 0 });
  broadcastLobbyCounts();
}

function getLobbyCounts() {
  const counts = {};
  for (const room of ROOMS) {
    counts[room] = io.sockets.adapter.rooms.get(room)?.size || 0;
  }
  return counts;
}

function broadcastLobbyCounts() {
  io.emit('lobby-counts', getLobbyCounts());
}

function broadcastOnline() {
  io.emit('online', { count: io.engine.clientsCount });
}

function notifyPresence(guestId, isOnline) {
  const set = watchers.get(guestId);
  if (!set) return;
  for (const sid of set) io.to(sid).emit('friend-presence', { id: guestId, online: isOnline });
}

function pairSockets(aSock, bSock, mode) {
  cleanupPartner(aSock); cleanupPartner(bSock);
  leaveRoom(aSock); leaveRoom(bSock);
  partners.set(aSock.id, bSock.id);
  partners.set(bSock.id, aSock.id);
  aSock.emit('matched', { initiator: true, peerId: bSock.id, mode });
  bSock.emit('matched', { initiator: false, peerId: aSock.id, mode });
}

io.on('connection', (socket) => {
  // Send current lobby counts to the newly-connected client
  socket.emit('lobby-counts', getLobbyCounts());
  socket.emit('online', { count: io.engine.clientsCount });
  broadcastOnline();

  socket.on('find-partner', (opts) => {
    const mode = opts && opts.mode === 'text' ? 'text' : 'voice';
    const interest = (opts && typeof opts.interest === 'string') ? opts.interest : 'any';
    cleanupPartner(socket);
    leaveRoom(socket);
    removeFromPools(socket.id);

    const me = { socket, interest, since: Date.now() };
    const pool = pools[mode];
    const match = pickPartner(pool, me);

    if (match) {
      pools[mode] = pool.filter((e) => e.socket.id !== match.socket.id);
      emitMatch(socket, match.socket, mode, interest, match.interest);
    } else {
      pool.push(me);
      socket.emit('waiting', { mode, interest });
    }
  });


  socket.on('report', () => {
    reportCount++;
    const partnerId = partners.get(socket.id);
    console.log(`[report] ${socket.id} reported ${partnerId || '(room/none)'} — total ${reportCount}`);
    // No moderation backend in this MVP; we log and let the client skip.
  });

  // ---- Friends / presence ----
  socket.on('register', ({ guestId }) => {
    if (typeof guestId !== 'string' || !guestId || guestId.length > 64) return;
    socket.data.guestId = guestId;
    online.set(guestId, socket.id);
    socketGuest.set(socket.id, guestId);
    notifyPresence(guestId, true);
  });

  socket.on('watch-friends', ({ ids }) => {
    if (!Array.isArray(ids)) return;
    if (!socket.data.watched) socket.data.watched = new Set();
    const onlineNow = [];
    for (const id of ids.slice(0, 200)) {
      if (typeof id !== 'string') continue;
      if (!watchers.has(id)) watchers.set(id, new Set());
      watchers.get(id).add(socket.id);
      socket.data.watched.add(id);
      if (online.has(id)) onlineNow.push(id);
    }
    socket.emit('friends-presence', { online: onlineNow });
  });

  socket.on('call-friend', ({ toGuestId, mode }) => {
    const targetSocketId = online.get(toGuestId);
    if (!targetSocketId) { socket.emit('friend-unavailable', { toGuestId }); return; }
    io.to(targetSocketId).emit('friend-call', {
      fromGuestId: socket.data.guestId || null,
      fromSocket: socket.id,
      mode: mode === 'text' ? 'text' : 'voice',
    });
  });

  socket.on('call-response', ({ toSocket, accept, mode }) => {
    const caller = io.sockets.sockets.get(toSocket);
    if (!caller) { socket.emit('friend-unavailable', {}); return; }
    if (!accept) { caller.emit('friend-declined', {}); return; }
    pairSockets(caller, socket, mode === 'text' ? 'text' : 'voice');
  });

  socket.on('cancel-call', ({ toGuestId }) => {
    const t = online.get(toGuestId);
    if (t) io.to(t).emit('friend-call-cancelled', {});
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', data);
  });

  socket.on('join-room', ({ room }) => {
    if (!ROOMS.has(room)) return;
    const existingSet = io.sockets.adapter.rooms.get(room) || new Set();
    if (existingSet.size >= ROOM_CAP) {
      socket.emit('room-full', { room, cap: ROOM_CAP });
      return;
    }
    cleanupPartner(socket);
    leaveRoom(socket);

    const existing = Array.from(existingSet);
    socket.join(room);
    socket.data.room = room;

    socket.emit('room-joined', { room, peers: existing });
    socket.to(room).emit('peer-joined', { peerId: socket.id });
    io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room).size });
    broadcastLobbyCounts();
  });

  // Room signaling — `to` field routes to a specific peer in the room
  socket.on('room-signal', ({ to, ...payload }) => {
    if (!socket.data?.room) return;
    io.to(to).emit('room-signal', { from: socket.id, ...payload });
  });

  socket.on('room-text', ({ text }) => {
    const room = socket.data?.room;
    if (!room) return;
    if (typeof text !== 'string' || text.length > 500) return;
    socket.to(room).emit('room-text', { from: socket.id, text });
  });

  socket.on('leave', () => { cleanupPartner(socket); leaveRoom(socket); });
  socket.on('disconnect', () => {
    cleanupPartner(socket);
    leaveRoom(socket);
    // Presence cleanup
    const gid = socketGuest.get(socket.id);
    if (gid) {
      socketGuest.delete(socket.id);
      if (online.get(gid) === socket.id) {
        online.delete(gid);
        notifyPresence(gid, false);
      }
    }
    if (socket.data.watched) {
      for (const id of socket.data.watched) watchers.get(id)?.delete(socket.id);
    }
    broadcastOnline();
  });
});

// Lightweight health endpoint for keepalive pings + uptime checks.
app.get('/healthz', (_req, res) => res.type('text').send('ok'));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice chat server listening on http://localhost:${PORT}`);
});

// Keep the free Render instance awake: ping our own public URL every 10 min so
// it doesn't sleep after 15 min idle (which caused "can't be reached" on refresh).
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) {
  setInterval(() => {
    const https = require('https');
    https.get(SELF_URL + '/healthz', (r) => { r.resume(); })
      .on('error', () => {});
  }, 10 * 60 * 1000);
  console.log(`Keepalive enabled for ${SELF_URL}`);
}
