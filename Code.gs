/**
 * 싸인온 Sign-On — Google Apps Script 백엔드
 *
 * Script Properties (프로젝트 설정 > 스크립트 속성):
 *   SPREADSHEET_ID     — Google 스프레드시트 ID (학교 공통 1개)
 *   ADMIN_PASSWORD     — 관리자 암호 (공통, 또는 학교별로 아래 키 사용)
 *   ADMIN_PASSWORD_이솔고 — (선택) 학교별 관리자 암호
 *   SCHOOL_SUFFIXES    — (선택) 허용 접미사 쉼표 구분: 이솔고,하길고
 *   SCHOOL_SUFFIX      — (선택·레거시) 요청에 schoolSuffix 없을 때만 사용
 *
 * 시트 이름: 연수목록(SUFFIX) | 구성원명단(SUFFIX) | 서명기록(SUFFIX)
 * 프론트는 매 요청마다 body.schoolSuffix 전달 (예: 이솔고, 하길고)
 */

const SHEET_BASE_EVENTS = "연수목록";
const SHEET_BASE_STAFF = "구성원명단";
const SHEET_BASE_SIGS = "서명기록";

function sheetNameFor_(base, schoolSuffix) {
  return base + "(" + schoolSuffix + ")";
}

function getSheetEvents_(schoolSuffix) {
  return sheetNameFor_(SHEET_BASE_EVENTS, schoolSuffix);
}

function getSheetStaff_(schoolSuffix) {
  return sheetNameFor_(SHEET_BASE_STAFF, schoolSuffix);
}

function getSheetSigs_(schoolSuffix) {
  return sheetNameFor_(SHEET_BASE_SIGS, schoolSuffix);
}

/** API 요청의 schoolSuffix (없으면 레거시 SCHOOL_SUFFIX 속성) */
function resolveSchoolSuffix_(body) {
  const fromBody = String((body && body.schoolSuffix) || "").trim();
  if (fromBody) {
    assertAllowedSchoolSuffix_(fromBody);
    return fromBody;
  }
  const legacy = PropertiesService.getScriptProperties().getProperty("SCHOOL_SUFFIX");
  if (legacy && String(legacy).trim()) {
    return String(legacy).trim();
  }
  throw new Error("schoolSuffix가 필요합니다. 학교 코드를 먼저 입력해 주세요.");
}

function assertAllowedSchoolSuffix_(suffix) {
  const raw = PropertiesService.getScriptProperties().getProperty("SCHOOL_SUFFIXES");
  if (!raw || !String(raw).trim()) return;
  const allowed = String(raw)
    .split(",")
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
  if (allowed.indexOf(suffix) < 0) {
    throw new Error("등록되지 않은 학교입니다: " + suffix);
  }
}

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

    const schoolSuffix = resolveSchoolSuffix_(body);
    ensureSheets_(schoolSuffix);

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
      requireAdmin_(adminToken, schoolSuffix);
    }

    let data;
    switch (action) {
      case "loginAdmin":
        data = loginAdmin_(payload, schoolSuffix);
        break;
      case "getEvents":
        data = getEvents_(false, schoolSuffix);
        break;
      case "getAdminEvents":
        data = getEvents_(true, schoolSuffix);
        break;
      case "createEvent":
        data = createEvent_(payload, schoolSuffix);
        break;
      case "updateEvent":
        data = updateEvent_(payload, schoolSuffix);
        break;
      case "deleteEvent":
        data = deleteEvent_(payload.eventId, schoolSuffix);
        break;
      case "getStaffForEvent":
        data = getStaffForEvent_(payload.eventId, schoolSuffix);
        break;
      case "getStaffForEvents":
        data = getStaffForEvents_(payload.eventIds, schoolSuffix);
        break;
      case "getStaffList":
        data = getStaffList_(payload.includeInactive, schoolSuffix);
        break;
      case "uploadStaffCsv":
        data = uploadStaffCsv_(payload, schoolSuffix);
        break;
      case "addStaff":
        data = saveStaff_(payload, false, schoolSuffix);
        break;
      case "updateStaff":
        data = saveStaff_(payload, true, schoolSuffix);
        break;
      case "deleteStaff":
        data = deleteStaff_(payload.staffId, schoolSuffix);
        break;
      case "checkSignature":
        data = checkSignature_(payload, schoolSuffix);
        break;
      case "checkSignaturesBulk":
        data = checkSignaturesBulk_(payload, schoolSuffix);
        break;
      case "submitSignature":
        data = submitSignature_(payload, schoolSuffix);
        break;
      case "submitSignaturesBulk":
        data = submitSignaturesBulk_(payload, schoolSuffix);
        break;
      case "getSignatureStatus":
        data = getSignatureStatus_(payload.eventId, schoolSuffix);
        break;
      case "getPrintableRegister":
        data = getPrintableRegister_(payload.eventId, schoolSuffix);
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

function ensureSheets_(schoolSuffix) {
  const ss = getSpreadsheet_();
  ensureSheet_(ss, getSheetEvents_(schoolSuffix), HEADERS.events);
  ensureSheet_(ss, getSheetStaff_(schoolSuffix), HEADERS.staff);
  ensureStaffColumns_(ss, schoolSuffix);
  ensureSheet_(ss, getSheetSigs_(schoolSuffix), HEADERS.sigs);
  return ss;
}

/** 기존 구성원명단 시트에 staffRank·remarks 열이 없으면 추가 */
function ensureStaffColumns_(ss, schoolSuffix) {
  const sh = ss.getSheetByName(getSheetStaff_(schoolSuffix));
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

function getAdminPasswordForSchool_(schoolSuffix) {
  const props = PropertiesService.getScriptProperties();
  const perSchool = props.getProperty("ADMIN_PASSWORD_" + schoolSuffix);
  if (perSchool) return perSchool;
  const common = props.getProperty("ADMIN_PASSWORD");
  if (!common) throw new Error("ADMIN_PASSWORD가 설정되지 않았습니다.");
  return common;
}

function adminCacheKey_(token, schoolSuffix) {
  return "admin_" + token + "_" + schoolSuffix;
}

function loginAdmin_(payload, schoolSuffix) {
  const expected = getAdminPasswordForSchool_(schoolSuffix);
  if (!payload.password || payload.password !== expected) {
    throw new Error("관리자 암호가 올바르지 않습니다.");
  }
  const token = Utilities.getUuid();
  const cache = CacheService.getScriptCache();
  cache.put(adminCacheKey_(token, schoolSuffix), "1", 21600); // 6시간
  return { token: token, schoolSuffix: schoolSuffix };
}

function requireAdmin_(token, schoolSuffix) {
  if (!token) throw new Error("관리자 로그인이 필요합니다.");
  const cache = CacheService.getScriptCache();
  if (!cache.get(adminCacheKey_(token, schoolSuffix))) {
    throw new Error("인증이 만료되었습니다. 다시 로그인해 주세요.");
  }
}

/* ───────────── 연수·회의 ───────────── */

function getEvents_(adminMode, schoolSuffix) {
  const rows = readSheetObjects_(getSheetEvents_(schoolSuffix));
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

function createEvent_(p, schoolSuffix) {
  const eventId = "ev_" + Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  const active = p.status === "진행중" ? "Y" : "Y";
  appendRow_(getSheetEvents_(schoolSuffix), {
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

function updateEvent_(p, schoolSuffix) {
  if (!p.eventId) throw new Error("eventId가 필요합니다.");
  const updated = updateRowById_(getSheetEvents_(schoolSuffix), "eventId", p.eventId, {
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

function deleteEvent_(eventId, schoolSuffix) {
  if (!eventId) throw new Error("eventId가 필요합니다.");
  if (!deleteRowById_(getSheetEvents_(schoolSuffix), "eventId", eventId)) {
    throw new Error("연수를 찾을 수 없습니다.");
  }
  deleteSignaturesByEventId_(eventId, schoolSuffix);
  return { deleted: true, eventId: eventId };
}

function deleteSignaturesByEventId_(eventId, schoolSuffix) {
  const sh = getSpreadsheet_().getSheetByName(getSheetSigs_(schoolSuffix));
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

function getEventById_(eventId, schoolSuffix) {
  const rows = readSheetObjects_(getSheetEvents_(schoolSuffix));
  const found = rows.find((r) => String(r.eventId) === String(eventId));
  return found ? normalizeEvent_(found) : null;
}

/* ───────────── 구성원 ───────────── */

function getStaffList_(includeInactive, schoolSuffix) {
  const rows = readSheetObjects_(getSheetStaff_(schoolSuffix));
  return rows
    .filter((r) => includeInactive || String(r.active || "Y").toUpperCase() === "Y")
    .map(normalizeStaff_);
}

function normalizeStaff_(r) {
  return {
    staffId: String(r.staffId || "").trim(),
    department: String(r.department || "").trim(),
    position: String(r.position || "").trim(),
    staffRank: String(r.staffRank || "").trim(),
    name: String(r.name || "").trim(),
    remarks: String(r.remarks || "").trim(),
    active: String(r.active || "Y").toUpperCase() === "Y" ? "Y" : "N",
  };
}

function getStaffForEvent_(eventId, schoolSuffix) {
  const ev = getEventById_(eventId, schoolSuffix);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  if (ev.status === "마감") {
    // 목록은 보이되 제출은 프론트/서버에서 차단
  }
  let staff = getStaffList_(false, schoolSuffix);
  const type = ev.targetType || "all";
  const data = (ev.targetData || "").trim();

  if (type === "departments" && data) {
    const deptSet = {};
    data.split(",").forEach(function (s) {
      const v = String(s || "").trim();
      if (v) deptSet[v] = true;
    });
    staff = staff.filter((s) => !!deptSet[String(s.department || "").trim()]);
  } else if (type === "members" && data) {
    const idSet = {};
    data.split(",").forEach(function (s) {
      const v = String(s || "").trim();
      if (v) idSet[v] = true;
    });
    staff = staff.filter((s) => !!idSet[String(s.staffId || "").trim()]);
  }
  return staff;
}

/** 선택한 모든 연수의 대상자 교집합 (일괄 서명용) */
function getStaffForEvents_(eventIds, schoolSuffix) {
  if (!eventIds || !eventIds.length) return [];
  let pool = null;
  eventIds.forEach(function (eid) {
    const staff = getStaffForEvent_(eid, schoolSuffix);
    if (pool === null) {
      pool = staff;
    } else {
      const idSet = {};
      staff.forEach(function (s) {
        idSet[String(s.staffId || "").trim()] = true;
      });
      pool = pool.filter(function (s) {
        return idSet[String(s.staffId || "").trim()];
      });
    }
  });
  return pool || [];
}

function saveStaff_(p, isUpdate, schoolSuffix) {
  if (isUpdate && p.staffId) {
    updateRowById_(getSheetStaff_(schoolSuffix), "staffId", p.staffId, {
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
  appendRow_(getSheetStaff_(schoolSuffix), {
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

function deleteStaff_(staffId, schoolSuffix) {
  if (!deleteRowById_(getSheetStaff_(schoolSuffix), "staffId", staffId)) {
    throw new Error("구성원을 찾을 수 없습니다.");
  }
  return { deleted: true };
}

function uploadStaffCsv_(payload, schoolSuffix) {
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
    const sh = getSpreadsheet_().getSheetByName(getSheetStaff_(schoolSuffix));
    if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  }

  newRows.forEach((r) => {
    saveStaff_(r, false, schoolSuffix);
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

function checkSignature_(payload, schoolSuffix) {
  const sigs = readSheetObjects_(getSheetSigs_(schoolSuffix));
  const exists = sigs.some(
    (s) =>
      String(s.eventId) === String(payload.eventId) &&
      (String(s.staffId) === String(payload.staffId) ||
        (String(s.department) === String(payload.department) && String(s.name) === String(payload.name)))
  );
  return { exists: exists };
}

function checkSignaturesBulk_(payload, schoolSuffix) {
  const eventIds = payload.eventIds || [];
  const existingEvents = [];
  eventIds.forEach(function (eid) {
    const check = checkSignature_(
      {
        eventId: eid,
        staffId: payload.staffId,
        department: payload.department,
        name: payload.name,
      },
      schoolSuffix
    );
    if (check.exists) {
      const ev = getEventById_(eid, schoolSuffix);
      existingEvents.push({
        eventId: eid,
        title: ev ? ev.title : String(eid),
      });
    }
  });
  return { exists: existingEvents.length > 0, existingEvents: existingEvents };
}

function submitSignaturesBulk_(payload, schoolSuffix) {
  const eventIds = payload.eventIds || [];
  if (!eventIds.length) throw new Error("연수를 하나 이상 선택해 주세요.");

  const results = [];
  let submitted = 0;
  eventIds.forEach(function (eid) {
    try {
      submitSignature_(
        {
          eventId: eid,
          staffId: payload.staffId,
          department: payload.department,
          name: payload.name,
          position: payload.position,
          signatureData: payload.signatureData,
          overwrite: payload.overwrite,
        },
        schoolSuffix
      );
      results.push({ eventId: eid, ok: true });
      submitted++;
    } catch (err) {
      results.push({ eventId: eid, ok: false, message: err.message || String(err) });
    }
  });

  const failed = results.filter(function (r) {
    return !r.ok;
  });
  if (submitted === 0) {
    throw new Error((failed[0] && failed[0].message) || "제출에 실패했습니다.");
  }
  return { submitted: submitted, total: eventIds.length, results: results };
}

function submitSignature_(payload, schoolSuffix) {
  const ev = getEventById_(payload.eventId, schoolSuffix);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  if (ev.status === "마감") throw new Error("마감된 연수에는 제출할 수 없습니다.");

  const payloadStaffId = String(payload.staffId || "").trim();
  const payloadDept = String(payload.department || "").trim();
  const payloadName = String(payload.name || "").trim();

  const targetStaff = getStaffForEvent_(payload.eventId, schoolSuffix);
  const allowed = targetStaff.some((s) => {
    const sid = String(s.staffId || "").trim();
    if (payloadStaffId && sid && sid === payloadStaffId) return true;
    return String(s.department || "").trim() === payloadDept && String(s.name || "").trim() === payloadName;
  });
  if (!allowed) throw new Error("이 연수의 대상자가 아닙니다.");

  const sigs = readSheetObjects_(getSheetSigs_(schoolSuffix));
  let existingIdx = -1;
  for (let i = 0; i < sigs.length; i++) {
    if (String(sigs[i].eventId) !== String(payload.eventId)) continue;
    const sigStaffId = String(sigs[i].staffId || "").trim();
    const byStaffId = payloadStaffId && sigStaffId && sigStaffId === payloadStaffId;
    const byDeptName =
      String(sigs[i].department || "").trim() === payloadDept &&
      String(sigs[i].name || "").trim() === payloadName;
    if (byStaffId || byDeptName) {
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
    staffId: payloadStaffId,
  };

  const sh = getSpreadsheet_().getSheetByName(getSheetSigs_(schoolSuffix));
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);

  if (existingIdx >= 0) {
    const sheetRow = existingIdx + 2;
    headers.forEach((h, col) => {
      if (row[h] !== undefined) sh.getRange(sheetRow, col + 1).setValue(row[h]);
    });
  } else {
    appendRow_(getSheetSigs_(schoolSuffix), row);
  }

  return { success: true };
}

function getSignatureStatus_(eventId, schoolSuffix) {
  const targets = getStaffForEvent_(eventId, schoolSuffix);
  const sigs = readSheetObjects_(getSheetSigs_(schoolSuffix)).filter((s) => String(s.eventId) === String(eventId));

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

function getPrintableRegister_(eventId, schoolSuffix) {
  const ev = getEventById_(eventId, schoolSuffix);
  if (!ev) throw new Error("연수를 찾을 수 없습니다.");
  const targets = getStaffForEvent_(eventId, schoolSuffix);
  const sigs = readSheetObjects_(getSheetSigs_(schoolSuffix)).filter((s) => String(s.eventId) === String(eventId));
  const sigByStaff = {};
  sigs.forEach((s) => {
    const sid = String(s.staffId || "").trim();
    const dept = String(s.department || "").trim();
    const name = String(s.name || "").trim();
    if (sid) sigByStaff[sid] = s;
    if (dept || name) sigByStaff[dept + "|" + name] = s;
  });

  const rows = targets.map((t) => {
    const sid = String(t.staffId || "").trim();
    const dept = String(t.department || "").trim();
    const name = String(t.name || "").trim();
    const rec = (sid ? sigByStaff[sid] : null) || sigByStaff[dept + "|" + name];
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
  const suffix = PropertiesService.getScriptProperties().getProperty("SCHOOL_SUFFIX") || "이솔고";
  const ss = ensureSheets_(String(suffix).trim());
  Logger.log("시트 준비 완료: " + ss.getName());
  Logger.log("탭 목록: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}

/**
 * 새 학교 탭 3개 생성
 * GAS 편집기에서 provisionSchoolSheets("하길고") 실행
 */
function provisionSchoolSheets(schoolSuffix) {
  const suffix = String(schoolSuffix || "").trim();
  if (!suffix) throw new Error("schoolSuffix 인자가 필요합니다. 예: provisionSchoolSheets(\"하길고\")");
  const ss = getSpreadsheet_();
  ensureSheet_(ss, getSheetEvents_(suffix), HEADERS.events);
  ensureSheet_(ss, getSheetStaff_(suffix), HEADERS.staff);
  ensureStaffColumns_(ss, suffix);
  ensureSheet_(ss, getSheetSigs_(suffix), HEADERS.sigs);
  Logger.log("[" + suffix + "] 탭 준비 완료");
  Logger.log(getSheetEvents_(suffix) + " | " + getSheetStaff_(suffix) + " | " + getSheetSigs_(suffix));
  Logger.log("전체 탭: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
}

/**
 * 탭이 안 생길 때 실행 — 원인을 실행 로그에 출력
 * GAS 왼쪽 시계 아이콘(실행) → 최근 실행 → 로그 확인
 */
function diagnoseSignOnSetup() {
  const props = PropertiesService.getScriptProperties();
  const rawId = props.getProperty("SPREADSHEET_ID");
  const suffix = props.getProperty("SCHOOL_SUFFIX");
  const hasPassword = !!props.getProperty("ADMIN_PASSWORD");

  Logger.log("=== 싸인온 설정 진단 ===");
  Logger.log("SPREADSHEET_ID 있음: " + (rawId ? "예" : "아니오 — 스크립트 속성을 추가하세요"));
  const suffixes = props.getProperty("SCHOOL_SUFFIXES");
  Logger.log("SCHOOL_SUFFIX (레거시): " + (suffix ? suffix : "없음"));
  Logger.log("SCHOOL_SUFFIXES: " + (suffixes ? suffixes : "없음 — 예: 이솔고,하길고"));
  Logger.log("ADMIN_PASSWORD 있음: " + (hasPassword ? "예" : "아니오"));
  if (suffix) {
    Logger.log(
      "레거시 탭 예: " + getSheetEvents_(suffix) + ", " + getSheetStaff_(suffix) + ", " + getSheetSigs_(suffix)
    );
  }
  if (!rawId) return;

  try {
    const ss = getSpreadsheet_();
    Logger.log("연결된 파일 이름: " + ss.getName());
    Logger.log("연결 전 탭: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
    if (suffix) ensureSheets_(suffix);
    Logger.log("연결 후 탭: " + ss.getSheets().map(function (s) { return s.getName(); }).join(", "));
    Logger.log("=== 성공: 브라우저에서 스프레드시트를 새로고침(F5) 하세요 ===");
  } catch (err) {
    Logger.log("=== 오류 ===");
    Logger.log(err.message || String(err));
    Logger.log("확인: ① ID가 1t5I_jHC... 형태인지 ② 시트 소유 계정으로 GAS 실행했는지 ③ 권한 허용했는지");
  }
}
