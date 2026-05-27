/**

 * 싸인온 Sign-On — 학교별 공개 설정

 * GitHub Pages에 올려도 안전: Apps Script 배포 URL만 포함합니다.

 * Sheet ID, 관리자 암호는 절대 여기에 두지 마세요.

 */

window.SCHOOL_CONFIG = {

  /**

   * 모든 학교가 공통으로 쓰는 GAS 웹앱 URL (/exec)

   * 학교 추가 시 URL을 새로 만들 필요 없음 — schoolSuffix로 탭만 구분

   */

  gasWebAppUrl:

    "https://script.google.com/macros/s/AKfycbyTw81r-gg19Szv_YnqsEle3UJKlhmr1eVs4cWhzsfYmdq5LVTwYqwzYJYfSCTpPpGU/exec",



  schools: [

    {

      id: "isolgo",

      label: "이솔고등학교",

      sheetSuffix: "이솔고",

      /** 교직원·관리자 학교 선택용 코드 */
      password: "isolgo",

    },

    {

      id: "hagilgo",

      label: "하길고등학교",

      sheetSuffix: "하길고",

      password: "hagilgo",

    },

  ],



  defaultSchoolId: "isolgo",

};


