/**
 * 싸인온 Sign-On — 프론트엔드
 * 민감 정보 없음 · Apps Script action API 통신
 */
(function () {
  "use strict";

  const CONFIG = window.SCHOOL_CONFIG || {};
  const STORAGE_KEY = "signon_admin_token";
  const SCHOOL_STORAGE_KEY = "signon_school_id";

  /* ─────────────────────────────────────────
   * API 클라이언트
   * ───────────────────────────────────────── */
  const AppConfig = {
    get schools() {
      return Array.isArray(CONFIG.schools) ? CONFIG.schools : [];
    },

    hasSchoolGate() {
      return AppConfig.schools.length > 0;
    },

    get activeSchoolId() {
      return sessionStorage.getItem(SCHOOL_STORAGE_KEY) || "";
    },

    setActiveSchoolId(id) {
      if (id) sessionStorage.setItem(SCHOOL_STORAGE_KEY, id);
      else sessionStorage.removeItem(SCHOOL_STORAGE_KEY);
    },

    getSchoolById(id) {
      return AppConfig.schools.find((s) => String(s.id) === String(id)) || null;
    },

    getActiveSchool() {
      // 1) session 선택
      const fromSession = AppConfig.getSchoolById(AppConfig.activeSchoolId);
      if (fromSession) return fromSession;
      // 2) config 기본값
      const fallback = AppConfig.getSchoolById(CONFIG.defaultSchoolId);
      if (fallback) return fallback;
      // 3) 첫 학교
      return AppConfig.schools[0] || null;
    },

    setSchoolByPassword(password) {
      const pw = String(password || "").trim();
      if (!pw) return null;
      const school =
        AppConfig.schools.find((s) => String(s.password || "") === pw) ||
        AppConfig.schools.find((s) => String(s.password || "").toLowerCase() === pw.toLowerCase()) ||
        null;
      if (!school) return null;
      AppConfig.setActiveSchoolId(school.id);
      return school;
    },

    getBaseUrl() {
      const shared = String(CONFIG.gasWebAppUrl || "").trim();
      if (shared && !shared.includes("YOUR_GAS")) return shared;
      const active = AppConfig.getActiveSchool();
      const url = (active && active.gasWebAppUrl) || "";
      return String(url).trim();
    },

    /** API 요청에 실을 sheetSuffix (학교 비밀번호 선택 후) */
    getSchoolSuffixForApi() {
      if (AppConfig.hasSchoolGate()) {
        const school = AppConfig.getSchoolById(AppConfig.activeSchoolId);
        if (!school || !school.sheetSuffix) {
          throw new Error("학교 코드를 먼저 입력해 주세요.");
        }
        return school.sheetSuffix;
      }
      const school = AppConfig.getActiveSchool();
      if (school && school.sheetSuffix) return school.sheetSuffix;
      throw new Error("school-config.js에 학교 sheetSuffix가 필요합니다.");
    },

    /** 히어로에 표시할 학교 (비밀번호로 선택된 경우만) */
    getSelectedSchoolForDisplay() {
      if (AppConfig.hasSchoolGate()) {
        if (!AppConfig.activeSchoolId) return null;
        return AppConfig.getSchoolById(AppConfig.activeSchoolId);
      }
      return AppConfig.getActiveSchool();
    },

    updateHeroCurrentSchool() {
      const wrap = document.getElementById("heroCurrentSchool");
      const nameEl = document.getElementById("heroCurrentSchoolName");
      if (!wrap || !nameEl) return;

      const school = AppConfig.getSelectedSchoolForDisplay();
      if (!school || !school.label) {
        wrap.hidden = true;
        nameEl.textContent = "";
        return;
      }

      nameEl.textContent =
        school.flowMode === "workshop"
          ? school.displayTitle || school.label
          : `🎓 ${school.label}`;
      wrap.hidden = false;
    },

    applyFlowModeUi() {
      const workshop = AppConfig.isWorkshopMode();
      document.body.classList.toggle("mode-workshop", workshop);

      const badge = document.getElementById("heroModeBadge");
      const ledeMain = document.getElementById("heroLedeMain");
      const ledeSub = document.getElementById("heroLedeSub");
      if (badge) badge.hidden = !workshop;
      if (ledeMain) {
        ledeMain.textContent = workshop
          ? "연수 참가 확인을 위해 학교명 · 성함 · 서명 순서로 진행해 주세요."
          : "온라인에서 간편하게, 연수 등록부에 서명하세요.";
      }
      if (ledeSub) {
        ledeSub.textContent = workshop
          ? "개인 연수용 서명 등록부입니다."
          : "배움이 넘치는 연수가 되길 응원합니다!";
      }

      AppConfig.updateHeroCurrentSchool();
    },

    isWorkshopMode(school) {
      const s = school || AppConfig.getSchoolById(AppConfig.activeSchoolId);
      return !!(s && s.flowMode === "workshop");
    },
  };

  const Api = {
    get baseUrl() {
      const url = AppConfig.getBaseUrl();
      if (!url || url.includes("YOUR_GAS")) {
        throw new Error("school-config.js에 Apps Script 웹 앱 URL을 설정해 주세요.");
      }
      return url;
    },

    getAdminToken() {
      return sessionStorage.getItem(STORAGE_KEY) || "";
    },

    setAdminToken(token) {
      if (token) sessionStorage.setItem(STORAGE_KEY, token);
      else sessionStorage.removeItem(STORAGE_KEY);
    },

    /**
     * @param {string} action
     * @param {object} [payload]
     * @param {boolean} [requireAdmin]
     */
    async call(action, payload = {}, requireAdmin = false) {
      const body = {
        action,
        payload,
        schoolSuffix: AppConfig.getSchoolSuffixForApi(),
      };
      if (requireAdmin) {
        body.adminToken = Api.getAdminToken();
      }

      const res = await fetch(Api.baseUrl, {
        method: "POST",
        mode: "cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(body),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        throw new Error("서버 응답을 읽을 수 없습니다. Apps Script 배포 설정을 확인해 주세요.");
      }

      if (!data.ok) {
        throw new Error(data.message || "요청 처리 중 오류가 발생했습니다.");
      }
      return data.data;
    },
  };

  /* ─────────────────────────────────────────
   * UI 유틸
   * ───────────────────────────────────────── */
  const UI = {
    overlay: document.getElementById("loadingOverlay"),
    overlayText: document.getElementById("loadingText"),
    toast: document.getElementById("globalToast"),
    _loadingCount: 0,

    showLoading(msg = "불러오는 중…") {
      UI._loadingCount++;
      if (UI.overlayText) UI.overlayText.textContent = msg;
      if (UI.overlay) UI.overlay.hidden = false;
    },

    hideLoading() {
      UI._loadingCount = Math.max(0, UI._loadingCount - 1);
      if (UI._loadingCount === 0 && UI.overlay) UI.overlay.hidden = true;
    },

    async withLoading(fn, msg) {
      UI.showLoading(msg);
      try {
        return await fn();
      } finally {
        UI.hideLoading();
      }
    },

    toastMsg(text, isError = false) {
      if (!UI.toast) return;
      UI.toast.textContent = text;
      UI.toast.classList.toggle("is-error", isError);
      UI.toast.classList.add("is-show");
      clearTimeout(UI._toastTimer);
      UI._toastTimer = setTimeout(() => UI.toast.classList.remove("is-show"), 2800);
    },

    setMessage(el, text, isError = false) {
      if (!el) return;
      el.textContent = text || "";
      el.classList.toggle("is-error", !!isError);
    },

    openModal(id) {
      const el = document.getElementById(id);
      if (el) el.hidden = false;
    },

    closeModal(id) {
      const el = document.getElementById(id);
      if (el) el.hidden = true;
    },

    setButtonLoading(btn, loading, label) {
      if (!btn) return;
      const spinner = btn.querySelector(".btn-spinner");
      const icon = btn.querySelector(".btn-primary__icon");
      const labelEl = btn.querySelector(".btn-label");
      if (loading) {
        if (!btn.dataset.prevLabel && labelEl) {
          btn.dataset.prevLabel = labelEl.textContent;
        }
        btn.classList.add("is-loading");
        btn.disabled = true;
        btn.setAttribute("aria-busy", "true");
        if (spinner) spinner.hidden = false;
        if (icon) icon.hidden = true;
        if (label && labelEl) labelEl.textContent = label;
      } else {
        btn.classList.remove("is-loading");
        btn.removeAttribute("aria-busy");
        if (spinner) spinner.hidden = true;
        if (icon) icon.hidden = false;
        if (labelEl && btn.dataset.prevLabel) {
          labelEl.textContent = btn.dataset.prevLabel;
          delete btn.dataset.prevLabel;
        }
      }
    },
  };

  /* ─────────────────────────────────────────
   * 서명 패드 (Canvas)
   * ───────────────────────────────────────── */
  const SignaturePad = {
    canvas: null,
    ctx: null,
    drawing: false,
    hasStroke: false,
    _initialized: false,

    ensureReady() {
      const canvas = document.getElementById("signatureCanvas");
      if (!canvas) return;
      const card = document.getElementById("staffStep5");
      if (!card || card.hidden) return;

      if (!SignaturePad._initialized) {
        SignaturePad.init(canvas);
        SignaturePad._initialized = true;
      }

      canvas.style.pointerEvents = "auto";
      const clearBtn = document.getElementById("btnClearSignature");
      if (clearBtn) clearBtn.style.pointerEvents = "auto";

      requestAnimationFrame(() => {
        requestAnimationFrame(() => SignaturePad.resize());
      });
    },

    init(canvasEl) {
      SignaturePad.canvas = canvasEl;
      SignaturePad.ctx = canvasEl.getContext("2d");
      SignaturePad.resize();
      window.addEventListener("resize", () => SignaturePad.resize());

      const start = (e) => {
        e.preventDefault();
        SignaturePad.drawing = true;
        SignaturePad.hasStroke = true;
        StaffApp.afterSignatureChange();
        const p = SignaturePad.point(e);
        SignaturePad.ctx.beginPath();
        SignaturePad.ctx.moveTo(p.x, p.y);
      };

      const move = (e) => {
        if (!SignaturePad.drawing) return;
        e.preventDefault();
        const p = SignaturePad.point(e);
        SignaturePad.ctx.lineTo(p.x, p.y);
        SignaturePad.ctx.stroke();
        StaffApp.afterSignatureChange();
      };

      const end = () => {
        SignaturePad.drawing = false;
        StaffApp.afterSignatureChange();
      };

      canvasEl.addEventListener("mousedown", start);
      canvasEl.addEventListener("mousemove", move);
      canvasEl.addEventListener("mouseup", end);
      canvasEl.addEventListener("mouseleave", end);
      canvasEl.addEventListener("touchstart", start, { passive: false });
      canvasEl.addEventListener("touchmove", move, { passive: false });
      canvasEl.addEventListener("touchend", end);
      canvasEl.addEventListener("touchcancel", end);
    },

    fillCanvasBackground() {
      const c = SignaturePad.canvas;
      const ctx = SignaturePad.ctx;
      if (!c || !ctx) return;
      const rect = c.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
    },

    resize() {
      const c = SignaturePad.canvas;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      const ratio = window.devicePixelRatio || 1;
      const hadStroke = SignaturePad.hasStroke;
      const snapshot = hadStroke ? c.toDataURL("image/png") : "";
      c.width = rect.width * ratio;
      c.height = rect.height * ratio;
      SignaturePad.fillCanvasBackground();
      if (hadStroke && snapshot) {
        const img = new Image();
        img.onload = function () {
          const ctx = SignaturePad.ctx;
          if (!ctx) return;
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          SignaturePad.hasStroke = true;
          StaffApp.validateSubmitButton();
        };
        img.src = snapshot;
      } else {
        SignaturePad.hasStroke = false;
      }
    },

    point(e) {
      const c = SignaturePad.canvas;
      const rect = c.getBoundingClientRect();
      const t = e.touches ? e.touches[0] : e;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    },

    clear() {
      const c = SignaturePad.canvas;
      if (!c || !SignaturePad.ctx) return;
      const rect = c.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      const ctx = SignaturePad.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      SignaturePad.hasStroke = false;
      StaffApp.afterSignatureChange();
    },

    isEmpty() {
      return !SignaturePad.hasStroke;
    },

    toDataUrl() {
      return SignaturePad.canvas ? SignaturePad.canvas.toDataURL("image/png") : "";
    },
  };

  /* ─────────────────────────────────────────
   * 교직원 페이지
   * ───────────────────────────────────────── */
  const StaffApp = {
    events: [],
    staffPool: [],
    selectedStaff: null,
    state: {
      selectedDate: "",
      eventIds: [],
      department: "",
      staffId: "",
      staffKey: "",
      name: "",
      position: "",
    },

    STAFF_STEP_IDS: ["staffStep1", "staffStep2", "staffStep3", "staffStep4", "staffStep5"],
    WORKSHOP_STEP_IDS: ["staffWsStep1", "staffWsStep2", "staffStep5"],
    workshopEventId: "",
    _lastVisibleStaffStep: 0,
    /** 학교 코드 확인 후 true — 확인 전에는 스텝 카드 전부 숨김 */
    _schoolFlowStarted: false,

    init() {
      document.getElementById("btnClearSignature")?.addEventListener("click", () => SignaturePad.clear());

      document.getElementById("staffDateSelect")?.addEventListener("change", StaffApp.onDateChange);
      document.getElementById("staffEventChecklist")?.addEventListener("change", StaffApp.onEventChecklistChange);
      document.getElementById("btnStaffSelectAllEvents")?.addEventListener("click", StaffApp.toggleSelectAllEvents);
      document.getElementById("staffDeptSelect")?.addEventListener("change", StaffApp.onDeptChange);
      document.getElementById("staffNameSelect")?.addEventListener("change", StaffApp.onNameChange);
      document.getElementById("btnStaffSubmit")?.addEventListener("click", StaffApp.onSubmitClick);
      document.getElementById("btnStaffAnother")?.addEventListener("click", () =>
        StaffApp.resetFlow({ keepDate: true })
      );

      document.getElementById("btnConfirmCancel")?.addEventListener("click", () => UI.closeModal("confirmModal"));
      document.getElementById("btnConfirmSubmit")?.addEventListener("click", StaffApp.doSubmit);
      document.getElementById("btnOverwriteCancel")?.addEventListener("click", () => UI.closeModal("overwriteModal"));
      document.getElementById("btnOverwriteOk")?.addEventListener("click", () => {
        UI.closeModal("overwriteModal");
        StaffApp.doSubmit(true);
      });

      document.getElementById("staffFreeSchool")?.addEventListener("input", StaffApp.onWorkshopInput);
      document.getElementById("staffFreeName")?.addEventListener("input", StaffApp.onWorkshopInput);

      StaffApp._schoolFlowStarted = false;
      if (AppConfig.hasSchoolGate()) {
        AppConfig.setActiveSchoolId("");
      }
      StaffApp.applySchoolGateState();
      AppConfig.applyFlowModeUi();
    },

    applySchoolGateState() {
      const gateCard = document.getElementById("staffSchoolGate");
      const msgEl = document.getElementById("staffSchoolMessage");
      const dateSel = document.getElementById("staffDateSelect");

      if (!AppConfig.hasSchoolGate()) {
        if (gateCard) gateCard.hidden = true;
        StaffApp._schoolFlowStarted = true;
        StaffApp.setStaffStepsLocked(false);
        StaffApp.loadEvents();
        return;
      }

      // 학교 코드 확인 전: 학교 선택 카드만 표시
      if (!StaffApp._schoolFlowStarted) {
        if (gateCard) gateCard.hidden = false;
        StaffApp.hideAllStaffSteps();
        UI.setMessage(msgEl, "");
        if (dateSel) {
          dateSel.innerHTML = '<option value="">학교 코드를 먼저 입력해 주세요</option>';
          dateSel.disabled = true;
        }
        StaffApp.renderEventChecklist([]);
        return;
      }

      if (gateCard) gateCard.hidden = true;
      StaffApp.setStaffStepsLocked(false);
      UI.setMessage(msgEl, "");
      if (AppConfig.isWorkshopMode()) {
        StaffApp.initWorkshopFlow();
      } else {
        StaffApp.loadEvents();
      }
    },

    getAllStaffStepElementIds() {
      return [
        "staffStep1",
        "staffStep2",
        "staffStep3",
        "staffStep4",
        "staffWsStep1",
        "staffWsStep2",
        "staffStep5",
      ];
    },

    hideAllStaffSteps() {
      StaffApp.getAllStaffStepElementIds().forEach((id) => {
        const card = document.getElementById(id);
        if (!card) return;
        card.hidden = true;
        card.classList.remove("is-active", "is-complete", "is-step-enter");
        card.querySelector(".step-badge")?.classList.remove("is-complete");
      });
    },

    setStaffStepsLocked(locked) {
      const flowBlocked = AppConfig.hasSchoolGate() && !StaffApp._schoolFlowStarted;
      const inputsLocked = locked || flowBlocked;

      if (locked || flowBlocked) {
        StaffApp.hideAllStaffSteps();
      } else {
        StaffApp._lastVisibleStaffStep = 0;
        StaffApp.refreshStaffSteps();
      }

      // 입력/버튼들도 잠금 (사용자 조작 방지)
      const dateSel = document.getElementById("staffDateSelect");
      const checklist = document.getElementById("staffEventChecklist");
      const selectAllBtn = document.getElementById("btnStaffSelectAllEvents");
      const deptSel = document.getElementById("staffDeptSelect");
      const nameSel = document.getElementById("staffNameSelect");
      const freeSchool = document.getElementById("staffFreeSchool");
      const freeName = document.getElementById("staffFreeName");
      const submitBtn = document.getElementById("btnStaffSubmit");
      if (dateSel) dateSel.disabled = inputsLocked;
      if (checklist) {
        checklist.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
          cb.disabled = inputsLocked;
        });
      }
      if (selectAllBtn) selectAllBtn.disabled = inputsLocked;
      if (deptSel) deptSel.disabled = inputsLocked;
      if (nameSel) nameSel.disabled = inputsLocked;
      if (freeSchool) freeSchool.disabled = inputsLocked;
      if (freeName) freeName.disabled = inputsLocked;
      if (submitBtn) submitBtn.disabled = true;

      const canvas = document.getElementById("signatureCanvas");
      const clearBtn = document.getElementById("btnClearSignature");
      if (canvas) canvas.style.pointerEvents = inputsLocked ? "none" : "";
      if (clearBtn) clearBtn.style.pointerEvents = inputsLocked ? "none" : "";

      if (!inputsLocked) {
        requestAnimationFrame(() => SignaturePad.ensureReady());
      }
    },

    resetStaffFormState() {
      StaffApp.state = {
        selectedDate: "",
        eventIds: [],
        department: "",
        staffId: "",
        staffKey: "",
        name: "",
        position: "",
      };
      StaffApp._lastVisibleStaffStep = 0;
      SignaturePad.clear();
      UI.closeModal("staffSuccessModal");
      UI.closeModal("confirmModal");
      UI.closeModal("overwriteModal");
      StaffApp.resetDeptName();

      const dateSel = document.getElementById("staffDateSelect");
      if (dateSel) dateSel.value = "";
      StaffApp.renderEventChecklist([]);

      const eventHint = document.getElementById("staffEventHint");
      if (eventHint) eventHint.textContent = "";

      const freeSchool = document.getElementById("staffFreeSchool");
      const freeName = document.getElementById("staffFreeName");
      if (freeSchool) freeSchool.value = "";
      if (freeName) freeName.value = "";
      const schoolHint = document.getElementById("staffFreeSchoolHint");
      if (schoolHint) schoolHint.textContent = "";
      StaffApp.workshopEventId = "";
    },

    async initWorkshopFlow() {
      const info = await UI.withLoading(() => Api.call("getWorkshopInfo"), "연수 정보 불러오는 중…");
      StaffApp.workshopEventId = info.eventId;
      StaffApp.state.eventIds = [info.eventId];
      StaffApp.refreshStaffSteps();
    },

    onWorkshopInput() {
      StaffApp.syncWorkshopState();
      StaffApp.refreshStaffSteps();
      StaffApp.validateSubmitButton();
    },

    syncWorkshopState() {
      const schoolRaw = document.getElementById("staffFreeSchool")?.value || "";
      const schoolNorm = normalizeSchoolName(schoolRaw);
      const name = String(document.getElementById("staffFreeName")?.value || "").trim();
      const hint = document.getElementById("staffFreeSchoolHint");

      if (hint) {
        const compact = schoolRaw.trim().replace(/\s+/g, "");
        if (schoolNorm && compact && schoolNorm !== compact) {
          hint.textContent = `등록부에 「${schoolNorm}」으로 표시됩니다.`;
        } else {
          hint.textContent = "";
        }
      }

      StaffApp.state.department = schoolNorm;
      StaffApp.state.name = name;
      StaffApp.state.position = "";
      StaffApp.state.staffKey = schoolNorm && name ? `${schoolNorm}|${name}` : "";
      StaffApp.state.staffId =
        schoolNorm && name ? `ws_${schoolNorm}|${name}` : "";
    },

    async unlockSchool() {
      const msgEl = document.getElementById("staffSchoolMessage");
      const btn = document.getElementById("btnStaffSchoolUnlock");
      const gateCard = document.getElementById("staffSchoolGate");
      const pw = document.getElementById("staffSchoolPassword")?.value || "";
      const school = AppConfig.setSchoolByPassword(pw);

      if (!school) {
        UI.setMessage(msgEl, "학교 코드가 올바르지 않습니다.", true);
        return;
      }

      UI.setMessage(msgEl, "");
      Api.setAdminToken("");
      UI.setButtonLoading(btn, true, "확인 중…");

      try {
        StaffApp.resetStaffFormState();

        if (AppConfig.isWorkshopMode(school)) {
          await StaffApp.initWorkshopFlow();
        } else {
          await StaffApp.loadEvents();
        }

        StaffApp._schoolFlowStarted = true;
        if (gateCard) gateCard.hidden = true;

        StaffApp.setStaffStepsLocked(false);
        StaffApp.validateSubmitButton();
        AppConfig.applyFlowModeUi();

        if (AppConfig.isWorkshopMode(school)) {
          UI.toastMsg("연수용 서명 등록부로 전환되었습니다.");
        }

        const firstStepId = AppConfig.isWorkshopMode(school) ? "staffWsStep1" : "staffStep1";
        requestAnimationFrame(() => {
          document.getElementById(firstStepId)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        });
      } catch (err) {
        StaffApp._schoolFlowStarted = false;
        if (gateCard) gateCard.hidden = false;
        const message = err?.message || "연결에 실패했습니다. 잠시 후 다시 시도해 주세요.";
        UI.setMessage(msgEl, message, true);
        UI.toastMsg(message, true);
      } finally {
        UI.setButtonLoading(btn, false);
      }
    },

    getEventDatesSorted() {
      const dates = new Set();
      StaffApp.events.forEach((ev) => {
        const d = String(ev.date || "").trim().slice(0, 10);
        if (d) dates.add(d);
      });
      return Array.from(dates).sort((a, b) => b.localeCompare(a));
    },

    getEventsForSelectedDate() {
      const d = StaffApp.state.selectedDate;
      if (!d) return [];
      return StaffApp.events.filter((ev) => String(ev.date || "").trim().slice(0, 10) === d);
    },

    formatEventOptionLabel(ev) {
      const parts = [ev.title || "연수"];
      if (ev.location) parts.push(ev.location);
      return parts.join(" · ");
    },

    async loadEvents() {
      if (AppConfig.isWorkshopMode()) return;
      const dateSel = document.getElementById("staffDateSelect");
      const dateHint = document.getElementById("staffDateHint");
      try {
        if (AppConfig.hasSchoolGate() && (!AppConfig.activeSchoolId || !StaffApp._schoolFlowStarted)) return;
        const events = await UI.withLoading(() => Api.call("getEvents"), "연수 목록 불러오는 중…");
        StaffApp.events = events || [];

        const dates = StaffApp.getEventDatesSorted();
        dateSel.innerHTML = '<option value="">연수 일자를 선택해 주세요</option>';
        dateSel.disabled = false;
        dates.forEach((d) => {
          const opt = document.createElement("option");
          opt.value = d;
          opt.textContent = formatPrintDatetime(d);
          dateSel.appendChild(opt);
        });

        if (dates.length === 0) {
          dateSel.innerHTML = '<option value="">진행 중인 연수가 없습니다</option>';
          dateSel.disabled = true;
          if (dateHint) dateHint.textContent = "";
        } else if (dateHint) {
          dateHint.textContent = `총 ${dates.length}일 · 연수 ${StaffApp.events.length}건`;
        }

        StaffApp.renderEventChecklist([]);
        StaffApp.refreshStaffSteps();
      } catch (err) {
        dateSel.innerHTML = '<option value="">목록을 불러올 수 없습니다</option>';
        dateSel.disabled = true;
        StaffApp.renderEventChecklist([], "목록을 불러올 수 없습니다");
        throw err;
      }
    },

    renderEventChecklist(dayEvents, emptyMessage) {
      const list = document.getElementById("staffEventChecklist");
      const selectAllBtn = document.getElementById("btnStaffSelectAllEvents");
      if (!list) return;

      list.innerHTML = "";
      if (!dayEvents || dayEvents.length === 0) {
        const p = document.createElement("p");
        p.className = "event-checklist__empty muted";
        p.textContent = emptyMessage || "날짜를 먼저 선택해 주세요";
        list.appendChild(p);
        if (selectAllBtn) selectAllBtn.hidden = true;
        return;
      }

      dayEvents.forEach((ev) => {
        const closed = ev.status === "마감";
        const label = document.createElement("label");
        label.className = "event-check-item" + (closed ? " is-closed" : "");

        const input = document.createElement("input");
        input.type = "checkbox";
        input.value = String(ev.eventId);
        if (closed) input.disabled = true;

        const body = document.createElement("span");
        body.className = "event-check-item__body";
        const title = document.createElement("span");
        title.className = "event-check-item__title";
        title.textContent = ev.title || "연수";
        const meta = document.createElement("span");
        meta.className = "event-check-item__meta";
        meta.textContent = ev.location || "장소 미정";
        body.appendChild(title);
        body.appendChild(meta);
        if (closed) {
          const badge = document.createElement("span");
          badge.className = "event-check-item__badge";
          badge.textContent = "마감";
          body.appendChild(badge);
        }

        label.appendChild(input);
        label.appendChild(body);
        list.appendChild(label);
      });

      if (selectAllBtn) {
        const openCount = dayEvents.filter((ev) => ev.status !== "마감").length;
        selectAllBtn.hidden = openCount < 2;
        selectAllBtn.textContent = "전체 선택";
      }
    },

    syncSelectedEventIds() {
      const list = document.getElementById("staffEventChecklist");
      if (!list) {
        StaffApp.state.eventIds = [];
        return;
      }
      StaffApp.state.eventIds = Array.from(list.querySelectorAll('input[type="checkbox"]:checked')).map(
        (cb) => cb.value
      );
    },

    toggleSelectAllEvents() {
      const list = document.getElementById("staffEventChecklist");
      const btn = document.getElementById("btnStaffSelectAllEvents");
      if (!list || !btn) return;
      const boxes = Array.from(list.querySelectorAll('input[type="checkbox"]:not(:disabled)'));
      if (!boxes.length) return;
      const allChecked = boxes.every((cb) => cb.checked);
      boxes.forEach((cb) => {
        cb.checked = !allChecked;
      });
      btn.textContent = allChecked ? "전체 선택" : "전체 해제";
      StaffApp.onEventChecklistChange();
    },

    onEventChecklistChange() {
      StaffApp.syncSelectedEventIds();
      const ids = StaffApp.state.eventIds;
      StaffApp.state.department = "";
      StaffApp.state.staffId = "";
      StaffApp.state.staffKey = "";
      StaffApp.refreshStaffSteps();

      const btn = document.getElementById("btnStaffSelectAllEvents");
      const list = document.getElementById("staffEventChecklist");
      if (btn && list) {
        const boxes = Array.from(list.querySelectorAll('input[type="checkbox"]:not(:disabled)'));
        if (boxes.length >= 2) {
          btn.textContent = boxes.every((cb) => cb.checked) ? "전체 해제" : "전체 선택";
        }
      }

      const hint = document.getElementById("staffEventHint");
      if (hint) {
        if (ids.length === 0) {
          hint.textContent = "서명할 연수·회의를 하나 이상 선택해 주세요.";
        } else {
          hint.textContent =
            ids.length === 1 ? "선택 1건 · 동일 서명으로 제출됩니다" : `선택 ${ids.length}건 · 동일 서명으로 일괄 제출됩니다`;
        }
      }

      StaffApp.loadStaffForSelectedEvents();
      StaffApp.resetDeptName();
      StaffApp.validateSubmitButton();
    },

    onDateChange() {
      const dateSel = document.getElementById("staffDateSelect");
      const eventHint = document.getElementById("staffEventHint");

      StaffApp.state.selectedDate = dateSel.value;
      StaffApp.state.eventIds = [];
      StaffApp.state.department = "";
      StaffApp.state.staffId = "";
      StaffApp.state.staffKey = "";
      StaffApp.refreshStaffSteps();
      StaffApp.resetDeptName();

      if (!dateSel.value) {
        StaffApp.renderEventChecklist([]);
        if (eventHint) eventHint.textContent = "";
        return;
      }

      const dayEvents = StaffApp.getEventsForSelectedDate();
      if (dayEvents.length === 0) {
        StaffApp.renderEventChecklist([], "해당 날짜에 연수가 없습니다");
        if (eventHint) eventHint.textContent = "";
      } else {
        StaffApp.renderEventChecklist(dayEvents);
        if (eventHint) {
          eventHint.textContent =
            dayEvents.length === 1
              ? "이 날짜에 연수 1건 · 서명할 연수를 직접 체크해 주세요"
              : `이 날짜에 연수 ${dayEvents.length}건 · 서명할 항목을 직접 체크하세요`;
        }
      }

      StaffApp.refreshStaffSteps();
    },

    async loadStaffForSelectedEvents() {
      if (!StaffApp.state.eventIds.length) return;
      try {
        StaffApp.staffPool = await Api.call("getStaffForEvents", {
          eventIds: StaffApp.state.eventIds,
        });
        const depts = [...new Set(StaffApp.staffPool.map((s) => String(s.department || "").trim()))]
          .filter(Boolean)
          .sort((a, b) => {
            const da = getDepartmentRank(a);
            const db = getDepartmentRank(b);
            return da !== db ? da - db : a.localeCompare(b, "ko");
          });
        const deptSel = document.getElementById("staffDeptSelect");
        deptSel.disabled = false;
        deptSel.innerHTML = '<option value="">부서를 선택해 주세요</option>';
        depts.forEach((d) => {
          const o = document.createElement("option");
          o.value = d;
          o.textContent = d;
          deptSel.appendChild(o);
        });
        if (depts.length === 0) {
          UI.toastMsg("선택한 연수 모두에 참여 대상으로 등록된 교직원만 서명할 수 있습니다.", true);
        }
        StaffApp.refreshStaffSteps();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    onDeptChange() {
      const dept = document.getElementById("staffDeptSelect").value;
      StaffApp.state.department = dept;
      StaffApp.state.staffId = "";
      StaffApp.state.staffKey = "";
      const nameSel = document.getElementById("staffNameSelect");
      nameSel.innerHTML = '<option value="">이름을 선택해 주세요</option>';
      if (!dept) {
        nameSel.disabled = true;
        StaffApp.refreshStaffSteps();
        StaffApp.validateSubmitButton();
        return;
      }
      const filtered = StaffApp.staffPool.filter((s) => s.department === dept);
      filtered.forEach((s) => {
        const o = document.createElement("option");
        o.value = s.staffId;
        o.textContent = s.name;
        o.dataset.staff = JSON.stringify(s);
        nameSel.appendChild(o);
      });
      nameSel.disabled = false;
      StaffApp.refreshStaffSteps();
      StaffApp.validateSubmitButton();
    },

    onNameChange() {
      const nameSel = document.getElementById("staffNameSelect");
      const opt = nameSel.selectedOptions[0];
      if (opt?.dataset.staff) {
        const s = JSON.parse(opt.dataset.staff);
        StaffApp.state.staffId = s.staffId;
        StaffApp.state.staffKey = s.staffId || `${s.department || ""}|${s.name || ""}`;
        StaffApp.state.name = s.name;
        StaffApp.state.position = s.position || "";
        StaffApp.selectedStaff = s;
      } else {
        StaffApp.state.staffId = "";
        StaffApp.state.staffKey = "";
      }
      StaffApp.refreshStaffSteps();
      StaffApp.validateSubmitButton();
    },

    resetDeptName() {
      const deptSel = document.getElementById("staffDeptSelect");
      const nameSel = document.getElementById("staffNameSelect");
      deptSel.innerHTML = '<option value="">연수를 하나 이상 선택해 주세요</option>';
      deptSel.disabled = true;
      nameSel.innerHTML = '<option value="">부서를 먼저 선택해 주세요</option>';
      nameSel.disabled = true;
    },

    /** 이전 스텝 완료 시에만 다음 스텝 카드를 표시 */
    refreshStaffSteps() {
      if (AppConfig.hasSchoolGate() && !StaffApp._schoolFlowStarted) {
        StaffApp.hideAllStaffSteps();
        return;
      }

      if (AppConfig.isWorkshopMode()) {
        StaffApp.refreshWorkshopSteps();
        return;
      }

      StaffApp.STAFF_STEP_IDS.filter((id) => id !== "staffStep5").forEach((id) => {
        const card = document.getElementById(id);
        if (card) card.hidden = true;
      });
      ["staffWsStep1", "staffWsStep2"].forEach((id) => {
        const card = document.getElementById(id);
        if (card) card.hidden = true;
      });
      const step5 = document.getElementById("staffStep5");
      if (step5) {
        const kicker = step5.querySelector(".kicker");
        const badge = step5.querySelector(".step-badge");
        if (kicker) kicker.textContent = "STEP 5";
        if (badge) badge.textContent = "5";
      }

      const completed = {
        1: !!StaffApp.state.selectedDate,
        2: StaffApp.state.eventIds.length > 0,
        3: !!StaffApp.state.department,
        4: !!StaffApp.state.staffKey,
      };

      let lastVisible = 1;
      if (completed[1]) lastVisible = 2;
      if (completed[1] && completed[2]) lastVisible = 3;
      if (completed[1] && completed[2] && completed[3]) lastVisible = 4;
      if (completed[1] && completed[2] && completed[3] && completed[4]) lastVisible = 5;

      const stepRevealed = lastVisible > StaffApp._lastVisibleStaffStep;
      StaffApp._lastVisibleStaffStep = lastVisible;

      StaffApp.STAFF_STEP_IDS.forEach((id, index) => {
        const n = index + 1;
        const card = document.getElementById(id);
        if (!card) return;

        const badge = card.querySelector(".step-badge");
        const visible = n <= lastVisible;
        const complete = !!completed[n];
        const active = visible && n === lastVisible && !complete;

        card.hidden = !visible;
        card.classList.toggle("is-complete", complete);
        card.classList.toggle("is-active", active);
        badge?.classList.toggle("is-complete", complete);

        card.classList.remove("is-step-enter");
        if (visible && n === lastVisible && stepRevealed) {
          card.classList.add("is-step-enter");
        }
      });

      if (lastVisible === 5 && completed[4] && stepRevealed) {
        SignaturePad.ensureReady();
      } else if (stepRevealed && lastVisible < 5) {
        const card = document.getElementById(`staffStep${lastVisible}`);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    },

    refreshWorkshopSteps() {
      StaffApp.syncWorkshopState();

      StaffApp.STAFF_STEP_IDS.filter((id) => id !== "staffStep5").forEach((id) => {
        const card = document.getElementById(id);
        if (card) {
          card.hidden = true;
          card.classList.remove("is-active", "is-complete", "is-step-enter");
        }
      });

      const schoolNorm = StaffApp.state.department;
      const name = StaffApp.state.name;
      const completed = {
        1: !!schoolNorm,
        2: !!name,
      };

      let lastVisible = 1;
      if (completed[1]) lastVisible = 2;
      if (completed[1] && completed[2]) lastVisible = 3;

      const stepRevealed = lastVisible > StaffApp._lastVisibleStaffStep;
      StaffApp._lastVisibleStaffStep = lastVisible;

      StaffApp.WORKSHOP_STEP_IDS.forEach((id, index) => {
        const n = index + 1;
        const card = document.getElementById(id);
        if (!card) return;

        const badge = card.querySelector(".step-badge");
        const visible = n <= lastVisible;
        const complete =
          n === 1 ? !!completed[1] : n === 2 ? !!completed[2] : completed[1] && completed[2] && !SignaturePad.isEmpty();
        const active = visible && n === lastVisible && !complete;

        card.hidden = !visible;
        card.classList.toggle("is-complete", complete);
        card.classList.toggle("is-active", active);
        badge?.classList.toggle("is-complete", complete);

        card.classList.remove("is-step-enter");
        if (visible && n === lastVisible && stepRevealed) {
          card.classList.add("is-step-enter");
        }

        if (id === "staffStep5") {
          const kicker = card.querySelector(".kicker");
          if (kicker) kicker.textContent = "STEP 3";
          if (badge) badge.textContent = "3";
        }
      });

      if (lastVisible === 3 && completed[1] && completed[2] && stepRevealed) {
        SignaturePad.ensureReady();
      } else if (stepRevealed && lastVisible < 3) {
        const card = document.getElementById(StaffApp.WORKSHOP_STEP_IDS[lastVisible - 1]);
        card?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    },

    afterSignatureChange() {
      StaffApp.validateSubmitButton();
      if (AppConfig.isWorkshopMode()) {
        StaffApp.updateWorkshopSignatureBadge();
      }
    },

    updateWorkshopSignatureBadge() {
      const card = document.getElementById("staffStep5");
      if (!card || card.hidden) return;
      const badge = card.querySelector(".step-badge");
      const signed = !SignaturePad.isEmpty();
      card.classList.toggle("is-complete", signed);
      badge?.classList.toggle("is-complete", signed);
    },

    validateSubmitButton() {
      const btn = document.getElementById("btnStaffSubmit");
      let ok;
      if (AppConfig.isWorkshopMode()) {
        ok = !!StaffApp.state.staffKey && !SignaturePad.isEmpty();
      } else {
        ok =
          StaffApp.state.eventIds.length > 0 &&
          StaffApp.state.staffKey &&
          !SignaturePad.isEmpty();
      }
      if (btn) btn.disabled = !ok;
    },

    getSelectedEvents() {
      const idSet = new Set(StaffApp.state.eventIds.map(String));
      return StaffApp.events.filter((e) => idSet.has(String(e.eventId)));
    },

    async onSubmitClick() {
      if (AppConfig.isWorkshopMode()) {
        StaffApp.syncWorkshopState();
        if (!StaffApp.state.staffKey) {
          UI.toastMsg("학교명과 성함을 입력해 주세요.", true);
          return;
        }
        if (SignaturePad.isEmpty()) {
          UI.toastMsg("서명을 입력해 주세요.", true);
          return;
        }
      } else {
        if (!StaffApp.state.eventIds.length || !StaffApp.state.staffKey) {
          UI.toastMsg("연수, 부서, 이름을 모두 선택해 주세요.", true);
          return;
        }
        if (SignaturePad.isEmpty()) {
          UI.toastMsg("서명을 입력해 주세요.", true);
          return;
        }

        const selected = StaffApp.getSelectedEvents();
        const closed = selected.filter((ev) => ev.status === "마감");
        if (closed.length) {
          UI.toastMsg("마감된 연수는 제출할 수 없습니다. 선택을 확인해 주세요.", true);
          return;
        }
      }

      const submitBtn = document.getElementById("btnStaffSubmit");
      UI.setButtonLoading(submitBtn, true, "확인 중…");
      try {
        const check = await Api.call("checkSignaturesBulk", {
          eventIds: StaffApp.state.eventIds,
          staffId: StaffApp.state.staffId,
          department: StaffApp.state.department,
          name: StaffApp.state.name,
        });
        if (check.exists) {
          const owText = document.getElementById("overwriteModalText");
          const titles = (check.existingEvents || []).map((e) => e.title).join(", ");
          if (owText) {
            owText.innerHTML = titles
              ? `다음 연수에 이미 서명이 있습니다:<br><strong>${escapeHtml(titles)}</strong><br><br>수정 제출하시겠습니까? 기존 서명이 새 서명으로 바뀝니다.`
              : "수정 제출하시겠습니까?<br />기존 서명이 새 서명으로 바뀝니다.";
          }
          UI.openModal("overwriteModal");
          return;
        }
        StaffApp.showConfirmModal();
      } catch (err) {
        UI.toastMsg(err.message, true);
      } finally {
        UI.setButtonLoading(submitBtn, false);
        StaffApp.validateSubmitButton();
      }
    },

    showConfirmModal() {
      const text = document.getElementById("confirmModalText");
      if (AppConfig.isWorkshopMode()) {
        const school = AppConfig.getSelectedSchoolForDisplay();
        const title = school?.displayTitle || school?.label || "연수";
        text.textContent = `${StaffApp.state.department} ${StaffApp.state.name} 선생님,\n「${title}」 연수에 서명을 제출합니다.\n\n제출하시겠습니까?`;
        UI.openModal("confirmModal");
        return;
      }
      const selected = StaffApp.getSelectedEvents();
      const titles = selected.map((e) => e.title || "연수").join("\n· ");
      const count = selected.length;
      text.textContent = `${StaffApp.state.department} ${StaffApp.state.name} 선생님,\n선택한 연수 ${count}건에 서명을 제출합니다.\n\n· ${titles}\n\n제출하시겠습니까?`;
      UI.openModal("confirmModal");
    },

    async doSubmit(skipCheck) {
      UI.closeModal("confirmModal");
      UI.closeModal("overwriteModal");
      const msgEl = document.getElementById("staffSubmitMessage");
      const submitBtn = document.getElementById("btnStaffSubmit");

      UI.setButtonLoading(submitBtn, true, "제출 중…");
      try {
        const result = await Api.call("submitSignaturesBulk", {
          eventIds: StaffApp.state.eventIds,
          staffId: StaffApp.state.staffId,
          department: StaffApp.state.department,
          name: StaffApp.state.name,
          position: StaffApp.state.position,
          signatureData: SignaturePad.toDataUrl(),
          overwrite: !!skipCheck,
        });
        StaffApp.showSuccessModal(result);
        UI.setMessage(msgEl, "");
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
        UI.toastMsg(err.message, true);
      } finally {
        UI.setButtonLoading(submitBtn, false);
        StaffApp.validateSubmitButton();
      }
    },

    showSuccessModal(result) {
      const detail = document.getElementById("staffSuccessModalDetail");
      const n = result?.submitted ?? StaffApp.state.eventIds.length;
      const total = result?.total ?? StaffApp.state.eventIds.length;
      if (detail) {
        if (n < total) {
          detail.textContent = `${n}건 제출 완료 (${total - n}건 실패). 관리자에게 문의해 주세요.`;
        } else {
          detail.textContent =
            n > 1 ? `선택한 연수 ${n}건에 서명이 저장되었습니다. 감사합니다.` : "감사합니다. 창을 닫으셔도 됩니다.";
        }
      }
      UI.openModal("staffSuccessModal");
    },

    async resetFlow(options = {}) {
      const keepDate = options.keepDate === true;
      const prevDate = keepDate ? StaffApp.state.selectedDate : "";

      if (keepDate) {
        StaffApp.state.eventIds = AppConfig.isWorkshopMode() && StaffApp.workshopEventId ? [StaffApp.workshopEventId] : [];
        StaffApp.state.department = "";
        StaffApp.state.staffId = "";
        StaffApp.state.staffKey = "";
        StaffApp.state.name = "";
        StaffApp.state.position = "";
        StaffApp._lastVisibleStaffStep = 0;
        SignaturePad.clear();
        UI.closeModal("staffSuccessModal");
        StaffApp.resetDeptName();
        if (AppConfig.isWorkshopMode()) {
          const freeSchool = document.getElementById("staffFreeSchool");
          const freeName = document.getElementById("staffFreeName");
          if (freeSchool) freeSchool.value = "";
          if (freeName) freeName.value = "";
        }
      } else {
        StaffApp.resetStaffFormState();
      }

      const successDetail = document.getElementById("staffSuccessModalDetail");
      if (successDetail) successDetail.textContent = "감사합니다. 창을 닫으셔도 됩니다.";
      await (AppConfig.isWorkshopMode() ? StaffApp.initWorkshopFlow() : StaffApp.loadEvents());

      const dateSel = document.getElementById("staffDateSelect");
      if (keepDate && prevDate && dateSel) {
        dateSel.value = prevDate;
        StaffApp.onDateChange();
      } else if (dateSel) {
        dateSel.value = "";
      }

      StaffApp._lastVisibleStaffStep = 0;
      StaffApp.refreshStaffSteps();
      StaffApp.validateSubmitButton();
    },
  };

  window.__signonUnlock = function () {
    return StaffApp.unlockSchool();
  };

  /* ─────────────────────────────────────────
   * 관리자 페이지
   * ───────────────────────────────────────── */
  const AdminApp = {
    events: [],
    staffList: [],
    staffDraft: [],
    lastAddedStaff: null,
    workshopEventId: "",

    isWorkshopAdmin() {
      return AppConfig.isWorkshopMode();
    },

    applyWorkshopAdminLayout() {
      const workshop = AdminApp.isWorkshopAdmin();
      document.querySelectorAll('[data-admin-scope="school"]').forEach((el) => {
        el.hidden = workshop;
      });
      const statusField = document.getElementById("adminStatusEventField");
      const printField = document.getElementById("adminPrintEventField");
      const wsHint = document.getElementById("adminWorkshopStatusHint");
      if (statusField) statusField.hidden = workshop;
      if (printField) printField.hidden = workshop;
      if (wsHint) wsHint.hidden = !workshop;

      const unsignedStat = document.querySelector(".status-stat--pending");
      if (unsignedStat) unsignedStat.hidden = workshop;

      const statLabels = document.querySelectorAll("#adminStatusSummary .status-stat__label");
      if (statLabels[0]) statLabels[0].textContent = workshop ? "참가자" : "전체 대상";
      if (statLabels[2]) statLabels[2].textContent = workshop ? "—" : "미서명";

      const deptHeaders = document.querySelectorAll(
        "#adminSignedCard thead th:first-child, #adminUnsignedCard thead th:first-child"
      );
      deptHeaders.forEach((th) => {
        th.textContent = workshop ? "학교" : "부서";
      });
    },

    init() {
      document.getElementById("btnAdminLogin")?.addEventListener("click", AdminApp.login);
      document.getElementById("btnAdminLogout")?.addEventListener("click", AdminApp.logout);
      document.getElementById("adminPassword")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") AdminApp.login();
      });
      document.getElementById("adminSchoolPassword")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") AdminApp.login();
      });

      document.querySelectorAll(".admin-menu__item").forEach((btn) => {
        btn.addEventListener("click", () => AdminApp.switchTab(btn.dataset.adminTab));
      });

      document.getElementById("adminEventForm")?.addEventListener("submit", AdminApp.saveEvent);
      document.getElementById("btnAdminEventReset")?.addEventListener("click", AdminApp.resetEventForm);
      AdminApp.bindDeptPicker("adminEventDeptList", "adminEventDeptSelectAll");

      document.getElementById("adminEventModalForm")?.addEventListener("submit", AdminApp.saveEventModal);
      document.getElementById("btnEventModalClose")?.addEventListener("click", AdminApp.closeEventModal);
      document.getElementById("btnEventModalDelete")?.addEventListener("click", AdminApp.deleteEventModal);
      AdminApp.bindDeptPicker("modalEventDeptList", "modalEventDeptSelectAll");
      document.getElementById("eventDetailModal")?.addEventListener("click", (e) => {
        if (e.target.id === "eventDetailModal") AdminApp.closeEventModal();
      });

      document.getElementById("btnDownloadStaffCsvTemplate")?.addEventListener(
        "click",
        AdminApp.downloadStaffCsvTemplate
      );
      document.getElementById("btnUploadCsv")?.addEventListener("click", AdminApp.openCsvPicker);
      document.getElementById("staffCsvFile")?.addEventListener("change", AdminApp.uploadCsv);

      document.getElementById("btnResetStaffList")?.addEventListener("click", AdminApp.resetStaffList);
      document.getElementById("btnAddStaffRow")?.addEventListener("click", AdminApp.openStaffAddModal);
      document.getElementById("btnSaveStaffChanges")?.addEventListener("click", AdminApp.saveStaffChanges);

      // 표 셀(입력/선택) 변경 감지
      document
        .getElementById("adminStaffTableBody")
        ?.addEventListener("input", AdminApp.onStaffCellChange);
      document
        .getElementById("adminStaffTableBody")
        ?.addEventListener("change", AdminApp.onStaffCellChange);
      document
        .getElementById("adminStaffTableBody")
        ?.addEventListener("click", AdminApp.onStaffTableClick);

      document.getElementById("staffAddForm")?.addEventListener("submit", AdminApp.submitStaffAdd);
      document.getElementById("btnStaffAddCancel")?.addEventListener("click", AdminApp.closeStaffAddModal);
      document.getElementById("staffAddModal")?.addEventListener("click", (e) => {
        if (e.target.id === "staffAddModal") AdminApp.closeStaffAddModal();
      });

      document.getElementById("adminStatusEventSelect")?.addEventListener("change", AdminApp.loadStatus);
      document
        .getElementById("adminSignedTableBody")
        ?.addEventListener("click", AdminApp.onSignedTableClick);
      document.getElementById("btnLoadPrint")?.addEventListener("click", AdminApp.loadPrint);
      document.getElementById("btnPrintRegister")?.addEventListener("click", () => window.print());

      if (Api.getAdminToken()) AdminApp.showDashboard();
      AdminApp.applySchoolGateState();
    },

    applySchoolGateState() {
      const gate = document.getElementById("adminSchoolGate");
      if (!gate) return;
      if (!AppConfig.hasSchoolGate()) {
        gate.hidden = true;
        return;
      }
      gate.hidden = !!AppConfig.activeSchoolId;
    },

    async login() {
      // 학교 코드(학교 선택) 확인
      if (AppConfig.hasSchoolGate() && !AppConfig.activeSchoolId) {
        const schoolPw = document.getElementById("adminSchoolPassword")?.value || "";
        const school = AppConfig.setSchoolByPassword(schoolPw);
        if (!school) {
          UI.setMessage(
            document.getElementById("adminLoginMessage"),
            "학교 코드가 올바르지 않습니다.",
            true
          );
          return;
        }
        // 학교가 선택되면 기존 토큰은 무효
        Api.setAdminToken("");
        AdminApp.applySchoolGateState();
        AppConfig.applyFlowModeUi();
      }

      const pw = document.getElementById("adminPassword").value;
      const msgEl = document.getElementById("adminLoginMessage");
      if (!pw) {
        UI.setMessage(msgEl, "암호를 입력해 주세요.", true);
        return;
      }
      try {
        const data = await UI.withLoading(
          () => Api.call("loginAdmin", { password: pw }),
          "확인 중…"
        );
        Api.setAdminToken(data.token);
        UI.setMessage(msgEl, "");
        AdminApp.showDashboard();
        AppConfig.applyFlowModeUi();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    logout() {
      Api.setAdminToken("");
      document.getElementById("adminLoginCard").hidden = false;
      document.getElementById("adminDashboard").hidden = true;
      document.getElementById("adminPassword").value = "";
      const schoolPwEl = document.getElementById("adminSchoolPassword");
      if (schoolPwEl) schoolPwEl.value = "";
      AdminApp.applySchoolGateState();
      AppConfig.applyFlowModeUi();
    },

    showDashboard() {
      document.getElementById("adminLoginCard").hidden = true;
      document.getElementById("adminDashboard").hidden = false;
      AdminApp.applyWorkshopAdminLayout();
      if (AdminApp.isWorkshopAdmin()) {
        AdminApp.switchTab("status");
      } else {
        AdminApp.refreshAll();
      }
    },

    async refreshAll() {
      if (AdminApp.isWorkshopAdmin()) {
        await AdminApp.loadWorkshopAdminData();
        return;
      }
      await AdminApp.loadAdminEvents();
      await AdminApp.loadStaffTable();
      AdminApp.renderDeptPicker("adminEventDeptList", "adminEventDeptSelectAll", [], "all");
      AdminApp.fillEventSelects();
    },

    switchTab(tab) {
      if (AdminApp.isWorkshopAdmin() && (tab === "events" || tab === "staff")) {
        tab = "status";
      }
      document.querySelectorAll(".admin-menu__item").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.adminTab === tab);
      });
      document.querySelectorAll(".admin-tab-panel").forEach((p) => {
        const active = p.dataset.tab === tab;
        p.classList.toggle("is-active", active);
        p.hidden = !active;
      });
      if (tab === "status") AdminApp.loadStatus();
    },

    getStaffDepartments() {
      const depts = new Set();
      (AdminApp.staffList || []).forEach((s) => {
        const d = getStaffDepartmentKey(s);
        if (d) depts.add(d);
      });
      return Array.from(depts).sort((a, b) => {
        const da = getDepartmentRank(a);
        const db = getDepartmentRank(b);
        return da !== db ? da - db : a.localeCompare(b, "ko");
      });
    },

    renderDeptPicker(listElId, selectAllId, selectedDepts, targetType) {
      const listEl = document.getElementById(listElId);
      const selectAllEl = document.getElementById(selectAllId);
      if (!listEl) return;

      const depts = AdminApp.getStaffDepartments();
      listEl.innerHTML = "";

      if (!depts.length) {
        listEl.innerHTML =
          '<p class="dept-picker__empty muted">구성원 명단에 등록된 부서가 없습니다. 구성원 관리에서 명단을 등록해 주세요.</p>';
        if (selectAllEl) {
          selectAllEl.checked = false;
          selectAllEl.disabled = true;
        }
        return;
      }

      if (selectAllEl) selectAllEl.disabled = false;

      let selectedSet;
      if (targetType === "all") {
        selectedSet = new Set(depts);
      } else if (targetType === "departments") {
        selectedSet = new Set((selectedDepts || []).map(String));
      } else {
        selectedSet = new Set();
      }

      depts.forEach((dept) => {
        const label = document.createElement("label");
        label.className = "dept-picker__item";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.className = "dept-picker__checkbox";
        cb.value = dept;
        cb.checked = selectedSet.has(dept);
        label.appendChild(cb);
        label.appendChild(document.createTextNode(dept));
        listEl.appendChild(label);
      });

      if (selectAllEl) {
        const boxes = listEl.querySelectorAll(".dept-picker__checkbox");
        selectAllEl.checked = boxes.length > 0 && Array.from(boxes).every((cb) => cb.checked);
      }
    },

    bindDeptPicker(listElId, selectAllId) {
      const listEl = document.getElementById(listElId);
      const selectAllEl = document.getElementById(selectAllId);
      if (!listEl || listEl.dataset.deptBound === "1") return;
      listEl.dataset.deptBound = "1";

      selectAllEl?.addEventListener("change", () => {
        const boxes = listEl.querySelectorAll(".dept-picker__checkbox");
        boxes.forEach((cb) => {
          cb.checked = selectAllEl.checked;
        });
      });

      listEl.addEventListener("change", (e) => {
        if (!e.target.classList.contains("dept-picker__checkbox")) return;
        const boxes = listEl.querySelectorAll(".dept-picker__checkbox");
        if (selectAllEl) {
          selectAllEl.checked = Array.from(boxes).every((cb) => cb.checked);
        }
      });
    },

    getTargetFromDeptPicker(listElId) {
      const listEl = document.getElementById(listElId);
      const allDepts = AdminApp.getStaffDepartments();
      if (!allDepts.length) {
        return {
          ok: false,
          message: "구성원 명단에 부서가 없습니다. 구성원 관리에서 명단을 등록해 주세요.",
        };
      }
      const checked = Array.from(listEl.querySelectorAll(".dept-picker__checkbox:checked")).map(
        (cb) => cb.value
      );
      if (!checked.length) {
        return { ok: false, message: "부서를 하나 이상 선택해 주세요." };
      }
      if (checked.length >= allDepts.length) {
        return { ok: true, targetType: "all", targetData: "" };
      }
      return { ok: true, targetType: "departments", targetData: checked.join(",") };
    },

    refreshCreateDeptPicker() {
      const listEl = document.getElementById("adminEventDeptList");
      if (!listEl) return;
      const current = AdminApp.getTargetFromDeptPicker("adminEventDeptList");
      if (!current.ok) {
        AdminApp.renderDeptPicker("adminEventDeptList", "adminEventDeptSelectAll", [], "all");
        return;
      }
      const selectedDepts =
        current.targetType === "departments"
          ? String(current.targetData)
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [];
      AdminApp.renderDeptPicker(
        "adminEventDeptList",
        "adminEventDeptSelectAll",
        selectedDepts,
        current.targetType
      );
    },

    async loadAdminEvents() {
      try {
        AdminApp.events = await UI.withLoading(
          () => Api.call("getAdminEvents", {}, true),
          "연수 목록…"
        );
        AdminApp.renderEventList();
      } catch (err) {
        if (err.message.includes("인증") || err.message.includes("로그인")) AdminApp.logout();
        UI.toastMsg(err.message, true);
      }
    },

    renderEventList() {
      const list = document.getElementById("adminEventList");
      list.innerHTML = "";
      if (!AdminApp.events.length) {
        list.innerHTML = '<p class="admin-list-empty muted">등록된 연수·회의가 없습니다.</p>';
        return;
      }
      AdminApp.events.forEach((ev) => {
        const div = document.createElement("div");
        div.className = "admin-list-item";
        div.innerHTML = `
          <div>
            <div class="admin-list-item__title">${escapeHtml(ev.title)}</div>
            <small>${escapeHtml(ev.date || "")} · ${escapeHtml(ev.status)}</small>
          </div>
          <span class="status-pill status-pill--${statusClass(ev.status)}">${escapeHtml(ev.status)}</span>
        `;
        div.addEventListener("click", () => AdminApp.openEventModal(ev));
        list.appendChild(div);
      });
    },

    openEventModal(ev) {
      document.getElementById("eventDetailModalTitle").textContent = ev.title || "연수·회의 상세";
      document.getElementById("modalEventId").value = ev.eventId;
      document.getElementById("modalEventTitle").value = ev.title || "";
      document.getElementById("modalEventDate").value = ev.date || "";
      document.getElementById("modalEventLocation").value = ev.location || "";
      document.getElementById("modalEventDesc").value = ev.description || "";
      document.getElementById("modalEventStatus").value = ev.status || "진행중";

      const targetType = ev.targetType || "all";
      let selectedDepts = [];
      if (targetType === "departments" && ev.targetData) {
        selectedDepts = String(ev.targetData)
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }
      AdminApp.renderDeptPicker("modalEventDeptList", "modalEventDeptSelectAll", selectedDepts, targetType);

      const modalHint = document.getElementById("modalDeptPickerHint");
      if (modalHint) {
        if (targetType === "members") {
          modalHint.hidden = false;
          modalHint.textContent =
            "이 연수는 특정 구성원(staffId)으로 지정되어 있습니다. 부서를 선택해 저장하면 부서 기준 대상으로 바뀝니다.";
        } else {
          modalHint.hidden = true;
          modalHint.textContent = "";
        }
      }

      UI.setMessage(document.getElementById("adminEventModalMessage"), "");
      UI.openModal("eventDetailModal");
    },

    closeEventModal() {
      UI.closeModal("eventDetailModal");
      UI.setMessage(document.getElementById("adminEventModalMessage"), "");
    },

    getEventModalPayload() {
      const target = AdminApp.getTargetFromDeptPicker("modalEventDeptList");
      return {
        eventId: document.getElementById("modalEventId").value,
        title: document.getElementById("modalEventTitle").value.trim(),
        date: document.getElementById("modalEventDate").value,
        location: document.getElementById("modalEventLocation").value.trim(),
        description: document.getElementById("modalEventDesc").value.trim(),
        status: document.getElementById("modalEventStatus").value,
        targetOk: target.ok,
        targetMessage: target.message,
        targetType: target.ok ? target.targetType : "",
        targetData: target.ok ? target.targetData : "",
      };
    },

    async saveEventModal(e) {
      e.preventDefault();
      const msgEl = document.getElementById("adminEventModalMessage");
      const payload = AdminApp.getEventModalPayload();
      if (!payload.title || !payload.date) {
        UI.setMessage(msgEl, "제목과 날짜는 필수입니다.", true);
        return;
      }
      if (!payload.targetOk) {
        UI.setMessage(msgEl, payload.targetMessage, true);
        return;
      }
      if (!payload.eventId) {
        UI.setMessage(msgEl, "연수 정보를 찾을 수 없습니다.", true);
        return;
      }
      try {
        await UI.withLoading(
          () =>
            Api.call(
              "updateEvent",
              {
                eventId: payload.eventId,
                title: payload.title,
                date: payload.date,
                location: payload.location,
                description: payload.description,
                status: payload.status,
                targetType: payload.targetType,
                targetData: payload.targetData,
              },
              true
            ),
          "저장 중…"
        );
        UI.toastMsg("연수·회의가 저장되었습니다.");
        AdminApp.closeEventModal();
        await AdminApp.loadAdminEvents();
        AdminApp.fillEventSelects();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    async deleteEventModal() {
      const eventId = document.getElementById("modalEventId").value;
      const title = document.getElementById("modalEventTitle").value.trim();
      if (!eventId) return;
      if (
        !confirm(
          `「${title || "이 연수"}」를 삭제하시겠습니까?\n연결된 서명 기록도 함께 삭제됩니다.`
        )
      ) {
        return;
      }
      const msgEl = document.getElementById("adminEventModalMessage");
      try {
        await UI.withLoading(() => Api.call("deleteEvent", { eventId }, true), "삭제 중…");
        UI.toastMsg("삭제되었습니다.");
        AdminApp.closeEventModal();
        AdminApp.resetEventForm();
        await AdminApp.loadAdminEvents();
        AdminApp.fillEventSelects();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    resetEventForm() {
      document.getElementById("adminEventForm").reset();
      document.getElementById("adminEventStatus").value = "진행중";
      AdminApp.renderDeptPicker("adminEventDeptList", "adminEventDeptSelectAll", [], "all");
      UI.setMessage(document.getElementById("adminEventMessage"), "");
    },

    async saveEvent(e) {
      e.preventDefault();
      const msgEl = document.getElementById("adminEventMessage");
      const target = AdminApp.getTargetFromDeptPicker("adminEventDeptList");
      if (!target.ok) {
        UI.setMessage(msgEl, target.message, true);
        return;
      }

      const payload = {
        title: document.getElementById("adminEventTitle").value.trim(),
        date: document.getElementById("adminEventDate").value,
        location: document.getElementById("adminEventLocation").value.trim(),
        description: document.getElementById("adminEventDesc").value.trim(),
        status: document.getElementById("adminEventStatus").value,
        targetType: target.targetType,
        targetData: target.targetData,
      };
      if (!payload.title || !payload.date) {
        UI.setMessage(msgEl, "제목과 날짜는 필수입니다.", true);
        return;
      }
      try {
        await UI.withLoading(() => Api.call("createEvent", payload, true), "등록 중…");
        UI.setMessage(msgEl, "연수·회의가 등록되었습니다.");
        UI.toastMsg("연수·회의가 등록되었습니다.");
        AdminApp.resetEventForm();
        await AdminApp.loadAdminEvents();
        AdminApp.fillEventSelects();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    async loadStaffTable() {
      try {
        AdminApp.staffList = await Api.call("getStaffList", { includeInactive: true }, true);
        AdminApp.staffDraft = (AdminApp.staffList || []).map((s) => ({
          _key: s.staffId,
          _isNew: false,
          _dirty: false,
          staffId: s.staffId,
          department: s.department || "",
          position: s.position || "",
          staffRank: s.staffRank || "",
          name: s.name || "",
          remarks: s.remarks || "",
          active: s.active || "Y",
        }));
        AdminApp.staffDraft = AdminApp.sortStaffDraft(AdminApp.staffDraft);
        AdminApp.renderStaffTable();
        AdminApp.refreshCreateDeptPicker();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    sortStaffDraft(rows) {
      const last = AdminApp.lastAddedStaff;
      return [...rows].sort((a, b) => {
        const deptA = getStaffDepartmentKey(a);
        const deptB = getStaffDepartmentKey(b);
        const da = getDepartmentRank(deptA);
        const db = getDepartmentRank(deptB);
        const deptCmp = da !== db ? da - db : deptA.localeCompare(deptB, "ko");
        if (deptCmp !== 0) return deptCmp;

        return compareWithinDepartmentRows(a, b, last);
      });
    },

    renderStaffTable() {
      const tbody = document.getElementById("adminStaffTableBody");
      if (!tbody) return;
      tbody.innerHTML = "";

      if (!AdminApp.staffDraft || AdminApp.staffDraft.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="7" style="text-align:center; padding:18px;">등록된 구성원이 없습니다.</td>`;
        tbody.appendChild(tr);
        return;
      }

      AdminApp.staffDraft.forEach((row) => {
        const tr = document.createElement("tr");
        tr.dataset.staffKey = row._key;
        tr.innerHTML = `
          <td>
            <input type="text" data-staff-key="${row._key}" data-staff-field="department" value="${escapeHtml(
              row.department
            )}" />
          </td>
          <td>
            <input type="text" data-staff-key="${row._key}" data-staff-field="position" value="${escapeHtml(
              row.position
            )}" />
          </td>
          <td>
            <input type="text" data-staff-key="${row._key}" data-staff-field="staffRank" value="${escapeHtml(
              row.staffRank || ""
            )}" placeholder="부장 / 1반 담임" />
          </td>
          <td>
            <input type="text" data-staff-key="${row._key}" data-staff-field="name" value="${escapeHtml(
              row.name
            )}" />
          </td>
          <td>
            <input type="text" data-staff-key="${row._key}" data-staff-field="remarks" value="${escapeHtml(
              row.remarks || ""
            )}" />
          </td>
          <td>
            <select data-staff-key="${row._key}" data-staff-field="active">
              <option value="Y" ${row.active === "Y" ? "selected" : ""}>사용</option>
              <option value="N" ${row.active === "N" ? "selected" : ""}>미사용</option>
            </select>
          </td>
          <td>
            <button type="button" class="icon-btn" data-action="delete-staff" data-staff-id="${escapeHtml(
              row.staffId
            )}" aria-label="삭제">🗑</button>
          </td>
        `;
        tbody.appendChild(tr);
      });
    },

    onStaffCellChange(e) {
      const target = e.target;
      if (!target || !target.dataset) return;
      const key = target.dataset.staffKey;
      const field = target.dataset.staffField;
      if (!key || !field) return;

      const row = (AdminApp.staffDraft || []).find((r) => r._key === key);
      if (!row) return;

      const value = String(target.value ?? "");
      row[field] = field === "active" ? value : value.trim();
      row._dirty = true;
    },

    onStaffTableClick(e) {
      const btn = e.target?.closest?.("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === "delete-staff") {
        const staffId = btn.dataset.staffId;
        if (staffId) AdminApp.deleteStaff(staffId);
      }
    },

    openStaffAddModal() {
      document.getElementById("staffAddForm")?.reset();
      document.getElementById("staffAddActive").value = "Y";
      UI.setMessage(document.getElementById("staffAddMessage"), "");
      UI.openModal("staffAddModal");
      setTimeout(() => document.getElementById("staffAddDept")?.focus(), 0);
    },

    closeStaffAddModal() {
      UI.closeModal("staffAddModal");
      UI.setMessage(document.getElementById("staffAddMessage"), "");
    },

    async submitStaffAdd(e) {
      e.preventDefault();
      const msgEl = document.getElementById("staffAddMessage");
      const payload = {
        department: document.getElementById("staffAddDept").value.trim(),
        position: document.getElementById("staffAddPosition").value.trim(),
        staffRank: document.getElementById("staffAddRank").value.trim(),
        name: document.getElementById("staffAddName").value.trim(),
        remarks: document.getElementById("staffAddRemarks").value.trim(),
        active: document.getElementById("staffAddActive").value,
      };
      if (!payload.department || !payload.name) {
        UI.setMessage(msgEl, "부서와 성명은 필수입니다.", true);
        return;
      }
      try {
        const res = await UI.withLoading(() => Api.call("addStaff", payload, true), "추가 중…");
        AdminApp.lastAddedStaff = { staffId: res.staffId, department: payload.department };
        UI.toastMsg("구성원이 추가되었습니다.");
        AdminApp.closeStaffAddModal();
        await AdminApp.loadStaffTable();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    async saveStaffChanges() {
      const msgEl = document.getElementById("adminStaffMessage");
      const dirtyRows = (AdminApp.staffDraft || []).filter((r) => r._dirty);
      if (!dirtyRows.length) {
        UI.setMessage(msgEl, "변경된 내용이 없습니다.");
        return;
      }

      try {
        await UI.withLoading(async () => {
          for (const row of dirtyRows) {
            if (row._isNew) {
              const payload = {
                department: String(row.department || "").trim(),
                name: String(row.name || "").trim(),
                position: String(row.position || "").trim(),
                staffRank: String(row.staffRank || "").trim(),
                name: String(row.name || "").trim(),
                remarks: String(row.remarks || "").trim(),
                active: row.active || "Y",
              };
              if (!payload.department || !payload.name) {
                throw new Error("구성원 추가/수정 시 부서와 성명은 필수입니다.");
              }
              await Api.call("addStaff", payload, true);
            } else {
              const payload = {
                staffId: row.staffId,
                department: String(row.department || "").trim(),
                position: String(row.position || "").trim(),
                staffRank: String(row.staffRank || "").trim(),
                name: String(row.name || "").trim(),
                remarks: String(row.remarks || "").trim(),
                active: row.active || "Y",
              };
              if (!payload.staffId) throw new Error("수정 대상 staffId가 없습니다.");
              if (!payload.department || !payload.name) {
                throw new Error("수정 시 부서와 성명은 필수입니다.");
              }
              await Api.call("updateStaff", payload, true);
            }
          }
        }, "저장 중…");

        UI.setMessage(msgEl, "저장되었습니다.");
        await AdminApp.loadStaffTable();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
        UI.toastMsg(err.message, true);
      }
    },

    async deleteStaff(staffId) {
      if (!confirm("이 구성원을 삭제하시겠습니까?")) return;
      try {
        await Api.call("deleteStaff", { staffId }, true);
        UI.toastMsg("삭제되었습니다.");
        AdminApp.lastAddedStaff = null;
        await AdminApp.loadStaffTable();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    async resetStaffList() {
      if (!confirm("현재 구성원 명단을 모두 비우시겠습니까?")) return;
      try {
        const result = await UI.withLoading(
          () =>
            Api.call(
              "uploadStaffCsv",
              { csvText: "부서,직위,담당업무,성함,비고\n", overwrite: true },
              true
            ),
          "초기화 중…"
        );
        UI.toastMsg(
          `구성원 명단이 초기화되었습니다.${
            result.added ? ` (유지/추가: ${result.added}명)` : ""
          }`
        );
        AdminApp.lastAddedStaff = null;
        await AdminApp.loadStaffTable();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    downloadStaffCsvTemplate() {
      const lines = [
        "부서,직위,담당업무,성함,비고",
        "교무기획부,교사,,홍길동,",
        "1학년부,교사,1반 담임,김철수,",
        "1학년부,교사,2반 담임,이영희,",
        "교육연구부,교사,부장,박민수,",
      ];
      const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "구성원명단_양식.csv";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      UI.toastMsg("기본 양식을 다운로드했습니다.");
    },

    openCsvPicker() {
      const fileInput = document.getElementById("staffCsvFile");
      const msgEl = document.getElementById("adminCsvMessage");
      if (fileInput) fileInput.value = "";
      UI.setMessage(msgEl, "");
      fileInput?.click();
    },

    async uploadCsv() {
      const fileInput = document.getElementById("staffCsvFile");
      const msgEl = document.getElementById("adminCsvMessage");
      const file = fileInput?.files?.[0];
      if (!file) {
        return;
      }
      const overwrite = false;

      const text = await file.text();
      try {
        const result = await UI.withLoading(
          () => Api.call("uploadStaffCsv", { csvText: text, overwrite }, true),
          "업로드 중…"
        );
        UI.setMessage(
          msgEl,
          `완료: ${result.added}명 등록${result.errors?.length ? ` · 오류 ${result.errors.length}건` : ""}`
        );
        if (result.errors?.length) console.warn("CSV 오류:", result.errors);
        AdminApp.lastAddedStaff = null;
        await AdminApp.loadStaffTable();
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    fillEventSelects() {
      if (AdminApp.isWorkshopAdmin()) return;
      ["adminStatusEventSelect", "adminPrintEventSelect"].forEach((id) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '<option value="">선택</option>';
        AdminApp.events.forEach((ev) => {
          const o = document.createElement("option");
          o.value = ev.eventId;
          o.textContent = ev.title;
          sel.appendChild(o);
        });
      });
    },

    onSignedTableClick(e) {
      const btn = e.target.closest("[data-action='delete-signature']");
      if (!btn) return;
      AdminApp.deleteSignature({
        staffId: btn.dataset.staffId || "",
        department: btn.dataset.department || "",
        name: btn.dataset.name || "",
      });
    },

    async loadWorkshopAdminData() {
      try {
        const info = await Api.call("getWorkshopInfo", {}, true);
        AdminApp.workshopEventId = info.eventId;
        await AdminApp.loadStatus();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    async deleteSignature(target) {
      const eventId = AdminApp.isWorkshopAdmin()
        ? AdminApp.workshopEventId
        : document.getElementById("adminStatusEventSelect")?.value;
      if (!eventId) {
        UI.toastMsg("연수를 먼저 선택해 주세요.", true);
        return;
      }
      const label = `${target.department} ${target.name}`.trim();
      const confirmMsg = AdminApp.isWorkshopAdmin()
        ? `${label} 선생님의 서명을 삭제하시겠습니까?`
        : `${label} 선생님의 서명을 삭제하시겠습니까?\n삭제 후에는 미서명자로 표시됩니다.`;
      if (!confirm(confirmMsg)) {
        return;
      }
      try {
        await UI.withLoading(
          () =>
            Api.call(
              "deleteSignature",
              {
                eventId,
                staffId: target.staffId,
                department: target.department,
                name: target.name,
              },
              true
            ),
          "삭제 중…"
        );
        UI.toastMsg("서명이 삭제되었습니다.");
        await AdminApp.loadStatus();
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    async loadStatus() {
      let eventId = document.getElementById("adminStatusEventSelect")?.value;
      if (AdminApp.isWorkshopAdmin()) {
        if (!AdminApp.workshopEventId) {
          await AdminApp.loadWorkshopAdminData();
          return;
        }
        eventId = AdminApp.workshopEventId;
      }
      if (!eventId) return;
      try {
        const data = await UI.withLoading(
          () => Api.call("getSignatureStatus", { eventId }, true),
          "현황 불러오는 중…"
        );
        const workshop = AdminApp.isWorkshopAdmin();
        document.getElementById("adminStatusSummary").hidden = false;
        document.getElementById("statTotal").textContent = data.total;
        document.getElementById("statSigned").textContent = data.signedCount;
        document.getElementById("statUnsigned").textContent = data.unsignedCount;

        const signedBody = document.getElementById("adminSignedTableBody");
        signedBody.innerHTML = "";
        (data.signed || []).forEach((r) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${escapeHtml(r.department)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.timestamp || "")}</td>
            <td><img class="sig-thumb" src="${r.signatureData}" alt="서명" /></td>
            <td>
              <button type="button" class="icon-btn icon-btn--xs" data-action="delete-signature"
                data-staff-id="${escapeHtml(r.staffId || "")}"
                data-department="${escapeHtml(r.department)}"
                data-name="${escapeHtml(r.name)}"
                aria-label="${escapeHtml(r.department)} ${escapeHtml(r.name)} 서명 삭제">×</button>
            </td>
          `;
          signedBody.appendChild(tr);
        });
        document.getElementById("adminSignedCard").hidden = false;

        const unsignedBody = document.getElementById("adminUnsignedTableBody");
        unsignedBody.innerHTML = "";
        if (!workshop) {
          (data.unsigned || []).forEach((r) => {
            const tr = document.createElement("tr");
            tr.innerHTML = `
            <td>${escapeHtml(r.department)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.position || "")}</td>
          `;
            unsignedBody.appendChild(tr);
          });
        }
        document.getElementById("adminUnsignedCard").hidden = workshop || !(data.unsigned || []).length;
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    async loadPrint() {
      let eventId = document.getElementById("adminPrintEventSelect")?.value;
      if (AdminApp.isWorkshopAdmin()) {
        if (!AdminApp.workshopEventId) {
          try {
            const info = await Api.call("getWorkshopInfo", {}, true);
            AdminApp.workshopEventId = info.eventId;
          } catch (err) {
            UI.toastMsg(err.message, true);
            return;
          }
        }
        eventId = AdminApp.workshopEventId;
      }
      if (!eventId) {
        UI.toastMsg("연수를 선택해 주세요.", true);
        return;
      }
      try {
        const data = await UI.withLoading(
          () => Api.call("getPrintableRegister", { eventId }, true),
          "등록부 생성 중…"
        );
        AdminApp.renderPrintRegister(data);
        document.getElementById("printRegisterArea").hidden = false;
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    renderPrintRegister(data) {
      const contentParts = [data.title, data.description].filter(Boolean);
      const uniqueContent = [...new Set(contentParts)];
      document.getElementById("printTrainingContent").textContent =
        uniqueContent.join(", ") || "-";

      const datetimeParts = [formatPrintDatetime(data.date)];
      if (data.location) datetimeParts.push(data.location);
      document.getElementById("printTrainingDatetime").textContent =
        datetimeParts.filter(Boolean).join(" · ") || "-";

      const rows = sortRegisterRows(data.rows || []);
      const tbody = document.getElementById("printTableBody");
      tbody.innerHTML = "";

      const signedCount = rows.filter((r) => !!String(r.signatureData || "").trim()).length;
      const unsignedCount = Math.max(0, rows.length - signedCount);
      const summaryEl = document.getElementById("printSignatureSummary");
      if (summaryEl) {
        summaryEl.textContent = data.workshopMode
          ? `참가 ${rows.length}명`
          : `총 ${rows.length}명 · 서명 ${signedCount}명 · 미서명 ${unsignedCount}명`;
      }

      document.querySelectorAll("#printRegisterArea thead th").forEach((th) => {
        if (th.textContent.trim() === "부서") {
          th.textContent = data.workshopMode ? "학교" : "부서";
        }
      });

      const half = Math.ceil(rows.length / 2);
      const leftRows = rows.slice(0, half);
      const rightRows = rows.slice(half);

      for (let i = 0; i < half; i++) {
        const tr = document.createElement("tr");
        const left = leftRows[i] || null;
        const right = rightRows[i] || null;

        tr.innerHTML = `
          ${AdminApp.renderPrintRowCells(left, i + 1)}
          ${AdminApp.renderPrintRowCells(right, half + i + 1)}
        `;
        tbody.appendChild(tr);
      }

      document.getElementById("printAttendeeCount").textContent = `${rows.length} 명`;
      document.getElementById("printSignedCount").textContent = data.workshopMode
        ? `${rows.length} 명`
        : `${signedCount} 명`;
      document.getElementById("printUnsignedCount").textContent = data.workshopMode
        ? "-"
        : `${unsignedCount} 명`;
    },

    renderPrintRowCells(row, num) {
      if (!row) {
        return "<td></td><td></td><td></td><td></td><td></td><td></td>";
      }
      const sigHtml = safeSignatureImg(row.signatureData);
      return `
        <td>${num}</td>
        <td>${escapeHtml(row.department || "")}</td>
        <td>${escapeHtml(row.position || "")}</td>
        <td>${escapeHtml(row.name || "")}</td>
        <td class="print-sig-cell">${sigHtml}</td>
        <td></td>
      `;
    },
  };

  /* ─────────────────────────────────────────
   * 뷰 전환 · 초기화
   * ───────────────────────────────────────── */
  function switchMainView(view) {
    const staffPanel = document.getElementById("staffPanel");
    const adminPanel = document.getElementById("adminPanel");
    if (!staffPanel || !adminPanel) {
      console.error("싸인온: staffPanel 또는 adminPanel을 찾을 수 없습니다.");
      return;
    }

    const nextView = view === "admin" ? "admin" : "staff";

    document.querySelectorAll(".main-nav__tab").forEach((t) => {
      t.classList.toggle("is-active", t.dataset.view === nextView);
      t.setAttribute("aria-selected", t.dataset.view === nextView ? "true" : "false");
    });

    document.body.classList.toggle("view-admin", nextView === "admin");
    staffPanel.hidden = nextView !== "staff";
    adminPanel.hidden = nextView !== "admin";

    if (nextView === "admin" && typeof AdminApp !== "undefined") {
      AdminApp.applySchoolGateState();
      if (Api.getAdminToken()) AdminApp.applyWorkshopAdminLayout();
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function initNavigation() {
    document.querySelectorAll(".main-nav__tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        switchMainView(tab.dataset.view || "staff");
      });
    });
    switchMainView("staff");
  }

  function normalizeSchoolName(raw) {
    let s = String(raw || "")
      .trim()
      .replace(/\s+/g, "");
    if (!s) return "";
    s = s.replace(/중학교$/u, "중");
    s = s.replace(/고등학교$/u, "고");
    return s;
  }

  function escapeHtml(str) {
    if (str == null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function statusClass(status) {
    if (status === "진행중") return "active";
    if (status === "마감") return "closed";
    return "archived";
  }

  // 구성원·등록부에서 사용할 부서 정렬 우선순위
  const DEPARTMENT_ORDER = [
    "교장",
    "교감",
    "교무기획부",
    "교육연구부",
    "교육과정부",
    "학생인권자치부",
    "인문사회부",
    "수리과학부",
    "교육정보부",
    "진로진학부",
    "예술체육부",
    "1학년부",
    "2학년부",
    "3학년부",
  ];

  function getDepartmentRank(name) {
    const key = String(name || "").trim();
    const gradeMatch = key.match(/^([123])학년부$/);
    // 1/2/3학년부는 항상 마지막으로 보낸다.
    if (gradeMatch) return 9000 + parseInt(gradeMatch[1], 10);

    const idx = DEPARTMENT_ORDER.indexOf(key);
    // 미지정 부서는 고정 우선순위 부서 뒤, 학년부 앞에 배치
    return idx === -1 ? 5000 : idx;
  }

  function isDepartmentHead(row) {
    return String(row.staffRank || "").trim() === "부장";
  }

  function isGradeDepartment(dept) {
    return /^\d학년부$/.test(String(dept || "").trim());
  }

  /** 담당업무에서 학년부 담임 반 번호 추출 (예: 1반 담임 → 1) */
  function getHomeroomClassOrder(row) {
    const rank = String(row.staffRank || "").trim();
    if (rank === "부장") return 0;
    const m = rank.match(/(\d+)\s*반/);
    if (m) return parseInt(m[1], 10);
    return 999;
  }

  /** 같은 부서 내: 부장 맨 위 → 학년부는 반 순 → (신규 추가는 맨 아래) → 성명순 */
  function compareWithinDepartmentRows(a, b, last) {
    const headA = isDepartmentHead(a) ? 0 : 1;
    const headB = isDepartmentHead(b) ? 0 : 1;
    if (headA !== headB) return headA - headB;

    const deptKey = getStaffDepartmentKey(a);
    if (isGradeDepartment(deptKey)) {
      const classA = getHomeroomClassOrder(a);
      const classB = getHomeroomClassOrder(b);
      if (classA !== classB) return classA - classB;
    }

    if (last && deptKey === last.department) {
      if (a.staffId === last.staffId) return 1;
      if (b.staffId === last.staffId) return -1;
    }

    return (a.name || "").localeCompare(b.name || "", "ko");
  }

  /** 등록부·명단 공통: 부서 필드가 비어 있으면 직위가 교장/교감 등인 경우 보정 */
  function getStaffDepartmentKey(row) {
    const dept = String(row.department || "").trim();
    if (dept) return dept;
    const pos = String(row.position || "").trim();
    if (DEPARTMENT_ORDER.indexOf(pos) >= 0) return pos;
    return dept;
  }

  function sortRegisterRows(rows) {
    return [...rows].sort((a, b) => {
      const deptA = getStaffDepartmentKey(a);
      const deptB = getStaffDepartmentKey(b);
      const da = getDepartmentRank(deptA);
      const db = getDepartmentRank(deptB);
      const deptCmp = da !== db ? da - db : deptA.localeCompare(deptB, "ko");
      if (deptCmp !== 0) return deptCmp;
      return compareWithinDepartmentRows(a, b, null);
    });
  }

  function groupRowsByDepartment(rows) {
    const groups = [];
    rows.forEach((row) => {
      const department = row.department || "";
      const last = groups[groups.length - 1];
      if (last && last.department === department) {
        last.rows.push(row);
      } else {
        groups.push({ department, rows: [row] });
      }
    });
    return groups;
  }

  function safeSignatureImg(signatureData) {
    const src = String(signatureData || "");
    if (!src.startsWith("data:image/")) return "";
    return `<img class="print-sig" src="${src}" alt="" />`;
  }

  function formatPrintDatetime(dateStr) {
    if (!dateStr) return "";
    const normalized = String(dateStr).trim().slice(0, 10);
    const parts = normalized.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) return dateStr;
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(date.getTime())) return dateStr;
    const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
    return `${parts[0]}. ${parts[1]}. ${parts[2]}(${weekdays[date.getDay()]})`;
  }

  document.addEventListener("DOMContentLoaded", () => {
    try {
      initNavigation();
      StaffApp.init();
      AdminApp.init();
      AppConfig.applyFlowModeUi();
    } catch (err) {
      console.error("싸인온 초기화 오류:", err);
      UI?.toastMsg?.("페이지 초기화 중 오류가 발생했습니다. 새로고침해 주세요.", true);
    }
  });
})();
