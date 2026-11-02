#!/usr/bin/env python3
"""설문 자유의견 — 그 주 의견을 받아 마스킹하고 분류용 묶음 파일로 만든다.

    python3 comments.py 10/26~11/01 --out <저장소 밖 폴더>   # 주차를 안 주면 최신 주차
    python3 comments.py --cross <같은 폴더>                  # 분류(cls_의견N.jsonl) 뒤: 이유별 '해결 안 됨·일부' 건수
    python3 comments.py --selftest

- 대시보드 v2 웹앱 doPost(action=comments, 열쇠 필요)에서 받는다. 주소·열쇠는 gas/voc-v2/.local.json
- 주차는 상담 주차 기준 — 집계_설문의 "해결됐어요" 비율과 같은 응답 묶음이다
- 인사만 있는 의견("감사합니다" 등)은 건수만 세고 분류에서 뺀다
- 나오는 파일: raw_의견.txt · chunk_의견N.txt (sample_chats.py와 같은 형식이라 tally.py로 센다) ·
  links_의견.md (상담 링크 — 노션 토글용, 저장소에 쓰지 않는다)
"""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sample_chats import mask  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
LOCAL = ROOT / "gas" / "voc-v2" / ".local.json"
TOPIC = "의견"

# 인사·짧은 칭찬만 있는 의견. 이것만 있으면 분류할 내용이 없다.
GREETING = re.compile(
    r'^[\s\W]*(감사|고맙|고마워|수고|친절|좋아|좋았|좋습|좋네|굿|good|최고|만족|ㄳ|ㄱㅅ|넵|네|예|없|없습|없어|없음|특별히|딱히|잘\s?받|빠르|신속)'
    r'[\s\S]{0,25}$', re.I)


def is_greeting(text):
    t = text.strip()
    return len(t) <= 4 or bool(GREETING.match(t))


def fetch(week):
    conf = json.loads(LOCAL.read_text())
    body = json.dumps({"token": conf["token"], "action": "comments", "week": week or ""}).encode()
    req = urllib.request.Request(conf["url"], data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as res:
        text = res.read().decode()
    try:
        out = json.loads(text)
    except json.JSONDecodeError:
        sys.exit("웹앱이 JSON이 아닌 응답을 줌 (권한 허용이 풀렸거나 배포 문제):\n" + text[:300])
    if not out.get("ok"):
        sys.exit("실패: " + json.dumps(out, ensure_ascii=False))
    return out


def channel_of(r):
    # 웹앱이 상담원본 대화링크에서 뽑아 준 채널. 없으면(옛 행) 케어파트너 쪽 태그로 짐작한다
    if r.get("channel"):
        return r["channel"]
    return "carepartner" if re.search(r'(^|,\s*)(요_|기관_)', r.get("tags") or "") else "carepartner-academy"


def block(r):
    medium = "phone" if str(r.get("medium", "")).lower() == "phone" else "app"
    head = (f"#### {TOPIC} chat={r['chatId'][-8:]} medium={medium} at={r.get('at', '')} "
            f"만족도={r.get('csat', '')} 친절도={r.get('kindness', '')} 해결={r.get('resolved', '')} "
            f"대기={r.get('waiting', '')} tags=[{r.get('tags', '')}]")
    return head + "\n고객(설문): " + mask(r["comment"]).replace("\n", " / ") + "\n"


def build(rows, chunk):
    keep = [r for r in rows if not is_greeting(r["comment"])]
    blocks = [block(r) for r in keep]
    chunks = [blocks[i:i + chunk] for i in range(0, len(blocks), chunk)]
    links = [f"- [{r['chatId'][-8:]}](https://desk.channel.io/{channel_of(r)}/user-chats/{r['chatId']}) · "
             f"{'전화' if str(r.get('medium', '')).lower() == 'phone' else '채팅'} · {r.get('resolved', '')}" for r in keep]
    return keep, blocks, chunks, links


def cross(folder):
    """이유별 의견 수와 그중 설문에서 '해결 안 됨·일부'로 답한 수 — 리포트 5번 표의 열."""
    folder = Path(folder)
    raw = (folder / f"raw_{TOPIC}.txt").read_text()
    resolved = {c: r for c, r in re.findall(rf"^#### {TOPIC} chat=(\w{{8}}).*? 해결=(\S*)", raw, re.M)}
    total, unres = {}, {}
    for f in sorted(folder.glob(f"cls_{TOPIC}*.jsonl")):
        for line in f.read_text().splitlines():
            if not line.strip():
                continue
            d = json.loads(line)
            cat = d["category"]
            total[cat] = total.get(cat, 0) + 1
            if not resolved.get(d["chat"], "").startswith("✅"):
                unres[cat] = unres.get(cat, 0) + 1
    for cat in sorted(total, key=lambda c: -total[c]):
        print(f"{cat}: {total[cat]}건 · 해결 안 됨·일부 {unres.get(cat, 0)}건")
    return total, unres


def selftest():
    assert is_greeting("감사합니다 ") and is_greeting("친절하게 응대해주셔서 감사합니다") and is_greeting("없음")
    assert not is_greeting("AI 상담이 주는 단답식 해결이 미흡함")
    assert not is_greeting("자격증 가격이 꽤 비싸네요")
    rows = [{"chatId": "6ae010dec1f80913bb47", "comment": "감사합니다", "medium": "app"},
            {"chatId": "6ae2a0bf0000aaaa1111", "comment": "연락 준다더니 01012345678 연락이 없어요", "medium": "phone",
             "resolved": "❌ 아직 해결되지 않았어요", "tags": "요_계정/본인인증"}]
    keep, blocks, chunks, links = build(rows, 40)
    assert len(keep) == 1 and "[숫자]" in blocks[0] and "01012345678" not in blocks[0]
    assert re.match(rf"^#### {TOPIC} chat=aaaa1111 medium=phone", blocks[0])
    assert "carepartner/user-chats/6ae2a0bf0000aaaa1111" in links[0]
    import tempfile
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / f"raw_{TOPIC}.txt").write_text("\n".join(blocks))
        (Path(d) / f"cls_{TOPIC}1.jsonl").write_text(json.dumps({"chat": "aaaa1111", "category": "대기연락"}) + "\n")
        total, unres = cross(d)
        assert total == {"대기연락": 1} and unres == {"대기연락": 1}
    print("comments.py selftest ok")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("week", nargs="?")
    ap.add_argument("--out")
    ap.add_argument("--chunk", type=int, default=40)
    ap.add_argument("--cross")
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        return selftest()
    if a.cross:
        cross(a.cross)
        return
    if not a.out:
        sys.exit("--out <저장소 밖 폴더>가 필요합니다")
    data = fetch(a.week)
    rows = data["rows"]
    keep, blocks, chunks, links = build(rows, a.chunk)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    (out / f"raw_{TOPIC}.txt").write_text("\n".join(blocks))
    for i, c in enumerate(chunks, 1):
        (out / f"chunk_{TOPIC}{i}.txt").write_text("\n".join(c))
    (out / f"links_{TOPIC}.md").write_text("\n".join(links) + "\n")
    res = [r for r in keep if r.get("resolved")]
    unres = sum(1 for r in res if not r["resolved"].startswith("✅"))
    print(f"{data['week']} · 설문 응답 {data['responses']}건 · 자유의견 {data['comments']}건 "
          f"(인사만 {len(rows) - len(keep)} · 분류할 의견 {len(keep)}건, 그중 해결 안 됨·일부 {unres}건)")
    for i, c in enumerate(chunks, 1):
        print(f"  chunk_{TOPIC}{i}.txt {len(c)}건")
    print(f"→ {out}/raw_{TOPIC}.txt · links_{TOPIC}.md")


if __name__ == "__main__":
    main()
