#!/usr/bin/env python3
"""ALF 개선로그 자동 아카이브.

본문에는 최근 N개 회차(기본 3)만 남기고, 그보다 오래된 기록은
ALF_개선로그_아카이브.md 로 옮긴다. 내용은 한 글자도 버리지 않는다.

사용법:
    python3 archive_log.py            # 미리보기(변경 안 함)
    python3 archive_log.py --apply    # 실제 적용
    python3 archive_log.py --keep 5 --apply
"""
import io, re, sys, shutil, datetime, os

LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ALF_개선로그.md')
ARC = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'ALF_개선로그_아카이브.md')
HEAD = '## 🗂 개선 이력 (최신이 위로)'
LINK = '\n> 📦 기준선 ~ 이전 회차 기록은 [`ALF_개선로그_아카이브.md`](ALF_개선로그_아카이브.md) 에 있다. 내용은 그대로 보존되며, 본문에는 최근 회차만 둔다.\n'

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

def main():
    keep = 3
    if '--keep' in sys.argv:
        keep = int(sys.argv[sys.argv.index('--keep') + 1])
    apply = '--apply' in sys.argv

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
        return 0

    cutoff = sorted((r[0] for r in rounds), reverse=True)[keep - 1]
    stay = [s for s in secs if s[0] >= cutoff]
    move = [s for s in secs if s[0] < cutoff]
    if not move:
        print('아카이브할 섹션이 없다.')
        return 0

    new_log = pre + HEAD + LINK + ''.join(s[2] for s in stay)
    stamp = datetime.date.today().isoformat()
    header = (f'# ALF 개선 로그 — 아카이브\n\n'
              f'`ALF_개선로그.md` 본문에서 내려온 과거 회차 기록. 최신이 위로.\n'
              f'현황 요약·최근 회차·봇 도큐먼트 현황은 본문에 있다.\n\n---\n\n')
    old_arc = io.open(ARC, encoding='utf-8').read() if os.path.exists(ARC) else ''
    if old_arc.startswith('# ALF 개선 로그 — 아카이브'):
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

    # 유실 검증: 옮긴 섹션이 전부 아카이브에 들어갔는지
    lost = [s[1] for s in move if s[2] not in new_arc]
    if lost:
        print('\n[중단] 아카이브에 담기지 않은 섹션이 있다:', lost)
        return 1

    if not apply:
        print('\n미리보기만 했다. 적용하려면 --apply')
        return 0

    shutil.copy(LOG, LOG + '.bak')
    io.open(ARC, 'w', encoding='utf-8').write(new_arc)
    io.open(LOG, 'w', encoding='utf-8').write(new_log)
    print(f'\n적용 완료. 백업: {os.path.basename(LOG)}.bak')
    return 0

if __name__ == '__main__':
    sys.exit(main())
