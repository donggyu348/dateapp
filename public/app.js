// ================= 공통 =================
const $view = document.getElementById('view');
const $side = document.getElementById('side');
const $bottom = document.getElementById('bottom');
const $sheetRoot = document.getElementById('sheet-root');
const $toast = document.getElementById('toast');

let token = localStorage.getItem('specfit_token');
let me = null;
let META = null;

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dday = n => n === 0 ? 'D-DAY' : n > 0 ? `D-${n}` : '마감';
const fmtDate = s => { const d = new Date(s + 'T00:00'); return `${d.getMonth() + 1}.${d.getDate()}`; };
const ago = t => {
  const s = (Date.now() - t) / 1000;
  if (s < 60) return '방금';
  if (s < 3600) return `${Math.floor(s / 60)}분 전`;
  if (s < 86400) return `${Math.floor(s / 3600)}시간 전`;
  return `${Math.floor(s / 86400)}일 전`;
};
const AXIS_LABEL = { career: '직무 경험', award: '수상 경력', activity: '대외활동', language: '어학', skill: '자격·스킬', gpa: '학점' };
const AXIS_HINT = {
  career: '인턴·프로젝트·연구 경험', award: '공모전 수상·참가', activity: '대외활동·서포터즈·동아리·봉사',
  language: '어학 시험 점수', skill: '자격증과 보유 스킬', gpa: '학점 (입력한 경우)',
};
const SAVE_STATUS = { interested: '관심', preparing: '준비 중', applied: '지원 완료', done: '결과 발표' };

async function api(method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && token && !url.includes('/auth/login')) logout(true);
  if (!res.ok) { const e = new Error(data.error || '문제가 생겼어요'); e.status = res.status; throw e; }
  return data;
}

function toast(msg) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), 2600);
}

function openSheet(html, onMount) {
  $sheetRoot.innerHTML = `<div class="sheet-bg"></div><div class="sheet" role="dialog">${html}</div>`;
  const close = () => ($sheetRoot.innerHTML = '');
  $sheetRoot.querySelector('.sheet-bg').onclick = close;
  onMount?.($sheetRoot.querySelector('.sheet'), close);
  return close;
}

const scoreClass = s => s >= 80 ? 'great' : s >= 65 ? 'good' : s >= 45 ? 'ok' : 'low';
const ring = (score, size = 56, { unit = '%', title = `나와의 적합도 ${score}점` } = {}) => `
  <div class="ring ${scoreClass(score)}" style="--p:${score};--s:${size}px" title="${title}">
    <b>${score}</b>${unit ? `<small>${unit}</small>` : ''}
  </div>`;

function logout(expired = false) {
  if (token && !expired) api('POST', '/api/auth/logout').catch(() => {});
  token = null; me = null;
  localStorage.removeItem('specfit_token');
  if (expired) toast('다시 로그인해주세요');
  location.hash = '#/login';
}

// ================= 라우터 =================
const routes = [
  [/^#\/login$/, renderLogin, 'auth'],
  [/^#\/signup$/, renderSignup, 'auth'],
  [/^#\/home$/, renderHome],
  [/^#\/explore$/, renderExplore],
  [/^#\/c\/(\w+)$/, m => renderContest(m[1])],
  [/^#\/roadmap$/, renderRoadmap],
  [/^#\/me$/, renderMe],
  [/^#\/me\/edit$/, renderEditProfile],
];

async function router() {
  $sheetRoot.innerHTML = '';
  const hash = location.hash || '#/home';
  if (!META) META = await api('GET', '/api/meta');
  if (!me && token) { try { me = await api('GET', '/api/auth/me'); } catch { /* api()가 처리 */ } }

  for (const [re, fn, kind] of routes) {
    const m = hash.match(re);
    if (!m) continue;
    if (kind === 'auth' && me) { location.hash = '#/home'; return; }
    if (kind !== 'auth' && !me) { location.hash = '#/login'; return; }
    const tab = hash.split('/')[1];
    const shell = kind !== 'auth';
    $side.hidden = !shell;
    $bottom.hidden = !shell;
    document.body.classList.toggle('shell', shell);
    [...$side.querySelectorAll('a[data-tab]'), ...$bottom.querySelectorAll('a')].forEach(a =>
      a.classList.toggle('on', a.dataset.tab === (tab === 'c' ? 'explore' : tab)));
    document.getElementById('ai-status').innerHTML = META.ai
      ? '<span class="dot on"></span>AI 분석 켜짐<small>Claude가 맞춤 분석해요</small>'
      : '<span class="dot"></span>기본 추천 모드<small>API 키를 연결하면 AI 분석이 켜져요</small>';
    window.scrollTo(0, 0);
    $view.scrollTop = 0;
    fn(m);
    return;
  }
  location.hash = me ? '#/home' : '#/login';
}
window.addEventListener('hashchange', router);

const pageHead = (title, sub, actions = '') => `
  <header class="page-head">
    <div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>
    <div class="head-actions">${actions}</div>
  </header>`;

// ================= 로그인 =================
function renderLogin() {
  $view.innerHTML = `
    <div class="auth">
      <section class="auth-art">
        <div class="auth-brand"><span class="logo">S</span>스펙핏</div>
        <h1>흩어진 공모전 대신,<br/><em>나한테 맞는 것</em>만.</h1>
        <p>전공, 목표 직무, 지금까지의 경험을 알려주면<br/>어떤 활동이 스펙에 가장 도움이 될지 골라드려요.</p>
        <ul class="auth-points">
          <li><b>01</b>내 스펙 6가지 영역 진단</li>
          <li><b>02</b>공고마다 나와의 적합도 점수</li>
          <li><b>03</b>졸업까지 학기별 AI 로드맵</li>
        </ul>
        <div class="auth-card-preview" aria-hidden="true">
          <div class="ring great" style="--p:92;--s:48px"><b>92</b><small>%</small></div>
          <div><b>데이터 분석 경진대회</b><small>부족한 '수상 경력'을 채워줘요</small></div>
        </div>
      </section>
      <section class="auth-form-wrap">
        <form class="auth-form" id="login" novalidate>
          <h2>로그인</h2>
          <p class="muted">다시 오셨군요! 설계를 이어가요.</p>
          <label class="field"><span>아이디</span><input name="loginId" autocomplete="username" autocapitalize="off" spellcheck="false" /></label>
          <label class="field"><span>비밀번호</span>
            <div class="pw"><input name="password" type="password" autocomplete="current-password" /><button type="button" data-eye>보기</button></div></label>
          <p class="form-error" id="err" hidden></p>
          <button class="btn primary block lg" id="submit">로그인</button>
          <p class="center muted small">처음이신가요? <a class="link" href="#/signup">내 스펙 진단 시작하기 →</a></p>
        </form>
      </section>
    </div>`;
  bindEyes($view);
  const form = $view.querySelector('#login');
  const err = $view.querySelector('#err');
  form.onsubmit = async e => {
    e.preventDefault();
    err.hidden = true;
    const btn = $view.querySelector('#submit');
    btn.disabled = true;
    try {
      const res = await api('POST', '/api/auth/login', { loginId: form.loginId.value, password: form.password.value });
      token = res.token; me = res.user;
      localStorage.setItem('specfit_token', token);
      location.hash = '#/home';
    } catch (ex) {
      err.textContent = ex.message; err.hidden = false; btn.disabled = false;
    }
  };
}

function bindEyes(root) {
  root.querySelectorAll('[data-eye]').forEach(b => b.onclick = () => {
    const input = b.parentElement.querySelector('input');
    input.type = input.type === 'password' ? 'text' : 'password';
    b.textContent = input.type === 'password' ? '보기' : '숨기기';
  });
}

// ================= 프로필 입력 단계 (회원가입·수정 공통) =================
function blankProfile() {
  return {
    name: '', school: '', grade: null, major: '', subMajor: '', region: '',
    goal: '', fields: [], jobTitle: '', companyTypes: [], gradTerm: '',
    gpa: '', gpaMax: 4.5, langs: [], certs: [], exps: [],
    skills: [], strengths: [], categories: [], teamPref: 'any', modePref: 'any', weeklyHours: 8, busy: 'mid', concern: '',
  };
}

const chipGroup = (key, options, selected, { multi = true, max } = {}) => `
  <div class="chips" data-chips="${key}" data-multi="${multi}" ${max ? `data-max="${max}"` : ''}>
    ${Object.entries(options).map(([v, label]) => `<button type="button" data-v="${esc(v)}" class="chip ${(multi ? selected.includes(v) : String(selected) === String(v)) ? 'on' : ''}">${esc(label)}</button>`).join('')}
  </div>`;

const PROFILE_STEPS = [
  {
    key: 'basic', emoji: '🎓', title: '기본 정보', desc: '학교와 전공을 알려주세요',
    valid: p => p.name.trim() && p.school.trim() && p.major.trim() && p.grade,
    html: p => `
      <div class="grid2">
        <label class="field"><span>이름 (닉네임)</span><input data-k="name" value="${esc(p.name)}" maxlength="20" placeholder="김스펙" /></label>
        <label class="field"><span>학교</span><input data-k="school" value="${esc(p.school)}" maxlength="40" placeholder="한국대학교" /></label>
      </div>
      <div class="field"><span>학년</span>${chipGroup('grade', META.GRADES, p.grade, { multi: false })}</div>
      <div class="grid2">
        <label class="field"><span>주전공</span><input data-k="major" value="${esc(p.major)}" maxlength="40" placeholder="경영학과" /></label>
        <label class="field"><span>복수·부전공 <em>선택</em></span><input data-k="subMajor" value="${esc(p.subMajor)}" maxlength="40" placeholder="통계학과" /></label>
      </div>
      <label class="field"><span>활동 지역 <em>선택</em></span><input data-k="region" value="${esc(p.region)}" maxlength="20" placeholder="서울" /></label>`,
  },
  {
    key: 'goal', emoji: '🎯', title: '진로 목표', desc: '목표를 알아야 필요한 스펙을 거꾸로 설계할 수 있어요',
    valid: p => p.goal && p.fields.length,
    html: p => `
      <div class="field"><span>졸업 후 계획</span>${chipGroup('goal', META.GOALS, p.goal, { multi: false })}</div>
      <div class="field"><span>관심 분야 <em>최대 5개 · 먼저 고른 것이 1순위</em></span>${chipGroup('fields', META.FIELDS, p.fields, { max: 5 })}</div>
      <div class="grid2">
        <label class="field"><span>희망 직무 <em>선택</em></span><input data-k="jobTitle" value="${esc(p.jobTitle)}" maxlength="40" placeholder="예) 브랜드 마케터, 데이터 분석가" /></label>
        <label class="field"><span>졸업 예정 <em>선택</em></span><input data-k="gradTerm" value="${esc(p.gradTerm)}" maxlength="20" placeholder="예) 2028년 2월" /></label>
      </div>
      <div class="field"><span>희망 기업 유형 <em>선택</em></span>${chipGroup('companyTypes', META.COMPANY_TYPES, p.companyTypes)}</div>`,
  },
  {
    key: 'spec', emoji: '📋', title: '현재 스펙', desc: '없으면 비워둬도 괜찮아요. 빈 칸도 진단에 쓰여요',
    valid: () => true,
    html: p => `
      <div class="grid2">
        <label class="field"><span>학점 <em>선택</em></span>
          <div class="inline"><input data-k="gpa" type="number" step="0.01" min="0" max="4.5" value="${esc(p.gpa ?? '')}" placeholder="3.8" />
          <select data-k="gpaMax">${[4.5, 4.3].map(v => `<option ${Number(p.gpaMax) === v ? 'selected' : ''}>${v}</option>`).join('')}</select></div></label>
        <div class="field"><span>자격증 <em>입력 후 Enter</em></span>${tagInput('certs', p.certs, '예) 컴활 1급, ADsP')}</div>
      </div>
      <div class="field"><span>어학 점수</span>
        <div class="rows">${p.langs.map((l, i) => `
          <div class="row-item">
            <select data-list="langs" data-i="${i}" data-f="test">${META.LANG_TESTS.map(t => `<option ${l.test === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
            <input data-list="langs" data-i="${i}" data-f="score" value="${esc(l.score)}" placeholder="점수·등급" />
            <button type="button" class="x" data-rm="langs" data-i="${i}" aria-label="삭제">✕</button>
          </div>`).join('')}
        </div>
        <button type="button" class="btn ghost sm" data-add="langs">＋ 어학 점수 추가</button>
      </div>
      <div class="field"><span>지금까지의 경험 <em>인턴, 대외활동, 동아리, 프로젝트, 수상 등</em></span>
        <div class="rows">${p.exps.map((e, i) => `
          <div class="row-item exp">
            <select data-list="exps" data-i="${i}" data-f="type">${Object.entries(META.EXP_TYPES).map(([v, l]) => `<option value="${v}" ${e.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
            <input data-list="exps" data-i="${i}" data-f="title" value="${esc(e.title)}" placeholder="활동 이름 (예: OO기업 서포터즈 5기)" />
            <input data-list="exps" data-i="${i}" data-f="period" value="${esc(e.period)}" placeholder="기간 (선택)" class="period" />
            <button type="button" class="x" data-rm="exps" data-i="${i}" aria-label="삭제">✕</button>
          </div>`).join('')}
        </div>
        <button type="button" class="btn ghost sm" data-add="exps">＋ 경험 추가</button>
      </div>`,
  },
  {
    key: 'skill', emoji: '🛠️', title: '역량과 스타일', desc: '잘하는 것과 선호하는 활동 방식을 알려주세요',
    valid: () => true,
    html: p => {
      const suggest = [...new Set(p.fields.flatMap(f => META.SKILL_SUGGESTIONS[f] || []))].filter(s => !p.skills.includes(s)).slice(0, 10);
      return `
      <div class="field"><span>보유 스킬·툴 <em>입력 후 Enter</em></span>${tagInput('skills', p.skills, '예) Figma, Python, 영상편집')}
        ${suggest.length ? `<div class="suggest">추천: ${suggest.map(s => `<button type="button" data-suggest="${esc(s)}">＋ ${esc(s)}</button>`).join('')}</div>` : ''}</div>
      <div class="field"><span>나의 강점 <em>최대 5개</em></span>${chipGroup('strengths', Object.fromEntries(META.STRENGTHS.map(s => [s, s])), p.strengths, { max: 5 })}</div>
      <div class="field"><span>관심 있는 활동 유형 <em>선택</em></span>${chipGroup('categories', META.CATEGORIES, p.categories)}</div>
      <div class="grid2">
        <div class="field"><span>팀 / 개인</span>${chipGroup('teamPref', { team: '팀 활동', solo: '개인 활동', any: '상관없음' }, p.teamPref, { multi: false })}</div>
        <div class="field"><span>온라인 / 오프라인</span>${chipGroup('modePref', { online: '온라인', offline: '오프라인', any: '상관없음' }, p.modePref, { multi: false })}</div>
      </div>`;
    },
  },
  {
    key: 'time', emoji: '⏰', title: '시간과 고민', desc: '현실적으로 가능한 계획을 세우는 데 써요',
    valid: () => true,
    html: p => `
      <div class="field"><span>스펙 쌓기에 쓸 수 있는 시간</span>
        <div class="range"><input type="range" min="1" max="30" data-k="weeklyHours" value="${p.weeklyHours}" /><b id="hours-v">주 ${p.weeklyHours}시간</b></div>
        <div class="range-scale"><span>가볍게</span><span>꽤 많이</span></div></div>
      <div class="field"><span>이번 학기 바쁜 정도</span>${chipGroup('busy', { low: '여유 있어요', mid: '보통이에요', high: '많이 바빠요' }, p.busy, { multi: false })}</div>
      <label class="field"><span>요즘 스펙 고민 <em>선택 · AI가 참고해요</em></span>
        <textarea data-k="concern" maxlength="500" placeholder="예) 마케팅 쪽으로 가고 싶은데 경험이 동아리밖에 없어서 뭘 먼저 해야 할지 모르겠어요.">${esc(p.concern)}</textarea></label>`,
  },
];

function tagInput(key, values, placeholder) {
  return `<div class="tags" data-tags="${key}">
    ${values.map((v, i) => `<span class="tag">${esc(v)}<button type="button" data-untag="${key}" data-i="${i}" aria-label="삭제">✕</button></span>`).join('')}
    <input data-taginput="${key}" placeholder="${values.length ? '' : placeholder}" />
  </div>`;
}

// 한 단계의 입력을 profile 객체에 연결. 구조가 바뀌면 rerender() 호출
function bindProfileStep(root, p, rerender, onChange) {
  const changed = () => onChange?.();
  root.querySelectorAll('[data-k]').forEach(el => {
    el.addEventListener('input', () => {
      p[el.dataset.k] = el.type === 'range' || el.dataset.k === 'gpaMax' ? Number(el.value) : el.value;
      if (el.dataset.k === 'weeklyHours') root.querySelector('#hours-v').textContent = `주 ${el.value}시간`;
      changed();
    });
  });
  root.querySelectorAll('[data-chips]').forEach(group => {
    const key = group.dataset.chips;
    const multi = group.dataset.multi === 'true';
    const max = Number(group.dataset.max) || 99;
    group.querySelectorAll('[data-v]').forEach(b => b.onclick = () => {
      const v = key === 'grade' ? Number(b.dataset.v) : b.dataset.v;
      if (!multi) {
        p[key] = v;
        group.querySelectorAll('.chip').forEach(x => x.classList.toggle('on', x === b));
      } else if (p[key].includes(v)) {
        p[key] = p[key].filter(x => x !== v);
        b.classList.remove('on');
      } else {
        if (p[key].length >= max) return toast(`최대 ${max}개까지 고를 수 있어요`);
        p[key].push(v);
        b.classList.add('on');
      }
      if (key === 'fields' && root.querySelector('.suggest')) rerender();
      changed();
    });
  });
  root.querySelectorAll('[data-list]').forEach(el => {
    el.addEventListener('input', () => { p[el.dataset.list][Number(el.dataset.i)][el.dataset.f] = el.value; changed(); });
  });
  root.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    p[b.dataset.add].push(b.dataset.add === 'langs' ? { test: 'TOEIC', score: '' } : { type: 'activity', title: '', period: '' });
    rerender();
    const inputs = root.querySelectorAll(`[data-list="${b.dataset.add}"][data-f="${b.dataset.add === 'langs' ? 'score' : 'title'}"]`);
    inputs[inputs.length - 1]?.focus();
  });
  root.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { p[b.dataset.rm].splice(Number(b.dataset.i), 1); rerender(); changed(); });
  root.querySelectorAll('[data-taginput]').forEach(input => {
    const key = input.dataset.taginput;
    const add = () => {
      const v = input.value.trim().replace(/,$/, '');
      if (v && !p[key].includes(v)) { p[key].push(v); rerender(); root.querySelector(`[data-taginput="${key}"]`)?.focus(); changed(); }
      else input.value = '';
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
      if (e.key === 'Backspace' && !input.value && p[key].length) { p[key].pop(); rerender(); root.querySelector(`[data-taginput="${key}"]`)?.focus(); changed(); }
    });
    input.addEventListener('blur', () => { if (input.value.trim()) add(); });
  });
  root.querySelectorAll('[data-untag]').forEach(b => b.onclick = () => { p[b.dataset.untag].splice(Number(b.dataset.i), 1); rerender(); changed(); });
  root.querySelectorAll('[data-suggest]').forEach(b => b.onclick = () => { p.skills.push(b.dataset.suggest); rerender(); changed(); });
}

// ================= 회원가입 (계정 + 프로필 5단계) =================
function renderSignup() {
  const account = { loginId: '', password: '', password2: '', idOk: false };
  const p = blankProfile();
  let step = 0; // 0 = 계정, 1~5 = 프로필
  const TOTAL = PROFILE_STEPS.length + 1;

  const draw = () => {
    const s = step === 0 ? { emoji: '🔐', title: '계정 만들기', desc: '진단 결과와 로드맵을 저장할 계정이에요' } : PROFILE_STEPS[step - 1];
    $view.innerHTML = `
      <div class="onboard">
        <aside class="onboard-side">
          <a class="auth-brand" href="#/login"><span class="logo">S</span>스펙핏</a>
          <ol class="steps">${[{ title: '계정 만들기' }, ...PROFILE_STEPS].map((x, i) => `
            <li class="${i === step ? 'on' : i < step ? 'done' : ''}"><span>${i < step ? '✓' : i + 1}</span>${x.title}</li>`).join('')}</ol>
          <p class="small">입력할수록 추천이 정확해져요.<br/>모든 정보는 언제든 수정할 수 있어요.</p>
        </aside>
        <section class="onboard-main">
          <div class="progress"><i style="width:${((step + 1) / TOTAL) * 100}%"></i></div>
          <div class="onboard-body">
            <div class="step-emoji">${s.emoji}</div>
            <h1>${s.title}</h1>
            <p class="muted">${s.desc}</p>
            <div id="step-fields" class="step-fields"></div>
          </div>
          <footer class="onboard-foot">
            <button class="btn ghost" id="prev">${step === 0 ? '로그인으로' : '이전'}</button>
            <span class="muted small">${step + 1} / ${TOTAL}</span>
            <button class="btn primary" id="next" disabled>${step === TOTAL - 1 ? '진단 결과 보기 ✨' : '다음'}</button>
          </footer>
        </section>
      </div>`;
    $view.querySelector('#prev').onclick = () => { if (step === 0) location.hash = '#/login'; else { step--; draw(); } };
    const next = $view.querySelector('#next');
    const fields = $view.querySelector('#step-fields');

    if (step === 0) {
      fields.innerHTML = `
        <label class="field"><span>아이디</span><input id="loginId" value="${esc(account.loginId)}" maxlength="16" placeholder="영문 소문자·숫자 4~16자" autocomplete="username" autocapitalize="off" spellcheck="false" /><small class="hint" id="id-hint"></small></label>
        <label class="field"><span>비밀번호</span><div class="pw"><input id="pw" type="password" value="${esc(account.password)}" placeholder="8자 이상" autocomplete="new-password" /><button type="button" data-eye>보기</button></div><small class="hint" id="pw-hint"></small></label>
        <label class="field"><span>비밀번호 확인</span><div class="pw"><input id="pw2" type="password" value="${esc(account.password2)}" autocomplete="new-password" /><button type="button" data-eye>보기</button></div><small class="hint" id="pw2-hint"></small></label>`;
      bindEyes(fields);
      const hint = (id, text, cls = '') => { const el = fields.querySelector('#' + id); el.textContent = text; el.className = 'hint ' + cls; };
      let t, seq = 0;
      const validate = () => {
        const pw = account.password;
        hint('pw-hint', !pw ? '' : pw.length < 8 ? '8자 이상 입력해주세요' : /\d/.test(pw) && /[a-zA-Z]/.test(pw) ? '✓ 안전한 비밀번호예요' : '영문과 숫자를 섞으면 더 안전해요', !pw ? '' : pw.length < 8 ? 'err' : 'ok');
        hint('pw2-hint', !account.password2 ? '' : account.password2 === pw ? '✓ 일치해요' : '비밀번호가 달라요', account.password2 === pw ? 'ok' : 'err');
        next.disabled = !(account.idOk && pw.length >= 8 && pw === account.password2);
      };
      const checkId = () => {
        clearTimeout(t);
        account.idOk = false;
        const v = account.loginId;
        if (!v) hint('id-hint', '');
        else if (!/^[a-z0-9_.]{4,16}$/.test(v)) hint('id-hint', '영문 소문자·숫자 4~16자로 입력해주세요', 'err');
        else {
          hint('id-hint', '확인 중…');
          const my = ++seq;
          t = setTimeout(async () => {
            const { available } = await api('GET', `/api/auth/check-id?loginId=${encodeURIComponent(v)}`);
            if (my !== seq) return;
            account.idOk = available;
            hint('id-hint', available ? '✓ 사용할 수 있어요' : '이미 사용 중인 아이디예요', available ? 'ok' : 'err');
            validate();
          }, 300);
        }
        validate();
      };
      fields.querySelector('#loginId').oninput = e => { account.loginId = e.target.value = e.target.value.toLowerCase().replace(/\s/g, ''); checkId(); };
      fields.querySelector('#pw').oninput = e => { account.password = e.target.value; validate(); };
      fields.querySelector('#pw2').oninput = e => { account.password2 = e.target.value; validate(); };
      if (account.loginId) checkId(); else validate();
      next.onclick = () => { step++; draw(); };
      fields.querySelector('#loginId').focus();
      return;
    }

    const def = PROFILE_STEPS[step - 1];
    const drawFields = () => {
      fields.innerHTML = def.html(p);
      bindProfileStep(fields, p, drawFields, () => (next.disabled = !def.valid(p)));
      next.disabled = !def.valid(p);
    };
    drawFields();
    next.onclick = async () => {
      if (step < TOTAL - 1) { step++; draw(); window.scrollTo(0, 0); return; }
      next.disabled = true;
      next.textContent = '스펙 분석 중…';
      try {
        const res = await api('POST', '/api/auth/signup', { loginId: account.loginId, password: account.password, profile: toPayload(p) });
        token = res.token; me = res.user;
        localStorage.setItem('specfit_token', token);
        toast(`${me.profile.name}님, 스펙 진단이 끝났어요 ✨`);
        location.hash = '#/home';
      } catch (e) {
        toast(e.message);
        next.disabled = false;
        next.textContent = '진단 결과 보기 ✨';
      }
    };
  };
  draw();
}

const toPayload = p => ({
  ...p,
  gpa: p.gpa === '' || p.gpa == null ? null : Number(p.gpa),
  langs: p.langs.filter(l => l.score.trim()),
  exps: p.exps.filter(e => e.title.trim()),
});

// ================= 홈 (대시보드) =================
async function renderHome() {
  $view.innerHTML = `<div class="page">${pageHead(`${esc(me.profile.name)}님의 스펙 설계`, '불러오는 중…')}<div class="skeleton"></div></div>`;
  let d;
  try { d = await api('GET', '/api/dashboard'); } catch (e) { return toast(e.message); }
  const p = me.profile;
  const axes = Object.entries(d.diag.axes);

  $view.innerHTML = `
    <div class="page">
      ${pageHead(`${esc(p.name)}님의 스펙 설계`, `${esc(p.school)} · ${esc(p.major)} · ${esc(META.GRADES[p.grade] || '')} · 목표 ${esc(META.GOALS[p.goal])}${p.jobTitle ? ` (${esc(p.jobTitle)})` : ''}`,
        `<a class="btn ghost" href="#/me/edit">프로필 수정</a>`)}

      <div class="stat-row">
        <div class="stat"><small>지금 지원 가능한 공고</small><b>${d.counts.open}</b></div>
        <div class="stat"><small>나와 잘 맞는 공고 <em>70점 이상</em></small><b class="accent">${d.counts.goodFit}</b></div>
        <div class="stat"><small>저장한 활동</small><b>${d.counts.saved}</b></div>
        <div class="stat"><small>지원 완료</small><b>${d.counts.applied}</b></div>
      </div>

      <div class="cols">
        <section class="card diag">
          <div class="card-head"><h2>스펙 진단</h2><span class="muted small">입력한 경험 기준 · 0~100</span></div>
          <div class="diag-body">
            <div class="diag-total">
              ${ring(d.diag.total, 120, { unit: '점', title: `종합 스펙 지수 ${d.diag.total}점 (100점 만점)` })}
              <p>종합 스펙 지수</p>
            </div>
            <ul class="bars">${axes.map(([k, v]) => `
              <li title="${AXIS_LABEL[k]}: ${v}점 — ${AXIS_HINT[k]}">
                <span class="bar-label">${AXIS_LABEL[k]}${d.diag.gaps.includes(k) ? '<i class="gap-flag">보완</i>' : ''}</span>
                <span class="bar-track"><span class="bar-fill" style="width:${Math.max(v, 2)}%"></span></span>
                <b class="bar-val">${v}</b>
              </li>`).join('')}</ul>
          </div>
          ${d.diag.gaps.length ? `<p class="diag-note">💡 지금은 <b>${d.diag.gaps.map(g => AXIS_LABEL[g]).join(', ')}</b>을(를) 채워주는 활동의 추천 점수가 높아요.</p>` : ''}
        </section>

        <section class="card plan-card">
          <div class="card-head"><h2>🗺️ AI 로드맵</h2>${d.plan ? `<span class="muted small">${ago(d.plan.createdAt)} 설계</span>` : ''}</div>
          ${d.plan ? `
            ${d.plan.stale ? '<p class="stale">프로필이 바뀌었어요. 다시 설계하면 더 정확해져요.</p>' : ''}
            <p class="plan-summary">${esc(d.plan.summary)}</p>
            <h3>이번 주 할 일</h3>
            <ul class="todo">${(d.plan.thisWeek || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
            <a class="btn ghost block" href="#/roadmap">전체 로드맵 보기 →</a>`
          : `
            <p class="muted">내 목표와 부족한 스펙을 바탕으로 졸업까지 학기별 활동 계획을 설계해요.</p>
            <a class="btn primary block" href="#/roadmap">로드맵 설계하기 ✨</a>`}
        </section>
      </div>

      <section class="section">
        <div class="section-head"><h2>나에게 딱 맞는 활동</h2><a class="link" href="#/explore">전체 보기 →</a></div>
        <div class="cards">${d.top.map(contestCard).join('')}</div>
      </section>

      ${d.soon.length ? `
      <section class="section">
        <div class="section-head"><h2>⏰ 준비 중인 활동 마감</h2><a class="link" href="#/me">활동 관리 →</a></div>
        <div class="cards">${d.soon.map(contestCard).join('')}</div>
      </section>` : ''}
    </div>`;
  bindCards($view);
}

function contestCard(c) {
  return `
    <article class="ccard" data-go="${c.id}">
      <div class="ccard-top">
        ${ring(c.match.score)}
        <div class="ccard-meta">
          <span class="badge">${esc(META.CATEGORIES[c.category])}</span>
          <span class="dday ${c.match.daysLeft <= 3 ? 'hot' : ''}">${dday(c.match.daysLeft)}</span>
          ${c.source === 'sample' ? '<span class="badge sample" title="실제 공고가 아닌 예시 데이터예요">샘플</span>' : c.source === 'ai' ? '<span class="badge ai" title="AI가 웹에서 찾아온 공고예요">AI 수집</span>' : ''}
        </div>
        <button class="save ${c.saved ? 'on' : ''}" data-save="${c.id}" aria-label="저장">${c.saved ? '★' : '☆'}</button>
      </div>
      <h3>${esc(c.title)}</h3>
      <p class="host">${esc(c.host)} · ~${fmtDate(c.deadline)}${c.deadlineUnknown ? ' (확인 필요)' : ''}</p>
      <p class="reason">${c.match.reasons[0] ? `✓ ${esc(c.match.reasons[0])}` : esc(c.summary)}</p>
      ${c.match.warnings[0] ? `<p class="warn">⚠ ${esc(c.match.warnings[0])}</p>` : ''}
      <div class="ccard-tags">${c.fields.slice(0, 3).map(f => `<span>#${esc(META.FIELDS[f])}</span>`).join('')}</div>
    </article>`;
}

function bindCards(root) {
  root.querySelectorAll('[data-go]').forEach(el => el.onclick = e => {
    if (e.target.closest('[data-save]')) return;
    location.hash = '#/c/' + el.dataset.go;
  });
  root.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const next = b.classList.contains('on') ? null : 'interested';
    try {
      await api('POST', `/api/contests/${b.dataset.save}/save`, { status: next });
      b.classList.toggle('on', !!next);
      b.textContent = next ? '★' : '☆';
      toast(next ? '관심 활동에 저장했어요' : '저장을 취소했어요');
    } catch (e) { toast(e.message); }
  });
}

// ================= 탐색 =================
const exploreState = { q: '', category: '', field: '', sort: 'fit', saved: false };

async function renderExplore() {
  const s = exploreState;
  $view.innerHTML = `
    <div class="page">
      ${pageHead('공고 탐색', '모든 공고에 나와의 적합도 점수를 붙였어요',
        `<button class="btn primary" id="discover">🔎 AI로 최신 공고 찾기</button>`)}
      <div class="filters">
        <div class="search"><span>⌕</span><input id="q" value="${esc(s.q)}" placeholder="공고 이름, 주최, 키워드 검색" /></div>
        <select id="field"><option value="">모든 분야</option>${Object.entries(META.FIELDS).map(([v, l]) => `<option value="${v}" ${s.field === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <div class="seg" id="sort">
          <button data-sort="fit" class="${s.sort === 'fit' ? 'on' : ''}">적합도순</button>
          <button data-sort="deadline" class="${s.sort === 'deadline' ? 'on' : ''}">마감순</button>
        </div>
        <label class="check"><input type="checkbox" id="saved" ${s.saved ? 'checked' : ''} /> 저장한 것만</label>
      </div>
      <div class="chips scroll" id="cats">
        <button class="chip ${!s.category ? 'on' : ''}" data-cat="">전체</button>
        ${Object.entries(META.CATEGORIES).map(([v, l]) => `<button class="chip ${s.category === v ? 'on' : ''}" data-cat="${v}">${l}</button>`).join('')}
      </div>
      <p class="muted small" id="count"></p>
      <div class="cards" id="list"><div class="skeleton"></div></div>
    </div>`;

  const load = async () => {
    const qs = new URLSearchParams({ q: s.q, category: s.category, field: s.field, sort: s.sort, ...(s.saved && { saved: 1 }) });
    try {
      const list = await api('GET', '/api/contests?' + qs);
      $view.querySelector('#count').textContent = `${list.length}개 공고 · ${s.sort === 'fit' ? '나와 잘 맞는 순' : '마감 임박 순'}`;
      const el = $view.querySelector('#list');
      el.innerHTML = list.length ? list.map(contestCard).join('') : `<div class="empty"><b>조건에 맞는 공고가 없어요</b><p>필터를 바꾸거나 AI로 최신 공고를 찾아보세요.</p></div>`;
      bindCards(el);
    } catch (e) { toast(e.message); }
  };
  let t;
  $view.querySelector('#q').oninput = e => { s.q = e.target.value; clearTimeout(t); t = setTimeout(load, 250); };
  $view.querySelector('#field').onchange = e => { s.field = e.target.value; load(); };
  $view.querySelector('#saved').onchange = e => { s.saved = e.target.checked; load(); };
  $view.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
    s.sort = b.dataset.sort;
    $view.querySelectorAll('[data-sort]').forEach(x => x.classList.toggle('on', x === b));
    load();
  });
  $view.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    s.category = b.dataset.cat;
    $view.querySelectorAll('[data-cat]').forEach(x => x.classList.toggle('on', x === b));
    load();
  });
  $view.querySelector('#discover').onclick = openDiscover;
  load();
}

function openDiscover() {
  const p = me.profile;
  const suggestions = [...p.fields.map(f => `${META.FIELDS[f]} 공모전`), p.jobTitle && `${p.jobTitle} 대외활동`, '대학생 서포터즈'].filter(Boolean).slice(0, 4);
  openSheet(`
    <h3>🔎 AI로 최신 공고 찾기</h3>
    <p class="muted">Claude가 웹에서 지금 모집 중인 공고를 찾아 목록에 추가해요. 1~2분 정도 걸려요.</p>
    ${META.ai ? '' : '<p class="stale">서버에 Claude API 키가 연결되지 않아 지금은 사용할 수 없어요.</p>'}
    <label class="field"><span>찾을 키워드</span><input id="dq" value="${esc(suggestions[0] || '')}" maxlength="40" /></label>
    <div class="suggest">${suggestions.map(s => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join('')}</div>
    <div class="sheet-actions">
      <button class="btn ghost" id="dc">닫기</button>
      <button class="btn primary" id="dgo" ${META.ai ? '' : 'disabled'}>찾기</button>
    </div>
    <div id="dprog" hidden class="progress-note"></div>
  `, (sheet, close) => {
    sheet.querySelectorAll('[data-q]').forEach(b => b.onclick = () => (sheet.querySelector('#dq').value = b.dataset.q));
    sheet.querySelector('#dc').onclick = close;
    sheet.querySelector('#dgo').onclick = async () => {
      const btn = sheet.querySelector('#dgo');
      const prog = sheet.querySelector('#dprog');
      btn.disabled = true;
      prog.hidden = false;
      const stop = cycle(prog, ['웹에서 공고 검색 중…', '공식 공고 페이지 확인 중…', '마감일·지원 자격 정리 중…', '내 프로필과 비교 준비 중…']);
      try {
        const r = await api('POST', '/api/discover', { query: sheet.querySelector('#dq').value });
        stop();
        close();
        toast(r.added ? `새 공고 ${r.added}개를 추가했어요 🎉` : `공고 ${r.found}개를 찾았지만 이미 있거나 마감됐어요`);
        exploreState.sort = 'fit';
        renderExplore();
      } catch (e) { stop(); prog.textContent = e.message; btn.disabled = false; }
    };
  });
}

// 긴 AI 작업 중 진행 문구를 돌려가며 보여줌
function cycle(el, msgs, ms = 2600) {
  let i = 0;
  el.innerHTML = `<span class="spinner"></span>${msgs[0]}`;
  const t = setInterval(() => { i = (i + 1) % msgs.length; el.innerHTML = `<span class="spinner"></span>${msgs[i]}`; }, ms);
  return () => clearInterval(t);
}

// ================= 공고 상세 =================
async function renderContest(cid) {
  $view.innerHTML = `<div class="page"><div class="skeleton"></div></div>`;
  let c;
  try { c = await api('GET', `/api/contests/${cid}`); } catch (e) {
    $view.innerHTML = `<div class="page"><div class="empty"><b>${esc(e.message)}</b><p><a class="link" href="#/explore">탐색으로 돌아가기</a></p></div></div>`;
    return;
  }
  const m = c.match;
  const diffDots = '●'.repeat(c.difficulty) + '○'.repeat(3 - c.difficulty);

  $view.innerHTML = `
    <div class="page detail">
      <a class="back-link" href="#/explore">← 공고 탐색</a>
      <header class="detail-head">
        <div class="ccard-meta">
          <span class="badge">${esc(META.CATEGORIES[c.category])}</span>
          <span class="dday ${m.daysLeft <= 3 ? 'hot' : ''}">${dday(m.daysLeft)}</span>
          ${c.source === 'sample' ? '<span class="badge sample">샘플 데이터</span>' : c.source === 'ai' ? '<span class="badge ai">AI 수집</span>' : ''}
        </div>
        <h1>${esc(c.title)}</h1>
        <p class="muted">${esc(c.host)} · 마감 ${esc(c.deadline)}${c.deadlineUnknown ? ' (공고에서 확인 필요)' : ''}</p>
        <div class="facts">
          <span>👥 ${{ team: '팀 참여', solo: '개인 참여', both: '팀·개인' }[c.teamType]}</span>
          <span>📍 ${{ online: '온라인', offline: '오프라인', hybrid: '온·오프라인' }[c.mode]}</span>
          <span>⏱ 주 ${c.weeklyHours}시간</span>
          <span title="난이도">📈 난이도 ${diffDots}</span>
        </div>
      </header>

      <div class="cols detail-cols">
        <div class="stack">
          <section class="card">
            <h2>활동 내용</h2>
            <p>${esc(c.summary)}</p>
            <h3>혜택</h3>
            <ul class="benefits">${c.benefits.map(b => `<li>🎁 ${esc(b)}</li>`).join('')}</ul>
            <h3>지원 자격</h3>
            <p>${esc(c.eligibility?.note || '-')}</p>
            <div class="tag-row">${c.fields.map(f => `<span>#${esc(META.FIELDS[f])}</span>`).join('')}</div>
            ${c.url ? `<a class="btn ghost" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">공고 원문 보기 ↗</a>` : c.source === 'sample' ? '<p class="muted small">샘플 데이터라 원문 링크가 없어요.</p>' : ''}
          </section>

          <section class="card ai-card" id="ai-card"></section>
        </div>

        <aside class="stack">
          <section class="card fit-card">
            <div class="fit-top">${ring(m.score, 88)}<div><b>나와의 적합도</b><p class="muted small">프로필·스펙 진단 기준</p></div></div>
            ${m.reasons.length ? `<ul class="reasons">${m.reasons.map(r => `<li>✓ ${esc(r)}</li>`).join('')}</ul>` : ''}
            ${m.warnings.length ? `<ul class="warnings">${m.warnings.map(w => `<li>⚠ ${esc(w)}</li>`).join('')}</ul>` : ''}
          </section>
          <section class="card">
            <h2>내 진행 상태</h2>
            <div class="stepper" id="stepper">
              ${Object.entries(SAVE_STATUS).map(([k, l]) => `<button data-st="${k}" class="${c.saved === k ? 'on' : ''}">${l}</button>`).join('')}
            </div>
            <p class="muted small">${c.saved ? '다시 누르면 저장이 취소돼요' : '관심 있으면 저장해두세요'}</p>
          </section>
        </aside>
      </div>
    </div>`;

  $view.querySelectorAll('[data-st]').forEach(b => b.onclick = async () => {
    const next = b.classList.contains('on') ? null : b.dataset.st;
    try {
      await api('POST', `/api/contests/${cid}/save`, { status: next });
      $view.querySelectorAll('[data-st]').forEach(x => x.classList.toggle('on', x.dataset.st === next));
      toast(next ? `'${SAVE_STATUS[next]}'(으)로 저장했어요` : '저장을 취소했어요');
    } catch (e) { toast(e.message); }
  });
  drawAnalysis(c);
}

function drawAnalysis(c) {
  const el = $view.querySelector('#ai-card');
  const a = c.analysis;
  if (!a) {
    el.innerHTML = `
      <h2>🤖 AI 심층 분석</h2>
      <p class="muted">내 프로필과 이 공고를 비교해서 지원할지, 어떻게 준비할지, 자소서에 어떻게 쓸지까지 알려드려요.</p>
      ${META.ai ? '' : '<p class="stale">서버에 Claude API 키가 연결되면 사용할 수 있어요. 지금은 오른쪽의 기본 적합도를 참고하세요.</p>'}
      <button class="btn primary" id="analyze" ${META.ai ? '' : 'disabled'}>AI로 분석하기</button>
      <div id="aprog" class="progress-note" hidden></div>`;
    const btn = el.querySelector('#analyze');
    btn.onclick = async () => {
      btn.disabled = true;
      const prog = el.querySelector('#aprog');
      prog.hidden = false;
      const stop = cycle(prog, ['프로필 읽는 중…', '공고 조건과 비교 중…', '준비 일정 짜는 중…', '자소서 활용법 정리 중…']);
      try {
        c.analysis = await api('POST', `/api/contests/${c.id}/analyze`);
        stop();
        drawAnalysis(c);
      } catch (e) { stop(); prog.textContent = e.message; btn.disabled = false; }
    };
    return;
  }
  const vClass = { '강력 추천': 'great', '추천': 'good', '고민 필요': 'ok', '비추천': 'low' }[a.verdict];
  el.innerHTML = `
    <div class="card-head"><h2>🤖 AI 심층 분석</h2><span class="muted small">${ago(a.createdAt)}</span></div>
    ${a.stale ? '<p class="stale">프로필이 바뀌었어요. 다시 분석하면 더 정확해요.</p>' : ''}
    <div class="verdict ${vClass}"><b>${esc(a.verdict)}</b><span>AI 적합도 ${a.fit}점</span></div>
    <p>${esc(a.summary)}</p>
    <div class="grid2">
      <div><h3>👍 유리한 점</h3><ul class="reasons">${a.strengths.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
      <div><h3>🤔 주의할 점</h3><ul class="warnings">${a.risks.map(s => `<li>${esc(s)}</li>`).join('')}</ul></div>
    </div>
    <h3>📅 준비 계획</h3>
    <ol class="timeline">${a.prepPlan.map(s => `<li><b>${esc(s.when)}</b><span>${esc(s.task)}</span></li>`).join('')}</ol>
    <h3>✍️ 자소서·면접 활용</h3>
    <blockquote>${esc(a.storyAngle)}</blockquote>
    <button class="btn ghost sm" id="reanalyze">다시 분석하기</button>`;
  el.querySelector('#reanalyze').onclick = () => { c.analysis = null; drawAnalysis(c); el.querySelector('#analyze')?.click(); };
}

// ================= AI 로드맵 =================
async function renderRoadmap() {
  $view.innerHTML = `<div class="page">${pageHead('AI 스펙 로드맵', '')}<div class="skeleton"></div></div>`;
  let plan;
  try { plan = await api('GET', '/api/roadmap'); } catch (e) { return toast(e.message); }

  const generate = async () => {
    $view.innerHTML = `
      <div class="page"><div class="generating">
        <div class="gen-orb"></div>
        <h2>${META.ai ? 'AI가 로드맵을 설계하고 있어요' : '로드맵을 만들고 있어요'}</h2>
        <p id="gen-msg" class="progress-note"></p>
        <p class="muted small">${META.ai ? '프로필이 자세할수록 오래 걸려요 (보통 30초~1분)' : ''}</p>
      </div></div>`;
    const stop = cycle($view.querySelector('#gen-msg'), ['프로필과 목표 직무 읽는 중…', '스펙 진단 결과 분석 중…', '지원 가능한 공고 비교 중…', '학기별 계획 짜는 중…', '이번 주 할 일 정리 중…'], 3000);
    try {
      plan = await api('POST', '/api/roadmap');
      stop();
      draw();
    } catch (e) { stop(); toast(e.message); renderRoadmap(); }
  };

  const draw = () => {
    if (!plan) {
      $view.innerHTML = `
        <div class="page">
          ${pageHead('AI 스펙 로드맵', '졸업까지, 무엇을 언제 하면 좋을지')}
          <section class="card roadmap-empty">
            <div class="big-emoji">🗺️</div>
            <h2>나만의 스펙 로드맵을 설계해볼까요?</h2>
            <p class="muted">목표 직무, 지금 스펙, 여유 시간, 그리고 지금 지원할 수 있는 공고를 모두 고려해서<br/>시기별로 무엇을 하면 좋을지 계획을 세워드려요.</p>
            <button class="btn primary lg" id="gen">로드맵 설계하기 ✨</button>
            ${META.ai ? '' : '<p class="muted small">지금은 기본 추천 모드예요. Claude API 키를 연결하면 AI가 더 자세히 설계해요.</p>'}
          </section>
        </div>`;
      $view.querySelector('#gen').onclick = generate;
      return;
    }
    const doneKey = `specfit_week_${me.id}_${plan.createdAt}`;
    let done = [];
    try { done = JSON.parse(localStorage.getItem(doneKey) || '[]'); } catch { /* 무시 */ }

    $view.innerHTML = `
      <div class="page">
        ${pageHead('AI 스펙 로드맵', `${ago(plan.createdAt)} 설계 · ${plan.ai ? 'Claude AI 설계' : '기본 추천 엔진 설계'}`,
          `<button class="btn ghost" id="regen">다시 설계하기</button>`)}
        ${plan.stale ? '<p class="stale">프로필이 바뀌었어요. 다시 설계하면 최신 정보가 반영돼요.</p>' : ''}

        <section class="card roadmap-hero">
          <p class="plan-summary">${esc(plan.summary)}</p>
          ${plan.persona ? `<p class="persona">🎯 목표 인재상 · <b>${esc(plan.persona)}</b></p>` : ''}
          <div class="grid2">
            ${plan.strengths?.length ? `<div><h3>강점</h3><ul class="reasons">${plan.strengths.map(s => `<li>✓ ${esc(s)}</li>`).join('')}</ul></div>` : ''}
            ${plan.gaps?.length ? `<div><h3>보완할 점</h3><ul class="warnings">${plan.gaps.map(s => `<li>△ ${esc(s)}</li>`).join('')}</ul></div>` : ''}
          </div>
        </section>

        <div class="cols">
          <section class="card">
            <h2>시기별 계획</h2>
            <ol class="phases">${(plan.phases || []).map((ph, i) => `
              <li>
                <div class="phase-dot">${i + 1}</div>
                <div class="phase-body">
                  <small>${esc(ph.period)}</small>
                  <h3>${esc(ph.focus)}</h3>
                  ${(ph.actions || []).map(a => `
                    <div class="action ${a.contest ? 'linked' : ''}" ${a.contest ? `data-go="${a.contest.id}"` : ''}>
                      <span class="badge">${esc(a.type || '활동')}</span>
                      <div><b>${esc(a.title)}</b>${a.contest ? ` <span class="dday">~${fmtDate(a.contest.deadline)}</span>` : ''}<p>${esc(a.why)}</p></div>
                      ${a.contest ? '<span class="arrow">→</span>' : ''}
                    </div>`).join('')}
                </div>
              </li>`).join('')}</ol>
          </section>
          <div class="stack">
            <section class="card">
              <h2>✅ 이번 주 할 일</h2>
              <ul class="checklist">${(plan.thisWeek || []).map((t, i) => `
                <li><label><input type="checkbox" data-done="${i}" ${done.includes(i) ? 'checked' : ''} /><span>${esc(t)}</span></label></li>`).join('')}</ul>
            </section>
            ${plan.longTerm?.length ? `
            <section class="card">
              <h2>📌 장기 목표</h2>
              <ul class="todo">${plan.longTerm.map(t => `<li>${esc(t)}</li>`).join('')}</ul>
            </section>` : ''}
          </div>
        </div>
      </div>`;
    $view.querySelector('#regen').onclick = generate;
    $view.querySelectorAll('[data-go]').forEach(el => el.onclick = () => (location.hash = '#/c/' + el.dataset.go));
    $view.querySelectorAll('[data-done]').forEach(cb => cb.onchange = () => {
      const i = Number(cb.dataset.done);
      done = cb.checked ? [...new Set([...done, i])] : done.filter(x => x !== i);
      try { localStorage.setItem(doneKey, JSON.stringify(done)); } catch { /* 무시 */ }
    });
  };
  draw();
}

// ================= 내 스펙 =================
async function renderMe() {
  const p = me.profile;
  $view.innerHTML = `
    <div class="page">
      ${pageHead('내 스펙', `@${esc(me.loginId)}`, `<a class="btn ghost" href="#/me/edit">프로필 수정</a><button class="btn ghost" id="logout">로그아웃</button>`)}
      <div class="cols">
        <section class="card profile-card">
          <div class="avatar">${esc(p.name.slice(0, 1))}</div>
          <h2>${esc(p.name)}</h2>
          <p class="muted">${esc(p.school)} · ${esc(p.major)}${p.subMajor ? ` / ${esc(p.subMajor)}` : ''} · ${esc(META.GRADES[p.grade] || '')}</p>
          <dl>
            <dt>목표</dt><dd>${esc(META.GOALS[p.goal])}${p.jobTitle ? ` · ${esc(p.jobTitle)}` : ''}</dd>
            <dt>관심 분야</dt><dd>${p.fields.map(f => esc(META.FIELDS[f])).join(', ')}</dd>
            <dt>학점</dt><dd>${p.gpa ? `${p.gpa} / ${p.gpaMax}` : '-'}</dd>
            <dt>어학</dt><dd>${p.langs.map(l => `${esc(l.test)} ${esc(l.score)}`).join(', ') || '-'}</dd>
            <dt>자격증</dt><dd>${p.certs.map(esc).join(', ') || '-'}</dd>
            <dt>스킬</dt><dd>${p.skills.map(esc).join(', ') || '-'}</dd>
            <dt>시간</dt><dd>주 ${p.weeklyHours}시간</dd>
          </dl>
          <h3>경험 ${p.exps.length}개</h3>
          <ul class="exp-list">${p.exps.map(e => `<li><span class="badge">${esc(META.EXP_TYPES[e.type])}</span>${esc(e.title)}${e.period ? ` <small>${esc(e.period)}</small>` : ''}</li>`).join('') || '<li class="muted">아직 입력한 경험이 없어요</li>'}</ul>
        </section>
        <section class="card">
          <h2>활동 관리</h2>
          <p class="muted small">공고 상세에서 진행 상태를 바꿀 수 있어요</p>
          <div class="board" id="board"><div class="skeleton"></div></div>
        </section>
      </div>
    </div>`;
  $view.querySelector('#logout').onclick = () => logout();
  try {
    const list = await api('GET', '/api/contests?saved=1&sort=deadline');
    $view.querySelector('#board').innerHTML = Object.entries(SAVE_STATUS).map(([k, l]) => {
      const items = list.filter(c => c.saved === k);
      return `<div class="lane"><h3>${l} <span>${items.length}</span></h3>${items.map(c => `
        <a class="lane-item" href="#/c/${c.id}"><b>${esc(c.title)}</b><small>${dday(c.match.daysLeft)} · 적합도 ${c.match.score}</small></a>`).join('') || '<p class="muted small">없음</p>'}</div>`;
    }).join('');
  } catch (e) { toast(e.message); }
}

function renderEditProfile() {
  const p = JSON.parse(JSON.stringify({ ...blankProfile(), ...me.profile }));
  if (p.gpa == null) p.gpa = '';
  $view.innerHTML = `
    <div class="page narrow">
      ${pageHead('프로필 수정', '바뀐 내용은 추천 점수와 로드맵에 바로 반영돼요', `<button class="btn primary" id="save">저장</button>`)}
      ${PROFILE_STEPS.map(s => `
        <section class="card edit-section">
          <h2>${s.emoji} ${s.title}</h2>
          <div data-step="${s.key}"></div>
        </section>`).join('')}
      <div class="center"><button class="btn primary lg" id="save2">저장하기</button></div>
    </div>`;
  for (const s of PROFILE_STEPS) {
    const el = $view.querySelector(`[data-step="${s.key}"]`);
    const draw = () => { el.innerHTML = s.html(p); bindProfileStep(el, p, draw); };
    draw();
  }
  const saveAll = async () => {
    const bad = PROFILE_STEPS.find(s => !s.valid(p));
    if (bad) return toast(`'${bad.title}'에서 필수 항목을 채워주세요`);
    try {
      me = await api('PUT', '/api/profile', { profile: toPayload(p) });
      toast('저장했어요. 추천 점수가 새로 계산됐어요 ✨');
      location.hash = '#/home';
    } catch (e) { toast(e.message); }
  };
  $view.querySelector('#save').onclick = saveAll;
  $view.querySelector('#save2').onclick = saveAll;
}

router();
