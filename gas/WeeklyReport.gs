/**
 * WeeklyReport.gs — VOC 주간 리포트 자동 생성
 *
 * 사용법:
 *   Google Sheets > 주간입력 시트 > [▶ 리포트 생성] 버튼 클릭
 *   → generateWeeklyReport() 실행 → Notion 페이지 자동 생성
 *
 * 필요한 시트: 주간입력, OKR목표, 설정
 * 필요한 스크립트 속성: NOTION_TOKEN
 *   (설정 방법: Apps Script 에디터 > 프로젝트 설정 > 스크립트 속성 > NOTION_TOKEN 추가)
 *
 * 주간입력 시트 헤더 (1행):
 *   A=주차 | B=채팅평균 | C=채팅_1점 | D=채팅_2점 | E=채팅_3점 | F=채팅_4점 | G=채팅_5점
 *   H=전화평균 | I=전화_1점 | J=전화_2점 | K=전화_3점 | L=전화_4점 | M=전화_5점
 *   N=당일응대율 | O=처리건수 | P=생성결과(URL/에러)
 *
 * OKR목표 시트:
 *   A2=상담만족도목표 레이블, B2=4.2
 *   A3=재문의율목표 레이블,   B3=3.5
 *   A4=당일응대율목표 레이블, B4=96
 *
 * 설정 시트:
 *   A1=NOTION_PAGE_ID,   B1=(Notion 상위 페이지 ID)
 *   A2=NOTION_TOKEN,     B2=(비워두고 스크립트 속성에 저장 권장)
 *   A3=인사이트_활성화,  B3=FALSE  ← V7 통과 후 TRUE로 변경
 *   A4=검증결과,         B4=(verifyAgainstVocReport_ 실행 후 자동 기록)
 */

// =====================================================================
// 진입점 — Sheets 버튼에 이 함수를 연결하세요
// =====================================================================
function generateWeeklyReport() {
  var ss         = SpreadsheetApp.getActiveSpreadsheet();
  var inputSheet = ss.getSheetByName('주간입력');

  if (!inputSheet) {
    SpreadsheetApp.getUi().alert('❌ "주간입력" 시트를 찾을 수 없어요. 시트 이름을 확인해주세요.');
    return;
  }

  var lastRow    = inputSheet.getLastRow();
  var resultCell = inputSheet.getRange(lastRow, 16); // P열: 생성결과

  if (lastRow < 2) {
    resultCell.setValue('❌ 주간입력 시트에 데이터가 없어요. 2행부터 입력해주세요.');
    return;
  }

  resultCell.setValue('⏳ 생성 중...');
  SpreadsheetApp.flush();

  try {
    Logger.log('[1/4] 데이터 읽기 시작');
    var inputs     = readWeeklyInputs_(ss, lastRow);
    var okr        = readOkrTargets_(ss);
    var config     = readConfig_(ss);
    var reportData = readReportJson_();
    Logger.log('[1/4] 완료 — 주차: ' + inputs.week);

    Logger.log('[2/4] 입력 검증');
    var err = validateInputs_(inputs, reportData);
    if (err) {
      resultCell.setValue(err);
      return;
    }

    Logger.log('[3/4] 리포트 블록 빌드');
    var blocks = buildReportBlocks_(inputs, okr, reportData, config);

    Logger.log('[4/4] Notion 업로드');
    var title = buildTitle_();
    var url   = uploadToNotion_(title, blocks, config);

    resultCell.setValue(url);
    Logger.log('✅ 완료: ' + url);

  } catch (e) {
    // AC9 + 보안: 셀에는 안내만, 상세 오류는 Logger에만 기록
    resultCell.setValue('❌ 오류가 발생했어요. Apps Script 로그(실행 > 로그 보기)를 확인해주세요.');
    Logger.log('❌ 상세 오류: ' + e.stack);
  }
}

// =====================================================================
// Step 2: 데이터 읽기
// =====================================================================

function readWeeklyInputs_(ss, lastRow) {
  var row = ss.getSheetByName('주간입력').getRange(lastRow, 1, 1, 15).getValues()[0];
  return {
    week              : String(row[0]  || '').trim(),
    chatAvg           : Number(row[1])  || 0,
    chat1             : Number(row[2])  || 0,
    chat2             : Number(row[3])  || 0,
    chat3             : Number(row[4])  || 0,
    chat4             : Number(row[5])  || 0,
    chat5             : Number(row[6])  || 0,
    phoneAvg          : Number(row[7])  || 0,
    phone1            : Number(row[8])  || 0,
    phone2            : Number(row[9])  || 0,
    phone3            : Number(row[10]) || 0,
    phone4            : Number(row[11]) || 0,
    phone5            : Number(row[12]) || 0,
    dailyResponseRate : Number(row[13]) || 0,
    totalVoc          : Number(row[14]) || 0,
  };
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

/**
 * ⚠️ 개발자 주의: 아래 TODO를 기존 GAS 프로젝트의 report.json 생성 함수로 교체하세요.
 *
 * 이 함수는 동일 GAS 프로젝트 내 기존 수집 함수를 in-memory로 직접 호출해야 합니다.
 * GitHub Raw URL fetch는 절대 사용하지 마세요 (race condition, 지연 발생).
 *
 * 기존 함수가 파일 출력만 하고 객체를 반환하지 않는 경우,
 * 해당 함수를 "객체 반환 + 옵션으로 파일 출력" 방식으로 수정하세요.
 *
 * 예시:
 *   return buildVocDataObject_();   // ← 기존 함수명으로 교체
 */
function readReportJson_() {
  // TODO: 기존 GAS 수집 함수 이름을 확인하고 아래 줄을 교체하세요.
  // return buildVocDataObject_();

  // 임시 폴백: 스크립트 캐시 (연결 전 테스트용)
  var cached = CacheService.getScriptCache().get('voc_report_json');
  if (cached) return JSON.parse(cached);

  throw new Error(
    'readReportJson_() 미연결 — ' +
    '기존 GAS 수집 함수명을 확인하고 이 함수의 TODO 줄을 교체해주세요.'
  );
}

// =====================================================================
// 검증
// =====================================================================

function validateInputs_(inputs, reportData) {
  if (!inputs.week) return '❌ 주차 정보가 비어있어요. A열(주차)을 입력해주세요.';

  var chatDist  = inputs.chat1 + inputs.chat2 + inputs.chat3 + inputs.chat4 + inputs.chat5;
  var phoneDist = inputs.phone1 + inputs.phone2 + inputs.phone3 + inputs.phone4 + inputs.phone5;

  if (chatDist === 0 || phoneDist === 0)
    return '❌ 채팅/전화 점수 분포가 비어있어요. 1~5점 칸을 채워주세요.';
  if (inputs.chatAvg < 0 || inputs.chatAvg > 5)
    return '❌ 채팅 CSAT 평균이 0~5 범위를 벗어났어요.';
  if (inputs.phoneAvg < 0 || inputs.phoneAvg > 5)
    return '❌ 전화 CSAT 평균이 0~5 범위를 벗어났어요.';
  if (inputs.dailyResponseRate < 0 || inputs.dailyResponseRate > 100)
    return '❌ 당일응대율이 0~100 범위를 벗어났어요.';
  if (!reportData || !reportData.weeks || reportData.weeks.length < 2)
    return '❌ report.json에 2주치 데이터가 없어요. GAS 수집을 먼저 실행해주세요.';

  return null;
}

// =====================================================================
// Step 3: 리포트 블록 빌더
// =====================================================================

function buildReportBlocks_(inputs, okr, reportData, config) {
  var blocks   = [];
  var thisWeek = reportData.weeks[0];
  var lastWeek = reportData.weeks[1];

  // ── OKR 지표 ──
  blocks.push(heading2_('📊 OKR 지표'));

  // 처리건수는 reportData 단일 소스 사용 (AC4 — 동일 소스 통일)
  var combinedCsat  = ((inputs.chatAvg + inputs.phoneAvg) / 2).toFixed(2);
  var recontact     = thisWeek.recontact_rate || 0;
  var prevRecontact = lastWeek.recontact_rate || 0;
  var totalVoc      = thisWeek.total_voc      || 0;
  var prevTotalVoc  = lastWeek.total_voc      || 0;
  var vocChangePct  = prevTotalVoc > 0
    ? (((totalVoc - prevTotalVoc) / prevTotalVoc) * 100).toFixed(1)
    : '0.0';
  var vocSign = Number(vocChangePct) >= 0 ? '+' : '';

  // AC2 — 형식: 실적 / 목표 (전주) 를 단일 컬럼에 표시
  blocks.push(tableBlock_(
    ['지표', '실적 / 목표', '전주'],
    [
      ['상담만족도',   combinedCsat + '점 / ' + okr.csatTarget + '점',         '-'],
      ['재문의율',     recontact + '% / ' + okr.recontactTarget + '%',          prevRecontact + '%'],
      ['당일응대율',   inputs.dailyResponseRate + '% / ' + okr.dailyResponseTarget + '%', '-'],
      ['처리건수',     totalVoc + '건',   prevTotalVoc + '건 (' + vocSign + vocChangePct + '%)'],
    ]
  ));

  // ── CSAT 상세 ──
  blocks.push(heading2_('💬 CSAT 상세'));
  blocks.push(paragraph_('채팅 CSAT — 평균 ' + inputs.chatAvg + '점'));
  blocks.push(paragraph_('점수 분포: ' + formatDist_(inputs, 'chat')));
  blocks.push(paragraph_('전화 CSAT — 평균 ' + inputs.phoneAvg + '점'));
  blocks.push(paragraph_('점수 분포: ' + formatDist_(inputs, 'phone')));

  // ── 카테고리별 현황 ──
  blocks.push(heading2_('🏷️ 카테고리별 현황'));
  var catSummary = buildCategorySummary_(thisWeek.tags, lastWeek.tags);
  blocks.push(tableBlock_(
    ['카테고리', '이번 주', '지난 주', '증감'],
    catSummary.map(function(r) {
      var sign = r.change >= 0 ? '+' : '';
      return [r.category, r.curr + '건', r.prev + '건', sign + r.change];
    })
  ));

  // ── TOP 5 태그 ──
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

  // ── 이상 태그 알림 ──
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

  // ── 한 줄 인사이트 (feature flag: 설정 시트 B3=TRUE 일 때만) ──
  if (config.insightEnabled) {
    blocks.push(heading2_('💡 한 줄 인사이트'));
    blocks.push(paragraph_(buildInsight_(catSummary, anomalies)));
  }

  return blocks;
}

// =====================================================================
// 카테고리·TOP5·인사이트 헬퍼
// =====================================================================

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

// =====================================================================
// Step 4: Notion 업로드
// =====================================================================

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

// =====================================================================
// V6 검증 함수 — diff 산출 절차
// =====================================================================

/**
 * 신규 빌더 분류 결과를 Logger에 표로 출력하고, 설정 시트 B4(검증결과)에 기록합니다.
 * GAS Editor에서 수동으로 실행하세요 (드라이런 검증 목적).
 */
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
    // 데이터가 있는 카테고리에서 건수가 0이면 비정상으로 표시
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

// =====================================================================
// Notion 블록 빌더 헬퍼
// =====================================================================

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

/** 소제목 + 항목 배열을 블록 배열로 반환 */
function bulletSection_(heading, items) {
  var blocks = [heading3_(heading)];
  (items.length > 0 ? items : ['없음']).forEach(function(item) {
    blocks.push(bullet_(item));
  });
  return blocks;
}

/**
 * 테이블 블록 (R7 가드: 90행 초과 시 자동 분할)
 * @param {string[]} headers
 * @param {Array[]} rows
 */
function tableBlock_(headers, rows) {
  var allRows  = [headers].concat(rows);
  var safeRows = allRows.slice(0, 90); // R7: Notion table 100행 제한 대비

  return {
    object  : 'block',
    type    : 'table',
    table   : { table_width: headers.length, has_column_header: true, has_row_header: false },
    children: safeRows.map(function(row) {
      return {
        object    : 'block',
        type      : 'table_row',
        table_row : { cells: row.map(function(cell) { return [rt_(String(cell))]; }) },
      };
    }),
  };
}

function rt_(text) {
  return { type: 'text', text: { content: String(text) } };
}

/** Array.prototype.concat 대신 in-place push (GAS V8 호환) */
function concatInto_(target, source) {
  source.forEach(function(item) { target.push(item); });
}
