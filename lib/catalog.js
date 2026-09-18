// 화면과 서버가 함께 쓰는 선택지 목록 (/api/meta 로 클라이언트에 전달)
export const FIELDS = {
  marketing: '마케팅', planning: '기획·PM', dev: '개발·IT', data: '데이터·AI', design: '디자인',
  content: '콘텐츠·영상', finance: '금융·경제', consulting: '경영·컨설팅', public: '공공·정책',
  esg: '환경·ESG', edu: '교육·사회공헌', bio: '의료·바이오', eng: '엔지니어링', startup: '창업',
  global: '글로벌·어학', culture: '문화·예술',
};

export const CATEGORIES = {
  contest: '공모전', activity: '대외활동', supporters: '서포터즈·기자단', hackathon: '해커톤',
  intern: '인턴', volunteer: '봉사', education: '교육·부트캠프', club: '연합동아리',
};

export const EXP_TYPES = {
  intern: '인턴', activity: '대외활동', supporters: '서포터즈·기자단', club: '동아리·학회', award: '공모전 수상',
  contest: '공모전 참가', project: '프로젝트', volunteer: '봉사', research: '연구·랩실',
  parttime: '아르바이트', overseas: '해외 경험',
};

export const GOALS = {
  job: '취업', grad: '대학원 진학', startup: '창업', public: '공무원·공기업', undecided: '아직 탐색 중',
};

export const COMPANY_TYPES = {
  large: '대기업', startup: '스타트업', public: '공기업·공공기관', foreign: '외국계', any: '상관없음',
};

export const GRADES = { 1: '1학년', 2: '2학년', 3: '3학년', 4: '4학년', 5: '졸업유예·초과학기', 6: '대학원생' };

export const LANG_TESTS = ['TOEIC', 'TOEIC Speaking', 'OPIc', 'TOEFL', 'IELTS', 'JLPT', 'HSK', '기타'];

export const STRENGTHS = ['기획력', '분석력', '리더십', '커뮤니케이션', '글쓰기', '발표', '디자인 감각', '끈기', '문제해결', '창의성', '꼼꼼함', '네트워킹'];

export const SKILL_SUGGESTIONS = {
  marketing: ['퍼포먼스 마케팅', 'GA4', 'SNS 운영', '카피라이팅', '시장조사'],
  planning: ['서비스 기획', '와이어프레임', 'Notion', 'Jira', '사용자 인터뷰'],
  dev: ['Python', 'JavaScript', 'React', 'Java', 'Git', 'SQL'],
  data: ['Python', 'SQL', 'Pandas', '머신러닝', 'Tableau', 'Excel'],
  design: ['Figma', 'Photoshop', 'Illustrator', 'UI/UX', '브랜딩'],
  content: ['Premiere Pro', 'After Effects', '유튜브 운영', '촬영', '글쓰기'],
  finance: ['Excel', '재무모델링', '회계원리', '투자분석', 'CFA 공부'],
  consulting: ['PPT', 'Excel', '케이스 인터뷰', '리서치', '논리적 글쓰기'],
  public: ['정책 분석', '보고서 작성', '통계', '행정학'],
  esg: ['ESG 리포트', '지속가능성', '환경 데이터'],
  edu: ['교안 작성', '멘토링', '강의'],
  bio: ['실험 설계', 'R', '논문 리딩'],
  eng: ['CAD', 'MATLAB', '아두이노', '3D 프린팅'],
  startup: ['사업계획서', '린 캔버스', 'MVP 제작', '피칭'],
  global: ['영어 회화', '통번역', '해외 리서치'],
  culture: ['전시 기획', '공연 기획', '사진'],
};

export const META = { FIELDS, CATEGORIES, EXP_TYPES, GOALS, COMPANY_TYPES, GRADES, LANG_TESTS, STRENGTHS, SKILL_SUGGESTIONS };
