"""하위 에이전트 분류 결과(cls_<주제>*.jsonl)를 원문과 맞춰 보고 원인별로 센다.

사용법:
  python3 tally.py <sample_chats --out 폴더> A B [--reassign chat8=카테고리 ...]
  python3 tally.py --selftest

- 원문(raw_<주제>.txt)의 상담 수와 분류 줄을 맞춰 보고 빠지거나 겹친 상담을 알린다. 하나라도 있으면 그 표를 쓰지 않는다.
- --reassign: 에이전트 메모를 보고 원인을 옮길 때(예: 기타 → 새 원인). 무엇을 왜 옮겼는지 은주에게 보고한다.
- 응대 이슈는 issues_<주제>.txt로 따로 쓴다 — 리포트에 넣지 않고 은주에게만 알린다.
"""
import collections
import glob
import json
import os
import re
import sys


def check(headers, rows):
    """(빠진 상담, 겹친 상담, 원문에 없는 상담)"""
    got = [r.get('chat') for r in rows]
    dup = sorted(c for c, k in collections.Counter(got).items() if k > 1)
    return sorted(set(headers) - set(got)), dup, sorted(set(got) - set(headers))


def summarize(rows, total):
    by = collections.defaultdict(list)
    for r in rows:
        by[r['category']].append(r)
    for cat, rs in sorted(by.items(), key=lambda x: -len(x[1])):
        outcome = ' · '.join(f'{k} {v}' for k, v in collections.Counter(r.get('outcome', '') for r in rs).most_common())
        stage = ' · '.join(f'{k} {v}' for k, v in collections.Counter(r.get('stage', '') for r in rs).most_common())
        quotes = ' | '.join(q for q in (r.get('quote') for r in rs) if q)[:300]
        print(f'\n[{cat}] {len(rs)}건 ({len(rs) / total * 100:.0f}%)\n  처리: {outcome}\n  시점: {stage}\n  발화: {quotes}')
        notes = [f"{r['chat']}:{r['note']}" for r in rs if r.get('note')]
        if notes:
            print('  메모:', ' | '.join(notes))
    mentions = collections.Counter(m for r in rows for m in r.get('mentions', []))
    if mentions:
        print('\n대화 중 걱정:', ' · '.join(f'{k} {v}건 ({v / total * 100:.0f}%)' for k, v in mentions.most_common()))


def selftest():
    rows = [{'chat': 'a'}, {'chat': 'b'}, {'chat': 'b'}, {'chat': 'z'}]
    assert check(['a', 'b', 'c'], rows) == (['c'], ['b'], ['z'])
    assert check(['a'], [{'chat': 'a'}]) == ([], [], [])
    print('tally.py selftest ok')


def main(argv):
    if argv[:1] == ['--selftest']:
        return selftest()
    reassign = {}
    if '--reassign' in argv:
        i = argv.index('--reassign')
        reassign = dict(x.split('=', 1) for x in argv[i + 1:])
        argv = argv[:i]
    if len(argv) < 2:
        sys.exit(__doc__)
    folder, topics = argv[0], argv[1:]

    ok, seen = True, {}
    for t in topics:
        headers = re.findall(rf'^#### {t} chat=(\w{{8}})', open(os.path.join(folder, f'raw_{t}.txt')).read(), re.M)
        rows = [json.loads(line) for f in sorted(glob.glob(os.path.join(folder, f'cls_{t}*.jsonl')))
                for line in open(f) if line.strip()]
        for r in rows:
            if r.get('chat') in reassign:
                r['category'] = reassign[r['chat']]
        missing, dup, extra = check(headers, rows)
        print(f'\n===== {t}: 원문 {len(headers)}건 · 분류 {len(rows)}줄 · 빠짐 {missing} · 겹침 {dup} · 원문에 없음 {extra}')
        ok &= not (missing or dup or extra)
        summarize(rows, len(headers))
        issues = [f"{r['chat']}\t{r['issue']}" for r in rows if r.get('issue')]
        with open(os.path.join(folder, f'issues_{t}.txt'), 'w') as f:
            f.write('\n'.join(issues))
        print(f'\n응대 이슈 {len(issues)}건 → issues_{t}.txt (은주에게만)')
        seen[t] = set(headers)
    if len(seen) > 1:
        both = set.intersection(*seen.values())
        print(f'\n여러 주제에 함께 들어간 상담 {len(both)}건: {sorted(both)} — 합계를 낼 때 한 번만 센다')
    if not ok:
        sys.exit('⚠️ 빠지거나 겹친 상담이 있어요. 해당 묶음을 다시 분류한 뒤 표를 쓰세요.')


if __name__ == '__main__':
    main(sys.argv[1:])
