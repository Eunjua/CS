"""자격증관리 시트 주소 확인 판정.

사용: python3 -I judge.py <rows.json> <작업폴더>
  rows.json : [[행번호, "주소"], ...]  (시트에서 읽어 온 대상 행)
  작업폴더   : 카카오 조회 캐시·결과를 둘 곳 (저장소 밖 임시 폴더)

주소는 "쉼표 앞 = 주소 검색으로 고른 주소, 쉼표 뒤 = 고객이 직접 쓴 상세주소".
판정값: '불일치' / '동호수' / '확인필요'(조회 실패 — 시트에 넣지 않음) / ''(문제 없음)
"""
import difflib, html, json, math, os, re, sys, time, urllib.parse, urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor

cache = {}


# ---------- 카카오맵 조회 ----------
def fetch(q):
    """카카오맵 모바일 검색. 주소 블록(도로명·지번·건물명·좌표)과 장소 목록(이름·분류·주소)."""
    if q in cache:
        return cache[q]
    url = 'https://m.map.kakao.com/actions/searchView?q=' + urllib.parse.quote(q)
    for _ in range(3):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            t = urllib.request.urlopen(req, timeout=15).read().decode('utf-8', 'ignore')
            break
        except Exception:
            time.sleep(2)
    else:
        return None
    res = {'addr': None, 'places': []}
    m = re.search(r"var addressData = \{\};\s*addressData = \{(.*?)\};", t, re.S)
    if m:
        blk = m.group(1)
        g = lambda k: (re.search(k + r"\s*:\s*'(.*?)'", blk) or [None, ''])[1]
        res['addr'] = {'main': g('mainAddress'), 'rel': g('relAddress'), 'bld': g('buildingName'),
                       'pt': g('point_wx') + ',' + g('point_wy')}
    for pm in re.finditer(r'data-type="place".*?<strong class="tit_g">(.*?)</strong>'
                          r'<span class="txt_ginfo[^"]*">(.*?)</span>.*?<span class="txt_g">(.*?)</span>', t, re.S):
        res['places'].append([html.unescape(x).strip() for x in pm.groups()])
        if len(res['places']) >= 15:
            break
    cache[q] = res
    return res


def ns(s):
    return re.sub(r'\s+', '', s or '')


def keys(r):
    """비교용 키. 시·도 이름은 표기가 섞여서('전남광주통합' vs '…특별시') 떼고 비교한다."""
    if not r or not r['addr'] or not r['addr']['main']:
        return None
    a = r['addr']
    dp = lambda x: ns(' '.join(x.split()[1:]))
    return {'road': ns(a['main']), 'jibun': ns(a['rel']), 'pt': a['pt'],
            'set': {dp(a['main']), dp(a['rel'])} - {''}}


def area(rel):
    """지번 주소에서 읍·면·동까지: '경북 ○○군 ○○면 ○○리 12-3' → '○○군○○면'. 시·도와 리·번지는 뗀다."""
    toks = (rel or '').split()[1:]
    while toks and re.fullmatch(r'산|\d+(-\d+)?', toks[-1]):
        toks.pop()
    if toks and toks[-1].endswith('리'):
        toks.pop()
    return ns(' '.join(toks))


def dist_km(p1, p2):
    """카카오 좌표(WCONGNAMUL, 1m = 2.5)로 직선거리."""
    try:
        x1, y1 = map(float, p1.split(','))
        x2, y2 = map(float, p2.split(','))
        return math.hypot(x1 - x2, y1 - y2) / 2500
    except ValueError:
        return None


# ---------- 주소 문자열 다듬기 ----------
def split(a):
    """괄호 밖 첫 쉼표로 나눈다. 쉼표 앞 괄호 안에도 쉼표가 있다: '(○○동, ○○아파트)'."""
    dep = 0
    for i, ch in enumerate(a):
        if ch == '(':
            dep += 1
        elif ch == ')':
            dep = max(0, dep - 1)
        elif ch == ',' and dep == 0:
            return a[:i].strip(), a[i + 1:].strip()
    return a.strip(), ''


def clean_base(b):
    return re.sub(r'\(.*?\)', '', b).strip()


def norm_detail(dt):
    """고객 표기 정리: (○○리 123번지)·3다시6·396ㅡ2·217.1·○○길 60 16·'개인주택:○○시…'"""
    d = re.sub(r'[()\[\]]', ' ', dt).strip()
    d = re.sub(r'(\d)\s*다시\s*(\d)', r'\1-\2', d)
    d = re.sub(r'(\d)\.(\d{1,3})(?![\d.])', r'\1-\2', d)
    d = re.sub(r'[ㅡ_~–—]', '-', d)
    d = re.sub(r'\s*-\s*', '-', d)
    d = re.sub(r'(\d+)\s*번지', r'\1', d)
    d = re.sub(r'((?:로|길)\s*\d+)\s+(\d{1,3})(?!\d)(?!\s*(?:호|층|동))', r'\1-\2', d)
    d = d.replace(':', ' ')
    toks = d.split(' ')
    while len(toks) > 1 and not re.search(r'(도|시|군|구|읍|면|동|리|가|로|길)$|\d', toks[0]):
        toks.pop(0)
    return ' '.join(toks)


# 주소 번호 뒤에 이게 오면 주소가 아니라 건물·호수다: '나동 104호', '○○동 5가 204호', 'LH아파트101동 205호'
# '매화리2구'의 '2구'는 마을 구역 이름이라 번지가 아니다 (2026-10-08)
BAD_AFTER = re.compile(r'^\s*(호|층|동|단지|차|구|번지\s*\d|가)')


def addr_in_detail(dt):
    """상세주소 안에 적힌 주소(도로명 또는 지번) 부분. 없으면 None."""
    d = norm_detail(dt)
    pats = [r'[가-힣A-Za-z0-9·.]*[가-힣](?:로|길)(?:\s*\d+\s*(?:번\s*)?(?:가\s*)?길)?\s*\d+(?:-\d+)?',
            r'[가-힣]{2,}(?:\d?(?:동|리)|\d*가)\s*(?:산\s*)?\d+(?:-\d+)?']
    for p in pats:
        for m in re.finditer(p, d):
            if not re.match(r'\d', d[m.end():m.end() + 1]) and not BAD_AFTER.match(d[m.end():]):
                return d[:m.end()]
    return None


def is_jibun(d):
    """상세주소가 도로명이 아니라 지번(○○동·리·가 + 번지)인가."""
    return not re.search(r'(로|길)\s*\d', d) and bool(re.search(r'(동|리|가)\s*(산\s*)?\d+(-\d+)?$', d))


def fix_query(q):
    """행정리·행정동 번호 제거: ○○1리→○○리, ○○3동→○○동"""
    return re.sub(r'([가-힣]{2,})\d(리|동)(?=\s*(?:산\s*)?\d)', r'\1\2', q)


def region_prefixes(base, d):
    """상세주소에 시·군·구가 없으면 기준주소 앞부분을 붙여 조회한다. 읍·면까지 → 시·군·구까지 순."""
    cands = []
    em = re.search(r'^(.*?\S+(?:읍|면))\s', base)
    if em and not re.search(r'\S+(읍|면)\s', d + ' '):
        cands.append(em.group(1) + ' ' + d)
    toks, idx = base.split(), 0
    for i, t in enumerate(toks):
        if re.search(r'(시|군|구)$', t) and not re.search(r'(특별시|광역시)$', t):
            idx = i + 1
            if t.endswith('구'):
                break
    cands.append((' '.join(toks[:idx]) + ' ' + d).strip())
    return cands


# ---------- 아파트·동호수 ----------
# 동·호 대신 받을 곳을 적은 경우: 동호수로 넣지 않고 보고에만 남긴다 (2026-10-07 은주 결정)
DROP_RE = re.compile(r'관리사무소|관리실|경비실|택배함|무인택배|보관함|우편함')
UNIT_RE = re.compile(r'\d+\s*호|\d+\s*-\s*\d+|\d+\s*동\s*\d+|[A-Za-z가-힣]\s*동\s*\d+|\d{3,4}\s*$|\d+\s*층|지층|반지하|옥탑')


def is_apt(br):
    """기준주소에 카카오 장소 분류 '아파트'가 있거나 건물명에 아파트가 들어가면 아파트."""
    rk = keys(br)
    if not rk:
        return False, ''
    for name, cat, addr in br['places']:
        if '아파트' in cat and rk['road'] in ns(re.sub(r'\(.*?\)', '', addr)):
            return True, name
    if re.search(r'아파트|APT|apt|@', br['addr']['bld'] or ''):
        return True, br['addr']['bld']
    return False, ''


# ---------- 판정 ----------
def judge(row, a):
    out = {'row': row, 'a': a, 'res': '', 'note': ''}
    b, dt = split(a)
    bq = clean_base(b)
    br = fetch(bq)
    bk = keys(br)
    if not bk:  # 쉼표 앞에 건물명이 붙어 조회 실패 → 번호까지만 다시
        m = re.match(r'(.*?(?:로|길|동|리|가)\s*\d+(?:-\d+)?)(?!\d)', bq)
        if m and m.group(1) != bq:
            br = fetch(m.group(1).strip())
            bk = keys(br)
    bj = (br or {}).get('addr') or {}
    bjt = ' '.join((bj.get('rel') or '').split()[-2:])        # 기준 지번 끝부분: '○○리 123-4'
    bjnum = bjt.split()[-1] if bjt else ''
    tail = re.search(r'(\S+(?:로|길))\s*(\d+(?:-\d+)?)$', bq)   # 기준 도로명+번호
    nd = ns(norm_detail(dt))
    num_re = lambda n: r'(?<![\d-])' + re.escape(n) + r'(?![\d-])'

    da = addr_in_detail(dt) if dt else None
    # 1) 문자열로 바로 같은지: 같은 도로명+번호 반복, 지번 그대로 적음
    if da and tail and re.search(re.escape(ns(tail.group(1) + tail.group(2))) + r'(?![\d-])', nd):
        out['note'], da = '같은 도로명 반복', None
    if da and bjt and re.search(re.escape(ns(bjt)) + r'(?![\d-])', nd):
        out['note'], da = '지번 그대로 적음', None
    # '곤지산1길 8-56, 동완산동 8-56': 도로명 번호를 동 이름과 같이 다시 적음 (2026-10-08)
    dn = re.search(r'(\d+(?:-\d+)?)$', da or '')
    if da and tail and dn and dn.group(1) == tail.group(2) and ('-' in dn.group(1) or len(dn.group(1)) >= 3):
        out['note'], da = '도로명 번호 반복', None

    # 2) 번지 숫자만 적은 단독주택: '215번지', '86_1'. 아파트·건물이면 동-호라 건너뜀
    if dt and not da and not out['note']:
        mnum = re.fullmatch(r'(\d+(?:-\d+)?)', nd)
        multi = is_apt(br)[0] or bool(bj.get('bld')) or bool(re.search(r'\(.*,.*\)', b))
        # 102·301·1203처럼 십의 자리가 0인 3~4자리는 번지보다 호수다 (2026-10-08: 빌라 102·301호가 불일치로 잡힘)
        is_unit = bool(mnum and re.fullmatch(r'[1-9]\d?0\d', mnum.group(1)))
        if is_unit:
            out['note'] = '숫자만 적음·호수로 봄'
        elif mnum and not multi and len(mnum.group(1)) >= 2:
            n = mnum.group(1)
            mains = {x.split('-')[0] for x in (bjnum, tail.group(2) if tail else '') if x}
            if n in (bjnum, tail.group(2) if tail else None) or n.split('-')[0] in mains:
                out['note'] = '번지만 적음·같음'
            else:
                out['res'] = '불일치'
                out['note'] = f'번지만 적음: 상세 {n} / 쉼표앞 지번 {bjt}'
                return out

    # 3) 상세에 다른 주소가 적힌 경우 카카오로 둘 다 조회해 비교
    if da:
        cands = [da] if re.search(r'(시|군|구)\s', da + ' ') else region_prefixes(bq, da)
        dk = None
        for q in cands:
            r = fetch(fix_query(q))
            if not keys(r):
                r = fetch(q)
            dk = keys(r)
            if dk:
                break
        dnum = re.search(r'(\d+(?:-\d+)?)$', da)
        if bk and dk:
            if (dk['set'] & bk['set']) or dk['pt'] == bk['pt']:
                out['note'] = '두 주소 같음'
            elif dnum and bjnum and dnum.group(1) == bjnum and re.search(r'(리|동)\s*(산\s*)?\d+(-\d+)?$', da):
                out['note'] = '지번 번호 같음(마을 이름 차이)'
            elif tail and is_jibun(da) and area(bj.get('rel')) and area(bj.get('rel')) == area(r['addr']['rel']):
                # 도로명 vs 같은 읍·면·동 지번: 카카오 지번↔도로명 연결이 틀린 적이 있어(2026-10-06, 약 4km) 시트에 넣지 않는다
                km = dist_km(bk['pt'], dk['pt'])
                out['res'] = '확인필요'
                out['note'] = (f"같은 읍·면·동인데 카카오 기준 다른 곳: 쉼표앞 {bj.get('main','')} = {bjt} / 상세 {r['addr']['rel']}"
                               + (f" / 약 {km:.1f}km" if km is not None else '') + ' — 카카오 지번 연결 오류일 수 있음')
            else:
                km = dist_km(bk['pt'], dk['pt'])
                out['res'] = '불일치'
                out['note'] = (f"쉼표앞 {bj.get('main','')} = {bjt} / 상세 {r['addr']['main']} = {r['addr']['rel']}"
                               + (f" / 약 {km:.1f}km" if km is not None else ''))
        else:
            # 조회 실패: 오타(한 글자 틀림)·지번 번호만 맞는 경우('○○길152 번지' = 지번 ○○리 152)는 같음으로
            road_d = re.search(r'([가-힣0-9]+(?:로|길)\d*(?:번?가?길)?\d+(?:-\d+)?)', ns(da))
            road_b = ns(tail.group(1) + tail.group(2)) if tail else ''
            if bjnum and re.search(num_re(bjnum), nd):
                out['note'] = '지번 번호 같음(조회실패)'
            elif road_d and road_b and difflib.SequenceMatcher(None, road_d.group(1)[-len(road_b):], road_b).ratio() >= 0.85:
                out['note'] = '도로명 오타·같음(조회실패)'
            else:
                out['res'] = '확인필요'
                out['note'] = f'카카오 조회 실패: {cands[0]}'
        if out['res']:
            return out

    # 4) 아파트인데 동·호 없음 (쉼표 앞에 '부성아파트 103호'처럼 같이 쓴 경우도 봄)
    apt, nm = is_apt(br)
    rest = re.sub(r'^.*?(?:로|길)\s*\d+(?:-\d+)?', '', bq, count=1)
    if apt and not UNIT_RE.search(rest + ' ' + dt):
        drop = DROP_RE.search(dt)
        if drop:
            out['note'] = f'아파트({nm}) · 동·호 대신 받을 곳 적음({drop.group(0)})'
        else:
            out['res'], out['note'] = '동호수', f'아파트({nm})인데 동·호 없음'
    if not bk and not out['res']:
        out['note'] += ' (쉼표앞 주소 조회실패)'
    return out


if __name__ == '__main__':
    rows_path, work = sys.argv[1], sys.argv[2]
    cache_path = os.path.join(work, 'kakao_cache.json')
    if os.path.exists(cache_path):
        cache.update(json.load(open(cache_path)))
    rows = json.load(open(rows_path))
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(lambda x: judge(*x), rows))
    json.dump(cache, open(cache_path, 'w'), ensure_ascii=False)
    json.dump(res, open(os.path.join(work, 'result.json'), 'w'), ensure_ascii=False, indent=0)
    print('대상', len(res), '행 —', dict(Counter(r['res'] or '문제없음' for r in res)))
    for r in sorted((r for r in res if r['res']), key=lambda r: (r['res'], r['row'])):
        print(f"{r['row']}\t{r['res']}\t{r['a']}\t{r['note']}")
    drops = [r for r in res if '받을 곳' in r['note']]
    if drops:
        print(f'— 동·호 대신 받을 곳 적음 {len(drops)}행 (시트에 안 넣음, 보고에 한 줄로)')
        for r in drops:
            print(f"{r['row']}\t받을곳\t{r['a']}\t{r['note']}")
