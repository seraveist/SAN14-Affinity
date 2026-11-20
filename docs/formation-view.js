(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  const { escape, number, button, badge, combatRelationText, relationEvidence, relationGuide, options, banner } = SAN14.ui;

  SAN14.createFormationView = function createFormationView(model, planner, campaign) {
    const name = model.displayName;
    const roleLabels = { front: "전열", rear: "후열", siege: "공성·파성", support: "지원", guard: "호위" };

    function edge(row, relation) {
      return combatRelationText(name(row.a), relation, name(row.b));
    }

    function connectionStats(metrics, size) {
      return `<div class="summary-metrics">
        <span>연결된 장수 <strong>${metrics.linkedCount}/${size}명</strong></span>
        <span>2명 이상과 연결 <strong>${metrics.multiLinkedCount}명</strong></span>
        <span>기존 ☆·◎ 연계 <strong>${metrics.highGradeCount}쌍</strong></span>
      </div>`;
    }

    function summary(state) {
      const { plan } = state;
      const stats = planner.formationStats(plan.groups, plan.unassigned);
      const n = (v) => number.format(v);
      const requested = plan.options.mode === "auto" ? "자동분할" : n(plan.options.targetCount) + "집단";
      const controls = [button("집단 수 바꿔보기", "change-count", "", "quiet", state.stale ? "disabled" : ""),
        button("편성표 복사", "copy-plan", "", "quiet")];
      if (state.previous) controls.push(button("실행 취소", "undo-plan", "", "quiet", state.stale ? "disabled" : ""));
      return `<section class="surface workspace-summary" aria-labelledby="currentTitle">
        <div class="panel-heading">
          <h2 id="currentTitle" tabindex="-1">현재 편성</h2>
          <div class="actions">${controls.join("")}</div>
        </div>
        <div class="summary-metrics">
          <span>편성 <strong>${n(plan.groups.flat().length)}/${n(state.activeIds.length)}명</strong></span>
          <span>실제 <strong>${n(stats.groupCount)}집단</strong></span>
          <span>미편성 <strong>${n(stats.unassignedCount)}명</strong></span>
          <span>목표 <strong>${requested}</strong></span>
          <span>편성 점수 <strong>${n(planner.totalScore(plan.groups))}</strong></span>
          ${plan.manual ? badge("수동 편성", "selected") : ""}
        </div>
      </section>`;
    }

    function groupSelector(state) {
      const pairs = state.plan.groups.map((group, index) => [index, (index + 1) + " " + campaign.groupTitle(state.plan, index), group.length]);
      return `<div class="group-switcher" role="group" aria-label="집단 선택">
        ${pairs.map(([index, label, size]) => `<button class="desktop-group" type="button" data-action="select-group" data-value="${index}" aria-pressed="${state.group === index}">${escape(label)} <small>${size}명</small></button>`).join("")}
        <select class="mobile-group" id="mobileGroup" aria-label="집단 선택" ${pairs.length ? "" : "disabled"}>
          ${state.group < 0 ? '<option value="" selected disabled>집단 선택</option>' : ""}
          ${options(pairs.map(([index, label, size]) => [index, label + " · " + size + "명"]), state.group)}
        </select>
        <button type="button" data-action="select-group" data-value="-1" aria-pressed="${state.group === -1}">미편성 <small>${state.plan.unassigned.length}명</small></button>
      </div>`;
    }

    function relationsFor(id, group) {
      const relations = group.filter((target) => target !== id)
        .map((target) => ({ a: id, b: target, ...campaign.evidence(id, target) }))
        .filter((row) => row.relation)
        .sort((a, b) => b.relation.value - a.relation.value || name(a.b).localeCompare(name(b.b), "ko"));
      return relations.length
        ? `<div class="relation-track"><p class="help">${relationGuide}</p>
          <ul aria-label="집단 내 직접 연결">${relations.map((row) => `<li>${edge(row, row.relation)} ${relationEvidence(row)}</li>`).join("")}</ul></div>`
        : '<p class="relation-track">이 집단에서 직접 이어진 장수가 없습니다.</p>';
    }

    function memberRow(id, group, state, assignments) {
      const isCore = state.group >= 0 && group[0] === id;
      const traits = model.officerTraits(id).filter((trait) => ["보좌", "신장", "응원", "악주", "경국", "호위"].includes(trait));
      const count = assignments.get(id) ?? 0;
      const expanded = state.relationId === id;
      const highlighted = expanded || (state.relationId != null && !!model.relationBetween(state.relationId, id));
      const inactive = state.stale ? "disabled" : "";
      return `<li>
        <div class="member-row ${highlighted ? "highlight" : ""}">
          <div>${button(name(id), "officer", id, "text")}${isCore ? badge("코어", "selected") : ""}${traits.map((trait) => badge(trait)).join("")}</div>
          <span class="setting-count">${state.group < 0 ? "" : "직접 연결 " + count + "명"}</span>
          <div class="actions">
            ${state.group >= 0 ? button("연결 근거 보기", "relations", id, "quiet", `aria-expanded="${expanded}"`) : button("보완안 찾기", "recommend-officer", id, "quiet", inactive)}
            ${button("옮길 집단 찾기", "move-officer", id, "quiet", inactive)}
          </div>
        </div>
        ${expanded ? relationsFor(id, group) : ""}
      </li>`;
    }

    function memberSection(state) {
      const { plan, group } = state;
      const inactive = state.stale ? "disabled" : "";
      if (group < 0) {
        const rows = planner.classifyUnassigned(plan.unassigned, plan.groups, state.activeIds);
        const sections = rows.map((section) => {
          const sets = section.lines ? section.lines.map((line) => line.ids) : [section.ids];
          return `<section class="unassigned-block">
            <h3>${escape(section.title)}</h3>
            ${sets.map((set) => `<ul class="member-list">${set.map((id) => memberRow(id, set, state, new Map())).join("")}</ul>`).join("")}
          </section>`;
        }).join("");
        return `<section class="surface group-panel"><div class="panel-heading">
          <h2 id="groupTitle" tabindex="-1">미편성 장수</h2>
          ${button("전체 보완안 보기", "recommend-all", "", "quiet", inactive)}</div>
          ${sections || '<p class="empty">미편성 장수가 없습니다. 장수를 옮길 때 미편성을 목적지로 선택할 수 있습니다.</p>'}
        </section>`;
      }
      const members = plan.groups[group] ?? [];
      const metrics = model.groupMetrics(members);
      const roles = members.length ? planner.groupBattleProfile(members, state.activeIds).roles : {};
      const oversize = members.length > model.MAX_GROUP_SIZE;
      return `<section class="surface group-panel">
        <div class="panel-heading">
          <h2 id="groupTitle" tabindex="-1">${escape(campaign.groupTitle(plan, group))} <small class="muted">${members.length}명</small></h2>
          <div class="actions">
            ${button("보완안 찾기", "recommend-group", group, "quiet", inactive)}
            ${button("출진 후보 고르기", "deployment", group, "primary", state.stale || !members.length ? "disabled" : "")}
          </div>
        </div>
        ${oversize ? banner("수동 편성에서 집단당 자동 편성 기준 15명을 넘었습니다.") : ""}
        ${members.length ? connectionStats(metrics, members.length) : ""}
        ${members.length ? '<p class="help">직접 연결 상대는 장수별로 한 번씩 셉니다. 실제 효과는 출진한 부대의 조건에 따라 달라집니다.</p>' : ""}
        ${members.length ? `<div class="role-badges"><span class="help">보유 역할 후보</span> ${Object.entries(roleLabels).filter(([key]) => roles[key]).map(([, label]) => badge(label)).join("")}</div>` : '<p class="empty">비어 있는 집단입니다. 다른 집단에서 장수를 옮길 수 있습니다.</p>'}
        <ul class="member-list">${members.map((id) => memberRow(id, members, state, metrics.linksByOfficer)).join("")}</ul>
      </section>`;
    }

    function analysis(title, body, backLabel = "현재 편성으로 돌아가기") {
      return `<section class="surface analysis-panel" aria-labelledby="analysisTitle"><div class="panel-heading">
        <h2 id="analysisTitle" tabindex="-1">${escape(title)}</h2>
        ${button(backLabel, "close-analysis", "", "quiet")}</div>${body}</section>`;
    }

    function renderMove(state) {
      const rows = campaign.destinations(state.plan, state.moveId);
      const body = rows.map((row) => `<li>
        <div><strong>${escape(campaign.groupTitle(state.plan, row.index))}</strong>
        <p class="help">${row.index === -1 ? "미편성으로 이동" : "직접 연결 " + row.links + "명 · " + row.size + " → " + (row.size + 1) + "명"}</p></div>
        ${button("이동 미리보기", "preview-move", row.index, "quiet", `aria-label="${escape(campaign.groupTitle(state.plan, row.index))} 이동 미리보기"`)}
      </li>`).join("");
      return analysis(name(state.moveId) + " 옮길 집단 찾기", body ? `<ul class="destination-list">${body}</ul>` : '<p class="empty">이동할 집단이 없습니다. 편성 조건을 조정해 초안을 만드세요.</p>');
    }

    function renderCount(state) {
      const minimum = Math.max(1, state.plan.options.fixedCoreIds.length);
      const maximum = Math.min(model.MAX_GROUP_COUNT, state.activeIds.length);
      const values = Array.from({ length: maximum - minimum + 1 }, (_, i) => [minimum + i, (minimum + i) + "집단"]);
      return analysis("집단 수 바꿔보기", `<p class="help">같은 명단과 고정 코어로 새 편성을 계산합니다.${state.plan.manual ? " 변경안은 자동 배치 결과입니다." : ""}</p>
        <div class="actions roster-actions"><label class="inline-label" for="comparisonCount">목표 집단 수
          <select id="comparisonCount">${options(values, state.alternativeCount)}</select></label>
          ${button("비교하기", "preview-count", "", "primary")}</div>`);
    }

    function renderComparison(state) {
      const row = state.comparison;
      const diff = row.diff;
      const fields = [["groupCount", "집단"], ["smallCount", "소집단"], ["unassignedCount", "미편성"],
        ["linkedCount", "연결된 장수"], ["multiLinkedCount", "2명 이상과 연결"], ["highGradeCount", "☆·◎ 연계"], ["score", "앱 편성 점수"]];
      const oversize = row.after.groups.some((group) => group.length > model.MAX_GROUP_SIZE);
      const moved = diff.moves.map((change) => `<li><strong>${escape(name(change.id))}</strong> · ${escape(change.from)} → ${escape(change.to)}</li>`).join("");
      const compareEdge = (item) => {
        if (item.virtual) return edge(item, item);
        return edge(item, item) + " " + relationEvidence(campaign.evidence(item.a, item.b));
      };
      const details = (label, rows, renderRow) => `<details class="details"><summary>${label} ${rows.length}건</summary>
        <ul class="compact-list">${rows.map((item) => `<li>${renderRow(item)}</li>`).join("") || "<li>변화 없음</li>"}</ul></details>`;
      const roleChanges = diff.roleChanges.map((change) => `<li><strong>${escape(change.group)}</strong>
        ${change.gained.length ? " · 추가 " + escape(change.gained.join(", ")) : ""}
        ${change.removed.length ? " · 감소 " + escape(change.removed.join(", ")) : ""}</li>`).join("");
      return analysis(row.title, `
        ${row.virtual ? banner(row.virtual === "marriage" ? "가상 결혼 · 배우자 미확인. 연계 등급을 ☆로 가정합니다." : "가상 의형제 · 연계 등급을 ☆로 가정합니다.") : ""}
        ${oversize ? banner("변경안에 자동 편성 기준 15명을 초과한 집단이 있습니다.") : ""}
        <table class="compare-table"><thead><tr><th scope="col">항목</th><th scope="col">현재</th><th scope="col">${row.virtual ? "가정 후" : "변경 후"}</th></tr></thead>
          <tbody>${fields.map(([key, label]) => `<tr><th scope="row">${label}</th><td>${number.format(diff.from[key])}</td><td><strong>${number.format(diff.to[key])}</strong></td></tr>`).join("")}</tbody>
        </table>
        <div class="compare-grid"><section><h3>이동한 장수</h3><ul class="compact-list">${moved || "<li>이동 없음</li>"}</ul></section>
        <section><h3>보유 역할 변화</h3><ul class="compact-list">${roleChanges || "<li>변화 없음</li>"}</ul></section></div>
        ${details("새 집단 내 관계", diff.added, compareEdge)} ${details("끊긴 집단 내 관계", diff.lost, compareEdge)}
        ${diff.updated.length ? details("연계 근거가 바뀐 관계", diff.updated, ({ previous, next }) =>
          `<div>현재 · ${compareEdge(previous)}</div><div>변경 후 · ${compareEdge(next)}</div>`,
        ) : ""}
        <details class="details"><summary>전체 변경 편성 보기</summary>
          <ul class="compact-list">${campaign.formatPlan(row.after).split("\n").map((line) => `<li>${escape(line)}</li>`).join("")}</ul>
        </details>
        <div class="actions">
          ${button("다른 안 보기", "return-analysis", "", "quiet")}
          ${row.virtual ? "" : button("현재 편성에 반영", "apply-comparison", "", "primary")}
        </div>
      `);
    }

    function renderRecommendations(state) {
      const context = state.recommendationContext;
      const title = context?.officer ? name(context.officer) + " 보완안" :
        context?.group != null ? campaign.groupTitle(state.plan, context.group) + " 보완안" : "편성 보완안";
      const rows = state.recommendations
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => state.recFilter === "all" || row.kind === state.recFilter)
        .filter(({ row }) => state.recPurpose === "all" || row.purpose === state.recPurpose)
        .filter(({ row }) => {
          if (context?.officer) return row.ids.includes(context.officer) || row.sourceIds.includes(context.officer);
          if (context?.group != null) return row.targetIndex === context.group || row.sourceIds.some((id) => state.plan.groups[context.group].includes(id));
          return true;
        })
        .slice(0, model.RECOMMENDATION_LIMIT);
      const content = rows.map(({ row, index }) => `<li><div>
        <strong>${escape(row.ids.map(name).join(" + "))}</strong>
        ${badge(row.kind === "marriage" ? "결혼 · 미혼 가정" : "의형제")}
        <p class="help">${escape(row.reason)} · 미편성 ${row.baseStats.unassignedCount} → ${row.stats.unassignedCount}명</p>
      </div>${button("가정해 보기", "preview-recommendation", index, "quiet")}</li>`).join("");
      return analysis(title, `
        <div class="actions roster-actions">
          <label class="inline-label" for="recommendationFilter">유형
            <select id="recommendationFilter">${options([["all", "전체"], ["oath", "의형제"], ["marriage", "결혼"]], state.recFilter)}</select>
          </label>
          <label class="inline-label" for="recommendationPurpose">목적
            <select id="recommendationPurpose">${options([["all", "전체"], ["formation", "편성 보완"], ["support", "지원 보강"]], state.recPurpose)}</select>
          </label>
          ${context ? button("전체 보완안 보기", "recommend-all", "", "quiet") : ""}
        </div>
        ${state.recommendationStatus === "loading" ? '<p class="help" role="status">편성 보완안을 계산하고 있습니다.</p>' :
          state.recommendationStatus === "failed" ? banner("보완안을 계산하지 못했습니다. 전체 보완안 보기로 다시 시도하세요.") + button("전체 보완안 보기", "recommend-all", "", "quiet") :
            content ? `<ul class="destination-list">${content}</ul>` : '<p class="empty">현재 추천에서 조건에 맞는 안을 찾지 못했습니다.</p>'}
      `);
    }

    function deploymentMember(state, id, extra) {
      const selected = state.deploymentSelection.has(id);
      return `<div class="deployment-card">
        <label class="check"><input type="checkbox" data-deploy-id="${id}" ${selected ? "checked" : ""}> ${escape(name(id))}</label>
        ${extra ? badge("미편성 · 보좌") : ""}
        ${selected ? `<label class="setting" for="formation-${id}">진형<select id="formation-${id}" data-formation-id="${id}">${options([["", "진형 선택"], ...model.officerFormationNames(id).map((value) => [value, value])], state.deploymentSelection.get(id))}</select></label>` : ""}
      </div>`;
    }

    function renderDeployment(state) {
      const candidates = state.plan.groups[state.group];
      const support = state.plan.unassigned.filter((id) => model.officerTraits(id).includes("보좌"));
      const result = campaign.deployment(state.deploymentSelection);
      const controls = state.deploymentConditions;
      const allChecked = controls.army && controls.status && controls.range === "checked";
      const conditions = `<div class="actions">
        <label class="check"><input type="checkbox" data-deploy-condition="army" ${controls.army ? "checked" : ""}> 같은 군단 확인</label>
        <label class="check"><input type="checkbox" data-deploy-condition="status" ${controls.status ? "checked" : ""}> 상태이상 없음 확인</label>
        <label class="inline-label" for="deploymentRange">관계별 거리
          <select id="deploymentRange">${options([["unknown", "미확인"], ["checked", "게임에서 범위 내 확인"], ["outside", "범위 밖 장수 있음"]], controls.range)}</select></label></div>`;
      const pairRows = result.pairs.map((row) => `<li>${edge(row, row.relation)}
        ${relationEvidence(row)}
        ${row.dislike ? badge("혐오 " + (row.dislike === "혐오 기록" ? "기록" : "대상 확인 필요"), "attention") : ""}
        ${row.supporters.length && row.dislike !== "혐오 기록" ? badge(row.supporters.map(name).join("·") + " 보좌 가세 후보", row.dislike ? "attention" : "") : ""}
      </li>`).join("");
      const roles = [...result.roles].map(([role, ids]) => badge(role + " · " + ids.map(name).join(", "), "selected")).join(" ");
      const effects = result.officers.filter((row) => row.traits.length).map((row) =>
        `<li><strong>${escape(name(row.id))}</strong> · ${row.traits.map((trait) => button(trait, "trait", trait, "text")).join(" / ")}</li>`,
      ).join("");
      return analysis(campaign.groupTitle(state.plan, state.group) + " 출진 후보", `
        <p class="help">이번에 함께 출진할 장수를 고르고 각자 진형 하나를 선택하세요. 전법 동시 연계에는 최대 5부대가 참여합니다.</p>
        <div class="deployment-grid">${candidates.map((id) => deploymentMember(state, id, false)).join("")}</div>
        ${support.length ? `<details class="details" id="deploymentSupport" ${state.deploymentSupportOpen ? "open" : ""}><summary>미편성 보좌 후보 · ${support.length}명</summary><div class="deployment-grid">${support.map((id) => deploymentMember(state, id, true)).join("")}</div></details>` : ""}
        <h3 class="subhead">선택한 장수 ${result.officers.length}명 · 채운 역할</h3>
        <div class="chips">${roles || '<span class="help">진형을 선택하면 역할이 표시됩니다.</span>'}</div>
        ${result.officers.length ? connectionStats(model.groupMetrics(result.officers.map(({ id }) => id)), result.officers.length) : ""}
        ${effects ? `<h3 class="subhead">출진 개성</h3><ul class="compact-list">${effects}</ul>` : ""}
        <h3 class="subhead">연계 조건 확인</h3>
        ${conditions}
        <p class="help">${allChecked ? "입력한 조건을 확인했습니다. 관계 자료와 전법의 발동 여부는 게임에서 확인하세요." : "같은 군단·거리·상태는 게임에서 확인할 조건입니다. 아래는 연결 후보입니다."}</p>
        ${result.pairs.some((row) => row.relation) ? `<p class="help">${relationGuide}</p>` : ""}
        <ul class="compact-list">${pairRows || "<li>선택한 장수 사이에 표시할 관계나 보좌 후보가 없습니다.</li>"}</ul>
        <div class="actions roster-actions">${button("출진 후보 복사", "copy-deployment", "", "quiet", result.officers.length ? "" : "disabled")}</div>
      `);
    }

    function render(state) {
      if (!state.plan) return "";
      const views = { move: renderMove, count: renderCount, compare: renderComparison, recommendations: renderRecommendations, deployment: renderDeployment };
      const body = views[state.panel]?.(state) ?? memberSection(state);
      return `<div class="workspace">${summary(state)}
        ${state.stale ? banner("이전 명단 또는 편성 조건으로 계산한 결과입니다. 초안을 새로 만들면 수정과 비교를 이용할 수 있습니다.") : ""}
        ${state.notices.length ? `<ul class="warnings" aria-label="편성 참고 사항">${state.notices.map((line) => `<li>${escape(line)}</li>`).join("")}</ul>` : ""}
        ${groupSelector(state)} ${body}</div>`;
    }

    return render;
  };
})();
