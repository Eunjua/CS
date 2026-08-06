// ============================================================
//  웹앱 API (doGet)
// ============================================================
//  대시보드 v2가 읽는 데이터 창구.
//  원본(수만 행)이 아니라 집계 시트만 내보낸다 → 응답이 수 KB로 가볍다.
//
//  ?sheet=week  → 집계_주차
//  ?sheet=tag   → 집계_태그
//  ?sheet=agent  → 집계_상담원
//  ?sheet=survey → 집계_설문 (해결여부·대기적절)
//  (없으면 네 집계를 한 번에: { week, tag, agent, survey })
// ============================================================

function doGet(e) {
  const sheet = (e && e.parameter && e.parameter.sheet || '').toLowerCase();
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  let payload;
  if (sheet === 'week') {
    payload = { week: sheetAsObjects_(ss, SHEET_AGG_WEEK) };
  } else if (sheet === 'tag') {
    payload = { tag: sheetAsObjects_(ss, SHEET_AGG_TAG) };
  } else if (sheet === 'agent') {
    payload = { agent: sheetAsObjects_(ss, SHEET_AGG_AGENT) };
  } else if (sheet === 'survey') {
    payload = { survey: sheetAsObjects_(ss, SHEET_AGG_SURVEY) };
  } else {
    payload = {
      week:   sheetAsObjects_(ss, SHEET_AGG_WEEK),
      tag:    sheetAsObjects_(ss, SHEET_AGG_TAG),
      agent:  sheetAsObjects_(ss, SHEET_AGG_AGENT),
      survey: sheetAsObjects_(ss, SHEET_AGG_SURVEY),
    };
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

// 시트를 [{헤더:값, ...}, ...] 로. 없으면 빈 배열.
function sheetAsObjects_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const vals = sh.getDataRange().getValues();
  const head = vals[0].map(function(h) { return String(h).trim(); });
  return vals.slice(1).map(function(row) {
    const o = {};
    head.forEach(function(h, i) { o[h] = row[i]; });
    return o;
  });
}
