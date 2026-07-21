// ============================================================
//  VOC 대시보드 v2 — 설정
// ============================================================
//  기존 VOC 시트와 완전히 분리된 새 구조.
//  입력: Drive 폴더에 올린 채널톡 export(xlsx)
//  처리: 상담원본에 누적 → 집계 → 대시보드 v2
// ============================================================

// 채널톡 export 파일을 올리는 Drive 폴더
const INPUT_FOLDER_ID = '11Peb8BLMDixwjRMms9DciCEw6Z_0o5Wo';

// 읽은 파일을 옮길 하위 폴더 이름 (없으면 자동 생성)
const DONE_FOLDER_NAME = '처리완료';

// xlsx를 읽으려면 구글시트로 변환한 사본이 필요하다.
// 이 접두어로 만들고, 읽은 뒤 바로 휴지통으로 보낸다.
const TEMP_PREFIX = '[임시] ';

// ── 시트 이름
const SHEET_CHATS    = '상담원본';
const SHEET_CSAT     = '만족도원본';
const SHEET_AGG_WEEK = '집계_주차';
const SHEET_AGG_TAG  = '집계_태그';
const SHEET_VERIFY   = '검증';

// ── 만족도(구글폼 응답) 원본 — 기존 파일. 읽기만 하고 절대 쓰지 않는다.
const CSAT_SOURCE_ID    = '1ImaMFjMq-JcuJ1xBjTENa3QvYQnYlifnEGr62j5XeOM';
const CSAT_SOURCE_SHEET = '설문지 응답 시트1';   // 폼 응답이 쌓이는 시트 (여러 개라 반드시 지정)

// 구글폼 질문 = 컬럼명 (폼 문구가 바뀌면 여기만 고치면 된다)
const FORM_HEADERS = {
  timestamp : '타임스탬프',
  id        : 'id',
  csat      : '오늘 상담에 얼마나 만족하셨나요?',
  kindness  : '상담사가 친절하고 이해하기 쉽게 안내했나요?',
  resolved  : '문의하신 내용이 해결되었나요?',
  waiting   : '답변을 받기까지 기다리는 시간이 적절했나요?',
  comment   : '상담을 받으시며 느낀 점이나 개선되었으면 하는 부분이 있다면 자유롭게 남겨 주세요.',
};

const CSAT_HEADERS = ['상담ID', '응답일시', '만족도', '친절도', '해결여부', '대기적절', '자유의견'];

// 보기 답변 → 점수
const CSAT_SCORE = {
  '🔴 매우 불만족': 1, '매우 불만족': 1, '매우불만족': 1,
  '불만족': 2,
  '🟡 보통': 3, '보통': 3,
  '만족': 4,
  '🟢 매우 만족': 5, '매우 만족': 5, '매우만족': 5,
};
const KINDNESS_SCORE = {
  '🔴매우 불친절': 1, '🔴 매우 불친절': 1, '매우 불친절': 1, '매우불친절': 1,
  '불친절': 2,
  '🟡 보통': 3, '보통': 3,
  '친절': 4,
  '🟢 매우 친절': 5, '매우 친절': 5, '매우친절': 5,
};

// ── 채널톡 export에서 가져올 컬럼
//    98개 중 대시보드·만족도 탭에 필요한 것만.
//    key = export 헤더명, label = 상담원본 시트에 쓸 이름
const IMPORT_COLS = [
  { key: 'id',           label: '상담ID'   },
  { key: 'managedAt',    label: '인입일시' },   // ← 채널톡 날짜 필터와 같은 기준
  { key: 'firstAskedAt', label: '첫문의일시' },
  { key: 'tags',         label: '태그'     },
  { key: 'mediumType',   label: '채널유형' },
  { key: 'state',        label: '상태'     },
  { key: 'userId',       label: '고객ID'   },
  { key: 'assigneeId',   label: '담당자ID' },
  { key: 'alfTriggered', label: 'AI관여'   },   // ALF가 붙었는지 (완결 여부와는 다름)
  { key: 'missedReason', label: '부재중사유' },
  { key: 'memberHandlingTime', label: '상담원응대시간' },
  { key: 'timeFromFirstOpenToFirstAnswerInOperation', label: '대기시간초' },
  { key: 'replyCount',   label: '응답횟수' },
  { key: 'url',          label: '대화링크' },
];

// 상담원본 시트 헤더 = 가져온 컬럼 + 스크립트가 계산해 넣는 컬럼
const DERIVED_COLS = ['주차', 'AI완결'];
const CHAT_HEADERS = IMPORT_COLS.map(function(c) { return c.label; }).concat(DERIVED_COLS);

// AI가 끝까지 처리했다고 보는 태그 (상담원이관이 붙으면 AI완결 아님)
const TAG_AI_RESOLVED = 'AI/상담완료';
const TAG_TRANSFERRED = '상담원이관';
