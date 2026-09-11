# /certification 사용 가이드

민간자격 **관리·운영 규정**(한국직업능력연구원 자격센터 등록용) 초안을 만들고, 확정하면 md·PDF로 저장하는 Claude Code 명령입니다.

> 최종 업데이트: 2026-09-11

---

## 1. 사용 방법

### 준비물
- 자격증 이름 (한국어)
- 등급 구성 (단일등급 / 1·2급 / 1·2·3급)
- 강의 커리큘럼 (목차 복사한 텍스트면 충분)

### 순서
1. 터미널에서 CS 폴더로 이동한 뒤 Claude Code를 켜고 `/certification` 입력
2. 질문 4개에 하나씩 답하기: 자격증 이름 → 등급 → 커리큘럼 붙여넣기 → 추가사항(없으면 "없음")
3. 채팅창에 **초안 전체**와 **수정 포인트 요약** 표가 나옴 → `[확인 필요]` 항목(보통 영문명·직무내용) 확인
4. 고칠 부분은 말로 요청 (예: "검정과목 2번 이름 바꿔줘") → 고친 초안을 다시 보여줌
5. 다 됐으면 **"확정"** 입력
6. 자동으로 진행됨
   - `certification/{YYMM} 신청자격증/` 폴더에 `{자격증명}-운영규정.md`와 `.pdf` 저장 (예: 2026년 9월 → `2609 신청자격증`)
   - Finder에서 그 폴더가 열림

### 알아두면 좋은 점
- 같은 이름 파일이 이미 있으면 **덮어쓰기 전에 물어봅니다.**
- `[확인 필요]` 표시가 남은 채로 확정하면 저장 전에 한 번 더 알려줍니다.
- 수정 포인트 요약 표는 채팅창에만 나오고 파일에는 들어가지 않습니다.
- 저장된 md를 메모장으로 열면 `## 제 1 장`처럼 `#`이 보이지만, **PDF에는 `#`이 나오지 않습니다.**
- 저장 후 수정: "○○ 운영규정 제8조 고치고 PDF 다시 만들어줘"라고 요청

### 고정값 (명령 안에 박혀 있어 묻지 않음)

| 항목 | 값 |
|------|-----|
| 기관명 | ㈜케어파트너 아카데미 (약칭 케어아카데미) |
| 홈페이지 | www.academy.carepartner.co.kr |
| 검정방법 | 온라인 필기 / 최종평가 20문항·60분 |
| 응시자격 | 연령·학력 제한 없음, 해당 검정 과목 50% 이상 이수자 |
| 수수료 | 100,000원 |
| 유효기간 | 평생자격 |

바꾸려면 `.claude/commands/certification.md`를 수정하세요.

---

## 2. 필요한 파일

### 꼭 있어야 하는 파일 (5개)

| 파일 | 하는 일 |
|------|--------|
| `.claude/commands/certification.md` | 명령 자체 (질문·작성 규칙·저장 절차) |
| `certification/template.md` | 운영규정 틀 (제1~9장·부칙·별표) |
| `certification/certification-samples/sample-노인생활지원사.pdf` | 문체 참고용 통과 샘플 |
| `certification/certification-samples/sample-병원동행매니저.pdf` | 구조 참고용 통과 샘플 |
| `certification/generate_pdf.py` | md → PDF 변환 |

폴더 구조를 그대로 유지해야 합니다. (`.claude`는 숨김 폴더라 Finder에서 `⌘⇧.`을 눌러야 보입니다.)

### 컴퓨터에 있어야 하는 것
- **맥(Mac)** — PDF 스크립트가 맥 기본 한글 폰트(AppleSDGothicNeo)를 씁니다
- **Python 3 + reportlab** — PDF 만드는 도구
- **Claude Code**

### 이 명령이 쓰지 않는 파일
`certification/SKILL.md`(옛 버전, 실행 안 됨) · `review_draft.py` · `review-criteria.md` · `certification-writing-guide.pdf` · 나머지 샘플 3개 · `2603 신청자격증/` 폴더
→ 명령이 읽지 않을 뿐, 사람이 참고하는 자료로는 쓸 수 있습니다.

---

## 3. 다른 사람 컴퓨터에서 사용하기

> 맥 기준입니다. 윈도우에서는 초안 작성까지는 되지만 **PDF 생성은 안 됩니다.**

### 1단계: Claude Code 설치·로그인
터미널에서 설치한 뒤 `claude`를 실행해 로그인합니다.
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

### 2단계: 파일 받기
저장소가 공개라서 둘 중 편한 방법으로 받으면 됩니다.

- **쉬운 방법:** https://github.com/Eunjua/CS 접속 → 초록색 **Code** 버튼 → **Download ZIP** → 압축 풀기
- **git 사용:** (나중에 업데이트 받기 편함)
  ```bash
  git clone https://github.com/Eunjua/CS.git
  ```

### 3단계: 경로 바꾸기 (필수)
명령 파일 안에 은주 컴퓨터 경로 `/Users/eunju/work/CS`가 **5곳** 박혀 있습니다. 받은 폴더 위치로 바꿔야 합니다.

가장 쉬운 방법 — CS 폴더에서 Claude Code를 켜고 이렇게 요청:
> `.claude/commands/certification.md` 안의 `/Users/eunju/work/CS` 를 지금 이 폴더 경로로 전부 바꿔줘

직접 바꾸려면 해당 파일에서 `/Users/eunju/work/CS`를 검색해 5곳(참고 파일 3줄, 저장 폴더 1줄, PDF 명령 1줄)을 수정합니다.

### 4단계: PDF 도구 설치
```bash
python3 -m pip install --user reportlab
```
`python3`이 없다는 창이 뜨면 "설치"를 눌러 개발자 도구를 설치한 뒤 다시 실행합니다.

### 5단계: 실행 확인
1. 터미널에서 CS 폴더로 이동 → `claude` 실행
   ```bash
   cd 받은폴더경로/CS
   claude
   ```
2. `/cert`까지 입력했을 때 `/certification`이 목록에 뜨면 성공
3. (선택) PDF 테스트 — 바탕화면에 test.pdf가 생기면 성공
   ```bash
   python3 certification/generate_pdf.py "certification/2603 신청자격증/학교안전지도사-운영규정.md" ~/Desktop/test.pdf
   ```

---

## 4. 문제 해결

| 증상 | 원인 · 해결 |
|------|-----------|
| `/certification`이 목록에 안 뜸 | CS 폴더가 아닌 곳에서 Claude Code를 켬 → CS 폴더에서 다시 실행 |
| template·샘플 파일을 못 찾음 | 경로를 안 바꿨거나 폴더를 옮김 → 3단계 다시 |
| `No module named 'reportlab'` | PDF 도구 미설치 → 4단계 실행 |
| `한글 폰트를 찾을 수 없습니다` | 맥이 아닌 컴퓨터 → 맥에서 PDF 생성 |
| "같은 이름 파일이 있어요" 질문 | 정상 동작 — 덮어쓸지 새 이름으로 할지 답하면 됨 |
