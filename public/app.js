// ================= 상태 & 유틸 =================
const $view = document.getElementById('view');
const $tabbar = document.getElementById('tabbar');
const $phone = document.getElementById('phone');
const $sheetRoot = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');
const $badge = document.getElementById('badge');

const TYPE_LABEL = { gwa: '과팅', hak: '학팅' };
const AVATARS = ['🐰', '🦊', '🐱', '🐶', '🐻', '🐼', '🐯', '🦁', '🐧', '🐸', '🦖', '🐺', '🌷', '🍓', '⭐', '🍀'];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
const PUBLIC_ROUTES = /^#\/(login|signup)$/;

let token = localStorage.getItem('token');
let me = null;
let socket = null;
let unread = 0;
const ui = { month: {}, size: 0, selDate: null, meTab: 'feed' };
const current = { chatId: null, render: null }; // 실시간 이벤트가 화면을 갱신할 때 사용

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const prettyDate = s => { const d = new Date(s + 'T00:00'); return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DOW[d.getDay()]})`; };
const sizeLabel = n => `${n}:${n}`;
const inviteUrl = teamId => `${location.origin}/#/invite/${teamId}`;
const ago = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};

// 사진이 있으면 사진, 없으면 이모지
const av = u => u?.photo ? `<img src="${esc(u.photo)}" alt="" />` : esc(u?.avatar || '🙂');
const faces = members => members.map(m => `<span>${av(m)}</span>`).join('');

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !url.startsWith('/api/auth/login')) { logout(true); }
  if (!res.ok) throw new Error(data.error || '문제가 생겼어요');
  return data;
}

function toast(msg, onClick) {
  $toast.textContent = msg;
  $toast.hidden = false;
  $toast.onclick = onClick ? () => { $toast.hidden = true; onClick(); } : null;
  $toast.style.cursor = onClick ? 'pointer' : '';
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), onClick ? 3500 : 2200);
}

function openSheet(html, onMount) {
  $sheetRoot.innerHTML = `<div class="sheet-bg"></div><div class="sheet"><div class="grab"></div>${html}</div>`;
  const close = () => ($sheetRoot.innerHTML = '');
  $sheetRoot.querySelector('.sheet-bg').onclick = close;
  onMount && onMount($sheetRoot.querySelector('.sheet'), close);
  return close;
}
const closeSheet = () => ($sheetRoot.innerHTML = '');

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('링크를 복사했어요 📋'); }
  catch { prompt('아래 링크를 복사하세요', text); }
}
async function shareInvite(teamId, size) {
  const url = inviteUrl(teamId);
  if (navigator.share) {
    try { await navigator.share({ title: '땔래말래 팀 초대', text: `${sizeLabel(size)} 같이 나가자! 팀에 합류해줘 🙌`, url }); return; } catch { /* 취소 */ }
  }
  copyText(url);
}

// ----- 이미지 선택 & 리사이즈 -----
function pickImages(multiple = false) {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.onchange = () => resolve([...input.files]);
    input.click();
  });
}
async function resizeImage(file, max = 1080, square = false) {
  const img = await createImageBitmap(file);
  let sx = 0, sy = 0, sw = img.width, sh = img.height;
  if (square) { const s = Math.min(sw, sh); sx = (sw - s) / 2; sy = (sh - s) / 2; sw = sh = s; }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  canvas.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}
const uploadImage = async dataUrl => (await api('POST', '/api/uploads', { data: dataUrl })).url;

// ================= 실시간 (Socket.IO) =================
function connectSocket() {
  if (socket || !token) return;
  socket = io({ auth: { token } });
  socket.on('connect', () => { refreshUnread(); if (current.chatId) current.render?.(); });
  socket.on('connect_error', err => { if (err.message === 'unauthorized') logout(true); });

  socket.on('chat:message', ({ matchId, msg, from }) => {
    if (current.chatId === matchId) {
      current.onMessage?.(msg);
      socket.emit('chat:read', { matchId });
      return;
    }
    if (msg.userId !== me.id) {
      setUnread(unread + 1);
      toast(`💬 ${from?.nickname ? from.nickname + ': ' : ''}${msg.text}`, () => (location.hash = '#/chat/' + matchId));
      if (location.hash === '#/matches') current.render?.();
    }
  });

  socket.on('match:new', ({ match, takenBy }) => {
    refreshUnread();
    if (takenBy.id !== me.id) {
      const iAmHost = match.teamA.members.some(m => m.id === me.id);
      toast(iAmHost ? `🎉 ${takenBy.nickname}님 팀이 내 메모를 뗐어요!` : `🎉 ${prettyDate(match.date)} 매칭이 잡혔어요!`, () => (location.hash = '#/chat/' + match.id));
    }
    if (['#/matches', '#/me'].includes(location.hash)) current.render?.();
  });

  socket.on('team:update', ({ team, joined }) => {
    if (joined.id !== me.id) toast(`👯 ${joined.nickname}님이 팀에 합류했어요 (${team.members.length}/${team.size})`);
    if (location.hash === '#/me' || location.hash === '#/invite/' + team.id) current.render?.();
  });

  // 다른 사람이 메모를 붙이거나 떼면 캘린더에 바로 반영
  socket.on('posts:changed', async ev => {
    const hash = location.hash;
    const mine = ev.by === me.id;
    if (!mine && ev.gender && ev.gender !== me.gender && ev.action === 'created') {
      toast(`📌 ${prettyDate(ev.date)}에 ${ev.dept || ''} ${sizeLabel(ev.size)} 메모가 새로 붙었어요`, () => {
        ui.selDate = ev.date;
        location.hash = '#/' + ev.type;
      });
    }
    if (hash === '#/' + ev.type) {
      const st = $view.scrollTop;
      await renderCalendar(ev.type, true);
      $view.scrollTop = st;
    } else if (hash === `#/${ev.type}/day/${ev.date}` && !mine && ev.action === 'taken') {
      toast('누군가 이 날짜의 메모를 방금 떼갔어요 👀');
    }
  });

  socket.on('chat:typing', ({ matchId, user }) => {
    if (current.chatId === matchId) current.onTyping?.(user);
  });
}

function setUnread(n) {
  unread = Math.max(0, n);
  $badge.hidden = !unread;
  $badge.textContent = unread > 99 ? '99+' : unread;
}
async function refreshUnread() {
  try { setUnread((await api('GET', '/api/unread')).count); } catch { /* 무시 */ }
}

function logout(expired = false) {
  if (token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  token = null; me = null;
  localStorage.removeItem('token');
  socket?.disconnect(); socket = null;
  setUnread(0);
  if (expired) toast('다시 로그인해주세요');
  location.hash = '#/login';
}

function onAuthed(res) {
  token = res.token;
  me = res.user;
  localStorage.setItem('token', token);
  connectSocket();
  const pending = sessionStorage.getItem('pendingInvite');
  sessionStorage.removeItem('pendingInvite');
  location.hash = pending ? '#/invite/' + pending : '#/gwa';
}

// ================= 라우터 =================
const routes = [
  [/^#\/login$/, renderLogin],
  [/^#\/signup$/, renderSignup],
  [/^#\/(gwa|hak)$/, m => renderCalendar(m[1])],
  [/^#\/(gwa|hak)\/day\/(\d{4}-\d{2}-\d{2})$/, m => renderDeck(m[1], m[2])],
  [/^#\/invite\/(\w+)$/, m => renderInvite(m[1])],
  [/^#\/matches$/, renderMatches],
  [/^#\/chat\/(\w+)$/, m => renderChat(m[1])],
  [/^#\/me$/, () => renderProfile(me.id)],
  [/^#\/u\/(\w+)$/, m => (m[1] === me.id ? (location.hash = '#/me') : renderProfile(m[1]))],
  [/^#\/p\/(\w+)$/, m => renderFeedPost(m[1])],
  [/^#\/edit$/, renderEditProfile],
  [/^#\/new-post$/, renderNewPost],
];

async function router() {
  current.chatId = null; current.render = null; current.onMessage = null; current.onTyping = null;
  closeSheet();
  const hash = location.hash || '#/gwa';

  if (!me && token) {
    try { me = await api('GET', '/api/auth/me'); connectSocket(); } catch { /* api()가 로그아웃 처리 */ }
  }
  if (!me && !PUBLIC_ROUTES.test(hash)) {
    const inv = hash.match(/^#\/invite\/(\w+)$/);
    if (inv) sessionStorage.setItem('pendingInvite', inv[1]);
    location.hash = '#/login';
    return;
  }
  if (me && PUBLIC_ROUTES.test(hash)) { location.hash = '#/gwa'; return; }

  for (const [re, fn] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    const tab = hash.split('/')[1];
    const showTabs = ['gwa', 'hak', 'matches', 'me'].includes(tab) && !hash.includes('/day/');
    $tabbar.hidden = !showTabs;
    $phone.classList.toggle('theme-hak', tab === 'hak');
    $tabbar.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === tab));
    $view.scrollTop = 0;
    fn(m);
    return;
  }
  location.hash = '#/gwa';
}
window.addEventListener('hashchange', router);

const back = fallback => `<button class="back" onclick="history.length > 1 ? history.back() : location.hash='${fallback}'">‹</button>`;

// ================= 로그인 / 회원가입 =================
const DEMO_ACCOUNTS = [
  ['minji', '민지', '🐰', 'F'], ['sua', '수아', '🐻', 'F'], ['jiwoo', '지우', '🌷', 'F'],
  ['doyun', '도윤', '🐶', 'M'], ['siwoo', '시우', '🦁', 'M'], ['junho', '준호', '🐯', 'M'],
];
const FLOAT_MEMOS = ['오늘 저녁 3:3 🍻', '경영 × 컴공?', '금요일 1:1 ☕', '디자인과 2명!', '보드게임 좋아해요', '신촌에서 만나요'];

function authBackdrop() {
  return `<div class="auth-bg" aria-hidden="true">${FLOAT_MEMOS.map((t, i) => `<span class="float-memo fm${i}">${t}</span>`).join('')}</div>`;
}

function renderLogin() {
  const invited = sessionStorage.getItem('pendingInvite');
  $view.innerHTML = `
    <div class="auth">
      ${authBackdrop()}
      <div class="auth-hero">
        <div class="auth-logo">📝<i>💘</i></div>
        <h1>땔래말래</h1>
        <p>가능한 날짜에 메모를 붙이고<br/>끌리는 메모는 떼가세요</p>
      </div>
      <form class="auth-card" id="login" novalidate>
        ${invited ? `<div class="auth-notice">👯 팀 초대를 받았어요! 로그인하면 바로 합류할 수 있어요</div>` : ''}
        <label class="ifield"><span class="ic">👤</span>
          <input name="loginId" placeholder="아이디" autocomplete="username" autocapitalize="off" spellcheck="false" /></label>
        <label class="ifield"><span class="ic">🔒</span>
          <input name="password" type="password" placeholder="비밀번호" autocomplete="current-password" />
          <button type="button" class="eye" data-eye>보기</button></label>
        <p class="auth-error" id="login-error" hidden></p>
        <button class="btn primary block" id="login-btn">로그인</button>
        <div class="divider"><span>처음이신가요?</span></div>
        <a class="btn ghost block" href="#/signup">✨ 새 계정 만들기</a>
        <details class="demo">
          <summary>🎬 시연용 데모 계정으로 둘러보기</summary>
          <div class="demo-grid">${DEMO_ACCOUNTS.map(([id, name, emoji, g]) => `
            <button type="button" class="demo-acc ${g === 'F' ? 'f' : 'm'}" data-demo="${id}">
              <span>${emoji}</span><b>${name}</b><small>${g === 'F' ? '여' : '남'} · @${id}</small>
            </button>`).join('')}</div>
          <p class="small muted center" style="margin:8px 0 0">서로 다른 성별로 두 기기에서 로그인하면 실시간 매칭을 볼 수 있어요</p>
        </details>
      </form>
    </div>`;

  bindEyeToggles($view);
  const form = $view.querySelector('#login');
  const errEl = $view.querySelector('#login-error');
  const btn = $view.querySelector('#login-btn');

  const login = async (loginId, password) => {
    errEl.hidden = true;
    btn.disabled = true;
    btn.textContent = '로그인 중…';
    try {
      onAuthed(await api('POST', '/api/auth/login', { loginId, password }));
      toast(`반가워요! 👋`);
    } catch (err) {
      errEl.textContent = err.message;
      errEl.hidden = false;
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      btn.disabled = false;
      btn.textContent = '로그인';
    }
  };
  form.onsubmit = e => {
    e.preventDefault();
    const loginId = form.loginId.value.trim(), password = form.password.value;
    if (!loginId || !password) {
      errEl.textContent = '아이디와 비밀번호를 입력해주세요';
      errEl.hidden = false;
      return;
    }
    login(loginId, password);
  };
  $view.querySelectorAll('[data-demo]').forEach(b => b.onclick = () => login(b.dataset.demo, 'demo1234'));
}

function bindEyeToggles(root) {
  root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
    const input = b.parentElement.querySelector('input');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.textContent = show ? '숨기기' : '보기';
  });
}

function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  let score = 0;
  if (pw.length >= 6) score++;
  if (pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw)) score++;
  if (pw.length >= 10 && /[^a-zA-Z0-9]/.test(pw) || pw.length >= 14) score++;
  return { score, label: ['너무 짧아요', '보통', '좋아요', '아주 안전해요'][score] };
}

function renderSignup() {
  const form = {
    step: 1, loginId: '', idOk: false, password: '', password2: '',
    avatar: '🐰', photoPreview: null, nickname: '', gender: '', age: '',
    school: '', dept: '', mbti: ['', '', '', ''], bio: '',
  };
  const STEPS = [
    { emoji: '🔐', title: '로그인에 쓸\n계정을 만들어요', desc: '아이디는 프로필 주소로도 쓰여요' },
    { emoji: '🙋', title: '어떤 사람인지\n알려주세요', desc: '사진이 있으면 메모를 떼갈 확률이 올라가요' },
    { emoji: '🎓', title: '학교 정보를\n입력해주세요', desc: '과팅은 다른 과, 학팅은 다른 학교와 매칭돼요' },
  ];
  const MBTI_PAIRS = [['E', 'I'], ['N', 'S'], ['T', 'F'], ['J', 'P']];

  const hint = (el, text, state) => { el.textContent = text; el.className = 'hint ' + (state || ''); };

  const draw = () => {
    const s = STEPS[form.step - 1];
    $view.innerHTML = `
      <div class="signup">
        <div class="signup-top">
          <button class="back" id="prev">‹</button>
          <div class="progress"><i style="width:${(form.step / 3) * 100}%"></i></div>
          <span class="small muted">${form.step}/3</span>
        </div>
        <div class="signup-body" id="body">
          <div class="step-emoji">${s.emoji}</div>
          <h1>${s.title.replace('\n', '<br/>')}</h1>
          <p class="muted">${s.desc}</p>
          <div class="step-fields">${fieldsHtml()}</div>
        </div>
        <div class="signup-foot">
          <button class="btn primary block" id="next" disabled>${form.step === 3 ? '가입 완료 🎉' : '다음'}</button>
          ${form.step === 1 ? `<p class="small muted center" style="margin:12px 0 0">이미 계정이 있나요? <a href="#/login" class="link">로그인</a></p>` : ''}
        </div>
      </div>`;
    $view.querySelector('#prev').onclick = () => {
      if (form.step === 1) location.hash = '#/login';
      else { form.step--; draw(); }
    };
    bindEyeToggles($view);
    bindStep();
  };

  function fieldsHtml() {
    if (form.step === 1) return `
      <div class="tfield"><label>아이디</label>
        <div class="ifield"><span class="ic">@</span><input id="loginId" value="${esc(form.loginId)}" maxlength="16" placeholder="영문 소문자, 숫자 4~16자" autocomplete="username" autocapitalize="off" spellcheck="false" /></div>
        <p class="hint" id="id-hint"></p></div>
      <div class="tfield"><label>비밀번호</label>
        <div class="ifield"><span class="ic">🔒</span><input id="password" type="password" value="${esc(form.password)}" placeholder="6자 이상" autocomplete="new-password" /><button type="button" class="eye" data-eye>보기</button></div>
        <div class="strength" id="strength"><i></i><i></i><i></i><span></span></div></div>
      <div class="tfield"><label>비밀번호 확인</label>
        <div class="ifield"><span class="ic">✅</span><input id="password2" type="password" value="${esc(form.password2)}" placeholder="한 번 더 입력" autocomplete="new-password" /><button type="button" class="eye" data-eye>보기</button></div>
        <p class="hint" id="pw2-hint"></p></div>`;

    if (form.step === 2) return `
      <div class="photo-pick">
        <button type="button" class="profile-pic big" id="photo">${form.photoPreview ? `<img src="${form.photoPreview}" />` : form.avatar}<i>📷</i></button>
        <div class="emoji-row">${AVATARS.map(a => `<button type="button" data-av="${a}" class="${a === form.avatar && !form.photoPreview ? 'on' : ''}">${a}</button>`).join('')}</div>
      </div>
      <div class="tfield"><label>닉네임 <span class="counter" id="nick-count">${form.nickname.length}/12</span></label>
        <div class="ifield"><input id="nickname" value="${esc(form.nickname)}" maxlength="12" placeholder="예) 새내기곰" /></div></div>
      <div class="tfield"><label>성별 <span class="muted">· 가입 후 변경할 수 없어요</span></label>
        <div class="gender-cards">
          <button type="button" data-g="M" class="${form.gender === 'M' ? 'on' : ''}"><span>🙋‍♂️</span>남자</button>
          <button type="button" data-g="F" class="${form.gender === 'F' ? 'on' : ''}"><span>🙋‍♀️</span>여자</button>
        </div></div>
      <div class="tfield"><label>나이</label>
        <div class="ifield"><input id="age" type="number" inputmode="numeric" min="18" max="40" value="${esc(form.age)}" placeholder="22" /><span class="suffix">살</span></div>
        <p class="hint" id="age-hint"></p></div>`;

    return `
      <div class="tfield"><label>학교</label>
        <div class="ifield"><span class="ic">🏫</span><input id="school" value="${esc(form.school)}" maxlength="30" placeholder="한국대학교" /></div></div>
      <div class="tfield"><label>학과</label>
        <div class="ifield"><span class="ic">📚</span><input id="dept" value="${esc(form.dept)}" maxlength="30" placeholder="컴퓨터공학과" /></div></div>
      <div class="tfield"><label>MBTI <span class="muted">· 선택</span></label>
        <div class="mbti">${MBTI_PAIRS.map((pair, i) => `<div class="mbti-pair">${pair.map(ch =>
          `<button type="button" data-mbti="${i}" data-ch="${ch}" class="${form.mbti[i] === ch ? 'on' : ''}">${ch}</button>`).join('')}</div>`).join('')}</div></div>
      <div class="tfield"><label>한 줄 소개 <span class="muted">· 선택</span> <span class="counter" id="bio-count">${form.bio.length}/150</span></label>
        <textarea class="input" id="bio" maxlength="150" placeholder="맛집 탐방 좋아해요 🍜 주말엔 전시회!">${esc(form.bio)}</textarea></div>`;
  }

  function bindStep() {
    const next = $view.querySelector('#next');
    const $ = id => $view.querySelector('#' + id);

    if (form.step === 1) {
      const idHint = $('id-hint'), pw2Hint = $('pw2-hint'), strength = $('strength');
      let timer, seq = 0;
      const validate = () => {
        const s = passwordStrength(form.password);
        strength.dataset.score = s.score;
        strength.querySelector('span').textContent = s.label;
        if (!form.password2) hint(pw2Hint, '');
        else if (form.password === form.password2) hint(pw2Hint, '✓ 비밀번호가 일치해요', 'ok');
        else hint(pw2Hint, '비밀번호가 서로 달라요', 'err');
        next.disabled = !(form.idOk && form.password.length >= 6 && form.password === form.password2);
      };
      const checkId = () => {
        clearTimeout(timer);
        form.idOk = false;
        const v = form.loginId;
        if (!v) hint(idHint, '');
        else if (!/^[a-z0-9_.]{4,16}$/.test(v)) hint(idHint, v.length < 4 ? '4자 이상 입력해주세요' : '영문 소문자, 숫자, _ . 만 쓸 수 있어요', 'err');
        else {
          hint(idHint, '확인 중…');
          const my = ++seq;
          timer = setTimeout(async () => {
            try {
              const { available } = await api('GET', `/api/auth/check-id?loginId=${encodeURIComponent(v)}`);
              if (my !== seq) return;
              form.idOk = available;
              hint(idHint, available ? '✓ 멋진 아이디예요' : '이미 사용 중인 아이디예요', available ? 'ok' : 'err');
            } catch { hint(idHint, '확인에 실패했어요', 'err'); }
            validate();
          }, 300);
        }
        validate();
      };
      $('loginId').oninput = e => { form.loginId = e.target.value = e.target.value.toLowerCase().replace(/\s/g, ''); checkId(); };
      $('password').oninput = e => { form.password = e.target.value; validate(); };
      $('password2').oninput = e => { form.password2 = e.target.value; validate(); };
      if (form.loginId) checkId(); else validate();
      next.onclick = () => { form.step = 2; draw(); };
      $('loginId').focus();
      return;
    }

    if (form.step === 2) {
      const pic = $('photo');
      const validate = () => {
        const age = Number(form.age);
        const ageOk = !form.age || (age >= 18 && age <= 40);
        hint($('age-hint'), ageOk ? '' : '18~40 사이로 입력해주세요', ageOk ? '' : 'err');
        next.disabled = !(form.nickname.trim() && form.gender && ageOk);
      };
      pic.onclick = async () => {
        const [file] = await pickImages();
        if (!file) return;
        form.photoPreview = await resizeImage(file, 480, true);
        pic.innerHTML = `<img src="${form.photoPreview}" /><i>📷</i>`;
        $view.querySelectorAll('[data-av]').forEach(x => x.classList.remove('on'));
      };
      $view.querySelectorAll('[data-av]').forEach(b => b.onclick = () => {
        form.avatar = b.dataset.av; form.photoPreview = null;
        pic.innerHTML = `${form.avatar}<i>📷</i>`;
        $view.querySelectorAll('[data-av]').forEach(x => x.classList.toggle('on', x === b));
      });
      $('nickname').oninput = e => { form.nickname = e.target.value; $('nick-count').textContent = `${form.nickname.length}/12`; validate(); };
      $('age').oninput = e => { form.age = e.target.value; validate(); };
      $view.querySelectorAll('[data-g]').forEach(b => b.onclick = () => {
        form.gender = b.dataset.g;
        $view.querySelectorAll('[data-g]').forEach(x => x.classList.toggle('on', x === b));
        validate();
      });
      validate();
      next.onclick = () => { form.step = 3; draw(); };
      return;
    }

    const validate = () => { next.disabled = !(form.school.trim() && form.dept.trim()); };
    $('school').oninput = e => { form.school = e.target.value; validate(); };
    $('dept').oninput = e => { form.dept = e.target.value; validate(); };
    $('bio').oninput = e => { form.bio = e.target.value; $('bio-count').textContent = `${form.bio.length}/150`; };
    $view.querySelectorAll('[data-mbti]').forEach(b => b.onclick = () => {
      const i = Number(b.dataset.mbti);
      form.mbti[i] = form.mbti[i] === b.dataset.ch ? '' : b.dataset.ch;
      $view.querySelectorAll(`[data-mbti="${i}"]`).forEach(x => x.classList.toggle('on', x.dataset.ch === form.mbti[i]));
    });
    validate();

    next.onclick = async () => {
      next.disabled = true;
      next.textContent = '가입하는 중…';
      try {
        const mbti = form.mbti.every(Boolean) ? form.mbti.join('') : '';
        const res = await api('POST', '/api/auth/signup', {
          loginId: form.loginId, password: form.password, gender: form.gender, avatar: form.avatar,
          nickname: form.nickname.trim(), school: form.school.trim(), dept: form.dept.trim(), age: form.age, mbti, bio: form.bio,
        });
        token = res.token; // 사진 업로드에 토큰이 필요
        if (form.photoPreview) {
          try { res.user = await api('PATCH', '/api/users/me', { photo: await uploadImage(form.photoPreview) }); }
          catch { toast('사진은 프로필 편집에서 다시 올려주세요'); }
        }
        onAuthed(res);
        toast(`${res.user.nickname}님, 환영해요! 🎉`);
      } catch (err) {
        toast(err.message);
        next.disabled = false;
        next.textContent = '가입 완료 🎉';
      }
    };
  }

  draw();
}

// ================= 캘린더 (과팅/학팅 메인) =================
// silent: 실시간 갱신 — 데이터를 먼저 받아서 화면 깜빡임 없이 교체
async function renderCalendar(type, silent = false) {
  const now = new Date();
  const cur = ui.month[type] || (ui.month[type] = { y: now.getFullYear(), m: now.getMonth() });
  const monthKey = `${cur.y}-${pad(cur.m + 1)}`;
  if (!ui.selDate || !ui.selDate.startsWith(monthKey)) ui.selDate = monthKey === todayStr().slice(0, 7) ? todayStr() : null;

  const load = Promise.all([api('GET', `/api/posts?type=${type}&month=${monthKey}`), api('GET', '/api/me')])
    .catch(e => { toast(e.message); return [[], { posts: [] }]; });
  let posts, mine;
  if (silent) {
    [posts, mine] = await load;
    if (location.hash !== '#/' + type) return;
  }

  $view.innerHTML = `
    <div class="top"><h1 class="logo">${TYPE_LABEL[type]}</h1><div class="grow"></div>
      <span class="badge accent">${esc(type === 'gwa' ? me.dept : me.school)}</span></div>
    <div class="hero-strip">
      <div class="emoji">${type === 'gwa' ? '📌' : '🏫'}</div>
      <div><div class="t">${type === 'gwa' ? '다른 과랑 과팅 잡기' : '다른 학교랑 학팅 잡기'}</div>
      <div class="s">가능한 날짜에 메모를 붙이고, 끌리는 메모는 떼가세요</div></div>
    </div>
    <div class="chips">
      ${[0, 1, 2, 3].map(n => `<button class="chip ${ui.size === n ? 'on' : ''}" data-size="${n}">${n ? sizeLabel(n) : '전체'}</button>`).join('')}
    </div>
    <div class="cal"><div class="empty">불러오는 중…</div></div>
    <div id="day-panel" class="day-panel"></div>
    <div class="fab-row"><button class="btn primary block" id="register">＋ 날짜 등록하기</button></div>`;

  $view.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { ui.size = Number(b.dataset.size); renderCalendar(type); });
  $view.querySelector('#register').onclick = () => openRegisterSheet(type, ui.selDate);

  if (!silent) {
    [posts, mine] = await load;
    if (location.hash !== '#/' + type) return;
  }

  // 이성 팀 + 인원 필터
  const visible = posts.filter(p => p.team.gender !== me.gender && (!ui.size || p.size === ui.size));
  const byDate = {};
  visible.forEach(p => (byDate[p.date] ||= []).push(p));
  const myDates = new Set(mine.posts.filter(p => p.type === type).map(p => p.date));

  const first = new Date(cur.y, cur.m, 1);
  const days = new Date(cur.y, cur.m + 1, 0).getDate();
  const today = todayStr();
  let cells = DOW.map(d => `<div class="cal-dow">${d}</div>`).join('');
  for (let i = 0; i < first.getDay(); i++) cells += `<div class="cal-day out"></div>`;
  for (let d = 1; d <= days; d++) {
    const ds = `${monthKey}-${pad(d)}`;
    const cls = ['cal-day', ds < today && 'past', ds === today && 'today', ds === ui.selDate && 'sel'].filter(Boolean).join(' ');
    const cnt = byDate[ds]?.length;
    cells += `<button class="${cls}" data-date="${ds}"><span class="n">${d}</span>${cnt ? `<span class="cnt">${cnt}</span>` : ''}${myDates.has(ds) ? '<span class="mine">📌</span>' : ''}</button>`;
  }
  const canPrev = cur.y > now.getFullYear() || cur.m > now.getMonth();
  $view.querySelector('.cal').innerHTML = `
    <div class="cal-head">
      <button id="prev" ${canPrev ? '' : 'style="visibility:hidden"'}>‹</button>
      <b>${cur.y}년 ${cur.m + 1}월</b>
      <button id="next">›</button>
    </div>
    <div class="cal-grid">${cells}</div>
    <div class="cal-legend"><span><b style="color:var(--accent)">●</b> 뗄 수 있는 메모</span><span>📌 내가 등록한 날</span></div>`;

  const move = delta => { const d = new Date(cur.y, cur.m + delta, 1); ui.month[type] = { y: d.getFullYear(), m: d.getMonth() }; renderCalendar(type); };
  $view.querySelector('#prev').onclick = () => move(-1);
  $view.querySelector('#next').onclick = () => move(1);
  $view.querySelectorAll('[data-date]').forEach(b => b.onclick = () => {
    ui.selDate = b.dataset.date;
    $view.querySelectorAll('.cal-day.sel').forEach(x => x.classList.remove('sel'));
    b.classList.add('sel');
    renderDayPanel();
  });

  function renderDayPanel() {
    const el = $view.querySelector('#day-panel');
    if (!ui.selDate) { el.innerHTML = `<p class="muted small center">날짜를 눌러 붙어있는 메모를 확인하세요</p>`; return; }
    const list = byDate[ui.selDate] || [];
    const myList = mine.posts.filter(p => p.type === type && p.date === ui.selDate);
    const myHtml = myList.map(p => `
      <div class="memo-item mine-memo">
        <div class="row">
          <div class="faces">${faces(p.team.members)}</div>
          <div class="grow">
            <div class="row" style="gap:6px"><b>내 메모</b><span class="badge accent">${sizeLabel(p.size)}</span></div>
            <div class="small muted ellipsis">${p.team.members.map(m => esc(m.nickname)).join(' · ')}</div>
          </div>
          ${p.status === 'matched' ? '<span class="badge green">매칭 완료</span>'
            : p.team.full ? '<span class="badge accent">게시중</span>'
            : `<span class="badge gray">팀원 ${p.team.members.length}/${p.size}</span>`}
        </div>
        <p class="memo-text">“${esc(p.message || '메모 없음')}”</p>
        <div class="small muted">${p.status === 'matched' ? '매칭 탭에서 채팅할 수 있어요'
          : p.team.full ? '이성 팀이 떼가길 기다리는 중이에요'
          : '팀원이 다 모이면 다른 사람에게 공개돼요'}</div>
        ${p.status === 'open' && !p.team.full ? `<button class="btn sm primary" style="margin-top:10px" data-share="${p.team.id}" data-size="${p.size}">친구 초대</button>` : ''}
      </div>`).join('');
    el.innerHTML = `
      ${myHtml}
      <div class="row" style="margin-bottom:12px">
        <b class="grow">${prettyDate(ui.selDate)} · 뗄 수 있는 메모 ${list.length}장</b>
        ${list.length ? `<a class="small" style="color:var(--accent);font-weight:700" href="#/${type}/day/${ui.selDate}">🃏 카드로 넘겨보기</a>` : ''}
      </div>
      ${list.length ? list.map((p, i) => `
        <div class="memo-item" style="--tilt:${i % 2 ? 0.6 : -0.6}deg">
          <div class="row">
            <div class="faces">${p.team.members.map(m => `<a href="#/u/${m.id}"><span>${av(m)}</span></a>`).join('')}</div>
            <div class="grow">
              <div class="row" style="gap:6px"><b class="ellipsis">${esc(type === 'gwa' ? p.team.members[0].dept : p.team.members[0].school)}</b><span class="badge accent">${sizeLabel(p.size)}</span></div>
              <div class="small muted ellipsis">${p.team.members.map(m => `${esc(m.nickname)}${m.age ? ' ' + m.age : ''}`).join(' · ')}</div>
            </div>
          </div>
          <p class="memo-text">“${esc(p.message || '메모 없음')}”</p>
          <div class="row" style="gap:8px">
            <span class="small muted grow">${ago(p.createdAt)} 붙임</span>
            <a class="btn sm ghost" href="#/u/${p.team.members[0].id}">프로필</a>
            <button class="btn sm primary" data-take="${p.id}">📝 떼가기</button>
          </div>
        </div>`).join('')
      : `<div class="card center muted small" style="margin:0">아직 붙은 메모가 없어요.<br/>먼저 등록해서 떼가길 기다려보세요!</div>`}`;
    el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => shareInvite(b.dataset.share, Number(b.dataset.size)));
    el.querySelectorAll('[data-take]').forEach(b => b.onclick = () => {
      const post = list.find(p => p.id === b.dataset.take);
      takePost(post, () => renderCalendar(type), () => {});
    });
  }
  renderDayPanel();
}

// ================= 날짜 등록 시트 =================
function openRegisterSheet(type, date) {
  const state = { size: 1, date: date && date >= todayStr() ? date : todayStr() };
  openSheet(`
    <h3>📌 ${TYPE_LABEL[type]} 날짜 등록</h3>
    <p class="desc">메모를 붙여두면 이성 팀이 보고 떼갈 수 있어요.<br/>2:2, 3:3은 친구를 초대해서 팀이 다 모이면 공개돼요.</p>
    <div class="field"><label>날짜</label><input class="input" type="date" id="r-date" min="${todayStr()}" value="${state.date}" /></div>
    <div class="field"><label>인원</label>
      <div class="seg">${[1, 2, 3].map(n => `<button data-n="${n}" class="${n === 1 ? 'on' : ''}">${sizeLabel(n)}</button>`).join('')}</div>
    </div>
    <div class="field"><label>메모 (80자)</label><textarea class="input" id="r-msg" maxlength="80" placeholder="예) 신촌에서 저녁 먹고 가볍게 한잔해요 🍻"></textarea></div>
    <button class="btn primary block" id="r-submit">메모 붙이기</button>
  `, (sheet, close) => {
    sheet.querySelectorAll('[data-n]').forEach(b => b.onclick = () => {
      state.size = Number(b.dataset.n);
      sheet.querySelectorAll('[data-n]').forEach(x => x.classList.toggle('on', x === b));
      sheet.querySelector('#r-submit').textContent = state.size === 1 ? '메모 붙이기' : '팀 만들고 친구 초대하기';
    });
    sheet.querySelector('#r-submit').onclick = async () => {
      try {
        const post = await api('POST', '/api/posts', { type, size: state.size, date: sheet.querySelector('#r-date').value, message: sheet.querySelector('#r-msg').value });
        close();
        if (post.size === 1) { toast('메모를 붙였어요! 📌'); router(); }
        else openInviteSheet(post.team, post);
      } catch (e) { toast(e.message); }
    };
  });
}

function openInviteSheet(team, post) {
  const url = inviteUrl(team.id);
  const slots = Array.from({ length: team.size }, (_, i) => team.members[i]);
  openSheet(`
    <h3>👯 친구를 초대하세요</h3>
    <p class="desc">${post ? `${prettyDate(post.date)} ${sizeLabel(team.size)} 메모는` : `${sizeLabel(team.size)} 팀은`} 팀원 ${team.size}명이 모두 모이면 ${post ? '캘린더에 공개돼요.' : '메모를 떼갈 수 있어요.'}<br/>친구가 합류하면 실시간으로 알려드려요.</p>
    <div class="slots">${slots.map(m => m
      ? `<div class="slot filled"><div class="f">${av(m)}</div>${esc(m.nickname)}</div>`
      : `<div class="slot"><div class="f">➕</div>빈 자리</div>`).join('')}</div>
    <div class="link-box"><code>${esc(url)}</code><button class="btn sm ghost" id="i-copy">복사</button></div>
    <button class="btn primary block" id="i-share">초대 링크 보내기</button>
    <button class="btn block" style="margin-top:6px" id="i-close">나중에 할게요</button>
  `, (sheet, close) => {
    sheet.querySelector('#i-copy').onclick = () => copyText(url);
    sheet.querySelector('#i-share').onclick = () => shareInvite(team.id, team.size);
    sheet.querySelector('#i-close').onclick = () => { close(); router(); };
  });
}

// ================= 메모 카드 스와이프 =================
async function renderDeck(type, date) {
  $view.innerHTML = `
    <div class="deck-wrap">
      <div class="top">${back('#/' + type)}
        <div class="grow"><h2>${prettyDate(date)}</h2><div class="small muted">${TYPE_LABEL[type]} 메모 보드</div></div>
        <div class="chips" style="padding:0">${[0, 1, 2, 3].map(n => `<button class="chip ${ui.size === n ? 'on' : ''}" data-size="${n}" style="height:30px;padding:0 10px;font-size:12px">${n ? sizeLabel(n) : '전체'}</button>`).join('')}</div>
      </div>
      <div class="deck" id="deck"></div>
      <div class="deck-actions">
        <button class="round nope" id="nope">✕</button>
        <button class="round big" id="like">📝</button>
        <button class="round" id="undo">↺</button>
      </div>
      <div class="deck-count" id="count"></div>
    </div>`;
  $view.querySelectorAll('[data-size]').forEach(b => b.onclick = () => { ui.size = Number(b.dataset.size); renderDeck(type, date); });

  let posts = [];
  try { posts = await api('GET', `/api/posts?type=${type}&month=${date.slice(0, 7)}`); } catch (e) { toast(e.message); }
  const list = posts.filter(p => p.date === date && p.team.gender !== me.gender && (!ui.size || p.size === ui.size));
  let idx = 0;
  const deck = $view.querySelector('#deck');

  const cardHtml = p => `
    <div class="art">
      <span class="size-tag">${sizeLabel(p.size)} ${TYPE_LABEL[p.type]}</span>
      ${p.team.members.map(m => `<div class="face ${p.size === 3 ? 'sm' : ''}" data-profile="${m.id}">${av(m)}</div>`).join('')}
    </div>
    <span class="stamp like">떼기!</span><span class="stamp nope">패스</span>
    <div class="info">
      <h3>${esc(type === 'gwa' ? p.team.members[0].dept : p.team.members[0].school)}</h3>
      <div class="sub">${esc(type === 'gwa' ? p.team.members[0].school : p.team.members[0].dept)} · ${p.team.gender === 'F' ? '여자' : '남자'} ${p.size}명</div>
      <div class="members">${p.team.members.map(m => `<span data-profile="${m.id}">${esc(m.nickname)}${m.age ? ' ' + m.age : ''}${m.mbti ? ' · ' + esc(m.mbti) : ''} ›</span>`).join('')}</div>
      ${p.message ? `<div class="memo">“${esc(p.message)}”</div>` : ''}
    </div>`;

  function draw() {
    const rest = list.slice(idx);
    $view.querySelector('#count').textContent = rest.length ? `${idx + 1} / ${list.length} · 이름을 누르면 프로필을 볼 수 있어요` : '';
    if (!rest.length) {
      deck.innerHTML = `<div class="empty" style="padding-top:80px"><div class="big">🗒️</div>
        <b>${list.length ? '메모를 다 봤어요' : '이 날엔 뗄 메모가 없어요'}</b><p class="small">직접 메모를 붙여두면 상대가 떼갈 수 있어요</p>
        <button class="btn primary" id="reg-here">이 날짜에 등록하기</button></div>`;
      deck.querySelector('#reg-here').onclick = () => openRegisterSheet(type, date);
      return;
    }
    deck.innerHTML = rest.slice(0, 2).reverse().map((p, i, arr) =>
      `<div class="swipe-card ${i < arr.length - 1 ? 'under' : ''}">${cardHtml(p)}</div>`).join('');
    bindSwipe(deck.querySelector('.swipe-card:not(.under)'));
  }

  function fly(card, dir) {
    card.style.transition = 'transform .35s ease-out, opacity .35s';
    card.style.transform = `translate(${dir * 600}px, 40px) rotate(${dir * 30}deg)`;
    card.style.opacity = '0';
  }
  function resetCard(card) {
    card.style.transition = 'transform .3s';
    card.style.transform = '';
    card.querySelectorAll('.stamp').forEach(s => (s.style.opacity = 0));
  }
  function next(dir) {
    const card = deck.querySelector('.swipe-card:not(.under)');
    if (!card) return;
    if (dir > 0) {
      card.querySelector('.stamp.like').style.opacity = 1;
      takePost(list[idx], () => { fly(card, 1); setTimeout(() => { list.splice(idx, 1); draw(); }, 300); }, () => resetCard(card));
    } else {
      card.querySelector('.stamp.nope').style.opacity = 1;
      fly(card, -1);
      setTimeout(() => { idx++; draw(); }, 300);
    }
  }

  function bindSwipe(card) {
    let sx = 0, sy = 0, dx = 0, dragging = false, downTarget = null;
    card.onpointerdown = e => { dragging = true; downTarget = e.target; sx = e.clientX; sy = e.clientY; dx = 0; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; };
    card.onpointermove = e => {
      if (!dragging) return;
      dx = e.clientX - sx;
      card.style.transform = `translate(${dx}px, ${(e.clientY - sy) * 0.3}px) rotate(${dx / 18}deg)`;
      card.querySelector('.stamp.like').style.opacity = Math.max(0, Math.min(1, dx / 90));
      card.querySelector('.stamp.nope').style.opacity = Math.max(0, Math.min(1, -dx / 90));
    };
    card.onpointerup = card.onpointercancel = () => {
      if (!dragging) return;
      dragging = false;
      const profile = downTarget?.closest('[data-profile]');
      if (Math.abs(dx) < 6 && profile) { resetCard(card); location.hash = '#/u/' + profile.dataset.profile; return; }
      if (Math.abs(dx) > 110) next(Math.sign(dx)); else resetCard(card);
    };
  }

  $view.querySelector('#nope').onclick = () => next(-1);
  $view.querySelector('#like').onclick = () => next(1);
  $view.querySelector('#undo').onclick = () => { if (idx > 0) { idx--; draw(); } };
  draw();
}

// ================= 떼가기 =================
async function takePost(post, onDone, onCancel) {
  const doTake = async teamId => {
    try {
      const match = await api('POST', `/api/posts/${post.id}/take`, { teamId });
      closeSheet();
      onDone();
      openSheet(`
        <div class="celebrate"><div class="big">🎉</div>
          <h3>메모를 뗐어요!</h3>
          <p class="desc">${prettyDate(match.date)} ${esc(match.teamA.members[0].dept)}와(과)의 ${sizeLabel(match.size)} ${TYPE_LABEL[match.type]}이 잡혔어요.<br/>상대 팀에게도 바로 알림이 갔어요.</p>
          <div class="faces vs" style="justify-content:center;margin-bottom:20px">
            <div class="faces">${faces(match.teamB.members)}</div><i>♥</i><div class="faces">${faces(match.teamA.members)}</div>
          </div>
        </div>
        <a class="btn primary block" href="#/chat/${match.id}">채팅방 가기</a>
        <button class="btn block" style="margin-top:6px" id="c-more">계속 둘러보기</button>
      `, (sheet, close) => (sheet.querySelector('#c-more').onclick = close));
    } catch (e) { toast(e.message); onCancel(); }
  };

  if (post.size === 1) {
    openSheet(`
      <h3>이 메모를 뗄까요?</h3>
      <p class="desc">${esc(post.team.members[0].nickname)}님과 ${prettyDate(post.date)} 1:1 ${TYPE_LABEL[post.type]}이 바로 확정돼요.</p>
      <button class="btn primary block" id="t-ok">📝 떼가기</button>
      <button class="btn block" style="margin-top:6px" id="t-no">취소</button>
    `, (sheet, close) => {
      const cancel = () => { close(); onCancel(); };
      sheet.querySelector('#t-ok').onclick = () => doTake();
      sheet.querySelector('#t-no').onclick = cancel;
      $sheetRoot.querySelector('.sheet-bg').onclick = cancel;
    });
    return;
  }

  // 2:2 / 3:3 → 함께 나갈 내 팀 선택
  let teams = [];
  try { teams = (await api('GET', '/api/me')).teams; } catch (e) { toast(e.message); return onCancel(); }
  const usable = teams.filter(t => t.size === post.size && t.leaderId === me.id && !t.matched && !t.hasPost);
  let pick = usable.find(t => t.full)?.id;
  openSheet(`
    <h3>${sizeLabel(post.size)} 함께 나갈 팀</h3>
    <p class="desc">팀원 ${post.size}명이 다 모인 팀으로만 뗄 수 있어요.</p>
    ${usable.map(t => `
      <button class="pick ${t.id === pick ? 'on' : ''}" data-team="${t.id}" style="${t.full ? '' : 'opacity:.6'}">
        <div class="row"><div class="faces">${faces(t.members)}</div>
          <div class="grow"><b>${t.members.map(m => esc(m.nickname)).join(', ')}</b>
          <div class="small muted">${t.full ? '준비 완료' : `팀원 모집중 ${t.members.length}/${t.size}`}</div></div>
          ${t.full ? '' : `<span class="badge accent" data-invite>초대</span>`}
        </div>
      </button>`).join('') || `<div class="card center muted small" style="margin:0 0 12px">아직 ${sizeLabel(post.size)} 팀이 없어요</div>`}
    <button class="btn primary block" id="t-ok" ${pick ? '' : 'disabled'}>📝 이 팀으로 떼가기</button>
    <button class="btn ghost block" style="margin-top:8px" id="t-new">＋ 새 팀 만들고 친구 초대</button>
  `, (sheet, close) => {
    $sheetRoot.querySelector('.sheet-bg').onclick = () => { close(); onCancel(); };
    sheet.querySelectorAll('[data-team]').forEach(b => b.onclick = e => {
      if (e.target.closest('[data-invite]')) return shareInvite(b.dataset.team, post.size);
      if (!usable.find(t => t.id === b.dataset.team).full) return toast('팀원이 다 모여야 해요');
      pick = b.dataset.team;
      sheet.querySelectorAll('[data-team]').forEach(x => x.classList.toggle('on', x === b));
      sheet.querySelector('#t-ok').disabled = false;
    });
    sheet.querySelector('#t-ok').onclick = () => pick && doTake(pick);
    sheet.querySelector('#t-new').onclick = async () => {
      try {
        const team = await api('POST', '/api/teams', { size: post.size, type: post.type });
        onCancel();
        openInviteSheet(team);
      } catch (e) { toast(e.message); }
    };
  });
}

// ================= 초대 링크 =================
async function renderInvite(teamId) {
  const render = current.render = async () => {
    let team;
    try { team = await api('GET', `/api/teams/${teamId}`); } catch (e) {
      $view.innerHTML = `<div class="empty"><div class="big">🥲</div>${esc(e.message)}<br/><br/><a class="btn primary" href="#/gwa">홈으로</a></div>`;
      return;
    }
    const leader = team.members.find(m => m.id === team.leaderId) || team.members[0];
    const joined = team.members.some(m => m.id === me.id);
    const slots = Array.from({ length: team.size }, (_, i) => team.members[i]);
    $phone.classList.toggle('theme-hak', team.type === 'hak');
    $view.innerHTML = `
      <div class="onboard-hero" style="background:var(--accent-grad);text-align:center">
        <div class="profile-pic big" style="margin:0 auto 10px;border-color:rgba(255,255,255,.6)">${av(leader)}</div>
        <h1 style="font-size:24px">${esc(leader.nickname)}님이<br/>${sizeLabel(team.size)} ${TYPE_LABEL[team.type]}에 초대했어요</h1>
        <p>${team.post ? `📅 ${prettyDate(team.post.date)}` : '함께 메모를 떼러 가요'}</p>
      </div>
      <div class="pad" style="padding-top:20px">
        ${team.post?.message ? `<div class="memo-mini" style="width:auto;transform:rotate(-1deg);font-size:15px;margin-bottom:18px"><div class="m" style="-webkit-line-clamp:4">“${esc(team.post.message)}”</div></div>` : ''}
        <b>팀원 ${team.members.length}/${team.size}</b>
        <div class="slots">${slots.map(m => m
          ? `<a class="slot filled" href="#/u/${m.id}"><div class="f">${av(m)}</div>${esc(m.nickname)}<div class="small muted">${esc(m.dept)}</div></a>`
          : `<div class="slot"><div class="f">➕</div>빈 자리</div>`).join('')}</div>
        ${joined ? `<button class="btn ghost block" disabled>이미 합류한 팀이에요</button>`
          : team.full ? `<button class="btn ghost block" disabled>팀이 꽉 찼어요</button>`
          : `<button class="btn primary block" id="join">팀 합류하기</button>`}
        <a class="btn block" style="margin-top:8px" href="#/${team.type}">홈으로</a>
      </div>`;
    const join = $view.querySelector('#join');
    if (join) join.onclick = async () => {
      try {
        const t = await api('POST', `/api/teams/${teamId}/join`);
        toast(t.full ? '팀이 완성됐어요! 🎉' : '팀에 합류했어요');
        render();
      } catch (e) { toast(e.message); }
    };
  };
  $view.innerHTML = `<div class="empty">불러오는 중…</div>`;
  render();
}

// ================= 매칭 목록 =================
async function renderMatches() {
  $view.innerHTML = `<div class="top"><h1>매칭</h1></div><div id="list"><div class="empty">불러오는 중…</div></div>`;
  const render = current.render = async () => {
    let data;
    try { data = await api('GET', '/api/me'); } catch (e) { return toast(e.message); }
    if (location.hash !== '#/matches') return;
    setUnread(data.matches.reduce((n, m) => n + m.unread, 0));
    const list = $view.querySelector('#list');
    if (!data.matches.length) {
      list.innerHTML = `<div class="empty"><div class="big">💌</div><b>아직 매칭이 없어요</b><p class="small">캘린더에서 메모를 떼거나 붙여보세요</p><a class="btn primary" href="#/gwa">과팅 보러가기</a></div>`;
      return;
    }
    list.innerHTML = data.matches.map(m => {
      const other = m.teamA.members.some(x => x.id === me.id) ? m.teamB : m.teamA;
      return `
        <a class="card row" href="#/chat/${m.id}">
          <div class="faces">${faces(other.members)}</div>
          <div class="grow">
            <div class="row" style="gap:6px"><b class="ellipsis">${esc(other.members[0].dept)}</b><span class="badge accent">${sizeLabel(m.size)}</span></div>
            <div class="small ${m.unread ? '' : 'muted'} ellipsis" style="${m.unread ? 'font-weight:600' : ''}">${esc(m.last?.text || '')}</div>
          </div>
          <div class="small muted" style="text-align:right">${m.last ? ago(m.last.at) : ''}<br/>${m.unread ? `<span class="unread">${m.unread}</span>` : TYPE_LABEL[m.type]}</div>
        </a>`;
    }).join('');
  };
  render();
}

// ================= 채팅 (실시간) =================
async function renderChat(matchId) {
  $tabbar.hidden = true;
  $view.innerHTML = `<div class="empty">불러오는 중…</div>`;
  const shown = new Set();
  let people = {}, myTeamIds = new Set();

  const load = async () => {
    const match = await api('GET', `/api/matches/${matchId}`);
    const mineIsA = match.teamA.members.some(x => x.id === me.id);
    const other = mineIsA ? match.teamB : match.teamA;
    people = Object.fromEntries([...match.teamA.members, ...match.teamB.members].map(m => [m.id, m]));
    myTeamIds = new Set((mineIsA ? match.teamA : match.teamB).members.map(m => m.id));
    return { match, other };
  };

  let data;
  try { data = await load(); } catch (e) {
    $view.innerHTML = `<div class="empty"><div class="big">🥲</div>${esc(e.message)}<br/><br/><a class="btn primary" href="#/matches">돌아가기</a></div>`;
    return;
  }
  if (location.hash !== '#/chat/' + matchId) return;
  const { match, other } = data;
  $phone.classList.toggle('theme-hak', match.type === 'hak');
  current.chatId = matchId;
  current.people = people;
  refreshUnread();

  $view.innerHTML = `
    <div class="chat">
      <div class="chat-head">
        <a class="back" href="#/matches" style="font-size:24px;width:28px">‹</a>
        <div class="faces">${faces(other.members)}</div>
        <div class="grow"><b>${esc(other.members[0].dept)} ${sizeLabel(match.size)}</b>
          <div class="small muted" id="chat-sub">${prettyDate(match.date)} · ${Object.keys(people).length}명 단톡</div></div>
        <button class="btn sm ghost" id="members">멤버</button>
      </div>
      <div class="chat-body" id="msgs"></div>
      <form class="chat-input" id="send"><input placeholder="메시지 보내기" autocomplete="off" maxlength="500" /><button>↑</button></form>
    </div>`;
  const box = $view.querySelector('#msgs');
  const sub = $view.querySelector('#chat-sub');
  const subText = sub.textContent;

  const append = msgs => {
    const fresh = msgs.filter(m => !shown.has(m.id));
    if (!fresh.length) return;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.insertAdjacentHTML('beforeend', fresh.map(m => {
      shown.add(m.id);
      if (m.system) return `<div class="sys">${esc(m.text)}</div>`;
      const p = people[m.userId] || { nickname: '알 수 없음', avatar: '❔' };
      if (m.userId === me.id) return `<div class="msg me"><div class="bubble">${esc(m.text)}</div></div>`;
      const team = myTeamIds.has(m.userId);
      return `<div class="msg ${team ? 'team' : ''}"><a class="av" href="#/u/${p.id}">${av(p)}</a><div><div class="name">${esc(p.nickname)}${team ? ' · 우리팀' : ''}</div><div class="bubble">${esc(m.text)}</div></div></div>`;
    }).join(''));
    if (atBottom || fresh.some(m => m.userId === me.id)) box.scrollTop = box.scrollHeight;
  };
  append(match.messages);
  box.scrollTop = box.scrollHeight;

  current.onMessage = msg => append([msg]);
  current.render = async () => { try { append((await load()).match.messages); } catch { /* 재연결 시 재시도 */ } };
  let typingTimer;
  current.onTyping = user => {
    sub.textContent = `${user.nickname}님이 입력 중…`;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => (sub.textContent = subText), 2000);
  };

  $view.querySelector('#members').onclick = () => openSheet(`
    <h3>채팅 멤버</h3><p class="desc">누르면 프로필을 볼 수 있어요</p>
    ${[['우리 팀', [...myTeamIds]], ['상대 팀', other.members.map(m => m.id)]].map(([title, ids]) => `
      <div class="small muted" style="margin:10px 0 6px;font-weight:700">${title}</div>
      ${ids.map(id => people[id]).map(p => `
        <a class="pick row" href="#/u/${p.id}"><div class="faces"><span>${av(p)}</span></div>
          <div class="grow"><b>${esc(p.nickname)}</b> <span class="small muted">${p.age || ''} ${esc(p.mbti || '')}</span><div class="small muted">${esc(p.school)} · ${esc(p.dept)}</div></div>›</a>`).join('')}`).join('')}
  `);

  const input = $view.querySelector('#send input');
  let lastTyping = 0;
  input.oninput = () => {
    if (Date.now() - lastTyping > 1500 && socket?.connected) { socket.emit('chat:typing', { matchId }); lastTyping = Date.now(); }
  };
  $view.querySelector('#send').onsubmit = async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (socket?.connected) {
      socket.emit('chat:send', { matchId, text }, res => res?.error && toast(res.error));
    } else {
      try { append([await api('POST', `/api/matches/${matchId}/messages`, { text })]); } catch (err) { toast(err.message); }
    }
  };
}

// ================= 프로필 (인스타그램 스타일) =================
async function renderProfile(userId) {
  const isMe = userId === me.id;
  $view.innerHTML = `<div class="empty">불러오는 중…</div>`;

  const render = current.render = async () => {
    let data, mine;
    try {
      [data, mine] = await Promise.all([api('GET', `/api/users/${userId}/profile`), isMe ? api('GET', '/api/me') : null]);
    } catch (e) {
      $view.innerHTML = `<div class="empty"><div class="big">🥲</div>${esc(e.message)}</div>`;
      return;
    }
    const u = data.user;
    if (isMe) { me = u; }
    const tab = isMe ? ui.meTab : 'feed';

    $view.innerHTML = `
      <div class="top">
        ${isMe ? '' : back('#/gwa')}
        <h2 class="grow">${esc(u.loginId)}</h2>
        ${isMe ? `<button class="icon-btn" id="new-post" title="새 게시물">＋</button><button class="icon-btn" id="menu" title="메뉴">☰</button>` : ''}
      </div>
      <div class="pad">
        <div class="row" style="gap:20px">
          <div class="profile-pic ring">${av(u)}</div>
          <div class="stats">
            <div><b>${data.stats.feed}</b><span>게시물</span></div>
            <div><b>${data.stats.memos}</b><span>메모</span></div>
            <div><b>${data.stats.matches}</b><span>매칭</span></div>
          </div>
        </div>
        <div class="bio">
          <b>${esc(u.nickname)}</b>
          <div class="tags">
            <span class="badge">${u.gender === 'F' ? '여자' : '남자'}${u.age ? ' · ' + u.age : ''}</span>
            ${u.mbti ? `<span class="badge accent">${esc(u.mbti)}</span>` : ''}
          </div>
          <div class="muted small">🎓 ${esc(u.school)} · ${esc(u.dept)}</div>
          ${u.bio ? `<p>${esc(u.bio)}</p>` : ''}
        </div>
        ${isMe ? `<div class="row" style="gap:8px;margin:14px 0 4px">
          <a class="btn sm ghost grow" href="#/edit">프로필 편집</a>
          <a class="btn sm ghost grow" href="#/new-post">게시물 올리기</a>
        </div>` : ''}
      </div>
      ${isMe ? `<div class="ptabs">
        <button data-tab="feed" class="${tab === 'feed' ? 'on' : ''}">▦ 피드</button>
        <button data-tab="memos" class="${tab === 'memos' ? 'on' : ''}">📌 메모</button>
        <button data-tab="teams" class="${tab === 'teams' ? 'on' : ''}">👯 팀</button>
      </div>` : `<div class="ptabs"><button class="on">▦ 피드</button></div>`}
      <div id="ptab-body"></div>`;

    if (isMe) {
      $view.querySelector('#new-post').onclick = () => (location.hash = '#/new-post');
      $view.querySelector('#menu').onclick = () => openSheet(`
        <h3>설정</h3><p class="desc">@${esc(u.loginId)}로 로그인되어 있어요</p>
        <a class="pick" href="#/edit">✏️ 프로필 편집</a>
        <button class="pick" id="do-logout" style="color:#ff4d6d">로그아웃</button>
      `, sheet => (sheet.querySelector('#do-logout').onclick = () => logout()));
      $view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => { ui.meTab = b.dataset.tab; render(); });
    }

    const body = $view.querySelector('#ptab-body');
    if (tab === 'feed') {
      body.innerHTML = data.feed.length
        ? `<div class="grid">${data.feed.map(f => `
            <a href="#/p/${f.id}" class="grid-item"><img src="${esc(f.images[0])}" loading="lazy" alt="" />
              ${f.images.length > 1 ? '<i class="multi">❐</i>' : ''}</a>`).join('')}</div>`
        : `<div class="empty"><div class="big">📷</div><b>${isMe ? '첫 게시물을 올려보세요' : '아직 게시물이 없어요'}</b>
            ${isMe ? `<p class="small">사진이 있으면 메모를 떼갈 확률이 올라가요!</p><a class="btn primary sm" href="#/new-post">사진 올리기</a>` : ''}</div>`;
    } else if (tab === 'memos') {
      renderMyMemos(body, mine, render);
    } else {
      renderMyTeams(body, mine);
    }
  };
  render();
}

function renderMyMemos(el, data, rerender) {
  el.innerHTML = `<div style="height:12px"></div>` + (data.posts.map(p => {
    const status = p.status === 'matched' ? '<span class="badge green">매칭 완료</span>'
      : p.team.full ? '<span class="badge accent">게시중</span>'
      : `<span class="badge gray">팀원 모집 ${p.team.members.length}/${p.size}</span>`;
    return `
      <div class="card">
        <div class="row">
          <div class="faces">${faces(p.team.members)}</div>
          <div class="grow"><b>${prettyDate(p.date)}</b> <span class="small muted">${TYPE_LABEL[p.type]} ${sizeLabel(p.size)}</span>
            <div class="small muted ellipsis">${esc(p.message || '메모 없음')}</div></div>
          ${status}
        </div>
        ${p.status === 'open' ? `<div class="row" style="margin-top:12px;justify-content:flex-end;gap:8px">
          ${!p.team.full ? `<button class="btn sm primary" data-share="${p.team.id}" data-size="${p.size}">친구 초대</button>` : ''}
          ${p.team.leaderId === me.id ? `<button class="btn sm ghost" data-cancel="${p.id}">내리기</button>` : ''}
        </div>` : ''}
      </div>`;
  }).join('') || `<div class="empty"><div class="big">📌</div>아직 붙인 메모가 없어요<br/><br/><a class="btn primary sm" href="#/gwa">날짜 등록하러 가기</a></div>`);

  el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => shareInvite(b.dataset.share, Number(b.dataset.size)));
  el.querySelectorAll('[data-cancel]').forEach(b => b.onclick = async () => {
    if (!confirm('이 메모를 내릴까요?')) return;
    try { await api('DELETE', `/api/posts/${b.dataset.cancel}`); toast('메모를 내렸어요'); rerender(); } catch (e) { toast(e.message); }
  });
}

function renderMyTeams(el, data) {
  el.innerHTML = `<div style="height:12px"></div>` + (data.teams.map(t => `
    <div class="card row">
      <div class="faces">${faces(t.members)}</div>
      <div class="grow"><b>${sizeLabel(t.size)} ${TYPE_LABEL[t.type]} 팀</b>${t.hasPost ? ' <span class="small muted">· 메모 등록됨</span>' : ''}
        <div class="small muted ellipsis">${t.members.map(m => esc(m.nickname)).join(', ')}</div></div>
      ${t.matched ? '<span class="badge green">매칭 완료</span>'
        : t.full ? '<span class="badge accent">준비 완료</span>'
        : `<button class="btn sm primary" data-share="${t.id}" data-size="${t.size}">초대 ${t.members.length}/${t.size}</button>`}
    </div>`).join('') || `<div class="empty"><div class="big">👯</div>2:2, 3:3 팀이 여기 보여요</div>`);
  el.querySelectorAll('[data-share]').forEach(b => b.onclick = () => shareInvite(b.dataset.share, Number(b.dataset.size)));
}

// ================= 피드 게시물 상세 =================
async function renderFeedPost(postId) {
  $view.innerHTML = `<div class="empty">불러오는 중…</div>`;
  let f;
  try { f = await api('GET', `/api/feed/${postId}`); } catch (e) {
    $view.innerHTML = `<div class="top">${back('#/me')}</div><div class="empty"><div class="big">🥲</div>${esc(e.message)}</div>`;
    return;
  }
  const mine = f.userId === me.id;
  $view.innerHTML = `
    <div class="top">${back('#/u/' + f.userId)}<h2 class="grow">게시물</h2></div>
    <a class="row pad" href="#/u/${f.author.id}" style="padding-bottom:10px">
      <div class="profile-pic sm">${av(f.author)}</div>
      <div class="grow"><b>${esc(f.author.loginId)}</b><div class="small muted">${esc(f.author.dept)}</div></div>
      ${mine ? `<button class="icon-btn" id="del" title="삭제">🗑</button>` : ''}
    </a>
    <div class="carousel" id="carousel">${f.images.map(src => `<img src="${esc(src)}" alt="" />`).join('')}</div>
    ${f.images.length > 1 ? `<div class="dots">${f.images.map((_, i) => `<i class="${i ? '' : 'on'}"></i>`).join('')}</div>` : ''}
    <div class="pad" style="padding-top:10px">
      <div class="row" style="gap:6px">
        <button class="like-btn ${f.liked ? 'on' : ''}" id="like">${f.liked ? '♥' : '♡'}</button>
        <b id="likes">좋아요 ${f.likes}개</b>
      </div>
      ${f.caption ? `<p style="margin:8px 0;line-height:1.5;white-space:pre-wrap"><b>${esc(f.author.loginId)}</b> ${esc(f.caption)}</p>` : ''}
      <div class="small muted" style="margin-bottom:30px">${ago(f.createdAt)}</div>
    </div>`;

  const carousel = $view.querySelector('#carousel');
  const dots = $view.querySelectorAll('.dots i');
  carousel.onscroll = () => {
    const i = Math.round(carousel.scrollLeft / carousel.clientWidth);
    dots.forEach((d, j) => d.classList.toggle('on', i === j));
  };
  // 더블탭 좋아요
  let lastTap = 0;
  carousel.onclick = () => { if (Date.now() - lastTap < 300 && !f.liked) like(); lastTap = Date.now(); };

  const likeBtn = $view.querySelector('#like');
  const like = async () => {
    try {
      f = await api('POST', `/api/feed/${postId}/like`);
      likeBtn.classList.toggle('on', f.liked);
      likeBtn.textContent = f.liked ? '♥' : '♡';
      $view.querySelector('#likes').textContent = `좋아요 ${f.likes}개`;
    } catch (e) { toast(e.message); }
  };
  likeBtn.onclick = like;
  const del = $view.querySelector('#del');
  if (del) del.onclick = async e => {
    e.preventDefault();
    if (!confirm('게시물을 삭제할까요?')) return;
    try { await api('DELETE', `/api/feed/${postId}`); toast('삭제했어요'); location.hash = '#/me'; } catch (err) { toast(err.message); }
  };
}

// ================= 새 게시물 =================
function renderNewPost() {
  const images = []; // dataURL
  $view.innerHTML = `
    <div class="top">${back('#/me')}<h2 class="grow">새 게시물</h2><button class="btn sm primary" id="share" disabled>공유</button></div>
    <div class="pad">
      <div class="picker" id="picker"></div>
      <p class="small muted">사진은 최대 5장까지 올릴 수 있어요</p>
      <div class="field"><textarea class="input" id="caption" maxlength="500" placeholder="문구를 입력하세요…" style="height:120px"></textarea></div>
    </div>`;
  const picker = $view.querySelector('#picker');
  const shareBtn = $view.querySelector('#share');
  const draw = () => {
    picker.innerHTML = images.map((src, i) => `<div class="pick-img"><img src="${src}" /><button data-rm="${i}">✕</button></div>`).join('')
      + (images.length < 5 ? `<button class="pick-add" id="add">＋<span>사진 추가</span></button>` : '');
    shareBtn.disabled = !images.length;
    picker.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { images.splice(Number(b.dataset.rm), 1); draw(); });
    const add = picker.querySelector('#add');
    if (add) add.onclick = async () => {
      const files = (await pickImages(true)).slice(0, 5 - images.length);
      for (const file of files) images.push(await resizeImage(file, 1080));
      draw();
    };
  };
  draw();
  shareBtn.onclick = async () => {
    shareBtn.disabled = true;
    shareBtn.textContent = '올리는 중…';
    try {
      const urls = [];
      for (const img of images) urls.push(await uploadImage(img));
      const f = await api('POST', '/api/feed', { images: urls, caption: $view.querySelector('#caption').value });
      ui.meTab = 'feed';
      toast('게시물을 올렸어요 📷');
      location.hash = '#/p/' + f.id;
    } catch (e) { toast(e.message); shareBtn.disabled = false; shareBtn.textContent = '공유'; }
  };
}

// ================= 프로필 편집 =================
function renderEditProfile() {
  const form = { avatar: me.avatar, photo: me.photo, photoData: null };
  $view.innerHTML = `
    <div class="top">${back('#/me')}<h2 class="grow">프로필 편집</h2><button class="btn sm primary" id="save">완료</button></div>
    <div class="pad">
      <div class="center" style="margin:6px 0 16px">
        <button class="profile-pic big" id="photo"></button>
        <div class="row" style="justify-content:center;gap:14px;margin-top:8px">
          <button class="small" style="color:var(--accent);font-weight:700" id="change">사진 변경</button>
          <button class="small muted" id="remove">사진 삭제</button>
        </div>
      </div>
      <div class="field"><label>사진이 없을 때 보일 이모지</label><div class="avatars">${AVATARS.map(a => `<button data-av="${a}" class="${a === form.avatar ? 'on' : ''}">${a}</button>`).join('')}</div></div>
      <div class="field"><label>닉네임</label><input class="input" id="nickname" maxlength="12" value="${esc(me.nickname)}" /></div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:2"><label>학교</label><input class="input" id="school" value="${esc(me.school)}" /></div>
        <div class="field" style="flex:1"><label>나이</label><input class="input" id="age" type="number" inputmode="numeric" value="${me.age || ''}" /></div>
      </div>
      <div style="display:flex;gap:10px">
        <div class="field" style="flex:2"><label>학과</label><input class="input" id="dept" value="${esc(me.dept)}" /></div>
        <div class="field" style="flex:1"><label>MBTI</label><input class="input" id="mbti" maxlength="4" value="${esc(me.mbti || '')}" style="text-transform:uppercase" /></div>
      </div>
      <div class="field"><label>소개</label><textarea class="input" id="bio" maxlength="150">${esc(me.bio || '')}</textarea></div>
      <p class="small muted" style="margin-bottom:30px">아이디 @${esc(me.loginId)} · 성별은 변경할 수 없어요</p>
    </div>`;
  const pic = $view.querySelector('#photo');
  const drawPic = () => (pic.innerHTML = (form.photoData || form.photo) ? `<img src="${esc(form.photoData || form.photo)}" /><i>📷</i>` : `${form.avatar}<i>📷</i>`);
  drawPic();
  const change = async () => {
    const [file] = await pickImages();
    if (!file) return;
    form.photoData = await resizeImage(file, 480, true);
    drawPic();
  };
  pic.onclick = change;
  $view.querySelector('#change').onclick = change;
  $view.querySelector('#remove').onclick = () => { form.photo = null; form.photoData = null; drawPic(); };
  $view.querySelectorAll('[data-av]').forEach(b => b.onclick = () => {
    form.avatar = b.dataset.av;
    $view.querySelectorAll('[data-av]').forEach(x => x.classList.toggle('on', x === b));
    drawPic();
  });
  $view.querySelector('#save').onclick = async e => {
    const v = id => $view.querySelector('#' + id).value.trim();
    e.target.disabled = true;
    try {
      const photo = form.photoData ? await uploadImage(form.photoData) : form.photo;
      me = await api('PATCH', '/api/users/me', { avatar: form.avatar, photo, nickname: v('nickname'), school: v('school'), dept: v('dept'), age: v('age'), mbti: v('mbti'), bio: v('bio') });
      toast('프로필을 저장했어요');
      location.hash = '#/me';
    } catch (err) { toast(err.message); e.target.disabled = false; }
  };
}

router();
