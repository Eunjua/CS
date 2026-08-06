// dashboard-v2 의 renderSurvey 를 실제로 실행해 비중 계산이 맞는지 확인한다.
// DOM/Chart.js 는 최소한만 흉내낸다.
//
//   실행법:  node dashboard-v2/test-survey.js
//   "통과 —" 가 나오면 정상. 해결율&시간 탭을 고친 뒤 한 번 돌려보면 된다.
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync('/Users/eunju/work/CS/dashboard-v2/index.html', 'utf8');
const m = html.match(/<script>\n([\s\S]*?)<\/script>/);
assert(m, '인라인 스크립트를 못 찾음');
// let DATA 는 vm 바깥에서 못 건드리니 주입용 함수를 붙인다
const code = m[1].replace(/\nloadData\(\);\s*$/, '\n') +
             '\nfunction __setData(d){ DATA = d; }\n';

const els = {};
function el(id) {
  if (!els[id]) {
    els[id] = {
      id, textContent: '', innerHTML: '', style: {},
      parentElement: { style: {} },
      getContext: () => ({}),
    };
  }
  return els[id];
}

const charts = [];
class Chart {
  constructor(ctx, cfg) { this.cfg = cfg; charts.push(cfg); }
  destroy() {}
}

const sandbox = {
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    querySelector: () => el('_q'),
  },
  Chart,
  console,
  fetch: () => Promise.reject(new Error('no fetch in test')),
};
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

// ── 실제 폼 보기 문구 그대로. '기타'와 응답 없는 주도 섞는다.
sandbox.__setData({
  week: [], tag: [], agent: [],
  survey: [
    { 주차: '07/27~08/02', 항목: '해결여부', 보기: '✅ 네, 해결됐어요',          건수: 6 },
    { 주차: '07/27~08/02', 항목: '해결여부', 보기: '🔶 일부만 해결됐어요',        건수: 2 },
    { 주차: '07/27~08/02', 항목: '해결여부', 보기: '❌ 아직 해결되지 않았어요',   건수: 2 },
    { 주차: '07/20~07/26', 항목: '해결여부', 보기: '✅ 네, 해결됐어요',          건수: 5 },
    { 주차: '07/20~07/26', 항목: '해결여부', 보기: '뭔가 새로운 보기',            건수: 5 },
    { 주차: '07/27~08/02', 항목: '대기적절', 보기: '😊 빠르게 연결됐어요',          건수: 4 },
    { 주차: '07/27~08/02', 항목: '대기적절', 보기: '🙂 조금 기다렸지만 괜찮았어요', 건수: 4 },
    { 주차: '07/27~08/02', 항목: '대기적절', 보기: '😞 너무 오래 기다렸어요',       건수: 2 },
  ],
});

// weeks 는 과거→현재 순서, 가운데 주는 설문 응답이 하나도 없는 주
const weeks = [
  { 주차: '07/13~07/19' },
  { 주차: '07/20~07/26' },
  { 주차: '07/27~08/02' },
];
sandbox.renderSurvey(weeks, '07/27~08/02');

// ── 해결여부 차트
const resolve = charts[0];
const [ok, part, no, etc] = resolve.data.datasets;
assert.deepStrictEqual(ok.data,   [null, 50, 60], '해결됐어요 비중');
assert.deepStrictEqual(part.data, [null, 0, 20],  '일부만 비중');
assert.deepStrictEqual(no.data,   [null, 0, 20],  '미해결 비중');
assert(etc, '못 알아본 보기는 기타 계열로 나와야 함');
assert.deepStrictEqual(etc.data,  [null, 50, 0],  '기타 비중');
assert.strictEqual(etc.label, '기타');
// 응답 없는 주는 null → 막대가 안 그려진다
assert.strictEqual(resolve.data.datasets.every(d => d.data[0] === null), true);
// 각 주 합계는 100%
[1, 2].forEach(i => {
  const sum = resolve.data.datasets.reduce((a, d) => a + d.data[i], 0);
  assert.strictEqual(Math.round(sum), 100, `${weeks[i].주차} 합계 100%`);
});

// ── 대기적절 차트 — 정의된 보기만 나왔으니 기타 계열이 없어야 한다
const wait = charts[1];
assert.strictEqual(wait.data.datasets.length, 3, '기타 없을 땐 3계열');
assert.deepStrictEqual(wait.data.datasets[0].data, [null, null, 40]);

// ── KPI: 해결율은 ✅만(pos:1), 대기는 😊+🙂(pos:2)
assert.strictEqual(el('k-resolve').textContent, '60%');
assert.strictEqual(el('k-resolve-sub').textContent, '10건 응답 · 누적 55%'); // (6+5)/20
assert.strictEqual(el('k-wait').textContent, '80%');
assert.strictEqual(el('k-wait-sub').textContent, '10건 응답 · 누적 80%');
assert.strictEqual(el('sv-resolve-sub').textContent, '보기별 비중 추이 · 누적 20건 응답');

// ── 집계가 아직 없을 때: 차트 숨기고 안내
charts.length = 0;
sandbox.__setData({ week: [], tag: [], agent: [], survey: [] });
sandbox.renderSurvey(weeks, '07/27~08/02');
assert.strictEqual(charts.length, 0, '집계 없으면 차트를 그리지 않는다');
assert.strictEqual(el('c-resolve').parentElement.style.display, 'none');
assert.strictEqual(el('k-resolve').textContent, '—');
assert.strictEqual(el('sv-note').style.display, 'block');

console.log('통과 — 비중 계산, 기타 처리, 빈 주차, KPI, 빈 집계 안내');

// ============================================================
//  체감 × 실제 대기시간
// ============================================================

// ── 1) 집계 쪽 구간 나누기 (gas-v2/Aggregate.gs 의 waitBucket_ 를 그대로 불러 쓴다)
const gasSb = { SpreadsheetApp: undefined, console };
vm.createContext(gasSb);
vm.runInContext(fs.readFileSync('/Users/eunju/work/CS/gas-v2/Aggregate.gs', 'utf8'), gasSb);
const wb = gasSb.waitBucket_;

[ ['',   '측정불가'], [null, '측정불가'], [undefined, '측정불가'],
  ['abc','측정불가'], [-5,   '측정불가'],
  [0,    '즉시'],
  [1,    '~5분'],    [299,  '~5분'],      // 4분 59초
  [300,  '5~15분'],  [899,  '5~15분'],    // 5분 정각 ~ 14분 59초
  [900,  '15~30분'], [1799, '15~30분'],
  [1800, '30분+'],   [8262, '30분+'],     // 원본 export 최대값(137.7분)
].forEach(([input, want]) => {
  assert.strictEqual(wb(input), want, `waitBucket_(${JSON.stringify(input)})`);
});

// 대시보드 구간 이름이 집계와 어긋나면 막대가 통째로 비어버린다 — 한 번 맞춰본다
// Array.from — vm 안에서 만든 배열은 프로토타입이 달라 그대로는 비교가 안 된다
const dashKeys = Array.from(vm.runInContext('WAIT_BUCKETS.map(b=>b.key)', sandbox));
const gasKeys = [0, 1, 300, 900, 1800].map(wb);
assert.deepStrictEqual(dashKeys, gasKeys, '대시보드 구간 이름 == 집계 구간 이름');

// ── 2) 렌더링
charts.length = 0;
sandbox.__setData({
  week: [], tag: [], agent: [], survey: [],
  feelwait: [
    // 😊 빠르게 — 실제로도 빠름
    { 주차:'07/27~08/02', 체감:'😊 빠르게 연결됐어요', 구간:'즉시',     건수: 30 },
    { 주차:'07/27~08/02', 체감:'😊 빠르게 연결됐어요', 구간:'~5분',     건수: 10 },
    { 주차:'07/27~08/02', 체감:'😊 빠르게 연결됐어요', 구간:'측정불가', 건수: 25 },
    // 🙂 괜찮음
    { 주차:'07/27~08/02', 체감:'🙂 조금 기다렸지만 괜찮았어요', 구간:'5~15분',  건수: 20 },
    { 주차:'07/27~08/02', 체감:'🙂 조금 기다렸지만 괜찮았어요', 구간:'15~30분', 건수: 20 },
    // 😞 너무 오래 — 절반은 실제로 15분 안에 답을 받았다 (= 어긋남)
    { 주차:'07/27~08/02', 체감:'😞 너무 오래 기다렸어요', 구간:'즉시',   건수:  3 },
    { 주차:'07/27~08/02', 체감:'😞 너무 오래 기다렸어요', 구간:'5~15분', 건수:  2 },
    { 주차:'07/27~08/02', 체감:'😞 너무 오래 기다렸어요', 구간:'30분+',  건수:  5 },
    { 주차:'07/27~08/02', 체감:'알아볼 수 없는 보기',      구간:'30분+',  건수: 99 },
  ],
});
sandbox.renderFeelWait();

const fw = charts[0];
assert.strictEqual(fw.options.indexAxis, 'y', '가로 막대');
assert.strictEqual(fw.data.datasets.length, 5, '구간 5개');
// 측정불가는 막대에서 빠지고 건수 표기에도 안 들어간다
assert.strictEqual(fw.data.labels[0], '😊 빠르게 연결  (40건)');
assert.strictEqual(fw.data.labels[2], '😞 너무 오래  (10건)');
// 😊 줄: 즉시 75% / ~5분 25%
assert.deepStrictEqual(Array.from(fw.data.datasets[0].data), [75, 0, 30]);
assert.deepStrictEqual(Array.from(fw.data.datasets[1].data), [25, 0, 0]);
// 줄마다 합계 100%
fw.data.labels.forEach((_, i) => {
  const sum = fw.data.datasets.reduce((a, d) => a + d.data[i], 0);
  assert.strictEqual(Math.round(sum), 100, `${i}번째 줄 합계`);
});
// 못 알아본 체감(99건)은 어디에도 안 섞여야 한다
assert(!el('fw-sub').textContent.includes('99'), '알 수 없는 체감은 버린다');
assert.strictEqual(el('fw-sub').textContent, '누적 전체 주차 · 실제 대기시간이 기록된 90건 기준');
// 어긋남: 😞 10건 중 즉시3+5~15분2 = 5건(50%)
assert(el('fw-insight').innerHTML.includes('10건 중 <b>5건(50%)</b>'), '어긋남 계산');
assert(el('fw-insight').innerHTML.includes('25건'), '측정불가 건수 안내');

// ── 3) 실제 대기시간이 하나도 없을 때 (전부 측정불가)
charts.length = 0;
sandbox.__setData({ week:[], tag:[], agent:[], survey:[], feelwait:[
  { 주차:'07/27~08/02', 체감:'😊 빠르게 연결됐어요', 구간:'측정불가', 건수: 12 },
]});
sandbox.renderFeelWait();
assert.strictEqual(charts.length, 0, '그릴 게 없으면 차트를 안 만든다');
assert.strictEqual(el('c-feelwait').parentElement.style.display, 'none');
assert(el('fw-insight').innerHTML.includes('12건'));

// ── 4) 집계 자체가 없을 때
charts.length = 0;
sandbox.__setData({ week:[], tag:[], agent:[], survey:[], feelwait:[] });
sandbox.renderFeelWait();
assert.strictEqual(charts.length, 0);
assert.strictEqual(el('fw-sub').textContent, '집계 없음');

console.log('통과 — 구간 경계 14개, 집계↔대시보드 구간명 일치, 어긋남 계산, 측정불가 제외, 빈 데이터');
