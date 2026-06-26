/**
 * 보살핌 자격증 발급 파일 생성 스크립트
 */

// ===== 설정값 =====
var TARGET_FOLDER_ID           = '13dZAvuCdn4z8g5CBpYhXvzdxSXlrqodA';
var SOURCE_SHEET_NAME          = '제작리스트';
var COURSE_SHEET_NAME          = '발급과정';
var CERT_MAPPING_SHEET_NAME    = '자격증매핑';
var DELIVERY_BABY_SHEET_NAME   = '[배송]베이비시터';
var DELIVERY_NCS_SHEET_NAME    = '[배송]NCS';
var DELIVERY_KOREAN_SHEET_NAME = '[배송]한국검정평가원';

// ===== 자격증매핑 시트 로드 =====
function loadCertMapping(ss) {
  var sheet = ss.getSheetByName(CERT_MAPPING_SHEET_NAME);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + CERT_MAPPING_SHEET_NAME);
    return null;
  }

  var data = sheet.getDataRange().getValues();
  var map  = {};

  data.slice(1).forEach(function(row) {
    var certName = row[0] ? row[0].toString().trim() : '';
    var certType = row[1] ? row[1].toString().trim().toLowerCase() : '';
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
  var headers    = sourceData[0];
  var rows       = sourceData.slice(1).filter(function(row) {
    return row.some(function(cell) { return cell !== ''; });
  });

  var idx = {};
  headers.forEach(function(h, i) { idx[h.toString().trim()] = i; });

  var courseData    = courseSheet.getDataRange().getValues();
  var courseCodeMap = {};
  var typeAmountMap = {};

  courseData.forEach(function(row) {
    var courseName = row[0] ? row[0].toString().trim() : '';
    var codeNum    = row[1] ? row[1].toString().trim() : '';
    var typeCode   = row[4] ? row[4].toString().trim() : '';
    var amount     = row[5] !== undefined ? row[5] : '';
    if (courseName && codeNum) courseCodeMap[courseName] = codeNum;
    if (typeCode && amount !== '') typeAmountMap[typeCode] = amount;
  });

  var validColIdx  = idx['유효성검사'] !== undefined ? idx['유효성검사'] : 13;
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
    if (group.baby.length > 0)   { createBabyOrKoreanFile(folder, mmdd + '_보살핌_베이비시터',   group.baby,   idx); createdCount++; }
    if (group.korean.length > 0) { createBabyOrKoreanFile(folder, mmdd + '_보살핌_한국검정평가원', group.korean, idx); createdCount++; }
    if (group.ncs.length > 0)    { createNCSFile(folder, mmdd + '_보살핌_NCS', group.ncs, idx, courseCodeMap, typeAmountMap); createdCount++; }

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

// ===== 배송 업데이트 - NCS =====
function updateDeliveryNCS() {
  updateDeliveryTracking('ncs');
}

// ===== 배송 업데이트 - 한국검정평가원 =====
function updateDeliveryKorean() {
  updateDeliveryTracking('korean');
}

// ===== 배송 업데이트 공통 함수 =====
  function updateDeliveryTracking(type) {
    var ss           = SpreadsheetApp.getActiveSpreadsheet();
    var summarySheet = ss.getSheetByName('정산집계');

    if (!summarySheet) {
      SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: 정산집계');
      return;
    }

    var certMapping = loadCertMapping(ss);
    if (!certMapping) return;

    var summaryData    = summarySheet.getDataRange().getValues();
    var summaryHeaders = summaryData[0];
    var sIdx           = {};
    summaryHeaders.forEach(function(h, i) { sIdx[h.toString().trim()] = i; });

    var requiredCols = ['배송일', '이름', '전화번호', '자격증', '송장번호'];
    for (var c = 0; c < requiredCols.length; c++) {
      if (sIdx[requiredCols[c]] === undefined) {
        SpreadsheetApp.getUi().alert('정산집계 시트에 필수 컬럼이 없습니다: ' + requiredCols[c]);
        return;
      }
    }

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
      var babyRows = babyData.slice(1).filter(function(row) {
        return row[7] && row[7].toString().trim() !== '';
      });
      totalCount = babyRows.length;

      babyRows.forEach(function(dRow) {
        var dDate     = normalizeDate(dRow[0]);
        var dName     = dRow[3].toString().trim();
        var dPhone    = normalizePhone(dRow[6]);
        var dTracking = dRow[7].toString().trim();
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
      var ncsRows = ncsData.slice(1).filter(function(row) {
        return row[8] && row[8].toString().trim() !== '';
      });
      totalCount = ncsRows.length;

      ncsRows.forEach(function(nRow) {
        var nDate     = normalizeDate(nRow[0]);
        var nName     = nRow[18].toString().trim();
        var nPhone7   = normalizePhone(nRow[19].toString().trim()).substring(0, 7);
        var nTracking = nRow[8].toString().trim();
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

    if (type === 'korean') {
      var deliveryKoreanSheet = ss.getSheetByName(DELIVERY_KOREAN_SHEET_NAME);
      if (!deliveryKoreanSheet) {
        SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다: ' + DELIVERY_KOREAN_SHEET_NAME);
        return;
      }

      var koreanMap = buildSummaryMap(function(sRow) {
        var sDate  = normalizeDate(sRow[sIdx['배송일']]);
        var sName  = sRow[sIdx['이름']] ? sRow[sIdx['이름']].toString().trim() : '';
        var sPhone = normalizePhone(sRow[sIdx['전화번호']]);
        if (!sDate || !sName || !sPhone) return null;
        return sDate + '|' + sName + '|' + sPhone;
      });

      var koreanData = deliveryKoreanSheet.getDataRange().getValues();
      var koreanRows = koreanData.slice(1).filter(function(row) {
        return row[8] && row[8].toString().trim() !== '';
      });
      totalCount = koreanRows.length;

      koreanRows.forEach(function(kRow) {
        var kDate     = normalizeDate(kRow[0]);
        var kName     = kRow[3].toString().trim();
        var kPhone    = normalizePhone(kRow[4].toString().trim());
        var kTracking = kRow[8].toString().trim();
        var key = kDate + '|' + kName + '|' + kPhone;
        var n = applyTracking(koreanMap, key, kTracking);
        if (n > 0) { matchCount++; filledCount += n; }
      });

      SpreadsheetApp.getUi().alert(
        '한국검정평가원 배송 업데이트 완료!\n\n' +
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

// ===== 재발급/비고 remark 생성 유틸 =====
function buildRemark(row, idx) {
  var isReissue = row[idx['재발급']];
  var bigoVal   = (row[idx['비고']] || '').toString().trim();
  var remark    = '';

  if (isReissue === true || isReissue === 'true' || isReissue === 'TRUE') {
    remark = bigoVal ? '재발급/' + bigoVal : '재발급';
  }

  return remark;
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
  var headers = ['제작일자', '이름', '생년월일', '전화번호', '종목', '발급형태', '주소', '재발급'];

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
    var remark    = buildRemark(row, idx);

    sheet.getRange(rowNum, 1).setValue(makeDate);
    sheet.getRange(rowNum, 2).setValue(row[idx['user_name']] || '');
    setCellText(sheet, rowNum, 3, birthday);   // 앞자리 0 보존 위해 텍스트
    setCellText(sheet, rowNum, 4, phone);      // 앞자리 0 보존 위해 텍스트
    sheet.getRange(rowNum, 5).setValue(row[idx['title_with_grade']] || '');
    sheet.getRange(rowNum, 6).setValue(issueType);
    sheet.getRange(rowNum, 7).setValue(row[idx['주소']] || '');
    sheet.getRange(rowNum, 8).setValue(remark);
  });

  highlightDuplicates(sheet, rows.length + 1, 2, 4);   // 이름(2)+전화번호(4) 같으면 이름열 색칠
  sheet.autoResizeColumns(1, headers.length);
  moveFileTofolder(newSS.getId(), folder);
}

// ===== 정산집계 시트에 데이터 추가 =====
function appendToSummarySheet(ss, selectedDates, dateGroups, idx) {
  var summarySheet = ss.getSheetByName('정산집계');
  if (!summarySheet) {
    summarySheet = ss.insertSheet('정산집계');
    var headers = ['배송일', '이름', '전화번호', '자격증', 'type_code', '송장번호', '재발급'];
    summarySheet.getRange(1, 1, 1, headers.length).setValues([headers])
      .setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');
  }

  // 시트 전체 getLastRow()는 다른 열(송장번호 등)에 유령 값이 남으면 엉뚱하게 커져서
  // 중간에 공백이 생긴다 → 이름 열(2열) 기준으로 "값이 실제 있는 마지막 행"을 직접 찾는다
  var nameCol     = summarySheet.getRange(1, 2, summarySheet.getMaxRows(), 1).getValues();
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
      var validColIdx = idx['유효성검사'] !== undefined ? idx['유효성검사'] : 13;
      if (row[validColIdx].toString().trim() === 'F') return;

      var phone       = formatPhone(row[idx['전화번호']]);
      var shipDate    = row[idx['배송일자']];
      var shipDateStr = shipDate instanceof Date
        ? Utilities.formatDate(shipDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : shipDate.toString().trim();
      var remark      = buildRemark(row, idx);

      outRows.push([
        shipDateStr,
        row[idx['user_name']] || '',
        phone,
        row[idx['title_with_grade']] || '',
        row[idx['type_code']] || '',
        '',        // 송장번호: 배송 업데이트 때 채워짐 (지금은 빈칸)
        remark
      ]);
    });
  });

  if (outRows.length > 0) {
    // 전화번호 칸(3열)은 앞자리 0 보존을 위해 텍스트 서식 → 값 입력 전에 범위 전체에 한 번만 지정
    summarySheet.getRange(insertRow, 3, outRows.length, 1).setNumberFormat('@');
    // 전체를 한 번에 입력 (통신 2번)
    summarySheet.getRange(insertRow, 1, outRows.length, 7).setValues(outRows);
  }
}

// ===== 유틸: 유효성검사 F인 행의 배송일자, 제작일자 삭제 =====
function clearDatesForInvalidRows(sheet, idx) {
  var data        = sheet.getDataRange().getValues();
  var validColIdx = idx['유효성검사'] !== undefined ? idx['유효성검사'] : 13;
  var shipColIdx  = idx['배송일자']   !== undefined ? idx['배송일자']   : 0;
  var makeColIdx  = idx['제작일자']   !== undefined ? idx['제작일자']   : 1;

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
      .addItem('베이비시터',     'updateDeliveryBaby')
      .addItem('NCS',           'updateDeliveryNCS')
      .addItem('한국검정평가원', 'updateDeliveryKorean'))
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
  var sheet = ss.getActiveSheet();

  if (sheet.getName() === OUTPUT_SHEET_NAME) {
    ui.alert('여기는 결과 탭입니다.\n원본 데이터 탭(정산집계 등)을 연 상태에서 실행해주세요.');
    return;
  }

  var certMapping = loadCertMapping(ss) || {};   // 기존 함수 재사용(없으면 빈 맵)

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) { ui.alert('데이터가 없습니다.'); return; }
  var idx = {};
  values[0].forEach(function(h, i) { idx[h.toString().trim()] = i; });

  var need = ['배송일', '자격증', 'type_code', '송장번호', '재발급'];
  for (var c = 0; c < need.length; c++) {
    if (idx[need[c]] === undefined) {
      ui.alert('이 탭에 "' + need[c] + '" 컬럼이 없습니다.\n원본 데이터 탭에서 실행해주세요.');
      return;
    }
  }

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

  // ★[보류] NCS 구간 단가 = "이 탭 전체 NCS 건수" 기준.
  //   반월별로 바꾸려면 monthNcsCount 대신 각 half 건수를 lookupNcsTier에 넣으세요.
  function countNcs(rows) {
    var n = 0;
    rows.forEach(function(r) { if (resolveAgency(r, idx, certMapping) === 'ncs') n++; });
    return n;
  }
  var monthNcsCount = countNcs(firstHalf) + countNcs(secondHalf);
  var tier = lookupNcsTier(monthNcsCount);

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
    startRow = writeHalfTable(out, startRow, HALF1 + ' (NCS 건수 ' + monthNcsCount + ')', firstHalf, idx, certMapping, tier) + 1;
    added.push(HALF1);
  }
  if (secondHalf.length > 0 && !alreadyHas(HALF2)) {
    startRow = writeHalfTable(out, startRow, HALF2 + ' (NCS 건수 ' + monthNcsCount + ')', secondHalf, idx, certMapping, tier) + 1;
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

// 취소 체크 시 바로 옆 칸(I열)에 취소일 자동 기록 (체크 해제 시 삭제)
function onEdit(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== '정산집계') return;

    var lastCol = sheet.getLastColumn();
    if (lastCol < 1) return;
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var cancelCol = 0;
    headers.forEach(function(h, i) { if (h.toString().trim() === '취소') cancelCol = i + 1; });
    if (cancelCol === 0) return;   // '취소' 칸을 못 찾으면 아무것도 안 함

    var row = e.range.getRow();
    var col = e.range.getColumn();
    if (col !== cancelCol || row < 2) return;

    var dateCol = cancelCol + 1;   // 취소 바로 옆 칸 (= I열)
    if (isCancelled(e.range.getValue())) {   // 체크박스 TRUE 또는 '취소' 글자 모두 인정
      var today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
      sheet.getRange(row, dateCol).setValue(today);
    } else {
      sheet.getRange(row, dateCol).clearContent();
    }
  } catch (err) {
    // onEdit는 조용히 실패해도 시트 사용에 지장 없도록 무시
  }
}
