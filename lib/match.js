// 규칙 기반 스펙 진단 + 공모전 적합도 점수 (AI 없이도 동작하는 기본 추천 엔진)
import { FIELDS, CATEGORIES } from './catalog.js';

const clamp = (n, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, Math.round(n)));
const count = (exps, types) => (exps || []).filter(e => types.includes(e.type)).length;

// 어떤 카테고리의 활동이 어떤 스펙 축을 채워주는지
const CATEGORY_AXIS = {
  contest: 'award', hackathon: 'award', activity: 'activity', supporters: 'activity', club: 'activity',
  volunteer: 'activity', intern: 'career', education: 'skill',
};

export const AXIS_LABEL = {
  career: '직무 경험', award: '수상 경력', activity: '대외활동', language: '어학', skill: '자격·스킬', gpa: '학점',
};

export function diagnose(p = {}) {
  const exps = p.exps || [];
  const gpaRatio = p.gpa ? p.gpa / (p.gpaMax || 4.5) : null;
  const langScore = (p.langs || []).reduce((best, l) => {
    const s = Number(l.score) || 0;
    let v = 40;
    if (l.test === 'TOEIC') v = s >= 900 ? 100 : s >= 800 ? 80 : s >= 700 ? 60 : 40;
    else if (l.test === 'OPIc') v = /AL|IH/i.test(l.score) ? 90 : /IM3|IM2/i.test(l.score) ? 70 : 50;
    else if (l.test === 'TOEIC Speaking') v = s >= 160 ? 90 : s >= 130 ? 70 : 50;
    else if (l.test === 'TOEFL') v = s >= 100 ? 100 : s >= 80 ? 75 : 50;
    else if (l.test === 'IELTS') v = s >= 7 ? 100 : s >= 6 ? 75 : 50;
    else v = 65;
    return Math.max(best, v);
  }, 0);

  const axes = {
    career: clamp(count(exps, ['intern']) * 55 + count(exps, ['project', 'research']) * 25 + count(exps, ['parttime']) * 8),
    award: clamp(count(exps, ['award']) * 60 + count(exps, ['contest']) * 20),
    activity: clamp(count(exps, ['activity', 'supporters', 'club', 'volunteer', 'overseas']) * 28),
    language: langScore,
    skill: clamp((p.certs || []).length * 22 + (p.skills || []).length * 9),
    gpa: gpaRatio == null ? 0 : clamp((gpaRatio - 0.6) / 0.35 * 100),
  };

  // 목표에 따라 중요한 축의 가중치가 다름
  const weights = { career: 1.2, award: 1, activity: 1, language: 0.8, skill: 0.9, gpa: 0.7 };
  if (p.goal === 'grad') Object.assign(weights, { gpa: 1.5, language: 1.1, career: 0.8, award: 0.9 });
  if (p.goal === 'startup') Object.assign(weights, { award: 1.3, career: 1, gpa: 0.3, language: 0.4 });
  if (p.goal === 'public') Object.assign(weights, { gpa: 1, language: 1, skill: 1.2 });
  const total = Object.entries(axes).reduce((s, [k, v]) => s + v * weights[k], 0) / Object.values(weights).reduce((a, b) => a + b, 0);

  const gaps = Object.entries(axes)
    .filter(([k]) => weights[k] >= 0.8)
    .sort((a, b) => a[1] * weights[b[0]] - b[1] * weights[a[0]])
    .filter(([, v]) => v < 60)
    .slice(0, 3)
    .map(([k]) => k);

  return { axes, total: clamp(total), gaps };
}

// 한국 시간 기준 오늘 날짜 (배포 서버가 UTC여도 D-day가 맞도록)
export const todayKST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());

function daysLeft(deadline) {
  return Math.round((Date.parse(deadline) - Date.parse(todayKST())) / 86400000);
}

export function matchContest(p = {}, c, diag = diagnose(p)) {
  const reasons = [];
  const warnings = [];
  let score = 20;

  // 공고 분야 중 내 관심 분야 비율 + 대표 분야(첫 번째)가 겹치면 가산
  const overlap = (c.fields || []).filter(f => (p.fields || []).includes(f));
  if (overlap.length) {
    const ratio = overlap.length / c.fields.length;
    score += 16 + 14 * ratio + (p.fields.includes(c.fields[0]) ? 6 : 0) + (p.fields[0] === c.fields[0] ? 3 : 0);
    reasons.push(overlap.length >= 2
      ? `관심 분야(${overlap.map(f => FIELDS[f]).join(', ')})와 딱 맞아요`
      : `관심 분야인 ${FIELDS[overlap[0]]} 경험을 쌓을 수 있어요`);
  } else score -= 8;

  const skillHit = (p.skills || []).filter(s => `${c.title} ${c.summary}`.toLowerCase().includes(String(s).toLowerCase()));
  if (skillHit.length) { score += 6; reasons.push(`보유 스킬(${skillHit.slice(0, 2).join(', ')})을 바로 활용할 수 있어요`); }

  if ((p.categories || []).includes(c.category)) { score += 8; }
  else if (!(p.categories || []).length) score += 4;

  const axis = CATEGORY_AXIS[c.category];
  if (axis && diag.axes[axis] < 50) {
    score += 6 + 12 * (1 - diag.axes[axis] / 50);
    reasons.push(`지금 부족한 '${AXIS_LABEL[axis]}'을(를) 채워줘요`);
  } else if (axis) score += 4;

  const hours = Number(p.weeklyHours) || 8;
  if (c.weeklyHours <= hours) score += 10 - 4 * (c.weeklyHours / hours);
  else if (c.weeklyHours <= hours * 1.5) { score += 3; warnings.push(`주 ${c.weeklyHours}시간 정도 필요해서 조금 빠듯할 수 있어요`); }
  else { score -= 10; warnings.push(`주 ${c.weeklyHours}시간 이상 필요 — 지금 여유 시간(주 ${hours}시간)보다 많아요`); }

  if (!p.teamPref || p.teamPref === 'any' || c.teamType === 'both' || c.teamType === p.teamPref) score += 6;
  else warnings.push(c.teamType === 'team' ? '팀으로 참여해야 해요' : '개인으로 참여하는 활동이에요');

  if (!p.modePref || p.modePref === 'any' || c.mode === 'hybrid' || c.mode === p.modePref) score += 4;
  else warnings.push(c.mode === 'offline' ? '오프라인 참석이 필요해요' : '온라인으로만 진행돼요');

  const grades = c.eligibility?.grades || [];
  if (grades.length && p.grade && !grades.includes(Number(p.grade))) {
    score *= 0.4;
    warnings.unshift(`지원 자격 확인 필요: ${c.eligibility.note}`);
  }
  if (c.difficulty === 3 && Number(p.grade) <= 1) { score -= 6; warnings.push('난이도가 높아 저학년에겐 부담될 수 있어요'); }
  if (c.difficulty === 1 && diag.total < 30) { score += 5; reasons.push('처음 시작하기 좋은 난이도예요'); }

  const left = daysLeft(c.deadline);
  if (left < 0) return { score: 0, reasons, warnings: ['마감됐어요'], daysLeft: left };
  if (left <= 3) warnings.push(`마감까지 ${left}일 — 서두르세요`);

  if (c.benefits?.some(b => /채용|인턴|서류|우대|가산점|전환/.test(b)) && p.goal === 'job') {
    score += 5;
    reasons.push('채용 연계 혜택이 있어 취업 목표에 유리해요');
  }

  return { score: clamp(score, 1, 99), reasons: reasons.slice(0, 4), warnings: warnings.slice(0, 3), daysLeft: left };
}

// 규칙 기반 기본 로드맵 (AI 키가 없을 때 사용)
export function basicRoadmap(p, diag, ranked) {
  const used = new Set();
  const byAxis = axis => ranked.filter(r => CATEGORY_AXIS[r.contest.category] === axis);
  // 이미 다른 단계에 넣은 활동은 제외하고, 마감이 가까운 순으로 n개
  const pick = (list, n) => list.filter(r => !used.has(r.contest.id)).slice(0, n).map(r => {
    used.add(r.contest.id);
    return { title: r.contest.title, contestId: r.contest.id, why: r.match.reasons[0] || '적합도가 높은 활동이에요', type: CATEGORIES[r.contest.category] };
  });
  const gapNames = diag.gaps.map(g => AXIS_LABEL[g]);
  // 후보 중에 실제로 채울 활동이 있는 첫 번째 약점부터
  const first = diag.gaps.find(g => byAxis(g).length);
  return {
    ai: false,
    summary: gapNames.length
      ? `지금은 ${gapNames.join(', ')} 쪽이 비어 있어요. ${p.fields?.length ? '관심 분야 중심으로 ' : ''}부족한 칸부터 채우는 순서로 설계했어요.`
      : '기본 스펙이 고르게 잘 갖춰져 있어요. 이제는 목표 직무와 직접 연결되는 경험의 깊이를 키울 때예요.',
    strengths: Object.entries(diag.axes).filter(([, v]) => v >= 60).map(([k]) => `${AXIS_LABEL[k]}이(가) 탄탄해요`).slice(0, 3),
    gaps: gapNames.map(n => `${n} 보완이 필요해요`),
    phases: [
      { period: '이번 달', focus: first ? `${AXIS_LABEL[first]} 첫 칸 채우기` : '관심 분야 첫 성과 만들기', actions: pick([...(first ? byAxis(first) : ranked)].sort((a, b) => a.match.daysLeft - b.match.daysLeft), 2) },
      { period: '다음 1~2개월', focus: '관심 분야 성과 만들기', actions: pick(ranked, 2) },
      { period: '다음 학기', focus: '직무와 직결되는 경험', actions: pick(byAxis('career').concat(byAxis('award'), ranked), 2) },
    ].filter(ph => ph.actions.length),
    longTerm: [
      diag.axes.language < 60 ? '목표 직무에 맞는 어학 점수 만들기 (예: 토익 800+ 또는 오픽 IM2+)' : '어학 점수 유효기간 관리하기',
      diag.axes.skill < 50 ? '관심 분야 자격증·툴 1개 이상 익히기' : '보유 스킬로 결과물 만들기',
      '활동마다 결과물(보고서·링크·수상 내역)을 포트폴리오로 모으기',
    ],
    thisWeek: [
      ranked[0] ? `'${ranked[0].contest.title}' 공고를 자세히 읽고 지원 여부 정하기` : '관심 공모전 3개 저장하기',
      '지금까지 한 경험을 한 줄씩 정리해두기 (자소서 소재)',
      diag.axes.language < 50 ? '어학 시험 일정 확인하고 목표 점수 정하기' : '포트폴리오 폴더 만들기',
    ],
  };
}
