// 은주에게 요청한 것들 — 시트3 입력 웹앱
// /요청기록 스킬이 #보살핌_고객센터에서 은주를 태그한 요청을 정리해 보내면 시트3 맨 아래에 줄을 추가한다.
// - 같은 슬랙 링크(E열)가 이미 있으면 그 줄은 건너뛴다 (같은 날을 두 번 보내도 중복 안 됨)
// - 유형은 H1 드롭다운 목록에 있는 것만 받는다. 목록은 매번 시트에서 읽으니 드롭다운만 고치면 된다
// - 열쇠(token)가 맞아야만 쓴다. 열쇠는 스크립트 속성 TOKEN에 있고, 처음 한 번 init으로 등록한다

const SHEET_GID = 1298766334;
const HEADER = ['날짜', '요청자', '유형', '내용', '링크'];
const TYPE_CELL = 'H1';

// 편집기에서 한 번 실행해 권한을 허용하는 용도
function authorize() {
  Logger.log(getSheet_().getName() + ' 시트 접근 확인 · 유형 ' + getTypes_().length + '개');
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

  try {
    if (body.action === 'types') return json_({ ok: true, types: getTypes_() });
    if (body.action === 'append') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        return json_(append_(body.rows || []));
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ ok: false, error: '모르는 action: ' + body.action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// rows: [{date:'2026-10-05', requester, type, content, link}]
function append_(rows) {
  if (!rows.length) return { ok: false, error: 'rows가 비어 있음' };

  const sheet = getSheet_();
  checkHeader_(sheet);

  // 하나라도 틀리면 아무것도 쓰지 않는다
  const types = getTypes_();
  const bad = [];
  rows.forEach((r, i) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.date || ''))) bad.push((i + 1) + '번째 줄 날짜 형식(YYYY-MM-DD) 아님: ' + r.date);
    if (types.indexOf(String(r.type || '').trim()) === -1) bad.push((i + 1) + '번째 줄 유형이 드롭다운에 없음: ' + r.type);
    if (!String(r.link || '').trim()) bad.push((i + 1) + '번째 줄 링크가 비어 있음');
  });
  if (bad.length) return { ok: false, error: '입력 확인 필요', details: bad, types: types };

  // A열 기준 마지막 줄 (H열 드롭다운 등 다른 칸 때문에 getLastRow가 밀리지 않게)
  const lastRow = lastFilledRow_(sheet, 1);
  const existing = lastRow > 1
    ? sheet.getRange(2, 5, lastRow - 1, 1).getValues().map(r => String(r[0]).trim())
    : [];

  const toWrite = [];
  const skipped = [];
  rows.forEach(r => {
    const link = String(r.link).trim();
    if (existing.indexOf(link) > -1 || toWrite.some(w => w[4] === link)) {
      skipped.push(link);
      return;
    }
    const [y, m, d] = r.date.split('-').map(Number);
    toWrite.push([new Date(y, m - 1, d), String(r.requester || '').trim(), String(r.type).trim(),
      String(r.content || '').trim(), link]);
  });

  if (!toWrite.length) return { ok: true, added: 0, skipped: skipped.length, rows: [] };

  const start = lastRow + 1;
  sheet.getRange(start, 2, toWrite.length, 4).setNumberFormat('@'); // 요청자·유형·내용·링크는 글자 그대로
  sheet.getRange(start, 1, toWrite.length, 5).setValues(toWrite);

  // 실제로 들어간 값을 다시 읽어 돌려준다 (스킬이 확인용으로 씀)
  const written = sheet.getRange(start, 1, toWrite.length, 5).getDisplayValues();
  return { ok: true, added: toWrite.length, skipped: skipped.length, firstRow: start, rows: written };
}

function getTypes_() {
  const rule = getSheet_().getRange(TYPE_CELL).getDataValidation();
  if (!rule) throw new Error(TYPE_CELL + '에 드롭다운이 없음');
  const type = rule.getCriteriaType();
  const args = rule.getCriteriaValues();
  let list;
  if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
    list = args[0];
  } else if (type === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
    list = args[0].getValues().flat();
  } else {
    throw new Error(TYPE_CELL + ' 드롭다운이 목록·범위 방식이 아님: ' + type);
  }
  return list.map(v => String(v).trim()).filter(Boolean);
}

function checkHeader_(sheet) {
  const header = sheet.getRange(1, 1, 1, HEADER.length).getValues()[0].map(h => String(h).trim());
  // E1(링크)이 비어 있으면 채운다 — 나머지 칸은 다르면 멈춘다
  if (header[4] === '') {
    sheet.getRange(1, 5).setValue(HEADER[4]);
    header[4] = HEADER[4];
  }
  if (header.join('|') !== HEADER.join('|')) {
    throw new Error('시트 첫 줄이 ' + HEADER.join(' / ') + ' 가 아님: ' + header.join(' / '));
  }
}

function lastFilledRow_(sheet, col) {
  const max = sheet.getMaxRows();
  const vals = sheet.getRange(1, col, max, 1).getValues();
  for (let i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() !== '') return i + 1;
  }
  return 0;
}

function getSheet_() {
  const sheet = SpreadsheetApp.getActive().getSheets().find(s => s.getSheetId() === SHEET_GID);
  if (!sheet) throw new Error('gid=' + SHEET_GID + ' 시트를 찾을 수 없음');
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
