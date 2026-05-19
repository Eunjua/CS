// ============================================================
//  VOC 전체 자동화 스크립트 (GitHub push + Notion 주간 리포트 포함)
//  파일명: VOC_통합스크립트.gs  ← GAS 에디터에 이 파일 1개만 붙여넣으세요
//
//  [전체 구조]
//  ┌──────────────────────────────────────────────────────────┐
//  │  [설문지 응답 시트1]  ← 구글폼 자동 저장 (건드리지 않음)  │
//  │  [상담데이터]         ← 채널톡 raw 데이터 (비공개)        │
//  │         ↓ Script 1: CSAT 매핑 (매일 01:00)              │
//  │  [매핑결과]           ← CSAT + 상담데이터 JOIN           │
//  │         ↓ Script 2: 대시보드 동기화 (매일 01:30)         │
//  │  [대시보드_공개용]    ← 개인정보 제거, 웹에 게시(CSV)     │
//  │         ↓ 메뉴 버튼: 📤 GitHub 업데이트 (수동)           │
//  │  GitHub Pages        ← report.json 업데이트             │
//  │         ↓ 메뉴 버튼: 📝 VOC 주간 리포트 생성 (수동)      │
//  │  Notion 페이지       ← 주간 리포트 자동 생성             │
//  └──────────────────────────────────────────────────────────┘
//
//  [트리거 설정] 스크립트 편집기 → 시계 아이콘(트리거)
//    - runCsatMapping   → 시간 기반 → 매일 오전 1시
//    - runDashboardSync → 시간 기반 → 매일 오전 1시 30분
//
//  [GitHub 업데이트]
//    - 매주 월요일 데이터 등록 후 메뉴 → 📤 GitHub 업데이트 클릭
//
//  [Notion 주간 리포트]
//    - 메뉴 → 📝 VOC 주간 리포트 생성 클릭 (수동 입력 불필요, 시트에서 자동 계산)
//    - CSAT: 매핑결과 시트 최신 주차 자동 계산 (채팅/전화 분리)
//    - 당일응대율: 상담데이터 시트 최신 주차 자동 계산
//    - 필요한 시트: OKR목표, 설정
//    - 필요한 스크립트 속성: NOTION_TOKEN
//      (Apps Script 에디터 > 프로젝트 설정 > 스크립트 속성 > NOTION_TOKEN 추가)
//
//  [OKR목표 시트]
//    A2=상담만족도목표 레이블, B2=4.2
//    A3=재문의율목표 레이블,   B3=3.5
//    A4=당일응대율목표 레이블, B4=96
//
//  [설정 시트]
//    A1=NOTION_PAGE_ID,   B1=(Notion 상위 페이지 ID)
//    A2=NOTION_TOKEN,     B2=(비워두고 스크립트 속성에 저장 권장)
//    A3=인사이트_활성화,  B3=FALSE  ← V7 통과 후 TRUE로 변경
//    A4=검증결과,         B4=(verifyAgainstVocReport_ 실행 후 자동 기록)
// ============================================================


// ── 시트 이름 (변경 시 여기만 수정)
const SHEET_FORM      = '설문지 응답 시트1';
const SHEET_RAW       = '상담데이터';
const SHEET_MAPPED    = '매핑결과';
const SHEET_PUBLIC    = '대시보드_공개용';
const SHEET_NPS_요양  = '고객NPS_요양';
const SHEET_NPS_기관  = '고객NPS_기관';
const SHEET_CSAT_SEND = '만족도발송건';
const SHEET_AGENT_MAP = '상담사_매핑';

// ── GitHub 설정
// GITHUB_TOKEN은 스크립트 속성에 저장 (Apps Script 에디터 > 프로젝트 설정 > 스크립트 속성)
const GITHUB_REPO   = 'Eunjua/CS';
const GITHUB_BRANCH = 'main';

// ── 대시보드에 공개할 컬럼
const PUBLIC_COLS = [
  'id',
  'firstOpenedAt',
  'mediumType',
  'tags',
  'state',
  'userId',
  'assigneeId',
  'timeFromFirstOpenToFirstAnswerInOperation'
];

// ── 구글폼 응답 시트 헤더
const FORM_HEADERS = {
  timestamp : '타임스탬프',
  id        : 'id',
  csat      : '오늘 상담에 얼마나 만족하셨나요?',
  kindness  : '상담사가 친절하고 이해하기 쉽게 안내했나요?',
  resolved  : '문의하신 내용이 해결되었나요?',
  waiting   : '답변을 받기까지 기다리는 시간이 적절했나요?',
  comment   : '상담을 받으시며 느낀 점이나 개선되었으면 하는 부분이 있다면 자유롭게 남겨 주세요.'
};

// ── 상담데이터 헤더
const RAW_HEADERS = {
  id       : 'id',
  openedAt : 'openedAt',
  medium   : 'mediumType',
  tags     : 'tags',
  state    : 'state'
};

// ── 매핑결과 탭 헤더
const MAPPED_HEADERS = [
  '상담ID', '상담일시', '채널', '태그', '상태',
  '만족도', '친절도', '해결여부', '대기시간', '자유의견', '응답일시'
];


// ============================================================
//  메뉴바
// ============================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🔄 VOC 업데이트')
    .addItem('전체 실행 (CSAT + 대시보드)', 'runAll')
    .addSeparator()
    .addItem('📤 GitHub 업데이트', 'pushToGitHub')
    .addSeparator()
    .addItem('📝 VOC 주간 리포트 생성', 'generateWeeklyReport')
    .addToUi();
}


// ============================================================
//  SCRIPT 1: CSAT 매핑
// ============================================================

function csatToScore(val) {
    const map = {
      '🔴 매우 불만족': 1, '매우 불만족': 1,
      '불만족': 2,
      '🟡 보통': 3, '보통': 3,
      '만족': 4,
      '🟢 매우 만족': 5, '매우 만족': 5
    };
    return map[String(val).trim()] ?? val;
}

function kindnessToScore(val) {
    const map = {
      '🔴매우 불친절': 1, '매우 불친절': 1,
      '불친절': 2,
      '🟡 보통': 3, '보통': 3,
      '친절': 4,
      '🟢 매우 친절': 5, '매우 친절': 5
    };
    return map[String(val).trim()] ?? val;
}

function runCsatMapping() {
  const ss     = SpreadsheetApp.getActiveSpreadsheet();
  const formSh = ss.getSheetByName(SHEET_FORM);
  const rawSh  = ss.getSheetByName(SHEET_RAW);

  if (!formSh) { Logger.log('❌ 시트 없음: ' + SHEET_FORM); return; }
  if (!rawSh)  { Logger.log('❌ 시트 없음: ' + SHEET_RAW);  return; }

  let mappedSh = ss.getSheetByName(SHEET_MAPPED);
  const isNew  = !mappedSh;
  if (isNew) mappedSh = ss.insertSheet(SHEET_MAPPED);

  if (isNew || mappedSh.getLastRow() === 0) {
    mappedSh.clearContents();
    mappedSh.getRange(1, 1, 1, MAPPED_HEADERS.length)
      .setValues([MAPPED_HEADERS])
      .setFontWeight('bold')
      .setBackground('#f0f0f0');
  }

  const formData = formSh.getDataRange().getValues();
  if (formData.length < 2) { Logger.log('폼 응답 없음'); return; }

  const fHead = formData[0].map(h => String(h).trim());
  const fIdx  = {
    timestamp : fHead.indexOf(FORM_HEADERS.timestamp),
    id        : fHead.indexOf(FORM_HEADERS.id),
    csat      : fHead.indexOf(FORM_HEADERS.csat),
    kindness  : fHead.indexOf(FORM_HEADERS.kindness),
    resolved  : fHead.indexOf(FORM_HEADERS.resolved),
    waiting   : fHead.indexOf(FORM_HEADERS.waiting),
    comment   : fHead.indexOf(FORM_HEADERS.comment)
  };

  if (fIdx.id < 0) {
    Logger.log('❌ 폼 시트에 "id" 컬럼이 없어요.');
    return;
  }

  const rawData = rawSh.getDataRange().getValues();
  const rHead   = rawData[0].map(h => String(h).trim());
  const rIdx    = {
    id       : rHead.indexOf(RAW_HEADERS.id),
    openedAt : rHead.indexOf(RAW_HEADERS.openedAt),
    medium   : rHead.indexOf(RAW_HEADERS.medium),
    tags     : rHead.indexOf(RAW_HEADERS.tags),
    state    : rHead.indexOf(RAW_HEADERS.state)
  };

  if (rIdx.id < 0) {
    Logger.log('❌ 상담데이터 시트에 "id" 컬럼이 없어요.');
    return;
  }

  const rawMap = {};
  for (let i = 1; i < rawData.length; i++) {
    const rowId = String(rawData[i][rIdx.id]).trim();
    if (rowId) rawMap[rowId] = rawData[i];
  }

  const existingIds = new Set();
  const mappedData  = mappedSh.getDataRange().getValues();
  for (let i = 1; i < mappedData.length; i++) {
    const eid = String(mappedData[i][0]).trim();
    if (eid) existingIds.add(eid);
  }

  const newRows = [];
  let matched = 0, skipped = 0, noMatch = 0;

  for (let i = 1; i < formData.length; i++) {
    const row    = formData[i];
    const formId = String(row[fIdx.id]).trim();

    if (!formId)                 { skipped++; continue; }
    if (existingIds.has(formId)) { skipped++; continue; }

    const rawRow = rawMap[formId];
    if (!rawRow) { noMatch++; continue; }

    newRows.push([
      formId,
      rIdx.openedAt  >= 0 ? rawRow[rIdx.openedAt]  : '',
      rIdx.medium    >= 0 ? rawRow[rIdx.medium]     : '',
      rIdx.tags      >= 0 ? rawRow[rIdx.tags]       : '',
      rIdx.state     >= 0 ? rawRow[rIdx.state]      : '',
      fIdx.csat      >= 0 ? csatToScore(row[fIdx.csat])          : '',
      fIdx.kindness  >= 0 ? kindnessToScore(row[fIdx.kindness])      : '',
      fIdx.resolved  >= 0 ? row[fIdx.resolved]      : '',
      fIdx.waiting   >= 0 ? row[fIdx.waiting]       : '',
      fIdx.comment   >= 0 ? row[fIdx.comment]       : '',
      fIdx.timestamp >= 0 ? row[fIdx.timestamp]     : ''
    ]);

    existingIds.add(formId);
    matched++;
  }

  if (newRows.length > 0) {
    mappedSh.getRange(mappedSh.getLastRow() + 1, 1, newRows.length, MAPPED_HEADERS.length)
      .setValues(newRows);
  }

  Logger.log(`CSAT 매핑 완료 — 신규 ${matched}건 / 미매칭 ${noMatch}건 / 건너뜀 ${skipped}건`);
}


// ============================================================
//  SCRIPT 2: 대시보드용 공개 시트 동기화
// ============================================================

function runDashboardSync() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const rawSh = ss.getSheetByName(SHEET_RAW);
  if (!rawSh) { Logger.log('❌ 시트 없음: ' + SHEET_RAW); return; }

  let pubSh = ss.getSheetByName(SHEET_PUBLIC);
  if (!pubSh) pubSh = ss.insertSheet(SHEET_PUBLIC);

  const rawData = rawSh.getDataRange().getValues();
  if (rawData.length < 2) { Logger.log('상담데이터 없음'); return; }

  const rHead      = rawData[0].map(h => String(h).trim());
  const colIndices = PUBLIC_COLS.map(col => {
    const idx = rHead.indexOf(col);
    if (idx < 0) Logger.log(`⚠️  컬럼 없음: "${col}"`);
    return idx;
  });

  const waitColPos     = PUBLIC_COLS.indexOf('timeFromFirstOpenToFirstAnswerInOperation');
  const assigneeColPos = PUBLIC_COLS.indexOf('assigneeId');

  // 상담사 ID → 이름 매핑
  const agentMapSh = ss.getSheetByName(SHEET_AGENT_MAP);
  const agentMap = {};
  if (agentMapSh) {
    const mapRows = agentMapSh.getDataRange().getValues();
    const mHead   = mapRows[0].map(h => String(h).trim());
    const idCol   = mHead.indexOf('assigneeId');
    const nameCol = mHead.indexOf('name');
    if (idCol >= 0 && nameCol >= 0) {
      mapRows.slice(1).forEach(row => {
        const id = String(row[idCol]).trim();
        if (id) agentMap[id] = String(row[nameCol]).trim();
      });
    } else {
      Logger.log('⚠️  상담사_매핑 시트에 assigneeId 또는 name 컬럼 없음');
    }
  } else {
    Logger.log('⚠️  시트 없음: ' + SHEET_AGENT_MAP);
  }

  const outputHeaders = [...PUBLIC_COLS, '대기시간(분)'];
  const outputRows = rawData.slice(1).map(row => {
    const base    = colIndices.map(i => (i >= 0 ? row[i] : ''));
    const waitSec = waitColPos >= 0 ? parseFloat(base[waitColPos]) : NaN;
    const waitMin = (!isNaN(waitSec) && waitSec > 0) ? Math.round(waitSec / 60) : '';
    if (assigneeColPos >= 0) {
      const rawId = String(base[assigneeColPos]).trim();
      if (agentMap[rawId]) base[assigneeColPos] = agentMap[rawId];
    }
    return [...base, waitMin];
  });

  const output = [outputHeaders, ...outputRows];

  pubSh.clearContents();
  pubSh.getRange(1, 1, output.length, outputHeaders.length).setValues(output);
  pubSh.getRange(1, 1, 1, outputHeaders.length)
    .setFontWeight('bold')
    .setBackground('#e8f5e9');

  Logger.log(`대시보드 동기화 완료 — ${outputRows.length}건 → "${SHEET_PUBLIC}" 탭 업데이트됨`);
}


// ============================================================
//  전체 실행
// ============================================================

function runAll() {
  runCsatMapping();
  runDashboardSync();
}


// ============================================================
//  웹앱 API (doGet)
// ============================================================

function doGet(e) {
  const sheet = (e.parameter.sheet || '').toLowerCase();
  const ss    = SpreadsheetApp.getActiveSpreadsheet();

  if (sheet === 'daily_response') return getDailyResponseData(ss);
  if (sheet === 'csat')      return getSheetAsJson(ss, SHEET_MAPPED);
  if (sheet === 'dashboard') return getSheetAsJson(ss, SHEET_PUBLIC);
  if (sheet === 'nps_요양')  return getSheetAsJson(ss, SHEET_NPS_요양);
  if (sheet === 'nps_기관')  return getSheetAsJson(ss, SHEET_NPS_기관);
  if (sheet === 'csat_send') return getSheetAsJson(ss, SHEET_CSAT_SEND);
  if (sheet === 'report') {
    const pubSh     = ss.getSheetByName(SHEET_PUBLIC);
    const mappedSh  = ss.getSheetByName(SHEET_MAPPED);
    const nps요양Sh = ss.getSheetByName(SHEET_NPS_요양);
    const nps기관Sh = ss.getSheetByName(SHEET_NPS_기관);

    const pubValues     = pubSh     ? pubSh.getDataRange().getValues()     : [];
    const mappedValues  = mappedSh  ? mappedSh.getDataRange().getValues()  : [];
    const nps요양Values = nps요양Sh ? nps요양Sh.getDataRange().getValues() : [];
    const nps기관Values = nps기관Sh ? nps기관Sh.getDataRange().getValues() : [];

    return ContentService
      .createTextOutput(buildReportJson(pubValues, mappedValues, nps요양Values, nps기관Values))
      .setMimeType(ContentService.MimeType.JSON);
  }

  return getSheetAsJson(ss, SHEET_PUBLIC);
}

function getSheetAsJson(ss, sheetName) {
  const sh = ss.getSheetByName(sheetName);
  if (!sh) return ContentService
    .createTextOutput(JSON.stringify({ error: `시트 없음: ${sheetName}` }))
    .setMimeType(ContentService.MimeType.JSON);

  const values = sh.getDataRange().getValues();
  if (values.length < 2) return ContentService
    .createTextOutput(JSON.stringify({ data: [] }))
    .setMimeType(ContentService.MimeType.JSON);

  const headers = values[0].map(h => String(h).trim());
  const rows = values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      obj[h] = (v instanceof Date) ? v.toISOString() : String(v ?? '');
    });
    return obj;
  });

  return ContentService
    .createTextOutput(JSON.stringify({ data: rows }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  GitHub push
// ============================================================

function pushToGitHub() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(SHEET_PUBLIC);

  if (!sh) {
    SpreadsheetApp.getUi().alert('❌ 대시보드_공개용 시트가 없어요.\n먼저 대시보드 동기화를 실행해주세요.');
    return;
  }

  const pubValues = sh.getDataRange().getValues();
  if (pubValues.length < 2) {
    SpreadsheetApp.getUi().alert('❌ 데이터가 없어요.\n먼저 데이터를 등록하고 대시보드 동기화를 실행해주세요.');
    return;
  }

  const mappedSh  = ss.getSheetByName(SHEET_MAPPED);
  const nps요양Sh = ss.getSheetByName(SHEET_NPS_요양);
  const nps기관Sh = ss.getSheetByName(SHEET_NPS_기관);

  const mappedValues  = mappedSh  ? mappedSh.getDataRange().getValues()  : [];
  const nps요양Values = nps요양Sh ? nps요양Sh.getDataRange().getValues() : [];
  const nps기관Values = nps기관Sh ? nps기관Sh.getDataRange().getValues() : [];

  const json   = buildReportJson(pubValues, mappedValues, nps요양Values, nps기관Values);
  const result = pushFileToGitHub('dashboard/report.json', json);

  if (result.ok) {
    SpreadsheetApp.getUi().alert('✅ GitHub 업데이트 완료!\nreport.json이 업데이트됐어요.');
  } else {
    SpreadsheetApp.getUi().alert('❌ 오류 발생: ' + result.message);
  }
}

function pushFileToGitHub(filename, content) {
  var githubToken = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!githubToken) throw new Error('GITHUB_TOKEN 미설정 — Apps Script 속성에 토큰을 추가해주세요.');

  const apiUrl = `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`;

  let sha = null;
  try {
    const getRes = UrlFetchApp.fetch(apiUrl, {
      method: 'get',
      headers: { Authorization: `token ${githubToken}` },
      muteHttpExceptions: true
    });
    if (getRes.getResponseCode() === 200) {
      sha = JSON.parse(getRes.getContentText()).sha;
    }
  } catch(e) {}

  const now     = new Date();
  const dateStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  const body = {
    message: `VOC report update ${dateStr}`,
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    branch:  GITHUB_BRANCH
  };
  if (sha) body.sha = sha;

  try {
    const putRes = UrlFetchApp.fetch(apiUrl, {
      method: 'put',
      headers: {
        Authorization:  `token ${githubToken}`,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    });

    const code = putRes.getResponseCode();
    if (code === 200 || code === 201) return { ok: true };
    return { ok: false, message: `HTTP ${code}: ${putRes.getContentText()}` };
  } catch(e) {
    return { ok: false, message: e.message };
  }
}


// ============================================================
//  buildReportJson (확장판)
// ============================================================

function buildReportJson(pubValues, mappedValues, nps요양Values, nps기관Values) {

  // ── 1. 대시보드_공개용 헤더 인덱스
  const pubHeaders = pubValues[0].map(h => String(h).trim());
  const dateCol    = pubHeaders.indexOf('firstOpenedAt');
  const tagsCol    = pubHeaders.indexOf('tags');
  const mediumCol  = pubHeaders.indexOf('mediumType');
  const userIdCol  = pubHeaders.indexOf('userId');

  if (dateCol === -1 || tagsCol === -1) {
    throw new Error('openedAt 또는 tags 컬럼 없음');
  }

  // ── 2. 주차별 기본 집계
  const weekMap = {};

  pubValues.slice(1).forEach(row => {
    const rawDate = row[dateCol];
    const rawTags = String(row[tagsCol] || '').trim();
    if (!rawDate || !rawTags) return;

    const weekLabel = toWeekLabel(rawDate);
    if (!weekLabel) return;

    if (!weekMap[weekLabel]) weekMap[weekLabel] = { tags: {}, chat: 0, call: 0 };

    rawTags.split(',').forEach(tag => {
      const t = tag.trim();
      if (!t) return;
      weekMap[weekLabel].tags[t] = (weekMap[weekLabel].tags[t] || 0) + 1;
    });

    if (mediumCol >= 0) {
      const medium = String(row[mediumCol] || '').trim().toLowerCase();
      if (medium === 'phone') weekMap[weekLabel].call++;
      else                    weekMap[weekLabel].chat++;
    }
  });

  // ── 3. 재문의율 계산
  const allRows = pubValues.slice(1).map(row => ({
    date  : toDate(row[dateCol]),
    userId: userIdCol >= 0 ? String(row[userIdCol] || '').trim() : '',
    tags  : String(row[tagsCol] || '').trim()
  })).filter(r => r.date && !isNaN(r.date.getTime()) && r.userId && r.tags);

  function calcRecontactRate(weekLabel) {
    const [monStr, sunStr] = weekLabel.split('~');
    const year = new Date().getFullYear();
    function parseMMDD(str) {
      const [m, d] = str.split('/').map(Number);
      return new Date(year, m - 1, d);
    }
    const weekStart = parseMMDD(monStr);
    const weekEnd   = parseMMDD(sunStr);
    weekEnd.setHours(23, 59, 59);

    const weekRows = allRows.filter(r => r.date >= weekStart && r.date <= weekEnd);
    if (weekRows.length === 0) return null;

    const recontactUsers = new Set();
    const totalUsers     = new Set();

    weekRows.forEach(r => {
      if (!r.userId) return;
      totalUsers.add(r.userId);

      const rangeStart = new Date(r.date); rangeStart.setDate(rangeStart.getDate() - 14);
      const rangeEnd   = new Date(r.date); rangeEnd.setDate(rangeEnd.getDate() + 14);
      const rTags      = r.tags.split(',').map(t => t.trim());

      const hasRecontact = allRows.some(other => {
        if (other === r) return false;
        if (other.userId !== r.userId) return false;
        if (other.date < rangeStart || other.date > rangeEnd) return false;
        const otherTags = other.tags.split(',').map(t => t.trim());
        return rTags.some(t => otherTags.includes(t));
      });

      if (hasRecontact) recontactUsers.add(r.userId);
    });

    const rate = totalUsers.size > 0
      ? Math.round((recontactUsers.size / totalUsers.size) * 1000) / 10
      : null;

    return { rate, recontact: recontactUsers.size, total: totalUsers.size };
  }

  // ── 4. CSAT 주차별 평균 (매핑결과 시트)
  const csatWeekMap = {};

  if (mappedValues.length > 1) {
    const mHeaders    = mappedValues[0].map(h => String(h).trim());
    const mDateCol    = mHeaders.indexOf('상담일시');
    const mCsatCol    = mHeaders.indexOf('만족도');
    const mCommentCol = mHeaders.indexOf('자유의견');

    if (mDateCol >= 0 && mCsatCol >= 0) {
      mappedValues.slice(1).forEach(row => {
        const rawDate = row[mDateCol];
        if (!rawDate) return;

        const weekLabel = toWeekLabel(rawDate);
        if (!weekLabel) return;

        const csatVal = parseFloat(row[mCsatCol]);
        if (isNaN(csatVal) || csatVal < 1 || csatVal > 5) return;

        if (!csatWeekMap[weekLabel]) csatWeekMap[weekLabel] = { sum: 0, count: 0, comments: [] };
        csatWeekMap[weekLabel].sum   += csatVal;
        csatWeekMap[weekLabel].count += 1;

        if (mCommentCol >= 0) {
          const comment = String(row[mCommentCol] || '').trim();
          if (comment) csatWeekMap[weekLabel].comments.push(comment);
        }
      });
    }
  }

  // ── 5. NPS 주차별 집계 — 요양 / 기관 분리 (헤더: created_at, score)
  const npsWeekMap요양 = {};
  const npsWeekMap기관 = {};

  function processNpsSheet(npsValues, targetMap) {
    if (!npsValues || npsValues.length < 2) return;
    const nHead     = npsValues[0].map(h => String(h).trim());
    const nDateCol  = nHead.indexOf('created_at');
    const nScoreCol = nHead.indexOf('score');

    if (nDateCol < 0 || nScoreCol < 0) {
      Logger.log('⚠️ NPS 시트 헤더 인식 실패 (created_at, score 컬럼 필요): ' + nHead.join(', '));
      return;
    }

    npsValues.slice(1).forEach(row => {
      const rawDate = row[nDateCol];
      if (!rawDate) return;
      const weekLabel = toWeekLabel(rawDate);
      if (!weekLabel) return;

      const score = parseFloat(row[nScoreCol]);
      if (isNaN(score)) return;

      if (!targetMap[weekLabel]) targetMap[weekLabel] = { promoter: 0, passive: 0, detractor: 0 };

      if      (score >= 9) targetMap[weekLabel].promoter++;
      else if (score >= 7) targetMap[weekLabel].passive++;
      else                 targetMap[weekLabel].detractor++;
    });
  }

  processNpsSheet(nps요양Values, npsWeekMap요양);
  processNpsSheet(nps기관Values, npsWeekMap기관);

  // NPS 점수 계산 헬퍼
  function calcNps(data) {
    if (!data) return { nps: null, promoter: null, passive: null, detractor: null, total: null };
    const total = data.promoter + data.passive + data.detractor;
    return {
      nps      : total > 0 ? Math.round(((data.promoter - data.detractor) / total) * 100) : null,
      promoter : data.promoter,
      passive  : data.passive,
      detractor: data.detractor,
      total
    };
  }

  // ── 6. 주차 정렬 및 최종 JSON 조립
  const sortedWeeks = Object.keys(weekMap).sort((a, b) => {
    const toNum = s => {
      const [m, d] = s.split('~')[0].split('/').map(Number);
      return m * 100 + d;
    };
    return toNum(b) - toNum(a);
  });

  const result = sortedWeeks.map(week => {
    const base     = weekMap[week];
    const totalVoc = base.chat + base.call;

    const csatData = csatWeekMap[week];
    const csatAvg  = csatData && csatData.count > 0
      ? Math.round((csatData.sum / csatData.count) * 10) / 10
      : null;
    const topVoc = csatData ? csatData.comments.slice(0, 5) : [];

    const nps요양 = calcNps(npsWeekMap요양[week]);
    const nps기관 = calcNps(npsWeekMap기관[week]);

    const recontact = calcRecontactRate(week);

    return {
      week,
      total_voc           : totalVoc || null,
      chat                : base.chat || null,
      call                : base.call || null,
      recontact_rate      : recontact ? recontact.rate      : null,
      recontact_count     : recontact ? recontact.recontact : null,
      recontact_total     : recontact ? recontact.total     : null,
      csat_avg            : csatAvg,
      csat_count          : csatData ? csatData.count : null,
      nps_요양            : nps요양.nps,
      nps_요양_promoter   : nps요양.promoter,
      nps_요양_passive    : nps요양.passive,
      nps_요양_detractor  : nps요양.detractor,
      nps_요양_total      : nps요양.total,
      nps_기관            : nps기관.nps,
      nps_기관_promoter   : nps기관.promoter,
      nps_기관_passive    : nps기관.passive,
      nps_기관_detractor  : nps기관.detractor,
      nps_기관_total      : nps기관.total,
      top_voc             : topVoc,
      tags                : base.tags
    };
  });

  return JSON.stringify({ weeks: result }, null, 2);
}


// ============================================================
//  날짜 파싱 헬퍼
//  - Date 객체: 그대로 반환
//  - "2026. 3. 11" 형태: 직접 파싱 (구글 시트 한국어 날짜 표시)
//  - ISO 문자열 등 기타: new Date()로 파싱
// ============================================================

function toDate(val) {
  if (!val) return null;
  if (val instanceof Date) return val;

  const str = String(val).trim();

  // "2026. 3. 11" 또는 "2026. 3. 11 오전 10:30:00" 형태
  const koMatch = str.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
  if (koMatch) {
    const [, y, m, d] = koMatch.map(Number);
    return new Date(y, m - 1, d);
  }

  // 그 외 (ISO, etc.)
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}


// ============================================================
//  날짜 → 주차 레이블 변환 (월요일 기준)
// ============================================================

function toWeekLabel(dateVal) {
  try {
    const d = toDate(dateVal);
    if (!d || isNaN(d.getTime())) return null;
    const day     = d.getDay();
    const diffMon = (day === 0) ? -6 : 1 - day;
    const mon     = new Date(d); mon.setDate(d.getDate() + diffMon);
    const sun     = new Date(mon); sun.setDate(mon.getDate() + 6);
    const fmt     = dt => `${String(dt.getMonth()+1).padStart(2,'0')}/${String(dt.getDate()).padStart(2,'0')}`;
    return `${fmt(mon)}~${fmt(sun)}`;
  } catch(e) {
    return null;
  }
}


// ============================================================
//  당일 응대율 집계
// ============================================================

function calcDailyResponseData_(ss) {
  var rawSh = ss.getSheetByName(SHEET_RAW);
  if (!rawSh) return { weeks: [] };

  var rawData = rawSh.getDataRange().getValues();
  if (rawData.length < 2) return { weeks: [] };

  var headers        = rawData[0].map(function(h) { return String(h).trim(); });
  var iFirstOpened   = headers.indexOf('firstOpenedAt');
  var iOpenedAt      = headers.indexOf('openedAt');
  var iFirstAnswered = headers.indexOf('firstAnsweredAt');
  var iRepliedAt     = headers.indexOf('repliedAt');
  var iState         = headers.indexOf('state');
  var iTags          = headers.indexOf('tags');

  function sameDay(a, b) {
    if (!a || !b) return false;
    var da = toDate(a), db = toDate(b);
    if (!da || !db || isNaN(da) || isNaN(db)) return false;
    return da.getFullYear() === db.getFullYear() &&
           da.getMonth()    === db.getMonth()    &&
           da.getDate()     === db.getDate();
  }

  function dateKey(val) {
    var d = toDate(val);
    if (!d || isNaN(d)) return null;
    return d.getFullYear() + '-' +
           String(d.getMonth()+1).padStart(2,'0') + '-' +
           String(d.getDate()).padStart(2,'0');
  }

  function isBusinessHours(d) {
    if (!d || isNaN(d)) return false;
    var day = d.getDay();
    if (day === 0 || day === 6) return false;
    if (d.getHours() >= 17) return false;
    return true;
  }

  var dayMap = {};

  rawData.slice(1).forEach(function(row) {
    var firstOpenedAt   = iFirstOpened   >= 0 ? row[iFirstOpened]   : '';
    var openedAt        = iOpenedAt      >= 0 ? row[iOpenedAt]      : '';
    var firstAnsweredAt = iFirstAnswered >= 0 ? row[iFirstAnswered] : '';
    var repliedAt       = iRepliedAt     >= 0 ? row[iRepliedAt]     : '';
    var state           = iState         >= 0 ? String(row[iState] || '').trim().toLowerCase() : '';
    var tags            = iTags          >= 0 ? String(row[iTags]  || '').trim() : '';
    var tagList         = tags.split(',').map(function(t) { return t.trim(); }).filter(Boolean);

    if (state === 'missed') return;
    if (tagList.length === 1 && tagList[0] === '운영시간외전화인입') return;

    var hasReplied  = repliedAt && String(repliedAt).trim() !== '';
    var inquiryVal  = hasReplied ? openedAt  : firstOpenedAt;
    var responseVal = hasReplied ? repliedAt : firstAnsweredAt;
    var inquiryD    = toDate(inquiryVal);

    if (!isBusinessHours(inquiryD)) return;

    var key = dateKey(inquiryVal);
    if (!key) return;

    if (!dayMap[key]) dayMap[key] = { total: 0, responded: 0, missed: 0 };
    dayMap[key].total++;
    if (sameDay(inquiryVal, responseVal)) dayMap[key].responded++;
  });

  var weekMap = {};
  Object.keys(dayMap).forEach(function(key) {
    var week = toWeekLabel(new Date(key));
    if (!week) return;
    if (!weekMap[week]) weekMap[week] = {};
    weekMap[week][key] = dayMap[key];
  });

  var sortedWeeks = Object.keys(weekMap).sort(function(a, b) {
    var toNum = function(s) { var p = s.split('~')[0].split('/').map(Number); return p[0] * 100 + p[1]; };
    return toNum(b) - toNum(a);
  });

  var weeks = sortedWeeks.map(function(week) {
    var daysObj    = weekMap[week];
    var sortedDays = Object.keys(daysObj).sort();
    var wTotal = 0, wResponded = 0, wMissed = 0;

    var days = sortedDays.map(function(key) {
      var d = daysObj[key];
      wTotal     += d.total;
      wResponded += d.responded;
      wMissed    += d.missed;

      var dt        = new Date(key);
      var label     = String(dt.getMonth()+1).padStart(2,'0') + '/' + String(dt.getDate()).padStart(2,'0');
      var rate      = d.total > 0 ? Math.round(d.responded / d.total * 1000) / 10 : null;
      var exclTotal = d.total - d.missed;
      var rateExcl  = exclTotal > 0 ? Math.round(d.responded / exclTotal * 1000) / 10 : null;

      return { date: label, total: d.total, responded: d.responded, missed: d.missed,
               rate: rate, total_excl: exclTotal, rate_excl: rateExcl };
    });

    var rate      = wTotal > 0 ? Math.round(wResponded / wTotal * 1000) / 10 : null;
    var exclTotal = wTotal - wMissed;
    var rateExcl  = exclTotal > 0 ? Math.round(wResponded / exclTotal * 1000) / 10 : null;

    return { week: week, total: wTotal, responded: wResponded, missed: wMissed,
             rate: rate, total_excl: exclTotal, rate_excl: rateExcl, days: days };
  });

  return { weeks: weeks };
}

function getDailyResponseData(ss) {
  return ContentService
    .createTextOutput(JSON.stringify(calcDailyResponseData_(ss)))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
//  태그 분류 (Categorizer)
//  분류 규칙의 SSOT — 이 섹션만 수정하면 전체에 반영됩니다.
// ============================================================

var MAIN_CATEGORIES_ = ['아카데미', '기관', '요양', '일반'];

function categorize(tag) {
  var effective = tag.indexOf('/') !== -1 ? tag.substring(tag.indexOf('/') + 1) : tag;

  if (tag.indexOf('오류') !== -1 || effective.indexOf('오류') !== -1) return '오류';
  if (effective.indexOf('아카데미_') === 0) return '아카데미';
  if (effective.indexOf('기관_') === 0)     return '기관';
  if (effective.indexOf('요_') === 0)       return '요양';
  if (effective.indexOf('일반_') === 0)     return '일반';
  return '기타';
}

function detectAnomalies(thisWeekTags, lastWeekTags) {
  var result = { error: [], surge: [], drop: [], newTag: [] };

  for (var tag in thisWeekTags) {
    var curr = thisWeekTags[tag] || 0;
    var prev = lastWeekTags[tag] || 0;
    var cat  = categorize(tag);

    if (cat === '기타') continue;

    if (cat === '오류') {
      result.error.push({ tag: tag, count: curr });
      continue;
    }

    if (MAIN_CATEGORIES_.indexOf(cat) === -1) continue;

    if (prev === 0 && curr > 0) {
      result.newTag.push({ tag: tag, count: curr });
    } else if (prev > 0) {
      var changeRate = (curr - prev) / prev;
      var changeAbs  = curr - prev;

      if (changeRate >= 0.3 && changeAbs >= 3) {
        result.surge.push({ tag: tag, curr: curr, prev: prev, rate: Math.round(changeRate * 100) });
      } else if (changeRate <= -0.3 && Math.abs(changeAbs) >= 3) {
        result.drop.push({ tag: tag, curr: curr, prev: prev, rate: Math.round(changeRate * 100) });
      }
    }
  }

  result.surge.sort(function(a, b) { return b.rate - a.rate; });
  result.drop.sort(function(a, b) { return a.rate - b.rate; });

  return result;
}


// ============================================================
//  VOC 주간 리포트 — 버튼 1번으로 Notion 페이지 생성
//  메뉴 "📝 VOC 주간 리포트 생성" 클릭 → 기존 시트에서 자동 계산
// ============================================================

function generateWeeklyReport() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  try {
    Logger.log('[1/4] 데이터 읽기 시작');
    var okr        = readOkrTargets_(ss);
    var config     = readConfig_(ss);
    var reportData = readReportJson_();

    if (!reportData || !reportData.weeks || reportData.weeks.length < 2) {
      SpreadsheetApp.getUi().alert(
        '❌ 데이터가 부족해요.\n' +
        '대시보드 동기화를 먼저 실행한 뒤 다시 시도해주세요.\n' +
        '(최소 2주치 데이터가 필요합니다)'
      );
      return;
    }

    var weekLabel = getLatestWeekFromMapped_(ss) || reportData.weeks[0].week;
    var csatData  = readCsatFromSheet_(ss, weekLabel);
    var dailyRate = readDailyResponseFromSheet_(ss, weekLabel);
    Logger.log('[1/4] 완료 — 주차: ' + weekLabel);
    Logger.log('[2/4] CSAT 채팅 ' + csatData.chatAvg + '점(' + csatData.chatCount + '건) / 전화 ' + csatData.phoneAvg + '점(' + csatData.phoneCount + '건) / 당일응대율 ' + dailyRate + '%');

    var inputs = {
      week              : weekLabel,
      chatAvg           : csatData.chatAvg,
      chatCount         : csatData.chatCount,
      chat1             : csatData.chat1,
      chat2             : csatData.chat2,
      chat3             : csatData.chat3,
      chat4             : csatData.chat4,
      chat5             : csatData.chat5,
      phoneAvg          : csatData.phoneAvg,
      phoneCount        : csatData.phoneCount,
      phone1            : csatData.phone1,
      phone2            : csatData.phone2,
      phone3            : csatData.phone3,
      phone4            : csatData.phone4,
      phone5            : csatData.phone5,
      dailyResponseRate : dailyRate,
    };

    Logger.log('[3/4] 리포트 블록 빌드');
    var blocks = buildReportBlocks_(inputs, okr, reportData, config);

    Logger.log('[4/4] Notion 업로드');
    var title = buildTitle_();
    var url   = uploadToNotion_(title, blocks, config);

    Logger.log('✅ 완료: ' + url);
    SpreadsheetApp.getUi().alert('✅ VOC 주간 리포트 생성 완료!\n\nNotion URL:\n' + url);

  } catch (e) {
    SpreadsheetApp.getUi().alert(
      '❌ 오류가 발생했어요.\nApps Script 로그(실행 > 로그 보기)를 확인해주세요.\n\n' + e.message
    );
    Logger.log('❌ 상세 오류: ' + e.stack);
  }
}

// 매핑결과 시트에서 지정 주차의 CSAT 자동 계산 (채팅/전화 분리)
function readCsatFromSheet_(ss, weekLabel) {
  var result = {
    chatAvg: 0, chatCount: 0, chat1: 0, chat2: 0, chat3: 0, chat4: 0, chat5: 0,
    phoneAvg: 0, phoneCount: 0, phone1: 0, phone2: 0, phone3: 0, phone4: 0, phone5: 0,
  };

  var mappedSh = ss.getSheetByName(SHEET_MAPPED);
  if (!mappedSh) { Logger.log('⚠️ 매핑결과 시트 없음'); return result; }

  var data = mappedSh.getDataRange().getValues();
  if (data.length < 2) return result;

  var headers    = data[0].map(function(h) { return String(h).trim(); });
  var dateCol    = headers.indexOf('week');
  var csatCol    = headers.indexOf('만족도');
  var channelCol = headers.indexOf('mediumType');

  if (dateCol < 0 || csatCol < 0) {
    Logger.log('⚠️ 매핑결과 헤더 인식 실패 (week, 만족도 컬럼 필요) — 실제 헤더: ' + headers.join(', '));
    return result;
  }

  var chatSum = 0, chatCount = 0;
  var phoneSum = 0, phoneCount = 0;
  var chatDist  = [0, 0, 0, 0, 0];
  var phoneDist = [0, 0, 0, 0, 0];

  data.slice(1).forEach(function(row) {
    if (toWeekLabel(row[dateCol]) !== weekLabel) return;

    var score = parseFloat(row[csatCol]);
    if (isNaN(score) || score < 1 || score > 5) return;

    var channel = channelCol >= 0 ? String(row[channelCol] || '').trim().toLowerCase() : '';
    var bucket  = Math.round(score) - 1;

    if (channel === 'phone') {
      phoneSum += score; phoneCount++; phoneDist[bucket]++;
    } else {
      chatSum  += score; chatCount++;  chatDist[bucket]++;
    }
  });

  result.chatAvg   = chatCount  > 0 ? Math.round(chatSum  / chatCount  * 10) / 10 : 0;
  result.chatCount = chatCount;
  result.phoneAvg   = phoneCount > 0 ? Math.round(phoneSum / phoneCount * 10) / 10 : 0;
  result.phoneCount = phoneCount;
  result.chat1  = chatDist[0];  result.chat2  = chatDist[1];  result.chat3  = chatDist[2];
  result.chat4  = chatDist[3];  result.chat5  = chatDist[4];
  result.phone1 = phoneDist[0]; result.phone2 = phoneDist[1]; result.phone3 = phoneDist[2];
  result.phone4 = phoneDist[3]; result.phone5 = phoneDist[4];

  Logger.log('[CSAT] ' + weekLabel + ' — 채팅 ' + chatCount + '건(' + result.chatAvg + '점) / 전화 ' + phoneCount + '건(' + result.phoneAvg + '점)');
  return result;
}

// 상담데이터 시트에서 지정 주차의 당일응대율(%) 반환
function readDailyResponseFromSheet_(ss, weekLabel) {
  var data  = calcDailyResponseData_(ss);
  var weeks = data.weeks || [];
  for (var i = 0; i < weeks.length; i++) {
    if (weeks[i].week === weekLabel) {
      var w = weeks[i];
      var rate = (w.rate_excl !== null && w.rate_excl !== undefined) ? w.rate_excl : (w.rate || 0);
      Logger.log('[당일응대율] ' + weekLabel + ' — ' + rate + '%');
      return rate;
    }
  }
  Logger.log('[당일응대율] ' + weekLabel + ' — 해당 주차 없음 (0%)');
  return 0;
}

// 매핑결과 시트에서 가장 최신 주차 레이블 반환
function getLatestWeekFromMapped_(ss) {
  var sh = ss.getSheetByName(SHEET_MAPPED);
  if (!sh) return null;
  var data = sh.getDataRange().getValues();
  if (data.length < 2) return null;
  var headers = data[0].map(function(h) { return String(h).trim(); });
  var dateCol = headers.indexOf('week');
  if (dateCol < 0) return null;

  var latestDate = null;
  data.slice(1).forEach(function(row) {
    var d = toDate(row[dateCol]);
    if (!d || isNaN(d.getTime())) return;
    if (!latestDate || d > latestDate) latestDate = d;
  });

  var label = latestDate ? toWeekLabel(latestDate) : null;
  Logger.log('[주차 결정] 매핑결과 최신 주차: ' + label);
  return label;
}

function readOkrTargets_(ss) {
  var s = ss.getSheetByName('OKR목표');
  return {
    csatTarget          : Number(s.getRange('B2').getValue()) || 4.2,
    recontactTarget     : Number(s.getRange('B3').getValue()) || 3.5,
    dailyResponseTarget : Number(s.getRange('B4').getValue()) || 96,
  };
}

function readConfig_(ss) {
  var s = ss.getSheetByName('설정');
  return {
    notionPageId   : String(s.getRange('B1').getValue()).trim(),
    insightEnabled : String(s.getRange('B3').getValue()).toUpperCase() === 'TRUE',
  };
}

function readReportJson_() {
  var ss        = SpreadsheetApp.getActiveSpreadsheet();
  var pubSh     = ss.getSheetByName(SHEET_PUBLIC);
  var mappedSh  = ss.getSheetByName(SHEET_MAPPED);
  var nps요양Sh = ss.getSheetByName(SHEET_NPS_요양);
  var nps기관Sh = ss.getSheetByName(SHEET_NPS_기관);

  var pubValues     = pubSh     ? pubSh.getDataRange().getValues()     : [[]];
  var mappedValues  = mappedSh  ? mappedSh.getDataRange().getValues()  : [[]];
  var nps요양Values = nps요양Sh ? nps요양Sh.getDataRange().getValues() : [[]];
  var nps기관Values = nps기관Sh ? nps기관Sh.getDataRange().getValues() : [[]];

  return JSON.parse(buildReportJson(pubValues, mappedValues, nps요양Values, nps기관Values));
}


function buildReportBlocks_(inputs, okr, reportData, config) {
  var blocks   = [];
  var thisWeek = reportData.weeks[0];
  var lastWeek = reportData.weeks[1];

  // ── 데이터 기간 표시
  blocks.push(paragraph_('📅 데이터 기간: ' + inputs.week + ' (이번 주) / ' + lastWeek.week + ' (지난 주)'));

  // ── OKR 지표
  blocks.push(heading2_('📊 OKR 지표'));

  var totalCsatCount = (inputs.chatCount || 0) + (inputs.phoneCount || 0);
  var combinedCsat   = totalCsatCount > 0
    ? (((inputs.chatAvg * (inputs.chatCount || 0)) + (inputs.phoneAvg * (inputs.phoneCount || 0))) / totalCsatCount).toFixed(2)
    : '0.00';
  var recontact     = thisWeek.recontact_rate || 0;
  var prevRecontact = lastWeek.recontact_rate || 0;
  var totalVoc      = thisWeek.total_voc      || 0;
  var prevTotalVoc  = lastWeek.total_voc      || 0;
  var vocChangePct  = prevTotalVoc > 0
    ? (((totalVoc - prevTotalVoc) / prevTotalVoc) * 100).toFixed(1)
    : '0.0';
  var vocSign = Number(vocChangePct) >= 0 ? '+' : '';

  blocks.push(tableBlock_(
    ['지표', '실적 / 목표', '전주'],
    [
      ['상담만족도',   combinedCsat + '점 / ' + okr.csatTarget + '점',                   '-'],
      ['재문의율',     recontact + '% / ' + okr.recontactTarget + '%',                   prevRecontact + '%'],
      ['당일응대율',   inputs.dailyResponseRate + '% / ' + okr.dailyResponseTarget + '%', '-'],
      ['처리건수',     totalVoc + '건',   prevTotalVoc + '건 (' + vocSign + vocChangePct + '%)'],
    ]
  ));

  // ── CSAT 상세
  blocks.push(heading2_('💬 CSAT 상세'));
  blocks.push(paragraph_('채팅 CSAT — 평균 ' + inputs.chatAvg + '점'));
  blocks.push(paragraph_('점수 분포: ' + formatDist_(inputs, 'chat')));
  blocks.push(paragraph_('전화 CSAT — 평균 ' + inputs.phoneAvg + '점'));
  blocks.push(paragraph_('점수 분포: ' + formatDist_(inputs, 'phone')));

  // ── 카테고리별 현황
  blocks.push(heading2_('🏷️ 카테고리별 현황'));
  var catSummary = buildCategorySummary_(thisWeek.tags, lastWeek.tags);
  blocks.push(tableBlock_(
    ['카테고리', '이번 주', '지난 주', '증감'],
    catSummary.map(function(r) {
      var sign = r.change >= 0 ? '+' : '';
      return [r.category, r.curr + '건', r.prev + '건', sign + r.change];
    })
  ));

  // ── TOP 5 태그
  blocks.push(heading2_('🔝 TOP 5 태그 (이번 주)'));
  ['아카데미', '기관', '요양'].forEach(function(cat) {
    var top5 = getTop5_(thisWeek.tags, cat);
    if (top5.length === 0) return;
    blocks.push(heading3_('▶ ' + cat));
    blocks.push(tableBlock_(
      ['순위', '태그', '건수'],
      top5.map(function(item, i) { return [i + 1, item.tag, item.count + '건']; })
    ));
  });

  // ── 이상 태그 알림
  blocks.push(heading2_('⚠️ 이상 태그 알림'));
  var anomalies = detectAnomalies(thisWeek.tags, lastWeek.tags);

  concatInto_(blocks, bulletSection_('🔴 오류 태그',
    anomalies.error.map(function(x) { return x.tag + ' (' + x.count + '건)'; })));

  concatInto_(blocks, bulletSection_('🟠 급증 태그 (전주 대비 +30% 이상, 3건 이상)',
    anomalies.surge.map(function(x) { return x.tag + ': ' + x.prev + '→' + x.curr + '건 (+' + x.rate + '%)'; })));

  concatInto_(blocks, bulletSection_('🔵 급감 태그 (전주 대비 -30% 이상, 3건 이상)',
    anomalies.drop.map(function(x) { return x.tag + ': ' + x.prev + '→' + x.curr + '건 (' + x.rate + '%)'; })));

  concatInto_(blocks, bulletSection_('🟡 신규 태그 (전주 미존재)',
    anomalies.newTag.map(function(x) { return x.tag + ' (' + x.count + '건)'; })));

  // ── 한 줄 인사이트 (설정 시트 B3=TRUE 일 때만)
  if (config.insightEnabled) {
    blocks.push(heading2_('💡 한 줄 인사이트'));
    blocks.push(paragraph_(buildInsight_(catSummary, anomalies)));
  }

  return blocks;
}

function buildCategorySummary_(thisTags, lastTags) {
  return ['아카데미', '기관', '요양', '일반', '오류'].map(function(cat) {
    var curr = sumByCategory_(thisTags, cat);
    var prev = sumByCategory_(lastTags, cat);
    return { category: cat, curr: curr, prev: prev, change: curr - prev };
  });
}

function sumByCategory_(tags, cat) {
  var total = 0;
  for (var tag in tags) { if (categorize(tag) === cat) total += (tags[tag] || 0); }
  return total;
}

function getTop5_(tags, category) {
  var items = [];
  for (var tag in tags) {
    if (categorize(tag) === category) items.push({ tag: tag, count: tags[tag] || 0 });
  }
  items.sort(function(a, b) { return b.count - a.count; });
  return items.slice(0, 5);
}

function formatDist_(inputs, prefix) {
  var parts = [];
  [1, 2, 3, 4, 5].forEach(function(n) {
    var count = inputs[prefix + n];
    if (count > 0) parts.push(n + '점 ' + count + '건');
  });
  return parts.length > 0 ? parts.join(' / ') : '(입력 없음)';
}

function buildInsight_(catSummary, anomalies) {
  var max = catSummary.reduce(function(a, b) {
    return Math.abs(b.change) > Math.abs(a.change) ? b : a;
  }, catSummary[0]);

  var text = max.category + ' 카테고리가 전주 대비 ' + Math.abs(max.change) + '건 ' + (max.change >= 0 ? '증가' : '감소');
  if (anomalies.surge.length > 0)       text += '; 급증 태그: ' + anomalies.surge[0].tag;
  else if (anomalies.error.length > 0)  text += '; 오류 태그 발생: ' + anomalies.error[0].tag;
  return text + '.';
}

function uploadToNotion_(title, blocks, config) {
  var token = PropertiesService.getScriptProperties().getProperty('NOTION_TOKEN');
  if (!token) throw new Error('NOTION_TOKEN 미설정 — Apps Script 속성에 토큰을 추가해주세요.');
  if (!config.notionPageId) throw new Error('설정 시트 B1(NOTION_PAGE_ID)이 비어있어요.');

  var payload = JSON.stringify({
    parent    : { page_id: config.notionPageId },
    properties: { title: { title: [{ text: { content: title } }] } },
    children  : blocks,
  });

  var resp = UrlFetchApp.fetch('https://api.notion.com/v1/pages', {
    method            : 'post',
    contentType       : 'application/json',
    headers           : {
      'Authorization' : 'Bearer ' + token,
      'Notion-Version': '2022-06-28',
    },
    payload           : payload,
    muteHttpExceptions: true,
  });

  var code = resp.getResponseCode();
  var body = JSON.parse(resp.getContentText());

  if (code < 200 || code >= 300) {
    var errSummary = (body.message || body.code || resp.getContentText()).substring(0, 120);
    throw new Error(code + ' ' + errSummary);
  }

  return body.url || ('https://notion.so/' + body.id.replace(/-/g, ''));
}

function buildTitle_() {
  var tz  = 'Asia/Seoul';
  var now = new Date();
  return Utilities.formatDate(now, tz, 'yy') + '년 '
       + Utilities.formatDate(now, tz, 'M') + '월 '
       + Utilities.formatDate(now, tz, 'd') + '일 VOC 리포트';
}

function verifyAgainstVocReport_() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var reportData  = readReportJson_();
  var thisWeek    = reportData.weeks[0];
  var lastWeek    = reportData.weeks[1];

  var catSummary = buildCategorySummary_(thisWeek.tags, lastWeek.tags);
  var anomalies  = detectAnomalies(thisWeek.tags, lastWeek.tags);
  var diffs      = [];

  Logger.log('=== V6 검증 결과 (' + (thisWeek.week || '') + ') ===');
  Logger.log('카테고리 | 이번주 | 지난주 | 증감');
  catSummary.forEach(function(row) {
    var sign = row.change >= 0 ? '+' : '';
    Logger.log(row.category + ' | ' + row.curr + '건 | ' + row.prev + '건 | ' + sign + row.change);
    if (row.curr === 0 && row.category !== '오류') {
      diffs.push(row.category + '=0건(확인필요)');
    }
  });

  Logger.log('');
  Logger.log('이상 태그 요약:');
  Logger.log('  오류: ' + anomalies.error.length + '건 — ' + anomalies.error.map(function(x){ return x.tag; }).join(', '));
  Logger.log('  급증: ' + anomalies.surge.length + '건 — ' + anomalies.surge.map(function(x){ return x.tag; }).join(', '));
  Logger.log('  급감: ' + anomalies.drop.length + '건 — ' + anomalies.drop.map(function(x){ return x.tag; }).join(', '));
  Logger.log('  신규: ' + anomalies.newTag.length + '건 — ' + anomalies.newTag.map(function(x){ return x.tag; }).join(', '));

  var summary = diffs.length === 0
    ? 'OK — ' + new Date().toLocaleString()
    : '불일치 ' + diffs.length + '건: ' + diffs.join(', ');

  ss.getSheetByName('설정').getRange('B4').setValue(summary);
  Logger.log('검증결과 기록: ' + summary);
}

// ── Notion 블록 헬퍼

function heading2_(text) {
  return { object: 'block', type: 'heading_2', heading_2: { rich_text: [rt_(text)] } };
}

function heading3_(text) {
  return { object: 'block', type: 'heading_3', heading_3: { rich_text: [rt_(text)] } };
}

function paragraph_(text) {
  return { object: 'block', type: 'paragraph', paragraph: { rich_text: [rt_(text)] } };
}

function bullet_(text) {
  return { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [rt_(text)] } };
}

function bulletSection_(heading, items) {
  var blocks = [heading3_(heading)];
  (items.length > 0 ? items : ['없음']).forEach(function(item) {
    blocks.push(bullet_(item));
  });
  return blocks;
}

function tableBlock_(headers, rows) {
  var allRows  = [headers].concat(rows);
  var safeRows = allRows.slice(0, 90);

  return {
    object: 'block',
    type  : 'table',
    table : {
      table_width      : headers.length,
      has_column_header: true,
      has_row_header   : false,
      children         : safeRows.map(function(row) {
        return {
          object    : 'block',
          type      : 'table_row',
          table_row : { cells: row.map(function(cell) { return [rt_(String(cell))]; }) },
        };
      }),
    },
  };
}

function rt_(text) {
  return { type: 'text', text: { content: String(text) } };
}

function concatInto_(target, source) {
  source.forEach(function(item) { target.push(item); });
}
