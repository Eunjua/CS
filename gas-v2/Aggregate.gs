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

// 설문 객관식(해결여부·대기적절) 보기별 건수.
// 보기 문구를 스크립트에 박지 않고 들어온 값 그대로 센다 — 폼 보기가 바뀌어도 집계는 안 멈춘다.
// 순서·색은 대시보드가 정한다.
const AGG_SURVEY_HEADERS = ['주차', '항목', '보기', '건수'];
const SURVEY_FIELDS = [
  { col: '해결여부', label: '해결여부' },
  { col: '대기적절', label: '대기적절' },
];

// 체감(고객이 고른 대기 만족) × 실제 대기시간 구간
const AGG_FEELWAIT_HEADERS = ['주차', '체감', '구간', '건수'];

// 채널톡 '대기시간초'(timeFromFirstOpenToFirstAnswerInOperation)를 구간으로.
//  · 단위는 초. 원본 export로 확인함 (0초 초과 건 중앙 10.5분, 최대 138분)
//  · 0초는 감추지 않고 따로 둔다 — ALF 봇이 즉답하면 0초로 찍히는데,
//    봇 답변 뒤 상담원을 한참 기다린 고객도 여기 섞인다. 묶어버리면
//    '빨리 답했는데 왜 불만이지' 하는 어긋남이 안 보인다.
//  · 빈칸은 '측정불가' — 전체의 45%라 0분으로 취급하면 통계가 통째로 망가진다.
function waitBucket_(v) {
  if (v === '' || v === null || v === undefined) return '측정불가';
  const sec = Number(v);
  if (isNaN(sec) || sec < 0) return '측정불가';
  if (sec === 0) return '즉시';
  const min = sec / 60;
  if (min < 5)  return '~5분';
  if (min < 15) return '5~15분';
  if (min < 30) return '15~30분';
  return '30분+';
}

// 상담원별 집계 — AI완결 건은 빼고, 사람이 응대한 상담만 담는다
const AGG_AGENT_HEADERS = [
  '주차', '상담원', '담당자ID들', '상담건수',
  '만족도평균', '만족도응답수', '친절도평균', '친절도응답수',
];

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
    agent  : chatCol_(cHead, '담당자ID'),
    wait   : chatCol_(cHead, '대기시간초'),
  };
  if (ci.week < 0 || ci.id < 0) { ui.alert('❌ 상담원본 헤더가 예상과 달라요.'); return; }

  // 상담원 이름 매핑을 먼저 읽는다 — 한 사람이 담당자ID를 여러 개 쓰는 경우가 있어
  // 집계를 ID가 아니라 이름으로 묶기 위해서다.
  const agentMap = readAgentMap_(ss);

  // ── 2. 만족도: 상담ID → 점수
  const csatById = {};
  const csatSh = ss.getSheetByName(SHEET_CSAT);
  if (csatSh && csatSh.getLastRow() > 1) {
    const cv = csatSh.getDataRange().getValues();
    const h  = cv[0].map(function(x) { return String(x).trim(); });
    const si = { id: h.indexOf('상담ID'), csat: h.indexOf('만족도'), kind: h.indexOf('친절도') };
    const svIdx = SURVEY_FIELDS.map(function(f) { return h.indexOf(f.col); });
    if (si.id >= 0) {
      for (let i = 1; i < cv.length; i++) {
        const id = String(cv[i][si.id] || '').trim();
        if (!id) continue;
        const sv = {};
        SURVEY_FIELDS.forEach(function(f, k) {
          if (svIdx[k] >= 0) {
            const v = String(cv[i][svIdx[k]] || '').trim();
            if (v) sv[f.label] = v;
          }
        });
        csatById[id] = {
          csat   : num_(cv[i][si.csat]),
          kind   : num_(cv[i][si.kind]),
          survey : sv,
        };
      }
    }
  }

  // ── 3. 주차별 · 태그별 · 상담원별 누적
  const weeks    = {};   // week → 집계 객체
  const tags     = {};   // week|tag → 건수
  const agents   = {};   // week|상담원이름 → 집계 객체 (ID가 여러 개여도 이름으로 합침)
  const agentIds = {};   // 상담원본에서 발견한 담당자ID 전체 (매핑 시트 자동 보충용)
  const survey   = {};   // week|항목|보기 → 건수
  const feelWait = {};   // week|체감|구간 → 건수

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
      // 해결여부·대기적절 — 점수와 달리 보기 문구 그대로 센다
      if (sc.survey) {
        Object.keys(sc.survey).forEach(function(field) {
          const key = week + '|' + field + '|' + sc.survey[field];
          survey[key] = (survey[key] || 0) + 1;
        });
        // 체감 × 실제 — 대기 문항에 답한 상담만
        const feel = sc.survey['대기적절'];
        if (feel) {
          const fk = week + '|' + feel + '|' +
                     waitBucket_(ci.wait >= 0 ? row[ci.wait] : '');
          feelWait[fk] = (feelWait[fk] || 0) + 1;
        }
      }
    }

    // 상담원별 — AI가 끝낸 건은 사람 성과가 아니므로 뺀다. 담당자가 없는 건도 뺀다.
    const agentId = ci.agent >= 0 ? String(row[ci.agent] || '').trim() : '';
    if (agentId) agentIds[agentId] = true;
    if (!isAi && agentId) {
      const name = agentName_(agentMap, agentId);   // 같은 이름이면 여기서 한 덩어리가 된다
      const ak   = week + '|' + name;
      if (!agents[ak]) agents[ak] = { cnt: 0, cSum: 0, cCnt: 0, kSum: 0, kCnt: 0, ids: {} };
      const a = agents[ak];
      a.cnt++;
      a.ids[agentId] = true;
      if (sc) {
        if (sc.csat !== null) { a.cSum += sc.csat; a.cCnt++; }
        if (sc.kind !== null) { a.kSum += sc.kind; a.kCnt++; }
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

  // ── 6. 상담원 집계 시트 쓰기 (이름 기준 — 한 사람의 여러 ID는 이미 합쳐져 있다)
  const agentRows = Object.keys(agents).map(function(k) {
    const sep = k.indexOf('|');            // 이름에 '|'가 들어갈 수 있으니 첫 구분자만 자른다
    const wk = k.slice(0, sep), name = k.slice(sep + 1);
    const a  = agents[k];
    return [
      wk, name, Object.keys(a.ids).join(', '), a.cnt,
      avg_(a.cSum, a.cCnt), a.cCnt, avg_(a.kSum, a.kCnt), a.kCnt,
    ];
  }).sort(function(a, b) {
    const d = sortWeekDesc_(a[0], b[0]);
    return d !== 0 ? d : b[3] - a[3];   // 같은 주차면 상담건수 많은 순
  });
  writeSheet_(ss, SHEET_AGG_AGENT, AGG_AGENT_HEADERS, agentRows);

  // ── 7. 설문 집계 · 체감×실제 집계 시트 쓰기
  //     둘 다 'week|A|B → 건수' 구조라 같은 방식으로 편다.
  const surveyRows   = countMapToRows_(survey);
  const feelWaitRows = countMapToRows_(feelWait);
  writeSheet_(ss, SHEET_AGG_SURVEY,   AGG_SURVEY_HEADERS,   surveyRows);
  writeSheet_(ss, SHEET_AGG_FEELWAIT, AGG_FEELWAIT_HEADERS, feelWaitRows);

  // 상담원본에서 처음 본 담당자ID는 매핑 시트에 줄만 추가해 둔다 (이름은 사용자가 채움)
  const unnamed = syncAgentMap_(ss, Object.keys(agentIds), agentMap);

  const latest = weekRows.length ? weekRows[0] : null;
  ui.alert(
    '📊 집계 완료\n\n' +
    '주차: ' + weekRows.length + '개\n' +
    '태그 조합: ' + tagRows.length + '행\n' +
    '상담원 집계: ' + agentRows.length + '행\n' +
    '설문(해결·대기) 집계: ' + surveyRows.length + '행\n' +
    '체감×실제 대기 집계: ' + feelWaitRows.length + '행\n' +
    (unnamed.length
      ? '\n⚠️ 이름이 비어 있는 담당자 ' + unnamed.length + '명이 있어요.\n' +
        '"' + SHEET_AGENT_MAP + '" 시트에서 이름을 채운 뒤 다시 집계해주세요.\n'
      : '') +
    (latest
      ? '\n최신 주차 ' + latest[0] + '\n' +
        '  총 ' + latest[1] + '건 (채팅 ' + latest[2] + ' / 전화 ' + latest[3] + ')\n' +
        '  AI완결 ' + latest[4] + '건 / 상담원 ' + latest[5] + '건\n' +
        '  만족도 ' + (latest[7] === '' ? '—' : latest[7] + '점') + ' (' + latest[8] + '건 응답)'
      : '')
  );
}

// ── 상담원 이름 매핑 시트 ('담당자ID' | '이름')
//    한 사람이 ID를 여러 개 쓸 수 있다. 같은 이름을 적으면 집계에서 한 사람으로 합쳐진다.
//    시트가 없으면 만들고, 이름이 비어 있는 줄은 매핑에서 제외한다.
//    반환: { 담당자ID: 이름 }
function readAgentMap_(ss) {
  const sh = ensureAgentMapSheet_(ss);
  const map = {};
  if (sh.getLastRow() > 1) {
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    vals.forEach(function(r) {
      const id   = String(r[0] || '').trim();
      const name = String(r[1] || '').trim();
      if (id && name) map[id] = name;
    });
  }
  return map;
}

// 상담원본에 있는데 매핑 시트에 없는 담당자ID를 줄로 추가한다.
// 이미 적어둔 이름은 절대 건드리지 않는다 (집계 시트는 덮어쓰지만 이 시트는 사용자 입력본).
// 반환: 아직 이름이 비어 있는 ID 목록
function syncAgentMap_(ss, foundIds, agentMap) {
  const sh = ensureAgentMapSheet_(ss);

  const listed = {};
  if (sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function(r) {
      const id = String(r[0] || '').trim();
      if (id) listed[id] = true;
    });
  }

  const newIds = foundIds.filter(function(id) { return id && !listed[id]; });
  if (newIds.length) {
    sh.getRange(sh.getLastRow() + 1, 1, newIds.length, 2)
      .setValues(newIds.map(function(id) { return [id, '']; }));
  }

  return foundIds.filter(function(id) { return id && !agentMap[id]; });
}

function ensureAgentMapSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_AGENT_MAP);
  if (!sh) {
    sh = ss.insertSheet(SHEET_AGENT_MAP);
    sh.getRange(1, 1, 1, AGENT_MAP_HEADERS.length).setValues([AGENT_MAP_HEADERS])
      .setFontWeight('bold').setBackground('#fff3e0');
    sh.setFrozenRows(1);
    sh.setColumnWidth(1, 160);
    sh.setColumnWidth(2, 160);
  }
  return sh;
}

// 이름이 없으면 ID 뒤 4자리로 임시 표기 — 차트에서 빈칸으로 사라지지 않게
function agentName_(map, id) {
  if (map[id]) return map[id];
  return '미지정(' + String(id).slice(-4) + ')';
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

// 'week|A|B → 건수' 맵을 [주차, A, B, 건수] 행으로.
// B(보기·구간)에 '|'가 들어갈 수 있으니 앞 두 구분자만 자른다.
// 정렬: 주차 최신순 → A 이름순 → 건수 많은 순
function countMapToRows_(map) {
  return Object.keys(map).map(function(k) {
    const i1 = k.indexOf('|');
    const i2 = k.indexOf('|', i1 + 1);
    return [k.slice(0, i1), k.slice(i1 + 1, i2), k.slice(i2 + 1), map[k]];
  }).sort(function(a, b) {
    const d = sortWeekDesc_(a[0], b[0]);
    if (d !== 0) return d;
    if (a[1] !== b[1]) return a[1] < b[1] ? -1 : 1;
    return b[3] - a[3];
  });
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
