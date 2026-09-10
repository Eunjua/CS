/**
 * 이메일 발송 도구 — 화면(email-sender/index.html) ↔ Gmail 발송 백엔드
 *
 * [하는 일]
 *   CS 상담원이 화면에서 작성한 메일(받는사람·제목·본문·첨부)을 받아,
 *   회사 대표 메일(eju@bosalpim.co.kr) 발신으로 고객에게 보냅니다.
 *   보낸 메일 사본은 은주 Gmail "보낸편지함"에 자동으로 남습니다.
 *
 * ─────────────────────────────────────────────────────────────
 * [배포 방법] — 비개발자용 단계별
 *   ① 이 .gs 파일 내용을 은주 계정의 Apps Script 프로젝트에 그대로 붙여넣고 저장합니다.
 *      (구글 드라이브 → 새로 만들기 → 더보기 → Google Apps Script)
 *   ② 프로젝트 설정 → 스크립트 속성에 SEND_PIN을 추가하고, 원하는 PIN 값을 넣습니다.
 *      (상담원 2명과 공유할 공용 PIN. 코드가 아니라 여기에 두어야 파일을 다시
 *       붙여넣어도 PIN이 되돌아가지 않습니다. 비즈엠 계정 정보와 같은 방식입니다.)
 *   ③ 우상단 [배포] → [새 배포] → 유형을 "웹 앱"으로 선택합니다.
 *        - 실행: 나 (은주 계정)
 *        - 액세스 권한: 링크가 있는 모든 사용자
 *      → [배포]를 누르면 웹앱 URL이 발급됩니다.
 *   ④ 발급된 웹앱 URL을 복사해, email-sender/index.html 상단의
 *      const GAS_URL = "..."  안에 붙여넣습니다.
 *   ⑤ 첫 발송 시 "Gmail로 메일을 보낼 권한"을 묻는 화면이 뜨면 승인합니다. (은주 계정 1회)
 * ─────────────────────────────────────────────────────────────
 *
 * [코드 수정 후 재배포]
 *   배포 → 배포 관리 → (연필) 편집 → 버전: '새 버전' → 배포   (URL 그대로 유지)
 */

// 발신자 표시명(발신 주소는 은주 계정으로 고정되며, 이름만 이 값으로 표시됩니다)
const SENDER_NAME = "케어아카데미";

/**
 * 발송 권한 게이트용 공용 PIN을 스크립트 속성에서 읽어옵니다.
 *
 * PIN을 이 파일에 직접 적지 않는 이유:
 *   이 파일은 공개 저장소에 올라갑니다. 코드에 PIN을 적어두면 누구나 볼 수 있고,
 *   무엇보다 이 파일을 Apps Script에 다시 붙여넣는 순간 PIN이 파일에 적힌 값으로
 *   조용히 되돌아갑니다(아무 에러도 나지 않아 알아채기 어렵습니다).
 *   스크립트 속성에 두면 파일을 몇 번을 붙여넣어도 PIN은 그대로입니다.
 *
 * 설정하지 않으면 발송이 전부 막힙니다(약한 상태로 조용히 넘어가지 않게 하려는 것).
 */
function getSendPin_() {
  const pin = String(PropertiesService.getScriptProperties().getProperty('SEND_PIN') || '').trim();
  if (!pin) {
    throw new Error('발송 PIN이 설정되지 않았습니다. Apps Script → 프로젝트 설정 → 스크립트 속성에 SEND_PIN을 넣어 주세요.');
  }
  return pin;
}

/* ===================== 발송 처리 ===================== */
/**
 * 받는 JSON 예:
 * {
 *   "to": "customer@example.com",
 *   "subject": "제목",
 *   "body": "본문\n줄바꿈 보존",
 *   "pin": "발송PIN",
 *   "attachments": [ { "filename":"이수증.pdf", "mimeType":"application/pdf", "dataBase64":"..." }, ... ]
 * }
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');

    // PIN 검증 (불일치 시 발송 안 함)
    if (String(body.pin || '') !== getSendPin_()) {
      return jsonOut_({ ok: false, error: 'PIN이 올바르지 않습니다.' });
    }

    // 템플릿 관리 탭에서 온 요청(추가·수정·삭제)
    if (body.action === 'saveTemplate')   return jsonOut_(saveTemplate_(body.template));
    if (body.action === 'deleteTemplate') return jsonOut_(deleteTemplate_(body.key));

    // 화면의 "문자·알림톡" 탭에서 온 요청이면 비즈엠 발송(BizmSender.gs)으로 넘깁니다.
    if (body.channel === 'sms' || body.channel === 'alimtalk') {
      return jsonOut_(sendBizm_(body));
    }

    const to      = String(body.to || '').trim();
    const subject = String(body.subject || '').trim();
    const text    = String(body.body || '');

    if (!to)      return jsonOut_({ ok: false, error: '받는 사람 이메일이 없습니다.' });
    if (!subject) return jsonOut_({ ok: false, error: '제목이 없습니다.' });
    if (!text.trim()) return jsonOut_({ ok: false, error: '본문이 없습니다.' });

    // 첨부 base64 → Blob 복원
    const blobs = [];
    const atts = Array.isArray(body.attachments) ? body.attachments : [];
    for (let i = 0; i < atts.length; i++) {
      const a = atts[i] || {};
      if (!a.dataBase64) continue;
      const bytes = Utilities.base64Decode(a.dataBase64);
      const mime  = a.mimeType || 'application/octet-stream';
      const name  = a.filename || ('첨부' + (i + 1));
      blobs.push(Utilities.newBlob(bytes, mime, name));
    }

    // 발송: 본문 줄바꿈(\n)이 메일에서 보존되도록 htmlBody로도 함께 전달(\n → <br>)
    GmailApp.sendEmail(to, subject, text, {
      name: SENDER_NAME,
      attachments: blobs,
      htmlBody: nl2br_(escapeHtml_(text))
    });

    return jsonOut_({ ok: true, to: to, attached: blobs.length });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* ===================== 템플릿 저장소 (구글시트) =====================
 * 문자·이메일 템플릿의 원본은 구글시트입니다.
 * 화면(템플릿 관리 탭)에서 추가·수정한 내용이 이 시트에 저장되고,
 * 상담원 모두가 같은 목록을 보게 됩니다.
 *
 * [최초 1회 설정]
 *   프로젝트 설정 → 스크립트 속성에 TEMPLATE_SHEET_ID를 추가하고,
 *   템플릿 시트 주소에서 /d/ 와 /edit 사이의 긴 문자열을 넣어 주세요.
 *   예) https://docs.google.com/spreadsheets/d/[이 부분]/edit
 *   시트가 비어 있으면 첫 실행 때 제목줄과 기본 템플릿이 자동으로 채워집니다.
 */
const TPL_HEADER = ['key', '구분', '템플릿명', '제목', '본문', '수정일시'];

/**
 * 구분 값을 정리합니다. 한 템플릿을 문자·이메일 양쪽에서 쓸 수 있어
 * "문자", "이메일", "문자,이메일" 세 가지가 나옵니다.
 * (예전에 저장된 "문자"/"이메일" 값도 그대로 읽힙니다.)
 */
function normKind_(v) {
  const s    = String(v || '');
  const sms  = s.indexOf('문자')   > -1;
  const mail = s.indexOf('이메일') > -1;
  if (sms && mail) return '문자,이메일';
  if (mail)        return '이메일';
  return '문자';                       // 값이 이상하면 문자로 둡니다
}

/** 템플릿 시트를 열어 옵니다(없으면 제목줄·기본 템플릿을 만들어 둡니다). */
function getTemplateSheet_() {
  const id = String(PropertiesService.getScriptProperties().getProperty('TEMPLATE_SHEET_ID') || '').trim();
  if (!id) {
    throw new Error('TEMPLATE_SHEET_ID가 설정되지 않았습니다. Apps Script → 프로젝트 설정 → 스크립트 속성에 템플릿 시트 ID를 넣어 주세요.');
  }
  const sh = SpreadsheetApp.openById(id).getSheets()[0];

  // 완전히 빈 시트일 때만 제목줄과 기본 템플릿을 만들어 넣습니다.
  if (sh.getLastRow() < 1) {
    sh.getRange(1, 1, 1, TPL_HEADER.length).setValues([TPL_HEADER]).setFontWeight('bold');
    sh.setFrozenRows(1);
    seedTemplates_(sh);
    return sh;
  }

  // 내용이 있는데 제목줄이 다르면, 덮어쓰지 않고 멈춥니다.
  // (제목줄을 실수로 지웠을 때 그동안 만든 템플릿이 사라지는 일을 막기 위한 것입니다.)
  if (String(sh.getRange(1, 1).getValue()).trim() !== 'key') {
    throw new Error('템플릿 시트의 첫 줄이 "key"로 시작해야 합니다. 첫 줄을 ' +
                    TPL_HEADER.join(' / ') + ' 로 되돌려 주세요.');
  }
  return sh;
}

/** 시트의 템플릿을 모두 읽어 옵니다. */
function readTemplates_() {
  const sh = getTemplateSheet_();
  const last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, TPL_HEADER.length).getValues()
    .filter(function (r) { return String(r[0]).trim(); })
    .map(function (r) {
      return {
        key:   String(r[0]).trim(),
        kind:  normKind_(r[1]),
        name:  String(r[2]),
        title: String(r[3]),
        body:  String(r[4])
      };
    });
}

/** 템플릿을 추가하거나(키 없음) 고칩니다(키 있음). */
function saveTemplate_(t) {
  t = t || {};
  const name = String(t.name || '').trim();
  const body = String(t.body || '');
  if (!name)        return { ok: false, error: '템플릿명이 없습니다.' };
  if (!body.trim()) return { ok: false, error: '내용이 없습니다.' };

  const sh   = getTemplateSheet_();
  const kind = normKind_(t.kind);
  const key  = String(t.key || '').trim() || ('t' + Date.now());
  const row  = [key, kind, name, String(t.title || ''), body, new Date()];

  const found = findTemplateRow_(sh, key);
  if (found > 0) {
    sh.getRange(found, 1, 1, TPL_HEADER.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
  return { ok: true, key: key, templates: readTemplates_() };
}

/** 템플릿 한 건을 지웁니다. */
function deleteTemplate_(key) {
  key = String(key || '').trim();
  if (!key) return { ok: false, error: '지울 템플릿을 찾지 못했습니다.' };

  const sh  = getTemplateSheet_();
  const row = findTemplateRow_(sh, key);
  if (row < 1) return { ok: false, error: '이미 지워졌거나 없는 템플릿입니다.' };

  sh.deleteRow(row);
  return { ok: true, templates: readTemplates_() };
}

/** key가 있는 행 번호를 찾습니다(없으면 -1). */
function findTemplateRow_(sh, key) {
  const last = sh.getLastRow();
  if (last < 2) return -1;
  const keys = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < keys.length; i++) {
    if (String(keys[i][0]).trim() === key) return i + 2;   // 제목줄 때문에 +2
  }
  return -1;
}

/** 시트가 비어 있을 때 채워 넣는 기본 템플릿입니다. */
function seedTemplates_(sh) {
  const now = new Date();
  const rows = [
    ['app', '문자', '앱 다운로드 안내', '케어파트너 앱 설치 안내',
      '안녕하세요, 케어파트너입니다.\n' +
      '케어파트너 어플 다운 받는 링크 전달드려요.\n' +
      '아래 영어를 눌러 어플을 설치해주세요.\n\n' +
      'https://play.google.com/store/search?q=케어파트너&c=apps&hl=ko\n\n' +
      '※ 아이폰(아이패드)에서는 앱을 설치하실 수 없습니다.\n' +
      '아이폰을 쓰신다면 인터넷에 "케어파트너"를 검색해주세요.', now],
    ['chat', '문자', '채팅 상담 안내', '케어파트너 상담 안내',
      '문의 주신 내용은 채팅으로 자세히 도와드리고 있습니다.\n' +
      '아래 링크 눌러주시면 카카오톡 문의로 바로 연결 됩니다.\n\n' +
      'http://pf.kakao.com/_jixkfG/chat', now],
    ['job', '문자', '일자리 확인 방법', '일자리 확인 방법 안내',
      '일자리는 아래 방법을 통해 알아보시는 걸 추천드려요!\n\n' +
      '- 고용24 (www.work24.go.kr)\n' +
      '- 서울교육청 구인구직 (https://work.sen.go.kr/work/index.do)\n' +
      '- 고용노동부 고객센터 국번없이 1350\n' +
      '- 거주 지역 일자리센터\n' +
      '모두 무료로 이용하실 수 있어요', now],
    ['refund', '문자', '자격증 환불 안내(예외)', '자격증 환불 안내',
      '안녕하세요 케어파트너입니다.\n\n' +
      '자격증은 발급과 동시에 효력이 발생하여, 자격증 자체의 하자나 안내 오류가 없는 경우 규정상 환불이 어렵습니다. 자격증의 활용 범위는 고객님의 상황에 따라 다르게 느껴지실 수 있는 부분입니다. 다만 고객님의 상황을 고려하여, 내부 논의를 거쳐 이번 건에 한해 예외적으로 환불을 도와드리기로 하였습니다.\n\n' +
      '환불은 배송비를 제외한 자격증 발급비용만 환불 될 예정이며,\n' +
      '도착 후 7일 내 환불 처리될 예정입니다.\n\n' +
      '반송지: 서울특별시 강남구 역삼동 641-10, 2층\n' +
      '받는 사람: 보살핌\n' +
      '택배는 선불로 보내주셔야 합니다.', now],
    ['book', '이메일', '교재 발송 안내', '[케어아카데미] 교재 발송 안내',
      '안녕하세요 케어아카데미입니다.\n\n' +
      '요청해 주신 교재 발송 안내드립니다. 수강에 많은 도움 되시길 바랍니다.☺️\n\n' +
      '감사합니다.\n' +
      '케어아카데미 드림', now],
    ['cert', '이메일', '이수증·확인서 첨부', '[케어아카데미] 요청하신 증명 서류 첨부 안내',
      '안녕하세요 케어아카데미입니다.\n\n' +
      '요청해 주신 확인서 메일에 첨부하여 보내드립니다.\n' +
      '첨부된 PDF 파일을 확인해 주세요.\n\n' +
      '감사합니다.\n\n' +
      '케어아카데미 드림', now],
    ['scan', '이메일', '자격증 스캔본 전달', '[케어아카데미] 요청하신 자격증 스캔본 전달',
      '안녕하세요 케어아카데미입니다.\n\n' +
      '요청해 주신 자격증 스캔본을 메일에 첨부하여 보내드립니다.\n' +
      '첨부된 PDF 파일을 확인해 주세요.\n\n' +
      '스캔본 관련하여 궁금한 점이 있으시면 편하게 문의해 주세요.\n' +
      '감사합니다.\n\n' +
      '케어아카데미 드림', now],
    ['receipt', '이메일', '결제 영수증 전달', '[케어아카데미] 결제 영수증 전달',
      '안녕하세요 케어아카데미입니다.\n\n' +
      '요청해 주신 결제 영수증을 메일에 첨부하여 보내드립니다.\n' +
      '첨부된 파일에서 결제 내역을 확인하실 수 있습니다.\n\n' +
      '영수증 관련하여 궁금한 점이 있으시면 편하게 문의해 주세요.\n' +
      '감사합니다.\n\n' +
      '케어아카데미 드림', now]
  ];
  sh.getRange(2, 1, rows.length, TPL_HEADER.length).setValues(rows);
}

/* ===================== 템플릿 읽기 (화면이 GET으로 호출) ===================== */
function doGet(e) {
  try {
    return jsonOut_({ ok: true, templates: readTemplates_() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

/* ===================== 도우미 ===================== */
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/** 줄바꿈 \n → <br> (HTML 본문에서 줄바꿈 보존) */
function nl2br_(s) {
  return String(s).replace(/\r\n|\r|\n/g, '<br>');
}

/** HTML 특수문자 이스케이프(본문이 그대로 글자로 보이도록) */
function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ===================== (선택) 수동 테스트 ===================== */
/** Apps Script 편집기에서 직접 실행해 권한 승인/발송을 확인할 때 사용 */
function testSend() {
  GmailApp.sendEmail('eju@bosalpim.co.kr', '[테스트] 이메일 발송 도구', '테스트 본문입니다.', { name: SENDER_NAME });
}
