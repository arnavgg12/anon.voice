const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

// Separate waiting slots per mode so text users match text, voice match voice.
const waiting = { voice: null, text: null };
const partners = new Map();
const ROOMS = new Set(['lounge', 'chill']);
const ROOM_CAP = 5;
let reportCount = 0;

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
  for (const q of Object.keys(waiting)) {
    if (waiting[q] && waiting[q].id === socket.id) waiting[q] = null;
  }
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
    cleanupPartner(socket);
    leaveRoom(socket);

    const slot = waiting[mode];
    if (slot && slot.id !== socket.id && slot.connected) {
      const partner = slot;
      waiting[mode] = null;
      partners.set(socket.id, partner.id);
      partners.set(partner.id, socket.id);
      socket.emit('matched', { initiator: true, peerId: partner.id, mode });
      partner.emit('matched', { initiator: false, peerId: socket.id, mode });
    } else {
      waiting[mode] = socket;
      socket.emit('waiting', { mode });
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

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice chat server listening on http://localhost:${PORT}`);
});
