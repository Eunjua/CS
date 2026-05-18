/**
 * Categorizer.gs — 태그 분류 규칙 SSOT (Single Source of Truth)
 *
 * 분류 규칙의 유일한 출처입니다.
 * WeeklyReport.gs, weekly-report.md, voc-report.md 모두 이 파일의 규칙을 따릅니다.
 *
 * 규칙 출처: .claude/commands/weekly-report.md 와 동일
 */

var MAIN_CATEGORIES_ = ['아카데미', '기관', '요양', '일반'];

/**
 * 태그를 카테고리로 분류합니다.
 * 복합 태그(예: 제안/아카데미_수강/신규과목)는 첫 번째 '/' 이후 부분을 기준으로 분류합니다.
 *
 * @param {string} tag
 * @returns {'아카데미'|'기관'|'요양'|'일반'|'오류'|'기타'}
 */
function categorize(tag) {
  var effective = tag.indexOf('/') !== -1 ? tag.substring(tag.indexOf('/') + 1) : tag;

  if (tag.indexOf('오류') !== -1 || effective.indexOf('오류') !== -1) return '오류';
  if (effective.indexOf('아카데미_') === 0) return '아카데미';
  if (effective.indexOf('기관_') === 0)     return '기관';
  if (effective.indexOf('요_') === 0)       return '요양';
  if (effective.indexOf('일반_') === 0)     return '일반';
  return '기타';
}

/**
 * 이번 주와 지난 주 태그 데이터를 비교해 이상 태그를 감지합니다.
 *
 * @param {Object} thisWeekTags  - tags 객체 (태그명: 건수)
 * @param {Object} lastWeekTags  - tags 객체 (태그명: 건수)
 * @returns {{ error, surge, drop, newTag }}
 */
function detectAnomalies(thisWeekTags, lastWeekTags) {
  var result = { error: [], surge: [], drop: [], newTag: [] };

  for (var tag in thisWeekTags) {
    var curr = thisWeekTags[tag] || 0;
    var prev = lastWeekTags[tag] || 0;
    var cat  = categorize(tag);

    if (cat === '기타') continue;

    // 오류 태그: 건수 무관 항상 표시
    if (cat === '오류') {
      result.error.push({ tag: tag, count: curr });
      continue;
    }

    if (MAIN_CATEGORIES_.indexOf(cat) === -1) continue;

    if (prev === 0 && curr > 0) {
      // 신규: 전주 0건 → 이번 주 등장
      result.newTag.push({ tag: tag, count: curr });
    } else if (prev > 0) {
      var changeRate = (curr - prev) / prev;
      var changeAbs  = curr - prev;

      if (changeRate >= 0.3 && changeAbs >= 3) {
        result.surge.push({ tag: tag, curr: curr, prev: prev, rate: Math.round(changeRate * 100) });
      } else if (changeRate <= -0.3 && Math.abs(changeAbs) >= 3) {
        result.drop.push({ tag: tag, curr: curr, prev: prev, rate: Math.round(changeRate * 100) });
      }
    }
  }

  result.surge.sort(function(a, b) { return b.rate - a.rate; });
  result.drop.sort(function(a, b) { return a.rate - b.rate; });

  return result;
}
