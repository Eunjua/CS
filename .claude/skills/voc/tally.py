"""하위 에이전트 분류 결과(cls_<주제>*.jsonl)를 원문과 맞춰 보고 원인별로 센다.

사용법:
  python3 tally.py <sample_chats --out 폴더> A B [--reassign chat8=카테고리 ...]
  python3 tally.py <폴더> 신뢰 --total 802 --chat 454 --phone 348 --week 10/05~10/11 [--save]   # 신뢰 지표판(전체 문의 중 %·팀별·4주·전화/채팅)
  python3 tally.py --selftest

- 원문(raw_<주제>.txt)의 상담 수와 분류 줄을 맞춰 보고 빠지거나 겹친 상담을 알린다. 하나라도 있으면 그 표를 쓰지 않는다.
- --reassign: 에이전트 메모를 보고 원인을 옮길 때(예: 기타 → 새 원인). 무엇을 왜 옮겼는지 은주에게 보고한다.
- 응대 이슈는 issues_<주제>.txt로 따로 쓴다 — 리포트에 넣지 않고 은주에게만 알린다.
- 신뢰 지표판: 주제 이름이 trust.json의 topic(신뢰)이고 --total(그 주 전체 문의 수, analyze.py 인입요약 총건수)이 있으면
  이유별 건수·전체 문의 중 %·담당 팀·팀별 합계를 낸다. --week와 --save를 주면 trust_history.json에 그 주를 저장(같은 주는 덮어씀)하고
  이유별 최근 4주 비중과 판정을 낸다. 판정 = 앞 3주 평균 비중 대비 20% 이상 그리고 건수 5건 이상 차이 → 늘었다/줄었다.
  분류가 빠지거나 겹치면 저장하지 않는다.
- v1(10/12~): 분류 줄의 refund=true는 '결제 후 환불·취소 요청'. 원인은 환불 사유로 두고, 원인마다 '그중 환불 n건'을 붙인다.
- 기준 표본(trust.json gold): 이번 실행의 분류 줄(신뢰·기준 주제 전부)에서 정답이 확정된 표본을 찾아 맞춘 비율을 낸다.
  min_agree 미만이거나 표본이 다 분류되지 않았으면 --save를 막는다(분류가 흔들린 주를 기록하지 않으려고).
- v2(10/19~): 한 상담에 원인이 여러 개면 분류 줄의 causes(코드 목록)를 원인마다 1건씩 센다 — 원인 합계가 신뢰 문의 수보다 많을 수 있다.
  신뢰 문의 비중·결제 후 환불 합계·지표판 원인이 나온 상담 수는 상담 1건 = 1번. category(주된 원인)는 기준 표본 대조와 CX 내부용 참고로 남긴다.
  causes가 없는 줄(v1)은 category 하나로 센다.
- --chat·--phone(analyze.py 인입요약 채팅·전화)을 주면 원문 머리줄의 medium(phone=전화, 그 밖=채팅)으로 나눠 채널별 비중도 낸다.
  전화가 줄어든 주(연휴)엔 고객 변화 없이 비율이 움직이므로, 이유 비중이 크게 바뀌면 이 줄부터 본다.
"""
import collections
import glob
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
TRUST = os.path.join(HERE, 'trust.json')
HISTORY = os.path.join(HERE, 'trust_history.json')
PCT, MIN_DIFF = 20, 5          # trend.py와 같은 문턱


def check(headers, rows):
    """(빠진 상담, 겹친 상담, 원문에 없는 상담)"""
    got = [r.get('chat') for r in rows]
    dup = sorted(c for c, k in collections.Counter(got).items() if k > 1)
    return sorted(set(headers) - set(got)), dup, sorted(set(got) - set(headers))


def causes_of(r, valid=None):
    """그 상담에서 센 원인 코드 목록 — category를 맨 앞에, 중복 없이. valid가 있으면 기준표 코드만."""
    out = [r['category']] + [c for c in (r.get('causes') or []) if c != r['category']]
    out = list(dict.fromkeys(out))
    return [c for c in out if c in valid] if valid else out


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


def board(counts, total, cfg, refunds=None):
    """신뢰 지표판 — (이유 줄 목록, 팀별 합계). board=true인 이유만, 건수 많은 순."""
    lines = []
    for c in cfg['categories']:
        if c.get('board'):
            n = counts.get(c['code'], 0)
            lines.append({'code': c['code'], 'label': c['label'], 'team': c.get('team', ''), 'n': n, 'pct': n / total * 100,
                          'refund': refunds.get(c['code'], 0) if refunds else 0})
    lines.sort(key=lambda x: -x['n'])
    teams = collections.Counter()   # 담당 팀이 정해진 원인만(10/12: 일단 전부 비움)
    for x in lines:
        if x['team']:
            teams[x['team']] += x['n']
    return lines, teams


def share_verdict(history, code):
    """history = [(주차, 건수, 전체)] 오래된 순. 마지막이 이번 주."""
    if len(history) < 4:
        return f'기록 {len(history)}주 — 4주부터 판정'
    h = history[-4:]
    shares = [n / t * 100 for _, n, t in h]
    base, base_n = sum(shares[:3]) / 3, sum(n for _, n, _ in h[:3]) / 3
    if base == 0:
        return '신규' if h[-1][1] >= MIN_DIFF else '비슷'
    rel = (shares[-1] - base) / base * 100
    if abs(rel) >= PCT and abs(h[-1][1] - base_n) >= MIN_DIFF:
        return f"{'늘었다' if rel > 0 else '줄었다'} ({rel:+.0f}%)"
    return f'비슷 ({rel:+.0f}%)'


def medium_of(m):
    return '전화' if m == 'phone' else '채팅'


def gold_check(all_rows, gold):
    """(맞춘 수, 대조한 수, 확정 표본 수, 틀린 목록). '확인 필요' 표본은 빼고 센다."""
    want = {c: v for c, v in gold.get('items', {}).items() if v != '확인 필요'}
    got = {r['chat']: r['category'] for r in all_rows if r.get('chat') in want}
    wrong = sorted((c, want[c], got[c]) for c in got if got[c] != want[c])
    return len(got) - len(wrong), len(got), len(want), wrong


def trust_report(rows, raw_n, total, week, save, ok, mediums=None, totals_by=None, all_rows=None):
    cfg = json.load(open(TRUST, encoding='utf-8'))
    valid = {c['code'] for c in cfg['categories']}
    bad = sorted({c for r in rows for c in (r.get('causes') or []) if c not in valid})
    if bad:
        print(f'⚠️ 기준표에 없는 원인 코드는 빼고 셌어요: {bad}')
    counts = collections.Counter(c for r in rows for c in causes_of(r, valid))      # 원인마다 1건(중복 포함)
    refunds = collections.Counter(c for r in rows if r.get('refund') is True for c in causes_of(r, valid))
    primary = collections.Counter(r['category'] for r in rows)
    on_board_codes = {c['code'] for c in cfg['categories'] if c.get('board')}
    board_chats = sum(1 for r in rows if on_board_codes & set(causes_of(r, valid)))
    refund_chats = sum(1 for r in rows if r.get('refund') is True)
    lines, teams = board(counts, total, cfg, refunds)
    print(f"기준 {cfg.get('version', '-')} (since {cfg.get('version_from', '-')})")
    if cfg.get('gold'):
        hit, seen, need, wrong = gold_check(all_rows or rows, cfg['gold'])
        rate = hit / need if need else 0
        print(f'기준 표본: {hit}/{need} 맞춤 (대조 {seen}건)' + (f' · 틀림 {wrong}' if wrong else ''))
        if seen < need or rate < cfg['gold'].get('min_agree', 0.8):
            if save:
                print('⚠️ 기준 표본이 다 분류되지 않았거나 일치율이 기준 미만이라 기록하지 않아요. 기준표를 보고 다시 분류하세요.')
            save = False
    print(f'\n===== 신뢰 지표판 (전체 문의 {total}건 기준)')
    print(f'신뢰 태그 원문 {raw_n}건 = 전체 문의의 {raw_n / total * 100:.1f}%')
    multi = sum(counts.values())
    print(f'그중 지표판 원인이 하나라도 나온 상담 {board_chats}건 = 전체 문의의 {board_chats / total * 100:.1f}% (나머지 {raw_n - board_chats}건은 CX 내부용)')
    print(f'원인 합계 {multi}건(중복 포함) — 한 상담에 원인이 여러 개면 각각 세서 신뢰 문의 {raw_n}건보다 많을 수 있음 · 상담당 평균 {multi / raw_n:.2f}개' if raw_n else '')
    hist = json.load(open(HISTORY, encoding='utf-8')) if os.path.exists(HISTORY) else {'weeks': {}}
    if week and save:
        if not ok:
            print('⚠️ 빠지거나 겹친 상담이 있어 기록하지 않았어요.')
        else:
            entry = {'version': cfg.get('version'), 'total': total, 'raw': raw_n, 'counts': dict(counts), 'refunds': dict(refunds),
                     'mode': 'multi', 'primary': dict(primary), 'board_chats': board_chats, 'refund_chats': refund_chats}
            if mediums and totals_by:
                entry['by_medium'] = {k: {'total': totals_by[k], 'raw': sum(1 for v in mediums.values() if v == k),
                                          'counts': dict(collections.Counter(c for r in rows if mediums.get(r['chat']) == k
                                                                             for c in causes_of(r, valid)))}
                                      for k in totals_by}
            hist['weeks'][week] = entry
            json.dump(hist, open(HISTORY, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
            print(f'→ trust_history.json에 {week} 저장 (기록 {len(hist["weeks"])}주)')
    # 같은 기준 버전의 기록만 잇는다 — 기준이 바뀌기 전 주와 이어 보면 원인 이름이 같아도 뜻이 다르다.
    ver = cfg.get('version')
    weeks = [w for w in hist['weeks'] if w != week and hist['weeks'][w].get('version') == ver]
    if week in hist['weeks']:
        weeks = [w for w in weeks if list(hist['weeks']).index(w) < list(hist['weeks']).index(week)]
    past = {w: hist['weeks'][w] for w in weeks}
    if week:
        past[week] = {'total': total, 'raw': raw_n, 'counts': dict(counts)}   # 이번 주는 저장 여부와 상관없이 지금 값
        weeks = weeks + [week]
    for x in lines:
        h = [(w, past[w]['counts'].get(x['code'], 0), past[w]['total']) for w in weeks]
        path = ' → '.join(f'{n / t * 100:.1f}%' for _, n, t in h[-4:]) if h else '-'
        verdict = share_verdict(h, x['code']) if h else '기록 없음'
        rf = f" (그중 환불 {x['refund']}건)" if x['refund'] else ''
        tm = f" · 담당 {x['team']}" if x['team'] else ''
        print(f"  {x['label']}: {x['n']}건{rf} · 전체의 {x['pct']:.1f}%{tm} · 4주 {path} · {verdict}")
    if mediums and totals_by:
        parts = []
        for k, t in totals_by.items():
            n = sum(1 for v in mediums.values() if v == k)
            parts.append(f'{k} {n / t * 100:.1f}% ({n}/{t})')
        print('채널별 신뢰 비중:', ' · '.join(parts))
        for x in lines:
            split = collections.Counter(mediums.get(r['chat']) for r in rows if x['code'] in causes_of(r, valid))
            if x['n']:
                print(f"    {x['label']}: " + ' · '.join(f'{k} {split.get(k, 0)}' for k in totals_by))
    off = [(c['label'], counts.get(c['code'], 0), refunds.get(c['code'], 0)) for c in cfg['categories'] if not c.get('board')]
    print('지표판 밖(CX 내부용):', ' · '.join(f'{l} {n}건' + (f'(환불 {r})' if r else '') for l, n, r in off))
    print(f"결제 후 환불 합계: {refund_chats}건(상담 수)")
    print('참고 — 주된 원인 하나로 셌을 때(v1 방식, CX 내부용):',
          ' · '.join(f"{c['label']} {primary.get(c['code'], 0)}" for c in cfg['categories'] if primary.get(c['code'])))
    if teams:
        print('팀별 합계:', ' · '.join(f'{t} {n}건 ({n / total * 100:.1f}%)' for t, n in teams.most_common()))
    # 신뢰 문의 비중(상담 수 ÷ 전체)은 원인 기준과 상관없어 버전이 달라도 잇는다
    all_w = [w for w in hist['weeks'] if w != week] + ([week] if week else [])
    if week in hist['weeks']:
        all_w = [w for w in all_w if w == week or list(hist['weeks']).index(w) < list(hist['weeks']).index(week)]
    raw_h = [(w, (raw_n if w == week else hist['weeks'][w]['raw']), (total if w == week else hist['weeks'][w]['total'])) for w in all_w]
    if raw_h:
        print('신뢰 문의 비중 4주:', ' → '.join(f'{n / t * 100:.1f}%' for _, n, t in raw_h[-4:]), '·', share_verdict(raw_h, 'raw'))


def selftest():
    rows = [{'chat': 'a'}, {'chat': 'b'}, {'chat': 'b'}, {'chat': 'z'}]
    assert check(['a', 'b', 'c'], rows) == (['c'], ['b'], ['z'])
    assert check(['a'], [{'chat': 'a'}]) == ([], [], [])
    cfg = {'categories': [{'code': 'x', 'label': 'X', 'team': '제품', 'board': True},
                          {'code': 'y', 'label': 'Y', 'team': '제품', 'board': True},
                          {'code': 'z', 'label': 'Z', 'team': 'CX', 'board': False}]}
    lines, teams = board({'x': 10, 'y': 30, 'z': 5}, 200, cfg)
    assert [l['code'] for l in lines] == ['y', 'x'] and lines[0]['pct'] == 15.0 and teams['제품'] == 40 and 'CX' not in teams
    lines, teams = board({'q': 2}, 100, {'categories': [{'code': 'q', 'label': 'Q', 'board': True}]})
    assert lines[0]['team'] == '' and not teams   # 담당 팀 없음
    assert share_verdict([('a', 10, 100)], 'x').startswith('기록 1주')
    assert share_verdict([('a', 10, 100), ('b', 10, 100), ('c', 10, 100), ('d', 20, 100)], 'x').startswith('늘었다')
    assert share_verdict([('a', 10, 100), ('b', 10, 100), ('c', 10, 100), ('d', 12, 100)], 'x').startswith('비슷')   # 20%↑이지만 2건 차이
    lines, _ = board({'x': 3}, 100, cfg, {'x': 1})
    assert [l['refund'] for l in lines if l['code'] == 'x'] == [1]
    gold = {'items': {'a': '인정', 'b': '활용', 'c': '확인 필요'}}
    assert gold_check([{'chat': 'a', 'category': '인정'}, {'chat': 'b', 'category': '일자리'}, {'chat': 'c', 'category': '기타'}], gold) == (1, 2, 2, [('b', '활용', '일자리')])
    assert gold_check([{'chat': 'a', 'category': '인정'}], gold)[1:3] == (1, 2)   # 표본 하나가 분류 안 됨
    assert medium_of('phone') == '전화' and medium_of('app') == '채팅' and medium_of('native') == '채팅'
    assert share_verdict([('a', 20, 1000), ('b', 20, 1000), ('c', 20, 1000), ('d', 20, 500)], 'x').startswith('비슷')  # 비중은 2배지만 건수 같음
    assert causes_of({'category': '인정', 'causes': ['일자리', '인정', '일자리']}) == ['인정', '일자리']
    assert causes_of({'category': '기타'}) == ['기타']                                   # v1 줄
    assert causes_of({'category': '인정', 'causes': ['없는코드']}, {'인정'}) == ['인정']
    print('tally.py selftest ok')


def main(argv):
    if argv[:1] == ['--selftest']:
        return selftest()
    reassign, total, week, save, totals_by = {}, None, None, False, {}
    for flag, name in (('--chat', '채팅'), ('--phone', '전화')):
        if flag in argv:
            totals_by[name] = int(argv.pop(argv.index(flag) + 1)); argv.remove(flag)
    if '--total' in argv:
        total = int(argv.pop(argv.index('--total') + 1)); argv.remove('--total')
    if '--week' in argv:
        week = argv.pop(argv.index('--week') + 1); argv.remove('--week')
    if '--save' in argv:
        save = True; argv.remove('--save')
    if '--reassign' in argv:
        i = argv.index('--reassign')
        reassign = dict(x.split('=', 1) for x in argv[i + 1:])
        argv = argv[:i]
    if len(argv) < 2:
        sys.exit(__doc__)
    folder, topics = argv[0], argv[1:]

    ok, seen, all_rows, trust_args = True, {}, [], None
    for t in topics:
        rawtext = open(os.path.join(folder, f'raw_{t}.txt')).read()
        headers = re.findall(rf'^#### {t} chat=(\w{{8}})', rawtext, re.M)
        mediums = {c: medium_of(m) for c, m in re.findall(rf'^#### {t} chat=(\w{{8}})\S*.*?medium=(\w+)', rawtext, re.M)}
        rows = [json.loads(line) for f in sorted(glob.glob(os.path.join(folder, f'cls_{t}*.jsonl')))
                for line in open(f) if line.strip()]
        for r in rows:
            if r.get('chat') in reassign:
                r['category'] = reassign[r['chat']]
        all_rows += rows
        missing, dup, extra = check(headers, rows)
        print(f'\n===== {t}: 원문 {len(headers)}건 · 분류 {len(rows)}줄 · 빠짐 {missing} · 겹침 {dup} · 원문에 없음 {extra}')
        ok &= not (missing or dup or extra)
        summarize(rows, len(headers))
        issues = [f"{r['chat']}\t{r['issue']}" for r in rows if r.get('issue')]
        with open(os.path.join(folder, f'issues_{t}.txt'), 'w') as f:
            f.write('\n'.join(issues))
        print(f'\n응대 이슈 {len(issues)}건 → issues_{t}.txt (은주에게만)')
        seen[t] = set(headers)
        if total and t == json.load(open(TRUST, encoding='utf-8'))['topic']:
            trust_args = (rows, len(headers), total, week, save, not (missing or dup or extra), mediums, totals_by or None)
    if trust_args:
        trust_report(*trust_args, all_rows=all_rows)
    if len(seen) > 1:
        both = set.intersection(*seen.values())
        print(f'\n여러 주제에 함께 들어간 상담 {len(both)}건: {sorted(both)} — 합계를 낼 때 한 번만 센다')
    if not ok:
        sys.exit('⚠️ 빠지거나 겹친 상담이 있어요. 해당 묶음을 다시 분류한 뒤 표를 쓰세요.')


if __name__ == '__main__':
    main(sys.argv[1:])
