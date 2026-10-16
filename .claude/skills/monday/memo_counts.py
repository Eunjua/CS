#!/usr/bin/env python3
"""채널톡 export에서 상담원별 날짜별 응대 건수를 세어 하루 메모 페이지용 JSON을 만든다.

사용:
  python3 memo_counts.py 채널톡 --out <임시폴더> [--cutoff 2026-10-18]

- 상담원·페이지 목록은 .claude/skills/monday/memo_pages.local.json (git에 안 올라감)
    {"pages": [{"key": "...", "name": "<Manager data의 이름>", "type": "chat"|"phone", "url": "https://claude.ai/artifact/..."}]}
- chat : 그 상담원이 고객에게 공개 답장을 1번 이상 보낸 상담 수, 날짜는 첫 답장일. 파트너=pt, 아카데미=ac
- phone: 그 상담원에게 연결된 통화 수(firstEngagedAt 있음), 날짜는 연결된 날. pt에 넣음
  (페이지에 "split"이 있으면 3분류 — 걸었는데 안 받음=mi, 연결+인터뷰 태그뿐=ac, 나머지 연결=pt. 민강·지영 같은 기준)
- 기간: export가 빠짐없이 담고 있는 첫날 ~ cutoff(기본: 오늘 전 마지막 일요일). 그 사이 모든 날짜를 0 포함해 내보내
  페이지의 같은 날짜 값을 덮어쓴다(일부만 센 날이 남지 않게)
- 결과: <out>/<key>.json = {"days": {...}, "through": cutoff} → ArtifactData update(병합)로 stats/daily에 넣는다
"""
import argparse
import json
import sys
import warnings
from datetime import date, timedelta
from pathlib import Path

import pandas as pd

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
CONF = HERE / "memo_pages.local.json"
CHANNEL = {201411: "ac", 87358: "pt"}  # 아카데미 / 케어파트너
EXPORT_CAP = 10000  # 채널톡 export 상한 — 이만큼 차면 첫날은 일부만 담김


def last_sunday(today):
    return today - timedelta(days=(today.weekday() + 1) % 7 or 7)


def read_export(path):
    x = pd.ExcelFile(path)
    mg = x.parse("Manager data", usecols=["id", "channelId", "name"])
    ch = CHANNEL.get(int(mg["channelId"].iloc[0]))
    if ch is None:
        sys.exit(f"{path.name}: 모르는 channelId {mg['channelId'].iloc[0]}")
    uc = x.parse("UserChat", usecols=["id", "createdAt", "tags"])
    tagsets = {str(r["id"]): frozenset(t.strip() for t in str(r["tags"]).split(",") if t.strip()) if pd.notna(r["tags"]) else frozenset() for _, r in uc.iterrows()}
    m = x.parse("Message data", usecols=["chatId", "personType", "personId", "createdAt", "isPrivate"])
    m = m[(m.personType == "manager") & (m.isPrivate.astype(str).str.lower() != "true")].copy()
    m["personId"] = m.personId.astype(str).str.replace(r"\.0$", "", regex=True)
    m["t"] = pd.to_datetime(m.createdAt, errors="coerce")
    # 상한에 걸린 export는 오래된 재오픈 상담이 섞여 createdAt이 몇 달 전까지 가므로, 첫 답장 다음 날부터 온전하다고 본다
    if len(uc) >= EXPORT_CAP:
        first_full = m.t.min().date() + timedelta(days=1)
    else:
        first_full = pd.to_datetime(uc["createdAt"], errors="coerce").min().date()
    cols = ["userChatId", "callAssigneeId", "direction", "startedAt", "firstEngagedAt"]
    meet = x.parse("UserChat meet data", usecols=cols) if "UserChat meet data" in x.sheet_names else pd.DataFrame(columns=cols)
    meet["conn"] = meet.firstEngagedAt.notna()  # 연결된 통화
    meet["tags"] = meet.userChatId.astype(str).map(lambda c: tagsets.get(c, frozenset()))
    meet["cid"] = meet.callAssigneeId.astype(str).str.replace(r"\.0$", "", regex=True)
    meet["t"] = pd.to_datetime(meet.firstEngagedAt.where(meet.conn, meet.startedAt), errors="coerce")  # 연결된 날, 안 됐으면 건 날
    ids = {str(r["name"]): str(r["id"]) for _, r in mg.iterrows()}
    return {"file": path.name, "ch": ch, "first_full": first_full, "ids": ids, "msg": m, "meet": meet}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("folder")
    ap.add_argument("--out", required=True)
    ap.add_argument("--cutoff")
    a = ap.parse_args()
    if not CONF.exists():
        sys.exit(f"{CONF} 가 없음 — 하루 메모 페이지 목록을 먼저 만들어 주세요")
    pages = json.loads(CONF.read_text())["pages"]
    files = sorted(p for p in Path(a.folder).glob("*.xlsx") if not p.name.startswith("~$"))
    if not files:
        sys.exit(f"{a.folder} 바로 아래 xlsx가 없음")
    cutoff = date.fromisoformat(a.cutoff) if a.cutoff else last_sunday(date.today())
    ex = [read_export(f) for f in files]
    start = max(e["first_full"] for e in ex)
    if start > cutoff:
        sys.exit(f"export가 {start}부터라 {cutoff}까지 채울 날이 없음")
    span = [start + timedelta(days=i) for i in range((cutoff - start).days + 1)]
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    for p in pages:
        base = {"pt": 0, "ac": 0, **({"mi": 0} if p.get("split") else {})}
        days = {d.isoformat(): dict(base) for d in span}
        for e in ex:
            pid = e["ids"].get(p["name"])
            if not pid:
                continue
            if p["type"] == "chat":
                s = e["msg"][e["msg"].personId == pid].groupby("chatId").t.min().dt.date
                field = e["ch"]
            elif p.get("split"):
                # 전화 상담원 3분류(민강·지영 같은 기준) — 한 통화는 한 칸에만:
                #   부재중(mi) = 상담원이 걸었는데(outbound) 연결 안 된 통화 (태그 상관없음)
                #   인터뷰(ac) = 연결된 통화 중 상담 태그가 interview_tag 하나뿐
                #   일반(pt)   = 그 밖의 연결된 통화
                #   고객이 걸었는데 못 받은 통화(inbound·연결 안 됨)는 세지 않음
                sp = p["split"]
                mine = e["meet"][e["meet"].cid == pid]
                for d, conn, outbound, tags in zip(mine.t.dt.date, mine.conn, mine.direction == "outbound", mine.tags):
                    if not conn:
                        fld = "mi" if outbound else None
                    else:
                        fld = "ac" if tags == frozenset([sp["interview_tag"]]) else "pt"
                    if fld and d.isoformat() in days:
                        days[d.isoformat()][fld] += 1
                continue
            else:
                s = e["meet"][(e["meet"].cid == pid) & e["meet"].conn].t.dt.date
                field = "pt"
            for d, n in s.value_counts().items():
                k = d.isoformat()
                if k in days:
                    days[k][field] += int(n)
        (out / f"{p['key']}.json").write_text(json.dumps({"days": days, "through": cutoff.isoformat()}, ensure_ascii=False))
        wd = [sum(v.values()) for k, v in days.items() if date.fromisoformat(k).weekday() < 5]
        avg = sum(wd) / len(wd) if wd else 0
        print(f"{p['key']}: {start}~{cutoff} {len(days)}일 · 평일 평균 {avg:.1f}건 → {out / (p['key'] + '.json')}")


if __name__ == "__main__":
    main()
