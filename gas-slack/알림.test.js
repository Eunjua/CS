// 어떤 편집에 알림이 가고 어떤 편집에 안 가는지 점검
// 실행: node gas-slack/알림.test.js   (통과하면 아무것도 안 나오고, 틀리면 에러)
var assert = require('assert');
var fs = require('fs');
eval(fs.readFileSync(__dirname + '/Code.js', 'utf8'));
// ※ Code.js의 const는 eval 밖으로 안 새서, 열 번호는 아래에 숫자로 직접 적는다

// --- Apps Script 흉내 ---
var 보낸것 = null;
슬랙보내기 = function (문구) { 보낸것 = 문구; };
PropertiesService = { getScriptProperties: function () {
  return { getProperty: function () { return '{"홍길동":"U000TEST"}'; } };
} };

// 행 내용을 주면 그 행을 편집한 것처럼 만들어 준다.
// 스크립트가 시트에 쓴 값은 행값 배열에 그대로 반영돼, 날짜가 찍혔는지 확인할 수 있다.
function 편집(행값, 행, 열, 옛값) {
  var 셀 = {
    getNumRows: function () { return 1; },
    getNumColumns: function () { return 1; },
    getRow: function () { return 행; },
    getColumn: function () { return 열; },
    getValue: function () { return 행값[열 - 1]; },
    getSheet: function () {
      return {
        getRange: function (r, c, numR) {
          if (numR) return { getValues: function () { return [행값.slice(0, 4)]; } };
          return {                                  // 단일 칸 (날짜채우기용)
            getValue: function () { return 행값[c - 1]; },
            setValue: function (v) { 행값[c - 1] = v; },
            setNumberFormat: function () {}
          };
        },
        getParent: function () { return { getUrl: function () { return 'URL'; } }; }
      };
    }
  };
  보낸것 = null;
  시트수정감지({ range: 셀, oldValue: 옛값 });
  return 보낸것;
}

var 빈칸 = undefined;
var 다참 = ['9/9', '홍길동', '홍길동', '주소 확인 부탁드립니다', '', '', ''];

// 새 요청: 마지막 빈칸(D)을 채우는 순간 한 번 발송
var 새요청 = 편집(다참, 2, 4 /* D 요청 내용 */, 빈칸);
assert.ok(새요청, '세 칸이 다 찼으면 발송해야 한다');
assert.ok(새요청.indexOf('요청사항을 확인해주세요') !== -1);
assert.ok(새요청.indexOf('<@U000TEST>') !== -1, '담당자가 멘션으로 바뀌어야 한다');

// 이미 값이 있던 칸을 고친 것 → 수정이지 새 요청이 아니다
assert.strictEqual(편집(다참, 2, 4 /* D 요청 내용 */, '예전 내용'), null);

// 담당자만 채우고 요청 내용이 비어 있으면 아직 아니다
assert.strictEqual(편집(['9/9', '홍길동', '홍길동', '', '', '', ''], 2, 3 /* C 담당자 */, 빈칸), null);

// 처리 사항 입력 → 처리 완료 알림, 이때는 요청자를 멘션
var 완료 = 편집(['9/9', '홍길동', '홍길동', '주소 확인', '101동 603호', '', ''], 2, 5 /* E 처리 사항 */, 빈칸);
assert.ok(완료.indexOf('주소확인 요청 처리 완료') !== -1);
assert.ok(완료.indexOf('101동 603호') !== -1);

// 처리 사항을 지운 경우엔 안 보낸다
assert.strictEqual(편집(['9/9', '홍길동', '홍길동', '주소 확인', '', '', ''], 2, 5 /* E 처리 사항 */, '101동 603호'), null);

// 헤더 행과 상관없는 열은 무시
assert.strictEqual(편집(다참, 1, 4 /* D 요청 내용 */, 빈칸), null, '헤더 행은 무시');
assert.strictEqual(편집(다참, 2, 6, 빈칸), null, '비고(F)열은 무시');

// 옛 이름 트리거가 그대로 남아 있어도 동작해야 한다
보낸것 = null;
E열입력알림({ range: { getNumRows: function () { return 1; }, getNumColumns: function () { return 1; },
  getRow: function () { return 1; }, getColumn: function () { return 1; } } });

// --- 날짜 자동 입력 ---
var 새행 = ['', '홍길동', '홍길동', '주소 확인 부탁드립니다', '', '', ''];
편집(새행, 2, 4 /* D 요청 내용 */, 빈칸);
assert.ok(새행[0] instanceof Date, 'A열이 비어 있으면 오늘 날짜가 찍혀야 한다');

var 날짜있는행 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '', '', ''];
편집(날짜있는행, 2, 4 /* D 요청 내용 */, 빈칸);
assert.strictEqual(날짜있는행[0], '2026. 9. 7', '이미 적힌 날짜는 건드리지 않는다');

var 처리행 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 603호', '', ''];
편집(처리행, 2, 5 /* E 처리 사항 */, 빈칸);
assert.ok(처리행[6] instanceof Date, 'E에 값이 들어오면 G에 처리 날짜가 찍혀야 한다');

var 이미처리 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 603호 수정', '', '2026. 9. 8'];
편집(이미처리, 2, 5 /* E 처리 사항 */, '101동 603호');
assert.strictEqual(이미처리[6], '2026. 9. 8', '처리 날짜는 처음 값을 유지한다 (가안)');

var 지운행 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '', '', ''];
편집(지운행, 2, 5 /* E 처리 사항 */, '101동 603호');
assert.strictEqual(지운행[6], '', '처리 사항을 지웠으면 처리 날짜도 안 찍는다');
