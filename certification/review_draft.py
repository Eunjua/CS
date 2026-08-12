#!/usr/bin/env python3
"""
민간자격 운영규정 초안을 Gemini(Google)에게 검토 요청하는 스크립트.
사용법: python3 review_draft.py [MD파일경로]
"""

import sys
import os

TEMPLATE_PATH = "/Users/eunju/work/CS/certification/template.md"

def load_template() -> str:
    try:
        with open(TEMPLATE_PATH, encoding="utf-8") as f:
            return f.read()
    except Exception:
        return ""

REVIEW_PROMPT = """다음은 한국직업능력연구원 자격센터 등록을 위한 민간자격 관리·운영 규정 초안입니다.

## 기준 템플릿 (이 형식을 최우선 기준으로 삼을 것)

{template}

---

## 검토 원칙

위 템플릿이 한국직업능력연구원 자격센터 등록을 위한 **공식 기준 양식**입니다.
아래 원칙에 따라 검토하고, 수정이 필요한 부분만 지적해주세요:

1. **템플릿과 동일한 문구·구조는 변경 제안 금지** — 템플릿 자체의 표현이나 구조가 마음에 들지 않더라도, 그것이 템플릿과 일치한다면 수정 제안하지 말 것
2. **조항 추가·삭제 제안 금지** — 조문 구조는 고정
3. 검토 대상: 자격증명·직무내용·검정기준·검정과목 등 **초안에서 새로 작성된 내용**의 맞춤법, 띄어쓰기, 법적 표현 오류, 문장 부자연스러움
4. **절대 변경 제안 금지 항목** (등록 필수 형식):
   - 제8조 ① 직무 설명 문단 구조 (삭제·축약 금지)
   - 제8조 ② 직무내용 표 (표 삭제·"제1항과 같다" 축약 제안 금지)
   - 제8조 ③ 검정기준 표 구조
   - 제9조 ①②③ 온라인 필기 고정 문구
   - 제29조 문항수(20문항)·시험시간(60분)
   - 별표1·별표2 표 구조
   - 별표2 "본인인증" 컬럼명 및 표 내용

---

## 검토 대상 초안

{content}
"""


def review_with_gemini(content: str, template: str) -> str:
    try:
        from google import genai
    except ImportError:
        return "[오류] google-genai 패키지가 설치되지 않았습니다. pip3 install google-genai 실행 후 다시 시도하세요."

    api_key = os.environ.get("GOOGLE_API_KEY")
    if not api_key:
        return "[오류] GOOGLE_API_KEY 환경변수가 설정되지 않았습니다."

    try:
        client = genai.Client(api_key=api_key)
        response = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=REVIEW_PROMPT.format(template=template, content=content),
        )
        if not response.candidates:
            return "[오류] Gemini 응답이 차단되었습니다."
        return response.text
    except Exception as e:
        return f"[오류] Gemini 검토 중 오류 발생: {e}"


def main():
    if len(sys.argv) < 2:
        print("사용법: python3 review_draft.py [MD파일경로]")
        sys.exit(1)

    md_path = sys.argv[1]
    if not os.path.exists(md_path):
        print(f"[오류] 파일을 찾을 수 없습니다: {md_path}")
        sys.exit(1)

    with open(md_path, encoding="utf-8") as f:
        content = f.read()

    template = load_template()
    print("Gemini 검토 중...")
    gemini_result = review_with_gemini(content, template)

    print("\n" + "=" * 60)
    print("=== Gemini 검토 결과 ===")
    print("=" * 60)
    print(gemini_result)


if __name__ == "__main__":
    main()
