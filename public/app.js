const socket = io();

const startBtn = document.getElementById('start');
const skipBtn = document.getElementById('skip');
const stopBtn = document.getElementById('stop');
const statusEl = document.getElementById('status');
const orbEl = document.getElementById('orb');
const remoteAudio = document.getElementById('remote-audio');

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

let pc = null;
let localStream = null;

function setStatus(text, orbState) {
  statusEl.textContent = text;
  if (orbState) orbEl.className = 'orb ' + orbState;
}

function setButtons({ start, skip, stop }) {
  startBtn.disabled = !start;
  skipBtn.disabled = !skip;
  stopBtn.disabled = !stop;
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

function createPeer() {
  pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

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
  if (pc) {
    pc.close();
    pc = null;
  }
  remoteAudio.srcObject = null;
}

async function startCall() {
  try {
    await ensureMic();
  } catch {
    return;
  }
  setStatus('Looking for someone…', 'searching');
  setButtons({ start: false, skip: true, stop: true });
  socket.emit('find-partner');
}

async function handleMatch({ initiator }) {
  createPeer();
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
  setStatus('They left. Finding someone new…', 'searching');
  socket.emit('find-partner');
});

startBtn.addEventListener('click', startCall);

skipBtn.addEventListener('click', () => {
  teardownPeer();
  setStatus('Finding someone new…', 'searching');
  socket.emit('find-partner');
});

stopBtn.addEventListener('click', () => {
  teardownPeer();
  socket.emit('leave');
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  setStatus('Click Start to begin.', 'idle');
  setButtons({ start: true, skip: false, stop: false });
});

setButtons({ start: true, skip: false, stop: false });
