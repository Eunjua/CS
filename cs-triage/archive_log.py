#!/usr/bin/env python3
"""ALF 개선로그 자동 아카이브.

`ALF_개선로그/` 폴더 안에 두 파일이 있다.
    최신_{a}~{b}차.md        — 현황 요약 + 최근 N개 회차(기본 3)
    지난기록_기준선~{c}차.md  — 그보다 오래된 회차. 내용은 한 글자도 버리지 않는다.

회차가 늘면 오래된 회차를 아래 파일로 내리고, **두 파일 이름의 회차 범위도
자동으로 갱신한다**(11~13차 → 12~14차). 그래서 파일 목록만 봐도 어디까지
들어있는지 알 수 있다.

사용법:
    python3 archive_log.py            # 미리보기(변경 안 함)
    python3 archive_log.py --apply    # 실제 적용
    python3 archive_log.py --keep 5 --apply
"""
import io, re, sys, glob, shutil, datetime, os

DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ALF_개선로그')
HEAD = '## 🗂 개선 이력 (최신이 위로)'


def find_one(pattern, label):
    """폴더 안에서 파일 하나를 찾는다. 없거나 여럿이면 멈춘다."""
    hits = sorted(glob.glob(os.path.join(DIR, pattern)))
    if len(hits) != 1:
        print(f'[중단] {label} 파일을 하나로 특정하지 못했다({len(hits)}개): {pattern}')
        return None
    return hits[0]


def round_no(title):
    """'### 2026-08-31 | 13차 점검 …' → 13. 기준선은 0."""
    m = re.search(r'(\d+)차', title)
    if m:
        return int(m.group(1))
    return 0 if '기준선' in title else None


def split_sections(body):
    """'### ' 섹션을 (날짜, 제목, 본문)으로 자른다."""
    idx = [m.start() for m in re.finditer(r'^### ', body, re.M)] + [len(body)]
    out = []
    for a, b in zip(idx, idx[1:]):
        chunk = body[a:b]
        title = chunk.split('\n', 1)[0]
        m = re.match(r'### (\d{4}-\d{2}-\d{2})', title)
        out.append((m.group(1) if m else '0000-00-00', title, chunk))
    return out


def span_name(secs, prefix):
    """남은 섹션들의 회차 범위로 파일명을 만든다."""
    nums = [n for n in (round_no(s[1]) for s in secs) if n is not None]
    if not nums:
        return f'{prefix}.md'
    lo, hi = min(nums), max(nums)
    if lo == hi:
        return f'{prefix}_{"기준선" if lo == 0 else f"{lo}차"}.md'
    # 앞쪽은 숫자만, '차'는 뒤에 한 번만 (11~13차)
    lo_s = '기준선' if lo == 0 else str(lo)
    return f'{prefix}_{lo_s}~{hi}차.md'


def main():
    keep = 3
    if '--keep' in sys.argv:
        keep = int(sys.argv[sys.argv.index('--keep') + 1])
    apply = '--apply' in sys.argv

    if not os.path.isdir(DIR):
        print(f'[중단] 폴더가 없다: {DIR}')
        return 1
    LOG = find_one('최신_*.md', '최신')
    ARC = find_one('지난기록_*.md', '지난기록')
    if not LOG or not ARC:
        return 1

    text = io.open(LOG, encoding='utf-8').read()
    if HEAD not in text:
        print(f'[중단] 섹션 머리글을 찾지 못했다: {HEAD}')
        return 1
    pre, body = text.split(HEAD, 1)
    secs = split_sections(body)
    if not secs:
        print('[중단] 회차 섹션이 없다')
        return 1

    # '{N}차 점검'이 제목에 있는 것만 회차로 센다(부속 기록 제외)
    rounds = [s for s in secs if re.search(r'\d+차 점검', s[1])]
    if len(rounds) <= keep:
        print(f'회차 {len(rounds)}개 — 유지 기준 {keep}개 이하라 아카이브할 것이 없다.')
        # 옮길 것이 없어도 파일명이 회차 범위와 어긋나면 맞춰준다
        return rename_only(LOG, ARC, secs, apply)

    cutoff = sorted((r[0] for r in rounds), reverse=True)[keep - 1]
    stay = [s for s in secs if s[0] >= cutoff]
    move = [s for s in secs if s[0] < cutoff]
    if not move:
        print('아카이브할 섹션이 없다.')
        return rename_only(LOG, ARC, secs, apply)

    old_arc = io.open(ARC, encoding='utf-8').read() if os.path.exists(ARC) else ''
    arc_secs = split_sections(old_arc)

    # 새 파일명은 이관 후의 회차 구성으로 계산한다
    new_log_name = span_name(stay, '최신')
    new_arc_name = span_name(move + arc_secs, '지난기록')
    link = (f'\n> 📦 기준선 ~ 이전 회차 기록은 [`{new_arc_name}`]({new_arc_name}) 에 있다. '
            f'내용은 그대로 보존되며, 본문에는 최근 회차만 둔다.\n')

    new_log = pre + HEAD + link + ''.join(s[2] for s in stay)
    stamp = datetime.date.today().isoformat()
    header = (f'# ALF 개선 로그 — 지난 기록\n\n'
              f'`{new_log_name}` 본문에서 내려온 과거 회차 기록. 최신이 위로.\n'
              f'현황 요약·최근 회차·봇 도큐먼트 현황은 그쪽 파일에 있다.\n\n---\n\n')
    if old_arc.lstrip().startswith('# ALF 개선 로그'):
        old_body = old_arc.split('---\n\n', 1)[1] if '---\n\n' in old_arc else ''
    else:
        old_body = old_arc
    new_arc = header + f'<!-- {stamp} 이관 -->\n\n' + ''.join(s[2] for s in move) + old_body

    print(f'본문에 남길 섹션 {len(stay)}개 (컷오프 {cutoff} 이상)')
    for s in stay:
        print(f'   유지  {s[1][:66]}')
    print(f'\n아카이브로 옮길 섹션 {len(move)}개')
    for s in move:
        print(f'   이동  {s[1][:66]}')
    print(f'\n개선로그 {len(text):,} → {len(new_log):,}자 ({(1-len(new_log)/len(text))*100:.0f}% 감소)')
    print(f'아카이브 {len(old_arc):,} → {len(new_arc):,}자')
    print(f'\n파일명 {os.path.basename(LOG)} → {new_log_name}')
    print(f'파일명 {os.path.basename(ARC)} → {new_arc_name}')

    # 유실 검증: 옮긴 섹션이 전부 아카이브에 들어갔는지
    lost = [s[1] for s in move if s[2] not in new_arc]
    if lost:
        print('\n[중단] 아카이브에 담기지 않은 섹션이 있다:', lost)
        return 1

    if not apply:
        print('\n미리보기만 했다. 적용하려면 --apply')
        return 0

    shutil.copy(LOG, os.path.join(DIR, '최신.md.bak'))
    io.open(ARC, 'w', encoding='utf-8').write(new_arc)
    io.open(LOG, 'w', encoding='utf-8').write(new_log)
    # 내용을 다 쓴 뒤에 이름을 바꾼다(도중에 죽어도 내용은 남는다)
    git_rename(LOG, os.path.join(DIR, new_log_name))
    git_rename(ARC, os.path.join(DIR, new_arc_name))
    print(f'\n적용 완료. 백업: ALF_개선로그/최신.md.bak')
    return 0


def rename_only(LOG, ARC, secs, apply):
    """이관은 없지만 파일명이 회차 범위와 어긋날 때 이름만 맞춘다."""
    new_log_name = span_name(secs, '최신')
    if os.path.basename(LOG) == new_log_name:
        return 0
    print(f'파일명이 회차와 어긋난다: {os.path.basename(LOG)} → {new_log_name}')
    if not apply:
        print('적용하려면 --apply')
        return 0
    git_rename(LOG, os.path.join(DIR, new_log_name))
    print('파일명 정리 완료.')
    return 0


def git_rename(src, dst):
    """git이 추적 중이면 git mv로, 아니면 그냥 옮긴다(히스토리 보존)."""
    if src == dst:
        return
    if os.path.exists(dst):
        os.remove(dst)
    if os.system(f'git mv "{src}" "{dst}" 2>/dev/null') != 0:
        os.rename(src, dst)


if __name__ == '__main__':
    sys.exit(main())
