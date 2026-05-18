# Deep Interview Spec: VOC 주간 리포트 자동화

## Metadata
- Interview ID: di-20260518-001
- Rounds: 7
- Final Ambiguity Score: 15%
- Type: brownfield
- Generated: 2026-05-18
- Threshold: 20%
- Status: PASSED

## Clarity Breakdown
| 차원 | 점수 | 가중치 | 가중합계 |
|------|------|--------|----------|
| 목표 명확도 | 0.90 | 35% | 0.315 |
| 제약 명확도 | 0.85 | 25% | 0.213 |
| 성공 기준 | 0.80 | 25% | 0.200 |
| 컨텍스트 명확도 | 0.80 | 15% | 0.120 |
| **총 명확도** | | | **0.848** |
| **모호성** | | | **15.2%** |

---

## Goal
Google Sheets 버튼 1번 클릭으로 완성된 VOC 주간 리포트를 Notion에 자동 저장하는 반자동 시스템 구축.

GAS가 ChannelTalk 태그 데이터를 수집하고, 은주가 CSAT·당일응대율을 Sheets에 입력하면, 버튼 클릭 한 번으로 OKR 목표값 포함 완성 리포트가 Notion에 생성된다.

---

## Constraints
1. **실행 환경**: Google Apps Script (GAS) + Google Sheets
2. **트리거**: Google Sheets 버튼 클릭 (완전 자동 스케줄러 아님)
3. **수동 입력 유지**: 매주 CSAT(채팅/전화 평균·분포) + 당일응대율은 ChannelTalk 대시보드에서 확인 후 Google Sheets에 직접 입력
4. **OKR 목표값 위치**: Google Sheets 고정 셀 (분기별 수정)
5. **기존 GAS 수집 유지**: 태그별 건수, 총 VOC, NPS, 재문의율은 이미 자동 수집 중
6. **출력 대상**: Notion 페이지 자동 생성

---

## Non-Goals
- ChannelTalk API에서 CSAT 자동 수집 (수동 입력 유지)
- 완전 자동화 (스케줄러 없음)
- `dashboard/index.html` 변경
- top_voc 텍스트 요약 (이번 범위 아님)

---

## Acceptance Criteria
- [ ] Google Sheets에 CSAT + 당일응대율 입력 후 버튼 클릭 시 Notion 페이지가 생성된다
- [ ] OKR 목표값이 Google Sheets 고정 셀에서 읽혀 리포트에 `실제 / OKR목표 (전주)` 형식으로 표시된다
- [ ] CSAT 채팅/전화 분리 표시 — 각각 평균 + 점수 분포(1~5점별 건수) 포함
- [ ] 처리 건수 전주 대비 증감 % 자동 계산된다
- [ ] 기존 태그 분석 섹션 (카테고리별 현황 / TOP 5 태그 / 이상 태그 알림 / 한 줄 인사이트) 유지된다

---

## Report Format (목표 리포트 예시)

### OKR 지표
| 지표 | 실적 | 목표 | 전주 |
|------|------|------|------|
| 상담만족도 | 3.72 | 4.2 | 3.73 |
| 재문의율 | 4.5% | 3.5% | 2.2% |
| 당일응대율 | 87.5% | 96% | 83.3% |
| 처리건수 | 1,057건 | — | 868건 (+39.3%) |

### CSAT 상세
**채팅 CSAT** — 평균 3.92점
점수 분포: 1점 3건 / 3점 7건 / 4점 13건 / 5점 13건

**전화 CSAT** — 평균 3.65점
점수 분포: 1점 20건 / 2점 6건 / 3점 9건 / 4점 27건 / 5점 44건

### 카테고리별 현황 (기존 유지)
| 카테고리 | 이번 주 | 지난 주 | 증감 |
|---------|--------|--------|------|
| 아카데미 | ... | ... | ... |
| 기관 | ... | ... | ... |
| 요양 | ... | ... | ... |

### TOP 5 태그 / 이상 태그 알림 / 한 줄 인사이트 (기존 유지)

---

## Google Sheets 구조 (신규 추가 필요)

| 시트명 | 내용 |
|--------|------|
| `주간입력` | 매주 CSAT(채팅/전화 평균·분포), 당일응대율 입력 셀 + 리포트 생성 버튼 |
| `OKR목표` | 상담만족도 목표, 재문의율 목표, 당일응대율 목표 (고정 셀, 분기 수정) |

---

## Technical Context

| 구성요소 | 현황 | 변경 내용 |
|---------|------|----------|
| GAS | ChannelTalk 태그 수집 → report.json | Notion 업로드 로직 추가 |
| Google Sheets | 미사용 | 입력 셀 + OKR 셀 + 버튼 추가 |
| report.json | 태그·NPS·재문의율 | 구조 변경 없음 |
| Notion | voc-report 스킬로 수동 업로드 | GAS에서 자동 업로드 |
| dashboard/index.html | Chart.js 대시보드 | 변경 없음 |

---

## Ontology (Key Entities)

| 엔티티 | 유형 | 주요 속성 | 관계 |
|--------|------|----------|------|
| VOC데이터 | core domain | 태그, 건수, 주차 | GAS가 ChannelTalk에서 수집 |
| CSAT | core domain | 채팅평균, 전화평균, 점수분포 | 은주가 Sheets에 수동 입력 |
| OKR목표 | core domain | 만족도목표, 재문의율목표, 응대율목표 | Sheets 고정 셀에 저장 |
| 리포트 | core domain | 주간 지표 요약 | GAS가 생성, Notion에 저장 |
| Google Sheets | supporting | 입력셀, OKR셀, 버튼 | 트리거 + 데이터 입력 인터페이스 |
| GAS | supporting | 수집 스크립트, 생성 스크립트 | Sheets → Notion 파이프라인 |
| Notion페이지 | external system | 리포트 본문 | 최종 출력 |
| ChannelTalk | external system | 태그, VOC원문 | GAS가 API 호출 |
| report.json | supporting | 태그집계, NPS, 재문의율 | GAS 수집 결과 저장 |

---

## Ontology Convergence

| 라운드 | 엔티티 수 | 신규 | 변경 | 유지 | 안정성 |
|--------|----------|------|------|------|--------|
| 1 | 4 | 4 | - | - | N/A |
| 2 | 8 | 4 | 0 | 4 | 50% |
| 3 | 8 | 0 | 0 | 8 | 100% |
| 4 | 8 | 0 | 0 | 8 | 100% |
| 5 | 9 | 1 (Google Sheets) | 0 | 8 | 89% |
| 6~7 | 9 | 0 | 0 | 9 | 100% |

---

## Interview Transcript
<details>
<summary>전체 Q&A (7라운드)</summary>

### Round 1
**Q:** "자동 리포트"가 완성됐을 때, 은주가 매주 하지 않아도 되는 작업이 구체적으로 뭔가요?
**A:** 데이터 수집 → 전체 과정
**Ambiguity:** 75%

### Round 2
**Q:** 현재 ChannelTalk VOC 데이터를 report.json으로 기록하는 작업을 어떻게 하고 계신지요?
**A:** GAS를 통해 수집 중인데, 수집되는 내용이 분석 요청 시 모든 내용을 포함하지 않는 것 같다
**Ambiguity:** 64%

### Round 3
**Q:** GAS가 수집하는 데이터에서 없어서 불편한 게 뭔가요?
**A:** CSAT도 없고 top_voc도 없음 (둘 다 없음)
**Ambiguity:** 56%

### Round 4
**Q:** 자동화하고 싶은 범위가 어디인가요?
**A:** (A) GAS 수집 보완 + 리포트 자동화
**Ambiguity:** 49%

### Round 5
**Q:** "버튼 1번"이 어떤 환경에서의 버튼인가요?
**A:** Google Sheets의 버튼
**Ambiguity:** 39%

### Round 6
**Q:** Notion에 리포트가 올라갔을 때 어떤 내용이 있으면 "완성"인가요? (논의 요청)
**A:** OKR 내용 + 대응 건수 포함 원함. 구체적 형식 제시:
- 상담만족도: 3.72 / 4.2 (전주 3.73)
- 채팅 CSAT 평균 3.92 + 점수 분포
- 전화 CSAT 평균 3.65 + 점수 분포
- 재문의율: 4.5% / 3.5% (전주 2.2%)
- 당일응대율: 87.5% / 96% (전주 83.3%)
- 처리건수: 868건 → 1057건 (전주대비 39.3% 증가)
**Ambiguity:** 20%

### Round 7
**Q:** OKR 목표값은 어디에 넣어두면 좋을까요?
**A:** Google Sheets 안에 고정 셀로
**Ambiguity:** 15%

</details>
