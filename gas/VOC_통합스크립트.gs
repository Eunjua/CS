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
//    - 메뉴 → 📝 VOC 주간 리포트 생성 클릭 → 팝업에서 주차 입력
//      · 비우고 확인 = 가장 최신 주차 / "05/25" 입력 = 그 주차로 생성
//      · CSAT·당일응대율·태그 모두 선택한 주차 기준으로 자동 계산 (채팅/전화 분리)
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
    .addSeparator()
    .addItem('🔍 CSAT 집계 진단', 'diagnoseCsat_')
    .addToUi();
}


// ============================================================
//  SCRIPT 1: CSAT 매핑
// ============================================================

// 설문 시트에서 상담 id 컬럼 찾기 (폼 질문 제목이 'id' 또는 '제목 없는 질문'일 수 있음)
function findFormIdCol_(fHead) {
  var candidates = ['id', '제목 없는 질문'];
  for (var i = 0; i < candidates.length; i++) {
    var idx = fHead.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

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
    id        : findFormIdCol_(fHead),
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
    const mDateCol    = mHeaders.indexOf('week');
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

    var ui = SpreadsheetApp.getUi();

    // ── 주차 선택 팝업 (비우면 가장 최신 주차)
    var resp = ui.prompt(
      'VOC 주간 리포트',
      '어느 주차를 만들까요?\n예: 05/25  (비우면 가장 최신 주차로 생성)',
      ui.ButtonSet.OK_CANCEL
    );
    if (resp.getSelectedButton() !== ui.Button.OK) {
      Logger.log('사용자 취소');
      return;
    }
    var rawWeek = String(resp.getResponseText() || '').trim();

    // ── 주차 라벨 결정
    var weekLabel;
    if (!rawWeek) {
      weekLabel = getLatestWeekFromMapped_(ss) || reportData.weeks[0].week;
    } else {
      weekLabel = resolveWeekLabel_(rawWeek);
      if (!weekLabel) {
        ui.alert('❓ "' + rawWeek + '" 주차를 알아듣지 못했어요.\n예: 05/25 또는 05/25~05/31 형식으로 입력해주세요.');
        return;
      }
    }

    // ── report.json에서 선택 주차 위치 찾기 (그 주 = 이번 주, 바로 앞 주 = 전주)
    var weekIdx = -1;
    for (var wi = 0; wi < reportData.weeks.length; wi++) {
      if (reportData.weeks[wi].week === weekLabel) { weekIdx = wi; break; }
    }
    if (weekIdx < 0) {
      ui.alert(
        '❌ "' + weekLabel + '" 주차 데이터가 없어요.\n\n가능한 주차:\n' +
        reportData.weeks.map(function(w) { return '· ' + w.week; }).join('\n')
      );
      return;
    }
    if (weekIdx + 1 >= reportData.weeks.length) {
      ui.alert('❌ "' + weekLabel + '"의 전주 데이터가 없어 비교 리포트를 만들 수 없어요.\n한 주 뒤 주차를 선택해주세요.');
      return;
    }

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
      tagCsat           : csatData.tagCsat || [],      // CSAT 원인 분석용
      lowComments       : csatData.lowComments || [],
      subQuestions      : csatData.subQuestions || [],
    };

    Logger.log('[3/4] 리포트 블록 빌드');
    var blocks = buildReportBlocks_(inputs, okr, reportData, config, weekIdx);

    Logger.log('[4/4] Notion 업로드');
    var title = buildTitle_(weekLabel);
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

// 🔍 CSAT 집계 진단 — 매핑결과 시트가 제대로 읽히는지 한눈에 확인
function diagnoseCsat_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();
  var sh = ss.getSheetByName(SHEET_MAPPED);
  if (!sh) { ui.alert('❌ 매핑결과 시트를 찾을 수 없어요.'); return; }

  var data = sh.getDataRange().getValues();
  if (data.length < 2) { ui.alert('❌ 매핑결과 시트에 데이터가 없어요.'); return; }

  var headers = data[0].map(function(h) { return String(h).trim(); });
  var dateCol = headers.indexOf('week');
  var csatCol = headers.indexOf('만족도');
  var chCol   = headers.indexOf('mediumType');

  if (dateCol < 0 || csatCol < 0) {
    ui.alert('❌ 컬럼을 못 찾았어요.\n필요: week, 만족도\n실제 헤더: ' + headers.join(', '));
    return;
  }

  var total = data.length - 1;
  var parseFail = 0;       // 날짜 변환 실패 행
  var csatInvalid = 0;     // 만족도가 1~5 숫자가 아닌 행
  var weekCount = {};      // 주차별 (만족도 유효) 응답 수
  var samples = [];        // 처음 3개 원본→주차 변환 샘플

  for (var i = 1; i < data.length; i++) {
    var raw  = data[i][dateCol];
    var wl   = toWeekLabel(raw);
    var sc   = parseFloat(data[i][csatCol]);
    var okSc = !isNaN(sc) && sc >= 1 && sc <= 5;

    if (i <= 3) samples.push('· "' + raw + '" → ' + (wl || '(변환실패)'));
    if (!wl) parseFail++;
    if (!okSc) csatInvalid++;
    if (wl && okSc) weekCount[wl] = (weekCount[wl] || 0) + 1;
  }

  var lastVals = data[data.length - 1].map(function(v) { return String(v); });
  var lines = [
    '📋 매핑결과 진단',
    '──────────────',
    '컬럼(' + headers.length + '개): ' + headers.join(' | '),
    '마지막 행: ' + lastVals.join(' | '),
    '',
    '총 ' + total + '행',
    '날짜(week) 변환 실패: ' + parseFail + '행',
    '만족도 숫자 아님: ' + csatInvalid + '행',
    'mediumType 컬럼: ' + (chCol >= 0 ? '있음' : '없음'),
    '',
    '날짜 변환 샘플:',
    samples.join('\n'),
    '',
    '주차별 CSAT 응답 수:'
  ];
  var ws = Object.keys(weekCount).sort();
  if (ws.length === 0) lines.push('  (집계된 응답 없음)');
  else ws.forEach(function(w) { lines.push('  ' + w + ' : ' + weekCount[w] + '건'); });

  // ── 설문 응답 시트(응답일 기준) + 상담데이터 조인 가능 여부 ──
  var formSh = ss.getSheetByName(SHEET_FORM);
  var rawSh  = ss.getSheetByName(SHEET_RAW);
  if (formSh && rawSh) {
    var fData = formSh.getDataRange().getValues();
    var rData = rawSh.getDataRange().getValues();
    if (fData.length > 1 && rData.length > 1) {
      var fHead = fData[0].map(function(h) { return String(h).trim(); });
      var rHead = rData[0].map(function(h) { return String(h).trim(); });
      var fTs = fHead.indexOf(FORM_HEADERS.timestamp);
      var fId = findFormIdCol_(fHead);
      var rId = rHead.indexOf(RAW_HEADERS.id);

      if (fTs >= 0 && fId >= 0 && rId >= 0) {
        var rawIds = {};
        for (var r = 1; r < rData.length; r++) {
          var rid = String(rData[r][rId]).trim();
          if (rid) rawIds[rid] = true;
        }

        var formWeek = {};   // 응답일 기준 주차별 응답 수
        var noMatch  = {};   // 그 중 상담데이터에 id 없는 수 (조인 실패)
        for (var f = 1; f < fData.length; f++) {
          var fwl = toWeekLabel(fData[f][fTs]);
          if (!fwl) continue;
          formWeek[fwl] = (formWeek[fwl] || 0) + 1;
          var fid = String(fData[f][fId] || '').trim();
          if (!fid || !rawIds[fid]) noMatch[fwl] = (noMatch[fwl] || 0) + 1;
        }

        lines.push('');
        lines.push('── 설문응답(응답일 기준) / 상담데이터 미매칭 ──');
        var fws = Object.keys(formWeek).sort();
        if (fws.length === 0) lines.push('  (응답 없음)');
        else fws.forEach(function(w) {
          lines.push('  ' + w + ' : 응답 ' + formWeek[w] + '건 · 미매칭 ' + (noMatch[w] || 0) + '건');
        });
      } else {
        lines.push('');
        lines.push('── 컬럼 인식 실패 (찾는 이름과 실제 헤더가 다름) ──');
        lines.push('찾는 이름 → 타임스탬프:"' + FORM_HEADERS.timestamp + '"(위치 ' + fTs + ') / id(위치 ' + fId + ') / 상담데이터 id(위치 ' + rId + ')');
        lines.push('');
        lines.push('설문 시트 실제 헤더:');
        lines.push('  ' + fHead.join(' | '));
        lines.push('');
        lines.push('상담데이터 실제 헤더:');
        lines.push('  ' + rHead.join(' | '));
      }
    }
  }

  ui.alert(lines.join('\n'));
}

// 매핑결과 시트에서 지정 주차의 CSAT 자동 계산 (채팅/전화 분리)
function readCsatFromSheet_(ss, weekLabel) {
  var result = {
    chatAvg: 0, chatCount: 0, chat1: 0, chat2: 0, chat3: 0, chat4: 0, chat5: 0,
    phoneAvg: 0, phoneCount: 0, phone1: 0, phone2: 0, phone3: 0, phone4: 0, phone5: 0,
    tagCsat: [], lowComments: [], subQuestions: [],   // ← CSAT 원인 분석용: 태그별 평균 / 저점수 코멘트 / 세부 문항(친절·해결·속도)
  };

  var mappedSh = ss.getSheetByName(SHEET_MAPPED);
  if (!mappedSh) { Logger.log('⚠️ 매핑결과 시트 없음'); return result; }

  var data = mappedSh.getDataRange().getValues();
  if (data.length < 2) return result;

  var headers    = data[0].map(function(h) { return String(h).trim(); });
  var dateCol    = headers.indexOf('week');
  var csatCol    = headers.indexOf('만족도');
  var channelCol = headers.indexOf('mediumType');
  // 태그·코멘트 컬럼은 시트마다 한글/영문이 섞여 있어 후보를 순서대로 시도
  var tagCol     = firstHeaderIdx_(headers, ['태그', 'tags']);
  var commentCol = firstHeaderIdx_(headers, ['자유의견', 'comment', '코멘트']);
  // 세부 문항: 친절도=점수(1~5), 해결여부·대기시간=텍스트(긍/중/부정)
  var subDefs = [
    { key: '친절도',   type: 'score', col: firstHeaderIdx_(headers, ['친절도', 'kindness']) },
    { key: '해결여부', type: 'text',  col: firstHeaderIdx_(headers, ['해결여부', 'resolved']) },
    { key: '대기시간', type: 'text',  col: firstHeaderIdx_(headers, ['대기시간', 'waiting']) },
  ];

  if (dateCol < 0 || csatCol < 0) {
    Logger.log('⚠️ 매핑결과 헤더 인식 실패 (week, 만족도 컬럼 필요) — 실제 헤더: ' + headers.join(', '));
    return result;
  }
  if (tagCol < 0) Logger.log('ℹ️ 매핑결과에 태그 컬럼(태그/tags)이 없어 CSAT 원인 분석은 건너뜁니다.');

  var chatSum = 0, chatCount = 0;
  var phoneSum = 0, phoneCount = 0;
  var chatDist  = [0, 0, 0, 0, 0];
  var phoneDist = [0, 0, 0, 0, 0];
  var tagAgg     = {};   // { 태그명: { sum, count } }
  var lowComments = [];  // { tag, score, comment } — 3점 이하
  var subAgg = { '친절도': { neg: 0, total: 0, dist: {} },
                 '해결여부': { neg: 0, total: 0, dist: {} },
                 '대기시간': { neg: 0, total: 0, dist: {} } };

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

    // ── 태그별 만족도 누적 (한 행에 태그가 여러 개면 각 태그에 점수 귀속)
    if (tagCol >= 0) {
      var rawTags = String(row[tagCol] || '').trim();
      var tagList = rawTags ? rawTags.split(',').map(function(t) { return t.trim(); }).filter(Boolean) : [];
      tagList.forEach(function(t) {
        if (!tagAgg[t]) tagAgg[t] = { sum: 0, count: 0 };
        tagAgg[t].sum   += score;
        tagAgg[t].count += 1;
      });

      // ── 저점수(3점 이하) 코멘트 수집
      if (score <= 3 && commentCol >= 0) {
        var c = String(row[commentCol] || '').trim();
        if (c) lowComments.push({ tag: tagList[0] || '(태그없음)', score: score, comment: c });
      }
    }

    // ── 세부 문항(친절/해결/속도) 부정 응답 누적
    subDefs.forEach(function(d) {
      if (d.col < 0) return;
      var raw = String(row[d.col] || '').trim();
      if (!raw) return;
      var a = subAgg[d.key];
      a.total++;
      a.dist[raw] = (a.dist[raw] || 0) + 1;
      if (d.type === 'score') {
        var sc = parseFloat(raw);
        if (!isNaN(sc) && sc <= 3) a.neg++;       // 친절도 3점 이하 = 부정
      } else if (isNegativeAnswer_(raw)) {
        a.neg++;                                   // 해결/대기 부정 응답
      }
    });
  });

  result.chatAvg   = chatCount  > 0 ? Math.round(chatSum  / chatCount  * 10) / 10 : 0;
  result.chatCount = chatCount;
  result.phoneAvg   = phoneCount > 0 ? Math.round(phoneSum / phoneCount * 10) / 10 : 0;
  result.phoneCount = phoneCount;
  result.chat1  = chatDist[0];  result.chat2  = chatDist[1];  result.chat3  = chatDist[2];
  result.chat4  = chatDist[3];  result.chat5  = chatDist[4];
  result.phone1 = phoneDist[0]; result.phone2 = phoneDist[1]; result.phone3 = phoneDist[2];
  result.phone4 = phoneDist[3]; result.phone5 = phoneDist[4];

  // ── 태그별 평균 만족도 정리 (평균 낮은 순)
  result.tagCsat = Object.keys(tagAgg).map(function(t) {
    return { tag: t, avg: Math.round(tagAgg[t].sum / tagAgg[t].count * 10) / 10, count: tagAgg[t].count };
  }).sort(function(a, b) { return a.avg - b.avg; });
  result.lowComments = lowComments;

  // ── 세부 문항: 부정 응답 비율(%) 정리 + 분포 로그(자동 판정 검증용)
  result.subQuestions = subDefs.filter(function(d) { return d.col >= 0; }).map(function(d) {
    var a     = subAgg[d.key];
    var ratio = a.total > 0 ? Math.round(a.neg / a.total * 1000) / 10 : 0;
    Logger.log('[세부문항] ' + d.key + ' 부정비율 ' + ratio + '% (부정 ' + a.neg + '/' + a.total + ') 분포: ' + JSON.stringify(a.dist));
    return { key: d.key, type: d.type, negRatio: ratio, neg: a.neg, total: a.total };
  });

  Logger.log('[CSAT] ' + weekLabel + ' — 채팅 ' + chatCount + '건(' + result.chatAvg + '점) / 전화 ' + phoneCount + '건(' + result.phoneAvg + '점) / 태그 ' + result.tagCsat.length + '종 / 저점수 코멘트 ' + lowComments.length + '건');
  return result;
}

// 헤더 후보 중 처음 발견되는 컬럼 인덱스 (없으면 -1)
function firstHeaderIdx_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var idx = headers.indexOf(candidates[i]);
    if (idx >= 0) return idx;
  }
  return -1;
}

// 3단계(긍/중/부정) 텍스트 답변에서 '부정' 판정 (키워드 기반 — 분포 로그로 검증 가능)
function isNegativeAnswer_(val) {
  var s = String(val).trim();
  if (!s) return false;
  var NEG = ['않', '아니', '못', '미해결', '별로', '불만', '불친절',
             '길었', '오래', '느', '부적', '부족', '그렇지', '매우 불', '전혀'];
  for (var i = 0; i < NEG.length; i++) {
    if (s.indexOf(NEG[i]) >= 0) return true;
  }
  return false;
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

// 사용자가 팝업에 입력한 주차 텍스트를 report.json 주차 라벨(MM/DD~MM/DD)로 변환
//   허용 형식: "05/25", "5/25", "05/25~05/31", "2026-05-25", "2026. 5. 25" 등
//   (어느 형식이든 그 날이 속한 월~일 주차로 변환됨)
function resolveWeekLabel_(raw) {
  raw = String(raw || '').trim();
  if (!raw) return null;

  // "05/25~05/31"처럼 범위로 적은 경우 → 시작일만 사용
  var left = raw.split('~')[0].trim();

  // "MM/DD" 또는 "M/D" (연도 없음) → 올해 기준으로 해석
  var md = left.match(/^(\d{1,2})\s*[\/.\-]\s*(\d{1,2})$/);
  if (md) {
    var y = new Date().getFullYear();
    return toWeekLabel(new Date(y, Number(md[1]) - 1, Number(md[2])));
  }

  // 그 외(ISO, "2026. 5. 25" 등)는 기존 날짜 파서에 위임
  return toWeekLabel(left);
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


function buildReportBlocks_(inputs, okr, reportData, config, weekIdx) {
  weekIdx = weekIdx || 0;
  var blocks   = [];
  var thisWeek = reportData.weeks[weekIdx];
  var lastWeek = reportData.weeks[weekIdx + 1];

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

  // ── CSAT 원인 분석 (하이브리드: 숫자=코드 집계, 해석=Claude AI)
  concatInto_(blocks, buildCsatCauseBlocks_(inputs, okr));

  // ── 카테고리 집계 (표는 제거했지만 아래 '한 줄 인사이트'가 사용하므로 계산은 유지)
  var catSummary = buildCategorySummary_(thisWeek.tags, lastWeek.tags);

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

// ── CSAT 원인 분석 설정
var CSAT_CAUSE_MIN_COUNT = 3;                       // 소표본 noise 방지: 최소 응답 건수
var CLAUDE_MODEL         = 'claude-haiku-4-5-20251001'; // 비용 우선. 품질 우선 시 'claude-sonnet-4-6'

// CSAT 원인 분석 섹션 블록 생성
//  - 숫자(태그 주범·세부문항 주범)=코드 집계, 해석(불릿 5줄)=Claude AI, 실패 시 규칙 기반 폴백
//  - 구성: AI 해석 불릿 / 🏷️ 태그별 만족도 표 / 🎯 세부 문항 주범 표 / 💬 주범 태그 코멘트 목록
function buildCsatCauseBlocks_(inputs, okr) {
  var blocks  = [];
  var target  = Number(okr && okr.csatTarget) || 4.2;
  var tagCsat = inputs.tagCsat || [];
  var subQ    = inputs.subQuestions || [];

  blocks.push(heading2_('💬 CSAT 원인 분석'));

  if (!tagCsat.length && !subQ.length) {
    blocks.push(paragraph_('이번 주는 태그·세부 문항이 연결된 만족도 응답이 부족해 원인 분석을 생략합니다.'));
    return blocks;
  }

  // ── 주범 산출 (코드)
  var culprits   = pickCsatCulprits_(tagCsat, target, CSAT_CAUSE_MIN_COUNT);
  var topCulprit = culprits.length ? culprits[0] : null;       // 주범 태그
  var subCulprit = pickSubCulprit_(subQ);                       // 주범 세부 요소

  // ── 주범 태그 저점수 코멘트 (최대 3개)
  var related = (inputs.lowComments || []).filter(function(c) {
    return topCulprit && c.tag === topCulprit.tag;
  }).slice(0, 3);
  if (related.length === 0) related = (inputs.lowComments || []).slice(0, 3);

  // ── 해석 불릿: AI 우선, 실패 시 규칙 기반
  var insightLines;
  if (topCulprit || subCulprit) {
    try {
      insightLines = toBullets_(callClaudeForCsatInsight_(topCulprit, subCulprit, related, target));
    } catch (e) {
      Logger.log('⚠️ Claude 호출 실패 → 규칙 기반 폴백: ' + e.message);
      insightLines = ruleBasedCsatInsight_(topCulprit, subCulprit, target);
    }
  } else {
    insightLines = ['이번 주 목표(' + target + '점) 미달 태그(최소 ' + CSAT_CAUSE_MIN_COUNT + '건 이상)는 없습니다. 만족도 양호.'];
  }
  insightLines.forEach(function(line) { blocks.push(bullet_(line)); });

  // ── 🏷️ 태그별 만족도 표 (평균 낮은 순, 최대 10개) — 목표 미달 🔴
  if (tagCsat.length) {
    blocks.push(heading3_('🏷️ 태그별 만족도 (낮은 순)'));
    blocks.push(tableBlock_(
      ['태그 / 카테고리', '평균 만족도', '응답 건수'],
      tagCsat.slice(0, 10).map(function(t) {
        return [(t.avg < target ? '🔴 ' : '') + t.tag, t.avg + '점', t.count + '건'];
      })
    ));
  }

  // ── 🎯 세부 문항 주범 표 (친절/해결/속도)
  if (subQ.length) {
    blocks.push(heading3_('🎯 세부 문항 (친절·해결·속도)'));
    blocks.push(tableBlock_(
      ['요소', '부정 응답 비율', '응답 수'],
      subQ.map(function(s) {
        var isWorst = subCulprit && s.key === subCulprit.key;
        var label   = s.key === '친절도' ? '친절도(3점 이하)' : s.key + '(부정)';
        return [(isWorst ? '🔴 ' : '') + label, s.negRatio + '%', s.total + '건'];
      })
    ));
  }

  // ── 💬 주범 태그 저점수 코멘트 목록
  if (related.length) {
    var who = topCulprit ? '주범 태그 "' + topCulprit.tag + '"' : '저점수';
    blocks.push(heading3_('💬 ' + who + ' 코멘트'));
    related.forEach(function(c) {
      blocks.push(bullet_('(' + c.score + '점) ' + c.comment));
    });
  }

  return blocks;
}

// 주범 태그 추출: 최소 건수 이상 + 목표 미달 (tagCsat는 이미 평균 오름차순)
function pickCsatCulprits_(tagCsat, target, minCount) {
  return (tagCsat || []).filter(function(t) {
    return t.count >= minCount && t.avg < target;
  });
}

// 주범 세부 요소: 부정 응답 비율이 가장 높은 항목 (응답 있고 비율>0)
function pickSubCulprit_(subQ) {
  var worst = null;
  (subQ || []).forEach(function(s) {
    if (s.total > 0 && s.negRatio > 0 && (!worst || s.negRatio > worst.negRatio)) worst = s;
  });
  return worst;
}

// AI 텍스트를 불릿 줄 배열로 (선두 기호 제거, 빈 줄 제외, 최대 5줄)
function toBullets_(text) {
  var lines = String(text).split('\n').map(function(l) {
    return l.replace(/^\s*[-•*·▪◦]\s*/, '').trim();
  }).filter(function(l) { return l.length > 0; });
  return lines.slice(0, 5);
}

// 규칙 기반 해석 불릿 (AI 폴백용)
function ruleBasedCsatInsight_(culprit, subCulprit, target) {
  var lines = [];
  if (culprit) {
    lines.push('만족도 하락 주범 태그: "' + culprit.tag + '" (평균 ' + culprit.avg + '점 / ' + culprit.count + '건, 목표 ' + target + '점 미달)');
  }
  if (subCulprit) {
    var lbl = subCulprit.key === '친절도' ? '친절도 3점 이하' : subCulprit.key + ' 부정';
    lines.push('세부 문항 주범: ' + subCulprit.key + ' (' + lbl + ' ' + subCulprit.negRatio + '%)');
  }
  if (!lines.length) lines.push('이번 주 만족도는 양호합니다.');
  return lines;
}

// Claude API로 5줄 이내 불릿 해석 생성 (UrlFetchApp)
function callClaudeForCsatInsight_(culprit, subCulprit, related, target) {
  var apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY 스크립트 속성이 없습니다.');

  var tagText = culprit
    ? culprit.tag + ' (평균 ' + culprit.avg + '점, ' + culprit.count + '건, 목표 ' + target + '점 미달)'
    : '(목표 미달 태그 없음)';
  var subText = subCulprit
    ? subCulprit.key + ' (부정 응답 비율 ' + subCulprit.negRatio + '%)'
    : '(두드러진 세부 문항 없음)';
  var commentText = related.length
    ? related.map(function(c) { return '- (' + c.score + '점) ' + c.comment; }).join('\n')
    : '(코멘트 없음)';

  var prompt =
    '너는 고객경험(CX) 분석가야. 아래는 이번 주 VOC 만족도(CSAT) 데이터야.\n\n' +
    '주범 태그: ' + tagText + '\n' +
    '주범 세부 문항(친절/해결/속도 중): ' + subText + '\n' +
    '저점수 고객 코멘트:\n' + commentText + '\n\n' +
    '요구사항:\n' +
    '1) 주범 태그의 만족도가 왜 낮은지, 세부 문항(친절/해결/속도) 주범과 엮어 해석.\n' +
    '2) 주목할 고객 코멘트 1~2개를 짧게 인용.\n' +
    '3) 한국어로, 가독성 좋게 각 줄을 "- "로 시작하는 불릿으로, 전체 5줄 이내.\n' +
    '4) 권장 액션·제안은 쓰지 말 것.\n' +
    '불릿만 바로 출력해.';

  var payload = {
    model: CLAUDE_MODEL,
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  };

  var res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  var body = res.getContentText();
  if (code !== 200) throw new Error('Claude API ' + code + ': ' + body);

  var json = JSON.parse(body);
  var text = (json.content && json.content[0] && json.content[0].text) ? json.content[0].text.trim() : '';
  if (!text) throw new Error('Claude 응답에서 텍스트를 찾지 못함: ' + body);
  return text;
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

function buildTitle_(weekLabel) {
  var tz = 'Asia/Seoul';

  // 선택한 주차가 있으면 "25년 5월 25일~31일 VOC 리포트" 형식
  if (weekLabel && weekLabel.indexOf('~') >= 0) {
    var yy    = Utilities.formatDate(new Date(), tz, 'yy');
    var parts = weekLabel.split('~');
    var s     = parts[0].split('/'); // [MM, DD]
    var e     = parts[1].split('/');
    var endStr = (s[0] === e[0])
      ? Number(e[1]) + '일'
      : Number(e[0]) + '월 ' + Number(e[1]) + '일';   // 월을 넘기는 주차
    return yy + '년 ' + Number(s[0]) + '월 ' + Number(s[1]) + '일~' + endStr + ' VOC 리포트';
  }

  // 폴백: 오늘 날짜
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
