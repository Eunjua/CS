// ============================================================
//  상담 파일 불러오기
// ============================================================
//  Drive 폴더의 채널톡 export(xlsx)를 읽어 '상담원본'에 누적한다.
//   · 인입일 기준은 managedAt (채널톡 날짜 필터와 동일)
//   · 상담ID로 중복 제거 — 같은 파일을 두 번 올려도 안전
//   · 파일 행수와 저장 행수를 '검증' 시트에 남긴다
//   · 처리한 파일은 '처리완료' 폴더로 이동
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 VOC v2')
    .addItem('📥 상담 파일 불러오기', 'importChats')
    .addItem('⭐ 만족도 불러오기', 'importCsat')
    .addSeparator()
    .addItem('📊 집계 생성', 'buildAggregates')
    .addSeparator()
    .addItem('🔧 시트 초기화 (최초 1회)', 'setupSheets')
    .addItem('🧹 임시 파일 정리', 'cleanupTempFiles')
    .addToUi();
}

// ── 시트 틀 만들기 (없을 때만)
function setupSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTimeZone_(ss);
  ensureSheet_(ss, SHEET_CHATS,  CHAT_HEADERS);
  ensureSheet_(ss, SHEET_VERIFY, ['처리시각', '파일명', '파일 행수', '신규 저장', '중복 스킵', '누적 총계', '결과']);
  SpreadsheetApp.getUi().alert('✅ 시트 준비 완료\n\n· ' + SHEET_CHATS + '\n· ' + SHEET_VERIFY);
}

// 스프레드시트 자체의 시간대 — clasp가 만들면 뉴욕이라 날짜가 하루씩 밀린다
function ensureTimeZone_(ss) {
  if (ss.getSpreadsheetTimeZone() !== 'Asia/Seoul') {
    ss.setSpreadsheetTimeZone('Asia/Seoul');
  }
}

// xlsx를 읽으려고 만든 '[임시] ...' 사본이 남아 있으면 휴지통으로 보낸다.
// 원본은 처리완료 폴더에 그대로 있으므로 지워도 안전하다.
function cleanupTempFiles() {
  const ui = SpreadsheetApp.getUi();
  const found = findTempFiles_();

  if (!found.length) {
    ui.alert('🧹 정리할 임시 파일이 없어요.');
    return;
  }

  const names = found.slice(0, 10).map(function(f) { return '· ' + shortName_(f.getName()); }).join('\n');
  const resp = ui.alert(
    '🧹 임시 파일 정리',
    found.length + '개를 휴지통으로 보낼까요?\n\n' + names +
    (found.length > 10 ? '\n… 외 ' + (found.length - 10) + '개' : '') +
    '\n\n원본은 "' + DONE_FOLDER_NAME + '" 폴더에 그대로 있어요.',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp !== ui.Button.OK) return;

  let done = 0, fail = 0;
  found.forEach(function(f) {
    try { f.setTrashed(true); done++; } catch (e) { fail++; }
  });

  ui.alert('🧹 정리 완료\n\n휴지통으로 보냄: ' + done + '개' +
           (fail ? '\n실패: ' + fail + '개' : ''));
}

// '[임시] ...' 사본 찾기
function findTempFiles_() {
  const out = [];
  try {
    const it = DriveApp.searchFiles('title contains "' + TEMP_PREFIX + '" and trashed = false');
    while (it.hasNext()) {
      const f = it.next();
      if (f.getName().indexOf(TEMP_PREFIX) === 0) out.push(f);
    }
  } catch (e) {}
  return out;
}

// 확인창 없이 조용히 치운다 (불러오기 끝에 자동 호출)
function sweepTempFiles_() {
  const found = findTempFiles_();
  let done = 0;
  found.forEach(function(f) {
    try { f.setTrashed(true); done++; } catch (e) {}
  });
  return done;
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  // 헤더가 비었거나 어긋나면(인코딩 깨짐 등) 첫 줄만 다시 쓴다 — 데이터는 건드리지 않는다
  const cur = sh.getLastColumn() > 0
    ? sh.getRange(1, 1, 1, headers.length).getValues()[0].map(function(h) { return String(h).trim(); })
    : [];
  if (cur.join('') !== headers.join('')) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers])
      .setFontWeight('bold').setBackground('#e8f5e9');
    sh.setFrozenRows(1);
  }
  return sh;
}

// ── 메인: 폴더의 xlsx를 모두 읽어 누적
function importChats() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTimeZone_(ss);

  const chatSh = ensureSheet_(ss, SHEET_CHATS,  CHAT_HEADERS);
  const verSh  = ensureSheet_(ss, SHEET_VERIFY, ['처리시각', '파일명', '파일 행수', '신규 저장', '중복 스킵', '누적 총계', '결과']);

  let folder;
  try {
    folder = DriveApp.getFolderById(INPUT_FOLDER_ID);
  } catch (e) {
    ui.alert('❌ 입력 폴더를 열 수 없어요.\n\n폴더 ID를 확인해주세요:\n' + INPUT_FOLDER_ID);
    return;
  }

  // 폴더에서 xlsx만 수집 (하위 폴더는 보지 않음)
  const targets = [];
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const name = f.getName();
    if (/\.xlsx$/i.test(name)) targets.push(f);
  }

  if (!targets.length) {
    ui.alert('📭 불러올 파일이 없어요.\n\n채널톡 export(.xlsx)를 폴더에 올린 뒤 다시 실행해주세요.');
    return;
  }

  // 이미 저장된 상담ID (중복 판정용)
  const existing = readExistingIds_(chatSh);

  const summary = [];
  const stamp   = new Date();
  let moved = 0, failed = 0;

  targets.forEach(function(file) {
    const res = importOneFile_(file, chatSh, existing);
    verSh.appendRow([
      stamp, file.getName(), res.fileRows, res.saved, res.skipped,
      existing.size, res.ok ? (res.note || '정상') : ('실패 — ' + res.note)
    ]);
    summary.push((res.ok ? '✅ ' : '❌ ') + shortName_(file.getName()) +
                 '\n    파일 ' + res.fileRows + '건 → 저장 ' + res.saved +
                 '건, 중복 ' + res.skipped + '건' +
                 (res.note ? '\n    ⚠️ ' + res.note : ''));
    // 성공한 파일만 옮긴다 (실패한 파일은 그대로 둬야 재시도할 수 있다)
    if (res.ok) {
      file.moveTo(getOrCreateSubfolder_(folder, DONE_FOLDER_NAME));
      moved++;
    } else {
      failed++;
    }
  });

  // 혹시 남은 임시 사본을 조용히 치운다 (쌓이지 않게)
  const leftover = sweepTempFiles_();

  ui.alert(
    '📥 불러오기 완료\n\n' + summary.join('\n\n') +
    '\n\n누적 총계: ' + existing.size + '건' +
    (leftover ? '\n임시 파일 ' + leftover + '개 자동 정리됨' : '') +
    (moved  ? '\n"' + DONE_FOLDER_NAME + '" 폴더로 옮긴 파일: ' + moved + '개' : '') +
    (failed ? '\n실패해서 폴더에 그대로 둔 파일: ' + failed + '개 (고친 뒤 다시 실행하세요)' : '')
  );
}

// ── 파일 1개 처리
function importOneFile_(file, chatSh, existing) {
  const out = { fileRows: 0, saved: 0, skipped: 0, note: '', ok: false };

  // xlsx → 구글시트로 임시 변환해야 값을 읽을 수 있다
  let tempId = null;
  try {
    // supportsAllDrives: 공유 드라이브에 있는 파일도 접근하려면 필요
    const copy = Drive.Files.copy(
      { name: TEMP_PREFIX + file.getName(), mimeType: MimeType.GOOGLE_SHEETS },
      file.getId(),
      { supportsAllDrives: true }
    );
    tempId = copy.id;

    const tempSs = SpreadsheetApp.openById(tempId);
    const sheet  = tempSs.getSheetByName('UserChat') || tempSs.getSheets()[0];
    const values = sheet.getDataRange().getValues();

    if (values.length < 2) { out.note = '데이터가 없는 파일'; return out; }

    const header = values[0].map(function(h) { return String(h).trim(); });
    const idx    = {};
    IMPORT_COLS.forEach(function(c) { idx[c.key] = header.indexOf(c.key); });

    if (idx.id < 0 || idx.managedAt < 0) {
      out.note = '채널톡 export 형식이 아니에요 (id 또는 managedAt 컬럼 없음)';
      return out;
    }

    const missing = IMPORT_COLS.filter(function(c) { return idx[c.key] < 0; })
                               .map(function(c) { return c.key; });
    if (missing.length) out.note = '없는 컬럼은 빈칸 처리: ' + missing.join(', ');

    const rows = values.slice(1);
    out.fileRows = rows.length;

    const newRows = [];
    rows.forEach(function(row) {
      const id = String(row[idx.id] || '').trim();
      if (!id) return;
      if (existing.has(id)) { out.skipped++; return; }

      const rec = IMPORT_COLS.map(function(c) {
        return idx[c.key] >= 0 ? row[idx[c.key]] : '';
      });

      const managedAt = row[idx.managedAt];
      const tagStr    = idx.tags >= 0 ? String(row[idx.tags] || '') : '';
      rec.push(toWeekLabel_(managedAt));   // 주차
      rec.push(isAiResolved_(tagStr) ? 'AI' : '상담원');   // AI완결

      newRows.push(rec);
      existing.add(id);
    });

    if (newRows.length) {
      chatSh.getRange(chatSh.getLastRow() + 1, 1, newRows.length, CHAT_HEADERS.length)
            .setValues(newRows);
    }
    out.saved = newRows.length;
    out.ok    = true;

    // 파일 행수 = 저장 + 중복 이어야 정상. 어긋나면 빈 ID 등이 섞인 것
    const accounted = out.saved + out.skipped;
    if (accounted !== out.fileRows) {
      out.note = (out.note ? out.note + ' / ' : '') +
                 '행수 불일치: 파일 ' + out.fileRows + ' vs 처리 ' + accounted;
    }

  } catch (e) {
    out.note = '오류: ' + e.message;
  } finally {
    // 임시 사본 정리 — 실패를 조용히 넘기면 드라이브에 계속 쌓인다
    if (tempId) {
      let cleaned = false;
      try { DriveApp.getFileById(tempId).setTrashed(true); cleaned = true; } catch (e2) {}
      if (!cleaned) {
        try { Drive.Files.remove(tempId, { supportsAllDrives: true }); cleaned = true; } catch (e3) {}
      }
      if (!cleaned) {
        out.note = (out.note ? out.note + ' / ' : '') +
                   '임시 사본이 남았어요 (메뉴 > 임시 파일 정리 실행)';
      }
    }
  }

  return out;
}

// ── 이미 저장된 상담ID 집합
function readExistingIds_(chatSh) {
  const set = new Set();
  const last = chatSh.getLastRow();
  if (last < 2) return set;
  const ids = chatSh.getRange(2, 1, last - 1, 1).getValues();
  ids.forEach(function(r) {
    const v = String(r[0] || '').trim();
    if (v) set.add(v);
  });
  return set;
}

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function shortName_(n) {
  return n.length > 46 ? n.substring(0, 43) + '...' : n;
}

// ── AI가 끝까지 처리했는지 (상담원이관이 있으면 아님)
function isAiResolved_(tagStr) {
  const tags = String(tagStr || '').split(',').map(function(t) { return t.trim(); });
  if (tags.some(function(t) { return t.indexOf(TAG_TRANSFERRED) >= 0; })) return false;
  return tags.some(function(t) { return t === TAG_AI_RESOLVED; });
}

// ── 날짜 → 주차 라벨 (월요일 시작, 예: 07/13~07/19)
function toWeekLabel_(val) {
  const d = toDate_(val);
  if (!d) return '';
  const day     = d.getDay();
  const diffMon = (day === 0) ? -6 : 1 - day;
  const mon = new Date(d); mon.setDate(d.getDate() + diffMon);
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
  const f = function(x) {
    return ('0' + (x.getMonth() + 1)).slice(-2) + '/' + ('0' + x.getDate()).slice(-2);
  };
  return f(mon) + '~' + f(sun);
}

function toDate_(val) {
  if (!val) return null;
  if (Object.prototype.toString.call(val) === '[object Date]') {
    return isNaN(val.getTime()) ? null : val;
  }
  const s = String(val).trim().replace(' ', 'T');
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
