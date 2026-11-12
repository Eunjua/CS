// 어떤 편집에 알림이 가고 어떤 편집에 안 가는지 점검
// 실행: node gas/slack/알림.test.js   (통과하면 아무것도 안 나오고, 틀리면 에러)
var assert = require('assert');
var fs = require('fs');
eval(fs.readFileSync(__dirname + '/Code.js', 'utf8'));
// ※ Code.js의 const는 eval 밖으로 안 새서, 열 번호는 아래에 숫자로 직접 적는다

// --- Apps Script 흉내 ---
var 보낸것 = null;
var 보낸스레드 = null;
var 돌려줄글번호 = '';
var 진짜슬랙보내기 = 슬랙보내기;   // 아래 '발송 방식' 점검에서 쓴다
슬랙보내기 = function (문구, 스레드) { 보낸것 = 문구; 보낸스레드 = 스레드; return 돌려줄글번호; };
var 기다린ms = 0;
Utilities = { sleep: function (ms) { 기다린ms = ms; } };
SpreadsheetApp = { flush: function () {} };
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
assert.ok(완료.indexOf('요청 처리 완료') !== -1);
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
assert.strictEqual(편집(이미처리, 2, 5 /* E 처리 사항 */, '101동 603호'), null, '처리 날짜가 있으면 처리 완료 알림 안 보낸다');
assert.strictEqual(이미처리[6], '2026. 9. 8', '처리 날짜는 처음 값을 유지한다 (가안)');

// 처리 날짜가 있는 줄은 새 요청 알림도 안 보낸다
var 끝난줄 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 603호', '', '2026. 9. 8'];
assert.strictEqual(편집(끝난줄, 2, 4 /* D 요청 내용 */, 빈칸), null, '처리 날짜가 있으면 새 요청 알림 안 보낸다');
// 처리 날짜를 손으로 먼저 적어둔 줄에 처리 사항을 넣어도 알림 없음
var 날짜먼저 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 603호', '', '2026. 9. 8'];
assert.strictEqual(편집(날짜먼저, 2, 5 /* E 처리 사항 */, 빈칸), null);

var 지운행 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '', '', ''];
편집(지운행, 2, 5 /* E 처리 사항 */, '101동 603호');
assert.strictEqual(지운행[6], '', '처리 사항을 지웠으면 처리 날짜도 안 찍는다');

// --- 처리 완료는 1분 기다렸다가 그때 값으로 ---
기다린ms = 0;
var 고친행 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 60', '', ''];
Utilities.sleep = function (ms) { 기다린ms = ms; 고친행[4] = '101동 603호'; };   // 기다리는 사이 오타 수정
var 고친알림 = 편집(고친행, 2, 5 /* E 처리 사항 */, 빈칸);
assert.strictEqual(기다린ms, 60000, '1분 기다려야 한다');
assert.ok(고친알림.indexOf('101동 603호') !== -1, '기다린 뒤 고친 값으로 보내야 한다');

var 지운사이 = ['2026. 9. 7', '홍길동', '홍길동', '주소 확인', '101동 603호', '', ''];
Utilities.sleep = function () { 지운사이[4] = ''; };   // 기다리는 사이 지움
assert.strictEqual(편집(지운사이, 2, 5 /* E 처리 사항 */, 빈칸), null, '기다리는 사이 지웠으면 안 보낸다');

Utilities.sleep = function () {};

// --- 스레드 답장 ---
// 봇으로 보내 글 번호를 받으면 H열에 글자로 적어 둔다
돌려줄글번호 = '1731123456.123456';
var 스레드행 = ['', '홍길동', '홍길동', '주소 확인 부탁드립니다', '', '', '', ''];
편집(스레드행, 2, 4 /* D 요청 내용 */, 빈칸);
assert.strictEqual(스레드행[7], '1731123456.123456', '새 요청 글 번호를 H열에 적어야 한다');
assert.ok(!보낸스레드, '새 요청은 채널에 새 글로 보낸다');

// 처리 완료는 H열 번호의 스레드로
돌려줄글번호 = '9999.0001';
스레드행[4] = '101동 603호';
편집(스레드행, 2, 5 /* E 처리 사항 */, 빈칸);
assert.strictEqual(보낸스레드, '1731123456.123456', '처리 완료는 요청 글 스레드에 달아야 한다');
assert.ok(보낸것.indexOf('*처리 완료*\n— 담당자: <@U000TEST>\n— 처리 사항: 101동 603호') === 0, '스레드 답글은 담당자 멘션 + 처리 사항');
assert.ok(보낸것.indexOf('요청자') === -1, '스레드 답글엔 요청자를 넣지 않는다');
assert.ok(보낸것.indexOf('요청 내용') === -1, '스레드 답글엔 요청 내용을 다시 넣지 않는다');
assert.strictEqual(스레드행[7], '1731123456.123456', '처리 완료가 H열 번호를 바꾸면 안 된다');

// 웹훅으로 보내 번호가 없으면 H열은 비워 두고, 처리 완료는 채널로
돌려줄글번호 = '';
var 웹훅행 = ['', '홍길동', '홍길동', '주소 확인', '', '', '', ''];
편집(웹훅행, 2, 4, 빈칸);
assert.strictEqual(웹훅행[7], '', '번호가 없으면 H열을 건드리지 않는다');
웹훅행[4] = '101동 603호';
편집(웹훅행, 2, 5, 빈칸);
assert.strictEqual(보낸스레드, '', 'H열이 비면 채널로 보낸다');

// 이번 변경 전 줄(H열 자체가 없음)도 채널로
편집(['9/9', '홍길동', '홍길동', '주소 확인', '101동', '', ''], 2, 5, 빈칸);
assert.strictEqual(보낸스레드, '', '옛 줄은 채널로 보낸다');

// 워크플로가 H열에 적은 메시지 링크로도 스레드에 단다
var 링크행 = ['9/9', '홍길동', '홍길동', '주소 확인', '101동', '', '', 'https://bosalpim.slack.com/archives/C0123ABC/p1731123456123456'];
편집(링크행, 2, 5, 빈칸);
assert.strictEqual(보낸스레드, '1731123456.123456', '메시지 링크에서 글 번호를 꺼내야 한다');

assert.strictEqual(글번호뽑기('https://x.slack.com/archives/C01/p1731123456123456?thread_ts=1.2&cid=C01'), '1731123456.123456');
assert.strictEqual(글번호뽑기('1731123456.123456'), '1731123456.123456');
assert.strictEqual(글번호뽑기('메모'), '', '엉뚱한 값이면 채널로');
assert.strictEqual(글번호뽑기(''), '');

// --- 발송 방식 (봇 → 실패하면 웹훅) ---
var 호출 = [];
var 봇응답 = '';
UrlFetchApp = { fetch: function (url, 옵션) {
  호출.push({ url: url, 내용: JSON.parse(옵션.payload), 옵션: 옵션 });
  var 봇 = url.indexOf('slack.com/api') !== -1;
  return { getResponseCode: function () { return 200; },
           getContentText: function () { return 봇 ? 봇응답 : 'ok'; } };
} };
function 속성(값) {
  PropertiesService = { getScriptProperties: function () {
    return { getProperty: function (k) { return 값[k] || null; } };
  } };
}

// 토큰·채널이 있으면 봇으로, 스레드 번호를 실어 보내고 글 번호를 돌려준다
속성({ SLACK_BOT_TOKEN: 'xoxb-test', SLACK_CHANNEL_ID: 'C000', SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x' });
봇응답 = '{"ok":true,"ts":"111.222"}';
호출 = [];
assert.strictEqual(진짜슬랙보내기('안녕', '100.001'), '111.222');
assert.strictEqual(호출.length, 1);
assert.strictEqual(호출[0].내용.thread_ts, '100.001');
assert.strictEqual(호출[0].내용.channel, 'C000');
assert.strictEqual(호출[0].옵션.headers.Authorization, 'Bearer xoxb-test');

// 스레드 번호가 없으면 thread_ts를 안 보낸다
호출 = [];
진짜슬랙보내기('안녕');
assert.ok(!('thread_ts' in 호출[0].내용));

// 봇이 실패하면(초대 안 됨 등) 웹훅으로 채널에 다시 보내 알림이 사라지지 않는다
봇응답 = '{"ok":false,"error":"not_in_channel"}';
호출 = [];
var 원래에러 = console.error; console.error = function () {};
assert.strictEqual(진짜슬랙보내기('안녕', '100.001'), '');
console.error = 원래에러;
assert.strictEqual(호출.length, 2);
assert.ok(호출[1].url.indexOf('hooks.slack.com') !== -1, '실패하면 웹훅으로 보낸다');

// 토큰이 없으면 지금처럼 웹훅만
속성({ SLACK_WEBHOOK_URL: 'https://hooks.slack.com/x' });
호출 = [];
assert.strictEqual(진짜슬랙보내기('안녕'), '');
assert.strictEqual(호출.length, 1);
assert.ok(호출[0].url.indexOf('hooks.slack.com') !== -1);
