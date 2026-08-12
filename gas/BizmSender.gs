/**
 * 문자·알림톡 발송 백엔드 — 화면(email-sender/index.html "문자·알림톡" 탭) ↔ 비즈엠 API
 *
 * [하는 일]
 *   CS 상담원이 화면에서 입력한 번호·내용을 받아 비즈엠(스윗트래커) API로 발송합니다.
 *   - "문자만 보내기"  : 카카오를 거치지 않고 바로 SMS/LMS 발송 (문구 자유)
 *   - "알림톡 → 문자"  : 승인된 템플릿으로 알림톡 발송, 실패하면 문자로 자동 대체
 *
 * ─────────────────────────────────────────────────────────────
 * [최초 1회 설정] — 비즈엠 계정 정보 넣기
 *
 *   비즈엠 계정 정보는 이 코드에 직접 적지 않습니다.
 *   (이 폴더는 GitHub에 올라가므로, 코드에 적으면 키가 그대로 공개됩니다.)
 *   대신 Apps Script의 "스크립트 속성"에 저장합니다.
 *     ① Apps Script 편집기 왼쪽 ⚙️ [프로젝트 설정] 클릭
 *     ② 맨 아래 [스크립트 속성] → [스크립트 속성 추가] 를 눌러 아래 3개를 넣고 저장
 *          BIZM_USERID       = 비즈엠 로그인 계정명        (예: bosalpim21)
 *          BIZM_PROFILE_KEY  = 발신프로필키               (영문+숫자 40자)
 *          BIZM_SENDER_NUM   = 승인된 발신번호, 하이픈 없이 (예: 15881234)
 *     ③ 넣은 뒤 checkBizmConfig() 를 실행하면 제대로 들어갔는지 확인할 수 있습니다.
 * ─────────────────────────────────────────────────────────────
 *
 * [발송 결과 코드 참고]
 *   K000 = 알림톡 성공 / M000 = 문자 성공
 *   K104 TemplateNotFound  = 템플릿 코드가 없음
 *   K105 NoMatchedTemplate = 승인된 템플릿 문구와 내용이 다름
 *   M107 DeniedSenderNumber = 승인되지 않은 발신번호
 *   E104 InvalidPhoneNumber = 번호 형식 오류
 */

/* ===================== 설정 ===================== */

// 비즈엠 API 서버 (운영)
const BIZM_HOST = 'https://alimtalk-api.sweettracker.net';

// 한 번에 보낼 수 있는 최대 인원 (비즈엠 API 제한)
const BIZM_MAX_RECIPIENTS = 100;

// SMS(단문) 한도. 이 byte를 넘으면 LMS(장문)로 발송됩니다.
const SMS_BYTE_LIMIT = 90;

/** 스크립트 속성에서 비즈엠 계정 정보를 읽어옵니다. */
function getBizmConfig_() {
  const p = PropertiesService.getScriptProperties();
  const cfg = {
    userid:     String(p.getProperty('BIZM_USERID')      || '').trim(),
    profileKey: String(p.getProperty('BIZM_PROFILE_KEY') || '').trim(),
    senderNum:  String(p.getProperty('BIZM_SENDER_NUM')  || '').replace(/[^0-9]/g, '')
  };
  if (!cfg.userid || !cfg.profileKey || !cfg.senderNum) {
    throw new Error('비즈엠 계정 정보가 설정되지 않았습니다. Apps Script → 프로젝트 설정 → 스크립트 속성에 BIZM_USERID, BIZM_PROFILE_KEY, BIZM_SENDER_NUM을 넣어 주세요.');
  }
  return cfg;
}

/* ===================== 발송 처리 ===================== */
/**
 * 화면에서 받는 JSON 예:
 * {
 *   "channel": "sms",              // "sms"(문자만) 또는 "alimtalk"(알림톡→문자 대체)
 *   "numbers": ["01012345678", …], // 최대 100명
 *   "message": "보낼 내용",
 *   "smsTitle": "장문 제목",        // LMS일 때만 사용, 없으면 생략
 *   "templateCode": "care_001",    // channel이 alimtalk일 때 필수
 *   "pin": "발송PIN"
 * }
 *
 * 돌려주는 JSON 예:
 * { "ok": true, "sent": 3, "failed": 1, "kind": "LMS",
 *   "results": [ { "number":"010…", "ok":true, "text":"문자 발송 성공" }, … ] }
 */
function sendBizm_(body) {
  const channel  = String(body.channel || 'sms');
  const isAlim   = channel === 'alimtalk';
  const message  = String(body.message || '');
  const smsTitle = String(body.smsTitle || '').trim();
  const tmplCode = String(body.templateCode || '').trim();

  // ── 입력 검증 ──
  const numbers = normalizeNumbers_(body.numbers);
  if (!numbers.length)   return { ok: false, error: '받는 사람 번호가 없습니다.' };
  if (numbers.length > BIZM_MAX_RECIPIENTS) {
    return { ok: false, error: '한 번에 최대 ' + BIZM_MAX_RECIPIENTS + '명까지 보낼 수 있습니다. (현재 ' + numbers.length + '명)' };
  }
  const bad = numbers.filter(function (n) { return !isValidPhone_(n); });
  if (bad.length) return { ok: false, error: '번호 형식이 올바르지 않습니다: ' + bad.join(', ') };

  if (!message.trim()) return { ok: false, error: '보낼 내용이 없습니다.' };
  if (isAlim && !tmplCode) return { ok: false, error: '알림톡은 템플릿 코드가 필요합니다.' };

  // 문자에는 이모지를 넣을 수 없습니다 (비즈엠 제약)
  if (hasEmoji_(message)) {
    return { ok: false, error: '문자에는 이모지를 넣을 수 없습니다. 이모지를 지우고 다시 보내 주세요.' };
  }

  const cfg   = getBizmConfig_();
  const bytes = byteLen_(message);
  const isLms = bytes > SMS_BYTE_LIMIT;
  const kind  = isLms ? 'L' : 'S';   // S: SMS(단문), L: LMS(장문)

  if (isLms && bytes > 2000) {
    return { ok: false, error: '내용이 너무 깁니다. 장문(LMS)은 2,000byte(한글 약 1,000자)까지입니다. (현재 ' + bytes + 'byte)' };
  }

  // ── 요청 본문 만들기 (수신자 1명당 1건, JSON 배열) ──
  const stamp = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyyMMddHHmmss');
  const payload = numbers.map(function (num, i) {
    const msg = {
      msgid:         makeMsgId_(stamp, i),
      profile_key:   cfg.profileKey,
      receiver_num:  num,
      message:       message,
      reserved_time: '00000000000000',   // 즉시 발송
      sender_num:    cfg.senderNum,
      sms_kind:      kind
    };

    if (isAlim) {
      // 알림톡으로 먼저 시도 → 실패 시 문자로 대체 발송
      msg.message_type  = 'AT';
      msg.template_code = tmplCode;
      msg.sms_only      = 'N';
      msg.sms_message   = message;      // 대체 발송될 문자 내용
      if (isLms) msg.sms_title = smsTitle || '케어아카데미 안내';
    } else {
      // 카카오를 거치지 않고 문자로만 발송
      msg.sms_only    = 'Y';
      msg.sms_message = message;
      if (isLms) msg.sms_title = smsTitle || '케어아카데미 안내';
    }
    return msg;
  });

  // ── 비즈엠 API 호출 ──
  let res;
  try {
    res = UrlFetchApp.fetch(BIZM_HOST + '/v2/' + cfg.profileKey + '/sendMessage', {
      method: 'post',
      contentType: 'application/json',
      headers: { userid: cfg.userid },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    return { ok: false, error: '비즈엠 서버에 연결하지 못했습니다: ' + String(err) };
  }

  const status = res.getResponseCode();
  const raw    = res.getContentText();
  if (status !== 200) {
    return { ok: false, error: '비즈엠 서버 오류(' + status + '): ' + raw.slice(0, 300) };
  }

  let list;
  try {
    list = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: '비즈엠 응답을 읽지 못했습니다: ' + raw.slice(0, 300) };
  }
  if (!Array.isArray(list)) list = [list];

  // ── 결과를 사람이 읽을 수 있는 문장으로 정리 ──
  const results = list.map(function (r, i) {
    const ok = String(r.result || '') === 'Y';
    return {
      number: numbers[i] || '',
      ok:     ok,
      text:   describeResult_(r, isAlim)
    };
  });
  const sent = results.filter(function (r) { return r.ok; }).length;

  logSend_(results, isAlim, isLms, message);

  return {
    ok:      sent > 0,
    sent:    sent,
    failed:  results.length - sent,
    kind:    isAlim ? '알림톡' : (isLms ? 'LMS' : 'SMS'),
    results: results,
    error:   sent > 0 ? '' : '모두 발송에 실패했습니다.'
  };
}

/** 비즈엠 응답 1건을 상담원이 이해할 수 있는 문장으로 바꿉니다. */
function describeResult_(r, isAlim) {
  const ok   = String(r.result || '') === 'Y';
  const kind = String(r.kind || '');
  const code = String(r.code || '');
  const err  = String(r.error || '');
  const originError = String(r.originError || '');

  if (ok) {
    if (kind === 'K') return '알림톡 발송 성공';
    if (kind === 'M') {
      return originError
        ? '알림톡 실패(' + friendlyError_(originError) + ') → 문자로 대체 발송 성공'
        : '문자 발송 성공';
    }
    return '발송 성공';
  }

  const reason = friendlyError_(err) || code || '알 수 없는 오류';
  if (isAlim && originError) {
    return '알림톡 실패(' + friendlyError_(originError) + ') → 문자 대체 발송도 실패: ' + reason;
  }
  return '발송 실패: ' + reason + (code ? ' [' + code + ']' : '');
}

/** 비즈엠 에러 메시지를 한국어로 풀어 씁니다. */
function friendlyError_(err) {
  const map = {
    TemplateNotFound:    '템플릿 코드를 찾을 수 없음',
    NoMatchedTemplate:   '승인된 템플릿 문구와 내용이 다름',
    DeniedSenderNumber:  '승인되지 않은 발신번호',
    InvalidPhoneNumber:  '번호 형식 오류',
    InvalidProfileKey:   '발신프로필키 오류',
    NotFriendTalk:       '채널 미추가 고객',
    DisabledProfile:     '발신프로필 사용 중지',
    BlockedProfileKey:   '차단된 발신프로필'
  };
  return map[err] || err;
}

/* ===================== 도우미 ===================== */

/** 번호 목록을 숫자만 남기고 정리합니다. (배열 또는 줄바꿈 문자열 모두 허용) */
function normalizeNumbers_(input) {
  let arr = [];
  if (Array.isArray(input))      arr = input;
  else if (typeof input === 'string') arr = input.split(/[\n,]/);

  const seen = {};
  const out  = [];
  arr.forEach(function (v) {
    const n = String(v || '').replace(/[^0-9]/g, '');
    if (!n || seen[n]) return;   // 빈 값·중복 제거
    seen[n] = true;
    out.push(n);
  });
  return out;
}

/** 받는 사람 번호(휴대폰/일반전화) 형식인지 확인합니다. 0으로 시작해야 합니다. */
function isValidPhone_(n) {
  return /^0\d{8,10}$/.test(n);
}

/**
 * 발신번호 형식인지 확인합니다.
 * 대표번호(1588·1600·1899 등)는 0으로 시작하지 않으므로 따로 봅니다.
 */
function isValidSender_(n) {
  return /^0\d{8,10}$/.test(n) ||   // 02-…, 010-… 등
         /^1\d{7}$/.test(n);        // 1588-1234 같은 8자리 대표번호
}

/** 한글은 2byte, 영문·숫자는 1byte로 계산합니다. (문자 요금 기준) */
function byteLen_(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    n += s.charCodeAt(i) > 127 ? 2 : 1;
  }
  return n;
}

/**
 * 이모지가 포함되어 있는지 확인합니다. (비즈엠 문자 발송 제약)
 * - 😊 🎉 처럼 두 글자로 저장되는 이모지(서로게이트 쌍)
 * - ☀ ✅ ❗ ⭐ 처럼 한 글자짜리 기호 이모지
 */
function hasEmoji_(s) {
  return /[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(s) ||
         /[‼⁉™↔-↪⌚⌛⌨⏏⏩-⏺Ⓜ▪-◾☀-➿⤴⤵⬀-⯿〰〽㊗㊙️]/.test(s);
}

/**
 * 메시지 일련번호를 만듭니다.
 * 발신프로필별로 40일 안에 같은 값을 다시 쓸 수 없어, 시각+순번+난수로 겹치지 않게 합니다.
 * (영문·숫자·언더바·하이픈만 허용, 최대 20자)
 */
function makeMsgId_(stamp, index) {
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  const seq  = String(index).padStart(2, '0').slice(-2);
  return ('CA' + stamp + seq + rand).slice(0, 20);   // 예: CA20260713154233_00_482
}

/**
 * 발송 이력을 스프레드시트에 남깁니다.
 * 스크립트 속성에 BIZM_LOG_SHEET_ID(스프레드시트 ID)가 있으면 기록하고, 없으면 조용히 넘어갑니다.
 */
function logSend_(results, isAlim, isLms, message) {
  try {
    const id = PropertiesService.getScriptProperties().getProperty('BIZM_LOG_SHEET_ID');
    if (!id) return;

    const ss    = SpreadsheetApp.openById(id);
    let   sheet = ss.getSheetByName('문자발송이력');
    if (!sheet) {
      sheet = ss.insertSheet('문자발송이력');
      sheet.appendRow(['발송일시', '유형', '받는번호', '결과', '상세', '내용']);
      sheet.setFrozenRows(1);
    }

    const now  = new Date();
    const type = isAlim ? '알림톡' : (isLms ? 'LMS' : 'SMS');
    const rows = results.map(function (r) {
      return [now, type, r.number, r.ok ? '성공' : '실패', r.text, message];
    });
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 6).setValues(rows);
  } catch (err) {
    // 이력 기록에 실패해도 발송 자체는 성공했으므로 막지 않습니다.
    console.error('발송 이력 기록 실패: ' + err);
  }
}

/* ===================== 테스트 (Apps Script 편집기에서 직접 실행) ===================== */

/**
 * [1단계] 설정 확인 — 문자를 보내지 않고, 스크립트 속성 3개가 제대로 들어갔는지만 봅니다.
 *
 * 실행 방법: 편집기 위쪽 함수 목록에서 checkBizmConfig 선택 → [실행]
 *           → 아래 "실행 로그"에 결과가 나옵니다.
 * 보안을 위해 값 전체가 아니라 앞뒤 일부만 보여줍니다.
 */
function checkBizmConfig() {
  let cfg;
  try {
    cfg = getBizmConfig_();
  } catch (err) {
    console.log('❌ ' + err.message);
    return;
  }

  console.log('✅ 설정 3개가 모두 들어와 있습니다.');
  console.log('  BIZM_USERID      : ' + mask_(cfg.userid));
  console.log('  BIZM_PROFILE_KEY : ' + mask_(cfg.profileKey) + '  (길이 ' + cfg.profileKey.length + '자)');
  console.log('  BIZM_SENDER_NUM  : ' + cfg.senderNum);

  if (cfg.profileKey.length !== 40) {
    console.log('⚠️ 발신프로필 키는 보통 40자입니다. 지금 ' + cfg.profileKey.length +
                '자인데, 혹시 카카오 채널 아이디(@케어아카데미)를 넣으신 건 아닌지 확인해 주세요.');
  }
  if (cfg.profileKey.indexOf('@') >= 0) {
    console.log('⚠️ 발신프로필 키에 @ 가 들어 있습니다. 채널 아이디가 아니라 "프로필키"를 넣어야 합니다.');
  }
  if (!isValidSender_(cfg.senderNum)) {
    console.log('⚠️ 발신번호 형식이 이상합니다. 지금 값의 자릿수: ' + cfg.senderNum.length + '자리. ' +
                '숫자만(예: 15881234 또는 0212345678) 넣어 주세요. ' +
                '혹시 발신프로필 키를 여기 넣으신 건 아닌지 확인해 주세요.');
  }
}

/**
 * [2단계] 실제 발송 테스트 — 아래 MY_NUMBER 로 문자 1건을 진짜 보냅니다. (요금 발생)
 *
 * 실행 방법: ① 아래 MY_NUMBER 를 은주 휴대폰 번호로 바꾸고 저장(💾)
 *           ② 함수 목록에서 testBizmSms 선택 → [실행]
 *           ③ "실행 로그"에 성공/실패 이유가 한국어로 나옵니다.
 *
 * ※ 문자(SMS)만 테스트합니다. 알림톡은 승인된 템플릿이 필요해서 화면에서 테스트하세요.
 */
function testBizmSms() {
  const MY_NUMBER = '01000000000';   // ← 여기에 은주 휴대폰 번호 (숫자만)

  const res = sendBizm_({
    channel: 'sms',
    numbers: [MY_NUMBER],
    message: '[케어아카데미] 문자 발송 테스트입니다. 이 문자가 도착하면 설정이 정상입니다.'
  });

  console.log(res.ok ? '✅ 발송 요청 성공' : '❌ 발송 실패');
  console.log('  유형: ' + (res.kind || '-') + ' / 성공 ' + (res.sent || 0) + '건, 실패 ' + (res.failed || 0) + '건');
  if (res.error) console.log('  사유: ' + res.error);
  (res.results || []).forEach(function (r) {
    console.log('  · ' + r.number + ' → ' + r.text);
  });
}

/** 로그에 값을 그대로 찍지 않도록 가운데를 가립니다. (abcdefghij → abc****hij) */
function mask_(s) {
  const v = String(s || '');
  if (v.length <= 6) return v.charAt(0) + '****';
  return v.slice(0, 3) + '****' + v.slice(-3);
}
