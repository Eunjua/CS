/**
 * B2G 취업확인서 — 서명일자 일괄 수정
 *
 * [하는 일]
 *   「raw」 시트에서 기준 공고 이후의 행을 읽어,
 *   취업확인서의 서명일자를 **근무 시작일 + 1일** 로 바꿉니다.
 *
 *   공고 하나당 두 번 통신합니다.
 *     ① 조회 : 어드민 API 에서 participantId 와 근무 시작일을 찾습니다.
 *     ② 수정 : BBAS API 로 서명일자를 바꿉니다.
 *
 *   **취업확인서가 실제로 있는지는 시트가 아니라 API 가 판단합니다.**
 *   시트로는 "확실히 아닌 것"만 미리 걸러 조회를 아낍니다.
 *
 *   [건드리지 않는 건]
 *     · raw 「취업확인서대상」이 FALSE   — 확인서가 아예 없음
 *     · 통합관리 「매출 발생 일자」가 있음 — 이미 매출이 잡힌 건
 *     · 서명된 취업확인서를 못 찾음
 *     · 근무 시작일이 비어 있음          — 서명일자를 계산할 수 없음
 *
 *   결과는 「서명일자_수정로그」 탭에 한 줄씩 쌓입니다.
 *   raw·통합관리·구직자 시트는 **읽기만 하고 절대 건드리지 않습니다.**
 *
 * ─────────────────────────────────────────────────────────────
 * [최초 1회 설정] — API 주소 넣기
 *
 *   주소는 이 코드에 직접 적지 않습니다. (이 폴더는 GitHub 공개 저장소입니다)
 *   Apps Script 의 "스크립트 속성"에 저장합니다.
 *     ① Apps Script 편집기 왼쪽 ⚙️ [프로젝트 설정] 클릭
 *     ② 맨 아래 [스크립트 속성] → [스크립트 속성 추가] 로 아래 2개를 넣고 저장
 *          B2G_ADMIN_API = 어드민 API 주소   (participantId 조회용)
 *          B2G_BBAS_API  = BBAS API 주소     (서명일자 수정용)
 *        · 끝에 슬래시(/)는 빼고 넣으세요.
 *     ③ 넣은 뒤 편집기에서 b2g설정확인 을 실행해 확인합니다.
 *
 *   주소 찾는 법 — 어드민에 로그인한 브라우저에서 F12 → Network 탭
 *     · `.../job_support_project_participants?...` 요청의 앞부분 = 어드민 API 주소
 *     · `.../api/v3/...`                    요청의 앞부분 = BBAS 주소
 *
 * [토큰]
 *   한 번 넣으면 저장해 두고 다시 씁니다. 40분쯤 뒤 만료되면 그때만 다시 물어봅니다.
 *   받는 방법은 「B2G 사용법」 탭에 적어 두었습니다. (실행하면 자동으로 생깁니다)
 * ─────────────────────────────────────────────────────────────
 *
 * ⚠️ 되돌리는 API 가 없습니다. 처음 쓸 때는 b2g테스트1건 을 먼저 하세요.
 * ⚠️ 이 API 는 어드민 감사로그를 남기지 않습니다. 「서명일자_수정로그」 탭이 유일한 기록입니다.
 */

/* ===================== 설정 ===================== */

const B2G_CFG = {
  // 이 공고 **다음 행부터** 처리합니다. (「raw」시트의 공고_public_id 기준)
  시작_공고ID: '6qxxm97a02',

  // 시트 이름
  원본시트: 'raw',
  매출시트: '통합관리',
  로그시트: '서명일자_수정로그',
  사용법시트: 'B2G 사용법',

  // 한 번에 묶어서 보낼 건수. 너무 키우면 오류 파악이 어려워집니다.
  묶음크기: 25,

  // Apps Script 는 한 번 실행에 6분 제한이 있습니다.
  // 이 시간(초)이 지나면 깔끔하게 멈추고 "다시 실행하세요" 라고 알려줍니다.
  제한초: 260
};

/* ===================== 메뉴 ===================== */

/*
 * [메뉴 연결]
 *
 * ⚠️ 이 프로젝트에는 이미 다른 onOpen 이 있으므로 여기서는 onOpen 을 만들지 않습니다.
 *    (onOpen 이 두 개면 하나가 조용히 무시됩니다)
 *
 * 기존 onOpen 의 메뉴 안에 아래 한 줄을 끼워 넣으세요.
 *
 *   ui.createMenu('📊 업데이트')
 *       .addItem('🔄 데이터 업데이트', 'updateAll')
 *       .addSeparator()
 *       .addItem('🔍 디버그 모드', 'debugMode')
 *       .addSeparator()
 *       .addItem('🖊️ B2G 서명일자 일괄 수정', 'b2g전체실행')   // ← 이 한 줄
 *       .addToUi();
 *
 * 누르면 "N건을 바꿉니다. 진행할까요?" 확인창이 먼저 뜹니다.
 *
 * [메뉴에 없는 기능 — Apps Script 편집기에서 함수를 골라 ▶ 실행]
 *   b2g설정확인   : 아무것도 안 바꾸고 50건을 미리 재봅니다 (안전)
 *   b2g테스트1건  : 고칠 수 있는 첫 1건만 바꿉니다
 *   b2g권한승인   : 최초 1회 외부 통신 권한 승인
 */

/* ===================== 권한 승인 ===================== */

/**
 * [최초 1회] 외부 통신 권한을 승인받기 위한 함수입니다.
 *
 * 이 스크립트는 외부 API 를 부르므로 "외부 서비스 연결" 권한이 필요합니다.
 * 그런데 메뉴에서 실행하면 승인창이 안 뜨고 아래 오류만 납니다.
 *
 *   "UrlFetchApp.fetch 을(를) 호출할 수 있는 권한이 없습니다"
 *
 * [해결]
 *   ① Apps Script 편집기 위쪽 함수 선택 칸에서 b2g권한승인 을 고릅니다
 *   ② ▶ 실행 을 누릅니다
 *   ③ "승인 필요" 창 → [권한 검토] → 계정 선택 → [고급] → [(안전하지 않은 페이지)로 이동] → [허용]
 *   ④ 실행 기록에 "권한 승인 완료" 가 찍히면 끝입니다
 *
 * 한 번만 하면 됩니다. 아무 데이터도 바꾸지 않습니다.
 */
function b2g권한승인() {
  UrlFetchApp.fetch('https://www.google.com', { muteHttpExceptions: true });
  SpreadsheetApp.getActive().getName();
  PropertiesService.getUserProperties().getProperty('B2G_TOKEN');
  Logger.log('권한 승인 완료 — 이제 시트 메뉴에서 실행하실 수 있습니다.');
}

/* ===================== 설정 읽기 ===================== */

/** 스크립트 속성에서 API 주소를 읽어옵니다. */
function b2g주소읽기_() {
  const p = PropertiesService.getScriptProperties();
  const 어드민 = String(p.getProperty('B2G_ADMIN_API') || '').trim().replace(/\/+$/, '');
  const bbas = String(p.getProperty('B2G_BBAS_API') || '').trim().replace(/\/+$/, '');
  if (!어드민 || !bbas) {
    throw new Error(
      'API 주소가 설정되지 않았습니다.\n' +
      'Apps Script → 프로젝트 설정 → 스크립트 속성에\n' +
      'B2G_ADMIN_API 와 B2G_BBAS_API 를 넣어 주세요.'
    );
  }
  return { 어드민: 어드민, bbas: bbas };
}

/** 토큰을 붙여넣으라고 물어봅니다. 취소하면 null 을 돌려줍니다. */
function b2g토큰묻기_() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    '어드민 토큰 붙여넣기',
    '토큰이 없거나 만료되었습니다. 새로 받아 주세요. (40분마다 만료됩니다)\n\n' +
    '① 크롬에서 어드민(bo.carepartner.kr)에 로그인\n' +
    '② F12 → Console 탭\n' +
    '③ 붙여넣기가 막혀 있으면 allow pasting 을 손으로 타이핑하고 엔터\n' +
    '④ 아래 한 줄을 붙여넣고 엔터\n\n' +
    "     JSON.parse(localStorage.getItem('app')).accessToken\n\n" +
    '⑤ 나온 값을 복사해서 여기에 붙여넣기\n\n' +
    '앞뒤 큰따옴표(")는 있어도 됩니다. "Bearer " 는 지우지 마세요.\n' +
    '자세한 설명은 「' + B2G_CFG.사용법시트 + '」 탭에 있습니다.',
    ui.ButtonSet.OK_CANCEL
  );
  if (res.getSelectedButton() !== ui.Button.OK) return null;

  let 토큰 = String(res.getResponseText() || '').trim().replace(/^"|"$/g, '');
  if (!토큰) return null;
  // 혹시 Bearer 가 빠진 채로 붙여넣었으면 붙여 줍니다.
  if (!/^Bearer\s/i.test(토큰)) 토큰 = 'Bearer ' + 토큰;
  return 토큰;
}

/** 토큰이 아직 살아 있는지 조회 API 를 한 번 찔러 봅니다. */
function b2g토큰살았나_(주소, 토큰, 건) {
  try {
    const res = UrlFetchApp.fetch(b2g조회요청_(주소, 토큰, 건).url, {
      method: 'get',
      headers: { Authorization: 토큰, Accept: 'application/json' },
      muteHttpExceptions: true
    });
    return res.getResponseCode() !== 401 && res.getResponseCode() !== 403;
  } catch (e) {
    return false;
  }
}

/**
 * 쓸 수 있는 토큰을 준비합니다.
 *
 * 한 번 넣은 토큰은 저장해 두고 다시 씁니다. (내 계정에만 저장됩니다)
 * 만료됐으면 그때만 다시 물어봅니다. 어드민 토큰은 40분쯤 살아 있습니다.
 */
function b2g토큰준비_(주소, 검증용건) {
  const 저장소 = PropertiesService.getUserProperties();

  const 저장된 = String(저장소.getProperty('B2G_TOKEN') || '').trim();
  if (저장된 && b2g토큰살았나_(주소, 저장된, 검증용건)) return 저장된;

  const 새토큰 = b2g토큰묻기_();
  if (!새토큰) return null;

  if (!b2g토큰살았나_(주소, 새토큰, 검증용건)) {
    SpreadsheetApp.getUi().alert(
      '토큰이 유효하지 않습니다.\n\n' +
      '· 어드민에 로그인되어 있는지\n' +
      '· 값을 통째로 복사했는지 (Bearer 포함)\n' +
      '확인하고 다시 시도해 주세요.'
    );
    return null;
  }

  저장소.setProperty('B2G_TOKEN', 새토큰);
  return 새토큰;
}

/* ===================== 시트 읽기 ===================== */

/**
 * 시트에서 헤더 이름으로 컬럼 하나를 읽습니다.
 * 컬럼 순서가 바뀌어도 동작하도록 이름으로 찾습니다.
 */
function b2g열읽기_(sheet, 헤더이름들) {
  const 마지막행 = sheet.getLastRow();
  const 마지막열 = sheet.getLastColumn();
  if (마지막행 < 2) return [];

  const 헤더 = sheet.getRange(1, 1, 1, 마지막열).getValues()[0]
    .map(function (v) { return String(v).trim(); });

  const 위치 = 헤더이름들.map(function (이름) {
    const i = 헤더.indexOf(이름);
    if (i === -1) {
      throw new Error(
        '「' + sheet.getName() + '」 시트에서 "' + 이름 + '" 컬럼을 찾지 못했습니다.\n' +
        '현재 헤더: ' + 헤더.filter(String).join(' / ')
      );
    }
    return i + 1;
  });

  // 필요한 컬럼만 각각 읽습니다. (전체를 읽으면 느립니다)
  const 열들 = 위치.map(function (col) {
    return sheet.getRange(2, col, 마지막행 - 1, 1).getValues()
      .map(function (r) { return r[0]; });
  });

  const 결과 = [];
  for (let i = 0; i < 열들[0].length; i++) {
    결과.push(열들.map(function (열) { return 열[i]; }));
  }
  return 결과;
}

function b2g시트_(이름) {
  const sh = SpreadsheetApp.getActive().getSheetByName(이름);
  if (!sh) throw new Error('「' + 이름 + '」 시트를 찾을 수 없습니다.');
  return sh;
}

/** 로그 시트를 가져오거나 없으면 만듭니다. */
function b2g로그시트_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(B2G_CFG.로그시트);
  if (!sh) {
    sh = ss.insertSheet(B2G_CFG.로그시트);
    sh.appendRow([
      '실행시각', '공고 publicID', '공고_id', '요양사id',
      'participantId', '근무 시작일', '바꾼 서명일자', '결과', '메모'
    ]);
    sh.setFrozenRows(1);
  }
  return sh;
}

/* ===================== 사용법 시트 ===================== */

/**
 * 「B2G 사용법」 탭을 만들어 둡니다. (이미 있으면 내용을 최신으로 덮어씁니다)
 * 토큰 받는 법을 매번 물어보지 않아도 되도록 시트에 적어 둡니다.
 */
function b2g사용법시트_() {
  const ss = SpreadsheetApp.getActive();
  let sh = ss.getSheetByName(B2G_CFG.사용법시트);
  const 새로만듦 = !sh;
  if (새로만듦) sh = ss.insertSheet(B2G_CFG.사용법시트);

  const 줄 = [
    ['B2G 취업확인서 — 서명일자 일괄 수정 사용법'],
    [''],
    ['하는 일'],
    ['  취업확인서의 서명일자를 [근무 시작일 + 1일] 로 채웁니다.'],
    ['  raw 시트의 기준 공고(' + B2G_CFG.시작_공고ID + ') 다음 행부터가 대상입니다.'],
    ['  raw·통합관리·구직자 시트는 읽기만 하고 절대 바꾸지 않습니다.'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['실행하는 법'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  상단 메뉴 [📊 업데이트] → [🖊️ B2G 서명일자 일괄 수정]'],
    [''],
    ['  누르면 "N건을 바꿉니다. 진행할까요?" 확인창이 먼저 뜹니다.'],
    ['  실수로 눌러도 [아니오] 를 누르면 아무 일도 없습니다.'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['어드민 토큰 받는 법  ★ 물어볼 때만 하면 됩니다'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  토큰은 한 번 넣으면 저장됩니다. 40분쯤 지나 만료되면 그때만 다시 물어봅니다.'],
    [''],
    ['  1. 크롬에서 어드민(bo.carepartner.kr)에 로그인합니다.'],
    [''],
    ['  2. F12 를 눌러 개발자도구를 열고 [Console] 탭으로 갑니다.'],
    [''],
    ['  3. (처음 한 번만) 콘솔에 붙여넣기가 막혀 있으면,'],
    ['     아래를 손으로 타이핑하고 엔터를 칩니다.'],
    [''],
    ['        allow pasting'],
    [''],
    ['  4. 아래 한 줄을 복사해서 콘솔에 붙여넣고 엔터를 칩니다.'],
    [''],
    ["        JSON.parse(localStorage.getItem('app')).accessToken"],
    [''],
    ['  5. 이렇게 나옵니다.'],
    [''],
    ['        "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."'],
    [''],
    ['     그 줄에 오른쪽 클릭 → [Copy string contents] 를 누르면 깔끔하게 복사됩니다.'],
    ['     (그냥 드래그해서 복사해도 됩니다. 앞뒤 따옴표는 알아서 떼어냅니다)'],
    [''],
    ['  6. 시트로 돌아와 팝업 칸에 붙여넣고 [확인] 을 누릅니다.'],
    [''],
    ['  ※ "Bearer " 가 앞에 붙어 있는 게 정상입니다. 지우지 마세요.'],
    ['  ※ 토큰이 틀리면 바로 알려줍니다. 실행 중에 터지지 않습니다.'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['시간이 다 되어 멈췄다고 나오면'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  구글이 한 번에 6분까지만 실행을 허용합니다.'],
    ['  같은 메뉴를 다시 누르면 이어서 진행합니다.'],
    ['  이미 성공한 건은 건너뛰므로 여러 번 눌러도 중복되지 않습니다.'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['결과 확인'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  「' + B2G_CFG.로그시트 + '」 탭에 한 줄씩 쌓입니다.'],
    [''],
    ['    성공    바뀌었습니다.'],
    ['    실패    메모 칸에 이유가 있습니다. 다음 실행 때 다시 시도합니다.'],
    ['    건너뜀  아래 이유 중 하나입니다.'],
    ['              · 근무 시작일이 없어 계산 불가  → 확인서에 근무 시작일부터 넣어야 합니다'],
    ['              · 서명된 취업확인서 없음'],
    ['              · 조회 실패  → 다음 실행 때 다시 시도합니다'],
    [''],
    ['  ⚠️ 이 작업은 되돌릴 수 없고, 어드민에 기록이 남지 않습니다.'],
    ['     이 로그 탭이 유일한 기록이니 지우지 마세요.'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['건드리지 않는 건'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  · raw 「취업확인서대상」이 FALSE'],
    ['  · 통합관리 「매출 발생 일자」에 값이 있음'],
    ['  · 취업확인서에 근무 시작일이 없음'],
    ['  · 이미 성공한 건'],
    [''],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    ['문제가 생기면 (Apps Script 편집기에서 함수를 골라 ▶ 실행)'],
    ['━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'],
    [''],
    ['  b2g설정확인   아무것도 바꾸지 않고 50건을 미리 재봅니다. 제일 안전합니다.'],
    ['  b2g테스트1건  고칠 수 있는 첫 1건만 바꿉니다.'],
    ['  b2g권한승인   "UrlFetchApp 권한이 없습니다" 오류가 날 때 한 번 실행합니다.'],
    [''],
    ['  주소가 안 맞으면 ⚙️ 프로젝트 설정 → 스크립트 속성에서 확인하세요.'],
    ['    B2G_ADMIN_API   participantId 조회용'],
    ['    B2G_BBAS_API    서명일자 수정용']
  ];

  sh.clear();
  sh.getRange(1, 1, 줄.length, 1).setValues(줄);
  sh.getRange(1, 1).setFontSize(14).setFontWeight('bold');
  sh.setColumnWidth(1, 720);
  sh.getRange(1, 1, 줄.length, 1).setFontFamily('Arial').setVerticalAlignment('top');
  if (새로만듦) sh.setTabColor('#4285f4');
  return sh;
}

/* ===================== 대상 고르기 ===================== */

/**
 * 조회해 볼 대상 목록을 만듭니다.
 *
 * 시트로는 "확실히 아닌 것"만 걸러내고,
 * **취업확인서가 실제로 있는지는 API 가 판단합니다.**
 * (통합관리 「상태」는 CS 팀의 서류 수취 진행 단계라서 서버 실제 상태와 다를 수 있습니다)
 *
 *   ① raw 에서 기준 공고 **다음 행부터** 끝까지
 *   ② raw 「취업확인서대상」이 TRUE 인 것만  (FALSE 는 확인서가 아예 없고, 나중에 TRUE 로 바뀌지 않음)
 *   ③ 통합관리 「매출 발생 일자」가 있는 건 제외  (이미 매출이 잡힌 건은 절대 건드리지 않습니다)
 *   ④ 요양사id 가 있는 것만  (없으면 조회 자체가 불가능)
 *   ⑤ 로그에 이미 성공으로 남은 것은 제외
 */
function b2g대상만들기_() {
  const raw = b2g열읽기_(
    b2g시트_(B2G_CFG.원본시트),
    ['공고_id', '공고_public_id', '요양사id', '취업확인서대상']
  );

  const 기준 = raw.findIndex(function (r) {
    return String(r[1]).trim() === B2G_CFG.시작_공고ID;
  });
  if (기준 === -1) {
    throw new Error(
      '「' + B2G_CFG.원본시트 + '」 시트에서 기준 공고 "' + B2G_CFG.시작_공고ID + '" 를 찾지 못했습니다.\n' +
      '코드 상단 B2G_CFG.시작_공고ID 를 확인해 주세요.'
    );
  }

  // 통합관리: 매출이 이미 발생한 공고 → 손대면 안 되는 건
  const 매출발생 = {};
  b2g열읽기_(b2g시트_(B2G_CFG.매출시트), ['공고 publicID', '매출 발생 일자'])
    .forEach(function (r) {
      const id = String(r[0]).trim();
      if (id && String(r[1]).trim() !== '') 매출발생[id] = true;
    });

  // 로그: 이미 성공한 공고는 다시 하지 않습니다.
  // (확인서 없음·조회 실패 등은 제외하지 않습니다. 서류를 나중에 받으면 확인서가 생기기 때문입니다)
  const 완료 = {};
  const 로그 = b2g로그시트_();
  if (로그.getLastRow() > 1) {
    로그.getRange(2, 2, 로그.getLastRow() - 1, 7).getValues().forEach(function (r) {
      if (String(r[6]).trim().indexOf('성공') === 0) 완료[String(r[0]).trim()] = true;
    });
  }

  const 대상 = [];
  for (let i = 기준 + 1; i < raw.length; i++) {
    const publicId = String(raw[i][1]).trim();
    if (!publicId) continue;

    // raw 「취업확인서대상」이 FALSE 면 확인서가 아예 없습니다.
    // 이 값은 FALSE 에서 TRUE 로 바뀌지 않으므로 그냥 건너뜁니다.
    if (String(raw[i][3]).trim().toUpperCase() !== 'TRUE') continue;

    // 매출이 이미 발생한 건은 절대 건드리지 않습니다.
    if (매출발생[publicId]) continue;

    if (완료[publicId]) continue;

    const 요양사id = String(raw[i][2]).trim();
    if (!요양사id) continue;   // 요양사 id 가 없으면 조회 자체가 불가능

    대상.push({
      공고id: String(raw[i][0]).trim(),
      publicId: publicId,
      요양사id: 요양사id
    });
  }
  return 대상;
}

/* ===================== API ===================== */

/**
 * 취업확인서(참여내역)를 조회해 participantId 와 근무 시작일을 찾습니다.
 * 어드민 화면이 쓰는 것과 같은 방식입니다.
 */
function b2g조회요청_(주소, 토큰, 건) {
  return {
    url: 주소.어드민 + '/job_support_project_participants' +
         '?page=1&job_posting_id=' + encodeURIComponent(건.공고id) +
         '&user_id=' + encodeURIComponent(건.요양사id),
    method: 'get',
    headers: { Authorization: 토큰, Accept: 'application/json' },
    muteHttpExceptions: true
  };
}

/** 서명일자를 바꾸는 요청을 만듭니다. */
function b2g수정요청_(주소, 토큰, participantId, 서명일자) {
  return {
    url: 주소.bbas + '/api/v3/job-support-project-participant-bo/' + encodeURIComponent(participantId),
    method: 'patch',
    headers: { Authorization: 토큰, Accept: 'application/json' },
    payload: { signedAt: 서명일자 },
    muteHttpExceptions: true
  };
}

/** 서버 응답에서 값 하나를 꺼냅니다. (snake_case / camelCase 둘 다 대응) */
function b2g값_(obj, 이름들) {
  for (let i = 0; i < 이름들.length; i++) {
    if (obj && obj[이름들[i]] !== undefined && obj[이름들[i]] !== null) return obj[이름들[i]];
  }
  return null;
}

/**
 * 조회 응답에서 "서명이 완료된 취업확인서" 한 건을 골라냅니다.
 * 어드민 화면과 같은 조건: isDone = true 이고 method = 'signature'
 */
function b2g확인서고르기_(응답본문) {
  let json;
  try { json = JSON.parse(응답본문); } catch (e) { return null; }

  let 목록 = json;
  if (json && !Array.isArray(json)) 목록 = json.data || json.rows || json.items || [];
  if (json && json.data && json.data.data) 목록 = json.data.data;   // 래퍼가 한 겹 더인 경우
  if (!Array.isArray(목록)) return null;

  const 후보 = 목록.filter(function (p) {
    const done = b2g값_(p, ['isDone', 'is_done']);
    const method = b2g값_(p, ['method']);
    return (done === true || done === 'true') && method === 'signature';
  });
  return 후보.length ? 후보[0] : null;
}

/* ===================== 날짜 ===================== */

/**
 * 근무 시작일 + 1일 을 'YYYY-MM-DD' 로 돌려줍니다.
 * 시간대 때문에 하루가 밀리지 않도록 날짜 부분만 떼어 UTC 로 계산합니다.
 */
function b2g다음날_(근무시작일) {
  if (!근무시작일) return null;
  const m = String(근무시작일).match(/(\d{4})-?(\d{2})-?(\d{2})/);
  if (!m) return null;

  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + 1);

  const p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate());
}

/* ===================== 메뉴 ① 설정 확인 ===================== */

// 설정 확인에서 미리 재볼 건수. 조회만 하므로 아무것도 바뀌지 않습니다.
const B2G_표본 = 50;

/**
 * 아무것도 바꾸지 않고 조회만 해서, 실제로 몇 건이나 고칠 수 있는지 미리 재봅니다.
 *
 * 특히 **근무 시작일이 비어 있는 건이 얼마나 되는지**를 봅니다.
 * 근무 시작일이 없으면 서명일자를 계산할 수 없어 그 건은 건드리지 않습니다.
 */
function b2g설정확인() {
  const ui = SpreadsheetApp.getUi();
  try {
    b2g사용법시트_();
    const 주소 = b2g주소읽기_();
    const 대상 = b2g대상만들기_();

    if (!대상.length) {
      ui.alert('조회할 대상이 없습니다.\n(기준 공고 이후 / 취업확인서대상 TRUE / 매출 미발생 / 로그에 성공 없음)');
      return;
    }

    const 표본 = 대상.slice(0, B2G_표본);
    const 토큰 = b2g토큰준비_(주소, 표본[0]);
    if (!토큰) return;

    const 응답들 = UrlFetchApp.fetchAll(표본.map(function (건) {
      return b2g조회요청_(주소, 토큰, 건);
    }));

    let 조회실패 = 0, 확인서없음 = 0, 근무일없음 = 0, 고칠수있음 = 0;
    let 첫본문 = '';
    const 예시 = [];

    응답들.forEach(function (res, k) {
      if (k === 0) 첫본문 = res.getContentText();
      if (res.getResponseCode() !== 200) { 조회실패++; return; }

      const 확인서 = b2g확인서고르기_(res.getContentText());
      if (!확인서) { 확인서없음++; return; }

      const 근무시작일 = b2g값_(확인서, ['workStartDate', 'work_start_date']);
      const 서명일자 = b2g다음날_(근무시작일);
      if (!서명일자) { 근무일없음++; return; }

      고칠수있음++;
      if (예시.length < 3) {
        예시.push(
          '  ' + 표본[k].publicId +
          ' : ' + String(근무시작일).substring(0, 10) +
          ' → ' + 서명일자 +
          ' (지금 ' + (b2g값_(확인서, ['signedAt', 'signed_at']) || '없음') + ')'
        );
      }
    });

    const 비율 = Math.round((고칠수있음 / 표본.length) * 100);

    ui.alert(
      '설정 확인 결과 (조회만 함, 아무것도 안 바뀜)',
      '어드민 API : ' + 주소.어드민 + '\n' +
      'BBAS API  : ' + 주소.bbas + '\n\n' +
      '전체 대상 : ' + 대상.length + '건\n' +
      '이번에 재본 표본 : ' + 표본.length + '건\n\n' +
      '── 표본 결과 ──\n' +
      '고칠 수 있음        : ' + 고칠수있음 + '건 (' + 비율 + '%)\n' +
      '근무 시작일 없음    : ' + 근무일없음 + '건  ← 계산 불가라 건드리지 않음\n' +
      '서명된 확인서 없음  : ' + 확인서없음 + '건\n' +
      '조회 실패           : ' + 조회실패 + '건\n\n' +
      (예시.length ? '── 바뀔 예시 ──\n' + 예시.join('\n') + '\n\n' : '') +
      '전체 ' + 대상.length + '건 중 대략 ' +
      Math.round(대상.length * 고칠수있음 / 표본.length) + '건 정도가 고쳐질 것으로 보입니다.\n\n' +
      '── 첫 건 응답 원문 ──\n' + 첫본문.substring(0, 400),
      ui.ButtonSet.OK
    );
  } catch (e) {
    ui.alert('오류', String(e.message || e), ui.ButtonSet.OK);
  }
}

/* ===================== 메뉴 ② 1건 테스트 / ③ 전체 실행 ===================== */

function b2g테스트1건() { b2g실행_(1); }

function b2g전체실행() { b2g실행_(0); }

/**
 * @param {number} 최대건수  **실제로 고칠** 최대 건수. 0 이면 제한 없음.
 *
 * 근무 시작일이 없어 건너뛴 건은 이 숫자에 포함되지 않습니다.
 * 그래서 [1건만 테스트] 는 "고칠 수 있는 첫 건" 하나를 확실히 바꿉니다.
 */
function b2g실행_(최대건수) {
  const ui = SpreadsheetApp.getUi();
  const 시작시각 = new Date().getTime();

  let 주소, 대상;
  try {
    b2g사용법시트_();
    주소 = b2g주소읽기_();
    대상 = b2g대상만들기_();
  } catch (e) {
    ui.alert('오류', String(e.message || e), ui.ButtonSet.OK);
    return;
  }

  if (!대상.length) {
    ui.alert('조회할 대상이 없습니다.\n(기준 공고 이후 / 취업확인서대상 TRUE / 매출 미발생 / 로그에 성공 없음)');
    return;
  }
  const 확인 = ui.alert(
    최대건수 === 1 ? '1건만 테스트' : '전체 실행',
    (최대건수 > 0
      ? '고칠 수 있는 첫 ' + 최대건수 + '건만 바꿉니다. (조회 대상 ' + 대상.length + '건)\n\n'
      : '대상 ' + 대상.length + '건을 조회해서, 고칠 수 있는 건의 서명일자를 [근무 시작일 + 1일] 로 바꿉니다.\n\n') +
    '⚠️ 되돌리는 방법이 없습니다.\n' +
    '⚠️ 어드민에 기록이 남지 않습니다. 「' + B2G_CFG.로그시트 + '」 탭이 유일한 기록입니다.\n\n' +
    '진행할까요?',
    ui.ButtonSet.YES_NO
  );
  if (확인 !== ui.Button.YES) return;

  const 토큰 = b2g토큰준비_(주소, 대상[0]);
  if (!토큰) return;

  const 로그 = b2g로그시트_();
  const 지금 = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
  let 성공 = 0, 실패 = 0, 건너뜀 = 0;
  let 시간초과 = false;

  for (let i = 0; i < 대상.length; i += B2G_CFG.묶음크기) {
    if ((new Date().getTime() - 시작시각) / 1000 > B2G_CFG.제한초) { 시간초과 = true; break; }

    const 묶음 = 대상.slice(i, i + B2G_CFG.묶음크기);
    const 줄들 = [];

    // ① 조회 — participantId 와 근무 시작일 찾기
    const 조회응답 = UrlFetchApp.fetchAll(묶음.map(function (건) {
      return b2g조회요청_(주소, 토큰, 건);
    }));

    const 수정할것 = [];
    조회응답.forEach(function (res, k) {
      const 건 = 묶음[k];
      const 코드 = res.getResponseCode();

      if (코드 === 401) throw new Error('토큰이 만료되었거나 잘못되었습니다. 토큰을 다시 복사해 주세요.');
      if (코드 !== 200) {
        건너뜀++;
        줄들.push([지금, 건.publicId, 건.공고id, 건.요양사id, '', '', '', '건너뜀', '조회 실패 (' + 코드 + ')']);
        return;
      }

      const 확인서 = b2g확인서고르기_(res.getContentText());
      if (!확인서) {
        건너뜀++;
        줄들.push([지금, 건.publicId, 건.공고id, 건.요양사id, '', '', '', '건너뜀', '서명된 취업확인서 없음']);
        return;
      }

      const participantId = b2g값_(확인서, ['id']);
      const 근무시작일 = b2g값_(확인서, ['workStartDate', 'work_start_date']);
      const 서명일자 = b2g다음날_(근무시작일);

      if (!participantId || !서명일자) {
        건너뜀++;
        줄들.push([지금, 건.publicId, 건.공고id, 건.요양사id, participantId || '', 근무시작일 || '', '', '건너뜀',
                   !participantId ? 'participantId 없음' : '근무 시작일이 없어 계산 불가']);
        return;
      }

      수정할것.push({ 건: 건, participantId: participantId, 근무시작일: 근무시작일, 서명일자: 서명일자 });
    });

    // ② 수정 — 서명일자 바꾸기
    // [1건만 테스트] 처럼 상한이 있으면, 남은 만큼만 자릅니다.
    const 수정할것제한 = (최대건수 > 0)
      ? 수정할것.slice(0, Math.max(0, 최대건수 - 성공 - 실패))
      : 수정할것;

    if (수정할것제한.length) {
      const 수정응답 = UrlFetchApp.fetchAll(수정할것제한.map(function (x) {
        return b2g수정요청_(주소, 토큰, x.participantId, x.서명일자);
      }));

      수정응답.forEach(function (res, k) {
        const x = 수정할것제한[k];
        const 코드 = res.getResponseCode();
        const 성공여부 = (코드 >= 200 && 코드 < 300);
        if (성공여부) 성공++; else 실패++;

        줄들.push([
          지금, x.건.publicId, x.건.공고id, x.건.요양사id,
          x.participantId, String(x.근무시작일).substring(0, 10), x.서명일자,
          성공여부 ? '성공' : '실패',
          성공여부 ? '' : (코드 + ' ' + res.getContentText().substring(0, 200))
        ]);
      });
    }

    if (줄들.length) {
      로그.getRange(로그.getLastRow() + 1, 1, 줄들.length, 줄들[0].length).setValues(줄들);
      SpreadsheetApp.flush();
    }

    // [1건만 테스트] 처럼 상한이 있으면 다 채운 순간 멈춥니다.
    if (최대건수 > 0 && 성공 + 실패 >= 최대건수) break;
  }

  const 남음 = 시간초과 ? ('\n\n⏱️ 시간이 다 되어 멈췄습니다. 메뉴에서 다시 실행하면 이어서 진행합니다.') : '';
  ui.alert(
    '완료',
    '성공 ' + 성공 + '건\n' +
    '실패 ' + 실패 + '건\n' +
    '건너뜀 ' + 건너뜀 + '건\n\n' +
    '자세한 내용은 「' + B2G_CFG.로그시트 + '」 탭을 확인하세요.' + 남음,
    ui.ButtonSet.OK
  );
}
