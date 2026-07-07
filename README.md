# 싸인온 Sign-On

교직원 회의·연수 **온라인 서명 등록부** 웹 앱입니다.

- **프론트**: HTML / CSS / JavaScript → GitHub Pages
- **백엔드**: Google Apps Script (GAS)
- **DB**: Google Sheets

민감 정보(관리자 암호, 스프레드시트 ID)는 **Apps Script 스크립트 속성**에만 저장합니다.  
`school-config.js`에는 **GAS 웹 앱 URL**만 넣습니다.

---

## 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html` | 교직원·관리자 UI |
| `style.css` | 스타일 (민트 톤, 인쇄 CSS 포함) |
| `script.js` | 프론트 로직·API 호출 |
| `school-config.js` | 학교명, GAS URL (공개 가능) |
| `Code.gs` | Apps Script 백엔드 |
| `README.md` | 설치·배포 가이드 |

---

## 1. Google Sheets 준비

1. 새 스프레드시트 생성
2. URL에서 **스프레드시트 ID** 복사  
   `https://docs.google.com/spreadsheets/d/{SPREADSHEET_ID}/edit`

시트는 GAS가 자동 생성합니다.

| 시트명 | 컬럼 |
|--------|------|
| 연수목록 | eventId, title, date, location, description, status, targetType, targetData, active |
| 구성원명단 | staffId, department, name, position, active |
| 서명기록 | timestamp, eventId, eventTitle, department, name, position, signatureData, userAgent, staffId |

---

## 2. Google Apps Script 설정

1. [script.google.com](https://script.google.com) → 새 프로젝트
2. `Code.gs` 내용 붙여넣기
3. **프로젝트 설정 → 스크립트 속성** 추가:

| 속성 | 값 |
|------|-----|
| `SPREADSHEET_ID` | 위에서 복사한 ID |
| `ADMIN_PASSWORD` | 관리자 암호 (강한 비밀번호 권장) |

4. 함수 `setupSignOnSheets` 선택 후 **실행** (최초 시트·헤더 생성)
5. **배포 → 새 배포 → 웹 앱**
   - 실행: **나**
   - 액세스: **모든 사용자** (익명 교직원 접속용)
6. 배포 URL (`.../exec`) 복사

### CORS

프론트는 `fetch` + `POST` + `Content-Type: text/plain`으로 호출합니다.  
배포 후 교직원 페이지에서 연수 목록이 보이면 연동 성공입니다.

---

## 3. 프론트 설정

`school-config.js` 수정:

```javascript
window.SCHOOL_CONFIG = {
  schoolName: "OO고등학교",
  gasWebAppUrl: "https://script.google.com/macros/s/xxxxx/exec",
};
```

---

## 4. GitHub Pages 배포

1. GitHub 저장소 생성 후 이 폴더 파일 push
2. **Settings → Pages → Source**: `main` / `/ (root)`
3. 배포 URL 예: `https://username.github.io/signon/`

`index.html`이 루트에 있으면 바로 접속됩니다.

---

## API (action 기반)

요청 본문 (JSON):

```json
{
  "action": "getEvents",
  "payload": {},
  "adminToken": "관리자 전용 시 선택"
}
```

| action | 관리자 | 설명 |
|--------|:------:|------|
| `loginAdmin` | | 암호 검증 → token |
| `getEvents` | | 교직원용 진행중 연수 |
| `getAdminEvents` | ✓ | 전체 연수 |
| `createEvent` / `updateEvent` | ✓ | 연수 CRUD |
| `getStaffForEvent` | | 대상 구성원 |
| `getStaffList` | ✓ | 명단 |
| `uploadStaffCsv` | ✓ | CSV 일괄 등록 |
| `addStaff` / `updateStaff` / `deleteStaff` | ✓ | 구성원 |
| `checkSignature` | | 중복 제출 확인 |
| `submitSignature` | | 서명 제출·수정 |
| `getSignatureStatus` | ✓ | 서명/미서명 현황 |
| `getPrintableRegister` | ✓ | 등록부 출력 데이터 |

응답 형식:

```json
{ "ok": true, "data": { } }
{ "ok": false, "message": "오류 메시지" }
```

---

## 보안 요약

- 관리자 암호·Sheet ID → **Script Properties만**
- 관리자 토큰 → GAS `CacheService` (6시간)
- GitHub에 올려도 `school-config.js`는 URL만 포함

---

## CSV 형식 (구성원)

```csv
부서,이름,직위
교무,홍길동,교사
학생,김영희,교감
```

첫 줄이 `부서`/`department`이면 헤더로 건너뜁니다.

---

## 개인 연수 모드 (geo1234)

`school-config.js`에 `flowMode: "workshop"` 학교가 있으면, 교직원은 **학교명 → 성함 → 서명** 순으로 자유 입력합니다. 연수·구성원 사전 설정이 필요 없습니다.

### GAS 추가 설정

1. 스크립트 속성에 `SCHOOL_SUFFIXES`에 `지리연수` 추가  
   예: `이솔고,하길고,지리연수`
2. 관리자 암호 (GitHub에 올리지 마세요):

| 속성 | 값 |
|------|-----|
| `ADMIN_PASSWORD_지리연수` | 개인 연수 관리자 암호 |

3. GAS 편집기에서 한 번 실행:

```javascript
provisionSchoolSheets("지리연수");
```

4. `Code.gs` 수정 후 **웹 앱 새 버전 재배포**

### 접속 정보

| 구분 | 값 |
|------|-----|
| 교직원 학교 코드 | `geo1234` |
| 관리자 학교 코드 | `geo1234` |
| 관리자 암호 | Script Properties `ADMIN_PASSWORD_지리연수` |

관리자 화면에서는 **서명 현황·등록부 출력**만 표시됩니다. 학교명은 `00중학교` → `00중`, `OO고등학교` → `OO고` 형식으로 등록부에 저장됩니다.

---

## 라이선스

학교 내부 업무용으로 자유롭게 수정·배포하세요.
