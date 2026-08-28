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
assert.strictEqual(src_idx['상세주소'], 16);          // Q
assert.strictEqual(src_idx['비고'], 18);              // S

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
