"""기출문제 답안지 아티팩트의 문제 데이터를 시트 기준으로 다시 만든다.

쓰는 법:
  python3 build_answer_sheet.py <시트.xlsx> <지금 페이지.html> <새 페이지.html>

- 시트: 「케어아카데미 자격증 기출문제 데이터」를 xlsx로 받은 파일 (탭 하나 = 과정 하나)
- 페이지: 답안지 아티팩트를 Artifact read로 받은 HTML. 화면은 그대로 두고 `const DATA = {...};` 한 줄만 바꾼다
- 표준 라이브러리만 쓴다 (openpyxl 설치 필요 없음)
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

# 답안지에 넣지 않는 탭. 이유를 같이 적어 둔다 — 풀 때는 여기서 지우면 된다.
EXCLUDE = {
    "디지털튜터": "문제 없음(제목 줄만)",
    "시니어웰니스전문가": "폐강",
    "일상돌봄매니저": "폐강",
    # 이름이 겹치는 5쌍 — 어느 쪽이 맞는지 은주 확인 중(2026-11-12)
    "학교안전지도사 시험": "겹침 확인 중",
    "학교안전지도사5": "겹침 확인 중",
    "노인심리상담사 시험": "겹침 확인 중",
    "노인심리상담사2": "겹침 확인 중",
    "안전지도사": "겹침 확인 중",
    "안전지도사2": "겹침 확인 중",
    "경로당행정매니저": "겹침 확인 중",
    "경로당행정매니저2": "겹침 확인 중",
    "병원원무행정전문가": "겹침 확인 중",
    "병원원무행정전문가2": "겹침 확인 중",
}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def read_xlsx(path):
    """{탭 이름: [[셀, ...], ...]} — 값은 모두 글자."""
    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            shared.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    rels = {r.get("Id"): r.get("Target") for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels"))}
    out = {}
    for sh in ET.fromstring(z.read("xl/workbook.xml")).find("m:sheets", NS):
        target = rels[sh.get(REL)].lstrip("/")
        target = target if target.startswith("xl/") else "xl/" + target
        rows = []
        for row in ET.fromstring(z.read(target)).iter("{%s}row" % NS["m"]):
            cells = {}
            for c in row.findall("m:c", NS):
                idx = 0
                for ch in re.match(r"[A-Z]+", c.get("r")).group():
                    idx = idx * 26 + ord(ch) - 64
                t = c.get("t")
                if t == "inlineStr":
                    v = "".join(x.text or "" for x in c.iter("{%s}t" % NS["m"]))
                else:
                    ve = c.find("m:v", NS)
                    v = None if ve is None else ve.text
                    if v is not None and t == "s":
                        v = shared[int(v)]
                cells[idx - 1] = v
            if cells:
                rows.append([cells.get(i) for i in range(max(cells) + 1)])
        out[sh.get("name")] = rows
    return out


def course_name(tab):
    return re.sub(r"\s*시험$", "", tab).strip()


def build(sheets):
    data, skipped, problems = {}, [], []
    for tab, rows in sheets.items():
        if tab in EXCLUDE:
            skipped.append(f"{tab} ({EXCLUDE[tab]})")
            continue
        if not rows:
            skipped.append(f"{tab} (빈 탭)")
            continue
        head = [str(h or "").strip() for h in rows[0]]
        need = ("question_text", "options", "correct_answer", "explanation")
        if not all(k in head for k in need):
            problems.append(f"{tab}: 제목 줄이 다름 {head}")
            continue
        col = {k: head.index(k) for k in need}
        qs = []
        for n, r in enumerate(rows[1:], start=2):
            get = lambda k: (r[col[k]] if col[k] < len(r) else None)
            q = (get("question_text") or "").strip()
            if not q:
                continue
            try:
                opts = json.loads(get("options") or "")
                o = [str(opts[k]).strip() for k in sorted(opts, key=int)]
                a = int(float(get("correct_answer")))
                assert 1 <= a <= len(o)
            except Exception:
                problems.append(f"{tab} {n}행: 보기나 정답을 못 읽음")
                continue
            qs.append({"q": q, "o": o, "a": a, "e": (get("explanation") or "").strip()})
        if not qs:
            skipped.append(f"{tab} (문제 없음)")
            continue
        name = course_name(tab)
        if name in data:
            problems.append(f"{tab}: 과정명 '{name}'이 다른 탭과 겹침 — 뒤 탭은 뺐음")
            continue
        data[name] = qs
    return data, skipped, problems


def main(xlsx, page_in, page_out):
    html = open(page_in, encoding="utf-8").read()
    m = re.search(r"const DATA = (\{.*?\});\n", html, re.S)
    if not m:
        sys.exit("페이지에서 const DATA 줄을 못 찾음 — 페이지 구조가 바뀌었는지 확인")
    old = json.loads(m.group(1))
    data, skipped, problems = build(read_xlsx(xlsx))
    new_json = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    html = html[:m.start(1)] + new_json + html[m.end(1):]
    open(page_out, "w", encoding="utf-8").write(html)

    added = [k for k in data if k not in old]
    removed = [k for k in old if k not in data]
    changed = [k for k in data if k in old and data[k] != old[k]]
    print(f"과정 {len(old)}개 → {len(data)}개, 문제 {sum(map(len, data.values()))}개")
    print("추가:", ", ".join(f"{k}({len(data[k])})" for k in added) or "없음")
    print("뺌:", ", ".join(removed) or "없음")
    print("문제 바뀜:", ", ".join(changed) or "없음")
    print("넣지 않은 탭:", ", ".join(skipped) or "없음")
    if problems:
        print("확인 필요:", *problems, sep="\n  ")


if __name__ == "__main__":
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(*sys.argv[1:])
