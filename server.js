const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const io = new Server(server);

let waiting = null;
const partners = new Map();
const ROOMS = new Set(['lounge', 'chill']);

function cleanupPartner(socket) {
  const partnerId = partners.get(socket.id);
  if (partnerId) {
    partners.delete(socket.id);
    partners.delete(partnerId);
    const partner = io.sockets.sockets.get(partnerId);
    if (partner) partner.emit('partner-left');
  }
  if (waiting && waiting.id === socket.id) waiting = null;
}

function leaveRoom(socket) {
  const room = socket.data?.room;
  if (!room) return;
  socket.to(room).emit('peer-left', { peerId: socket.id });
  socket.leave(room);
  socket.data.room = null;
  // Notify everyone in room of new participant count
  io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room)?.size || 0 });
}

io.on('connection', (socket) => {
  socket.on('find-partner', () => {
    cleanupPartner(socket);
    leaveRoom(socket);

    if (waiting && waiting.id !== socket.id && waiting.connected) {
      const partner = waiting;
      waiting = null;
      partners.set(socket.id, partner.id);
      partners.set(partner.id, socket.id);
      socket.emit('matched', { initiator: true });
      partner.emit('matched', { initiator: false });
    } else {
      waiting = socket;
      socket.emit('waiting');
    }
  });

  socket.on('signal', (data) => {
    const partnerId = partners.get(socket.id);
    if (partnerId) io.to(partnerId).emit('signal', data);
  });

  socket.on('join-room', ({ room }) => {
    if (!ROOMS.has(room)) return;
    cleanupPartner(socket);
    leaveRoom(socket);

    const existing = Array.from(io.sockets.adapter.rooms.get(room) || []);
    socket.join(room);
    socket.data.room = room;

    socket.emit('room-joined', { room, peers: existing });
    socket.to(room).emit('peer-joined', { peerId: socket.id });
    io.to(room).emit('room-count', { count: io.sockets.adapter.rooms.get(room).size });
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
  socket.on('disconnect', () => { cleanupPartner(socket); leaveRoom(socket); });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Voice chat server listening on http://localhost:${PORT}`);
});
