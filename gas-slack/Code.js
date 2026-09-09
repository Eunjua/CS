/**
 * Code.js — 「주소 확인 요청」 시트 E열(처리 사항) 입력 시 슬랙 #ncs-보살핌 알림
 *
 * 처음 한 번만 해야 하는 설정 (Apps Script 화면에서)
 *   1) 프로젝트 설정 > 스크립트 속성
 *      SLACK_WEBHOOK_URL = https://hooks.slack.com/services/...
 *   2) 함수 목록에서 연결테스트 실행 → 슬랙에 메시지 오는지 확인
 *   3) 함수 목록에서 트리거설치 실행 → E열 감시 시작
 *
 * ※ onEdit 이름의 단순 트리거는 외부 호출(UrlFetchApp)이 막혀 있어
 *    반드시 설치형 트리거로 등록해야 한다. 트리거설치()가 그 일을 한다.
 */

const E열 = 5;
const 처리함수 = 'E열입력알림';

function E열입력알림(e) {
  if (!e || !e.range) return;
  const 셀 = e.range;
  if (셀.getColumn() !== E열) return;
  if (셀.getNumRows() > 1 || 셀.getNumColumns() > 1) return;  // 여러 칸 붙여넣기는 무시

  const 값 = String(셀.getValue()).trim();
  if (!값) return;                    // 값을 지웠을 땐 알림 안 보냄

  const 행 = 셀.getRow();
  if (행 < 2) return;                 // 헤더 행 무시

  const 시트 = 셀.getSheet();
  const [, 요청자, 담당자, 요청내용] = 시트.getRange(행, 1, 1, 4).getValues()[0];

  슬랙보내기([
    '*주소확인 요청 처리 완료*',
    '• 요청자: ' + (요청자 || '-'),
    '• 담당자: ' + (담당자 || '-'),
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

/** 웹훅 연결만 먼저 확인하는 함수 */
function 연결테스트() {
  슬랙보내기('연결 테스트 — 이 메시지가 보이면 웹훅 정상입니다.');
}

/** 수정 시 트리거 설치. 여러 번 실행해도 중복으로 쌓이지 않는다. */
function 트리거설치() {
  const 시트 = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 처리함수)
    .forEach(t => ScriptApp.deleteTrigger(t));

  ScriptApp.newTrigger(처리함수).forSpreadsheet(시트).onEdit().create();
  console.log('트리거 설치 완료 — 이제 E열에 값을 넣으면 슬랙으로 갑니다.');
}
