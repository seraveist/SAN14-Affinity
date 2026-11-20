(() => {
  "use strict";
  const { SAN14, SAN14_DATA } = window;
  const $ = (selector) => document.querySelector(selector);
  const { escape, badge, options, createFeedback } = SAN14.ui;
  const feedback = createFeedback(document);
  const data = SAN14_DATA;
  if (!data?.officers || !Array.isArray(data.edges)) {
    const error = document.createElement("p");
    error.className = "notice";
    error.textContent = "장수 데이터를 불러오지 못했습니다. 페이지를 다시 열어 주세요.";
    $("#rosterForm").replaceWith(error);
    document.querySelectorAll(".topbar button, #dataButton").forEach((control) => { control.disabled = true; });
    return;
  }

  const model = SAN14.createModel(data);
  const roster = SAN14.createRoster(model);
  const planner = SAN14.createPlanner(model, roster);
  const recommendationEngine = SAN14.createRecommendations(model, planner);
  const campaign = SAN14.createCampaign(model, planner);
  const formationView = SAN14.createFormationView(model, planner, campaign);
  const nameInput = $("#rosterInput");
  const coreInput = $("#coreInput");
  const countInput = $("#groupCount");
  const workspace = $("#workspace");
  const defaultConditions = () => ({ army: false, status: false, range: "unknown" });
  const state = {
    review: null,
    selectedNames: new Map(),
    activeIds: [],
    signature: "",
    plan: null,
    stale: false,
    previous: null,
    notices: [],
    group: -1,
    relationId: null,
    panel: "group",
    moveId: null,
    comparison: null,
    alternativeCount: 1,
    recommendationContext: null,
    recommendations: [],
    recommendationStatus: "",
    recommendationPlan: null,
    recFilter: "all",
    recPurpose: "all",
    deploymentSelection: new Map(),
    deploymentConditions: defaultConditions(),
    deploymentSupportOpen: false,
  };
  let busy = false;
  const dex = SAN14.createDex(document, model, campaign, feedback, () => state.review?.ids ?? state.activeIds);
  const groupCounts = Array.from({ length: model.MAX_GROUP_COUNT }, (_, i) => [i + 1, (i + 1) + "집단"]);
  countInput.innerHTML += options(groupCounts, "");
  $("#presets").innerHTML = data.presets.map((row) =>
    `<button type="button" class="button quiet small" data-sample-roster="${escape(row.key)}">${escape(row.name.replace(/계$/, ""))}</button>`,
  ).join("");

  function signature() {
    return JSON.stringify([
      roster.parseNames(nameInput.value), roster.parseNames(coreInput.value), countInput.value,
      [...state.selectedNames].sort(([left], [right]) => left.localeCompare(right)),
    ]);
  }

  function activeWorkspaceTarget() {
    const active = document.activeElement;
    if (!workspace.contains(active)) return "";
    if (active.id) return "#" + CSS.escape(active.id);
    const attrs = ["action", "value", "deploy-id", "deploy-condition", "formation-id"];
    return attrs.filter((attr) => active.hasAttribute("data-" + attr))
      .map((attr) => `[data-${attr}="${CSS.escape(active.getAttribute("data-" + attr))}"]`).join("");
  }

  function renderWorkspace(focus) {
    const target = focus ?? activeWorkspaceTarget();
    const supports = workspace.querySelector("#deploymentSupport");
    if (state.panel === "deployment" && supports) state.deploymentSupportOpen = supports.open;
    workspace.innerHTML = formationView(state);
    if (target) workspace.querySelector(target)?.focus({ preventScroll: !focus });
  }

  function renderNameReview(focus) {
    const review = state.review;
    $("#nameReview").hidden = !review;
    $("#createPlan").disabled = busy || !review?.ids.length;
    if (review && !review.ids.length) nameInput.setAttribute("aria-invalid", "true");
    else nameInput.removeAttribute("aria-invalid");
    if (!review) return;
    const invalid = review.ids.length ? "" : "장수 이름을 하나 이상 확인하세요.";
    $("#reviewMessage").textContent = review.ids.length + "명 인식" + (invalid ? " · " + invalid : "");
    $("#reviewWarnings").hidden = !review.warnings.length;
    $("#reviewWarnings").innerHTML = review.warnings.map((message) => `<li>${escape(message)}</li>`).join("");
    $("#duplicateSelectors").innerHTML = review.selectors.map((row) => `<label>
      <strong>${escape(row.name)} · 입력 ${row.occurrence}</strong>
      <select data-duplicate-key="${escape(row.key)}">${options(
        row.candidates.map((id) => [id, model.displayName(id) + " · " + roster.statsLine(id)]),
        review.selections.get(row.key),
      )}</select></label>`).join("");
    if (focus) {
      const duplicate = $("#duplicateSelectors select");
      (duplicate ?? (review.ids.length ? $("#createPlan") : nameInput)).focus();
      feedback.announce(review.ids.length + "명을 확인했습니다.");
    }
  }

  function resetPanel() {
    state.panel = "group";
    state.relationId = null;
    state.moveId = null;
    state.comparison = null;
  }

  function setRosterEditor(open, focus = false) {
    $("#rosterForm").hidden = !open;
    $("#rosterCompact").hidden = open;
    $("#rosterCompactText").textContent = state.activeIds.length + "명";
    if (focus) nameInput.focus();
  }

  function invalidate() {
    const wasStale = state.stale;
    state.stale = !!state.plan && state.signature !== signature();
    if (state.stale && !wasStale) resetPanel();
    if (wasStale !== state.stale) renderWorkspace("");
  }

  function reviewNames(focus = false) {
    state.review = roster.resolveRoster(nameInput.value, state.selectedNames);
    state.selectedNames = new Map(state.review.selections);
    renderNameReview(focus);
    invalidate();
  }

  function installPlan(plan) {
    state.plan = plan;
    state.group = plan.groups.length ? Math.min(Math.max(state.group, 0), plan.groups.length - 1) : -1;
    resetPanel();
    state.recommendationPlan = null;
    state.deploymentSelection = new Map();
  }

  async function createPlan(event) {
    event.preventDefault();
    if (event.isComposing || busy) return;
    if (!state.review) {
      reviewNames(true);
      return;
    }
    reviewNames();
    if (!state.review.ids.length) return;
    const inputSignature = signature();
    const ids = [...state.review.ids];
    const resolved = roster.resolvePlanOptions(ids, countInput.value, coreInput.value, state.review);
    busy = true;
    $("#busyMessage").textContent = "편성을 계산하고 있습니다.";
    renderNameReview();
    await new Promise((resolve) => setTimeout(resolve, 24));
    try {
      const result = planner.planRoster(ids, resolved.options);
      if (signature() !== inputSignature) return;
      state.activeIds = ids;
      state.signature = inputSignature;
      state.stale = false;
      state.previous = null;
      state.notices = resolved.warnings;
      if (resolved.options.mode === "count" && result.groups.length !== resolved.options.targetCount) {
        state.notices.push("목표 " + resolved.options.targetCount + "집단 · 실제 " + result.groups.length + "집단이 만들어졌습니다.");
      }
      installPlan(campaign.snapshot(result, resolved.options));
      setRosterEditor(false);
      renderWorkspace("#currentTitle");
      feedback.announce(ids.length + "명의 편성 초안을 만들었습니다.");
    } catch (error) {
      console.error(error);
      feedback.announce("편성을 계산하지 못했습니다. 명단을 확인하고 다시 시도하세요.");
    } finally {
      busy = false;
      renderNameReview();
      $("#busyMessage").textContent = "";
    }
  }

  function openAnalysis(panel) {
    state.panel = panel;
    renderWorkspace("#analysisTitle");
  }

  function compareWith(after, title, origin, virtual = null, ids = []) {
    state.comparison = {
      before: state.plan, after, title, origin, virtual,
      diff: campaign.compare(state.plan, after, ids),
    };
    openAnalysis("compare");
  }

  function selectedGroup(group) {
    state.group = group;
    resetPanel();
    renderWorkspace("#groupTitle");
  }

  function showRecommendations(context = null) {
    state.recommendationContext = context;
    state.recFilter = "all";
    state.recPurpose = "all";
    const base = state.plan;
    if (state.recommendationPlan === base && state.recommendationStatus === "ready") {
      openAnalysis("recommendations");
      return;
    }
    if (state.recommendationPlan === base && state.recommendationStatus === "loading") {
      openAnalysis("recommendations");
      return;
    }
    state.recommendationStatus = "loading";
    state.recommendationPlan = base;
    state.recommendations = [];
    openAnalysis("recommendations");
    setTimeout(() => {
      if (state.plan !== base || state.stale) {
        if (state.recommendationPlan === base) state.recommendationPlan = null;
        return;
      }
      try {
        const rows = recommendationEngine.recommendOathSets(
          state.activeIds, { ...base.options, preserveRecommendationLayout: base.manual },
          base, model.RECOMMENDATION_LIMIT * 4,
        );
        state.recommendations = rows.map((row) => ({
          ...row, purpose: recommendationEngine.isSupportRecommendation(row) ? "support" : "formation",
        }));
        state.recommendationStatus = "ready";
      } catch (error) {
        console.error(error);
        state.recommendationStatus = "failed";
      }
      if (state.panel === "recommendations") renderWorkspace();
    }, 24);
  }

  function showDeployment(group) {
    state.deploymentSelection = new Map(state.plan.groups[group].slice(0, 5).map((id) => [id, ""]));
    state.deploymentConditions = defaultConditions();
    state.deploymentSupportOpen = false;
    openAnalysis("deployment");
  }

  function applyComparison() {
    const change = state.comparison;
    if (!change || change.virtual || change.before !== state.plan) return;
    const moving = change.origin === "move" ? state.moveId : null;
    state.previous = { plan: state.plan, group: state.group, count: countInput.value, notices: state.notices };
    if (change.origin === "count") {
      countInput.value = String(change.after.options.targetCount);
      state.signature = signature();
      state.notices = [];
    }
    installPlan(change.after);
    if (moving != null) state.group = campaign.memberIndex(state.plan, moving);
    renderWorkspace(moving == null ? "#currentTitle" : `[data-action="officer"][data-value="${moving}"]`);
    feedback.announce("변경안을 현재 편성에 반영했습니다.");
  }

  function undoPlan() {
    const previous = state.previous;
    if (!previous) return;
    state.previous = null;
    state.notices = previous.notices;
    countInput.value = previous.count;
    state.signature = signature();
    installPlan(previous.plan);
    state.group = previous.group;
    renderWorkspace("#groupTitle");
    feedback.announce("이전 편성을 복원했습니다.");
  }

  function copyDeployment() {
    const result = campaign.deployment(state.deploymentSelection);
    const conditions = state.deploymentConditions;
    const range = { unknown: "미확인", checked: "범위 내 확인", outside: "범위 밖 장수 있음" };
    const lines = [
      campaign.groupTitle(state.plan, state.group) + " 출진 후보",
      ...result.officers.map((row) => model.displayName(row.id) + " · " + (row.formation || "진형 미선택")),
      "같은 군단 " + (conditions.army ? "확인" : "미확인") + " · 상태이상 없음 " + (conditions.status ? "확인" : "미확인") + " · 거리 " + range[conditions.range],
    ];
    feedback.copy(lines.join("\n"), "출진 후보");
  }

  function dataDialog() {
    const evidence = data.relationshipEvidence;
    const source = data.ceAffinity?.metadata;
    const list = (rows, format) => `<ul class="compact-list data-list">${rows.map((row) => `<li>${escape(format(row))}</li>`).join("")}</ul>`;
    const name = model.displayName;
    const groups = [
      ["대상 ID 누락", evidence.missing.filter((row) => row.relation !== "X"), (row) => name(row.source) + " → " + row.targetName + " " + row.relation],
      ["동명이인 후보", evidence.ambiguous.filter((row) => row.relation !== "X"), (row) => name(row.source) + " → " + row.targets.map(name).join(", ") + " " + row.relation],
      ["원본 등급 상충", evidence.conflicts, (row) => name(row.source) + " → " + name(row.target) + " · " + row.grades.join(", ")],
    ];
    feedback.openDialog("데이터 근거", `
      <div class="chips">${badge(model.officers.size + "명")}${badge(source?.label ?? "CE 친애 자료 미확인")}${badge("CE 개성 대조 · " + data.ceTraits.metadata.checkedOn)}</div>
      <p class="subhead">개인 친애 방향과 혈연은 CE 시나리오 장수 ID로 확인했습니다. ☆·◎·○는 기존 편성 자료의 연계 등급입니다.</p>
      ${source ? `<p class="help">기준 파일 ${escape(source.source)} · 일부 시나리오에서는 장료·악진·이전과 감녕·능통 사이의 관계가 달라집니다.</p>` : ""}
      ${groups.map(([title, rows, format]) => `<details class="details"><summary>${title} ${rows.length}건</summary>${list(rows, format)}</details>`).join("")}
      <p class="help">동명이인이나 상충으로 확인이 필요한 등급은 계산에서 제외합니다. CE 개인 친애나 가까운 혈연이 확인된 쌍은 직접 연결에 포함합니다.</p>
      <p class="subhead"><a href="https://www.gamecity.ne.jp/manual/sangokushi14-pk/ce/kor/5110.html" target="_blank" rel="noopener">공식 CE 연계 조건</a></p>
    `);
  }

  function persistDex() {
    const params = dex.stateParams();
    try { history.replaceState(null, "", "#dex" + (params ? "?" + params : "")); } catch {}
  }

  function showView(view, focus = false) {
    $("#planner-panel").hidden = view !== "planner";
    $("#dex-panel").hidden = view !== "dex";
    for (const tab of document.querySelectorAll("nav [data-view]")) {
      if (tab.dataset.view === view) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    }
    if (view === "dex") dex.render();
    if (focus) $("#" + view + "-title").focus();
  }

  function restoreView() {
    const [route, params] = location.hash.slice(1).split("?");
    if (route === "dex") {
      dex.restore(new URLSearchParams(params));
      showView("dex");
    } else if (route === "planner" || !route) showView("planner");
  }

  function themeButton() {
    const dark = document.documentElement.dataset.theme === "dark";
    $("#themeToggle").textContent = dark ? "☀" : "☾";
    $("#themeToggle").setAttribute("aria-label", dark ? "라이트 테마로 변경" : "다크 테마로 변경");
  }

  $("#themeToggle").addEventListener("click", () => {
    const mode = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = mode;
    try { localStorage.setItem("san14-theme", mode); } catch {}
    themeButton();
  });
  $("#dataButton").addEventListener("click", dataDialog);
  $("#checkNames").addEventListener("click", () => reviewNames(true));
  $("#editRoster").addEventListener("click", () => setRosterEditor(true, true));
  $("#rosterForm").addEventListener("submit", createPlan);
  nameInput.addEventListener("input", () => {
    state.review = null;
    renderNameReview();
    invalidate();
  });
  coreInput.addEventListener("input", invalidate);
  countInput.addEventListener("change", invalidate);
  $("#dexSearch").addEventListener("input", (event) => {
    if (event.isComposing) return;
    dex.searchChanged();
    persistDex();
  });
  $("#dexSearch").addEventListener("compositionend", () => { dex.searchChanged(); persistDex(); });
  for (const selector of ["#dexSort", "#ownedOnly"]) {
    $(selector).addEventListener("change", () => { dex.searchChanged(); persistDex(); });
  }
  $("#clearSearch").addEventListener("click", () => { dex.clear(); persistDex(); });
  addEventListener("hashchange", restoreView);

  function closeAnalysis() {
    const trigger = {
      move: ["move-officer", state.moveId], deployment: ["deployment", state.group], count: ["change-count", ""],
      recommendations: state.recommendationContext?.officer
        ? ["recommend-officer", state.recommendationContext.officer]
        : state.recommendationContext?.group != null
          ? ["recommend-group", state.recommendationContext.group] : ["recommend-all", ""],
    };
    const previous = state.panel === "compare" ? state.comparison?.origin : state.panel;
    const focus = trigger[previous];
    resetPanel();
    renderWorkspace(focus ? `[data-action="${focus[0]}"][data-value="${focus[1]}"]` : "#groupTitle");
  }

  function addOfficer(id) {
    const current = roster.resolveRoster(nameInput.value, state.selectedNames);
    if (!current.ids.includes(id)) {
      nameInput.value = [nameInput.value.trim(), "#" + id].filter(Boolean).join(" ");
      reviewNames();
      setRosterEditor(true);
      dex.render();
      feedback.announce(model.displayName(id) + " 장수를 명단에 추가했습니다.");
    }
    dex.showOfficer(id);
  }

  const publicActions = {
    officer: (id) => dex.showOfficer(Number(id)),
    trait: (label) => dex.showTrait(label),
    formation: (label) => dex.showFormation(label),
    "dex-page": (page) => { dex.changePage(Number(page)); persistDex(); },
    "add-officer": (id) => addOfficer(Number(id)),
    "select-group": (group) => selectedGroup(Number(group)),
    "copy-plan": () => feedback.copy(campaign.formatPlan(state.plan), state.stale ? "이전 편성표" : "편성표"),
    relations: (id) => {
      const officer = Number(id);
      state.relationId = state.relationId === officer ? null : officer;
      renderWorkspace();
    },
  };

  const editActions = {
    "move-officer": (id) => { state.moveId = Number(id); openAnalysis("move"); },
    "change-count": () => {
      state.alternativeCount = Math.min(model.MAX_GROUP_COUNT, state.activeIds.length, state.plan.groups.length + 1);
      openAnalysis("count");
    },
    "preview-move": (index) => {
      const after = campaign.move(state.plan, state.moveId, Number(index));
      if (after) compareWith(after, model.displayName(state.moveId) + " 이동 미리보기", "move");
    },
    "preview-count": () => {
      const requested = Number($("#comparisonCount").value);
      const alternate = { ...state.plan.options, mode: "count", maxGroupCount: model.MAX_GROUP_COUNT, targetCount: requested };
      const result = planner.planRoster(state.activeIds, alternate);
      compareWith(campaign.snapshot(result, alternate), requested + "집단 편성 비교", "count");
    },
    "apply-comparison": applyComparison,
    "undo-plan": undoPlan,
    "recommend-all": () => showRecommendations(),
    "recommend-officer": (id) => showRecommendations({ officer: Number(id) }),
    "recommend-group": (group) => showRecommendations({ group: Number(group) }),
    "preview-recommendation": (index) => {
      const row = state.recommendations[Number(index)];
      if (!row) return;
      const keys = state.plan.manual && row.plan.groups.length === state.plan.groups.length ? state.plan.groupKeys : undefined;
      const after = campaign.snapshot(row.plan, state.plan.options, keys);
      const label = row.kind === "marriage" ? "결혼" : "의형제";
      compareWith(after, row.ids.map(model.displayName).join(" + ") + " " + label + " 가정", "recommendations", row.kind, row.ids);
    },
    "close-analysis": closeAnalysis,
    "return-analysis": () => openAnalysis(state.comparison.origin),
    deployment: (group) => showDeployment(Number(group)),
    "copy-deployment": copyDeployment,
  };

  document.addEventListener("click", (event) => {
    const target = event.target.closest("button");
    if (!target) return;
    const { action, value, view, sampleRoster, dexKind } = target.dataset;
    if (view) {
      const route = view === "dex" ? "#dex" + (dex.stateParams() ? "?" + dex.stateParams() : "") : "#planner";
      if (location.hash !== route) history.pushState(null, "", route);
      showView(view, true);
    } else if (sampleRoster) {
      const preset = data.presets.find((row) => row.key === sampleRoster);
      nameInput.value = preset.text;
      coreInput.value = "";
      countInput.value = String(preset.groupCount);
      state.selectedNames = new Map();
      target.closest("details").open = false;
      reviewNames(true);
    } else if (dexKind) {
      dex.changeKind(dexKind);
      persistDex();
    } else if (action && Object.hasOwn(publicActions, action)) {
      publicActions[action](value);
    } else if (action && state.plan && !state.stale && Object.hasOwn(editActions, action)) {
      editActions[action](value);
    }
  });

  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.dataset.duplicateKey) {
      const key = input.dataset.duplicateKey;
      state.selectedNames.set(key, Number(input.value));
      reviewNames();
      [...$("#duplicateSelectors").querySelectorAll("select")].find((select) => select.dataset.duplicateKey === key)?.focus();
    } else if (input.id === "pathDepth") {
      dex.changeDepth(Number(input.value));
      $("#pathDepth")?.focus();
    } else if (input.id === "mobileGroup") {
      selectedGroup(Number(input.value));
    } else if (input.id === "comparisonCount") {
      state.alternativeCount = Number(input.value);
    } else if (input.id === "recommendationFilter") {
      state.recFilter = input.value;
      renderWorkspace();
    } else if (input.id === "recommendationPurpose") {
      state.recPurpose = input.value;
      renderWorkspace();
    } else if (input.dataset.deployId) {
      const id = Number(input.dataset.deployId);
      if (input.checked) state.deploymentSelection.set(id, "");
      else state.deploymentSelection.delete(id);
      state.deploymentConditions = defaultConditions();
      renderWorkspace();
    } else if (input.dataset.formationId) {
      state.deploymentSelection.set(Number(input.dataset.formationId), input.value);
      renderWorkspace();
    } else if (input.dataset.deployCondition) {
      state.deploymentConditions[input.dataset.deployCondition] = input.checked;
      renderWorkspace();
    } else if (input.id === "deploymentRange") {
      state.deploymentConditions.range = input.value;
      renderWorkspace();
    }
  });

  nameInput.value = "";
  renderNameReview();
  themeButton();
  restoreView();
})();
