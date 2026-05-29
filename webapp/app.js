(() => {
  const DATA = window.SAN14_DATA;
  const REL_VALUE = { "☆": 3, "◎": 2, "○": 1 };
  const REL_LABEL = { 3: "☆", 2: "◎", 1: "○" };
  const REL_CLASS = { "☆": "star", "◎": "double", "○": "single" };
  const SAMPLE_ROSTER =
    "유비, 관우, 장비, 황충, 조운, 마초, 마대, 제갈량, 서서, 방통, 마속, 주창, 관평, 관흥, 관은병, 엄안, 법정, 석도, 공손찬, 후씨, 감씨, 미씨, 황월영, 마운록, 노식, 주준, 황보숭, 양씨, 아귀, 등지, 진도, 요화, 위연, 이엄, 이회";

  const officers = new Map(
    Object.entries(DATA.officers).map(([id, officer]) => [Number(id), { ...officer, id: Number(id) }]),
  );
  const directed = new Map();
  const pairCache = new Map();
  const neighbors = new Map();

  const els = {
    segments: [...document.querySelectorAll(".segment")],
    panels: [...document.querySelectorAll("[data-panel]")],
    rosterInput: document.querySelector("#rosterInput"),
    centerInput: document.querySelector("#centerInput"),
    maxSize: document.querySelector("#maxSize"),
    hopDepth: document.querySelector("#hopDepth"),
    sampleRoster: document.querySelector("#sampleRoster"),
    showMarriage: document.querySelector("#showMarriage"),
    showOath: document.querySelector("#showOath"),
    runButton: document.querySelector("#runButton"),
    resultTitle: document.querySelector("#resultTitle"),
    resultMeta: document.querySelector("#resultMeta"),
    scoreBadge: document.querySelector("#scoreBadge"),
    warnings: document.querySelector("#warnings"),
    results: document.querySelector("#results"),
    datalist: document.querySelector("#officerNames"),
    template: document.querySelector("#groupTemplate"),
  };

  let mode = "roster";

  function edgeKey(source, target) {
    return `${source}|${target}`;
  }

  function pairKey(a, b) {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  function officer(id) {
    return officers.get(Number(id));
  }

  function primary(id) {
    return officer(id)?.primaryScore || 0;
  }

  function traitScore(id) {
    return officer(id)?.traitScore || 0;
  }

  function hasRangeTrait(id) {
    return (officer(id)?.traits || []).some((trait) => trait.name === "응원" || trait.name === "악주");
  }

  function displayName(id) {
    const item = officer(id);
    if (!item) return `#${id}`;
    const candidates = DATA.byName[item.name] || [];
    return candidates.length > 1 ? `${item.name}#${id}` : item.name;
  }

  function relationBetween(a, b) {
    const cacheKey = edgeKey(a, b);
    if (pairCache.has(cacheKey)) return pairCache.get(cacheKey);

    const ab = directed.get(edgeKey(a, b));
    const ba = directed.get(edgeKey(b, a));
    const best = Math.max(REL_VALUE[ab] || 0, REL_VALUE[ba] || 0);
    if (!best) {
      pairCache.set(cacheKey, null);
      return null;
    }

    let arrow = "<-";
    if (ab && ba) arrow = "<->";
    else if (ab) arrow = "->";

    const relation = { arrow, label: REL_LABEL[best], value: best };
    pairCache.set(cacheKey, relation);
    return relation;
  }

  function addNeighbor(source, target) {
    const relation = relationBetween(source, target);
    if (!relation) return;
    if (!neighbors.has(source)) neighbors.set(source, new Map());
    if (!neighbors.has(target)) neighbors.set(target, new Map());
    neighbors.get(source).set(target, relation);
    neighbors.get(target).set(source, relationBetween(target, source) || relation);
  }

  function setupGraph() {
    for (const edge of DATA.edges) {
      const existing = directed.get(edgeKey(edge.source, edge.target));
      if (!existing || REL_VALUE[edge.relation] > REL_VALUE[existing]) {
        directed.set(edgeKey(edge.source, edge.target), edge.relation);
      }
    }
    for (const edge of DATA.edges) addNeighbor(edge.source, edge.target);
  }

  function setupDatalist() {
    const fragment = document.createDocumentFragment();
    Object.keys(DATA.byName)
      .sort((a, b) => a.localeCompare(b, "ko"))
      .forEach((name) => {
        const option = document.createElement("option");
        option.value = name;
        fragment.appendChild(option);
      });
    els.datalist.appendChild(fragment);
  }

  function parseNames(text) {
    return text
      .split(/[\n,，]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function resolveNames(tokens) {
    const fixed = [];
    const pending = [];
    const warnings = [];

    for (const token of tokens) {
      const idMatch = token.match(/#(\d+)$/);
      if (idMatch) {
        const id = Number(idMatch[1]);
        if (officers.has(id)) fixed.push({ token, id });
        else warnings.push(`ID ${id}를 찾지 못했습니다.`);
        continue;
      }

      const candidates = DATA.byName[token] || [];
      if (candidates.length === 0) {
        warnings.push(`${token}: 장수명을 찾지 못했습니다.`);
      } else if (candidates.length === 1) {
        fixed.push({ token, id: candidates[0] });
      } else {
        pending.push({ token, candidates });
      }
    }

    const selected = [...fixed];
    for (const item of pending) {
      const selectedIds = selected.map((row) => row.id);
      const ranked = [...item.candidates].sort((a, b) => {
        const scoreA = ambiguityScore(a, selectedIds);
        const scoreB = ambiguityScore(b, selectedIds);
        return scoreB - scoreA;
      });
      selected.push({ token: item.token, id: ranked[0] });
      warnings.push(`${item.token}: 동명이인 중 ${displayName(ranked[0])} 자동 선택`);
    }

    const seen = new Set();
    const ids = [];
    for (const item of selected) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      ids.push(item.id);
    }
    return { ids, warnings };
  }

  function ambiguityScore(id, selectedIds) {
    let links = 0;
    let quality = 0;
    for (const other of selectedIds) {
      const relation = relationBetween(id, other);
      if (!relation) continue;
      links += 1;
      quality += relation.value;
    }
    return links * 1000 + quality * 100 + primary(id);
  }

  function groupMetrics(group) {
    const buff = new Map(group.map((id) => [id, 0]));
    const edges = [];
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        const relation = relationBetween(a, b);
        if (!relation) continue;
        buff.set(a, buff.get(a) + 1);
        buff.set(b, buff.get(b) + 1);
        edges.push({ a, b, ...relation });
      }
    }

    const base = group.reduce((sum, id) => sum + primary(id), 0);
    const stack = [...buff.values()].reduce((sum, value) => sum + value, 0);
    const quality = edges.reduce((sum, edge) => sum + edge.value, 0);
    return {
      score: Math.round(base + stack * 15 + quality * 10),
      base,
      stack,
      quality,
      buff,
      edges,
    };
  }

  function combinations3(items) {
    const rows = [];
    for (let i = 0; i < items.length; i += 1) {
      for (let j = i + 1; j < items.length; j += 1) {
        for (let k = j + 1; k < items.length; k += 1) {
          rows.push([items[i], items[j], items[k]]);
        }
      }
    }
    return rows;
  }

  function topOaths(group, limit = 3) {
    return combinations3(group)
      .map((triple) => {
        const pairs = [
          [triple[0], triple[1]],
          [triple[0], triple[2]],
          [triple[1], triple[2]],
        ];
        const existing = pairs.filter(([a, b]) => relationBetween(a, b)).length;
        const gain = (3 - existing) * 2;
        const power = triple.reduce((sum, id) => sum + primary(id), 0);
        return { triple, existing, gain, power };
      })
      .filter((row) => row.existing < 3)
      .sort((a, b) => b.existing - a.existing || b.power - a.power || a.gain - b.gain)
      .slice(0, limit);
  }

  function topMarriages(group, limit = 3) {
    const rows = [];
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i];
        const b = group[j];
        const oa = officer(a);
        const ob = officer(b);
        if (!oa || !ob) continue;
        if (new Set([oa.gender, ob.gender]).size !== 2) continue;
        if (!["남", "여"].includes(oa.gender) || !["남", "여"].includes(ob.gender)) continue;

        const male = oa.gender === "남" ? a : b;
        const female = oa.gender === "여" ? a : b;
        const existing = Boolean(relationBetween(male, female));
        const rangeBonus = hasRangeTrait(female) ? 2 : 0;
        const gain = (existing ? 0 : 2) + rangeBonus;
        rows.push({
          male,
          female,
          existing,
          gain,
          power: primary(male) + primary(female),
        });
      }
    }
    return rows
      .sort((a, b) => Number(a.existing) - Number(b.existing) || b.gain - a.gain || b.power - a.power)
      .slice(0, limit);
  }

  function starComponents(ids) {
    const idSet = new Set(ids);
    const visited = new Set();
    const components = [];

    for (const id of ids) {
      if (visited.has(id)) continue;
      const stack = [id];
      const component = [];
      visited.add(id);
      while (stack.length) {
        const current = stack.pop();
        component.push(current);
        for (const next of idSet) {
          if (visited.has(next) || next === current) continue;
          const relation = relationBetween(current, next);
          if (relation?.value === 3) {
            visited.add(next);
            stack.push(next);
          }
        }
      }
      if (component.length > 1) components.push(component);
    }
    return components.sort((a, b) => componentScore(b) - componentScore(a));
  }

  function componentScore(group) {
    const metrics = groupMetrics(group);
    return metrics.score + group.length * 20;
  }

  function anchorScore(id, candidates) {
    let quality = 0;
    let links = 0;
    for (const other of candidates) {
      if (other === id) continue;
      const relation = relationBetween(id, other);
      if (!relation) continue;
      links += 1;
      quality += relation.value;
    }
    return primary(id) + traitScore(id) * 6 + links * 45 + quality * 26;
  }

  function marginalGain(id, group) {
    let links = 0;
    let quality = 0;
    let star = 0;
    for (const other of group) {
      const relation = relationBetween(id, other);
      if (!relation) continue;
      links += 1;
      quality += relation.value;
      if (relation.value === 3) star += 1;
    }
    if (!links) return 0;
    return quality * 75 + links * 45 + star * 40 + primary(id) * 0.2 + traitScore(id) * 5;
  }

  function splitLargeComponent(component, maxSize) {
    const remaining = new Set(component);
    const groups = [];
    while (remaining.size) {
      const pool = [...remaining];
      const seed = pool.sort((a, b) => anchorScore(b, pool) - anchorScore(a, pool))[0];
      const group = [seed];
      remaining.delete(seed);
      fillGroup(group, remaining, maxSize, 120);
      groups.push(group);
    }
    return groups;
  }

  function fillGroup(group, remaining, maxSize, threshold) {
    while (group.length < maxSize && remaining.size) {
      let best = null;
      for (const id of remaining) {
        const gain = marginalGain(id, group);
        if (gain < threshold) continue;
        if (!best || gain > best.gain) best = { id, gain };
      }
      if (!best) return;
      group.push(best.id);
      remaining.delete(best.id);
    }
  }

  function partitionRoster(ids, maxSize) {
    const remaining = new Set(ids);
    const groups = [];

    for (const component of starComponents(ids)) {
      if (!component.every((id) => remaining.has(id))) continue;
      if (component.length > maxSize) {
        for (const group of splitLargeComponent(component, maxSize)) {
          groups.push(group);
          for (const id of group) remaining.delete(id);
        }
      } else {
        groups.push([...component]);
        for (const id of component) remaining.delete(id);
      }
    }

    let changed = true;
    while (changed) {
      changed = false;
      let best = null;
      for (const id of remaining) {
        for (const group of groups) {
          if (group.length >= maxSize) continue;
          const gain = marginalGain(id, group);
          if (gain < 120) continue;
          if (!best || gain > best.gain) best = { id, group, gain };
        }
      }
      if (best) {
        best.group.push(best.id);
        remaining.delete(best.id);
        changed = true;
      }
    }

    while (remaining.size) {
      const pool = [...remaining];
      const seed = pool.sort((a, b) => anchorScore(b, pool) - anchorScore(a, pool))[0];
      const group = [seed];
      remaining.delete(seed);
      fillGroup(group, remaining, maxSize, 120);
      groups.push(group);
    }

    return groups
      .map((group) =>
        [...group].sort((a, b) => {
          const metrics = groupMetrics(group).buff;
          return metrics.get(b) - metrics.get(a) || primary(b) - primary(a);
        }),
      )
      .sort((a, b) => groupMetrics(b).score - groupMetrics(a).score);
  }

  function clearResults() {
    els.results.innerHTML = "";
    els.warnings.innerHTML = "";
  }

  function renderWarnings(warnings) {
    const fragment = document.createDocumentFragment();
    for (const text of warnings) {
      const node = document.createElement("div");
      node.className = "warning";
      node.textContent = text;
      fragment.appendChild(node);
    }
    els.warnings.replaceChildren(fragment);
  }

  function memberChip(id, buff) {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    chip.innerHTML = `${displayName(id)} <strong>B${buff.get(id) || 0}</strong> <span>P${primary(id)}</span>`;
    return chip;
  }

  function relationLine(edge) {
    const row = document.createElement("div");
    row.className = `relation-line ${REL_CLASS[edge.label]}`;
    row.innerHTML = `${displayName(edge.a)} ${edge.arrow}<span class="relation-symbol">${edge.label}</span> ${displayName(edge.b)}`;
    return row;
  }

  function renderGroup(title, group, options = {}) {
    const metrics = groupMetrics(group);
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = title;
    card.querySelector(".group-score").textContent = `score ${metrics.score}`;

    const memberList = card.querySelector(".member-list");
    for (const id of group) memberList.appendChild(memberChip(id, metrics.buff));

    const relationList = card.querySelector(".relation-list");
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "연결 근거";
    relationList.appendChild(label);

    const edges = metrics.edges.sort((a, b) => b.value - a.value || displayName(a.a).localeCompare(displayName(b.a), "ko"));
    if (!edges.length) {
      const empty = document.createElement("div");
      empty.className = "relation-line";
      empty.textContent = "연결 없음";
      relationList.appendChild(empty);
    } else {
      for (const edge of edges.slice(0, options.edgeLimit || 24)) relationList.appendChild(relationLine(edge));
      if (edges.length > (options.edgeLimit || 24)) {
        const more = document.createElement("div");
        more.className = "relation-line";
        more.textContent = `외 ${edges.length - (options.edgeLimit || 24)}개`;
        relationList.appendChild(more);
      }
    }

    const recommendations = card.querySelector(".recommendations");
    if (els.showOath.checked) {
      const oathLabel = document.createElement("div");
      oathLabel.className = "section-label";
      oathLabel.textContent = "의형제 후보";
      recommendations.appendChild(oathLabel);
      const oaths = topOaths(group);
      if (!oaths.length) appendRec(recommendations, "후보 없음");
      for (const oath of oaths) {
        appendRec(
          recommendations,
          `${oath.triple.map(displayName).join(" + ")} / 기존연결 ${oath.existing}/3, 예상스택 +${oath.gain}`,
        );
      }
    }

    if (els.showMarriage.checked) {
      const marriageLabel = document.createElement("div");
      marriageLabel.className = "section-label";
      marriageLabel.textContent = "결혼 후보(미혼 가정)";
      recommendations.appendChild(marriageLabel);
      const marriages = topMarriages(group);
      if (!marriages.length) appendRec(recommendations, "후보 없음");
      for (const marriage of marriages) {
        const state = marriage.existing ? "기존친애 있음" : "신규연결";
        appendRec(
          recommendations,
          `${displayName(marriage.male)} + ${displayName(marriage.female)} / ${state}, 예상가치 +${marriage.gain}`,
        );
      }
    }

    els.results.appendChild(card);
    return metrics.score;
  }

  function appendRec(parent, text) {
    const row = document.createElement("div");
    row.className = "rec-line";
    row.textContent = text;
    parent.appendChild(row);
  }

  function renderRoster() {
    clearResults();
    const tokens = parseNames(els.rosterInput.value);
    const { ids, warnings } = resolveNames(tokens);
    if (!ids.length) {
      renderEmpty("분석할 장수를 입력하세요.");
      return;
    }

    const maxSize = Math.max(3, Math.min(10, Number(els.maxSize.value) || 10));
    const groups = partitionRoster(ids, maxSize);
    const total = groups.reduce((sum, group, index) => {
      const topNames = group
        .slice(0, 3)
        .map(displayName)
        .join(", ");
      return sum + renderGroup(`${index + 1}분파 · ${topNames}`, group);
    }, 0);

    renderWarnings(warnings);
    els.resultTitle.textContent = "보유 장수 편성 결과";
    els.resultMeta.textContent = `${ids.length}명 · 최대 ${maxSize}명 · 여성 장수 기본 기혼 처리`;
    els.scoreBadge.textContent = `${Math.round(total)}`;
  }

  function renderSingle() {
    clearResults();
    const { ids, warnings } = resolveNames([els.centerInput.value.trim()]);
    if (!ids.length) {
      renderEmpty("중심 장수를 입력하세요.");
      return;
    }

    const center = ids[0];
    const depth = Math.max(1, Math.min(4, Number(els.hopDepth.value) || 4));
    const paths = findPaths(center, depth);
    const directIds = [...(neighbors.get(center)?.keys() || [])]
      .sort((a, b) => {
        const relA = relationBetween(center, a);
        const relB = relationBetween(center, b);
        return relB.value - relA.value || primary(b) - primary(a);
      })
      .slice(0, 10);

    renderGroup(`단독 연결 · ${displayName(center)}`, [center, ...directIds], { edgeLimit: 20 });
    renderPathCard(`짧은 분파부터 긴 분파 · ${displayName(center)}`, paths.slice(0, 40));

    renderWarnings(warnings);
    els.resultTitle.textContent = "중심 장수 분석 결과";
    els.resultMeta.textContent = `${displayName(center)} · ${depth} hop · 별/쌍원/단원 포함`;
    els.scoreBadge.textContent = `${paths.length}`;
  }

  function findPaths(center, maxDepth) {
    const rows = [];
    const limit = 2500;

    function walk(path, score) {
      if (rows.length >= limit) return;
      if (path.length > 1) rows.push({ path: [...path], score });
      if (path.length - 1 >= maxDepth) return;

      const last = path[path.length - 1];
      const nextRows = [...(neighbors.get(last)?.keys() || [])]
        .filter((id) => !path.includes(id))
        .sort((a, b) => {
          const relA = relationBetween(last, a);
          const relB = relationBetween(last, b);
          return relB.value - relA.value || primary(b) - primary(a);
        })
        .slice(0, 18);

      for (const next of nextRows) {
        const relation = relationBetween(last, next);
        walk([...path, next], score + relation.value * 100 + primary(next) * 0.1);
      }
    }

    walk([center], 0);
    return rows.sort((a, b) => a.path.length - b.path.length || b.score - a.score);
  }

  function renderPathCard(title, pathRows) {
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = title;
    card.querySelector(".group-score").textContent = `${pathRows.length} paths`;
    card.querySelector(".member-list").remove();
    card.querySelector(".recommendations").remove();
    const relationList = card.querySelector(".relation-list");
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "연결 근거";
    relationList.appendChild(label);

    if (!pathRows.length) {
      const empty = document.createElement("div");
      empty.className = "relation-line";
      empty.textContent = "경로 없음";
      relationList.appendChild(empty);
    }

    for (const row of pathRows) {
      const line = document.createElement("div");
      line.className = "relation-line";
      line.innerHTML = pathToText(row.path);
      relationList.appendChild(line);
    }
    els.results.appendChild(card);
  }

  function pathToText(path) {
    const parts = [];
    for (let i = 0; i < path.length; i += 1) {
      if (i === 0) {
        parts.push(displayName(path[i]));
        continue;
      }
      const relation = relationBetween(path[i - 1], path[i]);
      parts.push(`${relation.arrow}<span class="relation-symbol">${relation.label}</span> ${displayName(path[i])}`);
    }
    return parts.join(" ");
  }

  function renderEmpty(text) {
    clearResults();
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = text;
    els.results.appendChild(node);
    els.scoreBadge.textContent = "READY";
  }

  function setMode(nextMode) {
    mode = nextMode;
    for (const button of els.segments) button.classList.toggle("active", button.dataset.mode === mode);
    for (const panel of els.panels) panel.classList.toggle("hidden", panel.dataset.panel !== mode);
    if (mode === "roster") renderRoster();
    else renderSingle();
  }

  function bindEvents() {
    for (const button of els.segments) {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    }
    els.sampleRoster.addEventListener("click", () => {
      els.rosterInput.value = SAMPLE_ROSTER;
      renderRoster();
    });
    els.runButton.addEventListener("click", () => {
      if (mode === "roster") renderRoster();
      else renderSingle();
    });
    for (const input of [els.showMarriage, els.showOath]) {
      input.addEventListener("change", () => {
        if (mode === "roster") renderRoster();
        else renderSingle();
      });
    }
  }

  function init() {
    setupGraph();
    setupDatalist();
    bindEvents();
    els.rosterInput.value = SAMPLE_ROSTER;
    renderRoster();
  }

  init();
})();
