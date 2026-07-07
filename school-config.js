/**
 * 싸인온 Sign-On — 학교별 공개 설정
 * GitHub Pages에 올려도 안전: Apps Script 배포 URL만 포함합니다.
 * Sheet ID, 관리자 암호는 절대 여기에 두지 마세요.
 */
window.SCHOOL_CONFIG = {
  /**
   * 모든 학교가 공통으로 쓰는 GAS 웹앱 URL (/exec)
   * 학교 추가 시 URL을 새로 만들 필요 없음 — sheetSuffix로 탭만 구분
   */
  gasWebAppUrl:
    "https://script.google.com/macros/s/AKfycbw0_VJP-GxiEI2tK6tgxxFjL2V-mNxlq33K5hxP3D-tC9Rxe9t-InACJTVXbBDwmpxi/exec",

  schools: [
    {
      id: "isolgo",
      label: "이솔고등학교",
      sheetSuffix: "이솔고",
      password: "isolgo",
      codeType: "school",
      flowMode: "school",
    },
    {
      id: "hagilgo",
      label: "하길고등학교",
      sheetSuffix: "하길고",
      password: "hagilgo",
      codeType: "school",
      flowMode: "school",
    },
    {
      id: "geo",
      label: "바이브 코딩을 활용한 지리교사 역량강화",
      displayTitle: "바이브 코딩을 활용한 지리교사 역량강화",
      sheetSuffix: "지리연수",
      password: "geo1234",
      codeType: "training",
      flowMode: "workshop",
    },
  ],

  defaultSchoolId: "isolgo",
};
