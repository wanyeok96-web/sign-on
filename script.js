/**
 * 싸인온 Sign-On — 프론트엔드
 * 민감 정보 없음 · Apps Script action API 통신
 */
(function () {
  "use strict";

  const CONFIG = window.SCHOOL_CONFIG || {};
  const STORAGE_KEY = "signon_admin_token";

  /* ─────────────────────────────────────────
   * API 클라이언트
   * ───────────────────────────────────────── */
  const Api = {
    get baseUrl() {
      const url = (CONFIG.gasWebAppUrl || "").trim();
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
  };

  /* ─────────────────────────────────────────
   * 서명 패드 (Canvas)
   * ───────────────────────────────────────── */
  const SignaturePad = {
    canvas: null,
    ctx: null,
    drawing: false,
    hasStroke: false,

    init(canvasEl) {
      SignaturePad.canvas = canvasEl;
      SignaturePad.ctx = canvasEl.getContext("2d");
      SignaturePad.resize();
      window.addEventListener("resize", () => SignaturePad.resize());

      const start = (e) => {
        e.preventDefault();
        SignaturePad.drawing = true;
        SignaturePad.hasStroke = true;
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
      };

      const end = () => {
        SignaturePad.drawing = false;
        StaffApp.validateSubmitButton();
      };

      canvasEl.addEventListener("mousedown", start);
      canvasEl.addEventListener("mousemove", move);
      canvasEl.addEventListener("mouseup", end);
      canvasEl.addEventListener("mouseleave", end);
      canvasEl.addEventListener("touchstart", start, { passive: false });
      canvasEl.addEventListener("touchmove", move, { passive: false });
      canvasEl.addEventListener("touchend", end);
    },

    resize() {
      const c = SignaturePad.canvas;
      if (!c) return;
      const rect = c.getBoundingClientRect();
      const ratio = window.devicePixelRatio || 1;
      c.width = rect.width * ratio;
      c.height = rect.height * ratio;
      const ctx = SignaturePad.ctx;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.scale(ratio, ratio);
      ctx.strokeStyle = "#0f172a";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      SignaturePad.hasStroke = false;
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
      SignaturePad.ctx.clearRect(0, 0, c.width, c.height);
      SignaturePad.hasStroke = false;
      StaffApp.validateSubmitButton();
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
      eventId: "",
      department: "",
      staffId: "",
      name: "",
      position: "",
    },

    init() {
      const schoolEl = document.getElementById("heroSchoolName");
      if (schoolEl && CONFIG.schoolName) schoolEl.textContent = CONFIG.schoolName;

      SignaturePad.init(document.getElementById("signatureCanvas"));
      document.getElementById("btnClearSignature")?.addEventListener("click", () => SignaturePad.clear());

      document.getElementById("staffEventSelect")?.addEventListener("change", StaffApp.onEventChange);
      document.getElementById("staffDeptSelect")?.addEventListener("change", StaffApp.onDeptChange);
      document.getElementById("staffNameSelect")?.addEventListener("change", StaffApp.onNameChange);
      document.getElementById("btnStaffSubmit")?.addEventListener("click", StaffApp.onSubmitClick);
      document.getElementById("btnStaffAnother")?.addEventListener("click", StaffApp.resetFlow);

      document.getElementById("btnConfirmCancel")?.addEventListener("click", () => UI.closeModal("confirmModal"));
      document.getElementById("btnConfirmSubmit")?.addEventListener("click", StaffApp.doSubmit);
      document.getElementById("btnOverwriteCancel")?.addEventListener("click", () => UI.closeModal("overwriteModal"));
      document.getElementById("btnOverwriteOk")?.addEventListener("click", () => {
        UI.closeModal("overwriteModal");
        StaffApp.doSubmit(true);
      });

      StaffApp.loadEvents();
    },

    async loadEvents() {
      const sel = document.getElementById("staffEventSelect");
      try {
        const events = await UI.withLoading(() => Api.call("getEvents"), "연수 목록 불러오는 중…");
        StaffApp.events = events || [];
        sel.innerHTML = '<option value="">연수·회의를 선택해 주세요</option>';
        StaffApp.events.forEach((ev) => {
          const opt = document.createElement("option");
          opt.value = ev.eventId;
          opt.textContent = `${ev.title} (${ev.date || ""})`;
          opt.dataset.ev = JSON.stringify(ev);
          sel.appendChild(opt);
        });
        if (StaffApp.events.length === 0) {
          sel.innerHTML = '<option value="">진행 중인 연수가 없습니다</option>';
        }
      } catch (err) {
        sel.innerHTML = '<option value="">목록을 불러올 수 없습니다</option>';
        UI.toastMsg(err.message, true);
      }
    },

    onEventChange() {
      const sel = document.getElementById("staffEventSelect");
      const opt = sel.selectedOptions[0];
      StaffApp.state.eventId = sel.value;
      StaffApp.state.department = "";
      StaffApp.state.staffId = "";
      StaffApp.markStep(1, !!sel.value);

      const preview = document.getElementById("staffEventPreview");
      if (opt?.dataset.ev) {
        const ev = JSON.parse(opt.dataset.ev);
        preview.hidden = false;
        preview.innerHTML = `<strong>${escapeHtml(ev.title)}</strong><br>
          날짜: ${escapeHtml(ev.date || "-")} · 장소: ${escapeHtml(ev.location || "-")}<br>
          ${escapeHtml(ev.description || "")}`;
        if (ev.status === "마감") {
          UI.toastMsg("이 연수는 마감되어 추가 제출이 불가합니다.", true);
        }
      } else {
        preview.hidden = true;
      }

      StaffApp.loadStaffForEvent();
      StaffApp.resetDeptName();
    },

    async loadStaffForEvent() {
      if (!StaffApp.state.eventId) return;
      try {
        StaffApp.staffPool = await Api.call("getStaffForEvent", {
          eventId: StaffApp.state.eventId,
        });
        const depts = [...new Set(StaffApp.staffPool.map((s) => s.department))].sort();
        const deptSel = document.getElementById("staffDeptSelect");
        deptSel.disabled = false;
        deptSel.innerHTML = '<option value="">부서를 선택해 주세요</option>';
        depts.forEach((d) => {
          const o = document.createElement("option");
          o.value = d;
          o.textContent = d;
          deptSel.appendChild(o);
        });
        StaffApp.markStep(2, false);
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    onDeptChange() {
      const dept = document.getElementById("staffDeptSelect").value;
      StaffApp.state.department = dept;
      StaffApp.state.staffId = "";
      const nameSel = document.getElementById("staffNameSelect");
      nameSel.innerHTML = '<option value="">이름을 선택해 주세요</option>';
      if (!dept) {
        nameSel.disabled = true;
        StaffApp.markStep(2, false);
        StaffApp.markStep(3, false);
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
      StaffApp.markStep(2, true);
      StaffApp.markStep(3, false);
      StaffApp.validateSubmitButton();
    },

    onNameChange() {
      const nameSel = document.getElementById("staffNameSelect");
      const opt = nameSel.selectedOptions[0];
      if (opt?.dataset.staff) {
        const s = JSON.parse(opt.dataset.staff);
        StaffApp.state.staffId = s.staffId;
        StaffApp.state.name = s.name;
        StaffApp.state.position = s.position || "";
        StaffApp.selectedStaff = s;
        StaffApp.markStep(3, true);
      } else {
        StaffApp.state.staffId = "";
        StaffApp.markStep(3, false);
      }
      StaffApp.validateSubmitButton();
    },

    resetDeptName() {
      const deptSel = document.getElementById("staffDeptSelect");
      const nameSel = document.getElementById("staffNameSelect");
      deptSel.innerHTML = '<option value="">연수를 먼저 선택해 주세요</option>';
      deptSel.disabled = true;
      nameSel.innerHTML = '<option value="">부서를 먼저 선택해 주세요</option>';
      nameSel.disabled = true;
    },

    markStep(num, complete) {
      const card = document.getElementById(`staffStep${num}`);
      const badge = card?.querySelector(".step-badge");
      if (complete) {
        card?.classList.add("is-complete");
        card?.classList.remove("is-active");
        badge?.classList.add("is-complete");
      } else if (num === 1 || StaffApp.isStepReachable(num)) {
        card?.classList.add("is-active");
        card?.classList.remove("is-complete");
        badge?.classList.remove("is-complete");
      }
    },

    isStepReachable(num) {
      if (num <= 1) return true;
      if (num === 2) return !!StaffApp.state.eventId;
      if (num === 3) return !!StaffApp.state.department;
      if (num === 4) return !!StaffApp.state.staffId;
      return false;
    },

    validateSubmitButton() {
      const btn = document.getElementById("btnStaffSubmit");
      const ok =
        StaffApp.state.eventId &&
        StaffApp.state.staffId &&
        !SignaturePad.isEmpty();
      if (btn) btn.disabled = !ok;
    },

    async onSubmitClick() {
      if (!StaffApp.state.eventId || !StaffApp.state.staffId) {
        UI.toastMsg("연수, 부서, 이름을 모두 선택해 주세요.", true);
        return;
      }
      if (SignaturePad.isEmpty()) {
        UI.toastMsg("서명을 입력해 주세요.", true);
        return;
      }

      const ev = StaffApp.events.find((e) => e.eventId === StaffApp.state.eventId);
      if (ev?.status === "마감") {
        UI.toastMsg("마감된 연수에는 제출할 수 없습니다.", true);
        return;
      }

      try {
        const check = await Api.call("checkSignature", {
          eventId: StaffApp.state.eventId,
          staffId: StaffApp.state.staffId,
        });
        if (check.exists) {
          UI.openModal("overwriteModal");
          return;
        }
      } catch (err) {
        UI.toastMsg(err.message, true);
        return;
      }

      StaffApp.showConfirmModal();
    },

    showConfirmModal() {
      const text = document.getElementById("confirmModalText");
      text.textContent = `${StaffApp.state.department} ${StaffApp.state.name} 선생님,\n서명을 제출하시겠습니까?`;
      UI.openModal("confirmModal");
    },

    async doSubmit(skipCheck) {
      UI.closeModal("confirmModal");
      UI.closeModal("overwriteModal");
      const msgEl = document.getElementById("staffSubmitMessage");

      try {
        await UI.withLoading(
          () =>
            Api.call("submitSignature", {
              eventId: StaffApp.state.eventId,
              staffId: StaffApp.state.staffId,
              department: StaffApp.state.department,
              name: StaffApp.state.name,
              position: StaffApp.state.position,
              signatureData: SignaturePad.toDataUrl(),
              overwrite: !!skipCheck,
            }),
          "제출 중…"
        );
        document.getElementById("staffFormStack").hidden = true;
        document.getElementById("staffSuccessCard").hidden = false;
        UI.setMessage(msgEl, "");
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
        UI.toastMsg(err.message, true);
      }
    },

    resetFlow() {
      StaffApp.state = { eventId: "", department: "", staffId: "", name: "", position: "" };
      SignaturePad.clear();
      document.getElementById("staffFormStack").hidden = false;
      document.getElementById("staffSuccessCard").hidden = true;
      document.getElementById("staffEventSelect").value = "";
      StaffApp.resetDeptName();
      StaffApp.loadEvents();
      ["staffStep1", "staffStep2", "staffStep3", "staffStep4"].forEach((id, i) => {
        const card = document.getElementById(id);
        card?.classList.toggle("is-active", i === 0);
        card?.classList.remove("is-complete");
        card?.querySelector(".step-badge")?.classList.remove("is-complete");
      });
      StaffApp.validateSubmitButton();
    },
  };

  /* ─────────────────────────────────────────
   * 관리자 페이지
   * ───────────────────────────────────────── */
  const AdminApp = {
    events: [],
    staffList: [],
    staffDraft: [],
    lastAddedStaff: null,

    init() {
      document.getElementById("btnAdminLogin")?.addEventListener("click", AdminApp.login);
      document.getElementById("btnAdminLogout")?.addEventListener("click", AdminApp.logout);
      document.getElementById("adminPassword")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") AdminApp.login();
      });

      document.querySelectorAll(".admin-menu__item").forEach((btn) => {
        btn.addEventListener("click", () => AdminApp.switchTab(btn.dataset.adminTab));
      });

      document.getElementById("adminEventForm")?.addEventListener("submit", AdminApp.saveEvent);
      document.getElementById("btnAdminEventReset")?.addEventListener("click", AdminApp.resetEventForm);
      document.getElementById("adminEventTargetType")?.addEventListener("change", AdminApp.onTargetTypeChange);

      document.getElementById("adminEventModalForm")?.addEventListener("submit", AdminApp.saveEventModal);
      document.getElementById("btnEventModalClose")?.addEventListener("click", AdminApp.closeEventModal);
      document.getElementById("btnEventModalDelete")?.addEventListener("click", AdminApp.deleteEventModal);
      document.getElementById("modalEventTargetType")?.addEventListener("change", AdminApp.onModalTargetTypeChange);
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
      document.getElementById("btnLoadPrint")?.addEventListener("click", AdminApp.loadPrint);
      document.getElementById("btnPrintRegister")?.addEventListener("click", () => window.print());

      if (Api.getAdminToken()) AdminApp.showDashboard();
    },

    async login() {
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
      } catch (err) {
        UI.setMessage(msgEl, err.message, true);
      }
    },

    logout() {
      Api.setAdminToken("");
      document.getElementById("adminLoginCard").hidden = false;
      document.getElementById("adminDashboard").hidden = true;
      document.getElementById("adminPassword").value = "";
    },

    showDashboard() {
      document.getElementById("adminLoginCard").hidden = true;
      document.getElementById("adminDashboard").hidden = false;
      AdminApp.refreshAll();
    },

    async refreshAll() {
      await AdminApp.loadAdminEvents();
      await AdminApp.loadStaffTable();
      AdminApp.fillEventSelects();
    },

    switchTab(tab) {
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

    onTargetTypeChange() {
      const type = document.getElementById("adminEventTargetType").value;
      const field = document.getElementById("adminTargetDataField");
      const hint = document.getElementById("adminTargetHint");
      if (type === "all") {
        field.hidden = true;
        return;
      }
      field.hidden = false;
      hint.textContent =
        type === "departments"
          ? "부서명을 쉼표(,)로 구분해 입력 (예: 교무, 학생, 행정)"
          : "staffId를 쉼표(,)로 구분해 입력";
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
      document.getElementById("modalEventTargetType").value = ev.targetType || "all";
      document.getElementById("modalEventTargetData").value = ev.targetData || "";
      UI.setMessage(document.getElementById("adminEventModalMessage"), "");
      AdminApp.onModalTargetTypeChange();
      UI.openModal("eventDetailModal");
    },

    closeEventModal() {
      UI.closeModal("eventDetailModal");
      UI.setMessage(document.getElementById("adminEventModalMessage"), "");
    },

    onModalTargetTypeChange() {
      const type = document.getElementById("modalEventTargetType").value;
      const field = document.getElementById("modalTargetDataField");
      const hint = document.getElementById("modalTargetHint");
      if (type === "all") {
        field.hidden = true;
        return;
      }
      field.hidden = false;
      hint.textContent =
        type === "departments"
          ? "부서명을 쉼표(,)로 구분해 입력 (예: 교무, 학생, 행정)"
          : "staffId를 쉼표(,)로 구분해 입력";
    },

    getEventModalPayload() {
      return {
        eventId: document.getElementById("modalEventId").value,
        title: document.getElementById("modalEventTitle").value.trim(),
        date: document.getElementById("modalEventDate").value,
        location: document.getElementById("modalEventLocation").value.trim(),
        description: document.getElementById("modalEventDesc").value.trim(),
        status: document.getElementById("modalEventStatus").value,
        targetType: document.getElementById("modalEventTargetType").value,
        targetData: document.getElementById("modalEventTargetData").value.trim(),
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
      if (!payload.eventId) {
        UI.setMessage(msgEl, "연수 정보를 찾을 수 없습니다.", true);
        return;
      }
      try {
        await UI.withLoading(() => Api.call("updateEvent", payload, true), "저장 중…");
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
      document.getElementById("adminEventTargetType").value = "all";
      AdminApp.onTargetTypeChange();
      UI.setMessage(document.getElementById("adminEventMessage"), "");
    },

    async saveEvent(e) {
      e.preventDefault();
      const msgEl = document.getElementById("adminEventMessage");
      const payload = {
        title: document.getElementById("adminEventTitle").value.trim(),
        date: document.getElementById("adminEventDate").value,
        location: document.getElementById("adminEventLocation").value.trim(),
        description: document.getElementById("adminEventDesc").value.trim(),
        status: document.getElementById("adminEventStatus").value,
        targetType: document.getElementById("adminEventTargetType").value,
        targetData: document.getElementById("adminEventTargetData").value.trim(),
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

    async loadStatus() {
      const eventId = document.getElementById("adminStatusEventSelect").value;
      if (!eventId) return;
      try {
        const data = await UI.withLoading(
          () => Api.call("getSignatureStatus", { eventId }, true),
          "현황 불러오는 중…"
        );
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
          `;
          signedBody.appendChild(tr);
        });
        document.getElementById("adminSignedCard").hidden = false;

        const unsignedBody = document.getElementById("adminUnsignedTableBody");
        unsignedBody.innerHTML = "";
        (data.unsigned || []).forEach((r) => {
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${escapeHtml(r.department)}</td>
            <td>${escapeHtml(r.name)}</td>
            <td>${escapeHtml(r.position || "")}</td>
          `;
          unsignedBody.appendChild(tr);
        });
        document.getElementById("adminUnsignedCard").hidden = false;
      } catch (err) {
        UI.toastMsg(err.message, true);
      }
    },

    async loadPrint() {
      const eventId = document.getElementById("adminPrintEventSelect").value;
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

      let rowNum = 0;
      groupRowsByDepartment(rows).forEach((group) => {
        group.rows.forEach((row, index) => {
          const tr = document.createElement("tr");
          rowNum += 1;
          const sigHtml = safeSignatureImg(row.signatureData);
          const deptCell =
            index === 0
              ? `<td rowspan="${group.rows.length}">${escapeHtml(group.department)}</td>`
              : "";
          tr.innerHTML = `
            <td>${rowNum}</td>
            ${deptCell}
            <td>${escapeHtml(row.position || "")}</td>
            <td>${escapeHtml(row.name)}</td>
            <td class="print-sig-cell">${sigHtml}</td>
            <td></td>
          `;
          tbody.appendChild(tr);
        });
      });

      document.getElementById("printAttendeeCount").textContent = `${rows.length} 명`;
    },
  };

  /* ─────────────────────────────────────────
   * 뷰 전환 · 초기화
   * ───────────────────────────────────────── */
  function initNavigation() {
    const staffPanel = document.getElementById("staffPanel");
    const adminPanel = document.getElementById("adminPanel");

    document.querySelectorAll(".main-nav__tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        document.querySelectorAll(".main-nav__tab").forEach((t) => t.classList.remove("is-active"));
        tab.classList.add("is-active");
        const view = tab.dataset.view;
        document.body.classList.toggle("view-admin", view === "admin");
        staffPanel.hidden = view !== "staff";
        adminPanel.hidden = view !== "admin";
      });
    });
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
    const idx = DEPARTMENT_ORDER.indexOf(String(name || ""));
    return idx === -1 ? 999 : idx;
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
    initNavigation();
    StaffApp.init();
    AdminApp.init();
  });
})();
