/**
 * Code.js — 「주소 확인 요청」 시트 → 슬랙 #ncs-보살핌 알림
 *
 * 알림 두 종류
 *   새 요청   : B(요청자)·C(담당자)·D(요청 내용)가 모두 채워지는 순간 → 담당자 멘션
 *   처리 완료 : E(처리 사항)에 값이 들어오는 순간 → 요청자 멘션
 *
 * 처음 한 번만 해야 하는 설정 (Apps Script 화면에서)
 *   1) 프로젝트 설정 > 스크립트 속성 두 개 등록
 *      SLACK_WEBHOOK_URL = https://hooks.slack.com/services/...
 *      SLACK_USER_MAP    = {"이름":"슬랙멤버ID", ...}   (멘션 안 걸 거면 생략 가능)
 *   2) 함수 목록에서 연결테스트 실행 → 슬랙에 메시지 오는지 확인
 *   3) 함수 목록에서 트리거설치 실행 → 시트 감시 시작
 *
 * ※ onEdit 이름의 단순 트리거는 외부 호출(UrlFetchApp)이 막혀 있어
 *    반드시 설치형 트리거로 등록해야 한다. 트리거설치()가 그 일을 한다.
 */

const 요청자열 = 2;
const 담당자열 = 3;
const 요청내용열 = 4;
const 처리사항열 = 5;
const 요청칸들 = [요청자열, 담당자열, 요청내용열];

const 처리함수 = '시트수정감지';

/**
 * 이름 → 슬랙 멤버 ID.
 * 실명이 공개 저장소에 올라가지 않도록 코드가 아니라 스크립트 속성에 둔다.
 *
 *   프로젝트 설정 > 스크립트 속성
 *   SLACK_USER_MAP = {"홍길동":"U01...","길동":"U01...","김철수":"U02..."}
 *
 * 시트에 성을 빼고 적는 경우가 있어 '홍길동'과 '길동'처럼 두 형태를 함께 넣는다.
 * 목록에 없는 이름은 그냥 글자로 나가고, 알림은 정상 발송된다.
 */
function 이름표() {
  const 원본 = String(PropertiesService.getScriptProperties().getProperty('SLACK_USER_MAP') || '').trim();
  if (!원본) return {};
  try {
    return JSON.parse(원본);
  } catch (err) {
    console.error('SLACK_USER_MAP 형식이 잘못됐습니다. 멘션 없이 발송합니다. ' + err);
    return {};
  }
}

function 멘션(이름) {
  const 정리 = String(이름 || '').trim().replace(/^@/, '');   // 시트에 '@이름' 형태로 적는 경우 대비
  const id = 이름표()[정리];
  return id ? '<@' + id + '>' : (정리 || '-');
}

/** 트리거가 부르는 입구. 편집된 열을 보고 어느 알림인지 고른다. */
function 시트수정감지(e) {
  if (!e || !e.range) return;
  const 셀 = e.range;
  if (셀.getNumRows() > 1 || 셀.getNumColumns() > 1) return;  // 여러 칸 붙여넣기는 무시
  if (셀.getRow() < 2) return;                                // 헤더 행 무시

  const 열 = 셀.getColumn();
  if (열 === 처리사항열) 처리완료알림(셀);
  else if (요청칸들.indexOf(열) !== -1) 새요청알림(셀, e);
}

/** 기존에 설치된 트리거가 옛 이름을 부르고 있을 수 있어 남겨둔다. */
function E열입력알림(e) {
  시트수정감지(e);
}

/** B·C·D가 모두 채워지는 순간 한 번 */
function 새요청알림(셀, e) {
  // 원래 값이 있던 칸을 고친 것이면 새 요청이 아니라 수정이다. 중복 발송을 여기서 막는다.
  if (String(e.oldValue || '').trim()) return;

  const 시트 = 셀.getSheet();
  const [, 요청자, 담당자, 요청내용] = 시트.getRange(셀.getRow(), 1, 1, 4).getValues()[0];
  if (!String(요청자).trim() || !String(담당자).trim() || !String(요청내용).trim()) return;

  슬랙보내기([
    '*요청사항을 확인해주세요*',
    '• 담당자: ' + 멘션(담당자),
    '• 요청 내용: ' + (요청내용 || '-'),
    '<' + 시트.getParent().getUrl() + '|시트에서 보기>'
  ].join('\n'));
}

/** E열에 처리 사항이 들어오면 */
function 처리완료알림(셀) {
  const 값 = String(셀.getValue()).trim();
  if (!값) return;                    // 값을 지웠을 땐 알림 안 보냄

  const 시트 = 셀.getSheet();
  const [, 요청자, , 요청내용] = 시트.getRange(셀.getRow(), 1, 1, 4).getValues()[0];

  슬랙보내기([
    '*주소확인 요청 처리 완료*',
    '• 요청자: ' + 멘션(요청자),
    '• 요청 내용: ' + (요청내용 || '-'),
    '• 처리 사항: ' + 값,
    '<' + 시트.getParent().getUrl() + '|시트에서 보기>'
  ].join('\n'));
}

function 슬랙보내기(문구) {
  const url = String(PropertiesService.getScriptProperties().getProperty('SLACK_WEBHOOK_URL') || '').trim();
  if (!url) throw new Error('스크립트 속성에 SLACK_WEBHOOK_URL 이 없습니다.');

  const 응답 = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ text: 문구 }),
    muteHttpExceptions: true
  });
  if (응답.getResponseCode() !== 200) {
    throw new Error('슬랙 전송 실패: ' + 응답.getResponseCode() + ' ' + 응답.getContentText());
  }
}

/** 웹훅 연결 + 멘션 표시를 한 번에 확인하는 함수 */
function 연결테스트() {
  const 이름들 = Object.keys(이름표());
  const 멘션들 = 이름들.length ? 이름들.map(멘션).join(' ') : '(SLACK_USER_MAP 비어 있음)';
  슬랙보내기('연결 테스트 — 이 메시지가 보이면 웹훅 정상입니다.\n멘션 확인(' + 이름들.length + '명): ' + 멘션들);
}

/** 수정 시 트리거 설치. 여러 번 실행해도 중복으로 쌓이지 않는다. */
function 트리거설치() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));   // 옛 이름 트리거까지 정리
  ScriptApp.newTrigger(처리함수).forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  console.log('트리거 설치 완료 — 새 요청 등록과 처리 사항 입력 모두 슬랙으로 갑니다.');
}
