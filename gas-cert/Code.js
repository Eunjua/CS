/**
 * 보살핌 자격증 발급 파일 생성 스크립트
 */

// ===== 설정값 =====
var TARGET_FOLDER_ID           = '13dZAvuCdn4z8g5CBpYhXvzdxSXlrqodA';
var SOURCE_SHEET_NAME          = '제작리스트';
var COURSE_SHEET_NAME          = '발급과정';
var CERT_MAPPING_SHEET_NAME    = '자격증매핑';
var SUMMARY_SHEET_NAME         = '정산집계';
var DELIVERY_BABY_SHEET_NAME   = '[배송]베이비시터';
var DELIVERY_NCS_SHEET_NAME    = '[배송]NCS';   // 한국검정평가원 송장도 여기 섞여 옴 (NCS로 통합 처리)

// ============================================================
//  ★ 열 위치 설정 ★
//  헤더(1행) 이름이 아니라 "몇 번째 열인지"로 동작합니다.
//  → 헤더 이름은 마음대로 바꿔도 됩니다.
//  → 대신 열을 끼워넣거나 순서를 바꾸면 아래 알파벳을 고쳐주세요. 여기만 고치면 됩니다.
// ============================================================

// 제작리스트 시트
var SRC_COL = {
  '배송일자':          'A',
  '제작일자':          'B',
  'user_name':        'D',   // 이름
  'year':             'E',   // 생년
  'month':            'F',   // 생월
  'day':              'G',   // 생일
  '전화번호':          'H',
  'title_with_grade': 'I',   // 자격증명
  'type_code':        'J',   // 자격증형태
  '주소':              'K',
  'exam_score':       'M',   // 시험점수
  '유효성검사':        'N',
  '재발급':            'P',
  '상세주소':          'Q',
  '비고':              'S'
};

// 정산집계 시트 (이 스크립트가 직접 만드는 시트)
var SUM_COL = {
  '배송일':     'A',
  '이름':       'B',
  '전화번호':   'C',
  '자격증':     'D',
  'type_code': 'E',
  '송장번호':   'F',
  '재발급':     'G',
  '취소':       'H',
  '취소일':     'I'
};

// 발급과정 시트
var COURSE_COL = { '과정명': 'A', '코드번호': 'B', '자격증형태': 'E', '결제금액': 'F' };

// 자격증매핑 시트
var CERTMAP_COL = { '자격증명': 'A', '종류': 'B' };

// [배송]베이비시터 시트
var DBABY_COL = { '배송일': 'A', '이름': 'D', '전화번호': 'G', '송장번호': 'H' };

// [배송]NCS 시트
var DNCS_COL = { '배송일': 'A', '송장번호': 'I', '이름': 'S', '전화번호': 'T' };

// 열 알파벳 → 배열 번호 (A=0, B=1 ... Z=25, AA=26)
function colIdx(letter) {
  var n = 0;
  letter.toString().trim().toUpperCase().split('').forEach(function(ch) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  });
  return n - 1;
}

// 열 설정표({이름:'A'}) → 번호표({이름:0})
function buildIdx(colMap) {
  var idx = {};
  Object.keys(colMap).forEach(function(k) { idx[k] = colIdx(colMap[k]); });
  return idx;
}

// ===== 자격증매핑 시트 로드 =====
function loadCertMapping(ss) {
  var sheet = ss.getSheetByName(CERT_MAPPING_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + CERT_MAPPING_SHEET_NAME);
    return null;
  }

  var data = sheet.getDataRange().getValues();
  var cIdx = buildIdx(CERTMAP_COL);
  var map  = {};

  data.slice(1).forEach(function(row) {
    var certName = row[cIdx['자격증명']] ? row[cIdx['자격증명']].toString().trim() : '';
    var certType = row[cIdx['종류']]     ? row[cIdx['종류']].toString().trim().toLowerCase() : '';
    if (certName && certType) {
      map[certName] = certType;
    }
  });

  return map;
}

// ===== 미등록 자격증 검사 =====
function findUnregisteredCerts(rows, idx, certMapping) {
  var unregistered = {};

  rows.forEach(function(row) {
    var titleWithGrade = (row[idx['title_with_grade']] || '').toString().trim();
    if (titleWithGrade && certMapping[titleWithGrade] === undefined) {
      unregistered[titleWithGrade] = true;
    }
  });

  return Object.keys(unregistered);
}

// ===== 메인 함수 =====
function createCertificationFiles() {
  var ss          = SpreadsheetApp.getActiveSpreadsheet();
  var sourceSheet = ss.getSheetByName(SOURCE_SHEET_NAME);
  var courseSheet = ss.getSheetByName(COURSE_SHEET_NAME);
  var folder      = DriveApp.getFolderById(TARGET_FOLDER_ID);

  if (!sourceSheet) { SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + SOURCE_SHEET_NAME); return; }
  if (!courseSheet) { SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + COURSE_SHEET_NAME); return; }

  var certMapping = loadCertMapping(ss);
  if (!certMapping) return;

  var sourceData = sourceSheet.getDataRange().getValues();
  var rows       = sourceData.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  });

  var idx = buildIdx(SRC_COL);

  var courseData    = courseSheet.getDataRange().getValues();
  var courseCodeMap = {};
  var typeAmountMap = {};

  var crsIdx = buildIdx(COURSE_COL);
  courseData.forEach(function(row) {
    var courseName = row[crsIdx['과정명']]     ? row[crsIdx['과정명']].toString().trim()     : '';
    var codeNum    = row[crsIdx['코드번호']]   ? row[crsIdx['코드번호']].toString().trim()   : '';
    var typeCode   = row[crsIdx['자격증형태']] ? row[crsIdx['자격증형태']].toString().trim() : '';
    var amount     = row[crsIdx['결제금액']] !== undefined ? row[crsIdx['결제금액']] : '';
    if (courseName && codeNum) courseCodeMap[courseName] = codeNum;
    if (typeCode && amount !== '') typeAmountMap[typeCode] = amount;
  });

  var validColIdx  = idx['유효성검사'];
  var filteredRows = rows.filter(function(row) {
    return row[validColIdx].toString().trim() !== 'F';
  });

  var unregistered = findUnregisteredCerts(filteredRows, idx, certMapping);
  if (unregistered.length > 0) {
    SpreadsheetApp.getUi().alert(
      '❌ 등록되지 않은 자격증이 있습니다.\n자격증매핑 시트에 추가 후 다시 실행해주세요.\n\n' +
      unregistered.map(function(name) { return '· ' + name; }).join('\n')
    );
    return;
  }

  var dateGroups = {};

  filteredRows.forEach(function(row) {
    var rawDate = row[idx['제작일자']];
    var mmdd    = formatMMDD(rawDate);
    if (!mmdd) return;

    if (!dateGroups[mmdd]) {
      dateGroups[mmdd] = { baby: [], korean: [], ncs: [] };
    }

    var titleWithGrade = (row[idx['title_with_grade']] || '').toString().trim();
    var certType       = certMapping[titleWithGrade];

    if (certType === 'baby') {
      dateGroups[mmdd].baby.push(row);
    } else if (certType === 'korean') {
      dateGroups[mmdd].korean.push(row);
    } else {
      dateGroups[mmdd].ncs.push(row);
    }
  });

  var today     = new Date();
  var todayMMDD = String(today.getMonth() + 1).padStart(2, '0') + String(today.getDate()).padStart(2, '0');
  var allDates  = Object.keys(dateGroups).sort();

  if (allDates.length === 0) {
    SpreadsheetApp.getUi().alert('처리할 데이터가 없습니다.');
    return;
  }

  var selectedDates = allDates.filter(function(d) { return d === todayMMDD; });

  if (selectedDates.length === 0) {
    SpreadsheetApp.getUi().alert('오늘(' + todayMMDD + ') 날짜의 제작 데이터가 없습니다.\n\n존재하는 날짜: ' + allDates.join(', '));
    return;
  }

  var createdCount = 0;

  selectedDates.forEach(function(mmdd) {
    var group = dateGroups[mmdd];
    if (group.baby.length > 0) { createBabyOrKoreanFile(folder, mmdd + '_보살핌_베이비시터', group.baby, idx); createdCount++; }

    // 한국검정평가원(korean)은 NCS 파일에 통합 발급 (과정코드·결제금액은 빈칸으로 나옴)
    var ncsRows = group.ncs.concat(group.korean);
    if (ncsRows.length > 0) { createNCSFile(folder, mmdd + '_보살핌_NCS', ncsRows, idx, courseCodeMap, typeAmountMap); createdCount++; }

    var nonBaby = group.korean.concat(group.ncs);
    if (nonBaby.length > 0) { createDeliveryCheckFile(folder, mmdd + '_배송확인리스트', nonBaby, idx); createdCount++; }
  });

  clearDatesForInvalidRows(sourceSheet, idx);
  appendToSummarySheet(ss, selectedDates, dateGroups, idx);

  SpreadsheetApp.getUi().alert('완료! 총 ' + createdCount + '개의 파일이 생성되었습니다.');
}

// ===== 배송 업데이트 - 베이비시터 =====
function updateDeliveryBaby() {
  updateDeliveryTracking('baby');
}

// ===== 배송 업데이트 - NCS (한국검정평가원 통합) =====
function updateDeliveryNCS() {
  updateDeliveryTracking('ncs');
}

// ===== 배송 업데이트 공통 함수 =====
  function updateDeliveryTracking(type) {
    var ss           = SpreadsheetApp.getActiveSpreadsheet();
    var summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);

    if (!summarySheet) {
      SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + SUMMARY_SHEET_NAME);
      return;
    }

    var certMapping = loadCertMapping(ss);
    if (!certMapping) return;

    var summaryData = summarySheet.getDataRange().getValues();
    var sIdx        = buildIdx(SUM_COL);

    var trackingColS = sIdx['송장번호'] + 1;

    function getCertType(certName) {
      var cert = certName ? certName.toString().trim() : '';
      return certMapping[cert] || 'ncs';
    }

    // key → 송장번호가 빈 정산집계 행 인덱스 "배열" (합배송 대응)
    // allowedTypes: 포함할 자격증 종류 배열 (미지정 시 현재 type만)
    function buildSummaryMap(keyFn, allowedTypes) {
      var allowed = allowedTypes || [type];
      var map = {};
      for (var r = 1; r < summaryData.length; r++) {
        var sRow   = summaryData[r];
        var sTrack = sRow[sIdx['송장번호']] ? sRow[sIdx['송장번호']].toString().trim() : '';
        if (sTrack !== '') continue;

        var certName = sRow[sIdx['자격증']] ? sRow[sIdx['자격증']].toString().trim() : '';
        var certType = getCertType(certName);
        if (allowed.indexOf(certType) === -1) continue;

        var key = keyFn(sRow);
        if (key) {
          if (!map[key]) map[key] = [];
          map[key].push(r);
        }
      }
      return map;
    }

    // 매칭된 모든 행에 송장번호 입력 (합배송: 1송장 → N행)
    function applyTracking(map, key, tracking) {
      var rows = map[key];
      if (rows === undefined) return 0;
      rows.forEach(function(r) {
        summarySheet.getRange(r + 1, trackingColS).setValue(tracking);
        summaryData[r][sIdx['송장번호']] = tracking;
      });
      delete map[key];
      return rows.length;
    }

    var matchCount  = 0;  // 매칭된 배송 행 수
    var filledCount = 0;  // 송장이 입력된 정산집계 행 수
    var totalCount  = 0;

    if (type === 'baby') {
      var deliveryBabySheet = ss.getSheetByName(DELIVERY_BABY_SHEET_NAME);
      if (!deliveryBabySheet) {
        SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + DELIVERY_BABY_SHEET_NAME);
        return;
      }

      var babyMap = buildSummaryMap(function(sRow) {
        var sDate  = normalizeDate(sRow[sIdx['배송일']]);
        var sName  = sRow[sIdx['이름']] ? sRow[sIdx['이름']].toString().trim() : '';
        var sPhone = normalizePhone(sRow[sIdx['전화번호']]);
        if (!sDate || !sName || !sPhone) return null;
        return sDate + '|' + sName + '|' + sPhone;
      });

      var babyData = deliveryBabySheet.getDataRange().getValues();
      var bIdx     = buildIdx(DBABY_COL);
      var babyRows = babyData.slice(1).filter(function(row) {
        return row[bIdx['송장번호']] && row[bIdx['송장번호']].toString().trim() !== '';
      });
      totalCount = babyRows.length;

      babyRows.forEach(function(dRow) {
        var dDate     = normalizeDate(dRow[bIdx['배송일']]);
        var dName     = dRow[bIdx['이름']].toString().trim();
        var dPhone    = normalizePhone(dRow[bIdx['전화번호']]);
        var dTracking = dRow[bIdx['송장번호']].toString().trim();
        var key = dDate + '|' + dName + '|' + dPhone;
        var n = applyTracking(babyMap, key, dTracking);
        if (n > 0) { matchCount++; filledCount += n; }
      });

      SpreadsheetApp.getUi().alert(
        '베이비시터 배송 업데이트 완료!\n\n' +
        '✅ 송장 입력: ' + filledCount + '건 (합배송 포함)\n' +
        '✅ 매칭된 배송: ' + matchCount + ' / ' + totalCount + '건'
      );
    }

    if (type === 'ncs') {
      var deliveryNcsSheet = ss.getSheetByName(DELIVERY_NCS_SHEET_NAME);
      if (!deliveryNcsSheet) {
        SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + DELIVERY_NCS_SHEET_NAME);
        return;
      }

      // NCS 배송리스트에 한국검정평가원 자격증 송장이 섞여 오므로 둘 다 후보로 포함
      var ncsMap = buildSummaryMap(function(sRow) {
        var sDate   = normalizeDate(sRow[sIdx['배송일']]);
        var sName   = sRow[sIdx['이름']] ? sRow[sIdx['이름']].toString().trim() : '';
        var sPhone7 = normalizePhone(sRow[sIdx['전화번호']]).substring(0, 7);
        if (!sDate || !sName || sPhone7.length !== 7) return null;
        return sDate + '|' + sName + '|' + sPhone7;
      }, ['ncs', 'korean']);

      var ncsData = deliveryNcsSheet.getDataRange().getValues();
      var nIdx    = buildIdx(DNCS_COL);
      var ncsRows = ncsData.slice(1).filter(function(row) {
        return row[nIdx['송장번호']] && row[nIdx['송장번호']].toString().trim() !== '';
      });
      totalCount = ncsRows.length;

      ncsRows.forEach(function(nRow) {
        var nDate     = normalizeDate(nRow[nIdx['배송일']]);
        var nName     = nRow[nIdx['이름']].toString().trim();
        var nPhone7   = normalizePhone(nRow[nIdx['전화번호']].toString().trim()).substring(0, 7);
        var nTracking = nRow[nIdx['송장번호']].toString().trim();
        if (nPhone7.length !== 7) return;
        var key = nDate + '|' + nName + '|' + nPhone7;
        var n = applyTracking(ncsMap, key, nTracking);
        if (n > 0) { matchCount++; filledCount += n; }
      });

      SpreadsheetApp.getUi().alert(
        'NCS 배송 업데이트 완료!\n\n' +
        '✅ 송장 입력: ' + filledCount + '건 (합배송 포함)\n' +
        '✅ 매칭된 배송: ' + matchCount + ' / ' + totalCount + '건'
      );
    }

  }


// ===== 셀을 텍스트 서식으로 강제 지정 후 값 입력 =====
function setCellText(sheet, rowNum, colNum, value) {
  var cell = sheet.getRange(rowNum, colNum);
  cell.setNumberFormat('@');
  cell.setValue(value !== null && value !== undefined ? value.toString() : '');
}

// ===== 재발급 여부 판정 (체크박스 TRUE 또는 텍스트 "T" 모두 인정) =====
function isReissueValue(v) {
  var s = (v == null ? '' : v).toString().trim().toUpperCase();
  return s === 'TRUE' || s === 'T';
}

// ===== 재발급/비고 remark 생성 유틸 =====
function buildRemark(row, idx) {
  var bigoVal = (row[idx['비고']] || '').toString().trim();
  var remark  = '';

  if (isReissueValue(row[idx['재발급']])) {
    remark = bigoVal ? '재발급/' + bigoVal : '재발급';
  }

  return remark;
}

// ===== 재발급 여부 → "T" 또는 "" (재발급 전용 열에 사용) =====
function reissueFlag(row, idx) {
  return isReissueValue(row[idx['재발급']]) ? 'T' : '';
}

// ===== 유틸: 이름(user_name) 가나다 순 → 동명이인은 전화번호 순 정렬 =====
function sortRowsByName(rows, idx) {
  return rows.slice().sort(function(a, b) {
    var nameA = (a[idx['user_name']] || '').toString().trim();
    var nameB = (b[idx['user_name']] || '').toString().trim();
    var byName = nameA.localeCompare(nameB, 'ko');
    if (byName !== 0) return byName;
    var phoneA = normalizePhone(a[idx['전화번호']]);
    var phoneB = normalizePhone(b[idx['전화번호']]);
    return phoneA.localeCompare(phoneB);   // 이름 같으면 전화번호 순
  });
}

// ===== 베이비시터 / 한국검정평가원 파일 생성 =====
function createBabyOrKoreanFile(folder, fileName, rows, idx) {
  rows = sortRowsByName(rows, idx);
  var newSS   = SpreadsheetApp.create(fileName);
  var sheet   = newSS.getActiveSheet();
  var headers = ['순번', '종목', '자격증형태', '자격발급성명', '자격발급주민번호', '배송주소', '연락처', '입금일', '시험점수', '비고'];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');

  rows.forEach(function(row, i) {
    var rowNum   = i + 2;
    var phone    = formatPhone(row[idx['전화번호']]);
    var yearVal  = row[idx['year']]  ? row[idx['year']].toString().trim() : '';
    var monthVal = row[idx['month']] ? String(Number(row[idx['month']])).padStart(2, '0') : '';
    var dayVal   = row[idx['day']]   ? String(Number(row[idx['day']])).padStart(2, '0')   : '';
    var birthday = yearVal + monthVal + dayVal;
    var remark   = buildRemark(row, idx);

    sheet.getRange(rowNum, 1).setValue(i + 1);
    sheet.getRange(rowNum, 2).setValue(row[idx['title_with_grade']] || '');
    sheet.getRange(rowNum, 3).setValue(row[idx['type_code']] || '');
    sheet.getRange(rowNum, 4).setValue(row[idx['user_name']] || '');
    sheet.getRange(rowNum, 5).setValue(birthday);
    sheet.getRange(rowNum, 6).setValue(row[idx['주소']] || '');
    setCellText(sheet, rowNum, 7, phone);
    sheet.getRange(rowNum, 8).setValue('');
    sheet.getRange(rowNum, 9).setValue(row[idx['exam_score']] || '');
    sheet.getRange(rowNum, 10).setValue(remark);
  });

  highlightDuplicates(sheet, rows.length + 1, 4, 7);
  sheet.autoResizeColumns(1, headers.length);
  moveFileTofolder(newSS.getId(), folder);
}

// ===== NCS 파일 생성 =====
function createNCSFile(folder, fileName, rows, idx, courseCodeMap, typeAmountMap) {
  rows = sortRowsByName(rows, idx);
  var newSS   = SpreadsheetApp.create(fileName);
  var sheet   = newSS.getActiveSheet();
  var headers = ['이름', '생년', '생월', '생일', '연락처', '과정명', '자격증종류', '주소', '추천인', '과정코드', '결제금액', '비고'];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');

  rows.forEach(function(row, i) {
    var rowNum         = i + 2;
    var phone          = formatPhone(row[idx['전화번호']]);
    var titleWithGrade = (row[idx['title_with_grade']] || '').toString().trim();
    var typeCode       = (row[idx['type_code']] || '').toString().trim();
    var courseCode     = courseCodeMap[titleWithGrade] || '';
    var amount         = typeAmountMap[typeCode] || '';
    var monthVal       = row[idx['month']] ? String(Number(row[idx['month']])).padStart(2, '0') : '';
    var dayVal         = row[idx['day']]   ? String(Number(row[idx['day']])).padStart(2, '0')   : '';
    var remark         = buildRemark(row, idx);

    sheet.getRange(rowNum, 1).setValue(row[idx['user_name']] || '');
    sheet.getRange(rowNum, 2).setValue(row[idx['year']] || '');
    setCellText(sheet, rowNum, 3, monthVal);
    setCellText(sheet, rowNum, 4, dayVal);
    setCellText(sheet, rowNum, 5, phone);
    sheet.getRange(rowNum, 6).setValue(titleWithGrade);
    sheet.getRange(rowNum, 7).setValue(typeCode);
    sheet.getRange(rowNum, 8).setValue(row[idx['주소']] || '');
    sheet.getRange(rowNum, 9).setValue('보살핌3');
    sheet.getRange(rowNum, 10).setValue(courseCode);
    sheet.getRange(rowNum, 11).setValue(amount ? amount.toString() : '');
    sheet.getRange(rowNum, 12).setValue(remark);
  });

  highlightDuplicates(sheet, rows.length + 1, 1, 5);
  sheet.autoResizeColumns(1, headers.length);
  moveFileTofolder(newSS.getId(), folder);
}

// ===== 유틸: type_code → 발급형태 변환 (배송 확인 리스트 전용) =====
function formatIssueType(typeCodeRaw) {
  var code   = (typeCodeRaw || '').toString().trim();
  var prefix = code.split('|')[0].trim();   // "01|상장" → "01"
  if (prefix === '01') return '상장';
  if (prefix === '02') return '카드';
  if (prefix === '03') return '상장+카드';
  return code;   // 01/02/03 외 값은 원래대로 표시
}

// ===== 배송 확인 리스트 파일 생성 (베이비시터 제외) =====
function createDeliveryCheckFile(folder, fileName, rows, idx) {
  rows = sortRowsByName(rows, idx);
  var newSS   = SpreadsheetApp.create(fileName);
  var sheet   = newSS.getActiveSheet();
  var headers = ['제작일자', '이름', '생년월일', '전화번호', '종목', '발급형태', '주소', '재발급', '상세주소'];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');

  rows.forEach(function(row, i) {
    var rowNum    = i + 2;
    var makeDate  = normalizeDate(row[idx['제작일자']]);
    var yearVal   = row[idx['year']]  ? row[idx['year']].toString().trim() : '';
    var monthVal  = row[idx['month']] ? String(Number(row[idx['month']])).padStart(2, '0') : '';
    var dayVal    = row[idx['day']]   ? String(Number(row[idx['day']])).padStart(2, '0')   : '';
    var birthday  = yearVal + monthVal + dayVal;
    var phone     = formatPhone(row[idx['전화번호']]);
    var issueType = formatIssueType(row[idx['type_code']]);

    sheet.getRange(rowNum, 1).setValue(makeDate);
    sheet.getRange(rowNum, 2).setValue(row[idx['user_name']] || '');
    setCellText(sheet, rowNum, 3, birthday);   // 앞자리 0 보존 위해 텍스트
    setCellText(sheet, rowNum, 4, phone);      // 앞자리 0 보존 위해 텍스트
    sheet.getRange(rowNum, 5).setValue(row[idx['title_with_grade']] || '');
    sheet.getRange(rowNum, 6).setValue(issueType);
    sheet.getRange(rowNum, 7).setValue(row[idx['주소']] || '');
    sheet.getRange(rowNum, 8).setValue(reissueFlag(row, idx));
    sheet.getRange(rowNum, 9).setValue(row[idx['상세주소']] || '');
  });

  highlightDuplicates(sheet, rows.length + 1, 2, 4);   // 이름(2)+전화번호(4) 같으면 이름열 색칠
  sheet.autoResizeColumns(1, headers.length);
  moveFileTofolder(newSS.getId(), folder);
}

// ===== 정산집계 시트에 데이터 추가 =====
function appendToSummarySheet(ss, selectedDates, dateGroups, idx) {
  var summarySheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!summarySheet) {
    summarySheet = ss.insertSheet(SUMMARY_SHEET_NAME);
    var headers = ['배송일', '이름', '전화번호', '자격증', 'type_code', '송장번호', '재발급'];
    summarySheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');
  }

  // 시트 전체 getLastRow()는 다른 열(송장번호 등)에 유령 값이 남으면 엉뚱하게 커져서
  // 중간에 공백이 생긴다 → 이름 열(2열) 기준으로 "값이 실제 있는 마지막 행"을 직접 찾는다
  var nameColNum  = colIdx(SUM_COL['이름']) + 1;
  var nameCol     = summarySheet.getRange(1, nameColNum, summarySheet.getMaxRows(), 1).getValues();
  var lastDataRow = 1;  // 최소 헤더(1행)
  for (var r = nameCol.length - 1; r >= 0; r--) {
    if (nameCol[r][0] !== '' && nameCol[r][0] !== null) { lastDataRow = r + 1; break; }
  }
  var insertRow = lastDataRow + 1;

  function sortByName(rows) {
    return rows.slice().sort(function(a, b) {
      var nameA = (a[idx['user_name']] || '').toString().trim();
      var nameB = (b[idx['user_name']] || '').toString().trim();
      return nameA.localeCompare(nameB, 'ko');
    });
  }

  // 입력할 모든 줄을 먼저 메모리에서 표(배열)로 만든 뒤, 한 번에 setValues로 입력
  // (칸마다 setValue 하면 구글 서버와 매번 통신 → 건수 많으면 수십 분 소요)
  var outRows = [];   // [배송일, 이름, 전화번호, 자격증, type_code, 송장번호(빈칸), 재발급]

  selectedDates.forEach(function(mmdd) {
    var group   = dateGroups[mmdd];
    var allRows = sortByName(group.baby)
      .concat(sortByName(group.korean))
      .concat(sortByName(group.ncs));

    allRows.forEach(function(row) {
      var validColIdx = idx['유효성검사'];
      if (row[validColIdx].toString().trim() === 'F') return;

      var phone       = formatPhone(row[idx['전화번호']]);
      var shipDate    = row[idx['배송일자']];
      var shipDateStr = shipDate instanceof Date
        ? Utilities.formatDate(shipDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : shipDate.toString().trim();

      outRows.push([
        shipDateStr,
        row[idx['user_name']] || '',
        phone,
        row[idx['title_with_grade']] || '',
        row[idx['type_code']] || '',
        '',        // 송장번호: 배송 업데이트 때 채워짐 (지금은 빈칸)
        reissueFlag(row, idx)
      ]);
    });
  });

  if (outRows.length > 0) {
    // 전화번호 칸은 앞자리 0 보존을 위해 텍스트 서식 → 값 입력 전에 범위 전체에 한 번만 지정
    summarySheet.getRange(insertRow, colIdx(SUM_COL['전화번호']) + 1, outRows.length, 1).setNumberFormat('@');
    // 전체를 한 번에 입력 (통신 2번)
    // ※ outRows는 배송일~재발급이 붙어 있다고 보고 한 번에 씁니다.
    //   그 사이에 열을 끼워넣으면 이 부분도 같이 손봐야 합니다.
    summarySheet.getRange(insertRow, 1, outRows.length, outRows[0].length).setValues(outRows);
  }
}

// ===== 유틸: 유효성검사 F인 행의 배송일자, 제작일자 삭제 =====
function clearDatesForInvalidRows(sheet, idx) {
  var data        = sheet.getDataRange().getValues();
  var validColIdx = idx['유효성검사'];
  var shipColIdx  = idx['배송일자'];
  var makeColIdx  = idx['제작일자'];

  data.slice(1).forEach(function(row, i) {
    var rowNum      = i + 2;
    var isInvalid   = row[validColIdx].toString().trim() === 'F';
    var hasShipDate = row[shipColIdx] !== '' && row[shipColIdx] !== null;
    var hasMakeDate = row[makeColIdx] !== '' && row[makeColIdx] !== null;

    if (isInvalid) {
      if (hasShipDate) sheet.getRange(rowNum, shipColIdx + 1).clearContent();
      if (hasMakeDate) sheet.getRange(rowNum, makeColIdx + 1).clearContent();
    }
  });
}

// ===== 유틸: 중복 행 연한 노랑 표시 =====
function highlightDuplicates(sheet, lastDataRow, nameCol, phoneCol) {
  if (lastDataRow < 3) return;

  var nameRange  = sheet.getRange(2, nameCol,  lastDataRow - 1, 1).getValues();
  var phoneRange = sheet.getRange(2, phoneCol, lastDataRow - 1, 1).getValues();

  var keys = nameRange.map(function(r, i) {
    return r[0].toString().trim() + '|' + phoneRange[i][0].toString().trim();
  });

  var seen          = {};
  var duplicateKeys = {};
  keys.forEach(function(key) {
    if (seen[key]) { duplicateKeys[key] = true; }
    else           { seen[key] = true; }
  });

  keys.forEach(function(key, i) {
    if (duplicateKeys[key]) {
      sheet.getRange(i + 2, nameCol).setBackground('#FFFF99');
    }
  });
}

// ===== 유틸: 파일을 특정 폴더로 이동 =====
function moveFileTofolder(fileId, targetFolder) {
  var file = DriveApp.getFileById(fileId);
  targetFolder.addFile(file);
  DriveApp.getRootFolder().removeFile(file);
}

// ===== 유틸: 제작일자 MMDD 변환 =====
function formatMMDD(rawDate) {
  if (!rawDate) return null;

  var date;
  if (rawDate instanceof Date) {
    date = rawDate;
  } else {
    var str      = rawDate.toString().trim();
    var korMatch = str.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (korMatch) {
      date = new Date(parseInt(korMatch[1]), parseInt(korMatch[2]) - 1, parseInt(korMatch[3]));
    } else {
      date = new Date(str);
    }
  }

  if (isNaN(date.getTime())) return null;

  var month = String(date.getMonth() + 1).padStart(2, '0');
  var day   = String(date.getDate()).padStart(2, '0');
  return month + day;
}

// ===== 유틸: 날짜 정규화 =====
function normalizeDate(rawDate) {
  if (!rawDate) return '';
  var date;
  if (rawDate instanceof Date) {
    date = rawDate;
  } else {
    var str = rawDate.toString().trim();
    var korMatch = str.match(/(\d{4})[.\-]\s*(\d{1,2})[.\-]\s*(\d{1,2})/);
    if (korMatch) {
      date = new Date(parseInt(korMatch[1]), parseInt(korMatch[2]) - 1, parseInt(korMatch[3]));
    } else {
      date = new Date(str);
    }
  }
  if (isNaN(date.getTime())) return rawDate.toString().trim();
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

// ===== 유틸: 전화번호 앞에 0 붙이기 =====
function formatPhone(phoneRaw) {
  if (!phoneRaw) return '';
  var str = phoneRaw.toString().trim();
  if (str.charAt(0) === '0') return str;
  return '0' + str;
}

// ===== 유틸: 전화번호 정규화 =====
function normalizePhone(phoneRaw) {
  if (!phoneRaw) return '';
  var str = phoneRaw.toString().trim().replace(/-/g, '');
  if (str.charAt(0) === '0') return str;
  return '0' + str;
}

// ===== 메뉴 추가 =====
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📊 업데이트')
    .addItem('📖 자격증 업데이트', 'createCertificationFiles')
    .addSeparator()
    .addSubMenu(SpreadsheetApp.getUi().createMenu('🚍 배송 업데이트')
      .addItem('베이비시터',            'updateDeliveryBaby')
      .addItem('NCS (한국검정평가원 포함)', 'updateDeliveryNCS'))
    .addItem('💰 정산표 생성', 'createSettlementTable')
    .addToUi();
}

// ============================================================
//  정산표 생성 (반월정산)
//  - 원본: 지금 보고 있는 활성 탭(정산집계 또는 그 사본)에서 읽음
//  - 결과: '정산' 탭에 생성 (기존 내용은 두고 아래에 추가, 중복 방지)
//  - 단가: 전부 하드코딩 (아래 상수만 고치면 됨)
//  ※ NCS 구간 단가의 "반월 vs 월 전체" 기준은 협의 전 → [보류] 주석 참고
// ============================================================

var OUTPUT_SHEET_NAME = '정산';
var VAT_RATE = 0.1;

// ----- 수수료 설정 (단가 바뀌면 여기만 수정) -----
var NCS_TIER = [
  { min: 0,    max: 250,   sangjang: 20000, cardAdd: 3000 },
  { min: 251,  max: 500,   sangjang: 12000, cardAdd: 3000 },
  { min: 501,  max: 650,   sangjang: 11000, cardAdd: 2500 },
  { min: 651,  max: 1000,  sangjang: 10000, cardAdd: 2000 },
  { min: 1001, max: 2500,  sangjang: 10000, cardAdd: 2000 },
  { min: 2501, max: 3750,  sangjang: 8500,  cardAdd: 2000 },
  { min: 3751, max: 5000,  sangjang: 8000,  cardAdd: 2000 },
  { min: 5001, max: 7500,  sangjang: 7500,  cardAdd: 2000 },
  { min: 7501, max: 10000, sangjang: 7000,  cardAdd: 2000 }
];
var FIXED_NORMAL_FEE = 22000;  // 한국검정평가원·베이비시터 신규 고정
var SHIPPING_FEE     = 3000;   // 배송 단가 (송장 1건당, 고정)
var REISSUE_NCS_ONE  = 10000;  // 재발급 NCS 상장 또는 카드
var REISSUE_NCS_BOTH = 15000;  // 재발급 NCS 상장+카드
var REISSUE_FIXED    = 15000;  // 재발급 한국검정평가원·베이비시터 고정

// type_code → 분류
function classifyType(raw) {
  var code = (raw || '').toString().split('|')[0].trim();
  if (code === '01') return 'sangjang';
  if (code === '02') return 'card';
  if (code === '03') return 'both';
  return 'sangjang';
}

// 구간 단가 조회
function lookupNcsTier(count) {
  for (var i = 0; i < NCS_TIER.length; i++) {
    if (count >= NCS_TIER[i].min && count <= NCS_TIER[i].max) return NCS_TIER[i];
  }
  return NCS_TIER[NCS_TIER.length - 1];
}

// 날짜 파싱
function parseDateObj(raw) {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  var s = raw.toString().trim();
  var mm = s.match(/(\d{4})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/);
  if (mm) return new Date(parseInt(mm[1]), parseInt(mm[2]) - 1, parseInt(mm[3]));
  var d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// 재발급 여부: 재발급 컬럼에 "값이 있으면" 재발급
function isReissueRow(v) {
  return (v == null ? '' : v).toString().trim() !== '';
}

// 기관 판정: 자격증분류 컬럼 우선 → 자격증매핑 보완 → 기본 ncs
function resolveAgency(row, idx, certMapping) {
  if (idx['자격증분류'] !== undefined) {
    var c = (row[idx['자격증분류']] || '').toString().trim().toLowerCase();
    if (c === 'baby' || c === 'korean' || c === 'ncs') return c;
  }
  var name = (row[idx['자격증']] || '').toString().trim();
  return certMapping[name] || 'ncs';
}

// ===== 메인 (활성 탭에서 실행) =====
function createSettlementTable() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ui = SpreadsheetApp.getUi();

  // 어느 탭에서 눌러도 항상 '정산집계' 시트를 읽는다
  var sheet = ss.getSheetByName(SUMMARY_SHEET_NAME);
  if (!sheet) {
    ui.alert('시트를 찾을 수 없습니다: ' + SUMMARY_SHEET_NAME);
    return;
  }

  var certMapping = loadCertMapping(ss) || {};   // 기존 함수 재사용(없으면 빈 맵)

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) { ui.alert('데이터가 없습니다.'); return; }
  var idx = buildIdx(SUM_COL);

  // 송장 입력된 행만, 배송일 일자로 반월 분리
  // ★ '취소' 체크된 행은 정산에서 제외 (NCS 건수 집계에서도 자동 제외됨)
  var firstHalf = [], secondHalf = [];
  values.slice(1).forEach(function(row) {
    if (idx['취소'] !== undefined && isCancelled(row[idx['취소']])) return;
    if (!(row[idx['송장번호']] || '').toString().trim()) return;
    var d = parseDateObj(row[idx['배송일']]);
    if (!d) return;
    (d.getDate() <= 15 ? firstHalf : secondHalf).push(row);
  });

  // NCS 구간 단가 = "각 반월의 NCS 건수" 기준 (계약 조건: 반월 건수 기준)
  //   1~15일분은 1~15일 건수로, 16일~말일분은 16일~말일 건수로 각각 구간을 찾는다.
  function countNcs(rows) {
    var n = 0;
    rows.forEach(function(r) { if (resolveAgency(r, idx, certMapping) === 'ncs') n++; });
    return n;
  }
  var firstNcsCount  = countNcs(firstHalf);
  var secondNcsCount = countNcs(secondHalf);
  var firstTier      = lookupNcsTier(firstNcsCount);
  var secondTier     = lookupNcsTier(secondNcsCount);

  // 결과 '정산' 탭: 기존 내용은 그대로 두고 "아래에만 추가"
  var out = ss.getSheetByName(OUTPUT_SHEET_NAME) || ss.insertSheet(OUTPUT_SHEET_NAME);

  // 이미 만들어진 반월 표는 다시 안 그림(중복 방지) — 제목으로 판단
  var existingTitles = [];
  if (out.getLastRow() > 0) {
    existingTitles = out.getRange(1, 1, out.getLastRow(), 1).getValues()
      .map(function(r) { return (r[0] || '').toString(); });
  }
  function alreadyHas(prefix) {
    return existingTitles.some(function(s) { return s.indexOf(prefix) === 0; });
  }

  var HALF1 = '1일 ~ 15일 배송분';
  var HALF2 = '16일 ~ 말일 배송분';
  var startRow = out.getLastRow() > 0 ? out.getLastRow() + 2 : 1;  // 마지막 내용 아래
  var added = [];

  if (firstHalf.length > 0 && !alreadyHas(HALF1)) {
    startRow = writeHalfTable(out, startRow, HALF1 + ' (NCS 건수 ' + firstNcsCount + ')', firstHalf, idx, certMapping, firstTier) + 1;
    added.push(HALF1);
  }
  if (secondHalf.length > 0 && !alreadyHas(HALF2)) {
    startRow = writeHalfTable(out, startRow, HALF2 + ' (NCS 건수 ' + secondNcsCount + ')', secondHalf, idx, certMapping, secondTier) + 1;
    added.push(HALF2);
  }

  out.autoResizeColumns(1, 6);
  if (added.length === 0) {
    ui.alert('추가할 새 표가 없습니다.\n(이미 생성됐거나, 해당 반월 데이터가 없습니다)\n\n처음부터 다시 만들려면 "정산" 탭을 삭제 후 실행하세요.');
  } else {
    ui.alert('"' + OUTPUT_SHEET_NAME + '" 탭 아래에 추가했습니다:\n· ' + added.join('\n· '));
  }
}

// 반월 1개분 작성 → 다음 시작행 반환
function writeHalfTable(out, startRow, title, rows, idx, certMapping, tier) {
  var agg = aggregateSettlement(rows, idx, certMapping, tier);

  out.getRange(startRow, 1).setValue(title).setFontWeight('bold').setFontSize(12);
  startRow++;

  var dataStart = startRow + 1;  // 첫 섹션(일반 발급) 헤더 다음 = 첫 데이터 행
  startRow = writeSettlementSection(out, startRow, '일반 발급', agg.normalLines);
  startRow = writeSettlementSection(out, startRow, '재발급', agg.reissueLines);
  var dataEnd = startRow - 1;     // 총계 직전 = 마지막 데이터 행

  // 총계: 각 열(D 부가세 계산전 / E 부가세 / F 부가세 포함)의 SUM
  //  - 두 섹션 사이에 끼는 헤더 행의 텍스트는 SUM이 자동으로 무시
  out.getRange(startRow, 1, 1, 6).setValues([['총계', '', '',
      '=SUM(D' + dataStart + ':D' + dataEnd + ')',
      '=SUM(E' + dataStart + ':E' + dataEnd + ')',
      '=SUM(F' + dataStart + ':F' + dataEnd + ')']])
     .setFontWeight('bold').setBackground('#FFF2CC');
  out.getRange(startRow, 4, 1, 3).setNumberFormat('₩#,##0');
  return startRow + 1;
}

// 집계
function aggregateSettlement(rows, idx, certMapping, tier) {
  var cN = { sang: 0, both: 0, korean: 0, baby: 0 };
  var cR = { sang: 0, card: 0, both: 0, korean: 0, baby: 0 };
  var shipN = {}, shipR = {};   // 송장: 일반 행에 등장 / 재발급 행에 등장

  rows.forEach(function(r) {
    var ag = resolveAgency(r, idx, certMapping);
    var ty = classifyType(r[idx['type_code']]);
    var reissue = isReissueRow(r[idx['재발급']]);
    var track = (r[idx['송장번호']] || '').toString().trim();

    if (reissue) {
      if (ag === 'korean') cR.korean++;
      else if (ag === 'baby') cR.baby++;
      else if (ty === 'both') cR.both++;
      else if (ty === 'card') cR.card++;
      else cR.sang++;
      if (track) shipR[track] = true;
    } else {
      if (ag === 'korean') cN.korean++;
      else if (ag === 'baby') cN.baby++;
      else if (ty === 'both') cN.both++;
      else cN.sang++;  // 일반은 카드단독 없음 → 상장 취급
      if (track) shipN[track] = true;
    }
  });

  // 배송 건수: 합배송으로 일반·재발급이 섞인 송장은 "일반"으로만 카운트
  var shipNormalCount  = Object.keys(shipN).length;
  var shipReissueCount = Object.keys(shipR).filter(function(t) { return !shipN[t]; }).length;

  function line(label, count, unit) {
    var supply = count * unit, vat = Math.round(supply * VAT_RATE);
    return { label: label, count: count, unit: unit, supply: supply, vat: vat, total: supply + vat };
  }

  return {
    normalLines: [
      line('상장', cN.sang, tier.sangjang),
      line('상장+카드형', cN.both, tier.sangjang + tier.cardAdd),
      line('한국검정평가원', cN.korean, FIXED_NORMAL_FEE),
      line('베이비시터', cN.baby, FIXED_NORMAL_FEE),
      line('배송', shipNormalCount, SHIPPING_FEE)
    ],
    reissueLines: [
      line('상장', cR.sang, REISSUE_NCS_ONE),
      line('카드', cR.card, REISSUE_NCS_ONE),
      line('상장+카드형', cR.both, REISSUE_NCS_BOTH),
      line('한국검정평가원', cR.korean, REISSUE_FIXED),
      line('베이비시터', cR.baby, REISSUE_FIXED),
      line('배송', shipReissueCount, SHIPPING_FEE)
    ]
  };
}

// 섹션 출력
function writeSettlementSection(out, startRow, name, lines) {
  out.getRange(startRow, 1, 1, 6)
     .setValues([[name, '건수', '금액', '부가세 계산전', '부가세', '부가세 포함']])
     .setFontWeight('bold').setBackground('#4472C4').setFontColor('#FFFFFF');
  startRow++;
  var vals = lines.map(function(l, i) {
    var r = startRow + i;  // 이 줄이 시트에서 실제 위치할 행 번호
    return [l.label, l.count, l.unit,
            '=B' + r + '*C' + r,   // 부가세 계산전 = 건수 × 금액
            '=D' + r + '*0.1',     // 부가세 = 부가세 계산전 × 0.1
            '=D' + r + '+E' + r];  // 부가세 포함 = 부가세 계산전 + 부가세
  });
  out.getRange(startRow, 1, vals.length, 6).setValues(vals);
  out.getRange(startRow, 2, vals.length, 5).setNumberFormat('#,##0');
  return startRow + vals.length;
}

// ============================================================
//  취소 처리 (정산 누락 방지)
//  - 정산집계 시트 '취소' 칸에 체크하면 그 건은 정산표 생성 시 자동 제외
//  - 체크하면 바로 옆 I열(취소일)에 오늘 날짜 자동 입력 (onEdit)
// ============================================================

// 취소 여부 판정 (체크박스 TRUE 또는 텍스트 '취소'/'Y'/'O' 등)
function isCancelled(v) {
  if (v === true) return true;
  var s = (v == null ? '' : v).toString().trim().toUpperCase();
  return s === 'TRUE' || s === '취소' || s === 'Y' || s === 'O' || s === 'V';
}

// 취소 체크 시 취소일 칸에 오늘 날짜 자동 기록 (체크 해제 시 삭제)
function onEdit(e) {
  // 에러 방지 및 기본 조건 검사 (가장 빠르게 튕겨냄)
  if (!e || !e.range) return;
  if (e.range.getColumn() !== colIdx(SUM_COL['취소']) + 1 || e.range.getRow() < 2) return;

  var sheet = e.source.getActiveSheet();
  if (sheet.getName() !== SUMMARY_SHEET_NAME) return;

  // 여러 셀을 동시에 지우거나 수정할 때 에러 방지
  if (e.range.getNumRows() > 1) return;

  // 시트가 렉이 걸려있을 때 getValue() 대기 시간을 최소화하기 위해 e.value 우선 사용
  var val = e.value;
  var dateCell = sheet.getRange(e.range.getRow(), colIdx(SUM_COL['취소일']) + 1);

  if (val === "TRUE" || val === "true") {
    dateCell.setValue(Utilities.formatDate(new Date(), "Asia/Seoul", 'yyyy-MM-dd'));
  }
  else if (val === "FALSE" || val === "false" || val === undefined) {
    dateCell.clearContent();
  }
}
