/**
 * CS 응대 가이드 — 구글시트 ↔ 화면(cs-guide) 연결 스크립트
 *
 * [시트 구조]  '케이스' 탭, 첫 줄 머리글(순서 무관, 이름으로 찾음):
 *   분류 | 케이스 | 케이스설명 | 단계ID | 부모단계 | 분기조건 | 유형 | 내용 | 참고링크
 *
 * [기능]
 *   - doGet  : 시트를 읽어 화면에 JSON으로 넘김 (화면이 호출)
 *   - doPost : 케이스(JSON)를 받아 시트에 자동으로 써넣음 (클로드가 호출 → "말하면 시트에 채워짐")
 *
 * [배포]  확장 → Apps Script → 이 코드 붙여넣기 → 저장
 *         배포 → 배포 관리 → (연필) 편집 → 버전: '새 버전' → 배포   (URL 그대로 유지)
 *         유형: 웹 앱 / 실행: 나 / 액세스 권한: 모든 사용자
 */

const SHEET_NAME = '케이스';
const HEADER = ['분류','케이스','케이스설명','단계ID','부모단계','분기조건','유형','내용','참고링크'];

// 아무나 시트에 쓰지 못하게 막는 간단한 비밀키. 원하면 바꾸세요(클로드에게도 알려주면 됨).
const WRITE_TOKEN = 'bosalpim-cs-guide';

/* ===================== 읽기 (화면용) ===================== */
function doGet() {
  return jsonOut_(buildCases());
}

/** 시트의 평평한 행들을 케이스별 흐름도 구조로 묶어 반환 */
function buildCases() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) return [];
  const rows = sh.getDataRange().getValues();
  if (rows.length < 2) return [];

  const header = rows[0].map(h => String(h).trim());
  const c = name => header.indexOf(name);
  const iCat=c('분류'), iName=c('케이스'), iDesc=c('케이스설명'),
        iSid=c('단계ID'), iPar=c('부모단계'), iCond=c('분기조건'),
        iType=c('유형'), iText=c('내용'), iLink=c('참고링크');

  const map = {}, order = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const name = String(row[iName] || '').trim();
    if (!name) continue;
    if (!map[name]) {
      map[name] = { id:'case-'+(order.length+1), name:name,
        category:String(row[iCat]||'').trim()||'기타',
        desc:String(row[iDesc]||'').trim(), steps:[] };
      order.push(name);
    }
    const cs = map[name];
    if (!cs.desc && row[iDesc]) cs.desc = String(row[iDesc]).trim();
    const sidV = row[iSid];
    if (sidV === '' || sidV === null) continue;
    cs.steps.push({
      sid:Number(sidV),
      parent:(row[iPar]===''||row[iPar]===null)?null:Number(row[iPar]),
      cond:String(row[iCond]||'').trim()||null,
      type:String(row[iType]||'').trim(),
      text:String(row[iText]||'').trim(),
      link:String(row[iLink]||'').trim()||null
    });
  }
  return order.map(n => map[n]);
}

/* ===================== 쓰기 (클로드가 호출) ===================== */
/**
 * 받는 JSON 예:
 * { "token":"...", "action":"upsert",
 *   "case": { "category":"결제", "name":"입금 확인", "desc":"...",
 *             "steps":[ {"sid":1,"parent":null,"cond":null,"type":"질문","text":"...","link":null}, ... ] } }
 *  - action "upsert"(기본): 같은 이름 케이스가 있으면 갈아끼우고, 없으면 추가
 *  - action "append": 무조건 아래에 추가
 *  - action "delete": 해당 케이스 행 삭제
 */
function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (body.token !== WRITE_TOKEN) return jsonOut_({ ok:false, error:'unauthorized' });

    const sh = getOrCreateSheet_();
    ensureHeader_(sh);
    const action = body.action || 'upsert';
    const c = body.case || {};
    const name = String(c.name || '').trim();

    if (action === 'delete') {
      if (!name) return jsonOut_({ ok:false, error:'no case name' });
      const removed = removeCaseRows_(sh, name);
      return jsonOut_({ ok:true, action, case:name, removed });
    }

    if (!name || !Array.isArray(c.steps) || !c.steps.length)
      return jsonOut_({ ok:false, error:'case.name 과 steps 가 필요합니다' });

    if (action === 'upsert') removeCaseRows_(sh, name);
    const rows = caseToRows_(c);
    sh.getRange(sh.getLastRow()+1, 1, rows.length, HEADER.length).setValues(rows);
    return jsonOut_({ ok:true, action, case:name, wrote:rows.length });
  } catch (err) {
    return jsonOut_({ ok:false, error:String(err) });
  }
}

/* ===================== 도우미 ===================== */
function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
function getOrCreateSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
}
function ensureHeader_(sh) {
  if (sh.getLastRow() === 0) sh.getRange(1,1,1,HEADER.length).setValues([HEADER]);
}
/** 케이스 객체 → 시트 행들(2차원 배열). 케이스설명은 첫 줄에만. */
function caseToRows_(c) {
  const cat = String(c.category||'').trim();
  const name = String(c.name||'').trim();
  const desc = String(c.desc||'').trim();
  return c.steps.map((s, i) => [
    cat, name, i===0 ? desc : '',
    (s.sid===null||s.sid===undefined) ? '' : s.sid,
    (s.parent===null||s.parent===undefined) ? '' : s.parent,
    s.cond ? String(s.cond) : '',
    String(s.type||''), String(s.text||''),
    s.link ? String(s.link) : ''
  ]);
}
/** 특정 케이스 이름의 행을 모두 지움(머리글 유지). 지운 행 수 반환. */
function removeCaseRows_(sh, name) {
  const data = sh.getDataRange().getValues();
  if (data.length < 2) return 0;
  const header = data[0].map(h => String(h).trim());
  const iName = header.indexOf('케이스');
  const kept = [header];
  let removed = 0;
  for (let r=1; r<data.length; r++) {
    if (String(data[r][iName]||'').trim() === name) { removed++; continue; }
    kept.push(data[r]);
  }
  sh.clearContents();
  sh.getRange(1,1,kept.length, header.length).setValues(kept);
  return removed;
}

/* ===================== (선택) 수동 도구 ===================== */
function testBuild() { Logger.log(JSON.stringify(buildCases(), null, 2)); }
