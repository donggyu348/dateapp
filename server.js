// Node 서버: 정적 파일 + JSON API + Socket.IO 실시간 + data.json 저장
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
// DATA_DIR: 배포 환경에서 영구 볼륨 경로 (예: Railway 볼륨 /data)
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const MAX_BODY = 8 * 1024 * 1024;

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => Date.now();

function fmt(dt) {
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

let db = { users: {}, sessions: {}, teams: {}, posts: {}, matches: {}, feed: {} };
if (fs.existsSync(DATA_FILE)) {
  db = { ...db, ...JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')) };
} else {
  seed();
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2)), 100);
}

// ---------- 비밀번호 ----------
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passHash, 'hex'));
}

// ---------- 데모 데이터 ----------
function seed() {
  const people = [
    ['minji', '민지', 'F', '경영학과', 22, '🐰', '맛집 투어 좋아해요', 'ENFP'],
    ['seoyeon', '서연', 'F', '경영학과', 21, '🦊', 'ENFP 입니다', 'ENFP'],
    ['haeun', '하은', 'F', '경영학과', 22, '🐱', '술보다 분위기파', 'ISFJ'],
    ['jiwoo', '지우', 'F', '시각디자인과', 23, '🌷', '전시회 같이 가요', 'INFP'],
    ['yuna', '유나', 'F', '시각디자인과', 22, '🍓', '', ''],
    ['sua', '수아', 'F', '간호학과', 21, '🐻', '실습 끝나고 힐링하고 싶어요', 'ESFJ'],
    ['doyun', '도윤', 'M', '컴퓨터공학과', 23, '🐶', '코딩보다 대화 잘함', 'ENTP'],
    ['siwoo', '시우', 'M', '컴퓨터공학과', 24, '🦁', '운동 좋아해요', 'ESTJ'],
    ['junho', '준호', 'M', '기계공학과', 23, '🐯', '보드게임 고수', 'INTJ'],
    ['hyunwoo', '현우', 'M', '기계공학과', 22, '🐧', '', ''],
    ['jihoon', '지훈', 'M', '기계공학과', 24, '🦖', '노래방 가실 분', 'ESFP'],
    ['gunwoo', '건우', 'M', '체육교육과', 22, '🐺', 'ESTP', 'ESTP'],
  ];
  const u = people.map(([loginId, nickname, gender, dept, age, avatar, bio, mbti]) => {
    const { salt, hash } = hashPassword('demo1234');
    const user = { id: id(), loginId, salt, passHash: hash, nickname, gender, school: '한국대학교', dept, age, avatar, photo: null, bio, mbti, createdAt: now() };
    db.users[user.id] = user;
    return user;
  });
  const mk = (type, members, date, message) => {
    const team = { id: id(), type, size: members.length, leaderId: members[0].id, members: members.map(m => m.id), gender: members[0].gender, createdAt: now() };
    db.teams[team.id] = team;
    const post = { id: id(), type, size: team.size, teamId: team.id, date, message, status: 'open', createdAt: now() };
    db.posts[post.id] = post;
  };
  const today = new Date();
  const d = n => fmt(new Date(today.getFullYear(), today.getMonth(), today.getDate() + n));
  mk('gwa', [u[0], u[1], u[2]], d(2), '경영 3명! 신촌에서 즐겁게 놀아요 🍻');
  mk('gwa', [u[3], u[4]], d(2), '디자인과 둘이서 조용한 이자카야 원해요');
  mk('gwa', [u[5]], d(3), '간단하게 저녁 먹어요 :)');
  mk('gwa', [u[6], u[7]], d(2), '컴공 2명, 텐션 책임집니다');
  mk('gwa', [u[8], u[9], u[10]], d(5), '기계과 3:3 구해요! 술게임 준비완료');
  mk('gwa', [u[11]], d(3), '체교과 1:1, 맛있는 거 사드릴게요');
  mk('hak', [u[0], u[2]], d(8), '학교 밖 친구 사귀고 싶어요');
  mk('hak', [u[6], u[8]], d(8), '타학교 분들 환영!');
}

// ---------- 헬퍼 ----------
const publicUser = uid => {
  const u = db.users[uid];
  return u && { id: u.id, loginId: u.loginId, nickname: u.nickname, gender: u.gender, school: u.school, dept: u.dept, age: u.age, avatar: u.avatar, photo: u.photo, bio: u.bio, mbti: u.mbti };
};
const teamView = t => t && { ...t, members: t.members.map(publicUser).filter(Boolean), full: t.members.length >= t.size };
const postView = p => p && { ...p, team: teamView(db.teams[p.teamId]) };
const matchView = m => {
  if (!m) return m;
  const { reads, ...rest } = m;
  return { ...rest, post: postView(db.posts[m.postId]), teamA: teamView(db.teams[m.teamA]), teamB: teamView(db.teams[m.teamB]) };
};
const feedView = (f, viewer) => f && { ...f, likes: f.likes.length, liked: f.likes.includes(viewer), author: publicUser(f.userId) };
const inTeam = (t, uid) => !!t && t.members.includes(uid);

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const need = (cond, status, msg) => { if (!cond) fail(status, msg); };
const userFromToken = token => (token && db.sessions[token]) || null;

const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const MBTI_RE = /^[EI][NS][TF][JP]$/;
const uploadUrlOk = url => url === null || (typeof url === 'string' && /^\/uploads\/[a-f0-9]+\.(jpg|png|webp)$/.test(url));

// ---------- 실시간 ----------
let io = null;
const emitToUsers = (userIds, event, payload) => io && userIds.forEach(uid => io.to(`user:${uid}`).emit(event, payload));
const matchMembers = m => [...db.teams[m.teamA].members, ...db.teams[m.teamB].members];
const isMatchMember = (m, uid) => inTeam(db.teams[m.teamA], uid) || inTeam(db.teams[m.teamB], uid);
const unreadCount = (m, uid) => {
  const readAt = (m.reads || {})[uid] || 0;
  return m.messages.filter(x => x.at > readAt && x.userId !== uid).length;
};

function addMessage(matchId, userId, rawText) {
  const m = db.matches[matchId] || fail(404, '채팅방이 없어요');
  need(isMatchMember(m, userId), 403, '참여자만 보낼 수 있어요');
  const text = clean(rawText, 500);
  need(text, 400, '메시지를 입력하세요');
  const msg = { id: id(), userId, text, at: now() };
  m.messages.push(msg);
  (m.reads ||= {})[userId] = msg.at;
  save();
  emitToUsers(matchMembers(m), 'chat:message', { matchId, msg, from: publicUser(userId) });
  return msg;
}

function markRead(matchId, userId) {
  const m = db.matches[matchId];
  if (!m || !isMatchMember(m, userId)) return;
  (m.reads ||= {})[userId] = now();
  save();
}

// ---------- 라우트 ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};
const auth = uid => { need(uid && db.users[uid], 401, '로그인이 필요해요'); return db.users[uid]; };

function validateProfile(body, partial = false) {
  const out = {};
  if (!partial || 'nickname' in body) { out.nickname = clean(body.nickname, 12); need(out.nickname, 400, '닉네임을 입력해주세요'); }
  if (!partial || 'school' in body) { out.school = clean(body.school, 30); need(out.school, 400, '학교를 입력해주세요'); }
  if (!partial || 'dept' in body) { out.dept = clean(body.dept, 30); need(out.dept, 400, '학과를 입력해주세요'); }
  if (!partial || 'age' in body) { const a = Number(body.age); out.age = a >= 18 && a <= 40 ? a : null; }
  if (!partial || 'bio' in body) out.bio = clean(body.bio, 150);
  if (!partial || 'avatar' in body) out.avatar = clean(body.avatar, 8) || '🙂';
  if (!partial || 'mbti' in body) { const m = clean(body.mbti, 4).toUpperCase(); out.mbti = MBTI_RE.test(m) ? m : ''; }
  if (!partial || 'photo' in body) { const p = body.photo ?? null; need(uploadUrlOk(p), 400, '잘못된 사진'); out.photo = p; }
  return out;
}

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = user.id;
  save();
  return { token, user: publicUser(user.id) };
}

route('POST', '/api/auth/signup', ({ body }) => {
  const loginId = clean(body.loginId, 20).toLowerCase();
  need(/^[a-z0-9_.]{4,16}$/.test(loginId), 400, '아이디는 영문 소문자/숫자 4~16자예요');
  need(typeof body.password === 'string' && body.password.length >= 6, 400, '비밀번호는 6자 이상이에요');
  need(!Object.values(db.users).some(u => u.loginId === loginId), 409, '이미 사용 중인 아이디예요');
  need(['M', 'F'].includes(body.gender), 400, '성별을 선택해주세요');
  const profile = validateProfile(body);
  const { salt, hash } = hashPassword(body.password);
  const user = { id: id(), loginId, salt, passHash: hash, gender: body.gender, ...profile, createdAt: now() };
  db.users[user.id] = user;
  return createSession(user);
});

route('GET', '/api/auth/check-id', ({ query }) => {
  const loginId = clean(query.loginId, 20).toLowerCase();
  return { available: /^[a-z0-9_.]{4,16}$/.test(loginId) && !Object.values(db.users).some(u => u.loginId === loginId) };
});

route('POST', '/api/auth/login', ({ body }) => {
  const user = Object.values(db.users).find(u => u.loginId === clean(body.loginId, 20).toLowerCase());
  need(user && checkPassword(user, String(body.password || '')), 401, '아이디 또는 비밀번호가 맞지 않아요');
  return createSession(user);
});

route('POST', '/api/auth/logout', ({ token }) => {
  delete db.sessions[token];
  save();
  return { ok: true };
});

route('GET', '/api/auth/me', ({ uid }) => publicUser(auth(uid).id));

route('PATCH', '/api/users/me', ({ uid, body }) => {
  const user = auth(uid);
  Object.assign(user, validateProfile(body, true));
  save();
  return publicUser(user.id);
});

route('POST', '/api/uploads', ({ uid, body }) => {
  auth(uid);
  const m = String(body.data || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  need(m, 400, '이미지 파일만 올릴 수 있어요');
  const buf = Buffer.from(m[2], 'base64');
  need(buf.length <= 4 * 1024 * 1024, 413, '사진이 너무 커요 (최대 4MB)');
  const name = `${crypto.randomBytes(12).toString('hex')}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return { url: `/uploads/${name}` };
});

// ----- 프로필 & 피드 -----
route('GET', '/api/users/:id/profile', ({ uid, params }) => {
  auth(uid);
  const target = publicUser(params.id) || fail(404, '사용자가 없어요');
  const feed = Object.values(db.feed).filter(f => f.userId === target.id).sort((a, b) => b.createdAt - a.createdAt).map(f => feedView(f, uid));
  const matches = Object.values(db.matches).filter(m => isMatchMember(m, target.id)).length;
  const memos = Object.values(db.posts).filter(p => p.status !== 'cancelled' && inTeam(db.teams[p.teamId], target.id)).length;
  return { user: target, feed, stats: { feed: feed.length, matches, memos } };
});

route('POST', '/api/feed', ({ uid, body }) => {
  auth(uid);
  const images = Array.isArray(body.images) ? body.images.slice(0, 5) : [];
  need(images.length && images.every(uploadUrlOk) && images.every(Boolean), 400, '사진을 1장 이상 올려주세요');
  const f = { id: id(), userId: uid, images, caption: clean(body.caption, 500), likes: [], createdAt: now() };
  db.feed[f.id] = f;
  save();
  return feedView(f, uid);
});

route('GET', '/api/feed/:id', ({ uid, params }) => {
  auth(uid);
  return feedView(db.feed[params.id], uid) || fail(404, '게시물이 없어요');
});

route('DELETE', '/api/feed/:id', ({ uid, params }) => {
  const f = db.feed[params.id] || fail(404, '게시물이 없어요');
  need(f.userId === auth(uid).id, 403, '내 게시물만 지울 수 있어요');
  delete db.feed[params.id];
  save();
  return { ok: true };
});

route('POST', '/api/feed/:id/like', ({ uid, params }) => {
  auth(uid);
  const f = db.feed[params.id] || fail(404, '게시물이 없어요');
  f.likes = f.likes.includes(uid) ? f.likes.filter(x => x !== uid) : [...f.likes, uid];
  save();
  return feedView(f, uid);
});

// ----- 과팅/학팅 -----
// 달력용: 해당 월의 게시글 (팀원이 다 모인 open 게시글만 공개)
route('GET', '/api/posts', ({ uid, query }) => {
  auth(uid);
  const { type = 'gwa', month } = query;
  return Object.values(db.posts)
    .filter(p => p.type === type && p.status === 'open' && (!month || p.date.startsWith(month)))
    .map(postView)
    .filter(p => p.team && p.team.full)
    .sort((a, b) => a.createdAt - b.createdAt);
});

// 날짜 등록 = 팀 생성 + 메모 게시
route('POST', '/api/posts', ({ uid, body }) => {
  const user = auth(uid);
  const size = Number(body.size);
  need([1, 2, 3].includes(size), 400, '인원을 선택해주세요');
  need(['gwa', 'hak'].includes(body.type), 400, '잘못된 유형');
  need(/^\d{4}-\d{2}-\d{2}$/.test(body.date) && body.date >= fmt(new Date()), 400, '지난 날짜에는 등록할 수 없어요');
  const dup = Object.values(db.posts).find(p => p.date === body.date && p.type === body.type && p.status !== 'cancelled' && inTeam(db.teams[p.teamId], user.id));
  need(!dup, 409, '이미 이 날짜에 등록했어요');
  const team = { id: id(), type: body.type, size, leaderId: user.id, members: [user.id], gender: user.gender, createdAt: now() };
  db.teams[team.id] = team;
  const post = { id: id(), type: body.type, size, teamId: team.id, date: body.date, message: clean(body.message, 80), status: 'open', createdAt: now() };
  db.posts[post.id] = post;
  save();
  return postView(post);
});

route('DELETE', '/api/posts/:id', ({ uid, params }) => {
  const post = db.posts[params.id] || fail(404, '게시글이 없어요');
  need(db.teams[post.teamId].leaderId === auth(uid).id, 403, '팀장만 취소할 수 있어요');
  need(post.status === 'open', 409, '이미 매칭된 게시글이에요');
  post.status = 'cancelled';
  save();
  return { ok: true };
});

// 떼가기용 팀 만들기
route('POST', '/api/teams', ({ uid, body }) => {
  const user = auth(uid);
  const size = Number(body.size);
  need([2, 3].includes(size), 400, '2:2 또는 3:3만 팀을 만들 수 있어요');
  const team = { id: id(), type: body.type === 'hak' ? 'hak' : 'gwa', size, leaderId: user.id, members: [user.id], gender: user.gender, createdAt: now() };
  db.teams[team.id] = team;
  save();
  return teamView(team);
});

// 초대 링크 미리보기는 로그인 전에도 볼 수 있음
route('GET', '/api/teams/:id', ({ params }) => {
  const team = db.teams[params.id] || fail(404, '팀을 찾을 수 없어요');
  const post = Object.values(db.posts).find(p => p.teamId === team.id && p.status !== 'cancelled');
  return { ...teamView(team), post: post || null };
});

route('POST', '/api/teams/:id/join', ({ uid, params }) => {
  const user = auth(uid);
  const team = db.teams[params.id] || fail(404, '팀을 찾을 수 없어요');
  need(!inTeam(team, user.id), 409, '이미 이 팀에 있어요');
  need(team.members.length < team.size, 409, '팀이 이미 꽉 찼어요');
  need(team.gender === user.gender, 403, '같은 성별끼리만 팀을 이룰 수 있어요');
  team.members.push(user.id);
  save();
  const view = teamView(team);
  emitToUsers(team.members, 'team:update', { team: view, joined: publicUser(user.id) });
  return view;
});

// 떼가기
route('POST', '/api/posts/:id/take', ({ uid, params, body }) => {
  const user = auth(uid);
  const post = db.posts[params.id] || fail(404, '게시글이 없어요');
  need(post.status === 'open', 409, '이미 누가 떼갔어요 😢');
  const hostTeam = db.teams[post.teamId];
  need(hostTeam.members.length >= hostTeam.size, 409, '아직 팀원이 다 모이지 않았어요');
  need(!inTeam(hostTeam, user.id), 400, '내 메모는 뗄 수 없어요');
  need(hostTeam.gender !== user.gender, 403, '이성 팀의 메모만 뗄 수 있어요');

  let myTeam;
  if (post.size === 1) {
    myTeam = { id: id(), type: post.type, size: 1, leaderId: user.id, members: [user.id], gender: user.gender, createdAt: now() };
  } else {
    myTeam = db.teams[body.teamId] || fail(400, '함께 나갈 팀을 선택해주세요');
    need(myTeam.leaderId === user.id, 403, '팀장만 떼갈 수 있어요');
    need(myTeam.size === post.size, 400, `${post.size}:${post.size} 팀이 필요해요`);
    need(myTeam.members.length >= myTeam.size, 400, '팀원이 다 모여야 떼갈 수 있어요');
  }
  const clash = Object.values(db.matches).some(m => m.date === post.date &&
    [m.teamA, m.teamB].some(t => db.teams[t].members.some(x => myTeam.members.includes(x))));
  need(!clash, 409, '그날 이미 약속이 있는 팀원이 있어요');

  db.teams[myTeam.id] = myTeam;
  post.status = 'matched';
  const label = post.type === 'hak' ? '학팅' : '과팅';
  const match = {
    id: id(), postId: post.id, type: post.type, size: post.size, date: post.date, teamA: hostTeam.id, teamB: myTeam.id,
    messages: [{ id: id(), system: true, text: `매칭 성공! ${post.date} ${label}이 잡혔어요 🎉 인사를 나눠보세요.`, at: now() }],
    reads: {}, createdAt: now(),
  };
  db.matches[match.id] = match;
  save();
  emitToUsers(matchMembers(match), 'match:new', { match: matchView(match), takenBy: publicUser(user.id) });
  return matchView(match);
});

route('GET', '/api/me', ({ uid }) => {
  auth(uid);
  const posts = Object.values(db.posts).filter(p => p.status !== 'cancelled' && inTeam(db.teams[p.teamId], uid)).map(postView);
  const matches = Object.values(db.matches)
    .filter(m => isMatchMember(m, uid))
    .map(m => { const v = matchView(m); v.last = m.messages[m.messages.length - 1]; v.unread = unreadCount(m, uid); delete v.messages; return v; })
    .sort((a, b) => (b.last?.at || 0) - (a.last?.at || 0));
  const teams = Object.values(db.teams).filter(t => inTeam(t, uid) && t.size > 1).map(t => ({
    ...teamView(t),
    hasPost: posts.some(p => p.teamId === t.id),
    matched: matches.some(m => m.teamA.id === t.id || m.teamB.id === t.id),
  }));
  return { teams, posts: posts.sort((a, b) => a.date.localeCompare(b.date)), matches };
});

route('GET', '/api/unread', ({ uid }) => {
  auth(uid);
  return { count: Object.values(db.matches).filter(m => isMatchMember(m, uid)).reduce((n, m) => n + unreadCount(m, uid), 0) };
});

route('GET', '/api/matches/:id', ({ uid, params }) => {
  auth(uid);
  const m = db.matches[params.id] || fail(404, '채팅방이 없어요');
  need(isMatchMember(m, uid), 403, '참여자만 볼 수 있어요');
  markRead(m.id, uid);
  return matchView(m);
});

// 소켓이 끊겼을 때를 위한 대체 경로
route('POST', '/api/matches/:id/messages', ({ uid, params, body }) => addMessage(params.id, auth(uid).id, body.text));

// ---------- 서버 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json' };

function serveFile(res, baseDir, pathname, fallback) {
  let file = path.normalize(path.join(baseDir, decodeURIComponent(pathname)));
  const ok = file.startsWith(baseDir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile();
  if (!ok) {
    if (!fallback) { res.writeHead(404); return res.end(); }
    file = fallback;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
    const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
    if (!r) return send(404, { error: 'Not found' });
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        need(raw.length <= MAX_BODY, 413, '요청이 너무 커요');
      }
      const m = url.pathname.match(r.re);
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const token = (req.headers.authorization || '').replace(/^Bearer /, '');
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, '잘못된 요청'); }
      send(200, r.handler({ params, query: Object.fromEntries(url.searchParams), body, token, uid: userFromToken(token) }));
    } catch (e) {
      if (!e.status) console.error(e);
      send(e.status || 500, { error: e.status ? e.message : '서버 오류' });
    }
    return;
  }
  if (url.pathname.startsWith('/uploads/')) return serveFile(res, UPLOAD_DIR, url.pathname.slice('/uploads'.length));
  serveFile(res, PUBLIC_DIR, url.pathname === '/' ? '/index.html' : url.pathname, path.join(PUBLIC_DIR, 'index.html'));
});

io = new Server(server);
io.use((socket, next) => {
  const uid = userFromToken(socket.handshake.auth?.token);
  if (!uid || !db.users[uid]) return next(new Error('unauthorized'));
  socket.data.userId = uid;
  next();
});
io.on('connection', socket => {
  const uid = socket.data.userId;
  socket.join(`user:${uid}`);
  const handle = fn => (payload, ack) => {
    try {
      ack?.({ ok: true, data: fn(payload || {}) });
    } catch (e) {
      if (!e.status) console.error(e);
      ack?.({ error: e.status ? e.message : '서버 오류' });
    }
  };
  socket.on('chat:send', handle(({ matchId, text }) => addMessage(matchId, uid, text)));
  socket.on('chat:read', handle(({ matchId }) => markRead(matchId, uid)));
  socket.on('chat:typing', handle(({ matchId }) => {
    const m = db.matches[matchId];
    if (!m || !isMatchMember(m, uid)) return;
    emitToUsers(matchMembers(m).filter(u => u !== uid), 'chat:typing', { matchId, user: publicUser(uid) });
  }));
});

server.listen(PORT, () => console.log(`과팅 앱 실행 중 → http://localhost:${PORT}`));
