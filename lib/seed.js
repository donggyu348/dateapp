// 샘플 공모전·대외활동 데이터 (실제 공고가 아닌 예시 — 화면에 "샘플" 표시)
// 마감일은 오늘 기준으로 계산해서 데모를 언제 열어도 최신처럼 보이게 한다.
const SAMPLES = [
  ['대학생 브랜드 마케팅 아이디어 공모전', '한빛식품', 'contest', ['marketing', 'planning'], 12, '신제품 간편식 브랜드의 MZ 타깃 마케팅 캠페인을 기획해 제안합니다.', ['대상 상금 500만원', '입사 지원 시 서류 우대'], 'team', 'online', 6, 2],
  ['청년 서포터즈 12기 모집', '그린에너지공사', 'supporters', ['content', 'esg', 'marketing'], 9, '신재생 에너지 정책을 알리는 콘텐츠를 매달 제작하는 서포터즈 활동입니다.', ['월 활동비 20만원', '우수 활동자 표창', '수료증'], 'solo', 'hybrid', 5, 1],
  ['AI 해커톤 : 캠퍼스 문제 해결', '테크브릿지재단', 'hackathon', ['dev', 'data', 'planning'], 18, '무박 2일 동안 캠퍼스 생활 문제를 AI로 해결하는 서비스를 만듭니다.', ['총상금 1,000만원', '스타트업 채용 연계'], 'team', 'offline', 10, 3],
  ['공공데이터 활용 아이디어 공모전', '행정혁신원', 'contest', ['data', 'public', 'planning'], 25, '공공데이터를 활용한 정책·서비스 아이디어를 제안합니다. 분석 부문과 아이디어 부문으로 나뉩니다.', ['장관상 수여', '상금 300만원'], 'both', 'online', 5, 2],
  ['대학생 글로벌 탐방단', '미래교류재단', 'activity', ['global', 'culture'], 30, '선발된 20명이 해외 도시의 혁신 사례를 탐방하고 보고서를 작성합니다.', ['해외 탐방 경비 전액 지원', '수료증'], 'team', 'offline', 6, 2],
  ['UX 디자인 챌린지', '스튜디오모아', 'contest', ['design', 'planning'], 15, '금융 앱의 온보딩 경험을 개선하는 UX 리디자인 과제입니다.', ['상금 200만원', '인턴십 면접 기회'], 'solo', 'online', 6, 2],
  ['숏폼 영상 공모전 "우리 동네 이야기"', '지역문화진흥원', 'contest', ['content', 'culture'], 7, '1분 이내 숏폼으로 지역의 매력을 담아냅니다.', ['대상 300만원', '수상작 공식 채널 게재'], 'both', 'online', 3, 1],
  ['금융 리서치 챌린지', '한결증권', 'contest', ['finance', 'consulting', 'data'], 21, '관심 산업을 골라 기업 분석 리포트를 작성하고 본선에서 발표합니다.', ['상금 400만원', '하계 인턴 서류 면제'], 'team', 'hybrid', 8, 3],
  ['대학생 경영 컨설팅 프로그램', '중소기업상생센터', 'activity', ['consulting', 'startup', 'marketing'], 14, '지역 소상공인과 매칭되어 8주 동안 경영 개선안을 컨설팅합니다.', ['활동비 지원', '우수팀 시상', '수료증'], 'team', 'offline', 7, 2],
  ['청년 창업 아이디어 경진대회', '창업진흥허브', 'contest', ['startup', 'planning'], 28, '사업계획서 심사 후 본선 피칭으로 우수 아이디어를 선발합니다.', ['사업화 자금 최대 1,000만원', '입주 공간 지원'], 'both', 'hybrid', 8, 3],
  ['ESG 대학생 기자단', '지속가능미디어', 'supporters', ['esg', 'content'], 11, '기업의 ESG 사례를 취재해 매달 기사 2건을 작성합니다.', ['원고료', '우수 기자 시상'], 'solo', 'online', 4, 1],
  ['데이터 분석 경진대회 : 소비 트렌드 예측', '빅데이터포럼', 'contest', ['data', 'dev'], 33, '카드 결제 데이터로 다음 분기 소비 트렌드를 예측하는 모델을 만듭니다.', ['상금 700만원', '데이터 직무 채용 연계'], 'team', 'online', 9, 3],
  ['교육 봉사 멘토링단', '희망배움재단', 'volunteer', ['edu'], 10, '저소득층 중학생에게 주 1회 학습 멘토링을 제공합니다.', ['봉사시간 인정', '장학금 지원(우수)'], 'solo', 'offline', 3, 1],
  ['기업 연계 하계 인턴십', '넥스트커머스', 'intern', ['marketing', 'planning', 'data'], 19, '8주 하계 인턴십으로 커머스 마케팅·기획 실무를 경험합니다.', ['인턴 급여 지급', '우수자 정규직 전환 검토'], 'solo', 'offline', 40, 3],
  ['공공기관 정책 제안 공모전', '국민정책연구원', 'contest', ['public', 'edu'], 23, '청년 정책 개선 아이디어를 보고서 형식으로 제안합니다.', ['기관장상', '상금 200만원'], 'both', 'online', 4, 2],
  ['웹 개발 부트캠프 (방학 과정)', '코드스쿨', 'education', ['dev'], 16, '6주 동안 풀스택 웹 개발을 배우고 팀 프로젝트를 완성합니다.', ['수강료 전액 지원', '수료증', '포트폴리오'], 'team', 'hybrid', 20, 2],
  ['제품 디자인 공모전', '리빙랩코리아', 'contest', ['design', 'eng'], 40, '1인 가구를 위한 생활 제품을 디자인합니다.', ['상금 500만원', '시제품 제작 지원'], 'both', 'online', 7, 2],
  ['헬스케어 아이디어톤', '메디이노베이션', 'hackathon', ['bio', 'dev', 'startup'], 26, '의료 현장의 문제를 발굴하고 해결 서비스를 설계합니다.', ['상금 300만원', '의료 스타트업 멘토링'], 'team', 'offline', 8, 2],
  ['연합 마케팅 학회 신입 모집', '마케팅연합학회', 'club', ['marketing', 'consulting'], 8, '한 학기 동안 실제 기업 과제를 수행하는 연합 학회입니다.', ['기업 프로젝트 경험', '현직자 네트워킹'], 'team', 'offline', 6, 2],
  ['대학생 콘텐츠 크리에이터 기자단', '청춘매거진', 'supporters', ['content', 'culture', 'marketing'], 13, '대학생 라이프스타일 콘텐츠를 기획·제작합니다.', ['활동비', '포트폴리오 인증서'], 'solo', 'online', 4, 1],
  ['스마트시티 엔지니어링 공모전', '도시혁신연구소', 'contest', ['eng', 'data', 'public'], 37, 'IoT·센서 데이터를 활용한 도시 문제 해결 설계안을 제출합니다.', ['상금 600만원', '연구소 인턴 기회'], 'team', 'online', 8, 3],
  ['글로벌 비즈니스 케이스 대회', '국제경영포럼', 'contest', ['consulting', 'global', 'finance'], 20, '영어로 진행되는 케이스 스터디 대회입니다. 해외 기업 과제를 분석해 발표합니다.', ['해외 본선 참가 지원', '상금 $3,000'], 'team', 'hybrid', 9, 3],
  ['환경 캠페인 대학생 홍보대사', '푸른지구네트워크', 'activity', ['esg', 'marketing', 'edu'], 17, '캠퍼스 제로웨이스트 캠페인을 직접 기획·운영합니다.', ['활동 인증서', '우수팀 상금'], 'team', 'offline', 4, 1],
  ['게임 기획 공모전', '플레이온', 'contest', ['planning', 'culture', 'dev'], 29, '신규 모바일 게임의 핵심 시스템과 레벨을 기획합니다.', ['상금 400만원', '공채 가산점'], 'solo', 'online', 6, 2],
];

export function sampleContests(idFn, now = new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date())}T00:00`)) {
  const d = n => {
    const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  return SAMPLES.map(([title, host, category, fields, days, summary, benefits, teamType, mode, weeklyHours, difficulty]) => ({
    id: idFn(),
    title, host, category, fields, summary, benefits, teamType, mode, weeklyHours, difficulty,
    deadline: d(days),
    eligibility: { grades: category === 'intern' ? [3, 4, 5] : [], note: category === 'intern' ? '3학년 이상 재학생·졸업예정자' : '대학생·대학원생 누구나' },
    region: mode === 'online' ? '온라인' : '서울',
    url: '',
    source: 'sample',
    createdAt: Date.now(),
  }));
}
