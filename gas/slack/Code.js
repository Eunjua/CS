/**
 * Code.js — 「주소 확인 요청」 시트 → 슬랙 #ncs-보살핌 알림
 *
 * 알림 두 종류
 *   새 요청   : B(요청자)·C(담당자)·D(요청 내용)가 모두 채워지는 순간 → 담당자 멘션
 *   처리 완료 : E(처리 사항)에 값이 들어오고 1분 뒤, 그때 적힌 값으로 → 요청자 멘션
 *               새 요청 글의 스레드(답글) 안에 단다. 스레드 번호가 없는 줄은 채널에 따로 보낸다
 *
 * 스레드 번호
 *   H(슬랙 스레드) : 요청 글의 슬랙 링크나 글 번호. 사람은 볼 일 없다(숨겨도 됨)
 *                    - 슬랙 워크플로가 요청을 올리면 워크플로가 「메시지 링크」를 적는다
 *                    - 이 스크립트가 새 요청 알림을 보냈으면 스크립트가 글 번호를 적는다
 *   봇 토큰으로 보낼 때만 번호를 받을 수 있다. 웹훅은 번호를 안 알려줘서 스레드에 못 단다
 *
 * 날짜 자동 입력
 *   A(날짜)      : B·C·D 중 아무 칸이나 처음 입력될 때. 이미 값이 있으면 두지 않는다
 *   G(처리 날짜) : E에 처리 사항이 들어올 때. 이미 값이 있으면 두지 않는다
 *   ※ 스크립트가 쓴 값은 수정 시 트리거를 다시 깨우지 않으므로 반복 발송 걱정은 없다
 *
 * 알림 안 보내는 경우
 *   G(처리 날짜)가 이미 찍힌 줄 : 끝난 요청이라 E·B·C·D를 고쳐도 알림 없음
 *
 * 처음 한 번만 해야 하는 설정 (Apps Script 화면에서)
 *   1) 프로젝트 설정 > 스크립트 속성 등록
 *      SLACK_WEBHOOK_URL = https://hooks.slack.com/services/...
 *      SLACK_USER_MAP    = {"이름":"슬랙멤버ID", ...}   (멘션 안 걸 거면 생략 가능)
 *      SLACK_BOT_TOKEN   = xoxb-...        (스레드 답장용. chat:write 권한, 봇을 채널에 초대)
 *      SLACK_CHANNEL_ID  = C0...           (#ncs-보살핌 채널 ID)
 *      ※ 봇 토큰·채널 ID가 없거나 봇 발송이 실패하면 예전처럼 웹훅으로 채널에 보낸다
 *   2) 함수 목록에서 연결테스트 실행 → 슬랙에 메시지 오는지 확인
 *   3) 함수 목록에서 트리거설치 실행 → 시트 감시 시작
 *
 * ※ onEdit 이름의 단순 트리거는 외부 호출(UrlFetchApp)이 막혀 있어
 *    반드시 설치형 트리거로 등록해야 한다. 트리거설치()가 그 일을 한다.
 */

const 날짜열 = 1;
const 요청자열 = 2;
const 담당자열 = 3;
const 요청내용열 = 4;
const 처리사항열 = 5;
const 처리날짜열 = 7;
const 스레드열 = 8;
const 요청칸들 = [요청자열, 담당자열, 요청내용열];

const 처리함수 = '시트수정감지';
const 처리알림대기초 = 60;   // 처리 사항 입력 후 슬랙 발송까지 기다리는 시간 (최대 300)

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

/** 비어 있을 때만 오늘 날짜를 넣는다. 이미 적힌 날짜는 건드리지 않는다. */
function 날짜채우기(시트, 행, 열) {
  const 칸 = 시트.getRange(행, 열);
  if (String(칸.getValue()).trim()) return;
  칸.setValue(new Date());
  칸.setNumberFormat('yyyy. m. d');   // 기존 행과 같은 모양으로
}

/** 트리거가 부르는 입구. 편집된 열을 보고 어느 알림인지 고른다. */
function 시트수정감지(e) {
  if (!e || !e.range) return;
  const 셀 = e.range;
  if (셀.getNumRows() > 1 || 셀.getNumColumns() > 1) return;  // 여러 칸 붙여넣기는 무시
  if (셀.getRow() < 2) return;                                // 헤더 행 무시

  const 열 = 셀.getColumn();
  if (열 !== 처리사항열 && 요청칸들.indexOf(열) === -1) return;

  // 처리 날짜가 이미 있으면 끝난 요청. 내용을 고쳐도 알림은 다시 보내지 않는다
  if (String(셀.getSheet().getRange(셀.getRow(), 처리날짜열).getValue()).trim()) return;

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
  날짜채우기(시트, 셀.getRow(), 날짜열);   // 요청을 쓰기 시작한 날. 알림 조건과 무관하게 먼저 찍는다

  const [, 요청자, 담당자, 요청내용] = 시트.getRange(셀.getRow(), 1, 1, 4).getValues()[0];
  if (!String(요청자).trim() || !String(담당자).trim() || !String(요청내용).trim()) return;

  const 글번호 = 슬랙보내기([
    '*요청사항을 확인해주세요*',
    '• 담당자: ' + 멘션(담당자),
    '• 요청 내용: ' + (요청내용 || '-'),
    '<' + 시트.getParent().getUrl() + '|시트에서 보기>'
  ].join('\n'));

  // 처리 완료를 이 글의 스레드에 달려고 번호를 적어 둔다. 못 적어도 알림은 이미 나갔다
  if (글번호) {
    try {
      const 칸 = 시트.getRange(셀.getRow(), 스레드열);
      칸.setNumberFormat('@');   // 1731123456.123456 이 숫자로 바뀌어 끝자리가 깎이지 않게 글자로
      칸.setValue(글번호);
    } catch (err) {
      console.error('스레드 번호 기록 실패 — 처리 완료는 채널에 따로 갑니다. ' + err);
    }
  }
}

/**
 * E열에 처리 사항이 들어오면 1분 기다렸다가 그때 적힌 값으로 보낸다.
 * 입력 직후 오타를 고치거나 내용을 덧붙여도 고친 값이 나가게 하려는 것.
 * 그 사이 E열을 지웠으면 보내지 않는다.
 */
function 처리완료알림(셀) {
  if (!String(셀.getValue()).trim()) return;   // 값을 지웠을 땐 알림 안 보냄

  const 시트 = 셀.getSheet();
  const 행 = 셀.getRow();
  날짜채우기(시트, 행, 처리날짜열);
  // 처리 날짜를 바로 시트에 반영해 둬야, 기다리는 1분 동안 E를 고쳐도
  // 그 편집이 '이미 처리된 줄'로 걸러져 알림이 두 번 가지 않는다
  SpreadsheetApp.flush();

  Utilities.sleep(처리알림대기초 * 1000);

  const 값 = String(시트.getRange(행, 처리사항열).getValue()).trim();
  if (!값) return;                    // 기다리는 사이 지웠으면 안 보냄

  const [, 요청자, 담당자, 요청내용] = 시트.getRange(행, 1, 1, 4).getValues()[0];
  const 스레드 = 글번호뽑기(시트.getRange(행, 스레드열).getValue());

  const 시트링크 = '<' + 시트.getParent().getUrl() + '|시트에서 보기>';

  // 스레드에 달 땐 요청 내용이 바로 위 원글에 있으니 담당자 멘션과 처리 사항만 보낸다
  if (스레드) {
    슬랙보내기([
      '*처리 완료*',
      '— 담당자: ' + 멘션(담당자),
      '— 처리 사항: ' + 값,
      시트링크
    ].join('\n'), 스레드);
    return;
  }

  // 스레드 번호가 없어 채널에 따로 갈 땐 무슨 요청인지 알 수 있게 요청 내용까지 붙인다
  슬랙보내기([
    '*요청 처리 완료*',
    '• 요청자: ' + 멘션(요청자),
    '• 요청 내용: ' + (요청내용 || '-'),
    '• 처리 사항: ' + 값,
    시트링크
  ].join('\n'), 스레드);
}

/**
 * H열 값에서 슬랙 글 번호를 꺼낸다.
 *   링크  https://xxx.slack.com/archives/C0.../p1731123456123456  → 1731123456.123456
 *   번호  1731123456.123456                                       → 그대로
 * 둘 다 아니면 빈 값(→ 채널로 따로 보낸다)
 */
function 글번호뽑기(값) {
  const 글 = String(값 || '').trim();
  const 링크 = 글.match(/\/p(\d{10})(\d{6})(?:\D|$)/);
  if (링크) return 링크[1] + '.' + 링크[2];
  return /^\d{10}\.\d{6}$/.test(글) ? 글 : '';
}

/**
 * 슬랙으로 보내고, 보낸 글 번호를 돌려준다(웹훅으로 보냈으면 빈 값).
 * 스레드 번호를 주면 그 글의 답글로 단다.
 * 봇 발송이 실패해도 알림이 사라지지 않게 웹훅으로 채널에 다시 보낸다.
 */
function 슬랙보내기(문구, 스레드) {
  const 속성 = PropertiesService.getScriptProperties();
  const 토큰 = String(속성.getProperty('SLACK_BOT_TOKEN') || '').trim();
  const 채널 = String(속성.getProperty('SLACK_CHANNEL_ID') || '').trim();
  if (토큰 && 채널) {
    try {
      return 봇으로보내기(토큰, 채널, 문구, 스레드);
    } catch (err) {
      console.error('봇 발송 실패 — 웹훅으로 채널에 보냅니다. ' + err);
    }
  }
  웹훅으로보내기(문구);
  return '';
}

function 봇으로보내기(토큰, 채널, 문구, 스레드) {
  const 내용 = { channel: 채널, text: 문구 };
  if (스레드) 내용.thread_ts = 스레드;
  const 응답 = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
    method: 'post',
    contentType: 'application/json; charset=utf-8',
    headers: { Authorization: 'Bearer ' + 토큰 },
    payload: JSON.stringify(내용),
    muteHttpExceptions: true
  });
  const 결과 = JSON.parse(응답.getContentText() || '{}');
  if (!결과.ok) throw new Error('chat.postMessage ' + 응답.getResponseCode() + ' ' + (결과.error || 응답.getContentText()));
  return String(결과.ts || '');
}

function 웹훅으로보내기(문구) {
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

/** 연결 + 멘션 표시 + 스레드 답장을 한 번에 확인하는 함수 */
function 연결테스트() {
  const 이름들 = Object.keys(이름표());
  const 멘션들 = 이름들.length ? 이름들.map(멘션).join(' ') : '(SLACK_USER_MAP 비어 있음)';
  const 글번호 = 슬랙보내기('연결 테스트 — 이 메시지가 보이면 발송 정상입니다.\n멘션 확인(' + 이름들.length + '명): ' + 멘션들);
  if (글번호) {
    슬랙보내기('스레드 답장 테스트 — 이 글이 위 메시지의 답글로 보이면 정상입니다.', 글번호);
    console.log('봇으로 보냈습니다. 슬랙에서 답글 1개가 달렸는지 확인하세요.');
  } else {
    console.log('웹훅으로 보냈습니다. 스레드 답장을 쓰려면 SLACK_BOT_TOKEN·SLACK_CHANNEL_ID를 넣으세요(실행 로그에 봇 실패 이유가 있으면 확인).');
  }
}

/** 수정 시 트리거 설치. 여러 번 실행해도 중복으로 쌓이지 않는다. */
function 트리거설치() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));   // 옛 이름 트리거까지 정리
  ScriptApp.newTrigger(처리함수).forSpreadsheet(SpreadsheetApp.getActive()).onEdit().create();
  console.log('트리거 설치 완료 — 새 요청 등록과 처리 사항 입력 모두 슬랙으로 갑니다.');
}
