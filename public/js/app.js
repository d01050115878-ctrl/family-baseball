/* =========================================================
   우리 가족 숫자야구 - 프론트엔드 앱 로직
   ========================================================= */
(function () {
  'use strict';

  const R = window.BaseballRules;
  const AI = window.BaseballAI;

  const $ = (sel, el) => (el || document).querySelector(sel);
  const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

  const AVATARS = ['🙂', '🐯', '🐰', '🐻', '🦊', '🐼', '🐵', '🦁', '🐶', '🐱', '🐸', '🐷', '🦄', '👧', '👦', '🧔', '👩', '👨', '👵', '👴', '🐔'];
  const QUICK_MSGS = ['안녕하세요! 👋', '잘 부탁드려요 🙏', '오, 아깝다! 😲', '거의 다 왔어요! 🔥', '한 번 더 생각해볼게요 🤔', '축하해요! 🎉', '재밌어요! 😄', '한 판 더 해요!'];
  const EMOTES = ['👍', '😄', '😮', '🔥', '🤔', '🎉', '😭', '💪'];

  const state = {
    mode: null,
    aiLevel: 2,
    len: 3,                   // 이번 대결에서 사용할 자릿수 (모드/난이도에 따라 결정)
    mySecret: null,
    oppSecret: null,        // ai 모드에서만 클라이언트가 알고 있음(채점용)
    history: [],             // {actor, guess, strikes, balls, out}
    turn: null,               // 'me' | 'ai' | 'p1' | 'p2'
    status: 'idle',           // idle | setup | pass | playing | ended
    winner: null,
    players: {
      me: { name: '나', avatar: '🙂' },
      opp: { name: '상대', avatar: '🙂' },
      p1: { name: '1번 플레이어', avatar: '🐯' },
      p2: { name: '2번 플레이어', avatar: '🐰' },
    },
    settings: { sound: true },
    profile: { name: '', avatar: '🙂' },
    online: { code: null, token: null, myRole: null, connected: false },
    localNextPhase: null,     // 로컬 모드에서 pass-box 이후 이어질 단계
    aiThinking: false,
  };

  /* ---------------- 유틸 ---------------- */
  function showScreen(id) {
    $$('.screen').forEach((s) => s.classList.remove('active'));
    $('#' + id).classList.add('active');
  }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
  }

  function showModal({ emoji, title, text, actions }) {
    $('#modalEmoji').textContent = emoji || '🎉';
    $('#modalTitle').textContent = title || '';
    $('#modalText').textContent = text || '';
    const wrap = $('#modalActions');
    wrap.innerHTML = '';
    (actions || []).forEach((a) => {
      const btn = document.createElement('button');
      btn.className = a.cls || 'ghost';
      btn.textContent = a.label;
      btn.onclick = () => { hideModal(); a.onClick && a.onClick(); };
      wrap.appendChild(btn);
    });
    $('#modalBack').classList.remove('hidden');
  }
  function hideModal() { $('#modalBack').classList.add('hidden'); }

  let audioCtx = null;
  function beep(freq, dur, type) {
    if (!state.settings.sound) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = type || 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + dur);
    } catch (e) { /* 무시 */ }
  }
  const sndStrike = () => beep(520, 0.12, 'sine');
  const sndHomerun = () => { beep(660, 0.16, 'triangle'); setTimeout(() => beep(880, 0.22, 'triangle'), 140); setTimeout(() => beep(1046, 0.28, 'triangle'), 280); };
  const sndOut = () => beep(200, 0.15, 'square');

  /* ---------------- 프로필 ---------------- */
  function loadProfile() {
    try {
      const raw = localStorage.getItem('baseball_profile');
      if (raw) Object.assign(state.profile, JSON.parse(raw));
    } catch (e) { /* 무시 */ }
    $('#playerName').value = state.profile.name || '';
    $('#myAvatar').textContent = state.profile.avatar || '🙂';
  }
  function saveProfile() {
    state.profile.name = $('#playerName').value.trim();
    localStorage.setItem('baseball_profile', JSON.stringify(state.profile));
  }
  function buildAvatarPicker(container, onPick) {
    container.innerHTML = '';
    AVATARS.forEach((a) => {
      const b = document.createElement('button');
      b.textContent = a;
      b.onclick = () => { onPick(a); container.classList.add('hidden'); };
      container.appendChild(b);
    });
  }

  $$('[data-go]').forEach((btn) => btn.addEventListener('click', () => showScreen(btn.dataset.go)));
  $('#myAvatarBtn').addEventListener('click', () => {
    const p = $('#avatarPicker');
    p.classList.toggle('hidden');
    buildAvatarPicker(p, (a) => { state.profile.avatar = a; $('#myAvatar').textContent = a; saveProfile(); });
  });
  $('#playerName').addEventListener('change', saveProfile);
  $('#playerName').addEventListener('blur', saveProfile);
  $('#optSound').addEventListener('change', (e) => state.settings.sound = e.target.checked);

  /* ---------------- 숫자 입력 검증 ---------------- */
  function wireDigitInput(inputEl, hintEl, onValidChange) {
    function check() {
      const v = inputEl.value.replace(/\D/g, '').slice(0, state.len);
      if (v !== inputEl.value) inputEl.value = v;
      inputEl.classList.remove('valid', 'invalid');
      if (!v) { hintEl.textContent = ''; hintEl.className = 'digit-hint'; onValidChange && onValidChange(false); return; }
      if (v.length < state.len) {
        hintEl.textContent = `${state.len}자리를 입력해주세요 (${v.length}/${state.len})`;
        hintEl.className = 'digit-hint';
        onValidChange && onValidChange(false);
        return;
      }
      if (!R.isValidNumber(v, state.len)) {
        inputEl.classList.add('invalid');
        hintEl.textContent = '서로 다른 숫자로만 만들어주세요 (중복 불가)';
        hintEl.className = 'digit-hint bad';
        onValidChange && onValidChange(false);
        return;
      }
      inputEl.classList.add('valid');
      hintEl.textContent = '좋아요! 사용할 수 있는 번호예요';
      hintEl.className = 'digit-hint ok';
      onValidChange && onValidChange(true);
    }
    inputEl.addEventListener('input', check);
    return check;
  }

  /* ---------------- AI 화면 ---------------- */
  $$('#levelGrid .level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#levelGrid .level-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.aiLevel = Number(btn.dataset.level);
    });
  });
  $('#startAi').addEventListener('click', () => {
    saveProfile();
    state.players.me = { name: state.profile.name || '나', avatar: state.profile.avatar || '🙂' };
    state.players.opp = { name: '컴퓨터', avatar: '🤖' };
    state.len = AI.LEN_BY_LEVEL[state.aiLevel] || R.LEN;
    startGame('ai');
  });

  /* ---------------- 로컬 2인 화면 ---------------- */
  let localAvatars = { p1: '🐯', p2: '🐰' };
  $('#p1AvatarBtn').addEventListener('click', () => {
    const p = $('#avatarPicker'); p.classList.remove('hidden');
    buildAvatarPicker(p, (a) => { localAvatars.p1 = a; $('#p1Avatar').textContent = a; });
  });
  $('#p2AvatarBtn').addEventListener('click', () => {
    const p = $('#avatarPicker'); p.classList.remove('hidden');
    buildAvatarPicker(p, (a) => { localAvatars.p2 = a; $('#p2Avatar').textContent = a; });
  });
  $('#startLocal').addEventListener('click', () => {
    state.players.p1 = { name: $('#localP1Name').value.trim() || '1번 플레이어', avatar: localAvatars.p1 };
    state.players.p2 = { name: $('#localP2Name').value.trim() || '2번 플레이어', avatar: localAvatars.p2 };
    state.len = R.LEN;
    startGame('local');
  });

  /* ---------------- 온라인 화면 ---------------- */
  let socket = null;
  function ensureSocket() {
    if (socket) return socket;
    socket = io();
    wireSocketEvents();
    return socket;
  }

  let onlineCreateLen = 3;
  $$('#lenGridOnline .level-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('#lenGridOnline .level-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      onlineCreateLen = Number(btn.dataset.len);
    });
  });

  $('#createRoom').addEventListener('click', () => {
    saveProfile();
    ensureSocket();
    $('#netStatus').textContent = '';
    socket.emit('room:create', { name: state.profile.name || '플레이어', avatar: state.profile.avatar || '🙂', len: onlineCreateLen }, (res) => {
      if (!res.ok) { $('#netStatus').textContent = res.message; return; }
      state.online.code = res.code;
      state.online.token = res.token;
      state.online.myRole = res.role;
      state.len = res.len;
      sessionStorage.setItem('baseball_room', JSON.stringify({ code: res.code, token: res.token }));
      $('#roomCode').textContent = res.code;
      $('#waitingBox').classList.remove('hidden');
    });
  });

  $('#joinRoom').addEventListener('click', () => {
    saveProfile();
    ensureSocket();
    const code = $('#joinCode').value.trim().toUpperCase();
    if (code.length < 4) { $('#netStatus').textContent = '초대 코드를 확인해주세요.'; return; }
    $('#netStatus').textContent = '';
    socket.emit('room:join', { code, name: state.profile.name || '플레이어', avatar: state.profile.avatar || '🙂' }, (res) => {
      if (!res.ok) { $('#netStatus').textContent = res.message; return; }
      state.online.code = res.code;
      state.online.token = res.token;
      state.online.myRole = res.role;
      state.len = res.len;
      sessionStorage.setItem('baseball_room', JSON.stringify({ code: res.code, token: res.token }));
      startGame('online', true);
    });
  });

  function inviteUrl() { return `${location.origin}/?code=${state.online.code}`; }
  function inviteText() { return `⚾ 숫자야구 한 판 하실래요? 초대 코드: ${state.online.code}\n${inviteUrl()}`; }
  function copyText(text, successMsg) {
    const done = () => toast(successMsg);
    const fail = () => window.prompt('아래 내용을 직접 복사해주세요', text);
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fail);
    else fail();
  }
  $('#shareInvite').addEventListener('click', () => {
    if (navigator.share) {
      navigator.share({ title: '우리 가족 숫자야구', text: `⚾ 숫자야구 한 판 하실래요? 초대 코드: ${state.online.code}`, url: inviteUrl() })
        .catch(() => { /* 취소 등 무시 */ });
    } else {
      copyText(inviteText(), '초대 메시지를 복사했어요! 카톡이나 문자에 붙여넣어 보내주세요');
    }
  });
  $('#copyCode').addEventListener('click', () => copyText(state.online.code || '', '코드를 복사했어요!'));
  $('#copyLink').addEventListener('click', () => copyText(inviteUrl(), '초대 링크를 복사했어요!'));
  $('#cancelRoom').addEventListener('click', () => {
    socket && socket.emit('room:leave');
    sessionStorage.removeItem('baseball_room');
    $('#waitingBox').classList.add('hidden');
    state.online = { code: null, token: null, myRole: null, connected: false };
  });

  function wireSocketEvents() {
    socket.on('connect', () => {
      state.online.connected = true;
      // 재접속 시(백그라운드 전환, 네트워크 끊김 등) 서버 쪽 소켓 연결이 새로 맺어지면서
      // 이전에 들어가 있던 방에서 자동으로 빠지므로, 저장해둔 코드/토큰으로 다시 합류를 시도한다.
      // (이걸 안 하면 방장이 대기 중 연결이 끊겼다 붙었을 때 상대가 들어와도 그 신호를 영영 못 받는다)
      if (state.online.code && state.online.token) {
        socket.emit('room:rejoin', { code: state.online.code, token: state.online.token }, (res) => {
          if (!res || !res.ok) return;
          state.online.myRole = res.role;
          state.len = res.len;
          const meP = res.players.find((p) => p.token === res.token);
          const oppP = res.players.find((p) => p.token !== res.token);
          state.players.me = meP ? { name: meP.name, avatar: meP.avatar } : state.players.me;
          state.players.opp = oppP ? { name: oppP.name, avatar: oppP.avatar } : state.players.opp;

          if (res.status === 'playing' || res.status === 'ended') {
            state.mode = 'online';
            state.history = (res.history || []).map((h) => ({
              actor: h.by === res.token ? 'me' : 'opp', guess: h.guess, strikes: h.strikes, balls: h.balls, out: h.out,
            }));
            state.turn = res.turn === res.token ? 'me' : 'opp';
            state.status = res.status;
            state.winner = res.winner ? (res.winner === res.token ? 'me' : 'opp') : null;
            if ($('#screen-game').classList.contains('active')) {
              $('#setupBox').classList.add('hidden');
              $('#playBox').classList.remove('hidden');
              renderLogsFor('me', 'opp');
              updateTurnUI();
              if (state.status === 'ended') onGameEnd(true);
            }
          }
        });
      }
    });
    socket.on('disconnect', () => { state.online.connected = false; });

    socket.on('game:setup', (payload) => {
      const opp = payload.players.find((p) => p.token !== state.online.token);
      const me = payload.players.find((p) => p.token === state.online.token);
      if (me) state.players.me = { name: me.name, avatar: me.avatar };
      if (opp) state.players.opp = { name: opp.name, avatar: opp.avatar };
      if (state.mode !== 'online' || !$('#screen-game').classList.contains('active')) {
        startGame('online', true);
      } else {
        updatePlayerBars();
      }
    });

    socket.on('game:start', (payload) => {
      state.turn = payload.turn === state.online.token ? 'me' : 'opp';
      state.history = [];
      state.status = 'playing';
      $('#setupBox').classList.add('hidden');
      $('#playBox').classList.remove('hidden');
      updatePlayerBars();
      renderLogsFor('me', 'opp');
      updateTurnUI();
      toast('상대방과 연결됐어요! 대결 시작 🎉');
    });

    socket.on('game:guess-result', (payload) => {
      const actor = payload.entry.by === state.online.token ? 'me' : 'opp';
      state.history.push({ actor, guess: payload.entry.guess, strikes: payload.entry.strikes, balls: payload.entry.balls, out: payload.entry.out });
      appendLogEntry(state.history.length - 1, 'me', 'opp');
      playResultSound(payload.entry);
      if (payload.status === 'ended') {
        state.status = 'ended';
        state.winner = payload.winner === state.online.token ? 'me' : 'opp';
        onGameEnd();
      } else {
        state.turn = payload.turn === state.online.token ? 'me' : 'opp';
        updateTurnUI();
      }
    });

    socket.on('game:resigned', (payload) => {
      state.status = 'ended';
      state.winner = payload.winner === state.online.token ? 'me' : 'opp';
      onGameEnd(true);
    });

    socket.on('game:rematch-requested', () => toast('상대방이 재대결을 요청했어요. 재대결 버튼을 눌러주세요!'));
    socket.on('game:rematch-start', () => {
      state.history = [];
      state.mySecret = null;
      state.status = 'setup';
      state.winner = null;
      hideModal();
      resetGameScreenUI();
      $('#playBox').classList.add('hidden');
      $('#setupBox').classList.remove('hidden');
      $('#secretInput').value = '';
      $('#secretHint').textContent = '';
      $('#confirmSecretBtn').disabled = true;
      $('#setupWaiting').classList.add('hidden');
      toast('재대결! 번호를 다시 정해주세요');
    });

    socket.on('room:opponent-disconnected', () => toast('상대방의 연결이 끊겼어요. 잠시 기다려볼게요...'));
    socket.on('room:opponent-reconnected', () => toast('상대방이 다시 연결됐어요!'));

    socket.on('chat:message', (payload) => addChatMessage(payload.name, payload.text, payload.role === state.online.myRole));
    socket.on('chat:emote', (payload) => { flyEmote(payload.emoji); addChatMessage(payload.name, payload.emoji, payload.role === state.online.myRole, true); });
  }

  (function handleInviteLink() {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    if (code) { showScreen('screen-online'); $('#joinCode').value = code.toUpperCase(); }
  })();

  /* ---------------- 게임 시작 ---------------- */
  function startGame(mode, skipReset) {
    state.mode = mode;
    if (!skipReset) {
      state.history = [];
      state.mySecret = null;
      state.oppSecret = null;
      state.status = 'setup';
      state.winner = null;
      state.turn = null;
    }
    resetGameScreenUI();
    showScreen('screen-game');

    const chatEnabled = mode === 'online';
    $('#chatText').disabled = !chatEnabled;
    $('#chatSend').disabled = !chatEnabled;
    $('#chatText').placeholder = chatEnabled ? '메시지 보내기' : '온라인 대결에서만 대화할 수 있어요';
    $('#chatList').innerHTML = '';
    buildQuickMsgs();

    if (mode === 'ai') {
      state.oppSecret = R.randomSecret(state.len);
      showSetupBox('me');
    } else if (mode === 'local') {
      showSetupBox('p1');
    } else if (mode === 'online') {
      updatePlayerBars();
      if (!skipReset || state.status !== 'playing') {
        showSetupBox(state.mode === 'online' ? 'online' : 'me');
      }
    }
    updatePlayerBars();
  }

  function resetGameScreenUI() {
    $('#coachPop').classList.add('hidden');
    $('#emoteBar').classList.add('hidden');
    $('#moveLog').innerHTML = '';
    $('#myLog').innerHTML = '';
    $('#oppLog').innerHTML = '';
    $('#passBox').classList.add('hidden');
    $('#playBox').classList.add('hidden');
    $('#setupBox').classList.remove('hidden');
    $('#secretInput').value = '';
    $('#secretHint').textContent = ''; $('#secretHint').className = 'digit-hint';
    $('#guessInput').value = '';
    $('#guessHint').textContent = ''; $('#guessHint').className = 'digit-hint';
    $('#btnChat').classList.toggle('hidden', state.mode !== 'online');
    applyDigitLength();
  }

  function applyDigitLength() {
    const example = '19274635801'.slice(0, state.len);
    [$('#secretInput'), $('#guessInput')].forEach((el) => {
      el.maxLength = state.len;
      el.placeholder = `예: ${example}`;
      el.classList.remove('len-3', 'len-4', 'len-5', 'len-6');
      el.classList.add('len-' + state.len);
    });
    $('#setupDesc').textContent = `서로 다른 숫자 ${state.len}개를 정해주세요 (0~9). 상대에게 안 보이게 해주세요!`;
  }

  function buildQuickMsgs() {
    const wrap = $('#quickMsgs');
    wrap.innerHTML = '';
    QUICK_MSGS.forEach((m) => {
      const b = document.createElement('button');
      b.textContent = m;
      b.onclick = () => sendChat(m);
      wrap.appendChild(b);
    });
  }

  /* ---------------- 번호 설정 단계 ---------------- */
  const secretCheck = wireDigitInput($('#secretInput'), $('#secretHint'), (valid) => {
    $('#confirmSecretBtn').disabled = !valid;
  });
  $('#confirmSecretBtn').disabled = true;

  function showSetupBox(who) {
    state.status = 'setup';
    $('#setupBox').classList.remove('hidden');
    $('#passBox').classList.add('hidden');
    $('#playBox').classList.add('hidden');
    $('#secretInput').value = '';
    $('#secretHint').textContent = ''; $('#secretHint').className = 'digit-hint';
    $('#confirmSecretBtn').disabled = true;
    $('#setupWaiting').classList.add('hidden');
    state.localNextPhase = who;
    $('#turnBar').textContent = '번호를 정해주세요';

    if (who === 'p1') {
      $('.setup-box .sec').textContent = `🔒 ${state.players.p1.name}의 비밀번호`;
    } else if (who === 'p2') {
      $('.setup-box .sec').textContent = `🔒 ${state.players.p2.name}의 비밀번호`;
    } else {
      $('.setup-box .sec').textContent = '🔒 내 비밀번호 정하기';
    }
  }

  $('#randomSecretBtn').addEventListener('click', () => {
    $('#secretInput').value = R.randomSecret(state.len);
    secretCheck();
  });

  $('#confirmSecretBtn').addEventListener('click', () => {
    const v = $('#secretInput').value;
    if (!R.isValidNumber(v, state.len)) return;

    if (state.mode === 'ai') {
      state.mySecret = v;
      state.turn = Math.random() < 0.5 ? 'me' : 'ai';
      state.status = 'playing';
      $('#setupBox').classList.add('hidden');
      $('#playBox').classList.remove('hidden');
      renderLogsFor('me', 'ai');
      updateTurnUI();
      if (state.turn === 'ai') scheduleAiGuess();
    } else if (state.mode === 'local') {
      if (state.localNextPhase === 'p1') {
        state.p1Secret = v;
        showPassBox('p2', `${state.players.p2.name}, 준비되면 눌러주세요.`);
      } else if (state.localNextPhase === 'p2') {
        state.p2Secret = v;
        showPassBox('play', '이제 대결을 시작해요!');
      }
    } else if (state.mode === 'online') {
      state.mySecret = v;
      $('#setupWaiting').classList.remove('hidden');
      $('#secretInput').disabled = true;
      $('#confirmSecretBtn').disabled = true;
      $('#randomSecretBtn').disabled = true;
      socket.emit('game:set-secret', { secret: v });
    }
  });

  function showPassBox(nextPhase, desc) {
    $('#setupBox').classList.add('hidden');
    $('#playBox').classList.add('hidden');
    $('#passBox').classList.remove('hidden');
    $('#passDesc').textContent = desc;
    $('#passTitle').textContent = nextPhase === 'play' ? '준비 완료!' : '화면을 넘겨주세요';
    state.localNextPhase = nextPhase;
  }

  $('#passContinue').addEventListener('click', () => {
    if (state.localNextPhase === 'p2') {
      showSetupBox('p2');
    } else if (state.localNextPhase === 'play') {
      state.turn = Math.random() < 0.5 ? 'p1' : 'p2';
      state.status = 'playing';
      $('#passBox').classList.add('hidden');
      $('#playBox').classList.remove('hidden');
      const meId = state.turn, oppId = state.turn === 'p1' ? 'p2' : 'p1';
      renderLogsFor(meId, oppId);
      updateTurnUI();
    }
  });

  /* ---------------- 추리 제출 ---------------- */
  const guessCheck = wireDigitInput($('#guessInput'), $('#guessHint'), (valid) => {
    $('#submitGuess').disabled = !valid;
  });
  $('#submitGuess').disabled = true;

  $('#guessInput').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !$('#submitGuess').disabled) submitGuess(); });
  $('#submitGuess').addEventListener('click', submitGuess);

  function submitGuess() {
    const v = $('#guessInput').value;
    if (!R.isValidNumber(v, state.len)) return;
    if (state.status !== 'playing') return;

    if (state.mode === 'ai') {
      if (state.turn !== 'me' || state.aiThinking) return;
      applyGuess('me', v, state.oppSecret);
      $('#guessInput').value = ''; guessCheck();
      if (state.status === 'playing' && state.turn === 'ai') scheduleAiGuess();
    } else if (state.mode === 'local') {
      const myId = state.turn;
      const oppSecret = myId === 'p1' ? state.p2Secret : state.p1Secret;
      applyGuess(myId, v, oppSecret);
      $('#guessInput').value = ''; guessCheck();
      if (state.status === 'playing') {
        const nextId = myId === 'p1' ? 'p2' : 'p1';
        showPassBox('resume-' + nextId, `${state.players[nextId].name}, 준비되면 눌러주세요.`);
        $('#passTitle').textContent = '화면을 넘겨주세요';
      }
    } else if (state.mode === 'online') {
      if (state.turn !== 'me') return;
      socket.emit('game:guess', { guess: v });
      $('#guessInput').value = ''; guessCheck();
    }
  }

  // 로컬 모드 전용: pass-box의 '계속하기'가 resume-p1 / resume-p2 도 처리하도록 확장
  $('#passContinue').addEventListener('click', () => {
    if (state.localNextPhase && state.localNextPhase.startsWith('resume-')) {
      const nextId = state.localNextPhase.replace('resume-', '');
      state.turn = nextId;
      $('#passBox').classList.add('hidden');
      $('#playBox').classList.remove('hidden');
      const oppId = nextId === 'p1' ? 'p2' : 'p1';
      renderLogsFor(nextId, oppId);
      updateTurnUI();
    }
  });

  function applyGuess(actor, guess, secretToGradeAgainst) {
    const g = R.grade(secretToGradeAgainst, guess);
    state.history.push({ actor, guess, strikes: g.strikes, balls: g.balls, out: g.out });

    let meId, oppId;
    if (state.mode === 'local') {
      meId = actor; oppId = actor === 'p1' ? 'p2' : 'p1';
    } else if (state.mode === 'ai') {
      meId = 'me'; oppId = 'ai';
    } else {
      meId = 'me'; oppId = 'opp';
    }
    appendLogEntry(state.history.length - 1, meId, oppId);
    playResultSound(g);

    if (R.isHomerun(g.strikes, state.len)) {
      state.status = 'ended';
      state.winner = actor;
      onGameEnd();
      return;
    }
    if (state.mode === 'ai') {
      state.turn = actor === 'me' ? 'ai' : 'me';
    } else if (state.mode === 'local') {
      state.turn = actor === 'p1' ? 'p2' : 'p1';
    }
    updateTurnUI();
  }

  function scheduleAiGuess() {
    state.aiThinking = true;
    updateTurnUI();
    setTimeout(() => {
      if (state.status !== 'playing') { state.aiThinking = false; return; }
      const aiHistory = state.history.filter((h) => h.actor === 'ai').map((h) => ({ guess: h.guess, strikes: h.strikes, balls: h.balls, out: h.out }));
      const guess = AI.pickGuess(aiHistory, state.aiLevel, state.len);
      state.aiThinking = false;
      applyGuess('ai', guess, state.mySecret);
    }, 500 + Math.random() * 500);
  }

  /* ---------------- 로그 렌더링 ---------------- */
  function badgeFor(entry) {
    if (entry.strikes === state.len) return { cls: 'homerun', text: `${entry.strikes}S 홈런! 🎉` };
    if (entry.out) return { cls: 'out', text: '0S 0B (아웃)' };
    return { cls: 'hit', text: `${entry.strikes}S ${entry.balls}B` };
  }

  function renderLogsFor(meId, oppId) {
    $('#myLog').innerHTML = '';
    $('#oppLog').innerHTML = '';
    $('#moveLog').innerHTML = '';
    state.history.forEach((h, i) => appendLogEntry(i, meId, oppId));
    updateLogHeadings(meId, oppId);
  }

  function updateLogHeadings(meId, oppId) {
    const name = (id) => {
      if (id === 'me') return state.players.me.name;
      if (id === 'ai') return state.players.opp.name;
      if (id === 'opp') return state.players.opp.name;
      return state.players[id]?.name || id;
    };
    $('.log-col:nth-child(1) .log-head').textContent = `📝 ${name(meId)}의 추리`;
    $('.log-col:nth-child(2) .log-head').textContent = `🔍 ${name(oppId)}의 추리`;
  }

  function appendLogEntry(idx, meId, oppId) {
    const h = state.history[idx];
    if (!h) return;
    const badge = badgeFor(h);
    const li = document.createElement('li');
    li.innerHTML = `<span class="lg-num">${h.guess}</span><span class="lg-badge ${badge.cls}">${badge.text}</span>`;

    if (h.actor === meId) $('#myLog').appendChild(li);
    else if (h.actor === oppId) $('#oppLog').appendChild(li);

    const who = h.actor === meId ? (state.mode === 'local' ? state.players[meId]?.name : '나')
      : (h.actor === oppId ? (state.mode === 'local' ? state.players[oppId]?.name : state.players.opp.name) : h.actor);
    const full = document.createElement('li');
    full.textContent = `${idx + 1}. ${who}: ${h.guess} → ${badge.text}`;
    $('#moveLog').appendChild(full);
    $('#moveLog').scrollTop = $('#moveLog').scrollHeight;
    $('#myLog').scrollTop = $('#myLog').scrollHeight;
    $('#oppLog').scrollTop = $('#oppLog').scrollHeight;
  }

  function playResultSound(entry) {
    if (entry.strikes === state.len) sndHomerun();
    else if (entry.out) sndOut();
    else sndStrike();
  }

  /* ---------------- 화면 갱신 ---------------- */
  function updatePlayerBars() {
    let bottomP, topP;
    if (state.mode === 'local') {
      const meId = state.turn || 'p1';
      const oppId = meId === 'p1' ? 'p2' : 'p1';
      bottomP = state.players[meId]; topP = state.players[oppId];
    } else if (state.mode === 'online') {
      bottomP = state.players.me; topP = state.players.opp;
    } else {
      bottomP = state.players.me; topP = state.players.opp;
    }
    $('#avatarBottom').textContent = bottomP.avatar;
    $('#barBottom .pname').textContent = bottomP.name;
    $('#avatarTop').textContent = topP.avatar;
    $('#barTop .pname').textContent = topP.name;

    const counts = {};
    state.history.forEach((h) => { counts[h.actor] = (counts[h.actor] || 0) + 1; });
    const meId = state.mode === 'local' ? (state.turn || 'p1') : (state.mode === 'ai' ? 'me' : 'me');
    const oppId = state.mode === 'local' ? (meId === 'p1' ? 'p2' : 'p1') : (state.mode === 'ai' ? 'ai' : 'opp');
    $('#inningTagBottom').textContent = `${counts[meId] || 0}회`;
    $('#inningTagTop').textContent = `${counts[oppId] || 0}회`;
  }

  function updateTurnUI() {
    updatePlayerBars();
    if (state.status !== 'playing') return;

    if (state.mode === 'local') {
      // 로컬 모드는 화면을 보고 있는 사람이 항상 지금 차례인 사람
      $('#barBottom').classList.add('turn');
      $('#barTop').classList.remove('turn');
      $('#turnBar').textContent = `${state.players[state.turn].name} 차례예요 — 상대 번호를 추리해보세요!`;
      $('#guessInput').disabled = false;
      $('#submitGuess').disabled = false;
      guessCheck();
      return;
    }

    const myTurnNow = state.turn === 'me';
    $('#barBottom').classList.toggle('turn', myTurnNow);
    $('#barTop').classList.toggle('turn', !myTurnNow);

    if (myTurnNow) {
      $('#turnBar').textContent = '내 차례예요 — 상대 번호를 추리해보세요!';
      $('#guessInput').disabled = false;
      guessCheck();
    } else {
      const oppName = state.players.opp.name;
      if (state.mode === 'ai') {
        $('#turnBar').textContent = state.aiThinking ? `🤖 ${oppName}가 추리하는 중...` : `🤖 ${oppName} 차례예요`;
      } else {
        $('#turnBar').textContent = `⏳ ${oppName} 차례예요`;
      }
      $('#guessInput').disabled = true; $('#submitGuess').disabled = true;
    }
  }

  /* ---------------- 힌트 ---------------- */
  $('#btnHint').addEventListener('click', () => {
    if (state.status !== 'playing') return;
    let myId;
    if (state.mode === 'ai') {
      if (state.turn !== 'me') { toast('내 차례일 때만 힌트를 볼 수 있어요'); return; }
      myId = 'me';
    } else if (state.mode === 'local') {
      myId = state.turn;
    } else {
      if (state.turn !== 'me') { toast('내 차례일 때만 힌트를 볼 수 있어요'); return; }
      myId = 'me';
    }
    const myHist = state.history.filter((h) => h.actor === myId).map((h) => ({ guess: h.guess, strikes: h.strikes, balls: h.balls, out: h.out }));
    const suggestion = AI.pickGuess(myHist, 5, state.len);
    $('#guessInput').value = suggestion;
    guessCheck();
    const el = $('#coachPop');
    el.textContent = `💡 이런 숫자는 어때요? ${suggestion}`;
    el.classList.remove('hidden');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.add('hidden'), 2200);
  });

  /* ---------------- 기권 / 나가기 ---------------- */
  $('#btnResign').addEventListener('click', () => {
    if (state.status !== 'playing') return;
    showModal({
      emoji: '🏳️', title: '기권할까요?', text: '지금 기권하면 상대방이 승리해요.',
      actions: [
        { label: '아니요', cls: 'ghost' },
        {
          label: '네, 기권할게요', cls: 'primary', onClick: () => {
            if (state.mode === 'online') { socket.emit('game:resign'); return; }
            state.status = 'ended';
            if (state.mode === 'ai') state.winner = 'ai';
            else state.winner = state.turn === 'p1' ? 'p2' : 'p1';
            onGameEnd();
          },
        },
      ],
    });
  });

  $('#btnHome').addEventListener('click', () => {
    showModal({
      emoji: '🏠', title: '나가시겠어요?', text: '진행 중인 대결에서 나가요.',
      actions: [
        { label: '취소', cls: 'ghost' },
        { label: '나가기', cls: 'primary', onClick: goHome },
      ],
    });
  });

  function goHome() {
    if (state.mode === 'online' && socket) {
      socket.emit('room:leave');
      sessionStorage.removeItem('baseball_room');
    }
    state.mode = null;
    state.online = { code: null, token: null, myRole: null, connected: false };
    hideModal();
    $('#waitingBox').classList.add('hidden');
    showScreen('screen-home');
  }

  /* ---------------- 게임 종료 ---------------- */
  function onGameEnd(skipSound) {
    if (!skipSound) { /* 사운드는 마지막 추리에서 이미 재생됨 */ }
    let title, text, emoji;
    if (state.winner === 'draw') {
      emoji = '🤝'; title = '무승부!'; text = '아무도 못 맞혔어요. 다음엔 꼭 홈런 쳐봐요!';
    } else {
      const winnerName = winnerDisplayName();
      emoji = '🎉'; title = `${winnerName} 승리!`;
      if (state.mode === 'local') {
        text = `${state.players.p1.name}: ${state.p1Secret}  /  ${state.players.p2.name}: ${state.p2Secret}`;
      } else if (state.mode === 'ai') {
        text = `내 번호: ${state.mySecret}  /  컴퓨터 번호: ${state.oppSecret}`;
      } else {
        text = state.mySecret ? `내 번호는 ${state.mySecret}였어요!` : '';
      }
    }
    $('#turnBar').textContent = title;
    $('#guessInput').disabled = true; $('#submitGuess').disabled = true;

    const actions = [{ label: '🏠 처음으로', cls: 'ghost', onClick: goHome }];
    if (state.mode === 'online') {
      actions.unshift({ label: '🔁 재대결', cls: 'primary', onClick: () => { socket.emit('game:rematch-request'); toast('재대결을 요청했어요. 상대방을 기다리는 중...'); } });
    } else {
      actions.unshift({ label: '🔁 다시하기', cls: 'primary', onClick: () => startGame(state.mode) });
    }
    showModal({ emoji, title, text, actions });
  }

  function winnerDisplayName() {
    if (state.mode === 'local') return state.players[state.winner]?.name || state.winner;
    if (state.winner === 'me') return state.players.me.name;
    if (state.winner === 'ai') return state.players.opp.name;
    if (state.winner === 'opp') return state.players.opp.name;
    return state.winner;
  }

  /* ---------------- 기보/채팅 탭 ---------------- */
  $$('.panel-tabs .tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.panel-tabs .tab').forEach((t) => t.classList.remove('active'));
      $$('.tab-pane').forEach((p) => p.classList.remove('active'));
      tab.classList.add('active');
      $('#pane-' + tab.dataset.tab).classList.add('active');
    });
  });
  $('#btnChat').addEventListener('click', () => {
    $$('.panel-tabs .tab')[1].click();
    $('#sidePanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  function sendChat(text) {
    if (!text || state.mode !== 'online') return;
    socket.emit('chat:message', { text });
    $('#chatText').value = '';
  }
  $('#chatSend').addEventListener('click', () => sendChat($('#chatText').value.trim()));
  $('#chatText').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendChat($('#chatText').value.trim()); });

  function addChatMessage(name, text, mine, isEmote) {
    const div = document.createElement('div');
    div.className = 'chat-msg';
    div.innerHTML = `<b>${mine ? '나' : name}</b> ${isEmote ? '' : ':'} ${text}`;
    $('#chatList').appendChild(div);
    $('#chatList').scrollTop = $('#chatList').scrollHeight;
  }

  $('#btnEmote').addEventListener('click', () => {
    const bar = $('#emoteBar');
    if (bar.classList.contains('hidden')) {
      bar.innerHTML = '';
      EMOTES.forEach((em) => {
        const b = document.createElement('button');
        b.textContent = em;
        b.onclick = () => {
          flyEmote(em);
          if (state.mode === 'online') socket.emit('chat:emote', { emoji: em });
          bar.classList.add('hidden');
        };
        bar.appendChild(b);
      });
      bar.classList.remove('hidden');
    } else {
      bar.classList.add('hidden');
    }
  });
  function flyEmote(emoji) {
    const layer = $('#emoteLayer');
    const s = document.createElement('div');
    s.className = 'emote-fly';
    s.textContent = emoji;
    layer.appendChild(s);
    setTimeout(() => s.remove(), 1450);
  }

  /* ---------------- 배우기 ---------------- */
  function buildLearnList() {
    const items = [
      { ico: '🔢', t: '서로 다른 숫자로', s: '0~9 중 겹치지 않는 숫자로 비밀번호를 정해요 (컴퓨터 대결은 난이도별로 3~5자리)' },
      { ico: '🎯', t: '스트라이크', s: '숫자와 자리가 둘 다 맞으면 스트라이크예요' },
      { ico: '⚪', t: '볼', s: '숫자는 맞는데 자리가 다르면 볼이에요' },
      { ico: '❌', t: '아웃', s: '하나도 안 맞으면 아웃이에요' },
      { ico: '🏆', t: '모두 스트라이크면 홈런', s: '자릿수만큼 전부 스트라이크가 나오면 그 자리에서 승리!' },
    ];
    const wrap = $('#learnList');
    wrap.innerHTML = '';
    items.forEach((it) => {
      const div = document.createElement('div');
      div.className = 'learn-item';
      div.innerHTML = `<span class="li-ico">${it.ico}</span><span class="li-text"><b>${it.t}</b><span>${it.s}</span></span>`;
      wrap.appendChild(div);
    });
  }

  function init() {
    loadProfile();
    buildLearnList();

    try {
      const saved = JSON.parse(sessionStorage.getItem('baseball_room') || 'null');
      if (saved && saved.code && saved.token) {
        ensureSocket();
        socket.emit('room:rejoin', saved, (res) => {
          if (!res || !res.ok) { sessionStorage.removeItem('baseball_room'); return; }
          state.online.code = res.code;
          state.online.token = res.token;
          state.online.myRole = res.role;
          state.len = res.len;
          const meP = res.players.find((p) => p.token === res.token);
          const oppP = res.players.find((p) => p.token !== res.token);
          state.players.me = meP ? { name: meP.name, avatar: meP.avatar } : state.players.me;
          state.players.opp = oppP ? { name: oppP.name, avatar: oppP.avatar } : state.players.opp;

          if (res.status === 'playing' || res.status === 'ended') {
            state.mode = 'online';
            state.history = (res.history || []).map((h) => ({
              actor: h.by === res.token ? 'me' : 'opp', guess: h.guess, strikes: h.strikes, balls: h.balls, out: h.out,
            }));
            state.turn = res.turn === res.token ? 'me' : 'opp';
            state.status = res.status;
            state.winner = res.winner ? (res.winner === res.token ? 'me' : 'opp') : null;
            resetGameScreenUI();
            showScreen('screen-game');
            $('#setupBox').classList.add('hidden');
            $('#playBox').classList.remove('hidden');
            renderLogsFor('me', 'opp');
            updateTurnUI();
            if (state.status === 'ended') onGameEnd(true);
          } else {
            startGame('online', true);
          }
        });
      }
    } catch (e) { /* 무시 */ }
  }

  init();
})();
