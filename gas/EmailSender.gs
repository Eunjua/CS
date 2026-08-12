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
