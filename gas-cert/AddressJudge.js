// 자격증 주소 확인 판정 — 메뉴 「🏠 주소 확인」(AddressCheck.js)이 쓴다
// 예전 /address-check 스킬의 judge.py를 옮긴 것(2026-10-12 7,490행 비교로 같음 확인, 스킬은 같은 날 삭제).
// 고객 표기를 왜 이렇게 다루는지는 각 줄 주석과, 스킬 삭제 커밋 직전의 .claude/skills/address-check/SKILL.md 참고.
//
// 주소는 "쉼표 앞 = 주소 검색으로 고른 주소, 쉼표 뒤 = 고객이 직접 쓴 상세주소".
// 판정값: '불일치' / '동호수' / '확인필요'(조회 실패 — 시트에 넣지 않음) / ''(문제 없음)
// 카카오 조회는 lookup(q) 로 받는다. 결과 없음(조회 실패)은 null.

var KAKAO_URL = 'https://m.map.kakao.com/actions/searchView?q=';

// ---------- 카카오맵 응답 읽기 ----------
// 카카오맵 모바일 검색 화면에서 주소 블록(도로명·지번·건물명·좌표)과 장소 목록(이름·분류·주소)
function parseKakao_(t) {
  var res = { addr: null, places: [] };
  var m = /var addressData = \{\};\s*addressData = \{([\s\S]*?)\};/.exec(t);
  if (m) {
    var blk = m[1];
    var g = function(k) { var x = new RegExp(k + "\\s*:\\s*'(.*?)'").exec(blk); return x ? x[1] : ''; };
    res.addr = { main: g('mainAddress'), rel: g('relAddress'), bld: g('buildingName'),
                 pt: g('point_wx') + ',' + g('point_wy') };
  }
  var re = /data-type="place"[\s\S]*?<strong class="tit_g">([\s\S]*?)<\/strong><span class="txt_ginfo[^"]*">([\s\S]*?)<\/span>[\s\S]*?<span class="txt_g">([\s\S]*?)<\/span>/g;
  var pm;
  while ((pm = re.exec(t))) {
    res.places.push([unescapeHtml_(pm[1]).trim(), unescapeHtml_(pm[2]).trim(), unescapeHtml_(pm[3]).trim()]);
    if (res.places.length >= 15) break;
  }
  return res;
}

function unescapeHtml_(s) {
  var named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function(all, e) {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return named.hasOwnProperty(e) ? named[e] : all;
  });
}

// ---------- 작은 도구 ----------
function ns_(s) { return (s || '').replace(/\s+/g, ''); }
function words_(s) { var x = (s || '').trim(); return x ? x.split(/\s+/) : []; }  // 파이썬 str.split()
function esc_(s) { return s.replace(/[.*+?^${}()|[\]\\\-\/]/g, '\\$&'); }

// 비교용 키. 시·도 이름은 표기가 섞여서('전남광주통합' vs '…특별시') 떼고 비교한다.
function keys_(r) {
  if (!r || !r.addr || !r.addr.main) return null;
  var a = r.addr;
  var dp = function(x) { return ns_(words_(x).slice(1).join(' ')); };
  var set = {};
  [dp(a.main), dp(a.rel)].forEach(function(x) { if (x) set[x] = true; });
  return { road: ns_(a.main), jibun: ns_(a.rel), pt: a.pt, set: set };
}

// 지번 주소에서 읍·면·동까지: '경북 ○○군 ○○면 ○○리 12-3' → '○○군○○면'. 시·도와 리·번지는 뗀다.
function area_(rel) {
  var toks = words_(rel).slice(1);
  while (toks.length && /^(?:산|\d+(-\d+)?)$/.test(toks[toks.length - 1])) toks.pop();
  if (toks.length && /리$/.test(toks[toks.length - 1])) toks.pop();
  return ns_(toks.join(' '));
}

function num_(s) { s = String(s).trim(); return s === '' ? NaN : Number(s); }

// 카카오 좌표(WCONGNAMUL, 1m = 2.5)로 직선거리
function distKm_(p1, p2) {
  var a = p1.split(','), b = p2.split(',');
  if (a.length !== 2 || b.length !== 2) return null;
  var x1 = num_(a[0]), y1 = num_(a[1]), x2 = num_(b[0]), y2 = num_(b[1]);
  if ([x1, y1, x2, y2].some(isNaN)) return null;
  return Math.hypot(x1 - x2, y1 - y2) / 2500;
}

// 파이썬 difflib.SequenceMatcher(None, a, b).ratio() 와 같은 값 (짧은 글자라 autojunk 없음)
function ratio_(a, b) {
  var b2j = {};
  for (var j = 0; j < b.length; j++) (b2j[b[j]] = b2j[b[j]] || []).push(j);
  function longest(alo, ahi, blo, bhi) {
    var besti = alo, bestj = blo, bestsize = 0, j2len = {};
    for (var i = alo; i < ahi; i++) {
      var nj = {}, js = b2j[a[i]] || [];
      for (var x = 0; x < js.length; x++) {
        var jj = js[x];
        if (jj < blo) continue;
        if (jj >= bhi) break;
        var k = (j2len[jj - 1] || 0) + 1;
        nj[jj] = k;
        if (k > bestsize) { besti = i - k + 1; bestj = jj - k + 1; bestsize = k; }
      }
      j2len = nj;
    }
    return [besti, bestj, bestsize];
  }
  var matched = 0, queue = [[0, a.length, 0, b.length]];
  while (queue.length) {
    var q = queue.pop();
    var m = longest(q[0], q[1], q[2], q[3]);
    if (m[2]) {
      matched += m[2];
      if (q[0] < m[0] && q[2] < m[1]) queue.push([q[0], m[0], q[2], m[1]]);
      if (m[0] + m[2] < q[1] && m[1] + m[2] < q[3]) queue.push([m[0] + m[2], q[1], m[1] + m[2], q[3]]);
    }
  }
  var t = a.length + b.length;
  return t ? 2 * matched / t : 1;
}

// ---------- 주소 문자열 다듬기 ----------
// 괄호 밖 첫 쉼표로 나눈다. 쉼표 앞 괄호 안에도 쉼표가 있다: '(○○동, ○○아파트)'.
function split_(a) {
  var dep = 0;
  for (var i = 0; i < a.length; i++) {
    var ch = a[i];
    if (ch === '(') dep++;
    else if (ch === ')') dep = Math.max(0, dep - 1);
    else if (ch === ',' && dep === 0) return [a.slice(0, i).trim(), a.slice(i + 1).trim()];
  }
  return [a.trim(), ''];
}

function cleanBase_(b) { return b.replace(/\(.*?\)/g, '').trim(); }

// 고객 표기 정리: (○○리 123번지)·3다시6·396ㅡ2·217.1·○○길 60 16·'개인주택:○○시…'
function normDetail_(dt) {
  var d = dt.replace(/[()\[\]]/g, ' ').trim();
  d = d.replace(/(\d)\s*다시\s*(\d)/g, '$1-$2');
  d = d.replace(/(\d)\.(\d{1,3})(?![\d.])/g, '$1-$2');
  d = d.replace(/[ㅡ_~–—]/g, '-');
  d = d.replace(/\s*-\s*/g, '-');
  d = d.replace(/(\d+)\s*번지/g, '$1');
  d = d.replace(/((?:로|길)\s*\d+)\s+(\d{1,3})(?!\d)(?!\s*(?:호|층|동))/g, '$1-$2');
  d = d.replace(/:/g, ' ');
  var toks = d.split(' ');
  while (toks.length > 1 && !/(도|시|군|구|읍|면|동|리|가|로|길)$|\d/.test(toks[0])) toks.shift();
  return toks.join(' ');
}

// 주소 번호 뒤에 이게 오면 주소가 아니라 건물·호수다: '나동 104호', '○○동 5가 204호', 'LH아파트101동 205호'
// '매화리2구'의 '2구'는 마을 구역 이름이라 번지가 아니다 (2026-10-08)
var BAD_AFTER = /^\s*(호|층|동|단지|차|구|번지\s*\d|가)/;

// 상세주소 안에 적힌 주소(도로명 또는 지번) 부분. 없으면 null.
function addrInDetail_(dt) {
  var d = normDetail_(dt);
  var pats = [/[가-힣A-Za-z0-9·.]*[가-힣](?:로|길)(?:\s*\d+\s*(?:번\s*)?(?:가\s*)?길)?\s*\d+(?:-\d+)?/g,
              /[가-힣]{2,}(?:\d?(?:동|리)|\d*가)\s*(?:산\s*)?\d+(?:-\d+)?/g];
  for (var p = 0; p < pats.length; p++) {
    var re = pats[p], m;
    re.lastIndex = 0;
    while ((m = re.exec(d))) {
      var end = m.index + m[0].length;
      if (!/^\d/.test(d.slice(end, end + 1)) && !BAD_AFTER.test(d.slice(end))) return d.slice(0, end);
    }
  }
  return null;
}

// 상세주소가 도로명이 아니라 지번(○○동·리·가 + 번지)인가
function isJibun_(d) {
  return !/(로|길)\s*\d/.test(d) && /(동|리|가)\s*(산\s*)?\d+(-\d+)?$/.test(d);
}

// 행정리·행정동 번호 제거: ○○1리→○○리, ○○3동→○○동
function fixQuery_(q) { return q.replace(/([가-힣]{2,})\d(리|동)(?=\s*(?:산\s*)?\d)/g, '$1$2'); }

// 상세주소에 시·군·구가 없으면 기준주소 앞부분을 붙여 조회한다. 읍·면까지 → 시·군·구까지 순.
function regionPrefixes_(base, d) {
  var cands = [];
  var em = /^(.*?\S+(?:읍|면))\s/.exec(base);
  if (em && !/\S+(읍|면)\s/.test(d + ' ')) cands.push(em[1] + ' ' + d);
  var toks = words_(base), idx = 0;
  for (var i = 0; i < toks.length; i++) {
    var t = toks[i];
    if (/(시|군|구)$/.test(t) && !/(특별시|광역시)$/.test(t)) {
      idx = i + 1;
      if (/구$/.test(t)) break;
    }
  }
  cands.push((toks.slice(0, idx).join(' ') + ' ' + d).trim());
  return cands;
}

// ---------- 아파트·동호수 ----------
// 동·호 대신 받을 곳을 적은 경우: 동호수로 넣지 않고 보고에만 남긴다 (2026-10-07 은주 결정)
var DROP_RE = /관리사무소|관리실|경비실|택배함|무인택배|보관함|우편함/;
var UNIT_RE = /\d+\s*호|\d+\s*-\s*\d+|\d+\s*동\s*\d+|[A-Za-z가-힣]\s*동\s*\d+|\d{3,4}\s*$|\d+\s*층|지층|반지하|옥탑/;

// 기준주소에 카카오 장소 분류 '아파트'가 있거나 건물명에 아파트가 들어가면 아파트
function isApt_(br) {
  var rk = keys_(br);
  if (!rk) return [false, ''];
  for (var i = 0; i < br.places.length; i++) {
    var p = br.places[i];
    if (p[1].indexOf('아파트') >= 0 && ns_(p[2].replace(/\(.*?\)/g, '')).indexOf(rk.road) >= 0) return [true, p[0]];
  }
  if (/아파트|APT|apt|@/.test(br.addr.bld || '')) return [true, br.addr.bld];
  return [false, ''];
}

function overlap_(s1, s2) {
  for (var k in s1) if (s2[k]) return true;
  return false;
}

// ---------- 판정 ----------
function judgeRow(row, a, lookup) {
  var out = { row: row, a: a, res: '', note: '' };
  var sp = split_(a), b = sp[0], dt = sp[1];
  var bq = cleanBase_(b);
  var br = lookup(bq);
  var bk = keys_(br);
  if (!bk) {  // 쉼표 앞에 건물명이 붙어 조회 실패 → 번호까지만 다시
    var m0 = /^(.*?(?:로|길|동|리|가)\s*\d+(?:-\d+)?)(?!\d)/.exec(bq);
    if (m0 && m0[1] !== bq) {
      br = lookup(m0[1].trim());
      bk = keys_(br);
    }
  }
  var bj = (br && br.addr) || {};
  var bjt = words_(bj.rel || '').slice(-2).join(' ');        // 기준 지번 끝부분: '○○리 123-4'
  var bjnum = bjt ? words_(bjt).slice(-1)[0] : '';
  var tail = /(\S+(?:로|길))\s*(\d+(?:-\d+)?)$/.exec(bq);    // 기준 도로명+번호
  var nd = ns_(normDetail_(dt));
  var numRe = function(n) { return new RegExp('(?<![\\d-])' + esc_(n) + '(?![\\d-])'); };

  var da = dt ? addrInDetail_(dt) : null;
  // 1) 문자열로 바로 같은지: 같은 도로명+번호 반복, 지번 그대로 적음
  if (da && tail && new RegExp(esc_(ns_(tail[1] + tail[2])) + '(?![\\d-])').test(nd)) {
    out.note = '같은 도로명 반복'; da = null;
  }
  if (da && bjt && new RegExp(esc_(ns_(bjt)) + '(?![\\d-])').test(nd)) {
    out.note = '지번 그대로 적음'; da = null;
  }
  // '곤지산1길 8-56, 동완산동 8-56': 도로명 번호를 동 이름과 같이 다시 적음 (2026-10-08)
  var dn = /(\d+(?:-\d+)?)$/.exec(da || '');
  if (da && tail && dn && dn[1] === tail[2] && (dn[1].indexOf('-') >= 0 || dn[1].length >= 3)) {
    out.note = '도로명 번호 반복'; da = null;
  }

  // 2-0) 리 이름 없이 '읍·면 + 번지'만 적음: '장기면24'. 어느 리인지 몰라 카카오로 비교할 수 없다 (2026-10-14)
  if (dt && !da && !out.note) {
    var mem = /[가-힣](?:읍|면)(?:산)?(\d+(?:-\d+)?)(?![\d-])/.exec(nd);
    if (mem && !BAD_AFTER.test(nd.slice(mem.index + mem[0].length))) {
      var en = mem[1];
      if (en === bjnum || (tail && en === tail[2])) {
        out.note = '읍·면+번지만 적음·같음';
      } else {
        out.res = '확인필요';
        out.note = '리 이름 없이 번지만 적음: 상세 ' + en + ' / 쉼표앞 ' + (bj.main || bq) + ' = ' + bjt;
        return out;
      }
    }
  }

  // 2) 번지 숫자만 적은 단독주택: '215번지', '86_1'. 아파트·건물이면 동-호라 건너뜀
  if (dt && !da && !out.note) {
    var mnum = /^(\d+(?:-\d+)?)$/.exec(nd);
    var multi = isApt_(br)[0] || !!bj.bld || /\(.*,.*\)/.test(b);
    // 102·301·1203처럼 십의 자리가 0인 3~4자리는 번지보다 호수다 (2026-10-08: 빌라 102·301호가 불일치로 잡힘)
    var isUnit = !!(mnum && /^[1-9]\d?0\d$/.test(mnum[1]));
    if (isUnit) {
      out.note = '숫자만 적음·호수로 봄';
    } else if (mnum && !multi && mnum[1].length >= 2) {
      var n = mnum[1];
      var t2 = tail ? tail[2] : '';
      var mains = {};
      [bjnum, t2].forEach(function(x) { if (x) mains[x.split('-')[0]] = true; });
      if (n === bjnum || (tail && n === tail[2]) || mains[n.split('-')[0]]) {
        out.note = '번지만 적음·같음';
      } else {
        out.res = '불일치';
        out.note = '번지만 적음: 상세 ' + n + ' / 쉼표앞 지번 ' + bjt;
        return out;
      }
    }
  }

  // 3) 상세에 다른 주소가 적힌 경우 카카오로 둘 다 조회해 비교
  if (da) {
    var cands = /(시|군|구)\s/.test(da + ' ') ? [da] : regionPrefixes_(bq, da);
    var dk = null, r = null;
    for (var i = 0; i < cands.length; i++) {
      r = lookup(fixQuery_(cands[i]));
      if (!keys_(r)) r = lookup(cands[i]);
      dk = keys_(r);
      if (dk) break;
    }
    var dnum = /(\d+(?:-\d+)?)$/.exec(da);
    if (bk && dk) {
      if (overlap_(dk.set, bk.set) || dk.pt === bk.pt) {
        out.note = '두 주소 같음';
      } else if (dnum && bjnum && dnum[1] === bjnum && /(리|동)\s*(산\s*)?\d+(-\d+)?$/.test(da)) {
        out.note = '지번 번호 같음(마을 이름 차이)';
      } else if (tail && isJibun_(da) && area_(bj.rel) && area_(bj.rel) === area_(r.addr.rel)) {
        // 도로명 vs 같은 읍·면·동 지번: 카카오 지번↔도로명 연결이 틀린 적이 있어(2026-10-06, 약 4km) 시트에 넣지 않는다
        var km = distKm_(bk.pt, dk.pt);
        out.res = '확인필요';
        out.note = '같은 읍·면·동인데 카카오 기준 다른 곳: 쉼표앞 ' + (bj.main || '') + ' = ' + bjt + ' / 상세 ' + r.addr.rel
                   + (km !== null ? ' / 약 ' + km.toFixed(1) + 'km' : '') + ' — 카카오 지번 연결 오류일 수 있음';
      } else {
        var km2 = distKm_(bk.pt, dk.pt);
        out.res = '불일치';
        out.note = '쉼표앞 ' + (bj.main || '') + ' = ' + bjt + ' / 상세 ' + r.addr.main + ' = ' + r.addr.rel
                   + (km2 !== null ? ' / 약 ' + km2.toFixed(1) + 'km' : '');
      }
    } else {
      // 조회 실패: 오타(한 글자 틀림)·지번 번호만 맞는 경우('○○길152 번지' = 지번 ○○리 152)는 같음으로
      var roadD = /([가-힣0-9]+(?:로|길)\d*(?:번?가?길)?\d+(?:-\d+)?)/.exec(ns_(da));
      var roadB = tail ? ns_(tail[1] + tail[2]) : '';
      if (bjnum && numRe(bjnum).test(nd)) {
        out.note = '지번 번호 같음(조회실패)';
      } else if (roadD && roadB && ratio_(roadD[1].slice(-roadB.length), roadB) >= 0.85) {
        out.note = '도로명 오타·같음(조회실패)';
      } else {
        out.res = '확인필요';
        out.note = '카카오 조회 실패: ' + cands[0];
      }
    }
    if (out.res) return out;
  }

  // 4) 아파트인데 동·호 없음 (쉼표 앞에 '부성아파트 103호'처럼 같이 쓴 경우도 봄)
  var ap = isApt_(br);
  var rest = bq.replace(/^.*?(?:로|길)\s*\d+(?:-\d+)?/, '');
  if (ap[0] && !UNIT_RE.test(rest + ' ' + dt)) {
    var drop = DROP_RE.exec(dt);
    if (drop) {
      out.note = '아파트(' + ap[1] + ') · 동·호 대신 받을 곳 적음(' + drop[0] + ')';
    } else {
      out.res = '동호수'; out.note = '아파트(' + ap[1] + ')인데 동·호 없음';
    }
  }
  if (!bk && !out.res) out.note += ' (쉼표앞 주소 조회실패)';
  return out;
}
