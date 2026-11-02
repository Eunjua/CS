"""ALF 역할 지표 — 매주 상담원이 대응한 비율이 설계(상황지도 담당)와 얼마나 다른지 잰다.

사용법 (저장소 루트에서):
  python3 cs-triage/ALF_설계/역할지표.py extract 채널톡/<파일>.xlsx ... --out <저장소 밖 폴더>
      → 폴더에 items.json + batch1.txt… (상담별 고객 첫 발화·상담원 발화, 전화번호 가림)
      → batch를 `분류지침.md`대로 분류해 같은 폴더에 codes.tsv(chatId<TAB>코드) 로 저장
  python3 cs-triage/ALF_설계/역할지표.py aggregate --out <같은 폴더> [--note 메모]
      → 상황지도.md 담당 기준으로 세 숫자 계산, 역할추이.json에 그 주를 넣는다(같은 주는 덮어씀)
  python3 cs-triage/ALF_설계/역할지표.py discuss --out <같은 폴더>
      → 논의/논의목록_<export>.md (새 유형 묶음 + AI 몫인데 상담원 상위 줄, 고객 말·상담원 답 표본) — gitignore
  python3 cs-triage/ALF_설계/역할지표.py page --html <출력 html>
      → 역할나누기_page.html 틀 + 상황지도 + 역할추이.json으로 페이지를 만든다(Artifact로 올림)
  python3 cs-triage/ALF_설계/역할지표.py --selftest

세 숫자 (상담 1건 = 고객이 말을 한 채팅 상담, 전화 제외, 아카데미와 무관한 X 코드 제외):
  지금 상담원 = 상담원이 고객에게 보이는 발화를 한 상담 (/알프 봇완결 판정과 같은 기준)
  설계 상담원 = 상황지도에서 담당이 '사람'인 줄로 분류된 상담
  AI 몫인데 상담원 = 담당이 안내·조회인 줄인데 상담원이 발화한 상담 ← 매주 줄여 갈 숫자
items.json·batch·codes.tsv에는 고객 발화가 들어가므로 저장소 밖에만 쓴다. 역할추이.json은 숫자만이라 저장소에 둔다.
"""
import collections
import datetime as dt
import json
import os
import re
import sys
import unicodedata

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
MAP = os.path.join(HERE, '상황지도.md')
TREND = os.path.join(HERE, '역할추이.json')
TEMPLATE = os.path.join(HERE, '역할나누기_page.html')

PHONE_RE = re.compile(r'0\s*1\s*[0-9]([\s.\-~·ㆍ]*\d){7,8}')
ADDR_RE = re.compile(r'\S+(시|도)\s+\S+(시|군|구)\s+[^/]*?(로|길)\s*\d+(-\d+)?[^/]{0,30}')
GREETING = re.compile(r'^(안녕하세요 케어(아카데미|파트너) ?입니다\.?|일정시간 동안 추가적인 문의)')
LETTER_STAGE = {}  # 코드 첫 글자 → 단계 (상황지도에서 채움)


# ---------- 상황지도 읽기 ----------
def mode_of(field):
    f = re.sub(r'\*', '', field).strip()
    if f.startswith('사람'):
        return 'agent'
    if f.startswith('조회') or f.startswith('안내 + 조회'):
        return 'lookup'
    if f.startswith('안내'):
        return 'info'
    raise ValueError(f'처리 방식을 읽을 수 없음: {field[:30]}')


def read_map(path=MAP):
    """상황지도.md → 줄 목록(코드·단계·상황·고객 표현·건수·봇완결·담당·들어갈 곳·연결 조건)과 결정 메모."""
    rows, stage = [], None
    lines = open(path, encoding='utf-8').read().split('\n')
    for ln in lines:
        m = re.match(r'^### (.+?) — \d+줄', ln)
        if m:
            stage = m.group(1)
            continue
        if ln.startswith('## 숫자'):
            break
        if stage and re.match(r'^\| [A-Z]\d+ \|', ln):
            f = [x.strip() for x in ln.strip().strip('|').split('|')]
            n = re.match(r'\d+', f[3])
            rows.append(dict(code=f[0], stage=stage, sit=clean(f[1]), ex=clean(f[2]), n=int(n.group()) if n else 0,
                             bot=f[4] if '%' in f[4] else '—', mode=mode_of(f[5]), where=clean(f[6]), cond=clean(f[7])))
    for r in rows:
        LETTER_STAGE.setdefault(r['code'][0], r['stage'])
    # 결정 메모: 정책 표(# → 코드) + 결정 기록(# → 문장)
    codes_of, text_of = {}, {}
    sec = None
    for ln in lines:
        if ln.startswith('## 정책 확인 필요'):
            sec = 'policy'
        elif ln.startswith('### 결정 기록'):
            sec = 'decision'
        elif ln.startswith('## ') and sec:
            sec = None if not ln.startswith('## 정책') else sec
        m = re.match(r'^\| (\d+) \|(.*)\|\s*$', ln)
        if not m:
            continue
        cells = [c.strip() for c in m.group(2).split('|')]
        if sec == 'policy':
            codes_of[m.group(1)] = re.findall(r'[A-Z]\d+', cells[-1])
        elif sec == 'decision':
            t = clean(cells[0])
            text_of[m.group(1)] = t if len(t) <= 60 else t[:58] + '…'
    dec = collections.defaultdict(list)
    for k, cs in codes_of.items():
        if k in text_of:
            for c in cs:
                dec[c].append(f'#{k} {text_of[k]}')
    for r in rows:
        r['dec'] = dec.get(r['code'], [])
    return rows


def clean(t):
    return re.sub(r'\*\*|`', '', t).strip()


# ---------- extract ----------
def mask(s):
    s = s.replace('\n', ' ').replace('\t', ' ')
    s = PHONE_RE.sub('[전화]', s)
    s = ADDR_RE.sub('[주소]', s)
    return re.sub(r'\b\d{6}\b', '[6자리]', s)


def outside_repo(out):
    if os.path.abspath(out).startswith(REPO + os.sep):
        sys.exit(f'--out은 저장소 밖이어야 합니다(고객 발화 포함). 지금 값: {out}')
    os.makedirs(out, exist_ok=True)


def week_of(path):
    """export 파일 이름의 날짜(월요일 export) → 직전 월~일."""
    m = re.search(r'(\d{4}-\d{2}-\d{2})', os.path.basename(path))
    if not m:
        sys.exit(f'파일 이름에서 날짜를 못 찾음: {path}')
    d = dt.date.fromisoformat(m.group(1))
    start = d - dt.timedelta(days=d.weekday() + 7)
    return m.group(1), f'{start.month}/{start.day}~{(start + dt.timedelta(days=6)).month}/{(start + dt.timedelta(days=6)).day}'


def extract(paths, out):
    from openpyxl import load_workbook
    outside_repo(out)
    items, skipped = [], collections.Counter()
    exports = set()
    for p in paths:
        exports.add(week_of(p))
        wb = load_workbook(p, read_only=True, data_only=True)
        sheets = {unicodedata.normalize('NFC', ws.title): ws for ws in wb.worksheets}
        chan_id = str(list(sheets['Manager data'].iter_rows(values_only=True))[1][1])
        chan = 'academy' if chan_id == '201411' else 'partner'
        msgs = collections.defaultdict(list)
        rows = sheets['Message data'].iter_rows(values_only=True)
        mi = {h: i for i, h in enumerate(next(rows))}
        for r in rows:
            msgs[r[mi['chatId']]].append((str(r[mi['createdAt']]), r[mi['personType']],
                                          str(r[mi['isPrivate']]).lower() == 'true', (r[mi['plainText']] or '').strip()))
        rows = sheets['UserChat'].iter_rows(values_only=True)
        hi = {h: i for i, h in enumerate(next(rows))}
        for r in rows:
            cid = r[hi['id']]
            if not cid:
                continue
            if r[hi['mediumType']] == 'phone':
                skipped['전화'] += 1
                continue
            ms = sorted(msgs.get(cid, []), key=lambda x: x[0])
            us = [t for _, pt, _, t in ms if pt == 'user' and t]
            if not us:
                skipped['고객 발화 없음'] += 1
                continue
            items.append(dict(
                id=cid, chan=chan, tags=r[hi['tags']] or '',
                agent=any(pt == 'manager' and not pv and t for _, pt, pv, t in ms),
                U=[mask(u)[:220] for u in us[:6]],
                M=[mask(t)[:200] for _, pt, pv, t in ms if pt == 'manager' and not pv and t and not GREETING.match(t)][:4],
                P=[mask(t)[:120] for _, pt, pv, t in ms if pt == 'manager' and pv and t][:2],
                B=[mask(t)[:160] for _, pt, pv, t in ms if pt == 'bot' and t][-2:]))
    if len(exports) != 1:
        sys.exit(f'한 주치 export만 넣어 주세요(지금 {sorted(exports)})')
    export, label = exports.pop()
    json.dump(dict(export=export, label=label, items=items), open(os.path.join(out, 'items.json'), 'w', encoding='utf-8'),
              ensure_ascii=False)
    size = 200
    nb = (len(items) + size - 1) // size
    for b in range(nb):
        with open(os.path.join(out, f'batch{b + 1}.txt'), 'w', encoding='utf-8') as f:
            for it in items[b * size:(b + 1) * size]:
                f.write(f"### {it['id']} | 채널={'아카데미' if it['chan'] == 'academy' else '케어파트너'}"
                        f" | 봇완결={'X' if it['agent'] else 'O'} | 태그={it['tags']}\n")
                for j, u in enumerate(it['U']):
                    f.write(f'  U{j + 1}: {u}\n')
                for u in it['B']:
                    f.write(f'  봇(마지막쪽): {u}\n')
                for u in it['M']:
                    f.write(f'  상담원: {u}\n')
                for u in it['P']:
                    f.write(f'  상담원메모(비공개): {u}\n')
    print(f'{label} (export {export}): 분류 대상 {len(items)}건 → batch {nb}개 · 뺀 것 {dict(skipped)}')
    print(f'다음: batch마다 분류지침.md대로 코드를 붙여 {out}/codes.tsv 에 모은다')


# ---------- aggregate ----------
def count(items, codes, rows):
    by_code = {r['code']: r for r in rows}
    blank = lambda: dict(n=0, now=0, design=0, gap=0)
    tot, st, ch = blank(), collections.defaultdict(blank), collections.defaultdict(blank)
    unmapped, missing, excluded = collections.Counter(), 0, 0
    for it in items:
        c = codes.get(it['id'])
        if c is None:
            missing += 1
            continue
        if c.startswith('X'):
            excluded += 1
            continue
        if c.startswith('NEW'):
            letter = c.split(':')[1] if c.count(':') >= 1 else 'K'
            stage, mode = LETTER_STAGE.get(letter, '분류 불가'), 'info'
            unmapped[c] += 1
        elif c in by_code:
            stage, mode = by_code[c]['stage'], by_code[c]['mode']
        else:
            stage, mode = LETTER_STAGE.get(c[0], '분류 불가'), 'info'
            unmapped[c] += 1
        for b in (tot, st[stage], ch[it['chan']]):
            b['n'] += 1
            b['now'] += it['agent']
            b['design'] += mode == 'agent'
            b['gap'] += mode != 'agent' and it['agent']
    return dict(tot, by_stage=dict(st), by_channel=dict(ch), excluded_x=excluded, missing=missing,
                unmapped=dict(unmapped))


def read_codes(path):
    codes = {}
    for ln in open(path, encoding='utf-8'):
        p = ln.rstrip('\n').split('\t')
        if len(p) >= 2 and p[0] and not p[0].startswith('#'):
            codes[p[0].strip()] = p[1].strip()
    return codes


def load_trend():
    if os.path.exists(TREND):
        return json.load(open(TREND, encoding='utf-8'))
    return dict(weeks=[], changes=[], status={})


def save_trend(t):
    t['weeks'].sort(key=lambda w: w['export'])
    json.dump(t, open(TREND, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


def aggregate(out, note=''):
    rows = read_map()
    data = json.load(open(os.path.join(out, 'items.json'), encoding='utf-8'))
    codes = read_codes(os.path.join(out, 'codes.tsv'))
    res = count(data['items'], codes, rows)
    if res['missing']:
        sys.exit(f"codes.tsv에 없는 상담 {res['missing']}건 — 분류를 마저 채운 뒤 다시 돌려 주세요")
    week = dict(export=data['export'], label=data['label'], note=note, **res)
    t = load_trend()
    t['weeks'] = [w for w in t['weeks'] if w['export'] != week['export']] + [week]
    save_trend(t)
    report(week)


def pct(a, b):
    return f'{a / b:.0%}' if b else '-'


def report(w):
    n = w['n']
    print(f"\n{w['label']} — 아카데미 문의 {n}건 (X 제외 {w['excluded_x']}건)")
    print(f"  지금 상담원 {w['now']}({pct(w['now'], n)}) · 설계 상담원 {w['design']}({pct(w['design'], n)})"
          f" · AI 몫인데 상담원 {w['gap']}건")
    for c, b in sorted(w['by_channel'].items()):
        print(f"  [{'아카데미' if c == 'academy' else '케어파트너'} 채널] {b['n']}건 · 지금 {pct(b['now'], b['n'])}"
              f" · 설계 {pct(b['design'], b['n'])} · AI 몫인데 상담원 {b['gap']}")
    print('  단계별 AI 몫인데 상담원 (많은 순):')
    for s, b in sorted(w['by_stage'].items(), key=lambda x: -x[1]['gap']):
        print(f"    {s[:14]:14} {b['gap']:3}건 · 지금 {pct(b['now'], b['n'])} → 설계 {pct(b['design'], b['n'])} ({b['n']}건)")
    if w['unmapped']:
        print(f"  ⚠️ 지도 정식 줄이 아닌 코드(후보·NEW) {sum(w['unmapped'].values())}건: {w['unmapped']}")
        print('     → discuss로 논의 목록을 만들고, 새 유형은 상황지도 「후보」 표에 올린다')


# ---------- discuss ----------
DISCUSS_DIR = os.path.join(HERE, '논의')  # .gitignore — 고객 발화(가림 처리)가 들어간다


def discuss(out, top=5, samples=3):
    """논의 목록 재료: 지도에 없는 상황(NEW·후보) 묶음 + AI 몫인데 상담원이 많이 받은 줄. 고객 말·상담원 답 표본 포함."""
    rows = read_map()
    by_code = {r['code']: r for r in rows}
    data = json.load(open(os.path.join(out, 'items.json'), encoding='utf-8'))
    codes = read_codes(os.path.join(out, 'codes.tsv'))
    groups = collections.defaultdict(list)
    for it in data['items']:
        c = codes.get(it['id'], '')
        if not c or c.startswith('X'):
            continue
        if c not in by_code:
            groups[('new', c)].append(it)
        elif by_code[c]['mode'] != 'agent' and it['agent']:
            groups[('gap', c)].append(it)

    def block(items):
        lines = []
        for it in items[:samples]:
            lines.append(f"  - 고객: {mask(it['U'][0])[:120]}")
            if it['M']:
                lines.append(f"    상담원: {' / '.join(mask(m)[:120] for m in it['M'][:2])}")
        return lines

    os.makedirs(DISCUSS_DIR, exist_ok=True)
    path = os.path.join(DISCUSS_DIR, f"논의목록_{data['export']}.md")
    new = sorted([(c, v) for (k, c), v in groups.items() if k == 'new'], key=lambda x: -len(x[1]))
    gap = sorted([(c, v) for (k, c), v in groups.items() if k == 'gap'], key=lambda x: -len(x[1]))[:top]
    L = [f"# 알프 논의 목록 — {data['label']} (export {data['export']})", '',
         '> `/알프` 분석 세션이 만들고, 은주가 따로 연 세션에서 "알프 논의하자"로 함께 정한다.',
         '> 항목마다 Claude가 `제안` 줄(담당 · 들어갈 곳 · 확인할 것)을 채워 둔다. 정한 것은 `결정:` 줄에 적는다.', '',
         '## 새 유형 — 지도에 정식 줄이 없는 상황', '']
    if not new:
        L.append('이번 주는 없음.')
    for c, v in new:
        L += [f"### {c} — {len(v)}건", '- 제안: (담당 / 들어갈 곳 / 확인할 것)', '- 결정:'] + block(v) + ['']
    L += ['## AI 몫인데 상담원이 받은 줄 — 많은 순', '']
    for c, v in gap:
        r = by_code[c]
        L += [f"### {c} {r['sit']} — {len(v)}건 (담당 {({'info': 'AI 안내', 'lookup': 'AI 조회'})[r['mode']]})",
              f"- 지금 들어갈 곳: {r['where'][:120]}", '- 제안: (왜 AI가 못 끝냈나 / 무엇을 고치나)', '- 결정:'] + block(v) + ['']
    open(path, 'w', encoding='utf-8').write('\n'.join(L))
    print(f'논의 목록 → {path} (새 유형 {len(new)}묶음 · AI 몫인데 상담원 상위 {len(gap)}줄)')


# ---------- page ----------
def page(html_out):
    rows = read_map()
    t = load_trend()
    html = open(TEMPLATE, encoding='utf-8').read()
    js = lambda o: json.dumps(o, ensure_ascii=False).replace('</', '<\\/')
    html = html.replace('__DATA__', js(rows)).replace('__TREND__', js(t))
    os.makedirs(os.path.dirname(os.path.abspath(html_out)), exist_ok=True)
    open(html_out, 'w', encoding='utf-8').write(html)
    print(f'페이지 → {html_out} (줄 {len(rows)} · 주 {len(t["weeks"])})')


# ---------- selftest ----------
def selftest():
    assert mode_of('사람') == 'agent' and mode_of('조회 (#19)') == 'lookup' and mode_of('안내 + 조회') == 'lookup'
    assert mode_of('안내 (10/30)') == 'info'
    rows = [dict(code='E1', stage='결제', mode='info'), dict(code='E4', stage='결제', mode='agent'),
            dict(code='F1', stage='배송', mode='lookup')]
    LETTER_STAGE.update(E='결제', F='배송')
    items = [dict(id='a', chan='academy', agent=True), dict(id='b', chan='academy', agent=False),
             dict(id='c', chan='partner', agent=True), dict(id='d', chan='partner', agent=True),
             dict(id='e', chan='partner', agent=False), dict(id='f', chan='academy', agent=True)]
    codes = {'a': 'E1', 'b': 'E1', 'c': 'E4', 'd': 'X1', 'e': 'F1', 'f': 'NEW:F:발송됨:새 상황'}
    r = count(items, codes, rows)
    assert (r['n'], r['now'], r['design'], r['gap'], r['excluded_x']) == (5, 3, 1, 2, 1), r
    assert r['by_stage']['결제'] == dict(n=3, now=2, design=1, gap=1), r['by_stage']
    assert r['by_stage']['배송'] == dict(n=2, now=1, design=0, gap=1)
    assert r['unmapped'] == {'NEW:F:발송됨:새 상황': 1}
    assert '[주소]' in mask('충남 천안시 동남구 원성26길 2-13 원성동 / 해당 주소') and '해당 주소' in mask('충남 천안시 동남구 원성26길 2-13 / 해당 주소')
    assert week_of('user_chat_list_2026-11-02_09-27-15.xlsx') == ('2026-11-02', '10/26~11/1')
    real = read_map()
    assert len(real) >= 100 and all(x['mode'] in ('info', 'lookup', 'agent') for x in real)
    print(f'역할지표.py selftest ok (상황지도 {len(real)}줄)')


def main(a):
    if a[:1] == ['--selftest']:
        return selftest()
    opt = lambda k: a[a.index(k) + 1] if k in a else None
    if a[:1] == ['extract']:
        out = opt('--out') or sys.exit('--out <저장소 밖 폴더>가 필요합니다')
        paths = [x for x in a[1:] if x.endswith('.xlsx')]
        return extract(paths, out)
    if a[:1] == ['aggregate']:
        return aggregate(opt('--out') or sys.exit('--out 필요'), opt('--note') or '')
    if a[:1] == ['discuss']:
        return discuss(opt('--out') or sys.exit('--out 필요'))
    if a[:1] == ['page']:
        return page(opt('--html') or sys.exit('--html 필요'))
    sys.exit(__doc__)


if __name__ == '__main__':
    main(sys.argv[1:])
