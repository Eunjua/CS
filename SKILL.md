---
name: jobposting
description: 노인일자리정보시스템(seniwork.or.kr)에 구인신청서를 자동으로 등록하는 스킬. 구글 시트에서 미처리 행을 읽고, BO에서 사업자번호와 공고 정보를 확인한 후, seniwork에 구인신청서를 자동 입력·저장한다. "구인신청서 등록", "seniwork 자동화", "공고 등록해줘", "jobposting 실행" 같은 요청이 들어오면 반드시 이 스킬을 사용할 것.
---

# 구인신청서 자동 등록 스킬

## 개요
구글 시트 → BO(보살핌 백오피스) → seniwork 순서로 탭을 이동하며 구인신청서를 자동 등록한다.
Claude Extension이 각 탭에서 JS를 실행하고 결과를 다음 탭으로 전달한다.

---

## 전체 흐름

```
[Step 1] 구글 시트 탭
  → 조건 맞는 행에서 publicId, orgId 추출

[Step 2] BO businesses 탭 (https://bo.carepartner.kr/businesses)
  → orgId로 검색 → 사업자번호 추출

[Step 3] BO job-postings 탭 (https://bo.carepartner.kr/job-postings/[publicId])
  → 공고 제목, 급여, 담당자번호, 등록일 추출

[Step 4] seniwork 탭 (https://www.seniwork.or.kr/kwork/main.html)
  → 구인신청서 전체 자동 입력 + 저장
  → 결과 확인 후 구글 시트 X열 업데이트 (수동)
```

---

## 조건 및 규칙

- **MUST**: 구글 시트 조건: Q열="취업확인서", X열=공백, Y열=공백인 최상단 행
- **MUST**: 수행기관 "보살핌"인 행만 선택
- **MUST**: 고용형태는 항상 "시간제일자리"
- **MUST**: 직종은 항상 "요양보호사" (더블클릭 선택)
- **MUST**: 팝업 후 wait 2초 (Nexacro timeout 방지)
- **MUST**: 저장 성공 = 목록 화면으로 전환됨

---

## Step 1: 구글 시트에서 데이터 추출

**시트 URL**: `https://docs.google.com/spreadsheets/d/1FizNXFH-wgAsdKaPJd5Xsfu6VzAti5n8lcnyVeRsI3I/`

구글 시트 탭 콘솔에서 실행:
```javascript
// gviz/tq 엔드포인트로 데이터 추출 (구글 시트 탭에서만 CORS 없이 작동)
async function getSheetData() {
  const res = await fetch(
    'https://docs.google.com/spreadsheets/d/1FizNXFH-wgAsdKaPJd5Xsfu6VzAti5n8lcnyVeRsI3I/gviz/tq?sheet=통합관리&tq=select%20C,E,H,R,Y,Z&tqx=out:json'
  );
  const text = await res.text();
  const json = JSON.parse(text.replace(/^[^(]+\(/, '').replace(/\);?$/, ''));
  const rows = json.table.rows;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const r = row.c[3]?.v?.toString().trim() ?? '';  // R열: 상태 ("취업확인서" 값)
    const y = row.c[4]?.v ?? null;                   // Y열: 입력실패 (null이어야 처리 대상)
    const z = row.c[5]?.v ?? null;                   // Z열: 매출 발생 일자 (null이어야 처리 대상)

    if (r === '취업확인서' && y === null && z === null) {
      const publicId = row.c[0]?.v?.toString().trim();          // C열: 공고 publicID
      const orgId = row.c[1]?.v?.toString().replace('.0', '');  // E열: 기관 id
      const bizNo = row.c[2]?.v?.toString().replace('.0', '');  // H열: 사업자번호
      console.log('찾음:', { rowIndex: i + 2, publicId, orgId, bizNo });
      return { rowIndex: i + 2, publicId, orgId, bizNo };
    }
  }

  console.log('처리할 행 없음');
  return null;
}
```

**열 구조 (확인됨):**
- C열: 공고 publicID
- E열: 기관 id
- H열: 사업자번호
- R열: 상태 ("취업확인서" 값이 들어있는 열)
- Y열: 입력실패 (null이어야 처리 대상)
- Z열: 매출 발생 일자 (null이어야 처리 대상)

**주의**: 구글 시트 탭(`docs.google.com`)에서만 작동. seniwork/BO 탭에서는 CORS 오류 발생.

**반환값**: `{ rowIndex, publicId, orgId, bizNo }`
- `rowIndex`: 시트 행 번호 (결과 업데이트용)
- `publicId`: C열 값 (BO job-postings URL용)
- `orgId`: E열 값
- `bizNo`: H열 값 (seniwork 사업자번호 입력용)

---

## Step 2: 사업자번호

구글 시트 H열에서 직접 가져오므로 BO businesses 탭 불필요.
Step 1 `getSheetData()` 반환값의 `bizNo` 사용.

---

## Step 3: BO job-postings에서 공고 정보 추출

**URL**: `https://bo.carepartner.kr/job-postings/[publicId]`

```javascript
function getJobInfoFromBO() {
  const title = document.querySelector('input[name="title"]')?.value?.trim();
  const payText = document.querySelector('input[name="payText"]')?.value?.trim();
  
  let salaryType = null, salaryAmount = null;
  if (payText?.includes('시급')) { salaryType = '시급'; }
  else if (payText?.includes('월급')) { salaryType = '월급'; }
  salaryAmount = payText?.replace(/[^0-9]/g, '');

  const tel = document.querySelector('input[name="managerPhoneNumber"]')?.value?.trim();
  const ceoName = document.querySelector('input[name="ceoName"]')?.value?.trim();
  const rawDate = document.querySelector('input[name="publishedAt"]')?.value?.trim();
  
  // 등록일 YYYYMMDD 변환
  const regDate = rawDate ? rawDate.slice(0, 10).replace(/-/g, '') : null;
  
  // 마감일 = 등록일 + 14일
  let endDate = null;
  if (rawDate) {
    const d = new Date(rawDate);
    d.setDate(d.getDate() + 14);
    endDate = d.toISOString().slice(0, 10).replace(/-/g, '');
  }

  // 주소 (시도 추출용)
  const address = document.querySelector('input[name="address"]')?.value?.trim();

  return { title, salaryType, salaryAmount, tel, regDate, endDate, ceoName, address };
}
```

---

## Step 4: seniwork 구인신청서 자동 입력

### 공통 유틸

```javascript
const PREFIX = {
  INFO:    'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div00info_',
  OFFER:   'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div01offer_',
  SUP:     'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div02support_',
  RECEIPT: 'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div03receipt_',
  DETAIL:  'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div04cnsltCnts_',
  PERSON:  'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_Div05offerPerson_',
  POPUP_COMP: 'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_joboReqMngnmtGPopUp_form_grdCompInfo_body_',
  POPUP_JOB:  'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_cmmnNewJobClsfLP_form_',
  POPUP_AREA: 'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_joboSgngLP_form_',
  BTN_INPUT: 'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_btnbInput',
  BTN_SAVE:  'mainframe_KordiFrame_BusWorkFrame_BusWorkBodyFrameSet_BusWorkBodyContFrame_form_divBody_btnSave',
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function clickNexacroBtn(id) {
  const el = document.getElementById(id);
  if (!el) { console.warn('버튼 없음:', id); return false; }
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
  return true;
}

function pressEnter() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
}

function setInput(id, value) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

// 캘린더 입력 (접수기간용 - execCommand 방식)
async function execInput(id, value) {
  const el = document.getElementById(id);
  el.click();
  await sleep(200);
  el.setSelectionRange(0, 0);
  el.focus();
  document.execCommand('selectAll');
  document.execCommand('delete');
  document.execCommand('insertText', false, value);
  await sleep(100);
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', keyCode: 9, bubbles: true }));
}
```

### 4-1. 입력 버튼 클릭
```javascript
async function clickInputBtn() {
  clickNexacroBtn(PREFIX.BTN_INPUT);
  await sleep(1000);
}
```

### 4-2. 사업자번호 입력 + 보살핌 선택
```javascript
async function loadBizNo(bizNo) {
  const input = document.getElementById(PREFIX.INFO + 'edtBizNo_input');
  input.focus();
  input.value = bizNo;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(500);

  clickNexacroBtn(PREFIX.INFO + 'Button00'); // 불러오기 버튼
  await sleep(2000);

  // 유효하지 않은 사업자번호 팝업 → Enter로 닫기
  const isInvalid = Array.from(document.querySelectorAll('*'))
    .some(el => el.innerText?.includes('유효하지 않은 사업자번호'));
  if (isInvalid) {
    pressEnter();
    return 'invalid';
  }

  // 보살핌 행 선택 (왼쪽 선택하기 버튼 = col_0)
  for (let row = 0; row < 20; row++) {
    const orgCell = document.getElementById(`${PREFIX.POPUP_COMP}gridrow_${row}_cell_${row}_3`);
    if (!orgCell) break;
    if (orgCell.innerText?.includes('보살핌')) {
      const btn = document.getElementById(`${PREFIX.POPUP_COMP}gridrow_${row}_cell_${row}_0_controlbutton`);
      if (btn) {
        ['mousedown', 'mouseup', 'click'].forEach(type => {
          btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
        });
        await sleep(2000);
        pressEnter(); // "적용하시겠습니까?" 확인 팝업
        await sleep(2000);
        return 'success';
      }
    }
  }
  return 'no_bosalpim';
}
```

### 4-3. 구인정보 입력
```javascript
async function fillOfferInfo(jobInfo) {
  // 구인제목
  setInput(PREFIX.OFFER + 'edtOfferTitle_input', jobInfo.title);
  await sleep(200);

  // 고용형태: 시간제일자리 (텍스트 매칭)
  document.querySelectorAll('[id$="rdoOfferType_item"]').forEach(el => {
    if (el.innerText?.trim() === '시간제일자리' && el.offsetParent !== null) {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
  await sleep(200);

  // 모집인원: 1
  setInput(PREFIX.OFFER + 'edtOfferCnt_input', '1');
  await sleep(200);

  // 급여유형 드롭다운 (시급/월급)
  const dropBtn = document.getElementById(PREFIX.OFFER + 'cboOfferPayType_dropbutton');
  ['mousedown', 'mouseup', 'click'].forEach(t => {
    dropBtn.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
  });
  await sleep(300);
  document.querySelectorAll('[id*="cboOfferPayType_combolist_itemTextBoxElement"]').forEach(el => {
    if (el.innerText?.trim() === jobInfo.salaryType) {
      ['mousedown', 'mouseup', 'click'].forEach(t => {
        el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true }));
      });
    }
  });
  await sleep(200);

  // 급여금액
  // 시급: 시작=10320(최저시급), 종료=공고금액
  // 월급: 시작=공고금액, 종료=공고금액
  if (jobInfo.salaryType === '시급') {
    setInput(PREFIX.OFFER + 'edtOfferSpay_input', '10320');
    setInput(PREFIX.OFFER + 'edtOfferEpay_input', jobInfo.salaryAmount);
  } else {
    setInput(PREFIX.OFFER + 'edtOfferSpay_input', jobInfo.salaryAmount);
    setInput(PREFIX.OFFER + 'edtOfferEpay_input', jobInfo.salaryAmount);
  }
  await sleep(200);

  // 직종: 한국고용직업분류 버튼 → 요양보호사 검색 → 더블클릭
  await selectJobType();
  await sleep(2000);

  // 근무지: 공고 주소에서 시도 추출 → 선택
  const sido = extractSido(jobInfo.address);
  await selectArea(sido);
  await sleep(2000);
}

// 시도 추출 유틸
function extractSido(address) {
  const sidoList = ['서울특별시','부산광역시','대구광역시','인천광역시','광주광역시',
    '대전광역시','울산광역시','경기도','강원특별자치도','충청북도','충청남도',
    '전라남도','전북특별자치도','경상북도','경상남도','제주특별자치도'];
  return sidoList.find(s => address?.includes(s)) || '서울특별시';
}
```

### 4-4. 직종 선택 (요양보호사)
```javascript
async function selectJobType() {
  clickNexacroBtn(PREFIX.OFFER + 'Button01'); // 한국고용직업분류 버튼
  await sleep(1000);

  // 검색창 입력
  const searchInput = document.getElementById(PREFIX.POPUP_JOB + 'divSch_edtSchNm_input');
  searchInput.focus();
  searchInput.click();
  await sleep(200);
  searchInput.value = '요양보호사';
  searchInput.dispatchEvent(new Event('input', { bubbles: true }));
  searchInput.dispatchEvent(new Event('change', { bubbles: true }));
  await sleep(300);

  // 조회: Enter 키
  searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
  await sleep(1000);

  // 결과 첫 번째 행 더블클릭
  const jobRow = document.getElementById(PREFIX.POPUP_JOB + 'gridEmpJobCode_body_gridrow_0_cell_0_3');
  if (jobRow) {
    ['mousedown','mouseup','click','mousedown','mouseup','click','dblclick'].forEach(type => {
      jobRow.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, detail: type === 'dblclick' ? 2 : 1 }));
    });
  }
}
```

### 4-5. 근무지 선택
```javascript
async function selectArea(sidoText) {
  clickNexacroBtn(PREFIX.OFFER + 'Button02'); // 근무지선택 버튼
  await sleep(1000);

  // 시도 드롭다운 열기
  const dropBtn = document.getElementById(PREFIX.POPUP_AREA + 'divSch_cboSchLargeDstr_dropbutton');
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    dropBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
  await sleep(300);

  // combolist에서 시도 선택
  document.querySelectorAll('[id*="cboSchLargeDstr_combolist_itemTextBoxElement"]').forEach(el => {
    if (el.innerText?.trim() === sidoText) {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
  await sleep(500);

  // 조회 버튼: clientX/Y 포함 MouseEvent
  const schBtn = document.getElementById(PREFIX.POPUP_AREA + 'divSch_btnSch');
  const rect = schBtn.getBoundingClientRect();
  schBtn.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true,
    clientX: rect.left + rect.width/2,
    clientY: rect.top + rect.height/2
  }));
  await sleep(1000);

  // 첫 번째 행 체크
  const firstRow = document.getElementById(PREFIX.POPUP_AREA + 'grdMainList_body_gridrow_0_cell_0_0');
  if (firstRow) {
    ['mousedown', 'mouseup', 'click'].forEach(type => {
      firstRow.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
    });
  }
  await sleep(500);

  // 선택완료
  clickNexacroBtn(PREFIX.POPUP_AREA + 'btnSelect');
}
```

### 4-6. 지원자격 (전부 무관)
```javascript
async function fillSupport() {
  // 경력사항: 무관
  document.querySelectorAll('[id$="rdoSupportCareer_item"]').forEach(el => {
    if (el.innerText?.trim() === '무관' && el.offsetParent !== null) {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
  await sleep(200);

  // 최종학력: 무관 (드롭다운)
  const dropBtn = document.getElementById(PREFIX.SUP + 'cboSupportAcademic_dropbutton');
  ['mousedown', 'mouseup', 'click'].forEach(type => {
    dropBtn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
  });
  await sleep(300);
  document.querySelectorAll('[id*="cboSupportAcademic_combolist_itemTextBoxElement"]').forEach(el => {
    if (el.innerText?.trim() === '무관') {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
  await sleep(200);

  // 직무특성: 무관
  document.querySelectorAll('[id$="rdoSupportType_item"]').forEach(el => {
    if (el.innerText?.trim() === '무관' && el.offsetParent !== null) {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
}
```

### 4-7. 접수기간/방법
```javascript
async function fillReceipt(startDate, endDate) {
  // 접수기간: execCommand 방식 (YYYYMMDD)
  await execInput(PREFIX.RECEIPT + 'calReceiptSdt_calendaredit_input', startDate);
  await sleep(300);
  await execInput(PREFIX.RECEIPT + 'calReciptEdt_calendaredit_input', endDate);
  await sleep(200);

  // 접수방법: 전화
  document.querySelectorAll('*').forEach(el => {
    if (el.innerText?.trim() === '전화' && el.offsetParent !== null && el.children.length === 0) {
      ['mousedown', 'mouseup', 'click'].forEach(type => {
        el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
      });
    }
  });
}
```

### 4-8. 상세내용
```javascript
async function fillDetail() {
  const textarea = document.getElementById(PREFIX.DETAIL + 'TextAreaDtlCtts_textarea');
  textarea.focus();
  textarea.click();
  document.execCommand('selectAll');
  document.execCommand('insertText', false, '신체지원, 정서지원, 가사지원등 전반적인 케어');
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}
```

### 4-9. 담당자 정보
```javascript
async function fillPersonInfo(tel) {
  // 담당자명: 기업정보의 대표자 이름 직접 읽기
  const ceoName = document.getElementById(PREFIX.INFO + 'edtCompCeo_input')?.value?.trim();
  setInput(PREFIX.PERSON + 'edtOfferPersonNm_input', ceoName);
  await sleep(200);
  setInput(PREFIX.PERSON + 'edtOfferPersonTel_input', tel);
}
```

### 4-10. 저장
```javascript
async function save() {
  clickNexacroBtn(PREFIX.BTN_SAVE);
  await sleep(2000);
  pressEnter(); // "저장하시겠습니까?" 확인 팝업
  await sleep(2000);

  // 목록 화면 전환 여부로 성공 판단
  const isListPage = !!document.getElementById(PREFIX.BTN_INPUT);
  console.log(isListPage ? '저장 성공' : '저장 실패');
  return isListPage ? 'success' : 'fail';
}
```

---

## 메인 실행 함수

```javascript
async function runJobPosting(bizNo, jobInfo) {
  console.log('=== 구인신청서 자동화 시작 ===', bizNo);

  await clickInputBtn();

  const loadResult = await loadBizNo(bizNo);
  if (loadResult !== 'success') {
    console.log('중단:', loadResult);
    return loadResult; // 'invalid' or 'no_bosalpim'
  }

  await fillOfferInfo(jobInfo);
  await sleep(500);

  await fillSupport();
  await sleep(500);

  await fillReceipt(jobInfo.regDate, jobInfo.endDate);
  await sleep(500);

  await fillDetail();
  await sleep(500);

  await fillPersonInfo(jobInfo.tel);
  await sleep(500);

  const result = await save();
  console.log('=== 완료 ===', result);
  return result;
}
```

---

## 오류 대응

| 오류 | 원인 | 해결 |
|---|---|---|
| 유효하지 않은 사업자번호 | 브라우저 alert | `pressEnter()`로 닫기 |
| 보살핌 없음 | 해당 기관 미등록 | X열 "사업자" 처리 후 다음 행 |
| 저장 후 목록 미전환 | 필수 입력 누락 | X열 "공고미등록" 처리 |
| 직종 단일클릭 무반응 | Nexacro 특성 | 더블클릭으로 해결 |
| 조회 버튼 클릭 무반응 | Nexacro 특성 | 검색창에서 Enter 키 사용 |
| 접수기간 입력 안됨 | 캘린더 컴포넌트 | execCommand 방식 사용 |
| 드롭다운 선택 안됨 | ID 없는 combolist | combolist_itemTextBoxElement 텍스트 매칭 |

---

## X열 업데이트 기준

| 결과 | X열 값 |
|---|---|
| 저장 성공 (목록 전환됨) | 공고등록 |
| 저장 실패 (목록 미전환) | 공고미등록 |
| 보살핌 없음 | 사업자 |
| 유효하지 않은 사업자번호 | 사업자 |

---

## 실패 시 노션 기록

**노션 페이지**: https://www.notion.so/bosalpim/34c72773c3638060b36cc6c90e77e4cb
**데이터베이스 ID**: `b7aef6d4-7509-42e1-91c4-6c7e2a56f0df`

저장 성공(공고등록)을 제외한 모든 실패 케이스는 Notion MCP로 데이터베이스에 기록한다.

**실패 이유 매핑:**
- `invalid` → "유효하지 않은 사업자번호"
- `no_bosalpim` → "보살핌 수행기관 없음"
- `fail` → "저장 실패"

**기록 방법:**
Notion MCP `notion-create-pages` 도구 사용:
```
parent: { data_source_id: "b7aef6d4-7509-42e1-91c4-6c7e2a56f0df" }
pages: [{
  properties: {
    "공고 ID": "[publicId]",
    "실패 이유": "[실패 이유]",
    "처리일시": "[YYYY-MM-DD HH:MM]"
  }
}]
```

**성공 시 처리:**
저장 성공(공고등록)의 경우 구글 시트 X열 업데이트는 수동으로 진행.
Claude Extension이 성공 결과와 함께 시트 URL+셀 주소를 안내한다:
`https://docs.google.com/spreadsheets/d/1FizNXFH-wgAsdKaPJd5Xsfu6VzAti5n8lcnyVeRsI3I/edit#gid=0&range=X[rowIndex]`
