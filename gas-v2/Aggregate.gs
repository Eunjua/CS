// ============================================================
//  집계 생성
// ============================================================
//  상담원본 + 만족도원본 → 주차별 / 태그별 집계 시트
//  대시보드는 원본(수만 행)이 아니라 이 집계본만 읽는다.
//  → 기존 대시보드가 6.6MB를 받아 20~30초 걸리던 문제를 없앤다.
// ============================================================

const AGG_WEEK_HEADERS = [
  '주차', '총건수', '채팅', '전화',
  'AI완결', '상담원응대', '부재중',
  '만족도평균', '만족도응답수', '친절도평균',
  'AI만족도', 'AI응답수', '상담원만족도', '상담원응답수',
  'AI친절도', 'AI친절응답수', '상담원친절도', '상담원친절응답수',
];

const AGG_TAG_HEADERS = ['주차', '태그', '건수'];

function buildAggregates() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ensureTimeZone_(ss);

  const chatSh = ss.getSheetByName(SHEET_CHATS);
  if (!chatSh || chatSh.getLastRow() < 2) {
    ui.alert('상담 데이터가 없어요.\n먼저 [📥 상담 파일 불러오기]를 실행해주세요.');
    return;
  }

  // ── 1. 상담원본 읽기
  const chatVals = chatSh.getDataRange().getValues();
  const cHead    = chatVals[0].map(function(h) { return String(h).trim(); });
  // 상담원본은 이 스크립트가 CHAT_HEADERS 순서대로만 쓰므로, 헤더 글자가 깨져도
  // 정의된 위치(defaultChatCol_)로 되돌려 찾는다.
  const ci = {
    id     : chatCol_(cHead, '상담ID'),
    week   : chatCol_(cHead, '주차'),
    medium : chatCol_(cHead, '채널유형'),
    tags   : chatCol_(cHead, '태그'),
    state  : chatCol_(cHead, '상태'),
    missed : chatCol_(cHead, '부재중사유'),
    ai     : chatCol_(cHead, 'AI완결'),
  };
  if (ci.week < 0 || ci.id < 0) { ui.alert('❌ 상담원본 헤더가 예상과 달라요.'); return; }

  // ── 2. 만족도: 상담ID → 점수
  const csatById = {};
  const csatSh = ss.getSheetByName(SHEET_CSAT);
  if (csatSh && csatSh.getLastRow() > 1) {
    const cv = csatSh.getDataRange().getValues();
    const h  = cv[0].map(function(x) { return String(x).trim(); });
    const si = { id: h.indexOf('상담ID'), csat: h.indexOf('만족도'), kind: h.indexOf('친절도') };
    if (si.id >= 0) {
      for (let i = 1; i < cv.length; i++) {
        const id = String(cv[i][si.id] || '').trim();
        if (!id) continue;
        csatById[id] = {
          csat : num_(cv[i][si.csat]),
          kind : num_(cv[i][si.kind]),
        };
      }
    }
  }

  // ── 3. 주차별 · 태그별 누적
  const weeks = {};   // week → 집계 객체
  const tags  = {};   // week|tag → 건수

  const blank = function() {
    return {
      total: 0, chat: 0, phone: 0, ai: 0, human: 0, missed: 0,
      cSum: 0, cCnt: 0, kSum: 0, kCnt: 0,
      aiSum: 0, aiCnt: 0, huSum: 0, huCnt: 0,          // 만족도(AI/상담원)
      aiKSum: 0, aiKCnt: 0, huKSum: 0, huKCnt: 0,      // 친절도(AI/상담원)
    };
  };

  for (let i = 1; i < chatVals.length; i++) {
    const row  = chatVals[i];
    const week = String(row[ci.week] || '').trim();
    if (!week) continue;

    if (!weeks[week]) weeks[week] = blank();
    const w = weeks[week];

    w.total++;
    if (String(row[ci.medium] || '').trim().toLowerCase() === 'phone') w.phone++;
    else w.chat++;

    const isAi = String(row[ci.ai] || '').trim() === 'AI';
    if (isAi) w.ai++; else w.human++;

    if (String(row[ci.state] || '').trim() === 'missed' ||
        String(row[ci.missed] || '').trim() !== '') w.missed++;

    // 태그 (쉼표 구분, 빈 값은 '태그없음')
    const rawTags = String(row[ci.tags] || '').trim();
    const tagList = rawTags ? rawTags.split(',').map(function(t) { return t.trim(); }).filter(Boolean)
                            : ['태그없음'];
    tagList.forEach(function(t) {
      const key = week + '|' + t;
      tags[key] = (tags[key] || 0) + 1;
    });

    // 만족도 — 응답이 있는 상담만
    const sc = csatById[String(row[ci.id] || '').trim()];
    if (sc) {
      if (sc.csat !== null) {
        w.cSum += sc.csat; w.cCnt++;
        if (isAi) { w.aiSum += sc.csat; w.aiCnt++; }
        else      { w.huSum += sc.csat; w.huCnt++; }
      }
      if (sc.kind !== null) {
        w.kSum += sc.kind; w.kCnt++;
        if (isAi) { w.aiKSum += sc.kind; w.aiKCnt++; }
        else      { w.huKSum += sc.kind; w.huKCnt++; }
      }
    }
  }

  // ── 4. 주차 집계 시트 쓰기 (최신 주가 위로)
  const weekRows = Object.keys(weeks).sort(sortWeekDesc_).map(function(wk) {
    const w = weeks[wk];
    return [
      wk, w.total, w.chat, w.phone,
      w.ai, w.human, w.missed,
      avg_(w.cSum, w.cCnt), w.cCnt, avg_(w.kSum, w.kCnt),
      avg_(w.aiSum, w.aiCnt), w.aiCnt, avg_(w.huSum, w.huCnt), w.huCnt,
      avg_(w.aiKSum, w.aiKCnt), w.aiKCnt, avg_(w.huKSum, w.huKCnt), w.huKCnt,
    ];
  });
  writeSheet_(ss, SHEET_AGG_WEEK, AGG_WEEK_HEADERS, weekRows);

  // ── 5. 태그 집계 시트 쓰기 (주차 최신순 → 건수 많은 순)
  const tagRows = Object.keys(tags).map(function(k) {
    const p = k.split('|');
    return [p[0], p[1], tags[k]];
  }).sort(function(a, b) {
    const d = sortWeekDesc_(a[0], b[0]);
    return d !== 0 ? d : b[2] - a[2];
  });
  writeSheet_(ss, SHEET_AGG_TAG, AGG_TAG_HEADERS, tagRows);

  const latest = weekRows.length ? weekRows[0] : null;
  ui.alert(
    '📊 집계 완료\n\n' +
    '주차: ' + weekRows.length + '개\n' +
    '태그 조합: ' + tagRows.length + '행\n' +
    (latest
      ? '\n최신 주차 ' + latest[0] + '\n' +
        '  총 ' + latest[1] + '건 (채팅 ' + latest[2] + ' / 전화 ' + latest[3] + ')\n' +
        '  AI완결 ' + latest[4] + '건 / 상담원 ' + latest[5] + '건\n' +
        '  만족도 ' + (latest[7] === '' ? '—' : latest[7] + '점') + ' (' + latest[8] + '건 응답)'
      : '')
  );
}

// ── 시트를 헤더+데이터로 새로 쓴다 (집계본이라 매번 덮어쓰는 게 안전)
function writeSheet_(ss, name, headers, rows) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  sh.clearContents();
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#e8f5e9');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
  sh.setFrozenRows(1);
  return sh;
}

// 헤더 글자로 컬럼을 찾되, 못 찾으면 CHAT_HEADERS의 정의 위치로 되돌린다.
// (헤더 셀 하나가 인코딩으로 깨져도 집계가 멈추지 않게)
function chatCol_(header, label) {
  const byName = header.indexOf(label);
  if (byName >= 0) return byName;
  const byDef = CHAT_HEADERS.indexOf(label);
  return byDef;   // 정의에 있으면 그 위치, 없으면 -1
}

function avg_(sum, cnt) {
  return cnt ? Math.round((sum / cnt) * 100) / 100 : '';
}

function num_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// '07/13~07/19' 형식을 최신순으로. 연도가 없어 12월→1월 경계는 월 기준으로만 비교한다.
function sortWeekDesc_(a, b) {
  return String(b).localeCompare(String(a));
}
