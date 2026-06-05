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
    function buildSummaryMap(keyFn) {
      var map = {};
      for (var r = 1; r < summaryData.length; r++) {
        var sRow   = summaryData[r];
        var sTrack = sRow[sIdx['송장번호']] ? sRow[sIdx['송장번호']].toString().trim() : '';
        if (sTrack !== '') continue;

        var certName = sRow[sIdx['자격증']] ? sRow[sIdx['자격증']].toString().trim() : '';
        var certType = getCertType(certName);
        if (certType !== type) continue;

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

      var ncsMap = buildSummaryMap(function(sRow) {
        var sDate   = normalizeDate(sRow[sIdx['배송일']]);
        var sName   = sRow[sIdx['이름']] ? sRow[sIdx['이름']].toString().trim() : '';
        var sPhone7 = normalizePhone(sRow[sIdx['전화번호']]).substring(0, 7);
        if (!sDate || !sName || sPhone7.length !== 7) return null;
        return sDate + '|' + sName + '|' + sPhone7;
      });

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

  var lastRow   = summarySheet.getLastRow();
  var insertRow = lastRow + 1;

  function sortByName(rows) {
    return rows.slice().sort(function(a, b) {
      var nameA = (a[idx['user_name']] || '').toString().trim();
      var nameB = (b[idx['user_name']] || '').toString().trim();
      return nameA.localeCompare(nameB, 'ko');
    });
  }

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

      summarySheet.getRange(insertRow, 1).setValue(shipDateStr);
      summarySheet.getRange(insertRow, 2).setValue(row[idx['user_name']] || '');
      setCellText(summarySheet, insertRow, 3, phone);
      summarySheet.getRange(insertRow, 4).setValue(row[idx['title_with_grade']] || '');
      summarySheet.getRange(insertRow, 5).setValue(row[idx['type_code']] || '');
      summarySheet.getRange(insertRow, 7).setValue(remark);
      insertRow++;
    });
  });
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
    .addToUi();
}
