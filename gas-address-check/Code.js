// 자격증관리 시트 주소 확인 — 읽기·쓰기 웹앱
// /address-check 스킬이 부른다. 크롬 없이 시트를 읽고 "주소 확인" 칸에 값을 넣는다.
// - 달마다 새 시트라 시트 ID·gid를 요청마다 받는다 (특정 시트에 붙어 있지 않음)
// - 열은 머리글 이름(1행)으로 찾는다: 배송일자 · 주소 · 주소 확인
// - 넣을 수 있는 값은 '불일치'·'동호수' 두 가지뿐. 넣기 직전에 칸이 아직 비어 있는지 다시 본다(여럿이 편집)
// - 필터가 걸려 있어도 칸 주소로 바로 쓰므로 필터를 건드리지 않는다
// - 열쇠(token)가 맞아야만 실행한다. 열쇠는 스크립트 속성 TOKEN에 있고, 처음 한 번 init으로 등록한다

const COLS = { date: '배송일자', addr: '주소', check: '주소 확인' };
const ALLOWED = ['불일치', '동호수'];
// 이번 달 시트 후보: 이름이 [10월]·[11월]·[27년 1월]로 시작. 템플릿(![월]…)·사본은 걸러진다
const MONTH_TITLE = /^\[(\d{2}년\s*)?\d{1,2}월\]/;

// 편집기에서 한 번 실행해 권한을 허용하는 용도
function authorize() {
  Logger.log('시트 권한 확인: ' + SpreadsheetApp.getActive());
  Logger.log('드라이브 검색 확인: ' + DriveApp.searchFiles("title contains '자격증관리'").hasNext());
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
    if (body.action === 'find') return json_(find_());
    if (body.action === 'read') return json_(read_(body.sheetId, body.gid));
    if (body.action === 'labeled') return json_(labeled_(body.sheetId, body.gid));
    if (body.action === 'write') {
      const lock = LockService.getScriptLock();
      lock.waitLock(10000);
      try {
        return json_(write_(body.sheetId, body.gid, body.cells || []));
      } finally {
        lock.releaseLock();
      }
    }
    return json_({ ok: false, error: '모르는 action: ' + body.action });
  } catch (err) {
    return json_({ ok: false, error: '오류: ' + err.message });
  }
}

// 이번 달 시트 = [N월] 자격증관리 시트 중 만든 날이 가장 늦은 것. 후보 3개까지 돌려준다
function find_() {
  const it = DriveApp.searchFiles("title contains '자격증관리' and mimeType = '" + MimeType.GOOGLE_SHEETS + "' and trashed = false");
  const list = [];
  while (it.hasNext()) {
    const f = it.next();
    if (MONTH_TITLE.test(f.getName())) list.push(f);
  }
  list.sort(function(a, b) { return b.getDateCreated() - a.getDateCreated(); });
  return { ok: true, candidates: list.slice(0, 3).map(function(f) {
    return { id: f.getId(), name: f.getName(), url: f.getUrl(),
             created: Utilities.formatDate(f.getDateCreated(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm') };
  }) };
}

// 배송일자·주소 확인이 비어 있고 주소가 있는 행 → [[행번호, 주소], ...]
function read_(sheetId, gid) {
  const t = open_(sheetId, gid);
  const todo = [];
  t.values.forEach(function(r, i) {
    if (i === 0) return;
    if (!r[t.col.date] && r[t.col.addr] && !r[t.col.check]) todo.push([i + 1, r[t.col.addr]]);
  });
  return { ok: true, sheet: t.sheet.getName(), cols: colLetters_(t.col), rows: t.values.length - 1,
           todo: todo, counts: counts_(t.values, t.col.check) };
}

// 이미 '주소 확인' 값이 적힌 행 → [[행번호, 주소, 값], ...] (판정 규칙 점검용, 읽기만)
function labeled_(sheetId, gid) {
  const t = open_(sheetId, gid);
  const rows = [];
  t.values.forEach(function(r, i) {
    if (i > 0 && r[t.col.addr] && r[t.col.check]) rows.push([i + 1, r[t.col.addr], r[t.col.check]]);
  });
  return { ok: true, rows: rows };
}

// cells = [[행번호, '불일치'|'동호수'], ...]. 이미 값이 생긴 칸은 건너뛴다
function write_(sheetId, gid, cells) {
  const bad = cells.filter(function(c) { return ALLOWED.indexOf(c[1]) < 0 || !(c[0] > 1); });
  if (bad.length) return { ok: false, error: '넣을 수 없는 값·행: ' + JSON.stringify(bad.slice(0, 5)) };
  const t = open_(sheetId, gid);
  const before = counts_(t.values, t.col.check);
  const written = [], skipped = [];
  cells.forEach(function(c) {
    const row = t.values[c[0] - 1];
    if (!row || row[t.col.check]) { skipped.push(c[0]); return; }
    t.sheet.getRange(c[0], t.col.check + 1).setValue(c[1]);
    written.push(c[0]);
  });
  SpreadsheetApp.flush();
  const after = counts_(t.sheet.getDataRange().getDisplayValues(), t.col.check);
  return { ok: true, written: written, skipped: skipped, before: before, after: after };
}

function open_(sheetId, gid) {
  if (!sheetId) throw new Error('시트 ID가 없음');
  const ss = SpreadsheetApp.openById(sheetId);
  const sheet = ss.getSheets().find(function(s) { return s.getSheetId() === Number(gid || 0); });
  if (!sheet) throw new Error('gid=' + gid + ' 탭을 찾을 수 없음');
  const values = sheet.getDataRange().getDisplayValues();
  const head = values[0].map(function(h) { return String(h).trim(); });
  const col = {};
  Object.keys(COLS).forEach(function(k) {
    col[k] = head.indexOf(COLS[k]);
    if (col[k] < 0) throw new Error('머리글 "' + COLS[k] + '" 열이 없음');
  });
  return { sheet: sheet, values: values, col: col };
}

// 주소 확인 열 값별 개수 (빈칸 포함) — 입력 전후 비교용
function counts_(values, c) {
  const out = {};
  values.slice(1).forEach(function(r) {
    const v = r[c] || '(빈칸)';
    out[v] = (out[v] || 0) + 1;
  });
  return out;
}

function colLetters_(col) {
  const out = {};
  Object.keys(col).forEach(function(k) { out[COLS[k]] = String.fromCharCode(65 + col[k]); });
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
