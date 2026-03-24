---
name: certification
description: 민간자격 관리·운영 규정 문서를 생성하고 PDF로 저장. 사용자가 자격증 이름을 말하거나 /certification을 호출하면 실행.
argument-hint: "[자격증명]"
---

## 역할

사용자와 대화를 통해 정보를 수집한 뒤, 민간자격 관리·운영 규정 초안을 작성하고 PDF로 저장한다.

---

## 고정값 (질문하지 않는다)

| 항목 | 값 |
|------|-----|
| 기관명 | ㈜케어파트너 아카데미 |
| 기관명약칭 | 케어아카데미 |
| 홈페이지 | https://www.carepartner.kr/academy |
| 시험 방식 | 온라인 필기 (고정) |
| 수수료 | 100,000원 |
| 문항 수 | 20문항 |

---

## 템플릿 참고

!`cat /Users/eunju/Documents/04.Git/CS/certification/template.md`

---

## 진행 절차

### 1단계: 자격증명 확인

- `$ARGUMENTS`가 있으면 그것을 자격증명으로 사용
- 없으면 먼저 질문

---

### 2단계: 사전 체크리스트 질문 (하나씩 순서대로)

다음 두 가지를 **하나씩** 물어본다. 답변을 받은 후 다음 질문으로 넘어간다:

1. **영문명** — 직접 영문명을 제안하고 맞는지 확인 요청
2. **등급 구성** — 아래 중 선택 요청 (영문명 확인 후 질문):
   - 단일등급
   - 1급 / 2급
   - 1급 / 2급 / 3급

---

### 3단계: 커리큘럼 요청

"자격증 커리큘럼(과정명 목록)을 알려주시면 검정과목과 검정기준을 작성하겠습니다." 라고 안내하고 기다린다.

사용자가 커리큘럼을 제공하면 아래 항목을 작성한다:

**직무내용** (등급별, 각 200자 이내)
- 이 자격을 가진 사람이 실제로 수행하는 업무를 구체적으로 기술
- 등급이 여러 개면 등급별로 난이도·범위를 달리 작성

**검정기준** (등급별, 각 200자 이내)
- 커리큘럼 과목에서 다루는 **이론적 지식**만 평가함을 기준으로 작성
- ⚠️ "실무", "실습", "현장" 등 실기 관련 표현 절대 금지
- 마무리 문구: "~에 대한 이론적 지식을 평가하여 [자격증명] 서비스 지원 분야에서 전문성 습득 여부를 검정기준으로 한다."

**검정과목** (등급별)
- 커리큘럼 과정명을 그대로 또는 간략하게 정리하여 과목명으로 사용
- 3개 내외 권장

작성 후 사용자에게 보여주고 수정 의견을 물어본다.

---

### 4단계: 운영규정 전체 문서 생성

확인이 완료되면 템플릿의 모든 `{변수}`를 채워 완성된 마크다운 문서를 생성한다.

작성 규칙:
- 기관명이 들어가는 모든 위치 일괄 치환
- **제7조**: 등급 구성에 맞게 작성
  - 단일등급: `② 등급은 단일등급으로 한다.`
  - 1·2급: `② 등급은 1급과 2급으로 한다.`
- **제8조**: 직무내용 문단(①) + 직무내용 표(②) + 검정기준 표(③) 모두 작성
  - 등급이 여러 개면 표에 등급별 행 추가
- **제9조 ①②③**: 온라인 필기 고정 문구 사용
- **제9조 ④ 검정과목 표**: 4열 구성, 과목마다 별도 행 (`<br>` 사용 금지)
- **제10조 응시자격 표**: 항목마다 별도 행 (`<br>` 사용 금지)
  - **기타** 항목은 무조건 아래 문구로 고정:
    `본 기관에서 해당 검정 과목에 대하여 50% 이상 이수한 자`
- **제15조**: 홈페이지 주소 반영
- **제29조**: 20문항 고정

---

### 5단계: MD 저장 + AI 검토 (Gemini)

1. 마크다운 파일 저장:
   ```
   /Users/eunju/Documents/04.Git/CS/certification/[자격증명]-운영규정.md
   ```

2. AI 검토 실행 (Bash):
   ```bash
   python3 /Users/eunju/Documents/04.Git/CS/certification/review_draft.py \
     "/Users/eunju/Documents/04.Git/CS/certification/[자격증명]-운영규정.md"
   ```

3. Gemini 검토 결과를 사용자에게 보여준다.
4. 수정이 필요한지 물어본다. 수정 요청이 있으면 MD를 수정하고 다시 검토 없이 다음 단계로 넘어간다.

---

### 6단계: PDF 생성

내용이 확정되면 아래 Python 코드를 Bash로 실행하여 PDF를 생성한다.

**표 빈 셀 처리 규칙**: 같은 열에서 연속된 빈 셀(`<td></td>`)은 위 셀에 `rowspan`을 적용해 병합하고 `text-align: center; vertical-align: middle`로 중앙정렬한다.

```bash
python3 - << 'PYEOF'
import markdown, re
from bs4 import BeautifulSoup
from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

MD_PATH = "/Users/eunju/Documents/04.Git/CS/certification/[자격증명]-운영규정.md"
PDF_PATH = MD_PATH.replace(".md", ".pdf")

md_text = open(MD_PATH, encoding="utf-8").read()
html_body = markdown.markdown(md_text, extensions=["tables", "nl2br"])

# ── 표 빈 셀 병합 처리 ──────────────────────────────────────────
soup = BeautifulSoup(html_body, "html.parser")
for table in soup.find_all("table"):
    rows = table.find_all("tr")

    # 열 너비 고정: 자격종목(1열)·등급(2열)은 좁게, 나머지는 자동
    # → <colgroup> 삽입으로 처리
    # 각 열별로 빈 셀을 위 셀에 rowspan 병합
    col_map = {}  # col_index → (td요소, rowspan카운트)
    for row in rows:
        cells = row.find_all(["td", "th"])
        col_idx = 0
        for cell in cells:
            span = int(cell.get("colspan", 1))
            text = cell.get_text(strip=True)
            if cell.name == "td" and text == "":
                # 빈 셀 → 위 셀에 병합
                if col_idx in col_map:
                    origin_td, _ = col_map[col_idx]
                    current = int(origin_td.get("rowspan", 1))
                    origin_td["rowspan"] = current + 1
                    origin_td["style"] = "text-align:center; vertical-align:middle;"
                    cell.decompose()
            else:
                col_map[col_idx] = (cell, 1)
            col_idx += span

html_body = str(soup)
# ────────────────────────────────────────────────────────────────

html_content = f"""<!DOCTYPE html>
<html lang="ko"><head><meta charset="UTF-8"></head>
<body>{html_body}</body></html>"""

css = CSS(string="""
@page {{
    size: A4;
    margin: 2.5cm 2.2cm;
    @bottom-right {{
        content: counter(page);
        font-size: 9pt;
        color: #666;
    }}
}}
body {{
    font-family: 'Noto Sans CJK KR', 'Noto Sans KR', sans-serif;
    font-size: 10.5pt;
    line-height: 1.8;
    color: #1a1a1a;
}}
h1 {{
    font-size: 18pt;
    font-weight: 700;
    text-align: center;
    margin: 0 0 6pt 0;
    padding-bottom: 8pt;
    border-bottom: 2px solid #1a1a1a;
}}
h1 + p {{
    text-align: center;
    font-size: 11pt;
    color: #444;
    margin: 0 0 20pt 0;
}}
h2 {{
    font-size: 12pt;
    font-weight: 700;
    margin: 20pt 0 8pt 0;
    padding: 5pt 8pt;
    background: #f0f0f0;
    border-left: 4px solid #333;
}}
h3 {{
    font-size: 11pt;
    font-weight: 700;
    margin: 14pt 0 5pt 0;
}}
p {{
    margin: 4pt 0;
    text-align: justify;
}}
ol, ul {{
    padding-left: 20pt;
    margin: 4pt 0;
}}
li {{ margin: 2pt 0; }}
table {{
    width: 100%;
    border-collapse: collapse;
    margin: 8pt 0;
    font-size: 9.5pt;
    table-layout: auto;
}}
th {{
    background: #e8e8e8;
    font-weight: 700;
    padding: 6pt 8pt;
    border: 1px solid #999;
    text-align: center;
    white-space: nowrap;
}}
td {{
    padding: 5pt 8pt;
    border: 1px solid #bbb;
    vertical-align: top;
    line-height: 1.6;
    word-break: keep-all;
}}
tr:nth-child(even) td {{ background: #fafafa; }}
hr {{
    border: none;
    border-top: 1px solid #ccc;
    margin: 14pt 0;
}}
""")

font_config = FontConfiguration()
HTML(string=html_content).write_pdf(PDF_PATH, stylesheets=[css], font_config=font_config)
print(f"PDF 저장 완료: {PDF_PATH}")
PYEOF
```

완료 후 PDF 파일 경로를 사용자에게 알려준다.