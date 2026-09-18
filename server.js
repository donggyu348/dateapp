// 스펙핏 서버: 정적 파일 + JSON API + 추천 엔진 + Claude AI 분석
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createStore } from './lib/store.js';
import { META, FIELDS, CATEGORIES } from './lib/catalog.js';
import { sampleContests } from './lib/seed.js';
import { diagnose, matchContest, basicRoadmap, todayKST } from './lib/match.js';
import { aiEnabled, analyzeContest, buildRoadmap, discoverContests, AIError } from './lib/ai.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || ROOT;
const MAX_BODY = 256 * 1024;

const id = () => crypto.randomBytes(6).toString('hex');
const now = () => Date.now();

let store = null;
let db = null;
const save = () => store.save();

// ---------- 공통 ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const need = (cond, status, msg) => { if (!cond) fail(status, msg); };
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const cleanArr = (arr, max, len = 40, allowed) => (Array.isArray(arr) ? arr : [])
  .map(v => clean(v, len)).filter(v => v && (!allowed || allowed.includes(v))).slice(0, max);

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}
function checkPassword(user, password) {
  const { hash } = hashPassword(password, user.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passHash, 'hex'));
}

const publicUser = u => u && { id: u.id, loginId: u.loginId, profile: u.profile, profileUpdatedAt: u.profileUpdatedAt, createdAt: u.createdAt };
const auth = uid => db.users[uid] || fail(401, '로그인이 필요해요');

// 프로필 입력값 정리 (회원가입·수정 공통)
function sanitizeProfile(b = {}) {
  const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };
  const p = {
    name: clean(b.name, 20),
    school: clean(b.school, 40),
    grade: num(b.grade, 1, 6),
    major: clean(b.major, 40),
    subMajor: clean(b.subMajor, 40),
    region: clean(b.region, 20),
    goal: Object.keys(META.GOALS).includes(b.goal) ? b.goal : 'undecided',
    fields: cleanArr(b.fields, 5, 20, Object.keys(FIELDS)),
    jobTitle: clean(b.jobTitle, 40),
    companyTypes: cleanArr(b.companyTypes, 5, 20, Object.keys(META.COMPANY_TYPES)),
    gradTerm: clean(b.gradTerm, 20),
    gpa: num(b.gpa, 0, 4.5),
    gpaMax: [4.3, 4.5].includes(Number(b.gpaMax)) ? Number(b.gpaMax) : 4.5,
    langs: (Array.isArray(b.langs) ? b.langs : []).slice(0, 6)
      .map(l => ({ test: clean(l?.test, 20), score: clean(l?.score, 10) })).filter(l => l.test && l.score),
    certs: cleanArr(b.certs, 15, 30),
    exps: (Array.isArray(b.exps) ? b.exps : []).slice(0, 30)
      .map(e => ({ type: Object.keys(META.EXP_TYPES).includes(e?.type) ? e.type : 'project', title: clean(e?.title, 60), period: clean(e?.period, 30) }))
      .filter(e => e.title),
    skills: cleanArr(b.skills, 20, 30),
    strengths: cleanArr(b.strengths, 5, 20, META.STRENGTHS),
    categories: cleanArr(b.categories, 8, 20, Object.keys(CATEGORIES)),
    teamPref: ['team', 'solo', 'any'].includes(b.teamPref) ? b.teamPref : 'any',
    modePref: ['online', 'offline', 'any'].includes(b.modePref) ? b.modePref : 'any',
    weeklyHours: num(b.weeklyHours, 1, 40) || 8,
    busy: ['low', 'mid', 'high'].includes(b.busy) ? b.busy : 'mid',
    concern: clean(b.concern, 500),
  };
  need(p.name, 400, '이름(닉네임)을 입력해주세요');
  need(p.school && p.major && p.grade, 400, '학교, 학년, 전공을 입력해주세요');
  need(p.fields.length, 400, '관심 분야를 1개 이상 골라주세요');
  return p;
}

// 사용자 기준으로 공모전 목록에 적합도를 붙여서 반환
function rankFor(user, contests = Object.values(db.contests)) {
  const diag = diagnose(user.profile);
  return {
    diag,
    ranked: contests
      .map(c => ({ contest: c, match: matchContest(user.profile, c, diag) }))
      .filter(r => r.match.daysLeft >= 0),
  };
}

const saveKey = (uid, cid) => `${uid}_${cid}`;
const savedMap = uid => Object.fromEntries(Object.values(db.saves).filter(s => s.userId === uid).map(s => [s.contestId, s.status]));
const contestView = (r, saved) => ({ ...r.contest, match: r.match, saved: saved?.[r.contest.id] || null });

// 같은 사용자의 AI 요청이 겹치지 않게
const busy = new Set();
async function exclusive(key, fn) {
  need(!busy.has(key), 429, '이미 분석 중이에요. 잠시만 기다려주세요.');
  busy.add(key);
  try { return await fn(); } finally { busy.delete(key); }
}

// ---------- 라우트 ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/meta', () => ({ ...META, ai: aiEnabled() }));

route('GET', '/api/auth/check-id', ({ query }) => {
  const loginId = clean(query.loginId, 20).toLowerCase();
  return { available: /^[a-z0-9_.]{4,16}$/.test(loginId) && !Object.values(db.users).some(u => u.loginId === loginId) };
});

function createSession(user) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: now() };
  save();
  return { token, user: publicUser(user) };
}

route('POST', '/api/auth/signup', ({ body }) => {
  const loginId = clean(body.loginId, 20).toLowerCase();
  need(/^[a-z0-9_.]{4,16}$/.test(loginId), 400, '아이디는 영문 소문자/숫자 4~16자예요');
  need(typeof body.password === 'string' && body.password.length >= 8, 400, '비밀번호는 8자 이상이에요');
  need(!Object.values(db.users).some(u => u.loginId === loginId), 409, '이미 사용 중인 아이디예요');
  const profile = sanitizeProfile(body.profile);
  const { salt, hash } = hashPassword(body.password);
  const user = { id: id(), loginId, salt, passHash: hash, profile, profileUpdatedAt: now(), createdAt: now() };
  db.users[user.id] = user;
  return createSession(user);
});

route('POST', '/api/auth/login', ({ body }) => {
  const user = Object.values(db.users).find(u => u.loginId === clean(body.loginId, 20).toLowerCase());
  need(user && checkPassword(user, String(body.password || '')), 401, '아이디 또는 비밀번호가 맞지 않아요');
  return createSession(user);
});

route('POST', '/api/auth/logout', ({ token }) => { delete db.sessions[token]; save(); return { ok: true }; });
route('GET', '/api/auth/me', ({ uid }) => publicUser(auth(uid)));

route('PUT', '/api/profile', ({ uid, body }) => {
  const user = auth(uid);
  user.profile = sanitizeProfile(body.profile);
  user.profileUpdatedAt = now();
  save();
  return publicUser(user);
});

route('GET', '/api/dashboard', ({ uid }) => {
  const user = auth(uid);
  const { diag, ranked } = rankFor(user);
  const saved = savedMap(uid);
  const top = [...ranked].sort((a, b) => b.match.score - a.match.score).slice(0, 4);
  const soon = ranked.filter(r => saved[r.contest.id] && ['interested', 'preparing'].includes(saved[r.contest.id]))
    .sort((a, b) => a.match.daysLeft - b.match.daysLeft).slice(0, 4);
  const plan = db.plans[uid] || null;
  return {
    diag,
    top: top.map(r => contestView(r, saved)),
    soon: soon.map(r => contestView(r, saved)),
    counts: {
      open: ranked.length,
      goodFit: ranked.filter(r => r.match.score >= 70).length,
      saved: Object.keys(saved).length,
      applied: Object.values(saved).filter(s => ['applied', 'done'].includes(s)).length,
    },
    plan: plan && { createdAt: plan.createdAt, stale: plan.basedOn < user.profileUpdatedAt, summary: plan.result.summary, thisWeek: plan.result.thisWeek, ai: plan.result.ai },
  };
});

route('GET', '/api/contests', ({ uid, query }) => {
  const user = auth(uid);
  const { ranked } = rankFor(user);
  const saved = savedMap(uid);
  const q = clean(query.q, 40).toLowerCase();
  let list = ranked.filter(r =>
    (!query.category || r.contest.category === query.category) &&
    (!query.field || r.contest.fields.includes(query.field)) &&
    (!query.saved || saved[r.contest.id]) &&
    (!q || `${r.contest.title} ${r.contest.host} ${r.contest.summary}`.toLowerCase().includes(q)));
  list.sort(query.sort === 'deadline'
    ? (a, b) => a.match.daysLeft - b.match.daysLeft
    : (a, b) => b.match.score - a.match.score || a.match.daysLeft - b.match.daysLeft);
  return list.map(r => contestView(r, saved));
});

route('GET', '/api/contests/:id', ({ uid, params }) => {
  const user = auth(uid);
  const c = db.contests[params.id] || fail(404, '공고를 찾을 수 없어요');
  const diag = diagnose(user.profile);
  const analysis = db.analyses[saveKey(uid, c.id)] || null;
  return {
    ...c,
    match: matchContest(user.profile, c, diag),
    saved: savedMap(uid)[c.id] || null,
    analysis: analysis && { ...analysis.result, createdAt: analysis.createdAt, stale: analysis.basedOn < user.profileUpdatedAt },
  };
});

route('POST', '/api/contests/:id/save', ({ uid, params, body }) => {
  auth(uid);
  need(db.contests[params.id], 404, '공고를 찾을 수 없어요');
  const key = saveKey(uid, params.id);
  if (!body.status) delete db.saves[key];
  else {
    need(['interested', 'preparing', 'applied', 'done'].includes(body.status), 400, '잘못된 상태');
    db.saves[key] = { userId: uid, contestId: params.id, status: body.status, updatedAt: now() };
  }
  save();
  return { status: body.status || null };
});

route('POST', '/api/contests/:id/analyze', async ({ uid, params }) => {
  const user = auth(uid);
  const c = db.contests[params.id] || fail(404, '공고를 찾을 수 없어요');
  need(aiEnabled(), 503, 'AI 분석은 서버에 Claude API 키가 연결되면 사용할 수 있어요');
  return exclusive(`analyze:${uid}`, async () => {
    const result = await analyzeContest(user.profile, c, matchContest(user.profile, c));
    db.analyses[saveKey(uid, c.id)] = { result, basedOn: user.profileUpdatedAt, createdAt: now() };
    save();
    return { ...result, createdAt: now(), stale: false };
  });
});

route('GET', '/api/roadmap', ({ uid }) => {
  const user = auth(uid);
  const plan = db.plans[uid];
  return plan ? { ...plan.result, createdAt: plan.createdAt, stale: plan.basedOn < user.profileUpdatedAt } : null;
});

route('POST', '/api/roadmap', async ({ uid }) => {
  const user = auth(uid);
  return exclusive(`roadmap:${uid}`, async () => {
    const { diag, ranked } = rankFor(user);
    const candidates = [...ranked].sort((a, b) => b.match.score - a.match.score).slice(0, 15);
    const result = aiEnabled() ? await buildRoadmap(user.profile, diag, candidates) : basicRoadmap(user.profile, diag, candidates);
    // 로드맵 항목에 공고 정보를 붙여서 저장
    for (const ph of result.phases || []) {
      for (const a of ph.actions || []) {
        const c = a.contestId && db.contests[a.contestId];
        if (c) a.contest = { id: c.id, title: c.title, deadline: c.deadline, category: c.category };
      }
    }
    db.plans[uid] = { result, basedOn: user.profileUpdatedAt, createdAt: now() };
    save();
    return { ...result, createdAt: now(), stale: false };
  });
});

const lastDiscover = new Map();
route('POST', '/api/discover', async ({ uid, body }) => {
  auth(uid);
  need(aiEnabled(), 503, '최신 공고 찾기는 서버에 Claude API 키가 연결되면 사용할 수 있어요');
  const query = clean(body.query, 40) || '대학생 공모전 대외활동';
  const wait = 120000 - (now() - (lastDiscover.get(uid) || 0));
  need(wait <= 0, 429, `조금 전에 검색했어요. ${Math.ceil(wait / 1000)}초 뒤에 다시 시도해주세요.`);
  return exclusive(`discover:${uid}`, async () => {
    lastDiscover.set(uid, now());
    const items = await discoverContests(query);
    const norm = s => s.replace(/\s|\[|\]|\(|\)/g, '').toLowerCase();
    const existing = new Set(Object.values(db.contests).map(c => norm(c.title)));
    const added = [];
    for (const it of items) {
      if (existing.has(norm(it.title))) continue;
      const c = {
        id: id(), title: clean(it.title, 80), host: clean(it.host, 40) || '주최 확인 필요',
        category: it.category, fields: it.fields.length ? it.fields : ['planning'],
        summary: clean(it.summary, 300), benefits: cleanArr(it.benefits, 5, 60),
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(it.deadline) ? it.deadline : '',
        teamType: it.teamType, mode: it.mode,
        weeklyHours: Math.min(40, Math.max(1, it.weeklyHours || 5)), difficulty: Math.min(3, Math.max(1, it.difficulty || 2)),
        eligibility: { grades: [], note: clean(it.eligibilityNote, 80) || '공고 확인 필요' },
        region: it.mode === 'online' ? '온라인' : '공고 확인', url: /^https?:\/\//.test(it.url) ? it.url : '',
        source: 'ai', query, createdAt: now(),
      };
      // 마감일을 모르는 공고는 30일 뒤로 두고 "마감일 확인 필요" 표시
      if (!c.deadline) { c.deadline = new Date(Date.parse(todayKST()) + 30 * 86400000).toISOString().slice(0, 10); c.deadlineUnknown = true; }
      db.contests[c.id] = c;
      existing.add(norm(c.title));
      added.push(c.id);
    }
    save();
    return { found: items.length, added: added.length, ids: added };
  });
});

// ---------- 서버 ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

function serveFile(res, pathname) {
  let file = path.normalize(path.join(PUBLIC_DIR, decodeURIComponent(pathname)));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(PUBLIC_DIR, 'index.html');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/api/')) return serveFile(res, url.pathname === '/' ? '/index.html' : url.pathname);

  const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const r = routes.find(r => r.method === req.method && r.re.test(url.pathname));
  if (!r) return send(404, { error: 'Not found' });
  try {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      need(raw.length <= MAX_BODY, 413, '요청이 너무 커요');
    }
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { fail(400, '잘못된 요청'); }
    const m = url.pathname.match(r.re);
    const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    const uid = db.sessions[token]?.userId || null;
    send(200, await r.handler({ params, query: Object.fromEntries(url.searchParams), body, token, uid }));
  } catch (e) {
    const known = e instanceof HttpError || e instanceof AIError;
    if (!known) console.error(e);
    send(known ? e.status : 500, { error: known ? e.message : '서버 오류' });
  }
});

async function main() {
  store = await createStore({ dataDir: DATA_DIR });
  db = store.db;
  if (!Object.keys(db.contests).length) {
    for (const c of sampleContests(id)) db.contests[c.id] = c;
    save();
  }
  console.log(`저장소: ${store.kind} · AI: ${aiEnabled() ? `켜짐 (Claude)` : '꺼짐 (ANTHROPIC_API_KEY 없음 → 규칙 기반 추천)'}`);

  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.once(sig, async () => {
      await store.flush().catch(e => console.error(e));
      process.exit(0);
    });
  }
  server.listen(PORT, () => console.log(`스펙핏 실행 중 → http://localhost:${PORT}`));
}

main().catch(e => {
  console.error('서버 시작 실패:', e.message);
  process.exit(1);
});
