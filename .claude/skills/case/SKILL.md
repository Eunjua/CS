---
name: case
description: CS 응대 가이드(케어아카데미 신입 교육용 분기 흐름도 화면, cs-guide/)에 케이스를 추가·수정·삭제한다. 사용자가 "케이스 추가해줘", "응대 가이드에 ~ 넣어줘", "~ 케이스 만들어줘", "○○ 케이스 수정/삭제" 같은 요청을 하면, 자연어 설명을 분기 구조로 정리해 구글시트에 자동 기록한다. /case 로도 호출.
---

# CS 응대 가이드 — 케이스 관리 스킬

사용자(은주, CX Manager)가 말로 설명한 CS 상담 케이스를, **고객 답변에 따라 갈리는 분기 흐름도** 형태로 정리해 구글시트에 기록한다. 시트는 GAS 웹앱으로 연결돼 있고, 화면(`cs-guide/index.html`)이 시트를 실시간으로 읽어 흐름도로 그린다.

핵심: **사용자는 말로만 설명한다. 시트 입력은 이 스킬이 GAS에 보내서 자동으로 처리한다.**

## 연결 정보 (config)

```
GAS_URL  = https://script.google.com/macros/s/AKfycbxYR3sMpDpm-kX_vMV9g-AueJgENm2ueHfWgr_9MeHbjvHr8SijXuP3nwo3U-r1xd7r/exec
TOKEN    = bosalpim-cs-guide
시트 탭   = '케이스'
화면 파일 = cs-guide/index.html
GAS 소스  = gas/CSGuide.gs  (doGet=읽기, doPost=쓰기)
```

> 주소나 키가 바뀌면 위 값과 `gas/CSGuide.gs`, `cs-guide/index.html`을 함께 갱신할 것.

## 케이스 데이터 형식

한 케이스 = `{ category, name, desc, steps[] }`. 각 step은 시트 한 줄이 된다.

| 필드 | 뜻 | 예 |
|------|----|----|
| category | 분류(중분류) | 수강 / 자격증 / 결제 / 일자리 … |
| name | 케이스 이름(고유키) | "입금 확인" |
| desc | 케이스 설명(언제 쓰는지) | '고객이 "입금 확인" 요청할 때' |
| steps[].sid | 단계 번호(케이스 내에서 1부터) | 1, 2, 3… |
| steps[].parent | 부모 단계의 sid (첫 단계는 null) | null, 1, 2… |
| steps[].cond | 분기조건(이 갈래로 오는 조건). 직선 연결이면 null | "입금됨", "미입금" |
| steps[].type | 단계 유형 | "질문" / "조회" / "안내" |
| steps[].text | 실제 내용(멘트·할 일) | '"어떤 자격증 확인이세요?"' |
| steps[].link | 참고링크(어드민 URL 등), 없으면 null | "https://bo.carepartner.kr/..." |

### 분기(흐름도) 만드는 규칙
- **한 단계에서 여러 갈래** → `parent`가 같은 step을 여러 개 만들고 `cond`만 다르게.
- **갈래 안에서 또 갈래** → 그 갈래 step의 sid를 `parent`로 삼는 step을 또 만든다 (2단 이상 가능).
- **곧장 이어지는 단계**(갈림 없음)는 `cond`를 null로.
- 유형 3종: **질문**(고객에게 물을 것) / **조회**(어드민 등에서 확인) / **안내**(고객에게 할 말).
- 갈림길이 **실제로 있을 때만** 줄을 나눈다. 한 번에 설명하는 거면 안내 한 줄로.

### 참고 예시 (입금 확인)
```
sid1 질문  parent=null  "어떤 자격증을 확인해 드릴까요?"
sid2 조회  parent=1     어드민에서 전화번호로 결제상태 확인   link=어드민
sid3 안내  parent=2 cond=입금됨   "결제 완료되셨어요…"
sid4 안내  parent=2 cond=미입금   "아직 입금 전이세요…"
sid5 안내  parent=4 cond=고객 요청 시  계좌 만료일·번호 안내
```

## 작업 순서

1. **케이스 내용 파악.** 사용자 설명에서 분류·이름·분기를 뽑는다. 분기(고객 답변에 따라 갈리는 부분)나 조회 단계가 불명확하면 **한 가지씩** 짧게 되묻는다. 이미 충분하면 묻지 말고 바로 정리한다.
2. **케이스 JSON 구성.** 위 형식대로 steps를 만든다. category는 케어아카데미 기준 수강/자격증/결제를 우선 쓰고, 일자리 등 새 분류면 그대로 적으면 화면에 새 그룹이 생긴다.
3. **시트에 전송.** 아래 템플릿으로 임시 `.mjs`를 만들어 `node`로 실행한다.
   - 추가/수정: `action: "upsert"` (같은 name이 있으면 갈아끼움, 없으면 추가)
   - 삭제: `action: "delete"` (case에 name만 있으면 됨)
4. **결과 확인.** 응답이 `{"ok":true,...}`인지 보고, 이어서 GET으로 현재 시트의 케이스 목록을 출력해 확인한다.
5. **사용자에게 보고.** 무엇을 어느 분류에 넣었는지 + 흐름도 요약(ASCII)으로 알려주고, "화면(cs-guide) 새로고침하면 보여요"라고 안내. 임시 .mjs는 지운다.

### 전송 템플릿 (node, ESM)
```js
const URL = "<GAS_URL>";
const TOKEN = "bosalpim-cs-guide";
const action = "upsert"; // 추가/수정. 삭제는 "delete"
const theCase = {
  category: "결제",
  name: "케이스 이름",
  desc: "언제 쓰는지",
  steps: [
    { sid:1, parent:null, cond:null, type:"질문", text:"...", link:null },
    // ...
  ]
};
const res = await fetch(URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ token: TOKEN, action, case: theCase })
});
console.log("POST →", await res.text());
const g = await fetch(URL);
const d = JSON.parse(await g.text());
console.log("현재 케이스:\n" + d.map(c => ` - [${c.category}] ${c.name} (단계 ${c.steps.length})`).join("\n"));
```
실행: 임시 파일로 저장 후 `node /tmp/case_post.mjs` → 끝나면 삭제.

## 주의
- `name`은 고유키다. 기존 케이스를 **수정**할 땐 같은 name으로 **전체 steps를 다시** 보내면 된다(upsert가 통째로 교체).
- `gas/CSGuide.gs`의 `seedData()`는 시트를 싹 비우니 운영 중엔 쓰지 말 것. 이 스킬은 seedData를 쓰지 않는다.
- 시트가 비어 응답이 `[]`면 시트/배포 문제일 수 있다 → `gas/CSGuide.gs` 배포 상태 확인.
- 화면을 다른 사람도 보게 하려면 GitHub Pages 배포(`cspush`)가 필요하다(로컬 파일은 본인만 열림).
