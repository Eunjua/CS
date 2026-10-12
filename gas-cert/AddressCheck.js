// ============================================================
//  주소 확인 (메뉴 📊 업데이트 → 🏠 주소 확인)
//  - 지금 열린 시트의 '제작리스트' 탭에서 배송일자·주소 확인이 빈 행만 판정한다
//  - 판정 규칙은 AddressJudge.js
//  - 문제 있는 행의 '주소 확인' 칸에 불일치·동호수·확인필요를 넣고, 유효성검사 칸에 F + 노란색
//    (확인필요 = 카카오로 판단이 안 돼 사람이 봐야 하는 행. 은주 결정, 2026-10-12)
//  - 넣기 직전에 그 행이 그대로인지(주소 같고, 배송일자·주소 확인 비어 있음) 다시 본다(여럿이 편집)
//  - 행이 많아 시간이 모자라면(앱스크립트 6분 제한) 조회한 만큼 저장해 두고 "한 번 더 눌러 주세요"로 끝낸다
// ============================================================

var ADDR_TAB = '제작리스트';
var ADDR_COLS = { date: '배송일자', addr: '주소', check: '주소 확인', valid: '유효성검사' };
var ADDR_FLAG = 'F';
var ADDR_YELLOW = '#ffff00';
var ADDR_VALUES = ['불일치', '동호수', '확인필요'];
var ADDR_TIME_BUDGET_MS = 4.5 * 60 * 1000;   // 판정·조회에 쓰는 시간. 나머지는 시트 입력용
var ADDR_BATCH = 30;                         // 카카오 동시 조회 수
var ADDR_CACHE_SEC = 6 * 60 * 60;            // 조회 결과 보관(앱스크립트 최대 6시간)
var ADDR_MISSING = {};

// 두 번 눌러 동시에 돌지 않게 문서 단위로 잠근다 (2026-10-12: 두 번 돌아 결과 창이 두 번 뜸)
function checkAddresses() {
  var ui = SpreadsheetApp.getUi();
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(1000)) {
    ui.alert('주소 확인', '이미 주소 확인이 돌고 있어요. 끝나면 결과 창이 떠요.', ui.ButtonSet.OK);
    return;
  }
  try {
    addrRun_(ui);
  } finally {
    lock.releaseLock();
  }
}

function addrRun_(ui) {
  var ss = SpreadsheetApp.getActive();
  var started = Date.now();
  var t = addrOpen_(ss);
  var rows = addrTodo_(t);
  if (!rows.length) {
    ui.alert('주소 확인', '확인할 행이 없어요.\n(배송일자와 주소 확인이 모두 빈 행만 봐요)', ui.ButtonSet.OK);
    return;
  }
  ss.toast(rows.length + '행 확인 중이에요. 끝나면 결과 창이 떠요(행이 많으면 몇 분). 그동안 다시 누르지 마세요.', '🏠 주소 확인', 60);

  var judged = addrJudgeAll_(rows, started);
  if (judged.partial) {
    ui.alert('주소 확인 — 한 번 더 눌러 주세요',
      '확인할 행이 많아 시간이 모자랐어요 (' + rows.length + '행).\n' +
      '지금까지 조회한 건 저장해 뒀으니 메뉴를 한 번 더 눌러 주세요.\n시트에는 아직 아무것도 넣지 않았어요.', ui.ButtonSet.OK);
    return;
  }
  var results = judged.results;

  // 카카오가 막혔거나 화면이 바뀌면 쉼표 앞 주소부터 조회가 안 된다 → 아무것도 넣지 않고 멈춘다
  var baseFail = results.filter(function(r) {
    return r.note.indexOf('쉼표앞 주소 조회실패') >= 0 || /^카카오 조회 실패/.test(r.note);
  }).length;
  if (rows.length >= 10 && baseFail / rows.length > 0.2) {
    ui.alert('주소 확인 — 멈춤',
      '카카오맵 조회가 ' + baseFail + '/' + rows.length + '행 실패해서 시트에 아무것도 넣지 않았어요.\n' +
      '잠시 뒤 다시 눌러 보고, 계속되면 은주에게 알려 주세요.', ui.ButtonSet.OK);
    return;
  }

  var cells = results.filter(function(r) { return ADDR_VALUES.indexOf(r.res) >= 0; });
  var w = addrWrite_(ss, cells);

  var rowsOf = function(v) {
    return cells.filter(function(c) { return c.res === v && w.written.indexOf(c.row) >= 0; })
                .map(function(c) { return c.row; });
  };
  var bad = rowsOf('불일치'), unit = rowsOf('동호수'), review = rowsOf('확인필요');
  var drop = results.filter(function(r) { return r.note.indexOf('받을 곳') >= 0; }).map(function(r) { return r.row; });
  var msg = rows.length + '행 확인 · ' + Math.round((Date.now() - started) / 1000) + '초\n\n';
  if (!cells.length) msg += '문제 있는 행이 없어요. 시트에 넣은 칸 없음.\n';
  if (bad.length) msg += '불일치 ' + bad.length + '행: ' + bad.join(', ') + '\n';
  if (unit.length) msg += '동호수 ' + unit.length + '행: ' + unit.join(', ') + '\n';
  if (review.length) msg += '확인필요 ' + review.length + '행: ' + review.join(', ') + '\n  → 카카오로 판단이 안 된 주소예요. 직접 보고 다르면 불일치로 바꿔 주세요.\n';
  if (w.written.length) msg += '\n넣은 행은 유효성검사 칸에 F를 넣고 노랗게 칠했어요.\n';
  if (drop.length) msg += '\n아파트인데 동·호 대신 받을 곳(관리사무소 등)을 적은 행 ' + drop.length + '개: ' + drop.join(', ') + ' (안 넣음)\n';
  if (w.skipped.length) msg += '\n그사이 다른 사람이 고친 행이라 건너뜀: ' + w.skipped.join(', ') + '\n';
  w.flagKept.forEach(function(k) { msg += k[0] + '행 유효성검사에 이미 "' + k[1] + '"이 있어 그대로 둠\n'; });
  ui.alert('주소 확인 완료!', msg, ui.ButtonSet.OK);
}

// ---------- 판정 (카카오 조회를 묶어서) ----------
// judgeRow는 조회 결과를 바로 달라고 한다. 없는 조회는 모아 두었다가 한꺼번에 조회하고 다시 판정한다.
function addrJudgeAll_(rows, started) {
  var memo = {}, fails = {};
  for (var pass = 0; pass < 12; pass++) {
    var missing = {};
    var results = [];
    rows.forEach(function(r) {
      try {
        results.push(judgeRow(r[0], r[1], function(q) {
          if (memo.hasOwnProperty(q)) return memo[q];
          missing[q] = true;
          throw ADDR_MISSING;
        }));
      } catch (err) {
        if (err !== ADDR_MISSING) throw err;
      }
    });
    var qs = Object.keys(missing);
    if (!qs.length) return { results: results };
    if (!addrFetchMany_(qs, memo, fails, started)) return { partial: true };
  }
  throw new Error('주소 판정이 끝나지 않음(조회 반복 초과)');
}

// 조회 결과 보관함(6시간) → 없으면 카카오. 시간이 다 되면 false
function addrFetchMany_(qs, memo, fails, started) {
  var cache = CacheService.getScriptCache();
  var keyOf = function(q) {
    return 'k' + Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, q, Utilities.Charset.UTF_8));
  };
  var todo = [];
  for (var i = 0; i < qs.length; i += 100) {
    var part = qs.slice(i, i + 100);
    var got = cache.getAll(part.map(keyOf));
    part.forEach(function(q) {
      var v = got[keyOf(q)];
      if (v) memo[q] = JSON.parse(v);
      else todo.push(q);
    });
  }
  var failed = false;
  for (var j = 0; j < todo.length; j += ADDR_BATCH) {
    if (Date.now() - started > ADDR_TIME_BUDGET_MS) return false;
    var batch = todo.slice(j, j + ADDR_BATCH);
    var reqs = batch.map(function(q) {
      return { url: KAKAO_URL + encodeURIComponent(q), headers: { 'User-Agent': 'Mozilla/5.0' }, muteHttpExceptions: true };
    });
    var res;
    try {
      res = UrlFetchApp.fetchAll(reqs);
    } catch (err) {
      res = reqs.map(function(rq) { try { return UrlFetchApp.fetch(rq.url, rq); } catch (e2) { return null; } });
    }
    var put = {};
    batch.forEach(function(q, k) {
      var r = res[k];
      if (r && r.getResponseCode() === 200) {
        memo[q] = parseKakao_(r.getContentText('UTF-8'));
        var s = JSON.stringify(memo[q]);
        if (s.length < 90000) put[keyOf(q)] = s;
      } else {
        // 판정 스크립트처럼 세 번까지 다시 해 보고, 그래도 안 되면 조회 실패로 둔다
        fails[q] = (fails[q] || 0) + 1;
        if (fails[q] >= 3) memo[q] = null;
        failed = true;
      }
    });
    if (Object.keys(put).length) cache.putAll(put, ADDR_CACHE_SEC);
  }
  if (failed) Utilities.sleep(2000);
  return true;
}

// ---------- 시트 ----------
function addrOpen_(ss) {
  var sheet = ss.getSheetByName(ADDR_TAB) ||
              ss.getSheets().filter(function(s) { return s.getSheetId() === 0; })[0];
  if (!sheet) throw new Error('"' + ADDR_TAB + '" 탭을 찾을 수 없어요');
  var values = sheet.getDataRange().getDisplayValues();
  var head = values[0].map(function(h) { return String(h).trim(); });
  var col = {};
  Object.keys(ADDR_COLS).forEach(function(k) {
    col[k] = head.indexOf(ADDR_COLS[k]);
    if (col[k] < 0) throw new Error('머리글 "' + ADDR_COLS[k] + '" 열이 없어요');
  });
  return { sheet: sheet, values: values, col: col };
}

// 배송일자·주소 확인이 비어 있고 주소가 있는 행 → [[행번호, 주소], ...]
function addrTodo_(t) {
  var out = [];
  t.values.forEach(function(r, i) {
    if (i > 0 && !r[t.col.date] && r[t.col.addr] && !r[t.col.check]) out.push([i + 1, r[t.col.addr]]);
  });
  return out;
}

// 그사이 행이 바뀌었거나 값이 생긴 칸은 건너뛴다. 넣은 행은 유효성검사 F + 노란색
function addrWrite_(ss, cells) {
  var t = addrOpen_(ss);
  var written = [], skipped = [], kept = [];
  cells.forEach(function(c) {
    var row = t.values[c.row - 1];
    if (!row || row[t.col.addr] !== c.a || row[t.col.date] || row[t.col.check]) { skipped.push(c.row); return; }
    t.sheet.getRange(c.row, t.col.check + 1).setValue(c.res);
    written.push(c.row);
    // 유효성검사: 비어 있으면 F, 이미 F면 그대로, 다른 값이면 건드리지 않고 알린다. 칠하기는 F인 칸만
    var cell = t.sheet.getRange(c.row, t.col.valid + 1);
    var cur = String(row[t.col.valid] || '').trim();
    if (cur && cur !== ADDR_FLAG) { kept.push([c.row, cur]); return; }
    if (!cur) cell.setValue(ADDR_FLAG);
    cell.setBackground(ADDR_YELLOW);
  });
  SpreadsheetApp.flush();
  return { written: written, skipped: skipped, flagKept: kept };
}
