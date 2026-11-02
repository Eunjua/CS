// ============================================================
//  원격 실행 (doPost) — /월요일 스킬이 부르는 입구
// ============================================================
//  시트 메뉴 버튼 3개(불러오기 → 만족도 → 집계)를 스킬이 대신 누른다.
//   · upload  : 로컬 채널톡 export(xlsx)를 입력 폴더에 올린다 (파일 1개씩)
//   · refresh : importChats → importCsat → buildAggregates 순서로 실행
//   · init    : 열쇠(token) 첫 등록 — 스크립트 속성 TOKEN
//   · comments: 그 주(상담 주차 기준) 설문 자유의견 + 점수·태그 — /voc가 읽는다.
//               의견에 개인정보가 섞일 수 있어 열쇠 없는 doGet에는 두지 않는다
//  열쇠가 맞아야만 실행한다. 대시보드가 읽는 doGet은 건드리지 않는다.
//  원격 실행 중에는 확인 창 대신 메시지를 모아 응답으로 돌려준다.
//  만족도 "전부 지우고 다시 받기?" 질문에는 항상 [아니오](새 응답만 추가)로 답한다.
// ============================================================

let REMOTE_LOG_ = null;

// 메뉴에서 누르면 진짜 확인 창, 원격이면 메시지 수집용 가짜 창
function ui_() {
  if (!REMOTE_LOG_) return SpreadsheetApp.getUi();
  const log = REMOTE_LOG_;
  return {
    Button: { YES: 'YES', NO: 'NO', CANCEL: 'CANCEL' },
    ButtonSet: { YES_NO_CANCEL: 'YES_NO_CANCEL' },
    alert: function(a, b) {
      log.push(arguments.length >= 3 ? a + '\n' + b : String(a));
      return 'NO';
    },
  };
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return remoteJson_({ ok: false, error: '요청 형식이 JSON이 아님' });
  }
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('TOKEN');
  if (body.action === 'init') {
    if (saved) return remoteJson_({ ok: false, error: '열쇠가 이미 등록돼 있음' });
    if (!body.token || String(body.token).length < 20) return remoteJson_({ ok: false, error: '열쇠가 너무 짧음' });
    props.setProperty('TOKEN', String(body.token));
    return remoteJson_({ ok: true, action: 'init' });
  }
  if (!saved || body.token !== saved) return remoteJson_({ ok: false, error: '열쇠가 맞지 않음' });
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (body.action === 'upload') return remoteJson_(uploadExport_(body.name, body.b64));
    if (body.action === 'refresh') return remoteJson_(refreshAll_());
    if (body.action === 'comments') return remoteJson_(weekComments_(body.week));
    return remoteJson_({ ok: false, error: '모르는 action: ' + body.action });
  } catch (err) {
    return remoteJson_({ ok: false, error: '오류: ' + err.message });
  } finally {
    REMOTE_LOG_ = null;
    lock.releaseLock();
  }
}

// 입력 폴더나 처리완료에 같은 이름이 있으면 올리지 않는다 (두 번 보내도 안전)
function uploadExport_(name, b64) {
  if (!/\.xlsx$/i.test(String(name || ''))) return { ok: false, error: 'xlsx 파일 이름이 아님: ' + name };
  if (!b64) return { ok: false, error: '파일 내용이 비어 있음' };
  const folder = DriveApp.getFolderById(INPUT_FOLDER_ID);
  const done = getOrCreateSubfolder_(folder, DONE_FOLDER_NAME);
  if (folder.getFilesByName(name).hasNext() || done.getFilesByName(name).hasNext()) {
    return { ok: true, name: name, skipped: true, note: '이미 올라간 파일' };
  }
  const blob = Utilities.newBlob(Utilities.base64Decode(b64), MimeType.MICROSOFT_EXCEL, name);
  const file = folder.createFile(blob);
  return { ok: true, name: name, skipped: false, bytes: file.getSize() };
}

// 메뉴 버튼 3개를 순서대로. 각 단계의 확인 창 문구를 그대로 돌려준다
function refreshAll_() {
  const steps = [
    { name: '상담 파일 불러오기', fn: importChats },
    { name: '만족도 불러오기', fn: importCsat },
    { name: '집계 생성', fn: buildAggregates },
  ];
  const out = [];
  for (let i = 0; i < steps.length; i++) {
    REMOTE_LOG_ = [];
    steps[i].fn();
    out.push({ step: steps[i].name, messages: REMOTE_LOG_ });
  }
  const weeks = sheetAsObjects_(SpreadsheetApp.getActiveSpreadsheet(), SHEET_AGG_WEEK);
  return { ok: true, steps: out, weeks: weeks.length };
}

// 만족도원본에서 자유의견이 있는 응답을 그 상담의 주차로 묶어 돌려준다.
// 주차는 집계_설문과 같은 기준(상담원본 주차)이라 "해결됐어요" 비율과 같은 응답 묶음이다.
// week를 안 주면 상담원본의 최신 주차.
function weekComments_(week) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const chatSh = ss.getSheetByName(SHEET_CHATS);
  const csatSh = ss.getSheetByName(SHEET_CSAT);
  if (!chatSh || chatSh.getLastRow() < 2) return { ok: false, error: '상담원본이 비어 있음' };
  if (!csatSh || csatSh.getLastRow() < 2) return { ok: false, error: '만족도원본이 비어 있음' };

  const chatVals = chatSh.getDataRange().getValues();
  const cHead = chatVals[0].map(function(h) { return String(h).trim(); });
  const ci = {
    id: chatCol_(cHead, '상담ID'), week: chatCol_(cHead, '주차'),
    tags: chatCol_(cHead, '태그'), medium: chatCol_(cHead, '채널유형'),
    url: chatCol_(cHead, '대화링크'),
  };
  const chatById = {};
  let latest = '';
  for (let i = 1; i < chatVals.length; i++) {
    const id = String(chatVals[i][ci.id] || '').trim();
    const w = String(chatVals[i][ci.week] || '').trim();
    if (!id || !w) continue;
    chatById[id] = { week: w, tags: String(chatVals[i][ci.tags] || '').trim(),
                     medium: String(chatVals[i][ci.medium] || '').trim(),
                     // 채널 이름만(carepartner / carepartner-academy) — 링크 전체는 닉네임이 섞일 수 있어 보내지 않는다
                     channel: (String(ci.url >= 0 ? chatVals[i][ci.url] || '' : '').match(/\/(carepartner[\w-]*)\/user-chats\//) || [])[1] || '' };
    if (w > latest) latest = w;   // 'MM/DD~MM/DD'라 같은 해 안에서는 글자 비교 = 날짜 비교
  }
  const target = String(week || latest).trim();

  const cv = csatSh.getDataRange().getValues();
  const h = cv[0].map(function(x) { return String(x).trim(); });
  const col = function(name) { return h.indexOf(name); };
  const k = { id: col('상담ID'), at: col('응답일시'), csat: col('만족도'), kind: col('친절도'),
              resolved: col('해결여부'), waiting: col('대기적절'), comment: col('자유의견') };
  if (k.id < 0 || k.comment < 0) return { ok: false, error: '만족도원본 헤더가 예상과 다름' };

  let responses = 0;
  const rows = [];
  for (let i = 1; i < cv.length; i++) {
    const chat = chatById[String(cv[i][k.id] || '').trim()];
    if (!chat || chat.week !== target) continue;
    responses++;
    const text = String(cv[i][k.comment] || '').trim();
    if (!text) continue;
    rows.push({
      chatId: String(cv[i][k.id]).trim(),
      at: cv[i][k.at] instanceof Date ? Utilities.formatDate(cv[i][k.at], 'Asia/Seoul', 'yyyy-MM-dd HH:mm') : String(cv[i][k.at] || ''),
      csat: cv[i][k.csat], kindness: cv[i][k.kind],
      resolved: String(cv[i][k.resolved] || '').trim(), waiting: String(cv[i][k.waiting] || '').trim(),
      tags: chat.tags, medium: chat.medium, channel: chat.channel, comment: text,
    });
  }
  return { ok: true, week: target, responses: responses, comments: rows.length, rows: rows };
}

function remoteJson_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
