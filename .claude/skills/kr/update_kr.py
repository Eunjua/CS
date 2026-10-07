#!/usr/bin/env python3
"""4분기 KR 대시보드 주간 숫자 계산.

v2 웹앱(주차·설문·상담원 집계) + 요청 건수(3분기 피벗 고정 파일 + 4분기 탭 일별 건수)를 읽어
대시보드 저장소(records 컬렉션)에 넣을 ArtifactData batch 목록을 만든다.

  python3 update_kr.py --q4 <4분기 일별 요청 JSON> --existing <{doc_id: version} JSON> --out <batch JSON>
         [--drop-monthly]

- 자동 칸만 쓴다: inquiries·requests·chatInflow·resolvedRate·csatAgent·autoNote
- 손으로 넣는 칸(csatAI·handledPerDay·note)은 건드리지 않는다
- 이미 있는 문서는 update(+if_version), 없는 문서는 set
"""
import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
YEAR = 2026
FIRST_WEEK = dt.date(2026, 7, 27)      # 요청 집계가 시작된 주
Q4_SHEET_FROM = dt.date(2026, 10, 5)   # 이날부터는 「4분기」 탭 기준
RESOLVED = "✅ 네, 해결됐어요"
AUTO_FIELDS = ["inquiries", "requests", "chatInflow", "resolvedRate", "csatAgent", "autoNote"]


def api_url():
    html = open(os.path.join(REPO, "dashboard-v2", "index.html"), encoding="utf-8").read()
    m = re.search(r"https://script\.google\.com/macros/s/[^'\"]+/exec", html)
    if not m:
        sys.exit("dashboard-v2/index.html 에서 웹앱 주소를 못 찾음")
    return m.group(0)


def fetch_v2():
    with urllib.request.urlopen(api_url(), timeout=60) as r:
        return json.load(r)


def week_start(label):
    # '09/21~09/27' → 2026-09-21
    mm, dd = label.split("~")[0].split("/")
    return dt.date(YEAR, int(mm), int(dd))


def load_daily(path):
    d = json.load(open(path, encoding="utf-8"))
    return {dt.date.fromisoformat(k): int(v) for k, v in d.items() if not k.startswith("_")}


def load_existing(path):
    # {doc_id: version} — ArtifactData list 결과에서 id와 version만 옮겨 적은 파일
    if not path:
        return {}
    return {k: {"version": int(v)} for k, v in json.load(open(path, encoding="utf-8")).items()}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--q4", help="4분기 탭 일별 요청 건수 JSON {YYYY-MM-DD: 건수}")
    ap.add_argument("--existing", help="기존 records 문서 {doc_id: version} JSON")
    ap.add_argument("--out", required=True)
    ap.add_argument("--drop-monthly", action="store_true", help="month_* 기준값 문서 삭제")
    a = ap.parse_args()

    q3 = load_daily(os.path.join(HERE, "requests_q3_daily.json"))
    q4 = load_daily(a.q4) if a.q4 else {}
    q4_last = max(q4) if q4 else None
    existing = load_existing(a.existing)
    v2 = fetch_v2()

    survey, agent = {}, {}
    for r in v2["survey"]:
        if r["항목"] == "해결여부":
            s = survey.setdefault(r["주차"], [0, 0])
            s[1] += int(r["건수"])
            if r["보기"] == RESOLVED:
                s[0] += int(r["건수"])
    for r in v2["agent"]:
        n = r.get("만족도응답수") or 0
        if n and r.get("만족도평균") not in ("", None):
            g = agent.setdefault(r["주차"], [0.0, 0])
            g[0] += float(r["만족도평균"]) * n
            g[1] += n

    weeks = sorted((w for w in v2["week"] if week_start(w["주차"]) >= FIRST_WEEK), key=lambda w: week_start(w["주차"]))
    latest = weeks[-1]["주차"] if weeks else None
    writes, summary = [], []

    for w in weeks:
        label, start = w["주차"], week_start(w["주차"])
        days = [start + dt.timedelta(i) for i in range(7)]
        # 요청 건수: 10/5 전은 3분기 피벗, 이후는 4분기 탭. 4분기 탭이 그 주 끝까지 안 왔으면 비운다
        if days[-1] < Q4_SHEET_FROM:
            requests = sum(q3.get(d, 0) for d in days)
        elif q4_last and q4_last >= min(days[-1], dt.date.today() - dt.timedelta(1)):
            requests = sum((q3 if d < Q4_SHEET_FROM else q4).get(d, 0) for d in days)
        else:
            requests = None
        s, g = survey.get(label), agent.get(label)
        auto = {
            "inquiries": int(w["총건수"]),
            "requests": requests,
            "chatInflow": int(w["채팅"]),
            "resolvedRate": round(s[0] / s[1] * 100, 1) if s and s[1] else None,
            "csatAgent": round(g[0] / g[1], 2) if g and g[1] else None,
            "autoNote": "v2 최신 주 — 채널톡 파일이 주 중간까지면 건수가 적을 수 있음" if label == latest else "",
        }
        doc_id = "week_" + start.isoformat()
        old = existing.get(doc_id)
        if old:
            data = {k: v for k, v in auto.items() if v is not None or k == "autoNote"}
            writes.append({"op": "update", "collection": "records", "doc_id": doc_id, "data": data, "if_version": old["version"]})
        else:
            data = dict(kind="week", start=start.isoformat(), handledPerDay=None, csatAI=None, note="", **auto)
            writes.append({"op": "set", "collection": "records", "doc_id": doc_id, "data": data})
        rate = f"{requests / auto['inquiries'] * 100:.1f}%" if requests is not None and auto["inquiries"] else "–"
        summary.append(f"{label}  문의 {auto['inquiries']:>5}  요청 {requests if requests is not None else '–':>4}  KR1 {rate:>6}  "
                       f"해결률 {auto['resolvedRate'] if auto['resolvedRate'] is not None else '–':>5}  상담원만족 {auto['csatAgent'] if auto['csatAgent'] is not None else '–'}")

    if a.drop_monthly:
        for doc_id, old in existing.items():
            if doc_id.startswith("month_"):
                writes.append({"op": "delete", "collection": "records", "doc_id": doc_id, "if_version": old["version"]})

    batches = [writes[i:i + 50] for i in range(0, len(writes), 50)]
    json.dump({"batches": batches, "sync": {"at": dt.datetime.now().isoformat(timespec="minutes"), "latestWeek": latest,
               "requestsThrough": (q4_last or max(q3)).isoformat()}},
              open(a.out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("\n".join(summary))
    print(f"\n쓰기 {len(writes)}건 ({len(batches)}묶음) → {a.out}")
    print(f"v2 최신 주: {latest} · 요청 건수 반영일: {(q4_last or max(q3)).isoformat()}")


if __name__ == "__main__":
    main()
