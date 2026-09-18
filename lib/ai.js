// Claude API 연동: 공모전 심층 분석, 스펙 로드맵 설계, 최신 공모전 웹 검색
// ANTHROPIC_API_KEY가 없으면 aiEnabled()가 false → 서버는 규칙 기반 결과만 사용한다.
import Anthropic from '@anthropic-ai/sdk';
import { FIELDS, CATEGORIES, EXP_TYPES, GOALS, COMPANY_TYPES, GRADES } from './catalog.js';
import { todayKST } from './match.js';

const MODEL = 'claude-opus-5';
let client = null;
const getClient = () => (client ||= new Anthropic());

export const aiEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

export class AIError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}

// 공통 호출: 거절 시 서버 측 대체 모델(fallbacks: "default"), 구조화 출력(JSON 스키마), 웹 검색 pause_turn 처리
async function ask({ system, user, schema, tools, effort = 'medium' }) {
  const messages = [{ role: 'user', content: user }];
  try {
    for (let turn = 0; turn < 5; turn++) {
      const res = await getClient().beta.messages.create({
        model: MODEL,
        max_tokens: 16000,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        thinking: { type: 'adaptive' },
        output_config: { effort, ...(schema && { format: { type: 'json_schema', schema } }) },
        system,
        messages,
        ...(tools && { tools }),
      });
      if (res.stop_reason === 'refusal') throw new AIError('AI가 이 요청은 처리하지 못했어요. 입력 내용을 바꿔서 다시 시도해주세요.');
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
      if (res.stop_reason === 'max_tokens') throw new AIError('AI 응답이 너무 길어져서 중간에 끊겼어요. 다시 시도해주세요.');
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (!schema) return text;
      try { return JSON.parse(text); } catch { throw new AIError('AI 응답을 읽지 못했어요. 다시 시도해주세요.'); }
    }
    throw new AIError('AI 검색이 너무 오래 걸려요. 잠시 후 다시 시도해주세요.');
  } catch (e) {
    if (e instanceof AIError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AIError('Claude API 키가 올바르지 않아요 (서버 설정 확인 필요)', 503);
    if (e instanceof Anthropic.PermissionDeniedError) throw new AIError('이 API 키로는 해당 모델을 쓸 수 없어요', 503);
    if (e instanceof Anthropic.RateLimitError) throw new AIError('요청이 많아서 잠시 쉬는 중이에요. 1분 뒤 다시 시도해주세요.', 429);
    if (e instanceof Anthropic.APIConnectionError) throw new AIError('AI 서버에 연결하지 못했어요. 잠시 후 다시 시도해주세요.');
    if (e instanceof Anthropic.APIError) { console.error('Claude API 오류', e.status, e.message); throw new AIError('AI 분석 중 문제가 생겼어요. 잠시 후 다시 시도해주세요.'); }
    throw e;
  }
}

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
const strArr = { type: 'array', items: str };

// 사람이 읽기 쉬운 프로필 요약 (프롬프트용)
export function profileText(p = {}) {
  const lines = [
    `학교/학년: ${p.school || '-'} ${GRADES[p.grade] || ''} · 전공 ${p.major || '-'}${p.subMajor ? ` (복수/부전공 ${p.subMajor})` : ''}`,
    `진로 목표: ${GOALS[p.goal] || '-'}${p.jobTitle ? ` · 희망 직무 "${p.jobTitle}"` : ''} · 관심 분야 ${(p.fields || []).map(f => FIELDS[f]).join(', ') || '-'}`,
    `희망 기업 유형: ${(p.companyTypes || []).map(c => COMPANY_TYPES[c]).join(', ') || '-'} · 졸업 예정 ${p.gradTerm || '-'}`,
    `학점: ${p.gpa ? `${p.gpa}/${p.gpaMax || 4.5}` : '미입력'}`,
    `어학: ${(p.langs || []).map(l => `${l.test} ${l.score}`).join(', ') || '없음'}`,
    `자격증: ${(p.certs || []).join(', ') || '없음'}`,
    `경험: ${(p.exps || []).map(e => `[${EXP_TYPES[e.type] || e.type}] ${e.title}${e.period ? ` (${e.period})` : ''}`).join(' / ') || '아직 없음'}`,
    `보유 스킬: ${(p.skills || []).join(', ') || '-'} · 강점: ${(p.strengths || []).join(', ') || '-'}`,
    `선호: ${{ team: '팀 활동', solo: '개인 활동', any: '상관없음' }[p.teamPref] || '상관없음'}, ${{ online: '온라인', offline: '오프라인', any: '상관없음' }[p.modePref] || '상관없음'} · 투자 가능 시간 주 ${p.weeklyHours || '?'}시간 · 이번 학기 바쁨 정도 ${{ low: '여유', mid: '보통', high: '바쁨' }[p.busy] || '-'}`,
    `본인이 적은 고민: ${p.concern || '없음'}`,
  ];
  return lines.join('\n');
}

const contestText = c => [
  `제목: ${c.title} (${CATEGORIES[c.category] || c.category}, 주최 ${c.host})`,
  `분야: ${(c.fields || []).map(f => FIELDS[f]).join(', ')} · 마감 ${c.deadline} · ${{ team: '팀', solo: '개인', both: '팀/개인' }[c.teamType]} · ${{ online: '온라인', offline: '오프라인', hybrid: '온·오프라인' }[c.mode]}`,
  `예상 투자 시간: 주 ${c.weeklyHours}시간 · 난이도 ${c.difficulty}/3 · 지원 자격: ${c.eligibility?.note || '-'}`,
  `내용: ${c.summary}`,
  `혜택: ${(c.benefits || []).join(', ')}`,
].join('\n');

const COACH = `당신은 한국 대학생의 커리어·스펙 설계를 돕는 코치입니다.
학생의 목표 직무와 현재 스펙을 근거로, 과장 없이 구체적이고 실행 가능한 조언을 합니다.
학생에게 말하듯 친근한 존댓말(해요체)로 쓰고, 각 문장은 짧게 씁니다.
입력에 없는 사실(학생 경험, 공고 세부 조건)을 지어내지 않습니다.`;

// ---------- 1. 공모전 심층 분석 ----------
const ANALYSIS_SCHEMA = obj({
  fit: { type: 'integer', description: '0~100 적합도' },
  verdict: { type: 'string', enum: ['강력 추천', '추천', '고민 필요', '비추천'] },
  summary: { ...str, description: '두세 문장 요약' },
  strengths: { ...strArr, description: '이 학생이 이 활동에서 유리한 점 2~3개' },
  risks: { ...strArr, description: '주의할 점 1~3개' },
  prepPlan: { type: 'array', items: obj({ when: str, task: str }), description: '마감까지 준비 단계 3~5개' },
  storyAngle: { ...str, description: '이 경험을 자소서/면접에서 어떻게 쓸 수 있는지 한 문장' },
});

export async function analyzeContest(profile, contest, ruleMatch) {
  const result = await ask({
    system: COACH,
    effort: 'medium',
    schema: ANALYSIS_SCHEMA,
    user: `오늘 날짜: ${todayKST()}

<학생 프로필>
${profileText(profile)}
</학생 프로필>

<활동 공고>
${contestText(contest)}
</활동 공고>

규칙 기반 엔진의 1차 적합도는 ${ruleMatch.score}점이에요 (참고용).
이 학생에게 이 활동이 스펙 설계상 얼마나 좋은지 분석해주세요. 목표 직무와의 연결, 지금 부족한 스펙을 채우는지, 시간·난이도 현실성을 따져 주세요.`,
  });
  result.fit = Math.max(0, Math.min(100, Math.round(result.fit)));
  return result;
}

// ---------- 2. 스펙 로드맵 ----------
const ROADMAP_SCHEMA = obj({
  summary: { ...str, description: '현재 스펙 진단 요약 2~3문장' },
  persona: { ...str, description: '졸업 시점에 목표로 할 인재상 한 문장' },
  strengths: strArr,
  gaps: strArr,
  phases: {
    type: 'array',
    description: '시기별 단계 3~4개 (예: 이번 달, 이번 학기, 방학, 다음 학기)',
    items: obj({
      period: str,
      focus: str,
      actions: {
        type: 'array',
        items: obj({
          title: str,
          contestId: { ...str, description: '후보 목록의 id. 목록에 없는 일반 활동이면 빈 문자열' },
          type: { ...str, description: '공모전/대외활동/자격증/어학/프로젝트 등' },
          why: str,
        }),
      },
    }),
  },
  thisWeek: { ...strArr, description: '이번 주에 바로 할 일 3개' },
  longTerm: { ...strArr, description: '어학·자격증·포트폴리오 등 장기 목표 2~4개' },
});

export async function buildRoadmap(profile, diag, candidates) {
  const list = candidates.map(({ contest: c, match }) =>
    `- id=${c.id} | ${c.title} | ${CATEGORIES[c.category]} | ${(c.fields || []).map(f => FIELDS[f]).join('/')} | 마감 ${c.deadline} | 주 ${c.weeklyHours}h | 규칙 적합도 ${match.score}`).join('\n');
  const result = await ask({
    system: COACH,
    effort: 'high',
    schema: ROADMAP_SCHEMA,
    user: `오늘 날짜: ${todayKST()}

<학생 프로필>
${profileText(profile)}
</학생 프로필>

<규칙 기반 스펙 진단 (0~100)>
${Object.entries(diag.axes).map(([k, v]) => `${k}: ${v}`).join(', ')} · 종합 ${diag.total}
</규칙 기반 스펙 진단>

<지금 지원 가능한 공모전·대외활동 후보>
${list || '(없음)'}
</지금 지원 가능한 공모전·대외활동 후보>

이 학생의 졸업 시점까지 스펙 로드맵을 설계해주세요.
- 목표 직무에서 실제로 중요하게 보는 경험을 기준으로 우선순위를 정해주세요.
- 후보 목록의 활동을 추천할 때는 반드시 해당 id를 contestId에 넣어주세요. 마감이 가까운 것은 앞 단계에 배치해주세요.
- 주당 투자 가능 시간을 넘지 않도록 한 시기에 너무 많은 활동을 넣지 마세요.
- 어학, 자격증, 개인 프로젝트처럼 후보 목록에 없는 활동도 필요하면 contestId를 빈 문자열로 넣어 추천하세요.`,
  });
  const ids = new Set(candidates.map(c => c.contest.id));
  for (const ph of result.phases || []) {
    for (const a of ph.actions || []) if (a.contestId && !ids.has(a.contestId)) a.contestId = '';
  }
  return { ...result, ai: true };
}

// ---------- 3. 최신 공모전 찾기 (웹 검색 → 구조화) ----------
const DISCOVER_SCHEMA = obj({
  items: {
    type: 'array',
    items: obj({
      title: str,
      host: str,
      category: { type: 'string', enum: Object.keys(CATEGORIES) },
      fields: { type: 'array', items: { type: 'string', enum: Object.keys(FIELDS) } },
      summary: str,
      benefits: strArr,
      deadline: { ...str, description: 'YYYY-MM-DD, 모르면 빈 문자열' },
      teamType: { type: 'string', enum: ['team', 'solo', 'both'] },
      mode: { type: 'string', enum: ['online', 'offline', 'hybrid'] },
      weeklyHours: { type: 'integer', description: '예상 주당 투자 시간' },
      difficulty: { type: 'integer', description: '1~3' },
      eligibilityNote: str,
      url: { ...str, description: '공고 원문 URL' },
    }),
  },
});

export async function discoverContests(query) {
  const today = todayKST();
  // 1단계: 웹 검색으로 현재 모집 중인 공고 조사 (검색 결과는 인용 블록이 붙으므로 구조화 출력과 분리)
  const research = await ask({
    system: '당신은 한국 대학생 대상 공모전·대외활동 공고를 조사하는 리서처입니다. 공식 공고 페이지와 공모전 포털을 우선 확인합니다.',
    effort: 'medium',
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 6, user_location: { type: 'approximate', country: 'KR', timezone: 'Asia/Seoul' } }],
    user: `오늘은 ${today}입니다. "${query}"와 관련해 현재 모집 중이고 마감이 지나지 않은 대학생 대상 공모전·대외활동·서포터즈·해커톤·인턴 공고를 최대 8개 찾아주세요.
각 공고마다 제목, 주최, 분야, 활동 내용, 혜택, 마감일, 팀/개인 여부, 온·오프라인, 지원 자격, 공고 URL을 정리해주세요. 확인되지 않는 항목은 "확인 불가"라고 적어주세요.`,
  });
  // 2단계: 조사 결과를 앱 데이터 형식으로 변환
  const { items } = await ask({
    system: '조사 노트를 주어진 JSON 스키마로 옮깁니다. 노트에 없는 정보는 추측하지 말고, 모르는 마감일은 빈 문자열로 둡니다.',
    effort: 'low',
    schema: DISCOVER_SCHEMA,
    user: `오늘 날짜: ${today}\n\n<조사 노트>\n${research}\n</조사 노트>`,
  });
  return (items || []).filter(it => it.title && (!it.deadline || it.deadline >= today));
}
