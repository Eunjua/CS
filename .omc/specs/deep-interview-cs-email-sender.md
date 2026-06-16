# Deep Interview Spec: CS 상담원 이메일 발송 도구 (대표 메일 발신)

## Metadata
- Interview ID: cs-email-sender-2026-06-16
- Rounds: 5
- Final Ambiguity Score: 14%
- Type: brownfield (기존 GAS 웹앱 확장)
- Generated: 2026-06-16
- Threshold: 0.2
- Threshold Source: default
- Initial Context Summarized: no
- Status: PASSED

## Clarity Breakdown
| Dimension | Score | Weight | Weighted |
|-----------|-------|--------|----------|
| Goal Clarity | 0.90 | 0.35 | 0.315 |
| Constraint Clarity | 0.85 | 0.25 | 0.213 |
| Success Criteria | 0.82 | 0.25 | 0.205 |
| Context Clarity | 0.82 | 0.15 | 0.123 |
| **Total Clarity** | | | **0.856** |
| **Ambiguity** | | | **0.144 (14%)** |

## Topology
| Component | Status | Description | Coverage / Deferral Note |
|-----------|--------|-------------|--------------------------|
| 발송 화면(UI) | active | 상담원이 받는사람·제목·본문·첨부파일을 그 자리에서 입력하고 [발송] 누르는 웹 화면 | 받는사람/제목/본문/PC 파일 업로드/PIN 입력/발송 결과 표시 |
| 발송 엔진 | active | eju@bosalpim.co.kr 발신으로, 로그인 없이 메일을 보내는 GAS 백엔드 | GAS 웹앱(소유자=은주 실행) + GmailApp.sendEmail, 보낸편지함 자동 기록 |
| 템플릿 | active | 상황 선택 시 제목·본문이 자동 입력되는 메일 템플릿 | 3종: 교재 발송 안내 / 이수증·확인서 첨부 / 결제 영수증 전달. 선택 후 자유 수정 가능 |
| 별도 발송 이력 시트 | deferred | 누가 언제 무엇을 보냈는지 시트 집계 | 미룸(2026-06-16). 이유: 은주 Gmail "보낸편지함"이 발송 기록을 자동 보관하므로 중복. 상담원별 구분/집계가 필요해지면 추가 |

## Goal
CS 상담원이 채팅 문의 응대 중 고객이 "이메일로 보내달라"고 할 때, **별도 화면(웹 링크)에서 받는사람 메일·제목·본문을 직접 작성하고 PC의 파일(이수증·확인서 등 PDF)을 첨부하여, 회사 대표 메일(eju@bosalpim.co.kr) 발신으로 고객에게 즉시 발송**할 수 있게 한다. 자주 보내는 상황은 **템플릿**으로 골라 제목·본문을 자동 입력(수정 가능)할 수 있다. 상담원은 별도 로그인 없이 링크를 열고 공용 PIN만 입력하면 사용할 수 있다.

## Templates (상황 템플릿)
선택 시 제목·본문 자동 입력, 입력 후 자유 수정 가능. 실제 문구는 구현 단계에서 초안 작성 후 은주 검토로 확정.
| 템플릿 | 용도 | 기본 첨부 |
|--------|------|-----------|
| 교재 발송 안내 | 교재 발송·배송 관련 안내 | 없음(필요 시 안내 PDF) |
| 이수증·확인서 첨부 | 수료/이수 증명 서류 전달 | PC 업로드(상담원이 해당 PDF 첨부) |
| 결제 영수증 전달 | 결제 영수증·증빙 전달 | PC 업로드(영수증 파일) |

## Constraints
- 발신 주소는 항상 eju@bosalpim.co.kr (은주 본인 메일). 상담원이 바꿀 수 없음.
- 상담원은 구글 로그인 불필요 — 웹앱은 "소유자(은주) 권한으로 실행 + 링크 접근(Anyone)"으로 배포.
- 악용 방지: 화면 진입/발송 시 **공용 PIN 한 겹** 필요(상담원 2명이 공유).
- 본문은 텍스트 작성, **PC에서 파일 업로드 첨부** 지원.
- 정해진 데이터 소스(시트 등) 없음 — 내용은 매번 상담원이 직접 타이핑.
- 구현은 기존 `gas/` GAS 웹앱 패턴(doGet/doPost + HtmlService) 위에서.

## Non-Goals
- 별도 발송 이력 시트(보낸편지함으로 갈음).
- 구글 계정 위임(delegation) 방식(로그인 필요해 "간편함" 목표와 충돌).
- 정형 템플릿 자동 채움(내용은 자유 작성).
- 상담원별 발신자 구분(모두 eju 주소로 통일).

## Acceptance Criteria
- [ ] 상담원이 링크 + PIN으로 로그인 없이 발송 화면에 진입할 수 있다.
- [ ] 받는사람 메일·제목·본문 입력 + PC 파일 첨부 후 [발송]으로 메일이 나간다.
- [ ] **(핵심)** 고객 메일함에 발신자 eju@bosalpim.co.kr로, 첨부파일 포함하여 정상 도착한다.
- [ ] 발송 후 화면에 성공/실패 결과가 표시된다.
- [ ] 상황 템플릿(교재 발송 안내/이수증·확인서 첨부/결제 영수증 전달)을 고르면 제목·본문이 자동 입력되고, 이후 자유롭게 수정할 수 있다.
- [ ] 보낸 메일 사본이 은주 Gmail 보낸편지함에 남는다.
- [ ] 잘못된 PIN으로는 발송되지 않는다.

## Assumptions Exposed & Resolved
| Assumption | Challenge | Resolution |
|------------|-----------|------------|
| "로그인 없이"가 보안/제약 요구 | 왜 로그인 없이? (Contrarian) | "그냥 간편함" → 보안 제약 아님. 웹앱+PIN 방식이 위임보다 더 간편해 채택 |
| 고객은 텍스트만 받으면 됨 | 케어아카데미는 PDF(이수증·확인서) 발급 | "글+파일 첨부" 필요로 확정 |
| 첨부는 드라이브/시트에 있음 | 출처가 어디인가 | "상담원 PC에서 업로드"로 확정 |
| 발송 이력 시트가 필요 | 보낸편지함에 안 남나? | eju 발신이라 보낸편지함에 자동 기록 → 별도 시트 미룸 |
| 대표 메일 = 회사 공용 메일 | 어떤 주소? | 은주 본인 메일(eju@bosalpim.co.kr)로 확정 |

## Technical Context
- `gas/CSGuide.gs`, `gas/VOC_통합스크립트.gs`에 이미 `doGet`/`doPost` 웹앱 패턴 존재. GitHub Pages 화면이 GAS 웹앱을 호출하는 구조 확립됨.
- 메일 발송 코드(MailApp/GmailApp)는 현재 없음 — 신규.
- 구현 방향(권장):
  - GAS 웹앱: `doGet`로 발송 화면(HtmlService) 제공, `doPost`(또는 google.script.run)로 발송 처리.
  - 배포 설정: **실행 주체 = 나(은주), 접근 권한 = 링크가 있는 모든 사용자**. → 상담원 로그인 불필요, 발신은 은주 계정.
  - 발송: `GmailApp.sendEmail(to, subject, body, {attachments:[...], name:"보살핌 케어아카데미"})`.
  - PIN: 화면에서 입력받아 doPost에서 서버측 상수와 대조(클라이언트 노출 금지).
  - 첨부: HTML `<input type=file>` → base64로 doPost 전송 → `Utilities.newBlob`로 복원.
- 합리적 기본값(인터뷰 미확정 항목):
  - 발신자 표시명: "보살핌 케어아카데미"(조정 가능).
  - 첨부 용량: Gmail 한도 내(메일당 합계 ~25MB).
  - 수신자: 우선 단일 수신자(필요 시 CC/다중 추후).

## Ontology (Key Entities)
| Entity | Type | Fields | Relationships |
|--------|------|--------|---------------|
| 이메일(Email) | core domain | 받는사람, 제목, 본문, 첨부파일[], 발신자(고정), 발송시각 | 상담원이 작성, 발송엔진이 전송 |
| 첨부파일(Attachment) | supporting | 파일명, 용량, 데이터(blob) | Email에 0..N개 포함, PC 업로드 출처 |
| 상담원(Agent) | actor | (식별 없음, PIN 공유) | Email 작성·발송 |
| 발신 계정(Sender) | external system | eju@bosalpim.co.kr, 표시명 | 모든 Email의 고정 발신, 보낸편지함 보관 |
| PIN | supporting | 공용 코드 | 발송 권한 게이트 |

## Ontology Convergence
| Round | Entity Count | New | Changed | Stable | Stability Ratio |
|-------|-------------|-----|---------|--------|----------------|
| 1 | 3 (Email, Agent, Sender) | 3 | - | - | N/A |
| 2 | 4 (+Attachment) | 1 | 0 | 3 | 75% |
| 3 | 4 | 0 | 0 | 4 | 100% |
| 4 | 4 | 0 | 0 | 4 | 100% |
| 5 | 5 (+PIN) | 1 | 0 | 4 | 80% |

## Interview Transcript
<details>
<summary>Full Q&A (5 rounds + Round 0)</summary>

### Round 0 — Topology
**A:** 상황: 채팅 문의 중 고객이 이메일 요청 시 상담원이 그 자리에서 작성·발송. 시트 데이터 소스 없음. 발신 = 은주 본인 메일. → 활성 2(화면+엔진), 이력 시트는 보낸편지함으로 갈음해 미룸.

### Round 1
**Q:** 발송 화면 접근 권한 수준은?
**A:** 간단 암호(PIN) 한 겹.
**Ambiguity:** 34%

### Round 2
**Q:** 메일 내용은 글만? 파일 첨부 필요?
**A:** 글 + 파일 첨부.
**Ambiguity:** 30%

### Round 3
**Q:** 첨부파일 출처는?
**A:** 상담원 컴퓨터에서 업로드.
**Ambiguity:** 26%

### Round 4 (Contrarian)
**Q:** "로그인 없이"가 정말 필수인 이유는?
**A:** 그냥 간편함 때문. → 웹앱+PIN 방식 확정.
**Ambiguity:** 24%

### Round 5
**Q:** 성공의 핵심 합격선은?
**A:** 고객에게 eju 주소로 (첨부 포함) 도착.
**Ambiguity:** 14% (임계값 통과)
</details>
