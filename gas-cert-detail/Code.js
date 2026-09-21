// 자격증 상세 시트 입력 웹앱
// /cert-detail 스킬이 신규 과정 정보를 보내면 시트에 한 줄로 적는다.
// - 같은 과정명이 이미 있으면 새 줄을 만들지 않고 그 줄을 고친다 (빈 값은 덮어쓰지 않음)
// - 열쇠(token)가 맞아야만 쓴다. 열쇠는 스크립트 속성 TOKEN에 있고, 처음 한 번 init으로 등록한다

const SHEET_GID = 0;

// 발송 도구 템플릿 시트 (gas/EmailSender.gs가 읽는 곳). 과정을 추가하면 교재 발송 문자 템플릿도 여기 만든다
const TEMPLATE_SHEET_ID = '1CE4RQ2MKPsyA4hGHBT-p8TPCDK8D5VqfmVbc5mFOgFs';
const TPL_HEADER = ['key', '구분', '템플릿명', '제목', '본문', '수정일시'];

// 스킬이 보내는 이름 → 시트 1행 칸 이름
const FIELDS = {
  name: '과정명',
  org: '발급 기관',
  lectures: '강의 수',
  hours: '강의 시간',
  detailUrl: '상세페이지',
  pdfUrl: '교안링크',
};

// 편집기에서 한 번 실행해 권한을 허용하는 용도
function authorize() {
  Logger.log(getSheet_().getName() + ' 시트 접근 확인');
  Logger.log(SpreadsheetApp.openById(TEMPLATE_SHEET_ID).getName() + ' (템플릿 시트) 접근 확인');
}

function doPost(e) {
  let body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: '요청 형식이 JSON이 아님' });
  }

  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty('TOKEN');

  if (body.action === 'init') {
    if (saved) return json_({ ok: false, error: '열쇠가 이미 등록돼 있음' });
    if (!body.token || String(body.token).length < 20) return json_({ ok: false, error: '열쇠가 너무 짧음' });
    props.setProperty('TOKEN', String(body.token));
    return json_({ ok: true, action: 'init' });
  }

  if (!saved || body.token !== saved) return json_({ ok: false, error: '열쇠가 맞지 않음' });

  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const result = upsert_(body.row || {});
    // 템플릿은 덤이다 — 실패해도 과정 줄 결과는 그대로 돌려준다
    if (result.ok) {
      try {
        result.template = addBookTemplate_(result.values);
      } catch (err) {
        result.template = { ok: false, error: String(err) };
      }
    }
    return json_(result);
  } finally {
    lock.releaseLock();
  }
}

function upsert_(row) {
  const name = String(row.name || '').trim();
  if (!name) return { ok: false, error: '과정명(name)이 비어 있음' };

  const sheet = getSheet_();
  const lastCol = sheet.getLastColumn();
  const header = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(h => String(h).trim());

  const colOf = {};
  for (const key in FIELDS) {
    const idx = header.indexOf(FIELDS[key]);
    if (idx === -1) return { ok: false, error: '시트에 "' + FIELDS[key] + '" 칸이 없음' };
    colOf[key] = idx;
  }

  const lastRow = sheet.getLastRow();
  const names = lastRow > 1
    ? sheet.getRange(2, colOf.name + 1, lastRow - 1, 1).getValues().map(r => String(r[0]).trim())
    : [];
  const found = names.indexOf(name);

  let rowNum, values, action;
  if (found === -1) {
    rowNum = lastRow + 1;
    values = new Array(lastCol).fill('');
    action = 'added';
  } else {
    rowNum = found + 2;
    values = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
    action = 'updated';
  }

  for (const key in FIELDS) {
    const v = row[key];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    values[colOf[key]] = String(v).trim();
  }

  const range = sheet.getRange(rowNum, 1, 1, lastCol);
  range.setNumberFormat('@'); // '18강'·URL이 숫자·날짜로 바뀌지 않게 글자로 저장
  range.setValues([values]);

  // 실제로 들어간 값을 다시 읽어 돌려준다 (스킬이 확인용으로 씀)
  const written = sheet.getRange(rowNum, 1, 1, lastCol).getValues()[0];
  const result = {};
  for (const key in FIELDS) result[FIELDS[key]] = written[colOf[key]];
  return { ok: true, action: action, row: rowNum, values: result };
}

// 교재 발송 문자 템플릿을 한 줄 만든다
// - 같은 key가 이미 있으면 건드리지 않는다 (발송 도구에서 고친 문구를 덮어쓰지 않게)
// - 교안링크가 아직 없으면 만들지 않는다 (나중에 링크만 보낼 때 만들어짐)
function addBookTemplate_(values) {
  const name = String(values[FIELDS.name] || '').trim();
  const pdfUrl = String(values[FIELDS.pdfUrl] || '').trim();
  const key = 'book_' + name.replace(/\s+/g, '');
  if (!pdfUrl) return { ok: true, action: 'skipped', reason: '교안링크 없음', key: key };

  const sh = SpreadsheetApp.openById(TEMPLATE_SHEET_ID).getSheets()[0];
  const header = sh.getRange(1, 1, 1, TPL_HEADER.length).getValues()[0].map(h => String(h).trim());
  if (header.join('|') !== TPL_HEADER.join('|')) {
    return { ok: false, error: '템플릿 시트 첫 줄이 ' + TPL_HEADER.join(' / ') + ' 가 아님' };
  }

  const last = sh.getLastRow();
  const keys = last > 1 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  if (keys.indexOf(key) > -1) return { ok: true, action: 'exists', key: key, row: keys.indexOf(key) + 2 };

  const body =
    '요청해주신 "' + name + '" 교재 발송드립니다. 수강에 많은 도움 되시길 바랍니다 :)\n\n' +
    '교재 링크:\n' + pdfUrl;
  const row = [key, '문자', '교재 발송 (' + name + ')', '[케어아카데미] 교재 발송 안내', body, new Date()];
  sh.appendRow(row);
  return { ok: true, action: 'added', key: key, row: sh.getLastRow(), name: row[2], body: body };
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActive().getSheets().find(s => s.getSheetId() === SHEET_GID);
  if (!sheet) throw new Error('gid=' + SHEET_GID + ' 시트를 찾을 수 없음');
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
