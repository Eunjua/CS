// ============================================================
//  만족도 불러오기
// ============================================================
//  기존 구글폼 응답 시트(7.5MB)에서 필요한 7개 컬럼만 읽어
//  '만족도원본'에 누적한다.
//   · 원본은 읽기만 — 폼 연결도 기존 시트도 건드리지 않는다
//   · 시트 전체를 통째로 읽지 않는다 (기존 대시보드가 느려진 원인)
//   · 상담ID 기준 중복 제거, 점수는 숫자로 변환해 저장
// ============================================================

function importCsat() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTimeZone_(ss);

  const csatSh = ensureSheet_(ss, SHEET_CSAT, CSAT_HEADERS);

  let src;
  try {
    src = SpreadsheetApp.openById(CSAT_SOURCE_ID);
  } catch (e) {
    ui.alert('❌ 만족도 원본 시트를 열 수 없어요.\n\nID를 확인해주세요:\n' + CSAT_SOURCE_ID);
    return;
  }

  const sh = CSAT_SOURCE_SHEET ? src.getSheetByName(CSAT_SOURCE_SHEET) : src.getSheets()[0];
  if (!sh) {
    // 시트명이 바뀌었을 때 뭘 골라야 할지 바로 알 수 있게 목록을 보여준다
    const names = src.getSheets().map(function(s) { return '· ' + s.getName(); }).join('\n');
    ui.alert('❌ "' + CSAT_SOURCE_SHEET + '" 시트를 찾지 못했어요.\n\n원본에 있는 시트:\n' + names);
    return;
  }

  // 이미 받아둔 게 있으면, 새로 추가만 할지 전부 다시 받을지 고른다
  //  (원본 시트를 잘못 지정했던 경우 전체를 다시 받아야 한다)
  const already = csatSh.getLastRow() - 1;
  let resetFirst = false;
  if (already > 0) {
    const ans = ui.alert(
      '⭐ 만족도 불러오기',
      '"' + SHEET_CSAT + '"에 이미 ' + already + '건이 있어요.\n\n' +
      '[예] 전부 지우고 다시 받기 (원본을 잘못 지정했던 경우)\n' +
      '[아니오] 새로 들어온 응답만 추가하기',
      ui.ButtonSet.YES_NO_CANCEL
    );
    if (ans === ui.Button.CANCEL) return;
    resetFirst = (ans === ui.Button.YES);
  }
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2) { ui.alert('만족도 응답이 아직 없어요.'); return; }

  // 헤더만 먼저 읽어 필요한 컬럼 위치를 찾는다
  const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(function(h) { return String(h).trim(); });
  const col = {
    id        : findHeader_(header, [FORM_HEADERS.id, '상담ID', '제목 없는 질문']),
    timestamp : findHeader_(header, [FORM_HEADERS.timestamp]),
    csat      : findHeader_(header, [FORM_HEADERS.csat]),
    kindness  : findHeader_(header, [FORM_HEADERS.kindness]),
    resolved  : findHeader_(header, [FORM_HEADERS.resolved]),
    waiting   : findHeader_(header, [FORM_HEADERS.waiting]),
    comment   : findHeader_(header, [FORM_HEADERS.comment]),
  };

  if (col.id < 0) {
    ui.alert('❌ 만족도 원본에서 상담ID 컬럼을 찾지 못했어요.\n\n원본 첫 줄:\n' +
             header.slice(0, 10).join(' | '));
    return;
  }

  // 지우는 건 여기서 — 원본을 제대로 읽을 수 있다고 확인된 뒤에야 기존 데이터를 비운다
  if (resetFirst && csatSh.getLastRow() > 1) {
    csatSh.getRange(2, 1, csatSh.getLastRow() - 1, csatSh.getLastColumn()).clearContent();
  }

  // 필요한 컬럼만 개별로 읽는다 (전체를 읽으면 7.5MB를 다 가져오게 된다)
  const n = lastRow - 1;
  const grab = function(c) {
    if (c < 0) return new Array(n).fill('');
    return sh.getRange(2, c + 1, n, 1).getValues().map(function(r) { return r[0]; });
  };
  const vId    = grab(col.id);
  const vTime  = grab(col.timestamp);
  const vCsat  = grab(col.csat);
  const vKind  = grab(col.kindness);
  const vRes   = grab(col.resolved);
  const vWait  = grab(col.waiting);
  const vCom   = grab(col.comment);

  const existing = readColumnSet_(csatSh, 1);
  const newRows  = [];
  let noId = 0;

  for (let i = 0; i < n; i++) {
    const id = String(vId[i] || '').trim();
    if (!id) { noId++; continue; }
    if (existing.has(id)) continue;

    newRows.push([
      id,
      vTime[i] || '',
      scoreOf_(vCsat[i], CSAT_SCORE),
      scoreOf_(vKind[i], KINDNESS_SCORE),
      String(vRes[i] || '').trim(),
      String(vWait[i] || '').trim(),
      String(vCom[i] || '').trim(),
    ]);
    existing.add(id);
  }

  if (newRows.length) {
    csatSh.getRange(csatSh.getLastRow() + 1, 1, newRows.length, CSAT_HEADERS.length)
          .setValues(newRows);
  }

  ui.alert(
    '⭐ 만족도 불러오기 완료\n\n' +
    '원본 응답: ' + n + '건\n' +
    '새로 저장: ' + newRows.length + '건\n' +
    '이미 있던 건: ' + (n - newRows.length - noId) + '건' +
    (noId ? '\n상담ID 없어 건너뜀: ' + noId + '건' : '') +
    '\n\n누적 총계: ' + existing.size + '건'
  );
}

// ── 보기 답변을 점수로. 이미 숫자면 그대로, 못 알아보면 빈칸
function scoreOf_(val, map) {
  if (val === '' || val === null || val === undefined) return '';
  const s = String(val).trim();
  if (map[s] !== undefined) return map[s];
  const num = Number(s);
  return (!isNaN(num) && num >= 1 && num <= 5) ? num : '';
}

function findHeader_(header, candidates) {
  for (let i = 0; i < candidates.length; i++) {
    const idx = header.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

// 시트의 특정 컬럼(1-based) 값을 Set으로
function readColumnSet_(sh, colIdx) {
  const set = new Set();
  const last = sh.getLastRow();
  if (last < 2) return set;
  sh.getRange(2, colIdx, last - 1, 1).getValues().forEach(function(r) {
    const v = String(r[0] || '').trim();
    if (v) set.add(v);
  });
  return set;
}
