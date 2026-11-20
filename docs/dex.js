(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  const { escape, badge, button, number, options, personalAffinityText, combatRelationText, relationSymbol, relationEvidence, relationGuide, banner } = SAN14.ui;
  const STATS = [
    ["leadership", "통솔"], ["war", "무력"], ["intelligence", "지력"], ["politics", "정치"], ["charm", "매력"],
  ];
  const PAGE_SIZE = 25;
  const normalize = (text) => String(text ?? "").normalize("NFC").toLocaleLowerCase("ko").replace(/\s+/g, "");

  SAN14.createDex = function createDex(document, model, campaign, feedback, getOwned) {
    const search = document.querySelector("#dexSearch");
    const clear = document.querySelector("#clearSearch");
    const sort = document.querySelector("#dexSort");
    const owned = document.querySelector("#ownedOnly");
    const results = document.querySelector("#dexResults");
    const tabs = [...document.querySelectorAll("#dexKinds button")];
    const catalog = model.DATA.ceTraits?.traits ?? {};
    const name = model.displayName;
    const items = [...model.officers.values()].sort((a, b) => a.id - b.id).map((item) => ({
      id: item.id, name: name(item.id), stats: item.stats, traits: model.officerTraits(item.id),
      formations: model.officerFormationNames(item.id),
    }));
    const traitOwners = indexBy("traits");
    const formationOwners = indexBy("formations");
    const kindSet = new Set(["officers", "traits", "formations"]);
    const sortSet = new Set(["id", "name", ...STATS.map(([key]) => key)]);
    let kind = "officers";
    let page = 1;
    let detailId = null;
    let relationDepth = 4;

    function indexBy(field) {
      const map = new Map();
      for (const item of items) {
        for (const key of new Set(item[field])) {
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(item);
        }
      }
      return map;
    }

    const contains = (value, query) => normalize(value).includes(query);

    function cardList(rows, type, renderNote) {
      return `<ul class="dex-cards">${rows.map((row) => `<li class="dex-card">
        ${button(row.label, type, row.label, "text")}
        <p>${escape(renderNote(row))}</p>
      </li>`).join("")}</ul>`;
    }

    function officerList(rows) {
      return `<table class="officer-table">
        <thead><tr><th scope="col">장수</th>${STATS.map(([, label]) => `<th scope="col">${label}</th>`).join("")}<th scope="col">개성 · 진형</th></tr></thead>
        <tbody>${rows.map((row) => `<tr>
          <th scope="row">${button(row.name, "officer", row.id, "text")}</th>
          ${STATS.map(([key]) => `<td>${row.stats?.[key] ?? "—"}</td>`).join("")}
          <td><div class="chips">${row.traits.slice(0, 3).map((x) => badge(x)).join("")} ${row.formations.slice(0, 3).map((x) => badge(x)).join("")}</div></td>
        </tr>`).join("")}</tbody>
      </table>
      <ul class="officer-mobile">${rows.map((row) => `<li>${button(row.name, "officer", row.id, "text")}
        <div class="help">${STATS.map(([key, label]) => label + " " + (row.stats?.[key] ?? "—")).join(" · ")}</div>
        <div class="chips">${row.traits.slice(0, 3).map((x) => badge(x)).join("")}</div>
      </li>`).join("")}</ul>`;
    }

    function matchingRows() {
      const query = normalize(search.value);
      const active = new Set(getOwned());
      if (kind === "officers") {
        const rows = items.filter((row) => (!owned.checked || active.has(row.id)) &&
          [row.name, ...row.traits, ...row.formations].some((val) => contains(val, query)));
        if (sort.value === "name") rows.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id - b.id);
        else if (sort.value !== "id") rows.sort((a, b) => (b.stats?.[sort.value] ?? -1) - (a.stats?.[sort.value] ?? -1) || a.id - b.id);
        return rows;
      }
      const byLabel = kind === "traits" ? traitOwners : formationOwners;
      const labels = new Set([...byLabel.keys(), ...(kind === "traits" ? Object.keys(catalog) : [])]);
      return [...labels].map((label) => ({
        label, holders: (byLabel.get(label) ?? []).filter((row) => !owned.checked || active.has(row.id)),
      })).filter((row) => (!owned.checked || row.holders.length) &&
        (contains(row.label, query) || row.holders.some((holder) => contains(holder.name, query))),
      ).sort((a, b) => a.label.localeCompare(b.label, "ko"));
    }

    function stateParams() {
      const params = new URLSearchParams();
      if (search.value.trim()) params.set("q", search.value.trim());
      if (kind !== "officers") params.set("kind", kind);
      if (sort.value !== "id") params.set("sort", sort.value);
      if (owned.checked) params.set("owned", "1");
      if (page !== 1) params.set("page", page);
      return params.toString();
    }

    function restore(params) {
      search.value = params.get("q") ?? "";
      sort.value = sortSet.has(params.get("sort")) ? params.get("sort") : "id";
      kind = kindSet.has(params.get("kind")) ? params.get("kind") : "officers";
      owned.checked = params.get("owned") === "1";
      page = Math.max(1, Math.trunc(Number(params.get("page"))) || 1);
      render();
    }

    function render() {
      tabs.forEach((tab) => tab.setAttribute("aria-pressed", String(tab.dataset.dexKind === kind)));
      sort.closest("label").hidden = kind !== "officers";
      clear.hidden = !search.value;
      const rows = matchingRows();
      const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
      page = Math.min(page, pages);
      const offset = (page - 1) * PAGE_SIZE;
      const visible = rows.slice(offset, offset + PAGE_SIZE);
      let content;
      if (!visible.length) {
        const message = owned.checked && !getOwned().length ? "명단을 확인한 후 보유 장수만 찾아볼 수 있습니다." : "일치하는 결과가 없습니다. 검색어나 필터를 바꿔 보세요.";
        content = `<p class="empty">${message}</p>`;
      } else if (kind === "officers") content = officerList(visible);
      else if (kind === "traits") {
        content = cardList(visible, "trait", (row) => {
          const definition = catalog[row.label];
          const description = definition?.description || model.traitDescription(row.label) || "설명 자료 없음";
          return description + " · 보유 장수 " + row.holders.length + "명";
        });
      } else {
        content = cardList(visible, "formation", (row) => "보유 장수 " + row.holders.length + "명");
      }
      results.innerHTML = `<section class="surface dex-results" aria-labelledby="dexResultHeading">
        <h2 id="dexResultHeading" tabindex="-1">검색 결과 <span class="muted">${number.format(rows.length)}</span></h2>
        ${content}
        ${visible.length ? `<div class="pagination">
          ${button("이전", "dex-page", page - 1, "quiet", page === 1 ? "disabled" : "")}
          <span class="help">${number.format(offset + 1)}–${number.format(offset + visible.length)} / ${number.format(rows.length)}</span>
          ${button("다음", "dex-page", page + 1, "quiet", page === pages ? "disabled" : "")}
        </div>` : ""}
      </section>`;
    }

    function showOfficer(id, depth = 4, pathOpen = false) {
      const item = model.officer(id);
      if (!item) return;
      detailId = id;
      relationDepth = depth;
      const active = getOwned().includes(id);
      const stats = (values) => STATS.map(([key, label]) => `<div><span>${label}</span><strong>${values?.[key] ?? "—"}</strong></div>`).join("");
      const directRows = model.directRelations(id);
      const personalRows = directRows.filter(({ relation }) => relation.personal);
      const personal = personalRows.map(({ id: target, relation }) =>
        `<li>${personalAffinityText(name(id), relation.personal, name(target))} ${button(name(target) + " 상세", "officer", target, "text")}</li>`,
      ).join("");
      const variant = model.scenarioAffinityTargets(id).map(name);
      const direct = directRows.map((row) => {
        const fact = campaign.evidence(id, row.id);
        return `<li>${combatRelationText(name(id), row.relation, name(row.id))}
          ${relationEvidence(fact)} ${button(name(row.id) + " 상세", "officer", row.id, "text")}</li>`;
      }).join("");
      const unresolved = (model.DATA.relationshipEvidence?.missing ?? []).filter((row) => row.source === id && row.relation !== "X");
      const unresolvedRows = unresolved.map((row) =>
        `<li>${escape(row.targetName)} ${badge("기존 시트 " + row.relation)} ${badge("대상 ID 누락", "attention")}</li>`,
      ).join("");
      const allPaths = model.findPaths(id, depth).filter(({ path }) => path.length >= 3).sort((a, b) => b.score - a.score);
      const paths = allPaths.slice(0, 50).map(({ path }) => {
        const review = new Set();
        let inferred = false;
        const parts = path.slice(1).map((target, index) => {
          const fact = campaign.evidence(path[index], target);
          fact.review.forEach((reason) => review.add(reason));
          inferred ||= fact.inferred;
          const personal = fact.relation.personal;
          return (personal ? relationSymbol(personal) : "·") + " " + escape(name(target));
        });
        return `<li>${escape(name(id))} ${parts.join(" ")} ${relationEvidence({ review: [...review], inferred })}</li>`;
      }).join("");
      feedback.openDialog(name(id), `
        ${button(active ? "명단에 있음" : "내 명단에 추가", "add-officer", id, "primary", active ? "disabled" : "")}
        <h3 class="subhead">능력치</h3><div class="stat-grid">${stats(item.stats)}</div>
        ${item.eventStats ? `<h3 class="subhead">이벤트 후 능력치</h3><div class="stat-grid">${stats(item.eventStats)}</div>` : ""}
        <h3 class="subhead">개성</h3><div class="chips">${model.officerTraits(id).map((trait) => button(trait, "trait", trait, "quiet")).join("")}</div>
        <h3 class="subhead">진형</h3><div class="chips">${model.officerFormationNames(id).map((formation) => button(formation, "formation", formation, "quiet")).join("")}</div>
        <details class="details"><summary>개인 친애 ${personalRows.length}명</summary>
          <p class="help">${escape(model.DATA.ceAffinity?.metadata.label ?? "CE 개인 친애 자료 미확인")} · 화살표가 가리키는 쪽이 친애 대상입니다.</p>
          ${variant.length ? `<p class="help">일부 시나리오에서는 ${escape(variant.join("·"))}와도 서로 친애합니다.</p>` : ""}
          ${personal ? `<ul class="compact-list">${personal}</ul>` : '<p class="help">이 시나리오에 기록된 개인 친애가 없습니다.</p>'}
        </details>
        <details class="details"><summary>전투 연결 ${directRows.length}명${unresolved.length ? " · 대상 미확인 " + unresolved.length + "건" : ""}</summary>
          ${direct ? `<p class="help">${relationGuide}</p>` : ""}
          <ul class="compact-list">${direct + unresolvedRows || "<li>전투 연결 자료가 없습니다.</li>"}</ul>
        </details>
        <details class="details" ${pathOpen ? "open" : ""}><summary>전투 연결 경로</summary>
          <label for="pathDepth" class="inline-label">탐색 단계<select id="pathDepth">${options([1,2,3,4].map((value) => [value, value + "단계"]), relationDepth)}</select></label>
          <p class="help">${paths ? "탐색한 간접 경로 중 최대 50개를 표시합니다." : "3명 이상을 잇는 경로를 찾지 못했습니다."}</p>
          ${paths ? '<p class="help">화살표는 개인 친애를, 가운데점은 그 밖의 전투 연결을 뜻합니다.</p>' : ""}
          <ul class="compact-list">${paths}</ul>
        </details>`);
    }

    function holdersList(holders) {
      const active = new Set(getOwned());
      const visible = holders.filter((row) => !owned.checked || active.has(row.id));
      return `<h3 class="subhead">보유 장수 ${visible.length}명</h3>
        <p class="help">보유 목록은 현재 장수 자료 기준입니다.</p>
        <div class="chips">${visible.map((row) => button(row.name, "officer", row.id, "quiet")).join("") || "보유 장수 자료가 없습니다."}</div>`;
    }

    function showTrait(label) {
      const definition = catalog[label];
      const description = definition?.description || model.traitDescription(label);
      if (!description && !traitOwners.has(label)) return;
      const checked = model.DATA.ceTraits?.metadata?.checkedOn;
      feedback.openDialog(label, `
        ${definition ? badge("CE 원본 대조 · " + checked, "selected") : badge("기존 자료")}
        ${definition?.bundled === false ? banner("콜라보 자료 · CE 기본 구성에 포함되지 않습니다.") : ""}
        <p class="subhead">${escape(description ?? "효과 설명이 없습니다.")}</p>
        ${holdersList(traitOwners.get(label) ?? [])}`);
    }

    function showFormation(label) {
      if (!formationOwners.has(label)) return;
      feedback.openDialog(label, holdersList(formationOwners.get(label)));
    }

    function searchChanged(event) {
      if (event?.isComposing) return;
      page = 1;
      render();
    }

    render();

    return {
      render, restore, stateParams, showOfficer, showTrait, showFormation,
      changeDepth: (depth) => showOfficer(detailId, depth, true),
      changeKind: (value) => { if (kindSet.has(value)) kind = value; page = 1; render(); },
      changePage: (value) => { page = Math.max(1, value); render(); document.querySelector("#dexResultHeading").focus(); },
      searchChanged,
      clear: () => { search.value = ""; searchChanged(); search.focus(); },
    };
  };
})();
