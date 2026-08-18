/* =========================================================
   가족 숫자야구 게임 - 서버 (Express + Socket.IO)
   ========================================================= */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const Rules = require('./public/js/rules.js');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  // 모바일에서 화면이 꺼지거나 앱을 전환하면 브라우저가 타이머/네트워크를 강하게 제한해서
  // 기본값(핑 간격 25초 + 타임아웃 20초)보다 오래 응답이 없을 수 있다. 넉넉하게 잡아서
  // 실제로 끊긴 게 아닌데 끊긴 걸로 오판하는 경우를 줄인다.
  pingInterval: 25000,
  pingTimeout: 60000,
});

const PORT = process.env.PORT || 3000;
const LEN = Rules.LEN;
const ALLOWED_LENS = Rules.ALLOWED_LENS;

function normalizeLen(len) {
  const n = Number(len);
  return ALLOWED_LENS.includes(n) ? n : LEN;
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/healthz', (req, res) => res.send('ok'));

/** @type {Map<string, Room>} */
const rooms = new Map();
// 게임 도중엔 한쪽이 오래 고민하며 화면을 꺼두는 일이 흔해서, 너무 짧으면 활동 중인 방이
// 삭제되거나 재접속 유예시간을 넘겨 상대가 방에서 제거되는 문제가 생긴다. 넉넉하게 잡는다.
const ROOM_TTL_MS = 30 * 60 * 1000;
const RECONNECT_GRACE_MS = 10 * 60 * 1000;

function genCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function genToken() {
  return crypto.randomBytes(12).toString('hex');
}

function makeRoom(code, len) {
  return {
    code,
    len: normalizeLen(len),
    players: {}, // token -> {token,name,avatar,role,secret,socketId,connected}
    turn: null,  // 지금 추측할 차례인 token
    history: [], // {by, guess, strikes, balls, out}
    status: 'waiting', // waiting | setup | playing | ended
    winner: null, // token | 'draw'
    rematchVotes: new Set(),
    createdAt: Date.now(),
    lastActivity: Date.now(),
    disconnectTimers: {},
  };
}

function roomPublicPlayers(room) {
  return Object.values(room.players).map((p) => ({
    token: p.token, name: p.name, avatar: p.avatar, role: p.role,
    connected: !!p.connected, ready: !!p.secret,
  }));
}

function touch(room) { room.lastActivity = Date.now(); }
function playerByToken(room, token) { return room.players[token]; }
function opponentOf(room, token) { return Object.values(room.players).find((p) => p.token !== token); }

io.on('connection', (socket) => {
  socket.data.roomCode = null;
  socket.data.token = null;

  socket.on('room:create', (payload = {}, cb) => {
    try {
      const code = genCode();
      const room = makeRoom(code, payload.len);
      const token = genToken();
      room.players[token] = {
        token, name: (payload.name || '플레이어').slice(0, 12), avatar: payload.avatar || '🙂',
        role: 'p1', secret: null, socketId: socket.id, connected: true,
      };
      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.token = token;
      cb && cb({ ok: true, code, token, role: 'p1', len: room.len, players: roomPublicPlayers(room) });
    } catch (err) {
      cb && cb({ ok: false, message: '방을 만들지 못했어요. 다시 시도해주세요.' });
    }
  });

  socket.on('room:join', (payload = {}, cb) => {
    const code = String(payload.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return cb && cb({ ok: false, message: '방을 찾을 수 없어요. 코드를 확인해주세요.' });
    if (Object.keys(room.players).length >= 2) {
      return cb && cb({ ok: false, message: '이미 두 명이 입장한 방이에요.' });
    }
    const token = genToken();
    room.players[token] = {
      token, name: (payload.name || '플레이어').slice(0, 12), avatar: payload.avatar || '🙂',
      role: 'p2', secret: null, socketId: socket.id, connected: true,
    };
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = token;
    touch(room);
    room.status = 'setup';

    cb && cb({ ok: true, code, token, role: 'p2', len: room.len, players: roomPublicPlayers(room) });
    io.to(code).emit('game:setup', { players: roomPublicPlayers(room) });
  });

  socket.on('room:rejoin', (payload = {}, cb) => {
    const code = String(payload.code || '').toUpperCase().trim();
    const room = rooms.get(code);
    if (!room || !room.players[payload.token]) {
      return cb && cb({ ok: false, message: '방에 다시 들어갈 수 없어요.' });
    }
    const p = room.players[payload.token];
    p.socketId = socket.id;
    p.connected = true;
    if (room.disconnectTimers[payload.token]) {
      clearTimeout(room.disconnectTimers[payload.token]);
      delete room.disconnectTimers[payload.token];
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.token = payload.token;
    touch(room);

    cb && cb({
      ok: true, code, token: p.token, role: p.role, len: room.len, status: room.status,
      turn: room.turn, history: room.history, winner: room.winner,
      players: roomPublicPlayers(room),
    });
    socket.to(code).emit('room:opponent-reconnected', { players: roomPublicPlayers(room) });
  });

  socket.on('game:set-secret', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || (room.status !== 'setup' && room.status !== 'waiting')) return;
    const me = playerByToken(room, socket.data.token);
    if (!me) return;
    const secret = String(payload.secret || '');
    if (!Rules.isValidNumber(secret, room.len)) return;
    me.secret = secret;
    touch(room);

    io.to(room.code).emit('game:setup', { players: roomPublicPlayers(room) });

    const all = Object.values(room.players);
    if (all.length === 2 && all.every((p) => p.secret)) {
      room.status = 'playing';
      room.turn = all[Math.floor(Math.random() * 2)].token;
      room.history = [];
      room.winner = null;
      io.to(room.code).emit('game:start', {
        turn: room.turn, players: roomPublicPlayers(room),
      });
    }
  });

  socket.on('game:guess', (payload = {}, cb) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== 'playing') {
      return cb && cb({ ok: false, message: '게임 방을 찾을 수 없어요. 새로고침 후 다시 접속해주세요.' });
    }
    const me = playerByToken(room, socket.data.token);
    if (!me || me.token !== room.turn) {
      return cb && cb({ ok: false, message: '아직 내 차례가 아니에요.' });
    }
    const guess = String(payload.guess || '');
    if (!Rules.isValidNumber(guess, room.len)) {
      return cb && cb({ ok: false, message: '숫자를 다시 확인해주세요.' });
    }
    const opp = opponentOf(room, me.token);
    if (!opp || !opp.secret) {
      return cb && cb({ ok: false, message: '상대방을 찾을 수 없어요.' });
    }

    const g = Rules.grade(opp.secret, guess);
    const entry = { by: me.token, guess, strikes: g.strikes, balls: g.balls, out: g.out };
    room.history.push(entry);
    touch(room);

    let winner = null;
    if (Rules.isHomerun(g.strikes, room.len)) {
      winner = me.token;
      room.status = 'ended';
      room.winner = winner;
    } else {
      room.turn = opp.token;
    }

    io.to(room.code).emit('game:guess-result', {
      entry, turn: room.turn, status: room.status, winner,
    });
    cb && cb({ ok: true });
  });

  socket.on('game:resign', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.status !== 'playing') return;
    const me = playerByToken(room, socket.data.token);
    if (!me) return;
    const opp = opponentOf(room, me.token);
    room.status = 'ended';
    room.winner = opp ? opp.token : null;
    io.to(room.code).emit('game:resigned', { by: me.token, winner: room.winner });
  });

  socket.on('game:rematch-request', () => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    room.rematchVotes.add(socket.data.token);
    socket.to(room.code).emit('game:rematch-requested');
    if (room.rematchVotes.size >= 2) {
      Object.values(room.players).forEach((p) => { p.secret = null; });
      room.history = [];
      room.turn = null;
      room.status = 'setup';
      room.winner = null;
      room.rematchVotes.clear();
      io.to(room.code).emit('game:rematch-start', { players: roomPublicPlayers(room) });
    }
  });

  socket.on('chat:message', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const me = playerByToken(room, socket.data.token);
    if (!me) return;
    const text = String(payload.text || '').slice(0, 200);
    if (!text.trim()) return;
    io.to(room.code).emit('chat:message', { name: me.name, role: me.role, text, ts: Date.now() });
  });

  socket.on('chat:emote', (payload = {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return;
    const me = playerByToken(room, socket.data.token);
    if (!me) return;
    const emoji = String(payload.emoji || '').slice(0, 8);
    if (!emoji) return;
    io.to(room.code).emit('chat:emote', { name: me.name, role: me.role, emoji });
  });

  socket.on('room:leave', () => cleanupSocket(socket, true));
  socket.on('disconnect', () => cleanupSocket(socket, false));

  function cleanupSocket(socket, explicit) {
    const code = socket.data.roomCode;
    const token = socket.data.token;
    if (!code || !rooms.has(code)) return;
    const room = rooms.get(code);
    const me = playerByToken(room, token);
    if (!me) return;

    me.connected = false;
    socket.leave(code);
    socket.to(code).emit('room:opponent-disconnected', { players: roomPublicPlayers(room) });

    const finalize = () => {
      const stillConnected = Object.values(room.players).some((p) => p.connected);
      if (!stillConnected) rooms.delete(code);
    };

    if (explicit) {
      delete room.players[token];
      finalize();
    } else {
      room.disconnectTimers[token] = setTimeout(() => {
        if (room.players[token] && !room.players[token].connected) {
          delete room.players[token];
        }
        finalize();
      }, RECONNECT_GRACE_MS);
    }
  }
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.lastActivity > ROOM_TTL_MS) rooms.delete(code);
  }
}, 60 * 1000);

server.listen(PORT, () => {
  console.log(`숫자야구 서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});
