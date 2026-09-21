// ═══════════════════════════════════════════════
//  과목 목록 API — cert/ 이수증 화면이 읽어감
//  「과목 관리 페이지」 시트의 A열(과정명)·D열(강의 시간)만 내보냄
//  다른 열(교안링크 등)은 절대 내보내지 않음 — 이 주소는 누구나 열 수 있음
// ═══════════════════════════════════════════════

const SHEET_ID  = '1jXPEfaol5hhIklzjTa8INudskEnVvKo9urHr7vO9MSg';
const SHEET_GID = 0;   // 시트1 (탭 이름이 바뀌어도 이 번호는 그대로)
const COL_NAME  = 1;   // A열 과정명
const COL_TIME  = 4;   // D열 강의 시간

function doGet() {
  let body;
  try {
    body = { ok: true, courses: readCourses_() };
  } catch (err) {
    body = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService
    .createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}

function readCourses_() {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  const sheet = ss.getSheets().find(s => s.getSheetId() === SHEET_GID);
  if (!sheet) throw new Error('과목 시트(gid=0)를 찾을 수 없음');

  const last = sheet.getLastRow();
  if (last < 2) return [];   // 1행은 제목

  // 화면에 보이는 그대로 읽음 (1:30 같은 시간 서식도 글자로)
  const rows = sheet.getRange(2, 1, last - 1, COL_TIME).getDisplayValues();
  return rows
    .map(r => ({ name: String(r[COL_NAME - 1]).trim(), time: String(r[COL_TIME - 1]).trim() }))
    .filter(c => c.name);
}

// 처음 한 번 에디터에서 실행해 권한을 승인하는 용도
function testRead() {
  Logger.log(JSON.stringify(readCourses_()));
}
