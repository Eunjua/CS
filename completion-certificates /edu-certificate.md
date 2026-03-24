---
name: edu-certificate
description: 교육 이수증을 생성하고 PDF로 저장. 사용자가 이수증을 요청하거나 /edu-certificate을 호출하면 실행.
argument-hint: "[수강자이름]"
---

## 역할

사용자와 대화를 통해 정보를 수집한 뒤, 교육 이수증을 PDF로 생성하여 저장한다.

---

## 고정값 (질문하지 않는다)

| 항목 | 값 |
|------|-----|
| 발급 기관 | 케어파트너아카데미 |
| 저장 경로 | `/Users/eunju/Documents/04.Git/CS/completion-certificates /` |
| 도장 이미지 | `/Users/eunju/Documents/02.보살핌/케어아카데미_도장.png` |
| 발급일 | 오늘 날짜 (자동) |
| 파일명 형식 | `이수증_수강자이름.pdf` |
| 수강 시작일 | 만료일 기준 2주 전 (자동 계산) |

---

## 진행 절차

### 1단계: 수강자 이름 확인

- `$ARGUMENTS`가 있으면 그것을 수강자 이름으로 사용
- 없으면 먼저 질문

### 2단계: 정보 수집 (하나씩 순서대로)

다음 항목을 **하나씩** 질문한다. 답변을 받은 후 다음 질문으로 넘어간다:

1. **생년월일** — `YYYYMMDD` 형식으로 입력 요청
2. **과정명** — 수강한 교육 과정 이름
3. **수강 만료일** — 교육 종료일 (예: 20260313). 시작일은 2주 전으로 자동 계산.

### 3단계: 정보 확인

수집한 정보를 한 번에 보여주고 맞는지 확인 요청. 수정 요청이 있으면 해당 항목만 재입력 받는다.

### 4단계: PDF 생성

아래 Python 코드를 실행하여 PDF를 생성한다. 수집한 정보로 변수를 채운다.

```python
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import date, timedelta
import os

# ── 입력값 ──────────────────────────────────────────────
applicant_name = "{{수강자이름}}"
birth_date_raw = "{{생년월일}}"   # YYYYMMDD
course_name = "{{과정명}}"
end_date_raw = "{{수강만료일}}"   # YYYYMMDD

# ── 고정값 ──────────────────────────────────────────────
org_name = "케 어 파 트 너 아 카 데 미"
stamp_path = "/Users/eunju/Documents/02.보살핌/케어아카데미_도장.png"
output_dir = "/Users/eunju/Documents/04.Git/CS/completion-certificates "
output_path = os.path.join(output_dir, f"이수증_{applicant_name}.pdf")
issue_date = date.today().strftime("%Y년 %m월 %d일")

# ── 날짜 계산 ────────────────────────────────────────────
y, m, d = int(end_date_raw[:4]), int(end_date_raw[4:6]), int(end_date_raw[6:8])
end_date = date(y, m, d)
start_date = end_date - timedelta(weeks=2)

birth_y, birth_m, birth_d = birth_date_raw[:4], birth_date_raw[4:6], birth_date_raw[6:8]
birth_formatted = f"{birth_y}년 {birth_m}월 {birth_d}일"
period_formatted = f"{start_date.strftime('%Y년 %m월 %d일')} ~ {end_date.strftime('%Y년 %m월 %d일')}"

# ── PDF 생성 ─────────────────────────────────────────────
pdfmetrics.registerFont(TTFont("KR", "/Library/Fonts/Arial Unicode.ttf"))
w, h = A4
c = canvas.Canvas(output_path, pagesize=A4)
margin = 3.5 * cm

# 제목
title = "교 육 이 수 증"
c.setFont("KR", 22)
title_w = c.stringWidth(title, "KR", 22)
c.drawString((w - title_w) / 2, h - 5 * cm, title)

c.setLineWidth(1.2)
c.line(margin, h - 5.9 * cm, w - margin, h - 5.9 * cm)

# 수강자 정보
c.setFont("KR", 12)
c.drawString(margin, h - 7.0 * cm, "■  수강자 정보")
c.setFont("KR", 11)
c.drawString(margin + 0.5*cm, h - 8.3 * cm, f"성          명  :  {applicant_name}")
c.drawString(margin + 0.5*cm, h - 9.6 * cm, f"생  년  월  일  :  {birth_formatted}")

c.setLineWidth(1.2)
c.line(margin, h - 10.6 * cm, w - margin, h - 10.6 * cm)

# 과정 정보
c.setFont("KR", 12)
c.drawString(margin, h - 11.7 * cm, "■  과정 정보")
c.setFont("KR", 11)
c.drawString(margin + 0.5*cm, h - 13.0 * cm, f"과  정  명  :  {course_name}")
c.drawString(margin + 0.5*cm, h - 14.3 * cm, f"수강기간  :  {period_formatted}")

c.setLineWidth(1.2)
c.line(margin, h - 15.3 * cm, w - margin, h - 15.3 * cm)

# 확인 문구
confirm = "위 사람은 상기 교육 과정을 이수하였음을 확인합니다."
c.setFont("KR", 11)
confirm_w = c.stringWidth(confirm, "KR", 11)
c.drawString((w - confirm_w) / 2, h - 21 * cm, confirm)

# 날짜 & 기관명
c.setFont("KR", 11)
date_w = c.stringWidth(issue_date, "KR", 11)
c.drawString((w - date_w) / 2, h - 24 * cm, issue_date)

c.setFont("KR", 14)
org_w = c.stringWidth(org_name, "KR", 14)
org_x = (w - org_w) / 2
org_y = h - 25.5 * cm
c.drawString(org_x, org_y, org_name)

# 도장 (기관명 끝에 살짝 겹치게)
if os.path.exists(stamp_path):
    stamp_size = 2.2 * cm
    c.drawImage(stamp_path, org_x + org_w - 0.5*cm, org_y - 0.7*cm,
                width=stamp_size, height=stamp_size, mask='auto')

c.save()
print(f"저장 완료: {output_path}")
```

### 5단계: 완료 안내

- 저장된 파일 경로를 알려준다
- 수정이 필요하면 어떤 항목인지 물어본다
