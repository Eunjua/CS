// 열 알파벳 → 배열 번호 변환 점검
// 실행: node gas-cert/colIdx.test.js   (통과하면 아무것도 안 나오고, 틀리면 에러)
var assert = require('assert');
var fs = require('fs');
var src = fs.readFileSync(__dirname + '/Code.js', 'utf8');
eval(src.slice(0, src.indexOf('// ===== 자격증매핑 시트 로드 =====')));

// 기본 변환
assert.strictEqual(colIdx('A'), 0);
assert.strictEqual(colIdx('B'), 1);
assert.strictEqual(colIdx('Z'), 25);
assert.strictEqual(colIdx('AA'), 26);
assert.strictEqual(colIdx('a'), 0);      // 소문자도 인정

// 제작리스트: 은주가 알려준 열과 일치하는지
var src_idx = buildIdx(SRC_COL);
assert.strictEqual(src_idx['배송일자'], 0);           // A
assert.strictEqual(src_idx['제작일자'], 1);           // B
assert.strictEqual(src_idx['user_name'], 3);          // D 이름
assert.strictEqual(src_idx['year'], 4);               // E 생년
assert.strictEqual(src_idx['month'], 5);              // F 생월
assert.strictEqual(src_idx['day'], 6);                // G 생일
assert.strictEqual(src_idx['전화번호'], 7);           // H
assert.strictEqual(src_idx['title_with_grade'], 8);   // I 자격증명
assert.strictEqual(src_idx['type_code'], 9);          // J 자격증형태
assert.strictEqual(src_idx['주소'], 10);              // K
assert.strictEqual(src_idx['exam_score'], 12);        // M 시험점수
assert.strictEqual(src_idx['유효성검사'], 13);        // N
assert.strictEqual(src_idx['재발급'], 15);            // P
assert.strictEqual(src_idx['재발급 사유'], 16);       // Q
assert.strictEqual(src_idx['상세주소'], 17);          // R
assert.strictEqual(src_idx['비고'], 19);              // T

// 정산집계: 스크립트가 쓰는 순서(A~I) 그대로인지
var sum_idx = buildIdx(SUM_COL);
['배송일','이름','전화번호','자격증','type_code','송장번호','재발급','취소','취소일']
  .forEach(function(name, i) { assert.strictEqual(sum_idx[name], i, name); });

// 배송 시트: 바꾸기 전 코드가 쓰던 번호와 같은지 (동작 안 바뀌었는지 확인)
var b = buildIdx(DBABY_COL);
assert.deepStrictEqual([b['배송일'], b['이름'], b['전화번호'], b['송장번호']], [0, 3, 6, 7]);
var nn = buildIdx(DNCS_COL);
assert.deepStrictEqual([nn['배송일'], nn['송장번호'], nn['이름'], nn['전화번호']], [0, 8, 18, 19]);
var c = buildIdx(COURSE_COL);
assert.deepStrictEqual([c['과정명'], c['코드번호'], c['자격증형태'], c['결제금액']], [0, 1, 4, 5]);

// 기관 판정: 자격증매핑 B열(자격증분류)을 실제로 따라가는지
eval(fs.readFileSync(__dirname + '/Code.js', 'utf8'));
var 매핑 = { '베이비시터 1급': 'baby', '심리상담사 2급': 'korean' };
var sum = buildIdx(SUM_COL);
function 행(자격증) { var r = []; r[sum['자격증']] = 자격증; return r; }
assert.strictEqual(resolveAgency(행('베이비시터 1급'), sum, 매핑), 'baby');
assert.strictEqual(resolveAgency(행('심리상담사 2급'), sum, 매핑), 'korean');
assert.strictEqual(resolveAgency(행('요양보호사'), sum, 매핑), 'ncs');   // 매핑에 없으면 ncs

// ===== 배송확인리스트 색칠: 사람 단위로 묶이는지 =====
var si = buildIdx(SRC_COL);
function 행2(이름, 번호) { var r = []; r[si['user_name']] = 이름; r[si['전화번호']] = 번호; return r; }
function 색(rows) { return personRowColors(rows, si); }

// 이름이 한 번만 나오면 색 없음
assert.deepStrictEqual(색([행2('이민수', '01044445555')]), [null]);

// 같은 사람 2건 (동명이인 없음) → 둘 다 연한 하늘색
assert.deepStrictEqual(
  색([행2('박철수', '01033334444'), 행2('박철수', '01033334444')]),
  [SAME_PERSON_COLOR, SAME_PERSON_COLOR]
);

// 전화번호 표기가 달라도(0 빠짐, 하이픈) 같은 사람으로 묶임
assert.deepStrictEqual(
  색([행2('박철수', '1033334444'), 행2('박철수', '010-3333-4444')]),
  [SAME_PERSON_COLOR, SAME_PERSON_COLOR]
);

// 동명이인 각 1건 → 서로 다른 색, 하늘색은 쓰지 않음
var c3 = 색([행2('김영희', '01011112222'), 행2('김영희', '01022223333')]);
assert.notStrictEqual(c3[0], c3[1], '동명이인은 다른 색이어야 함');
c3.forEach(function(c) {
  assert.ok(c, '동명이인은 색이 있어야 함');
  assert.notStrictEqual(c, SAME_PERSON_COLOR, '동명이인에 하늘색을 쓰면 안 됨');
});

// 동명이인 + 그중 한 명이 2건 → 그 사람 행은 같은 색, 다른 동명이인은 다른 색
var c4 = 색([
  행2('김영희', '01011112222'),
  행2('김영희', '01011112222'),
  행2('김영희', '01022223333')
]);
assert.strictEqual(c4[0], c4[1], '같은 사람의 2건은 같은 색');
assert.notStrictEqual(c4[0], c4[2], '동명이인은 다른 색');
c4.forEach(function(c) { assert.notStrictEqual(c, SAME_PERSON_COLOR); });

// 동명이인 그룹이 연달아 나와도 색이 겹치지 않음 (이름순 정렬이라 붙어서 나옴)
var c5 = 색([
  행2('김영희', '01011112222'),
  행2('김영희', '01022223333'),
  행2('이민수', '01033334444'),
  행2('이민수', '01044445555')
]);
assert.strictEqual(new Set(c5).size, 4, '연달아 나오는 동명이인 4명은 색이 모두 달라야 함');

// 이름 빈 행은 서로 묶이지 않음
assert.deepStrictEqual(색([행2('', '01011112222'), 행2('', '01099998888')]), [null, null]);

// ===== 송장업로드: order_id 열 위치 =====
assert.strictEqual(src_idx['order_id'], 11);   // L

// ===== 송장업로드: 품목명 =====
// order_id 맨 뒤 조각만 씀
assert.strictEqual(orderCode('01M107REA2P87DJEKH6ER5XDZV-certification-47-zf1ngxq1d8'), 'zf1ngxq1d8');
assert.strictEqual(orderCode(''), '');
assert.strictEqual(orderCode(null), '');

// certification- 뒤 숫자만 뽑음
assert.strictEqual(certNo('01M23875BHZJ6EK9P1H5FXYRM8-certification-51-6owmlpj2tp'), '51');
assert.strictEqual(certNo('a-b-code1'), '');   // 형식이 다르면 빈 값
assert.strictEqual(certNo(''), '');
assert.strictEqual(certNo(null), '');

// 품목명: 주문코드(자격증번호)
assert.strictEqual(buildItemName(['01M2-certification-51-6owmlpj2tp']), '6owmlpj2tp(51)');
// 자격증 여러 개 → 번호를 나열, 주문코드는 첫 건 것
assert.strictEqual(
  buildItemName(['01M2-certification-51-6owmlpj2tp', '01M3-certification-52-abc123']),
  '6owmlpj2tp(51,52)'
);
// 같은 번호가 두 번 나오면 한 번만
assert.strictEqual(
  buildItemName(['01M2-certification-51-6owmlpj2tp', '01M2-certification-51-6owmlpj2tp']),
  '6owmlpj2tp(51)'
);
// 형식이 다르거나 비어 있으면 괄호만
assert.strictEqual(buildItemName(['a-b-code1']), 'code1()');
assert.strictEqual(buildItemName([]), '()');

// ===== 송장업로드: 사람 단위로 묶이는지 =====
function 행3(이름, 번호, 주소, 자격증, 주문) {
  var r = [];
  r[si['user_name']]        = 이름;
  r[si['전화번호']]          = 번호;
  r[si['주소']]             = 주소;
  r[si['title_with_grade']] = 자격증;
  r[si['order_id']]         = 주문;
  return r;
}
var ORD  = '01M107REA2P87DJEKH6ER5XDZV-certification-47-zf1ngxq1d8';
var ORD2 = '01M107REA2P87DJEKH6ER5XDZW-certification-52-abc123';

// 같은 사람 2건 → 1행, 품목명에 자격증번호 2개
assert.deepStrictEqual(
  buildInvoiceRows([
    행3('최수민', '01055556666', '서울시 강남구', '병원동행매니저 1급', ORD),
    행3('최수민', '01055556666', '서울시 강남구', '학교안전지도사 1급', ORD2)
  ], si),
  [['최수민', '01055556666', '', '서울시 강남구', 'zf1ngxq1d8(47,52)', '']]
);

// 동명이인(번호 다름) → 각각 1행
var inv2 = buildInvoiceRows([
  행3('최수민', '01055556666', '주소A', '병원동행매니저 1급', ORD),
  행3('최수민', '01055551234', '주소B', '학교안전지도사 1급', ORD2)
], si);
assert.strictEqual(inv2.length, 2, '동명이인은 따로 나와야 함');
assert.strictEqual(inv2[0][4], 'zf1ngxq1d8(47)');
assert.strictEqual(inv2[1][4], 'abc123(52)');

// 전화번호 표기가 달라도 같은 사람으로 묶임 + 앞자리 0 붙음
var inv3 = buildInvoiceRows([
  행3('박철수', '010-3333-4444', '주소', '탐정사 1급', ORD),
  행3('박철수', '1033334444', '주소', '펫시터 1급', ORD)
], si);
assert.strictEqual(inv3.length, 1);
assert.strictEqual(inv3[0][1], '01033334444');

// order_id가 비어 있으면 코드 없이 괄호만
assert.strictEqual(
  buildInvoiceRows([행3('윤지은', '01012345678', '주소', '병원동행매니저 1급', '')], si)[0][4],
  '()'
);

// 앞 행 order_id가 비고 뒤 행에 있으면 뒤 행 값을 씀
assert.strictEqual(
  buildInvoiceRows([
    행3('윤지은', '01012345678', '주소', '병원동행매니저 1급', ''),
    행3('윤지은', '01012345678', '주소', '학교안전지도사 1급', ORD)
  ], si)[0][4],
  'zf1ngxq1d8(47)'
);

// 이름 빈 행은 제외
assert.deepStrictEqual(buildInvoiceRows([행3('', '01012345678', '주소', '탐정사 1급', ORD)], si), []);

// ===== 배송확인리스트: 발급형태 (상장+카드는 표시 안 함) =====
assert.strictEqual(formatIssueType('01|상장'), '상장');
assert.strictEqual(formatIssueType('02|카드'), '카드');
assert.strictEqual(formatIssueType('03|'), '');          // 상장+카드 → 빈칸
assert.strictEqual(formatIssueType('03'), '');
assert.strictEqual(formatIssueType(''), '');
assert.strictEqual(formatIssueType('99|기타'), '99|기타');  // 모르는 값은 원래대로

// ===== 재발급 remark: 재발급 사유가 실리는지 =====
function 행4(재발급, 사유, 비고) {
  var r = [];
  r[si['재발급']]      = 재발급;
  r[si['재발급 사유']] = 사유;
  r[si['비고']]        = 비고;
  return r;
}
// 재발급 + 사유 → 재발급/사유
assert.strictEqual(buildRemark(행4(true, '분실', '엉뚱한값'), si), '재발급/분실');
assert.strictEqual(buildRemark(행4('T', '이름 오기재', ''), si), '재발급/이름 오기재');
// 재발급인데 사유 없음 → '재발급'만
assert.strictEqual(buildRemark(행4(true, '', ''), si), '재발급');
// 재발급 아님 → 사유가 있어도 빈칸
assert.strictEqual(buildRemark(행4('', '분실', ''), si), '');
assert.strictEqual(buildRemark(행4(false, '분실', ''), si), '');
// 비고 열은 더 이상 remark에 안 들어감
assert.strictEqual(buildRemark(행4(true, '', '비고내용'), si), '재발급');
