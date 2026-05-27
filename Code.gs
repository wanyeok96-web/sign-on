/**
 * 싸인온 Sign-On — Google Apps Script 백엔드
 *
 * Script Properties (프로젝트 설정 > 스크립트 속성):
 *   SPREADSHEET_ID  — Google 스프레드시트 ID
 *   ADMIN_PASSWORD  — 관리자 암호 (프론트엔드에 노출 금지)
 *
 * 시트 이름: 연수목록 | 구성원명단 | 서명기록
 */

const SHEET_EVENTS = "연수목록";
const SHEET_STAFF = "구성원명단";
const SHEET_SIGS = "서명기록";

const HEADERS = {
  events: ["eventId", "title", "date", "location", "description", "status", "targetType", "targetData", "active"],
  staff: ["staffId", "department", "position", "staffRank", "name", "remarks", "active"],
  sigs: ["timestamp", "eventId", "eventTitle", "department", "name", "position", "signatureData", "userAgent", "staffId"],
};

/** CORS — GitHub Pages 등 외부 도메인 허용 */
function doPost(e) {
  return handleRequest_(e);
}

function doGet(e) {
  return jsonResponse_({ ok: true, data: { service: "싸인온 Sign-On", version: "1.0" } });
}

function handleRequest_(e) {
  try {
    const body = e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
    const action = body.action;
    const payload = body.payload || {};
    const adminToken = body.adminToken || "";

    if (!action) {
      return jsonResponse_({ ok: false, message: "action이 필요합니다." });
    }

    ensureSheets_();

    const adminActions = [
      "loginAdmin",
      "getAdminEvents",
      "createEvent",
      "updateEvent",
      "deleteEvent",
      "getStaffList",
      "uploadStaffCsv",
      "addStaff",
      "updateStaff",
      "deleteStaff",
      "getSignatureStatus",
      "getPrintableRegister",
    ];

    if (adminActions.indexOf(action) >= 0 && action !== "loginAdmin") {
      requireAdmin_(adminToken);
    }

    let data;
    switch (action) {
      case "loginAdmin":
        data = loginAdmin_(payload);
        break;
      case "getEvents":
        data = getEvents_(false);
        break;
      case "getAdminEvents":
        data = getEvents_(true);
        break;
      case "createEvent":
        data = createEvent_(payload);
        break;
      case "updateEvent":
        data = updateEvent_(payload);
        break;
      case "deleteEvent":
        data = deleteEvent_(payload.eventId);
        break;
      case "getStaffForEvent":
        data = getStaffForEvent_(payload.eventId);
        break;
      case "getStaffList":
        data = getStaffList_(payload.includeInactive);
        break;
      case "uploadStaffCsv":
        data = uploadStaffCsv_(payload);
        break;
      case "addStaff":
        data = saveStaff_(payload, false);
        break;
      case "updateStaff":
        data = saveStaff_(payload, true);
        break;
      case "deleteStaff":
        data = deleteStaff_(payload.staffId);
        break;
      case "checkSignature":
        data = checkSignature_(payload);
        break;
      case "submitSignature":
        data = submitSignature_(payload);
        break;
      case "getSignatureStatus":
        data = getSignatureStatus_(payload.eventId);
        break;
      case "getPrintableRegister":
        data = getPrintableRegister_(payload.eventId);
        break;
      default:
        return jsonResponse_({ ok: false, message: "알 수 없는 action: " + action });
    }

    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    return jsonResponse_({ ok: false, message: err.message || String(err) });
  }
}

/* ───────────── 시트 초기화 ───────────── */

function getSpreadsheet_() {
  let id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("SPREADSHEET_ID가 설정되지 않았습니다. 스크립트 속성을 확인해 주세요.");
  id = String(id).trim();
  // URL 전체를 붙여넣은 경우 ID만 추출
  const urlMatch = id.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (urlMatch) id = urlMatch[1];
  return SpreadsheetApp.openById(id);
}

function ensureSheets_() {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, SHEET_EVENTS, HEADERS.events);
  ensureSheet_(ss, SHEET_STAFF, HEADERS.staff);
  ensureStaffColumns_(ss);
  ensureSheet_(ss, SHEET_SIGS, HEADERS.sigs);
  return ss;
}

/** 기존 구성원명단 시트에 staffRank·remarks 열이 없으면 추가 */
function ensureStaffColumns_(ss) {
  const sh = ss.getSheetByName(SHEET_STAFF);
  if (!sh || sh.getLastRow() === 0) return;
  let headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  function insertColumnBefore_(headerName, beforeHeader) {
    const idx = headers.indexOf(beforeHeader);
    if (idx < 0) return;
    sh.insertColumnBefore(idx + 1);
    sh.getRange(1, idx + 1).setValue(headerName);
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }

  if (headers.indexOf("staffRank") < 0) {
    if (headers.indexOf("name") >= 0) insertColumnBefore_("staffRank", "name");
    else sh.getRange(1, sh.getLastColumn() + 1).setValue("staffRank");
    headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  }

  if (headers.indexOf("remarks") < 0) {
    if (headers.indexOf("active") >= 0) insertColumnBefore_("remarks", "active");
    else sh.getRange(1, sh.getLastColumn() + 1).setValue("remarks");
  }
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(headers);
    sh.getRange(1, 1, 1, headers.length).setFontWeight("bold");
    return sh;
  }
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
  }
  return sh;
}

function readSheetObjects_(sheetName) {
  const sh = getSpreadsheet_().getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const rows = [];
  for (let i = 1; i < values.length; i++) {
    const obj = {};
    headers.forEach((h, j) => {
      obj[h] = values[i][j];
    });
    rows.push(obj);
  }
  return rows;
}

function appendRow_(sheetName, rowObj) {
  const sh = getSpreadsheet_().getSheetByName(sheetName);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  const row = headers.map((h) => (rowObj[h] !== undefined ? rowObj[h] : ""));
  sh.appendRow(row);
}

function updateRowById_(sheetName, idField, idValue, updates) {
  const sh = getSpreadsheet_().getSheetByName(sheetName);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf(idField);
  if (idCol < 0) throw new Error(idField + " 컬럼 없음");

  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idCol]) === String(idValue)) {
      Object.keys(updates).forEach((key) => {
        const col = headers.indexOf(key);
        if (col >= 0) data[i][col] = updates[key];
      });
      sh.getRange(i + 1, 1, 1, data[i].length).setValues([data[i]]);
      return true;
    }
  }
  return false;
}

function deleteRowById_(sheetName, idField, idValue) {
  const sh = getSpreadsheet_().getSheetByName(sheetName);
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const idCol = headers.indexOf(idField);
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][idCol]) === String(idValue)) {
      sh.deleteRow(i + 1);
      return true;
    }
  }
  return false;
}

/* ───────────── 관리자 인증 ───────────── */

function loginAdmin_(payload) {
  const expected = PropertiesService.getScriptProperties().getProperty("ADMIN_PASSWORD");
  if (!expected) throw new Error("ADMIN_PASSWORD가 설정되지 않았습니다.");
  if (!payload.password || payload.password !== expected) {
    throw new Error("관리자 암호가 올바르지 않습니다.");
  }
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put("admin_" + token, "1", 21600); // 6시간
  return { token: token };
}

function requireAdmin_(token) {
  if (!token) throw new Error("관리자 로그인이 필요합니다.");
  const cache = CacheService.getScriptCache();
  if (!cache.get("admin_" + token)) {
    throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
  }
}

/* ───────────── 연수·회의 ───────────── */

function getEvents_(adminMode) {
  const rows = readSheetObjects_(SHEET_EVENTS);
  return rows
    .filter((r) => {
      if (adminMode) return true;
      const status = String(r.status || "");
      const active = String(r.active || "Y").toUpperCase();
      return status === "진행중" && active !== "N";
    })
    .map(normalizeEvent_);
}

function normalizeEvent_(r) {
  return {
    eventId: String(r.eventId || ""),
    title: String(r.title || ""),
    date: formatDate_(r.date),
    location: String(r.location || ""),
    description: String(r.description || ""),
    status: String(r.status || "진행중"),
    targetType: String(r.targetType || "all"),
    targetData: String(r.targetData || ""),
    active: String(r.active || "Y"),
  };
}

function createEvent_(p) {
  const eventId = "ev_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  const active = p.status === "진행중" ? "Y" : "Y";
  appendRow_(SHEET_EVENTS, {
    eventId: eventId,
    title: p.title,
    date: p.date,
    location: p.location || "",
    description: p.description || "",
    status: p.status || "진행중",
    targetType: p.targetType || "all",
    targetData: p.targetData || "",
    active: active,
  });
  return { eventId: eventId };
}

function updateEvent_(p) {
  if (!p.eventId) throw new Error("eventId가 필요합니다.");
  const updated = updateRowById_(SHEET_EVENTS, "eventId", p.eventId, {
    title: p.title,
    date: p.date,
    location: p.location || "",
    description: p.description || "",
    status: p.status,
    targetType: p.targetType || "all",
    targetData: p.targetData || "",
    active: p.status === "보관" ? "N" : "Y",
  });
  if (!updated) throw new Error("연수를 찾을 수 없습니다.");
  return { eventId: p.eventId };
}

function deleteEvent_(eventId) {
  if (!eventId) throw new Error("eventId가 필요합니다.");
  if (!deleteRowById_(SHEET_EVENTS, "eventId", eventId)) {
    throw new Error("연수를 찾을 수 없습니다.");
  }
  deleteSignaturesByEventId_(eventId);
  return { deleted: true, eventId: eventId };
}

function deleteSignaturesByEventId_(eventId) {
  const sh = getSpreadsheet_().getSheetByName(SHEET_SIGS);
  if (!sh || sh.getLastRow() < 2) return;
  const data = sh.getDataRange().getValues();
  const headers = data[0].map(String);
  const eventCol = headers.indexOf("eventId");
  if (eventCol < 0) return;
  for (let i = data.length - 1; i >= 1; i--) {
    if (String(data[i][eventCol]) === String(eventId)) {
      sh.deleteRow(i + 1);
    }
  }
}

function getEventById_(eventId) {
  const rows = readSheetObjects_(SHEET_EVENTS);
  const found = rows.find((r) => String(r.eventId) === String(eventId));
  return found ? normalizeEvent_(found) : null;
}

/* ───────────── 구성원 ───────────── */

function getStaffList_(includeInactive) {
  const rows = readSheetObjects_(SHEET_STAFF);
  return rows
    .filter((r) => includeInactive || String(r.active || "Y").toUpperCase() === "Y")
    .map(normalizeStaff_);
}

function normalizeStaff_(r) {
  return {
    staffId: String(r.staffId || ""),
    department: String(r.department || ""),
    position: String(r.position || ""),
    staffRank: String(r.staffRank || ""),
    name: String(r.name || ""),
    remarks: String(r.remarks || ""),
    active: String(r.active || "Y").toUpperCase() === "Y" ? "Y" : "N",
  };
}

function getStaffForEvent_(eventId) {
  const ev = getEventById_(eventId);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  if (ev.status === "마감") {
    // 목록은 보이되 제출은 프론트/서버에서 차단
  }
  let staff = getStaffList_(false);
  const type = ev.targetType || "all";
  const data = (ev.targetData || "").trim();

  if (type === "departments" && data) {
    const depts = data.split(",").map((s) => s.trim());
    staff = staff.filter((s) => depts.indexOf(s.department) >= 0);
  } else if (type === "members" && data) {
    const ids = data.split(",").map((s) => s.trim());
    staff = staff.filter((s) => ids.indexOf(s.staffId) >= 0);
  }
  return staff;
}

function saveStaff_(p, isUpdate) {
  if (isUpdate && p.staffId) {
    updateRowById_(SHEET_STAFF, "staffId", p.staffId, {
      department: p.department,
      position: p.position || "",
      staffRank: p.staffRank || "",
      name: p.name,
      remarks: p.remarks || "",
      active: p.active || "Y",
    });
    return { staffId: p.staffId };
  }
  const staffId = "st_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  appendRow_(SHEET_STAFF, {
    staffId: staffId,
    department: p.department,
    position: p.position || "",
    staffRank: p.staffRank || "",
    name: p.name,
    remarks: p.remarks || "",
    active: p.active || "Y",
  });
  return { staffId: staffId };
}

function deleteStaff_(staffId) {
  if (!deleteRowById_(SHEET_STAFF, "staffId", staffId)) {
    throw new Error("구성원을 찾을 수 없습니다.");
  }
  return { deleted: true };
}

function uploadStaffCsv_(payload) {
  const lines = (payload.csvText || "").split(/\r?\n/).filter((l) => l.trim());
  const errors = [];
  const newRows = [];

  lines.forEach((line, idx) => {
    const cols = parseCsvLine_(line);
    if (idx === 0 && isHeaderRow_(cols)) return;
    if (cols.length < 4) {
      errors.push({ line: idx + 1, message: "열이 부족합니다 (부서, 직위, 담당업무, 성함 필수)" });
      return;
    }
    const department = cols[0].trim();
    const position = cols[1].trim();
    const staffRank = cols[2].trim();
    const name = cols[3].trim();
    const remarks = (cols[4] || "").trim();
    if (!department || !name) {
      errors.push({ line: idx + 1, message: "부서·성함 누락" });
      return;
    }
    newRows.push({
      department: department,
      position: position,
      staffRank: staffRank,
      name: name,
      remarks: remarks,
      active: "Y",
    });
  });

  if (newRows.length === 0 && errors.length > 0) {
    throw new Error("유효한 데이터가 없습니다. " + errors[0].message);
  }

  if (payload.overwrite) {
    const sh = getSpreadsheet_().getSheetByName(SHEET_STAFF);
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  }

  newRows.forEach((r) => {
    saveStaff_(r, false);
  });

  return { added: newRows.length, errors: errors };
}

function parseCsvLine_(line) {
  const result = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') inQuote = !inQuote;
    else if ((c === "," && !inQuote)) {
      result.push(cur);
      cur = "";
    } else cur += c;
  }
  result.push(cur);
  return result;
}

function isHeaderRow_(cols) {
  const h = cols.join("").toLowerCase();
  return (
    h.indexOf("부서") >= 0 ||
    h.indexOf("department") >= 0 ||
    h.indexOf("성함") >= 0 ||
    h.indexOf("이름") >= 0 ||
    h.indexOf("직위") >= 0 ||
    h.indexOf("비고") >= 0 ||
    h.indexOf("직급") >= 0 ||
    h.indexOf("담당업무") >= 0 ||
    h.indexOf("staffrank") >= 0
  );
}

/* ───────────── 서명 ───────────── */

function checkSignature_(payload) {
  const sigs = readSheetObjects_(SHEET_SIGS);
  const exists = sigs.some(
    (s) =>
      String(s.eventId) === String(payload.eventId) &&
      (String(s.staffId) === String(payload.staffId) ||
        (String(s.department) === String(payload.department) && String(s.name) === String(payload.name)))
  );
  return { exists: exists };
}

function submitSignature_(payload) {
  const ev = getEventById_(payload.eventId);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  if (ev.status === "마감") throw new Error("마감된 연수에는 제출할 수 없습니다.");

  const targetStaff = getStaffForEvent_(payload.eventId);
  const allowed = targetStaff.some((s) => String(s.staffId) === String(payload.staffId));
  if (!allowed) throw new Error("이 연수의 대상자가 아닙니다.");

  const sigs = readSheetObjects_(SHEET_SIGS);
  let existingIdx = -1;
  for (let i = 0; i < sigs.length; i++) {
    if (
      String(sigs[i].eventId) === String(payload.eventId) &&
      String(sigs[i].staffId || "") === String(payload.staffId)
    ) {
      existingIdx = i;
      break;
    }
  }

  if (existingIdx >= 0 && !payload.overwrite) {
    throw new Error("이미 제출한 기록이 있습니다.");
  }

  const row = {
    timestamp: Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd HH:mm:ss"),
    eventId: payload.eventId,
    eventTitle: ev.title,
    department: payload.department,
    name: payload.name,
    position: payload.position || "",
    signatureData: payload.signatureData,
    userAgent: "",
    staffId: payload.staffId,
  };

  const sh = getSpreadsheet_().getSheetByName(SHEET_SIGS);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  if (existingIdx >= 0) {
    const sheetRow = existingIdx + 2;
    headers.forEach((h, col) => {
      if (row[h] !== undefined) sh.getRange(sheetRow, col + 1).setValue(row[h]);
    });
  } else {
    appendRow_(SHEET_SIGS, row);
  }

  return { success: true };
}

function getSignatureStatus_(eventId) {
  const targets = getStaffForEvent_(eventId);
  const sigs = readSheetObjects_(SHEET_SIGS).filter((s) => String(s.eventId) === String(eventId));

  const signedMap = {};
  sigs.forEach((s) => {
    const key = String(s.staffId || s.department + "|" + s.name);
    signedMap[key] = s;
  });

  const signed = [];
  const unsigned = [];

  targets.forEach((t) => {
    const key = String(t.staffId);
    const altKey = t.department + "|" + t.name;
    const rec = signedMap[key] || signedMap[altKey];
    if (rec) {
      signed.push({
        department: rec.department,
        name: rec.name,
        timestamp: String(rec.timestamp || ""),
        signatureData: String(rec.signatureData || ""),
      });
    } else {
      unsigned.push({
        department: t.department,
        name: t.name,
        position: t.position,
      });
    }
  });

  return {
    total: targets.length,
    signedCount: signed.length,
    unsignedCount: unsigned.length,
    signed: signed,
    unsigned: unsigned,
  };
}

function getPrintableRegister_(eventId) {
  const ev = getEventById_(eventId);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  const targets = getStaffForEvent_(eventId);
  const sigs = readSheetObjects_(SHEET_SIGS).filter((s) => String(s.eventId) === String(eventId));
  const sigByStaff = {};
  sigs.forEach((s) => {
    sigByStaff[String(s.staffId || "")] = s;
    sigByStaff[s.department + "|" + s.name] = s;
  });

  const rows = targets.map((t) => {
    const rec = sigByStaff[String(t.staffId)] || sigByStaff[t.department + "|" + t.name];
    return {
      department: t.department,
      name: t.name,
      position: t.position,
      staffRank: t.staffRank || "",
      remarks: t.remarks || "",
      signatureData: rec ? String(rec.signatureData || "") : "",
      timestamp: rec ? String(rec.timestamp || "") : "",
    };
  });

  return {
    title: ev.title,
    date: ev.date,
    location: ev.location,
    description: ev.description,
    rows: rows,
  };
}

/* ───────────── 유틸 ───────────── */

function formatDate_(val) {
  if (!val) return "";
  if (val instanceof Date) {
    return Utilities.formatDate(val, "Asia/Seoul", "yyyy-MM-dd");
  }
  return String(val).slice(0, 10);
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/**
 * 최초 1회 실행: 스프레드시트 연결 및 시트 생성
 * Apps Script 편집기에서 setupSignOnSheets 실행
 */
function setupSignOnSheets() {
  const ss = ensureSheets_();
  Logger.log("시트 준비 완료: " + ss.getName());
  Logger.log("탭 목록: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}

/**
 * 탭이 안 생길 때 실행 — 원인을 실행 로그에 출력
 * GAS 왼쪽 시계 아이콘(실행) → 최근 실행 → 로그 확인
 */
function diagnoseSignOnSetup() {
  const props = PropertiesService.getScriptProperties();
  const rawId = props.getProperty("SPREADSHEET_ID");
  const hasPassword = !!props.getProperty("ADMIN_PASSWORD");

  Logger.log("=== 싸인온 설정 진단 ===");
  Logger.log("SPREADSHEET_ID 있음: " + (rawId ? "예" : "아니오 — 스크립트 속성을 추가하세요"));
  Logger.log("ADMIN_PASSWORD 있음: " + (hasPassword ? "예" : "아니오"));
  if (!rawId) return;

  try {
    const ss = getSpreadsheet_();
    Logger.log("연결된 파일 이름: " + ss.getName());
    Logger.log("연결 전 탭: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
    ensureSheets_();
    Logger.log("연결 후 탭: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
    Logger.log("=== 성공: 브라우저에서 스프레드시트를 새로고침(F5) 하세요 ===");
  } catch (err) {
    Logger.log("=== 오류 ===");
    Logger.log(err.message || String(err));
    Logger.log("확인: ① ID가 1t5I_jHC... 형태인지 ② 시트 소유 계정으로 GAS 실행했는지 ③ 권한 허용했는지");
  }
}
