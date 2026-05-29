(() => {
  const DATA = window.SAN14_DATA;
  const REL_VALUE = { "☆": 3, "◎": 2, "○": 1 };
  const REL_LABEL = { 3: "☆", 2: "◎", 1: "○" };
  const REL_CLASS = { "☆": "star", "◎": "double", "○": "single" };
  const MAX_GROUP_SIZE = 20;
  const MIN_GROUP_SIZE = 3;
  const SAMPLE_ROSTER =
    "유비, 관우, 장비, 황충, 조운, 마초, 마대, 제갈량, 서서, 방통, 마속, 주창, 관평, 관흥, 관은병, 엄안, 법정, 석도, 공손찬, 후씨, 감씨, 미씨, 황월영, 마운록, 노식, 주준, 황보숭, 양씨, 아귀, 등지, 진도, 요화, 위연, 이엄, 이회";

  const officers = new Map(
    Object.entries(DATA.officers).map(([id, officer]) => [Number(id), { ...officer, id: Number(id) }]),
  );
  const directed = new Map();
  const pairCache = new Map();
  const neighbors = new Map();
  let activeVirtualPairs = null;

  const els = {
    segments: [...document.querySelectorAll(".segment")],
    panels: [...document.querySelectorAll("[data-panel]")],
    resultTabs: document.querySelector("#resultTabs"),
    resultTabButtons: [...document.querySelectorAll(".result-tab")],
    rosterInput: document.querySelector("#rosterInput"),
    centerInput: document.querySelector("#centerInput"),
    groupCount: document.querySelector("#groupCount"),
    maxSize: document.querySelector("#maxSize"),
    duplicateSelectors: document.querySelector("#duplicateSelectors"),
    hopDepth: document.querySelector("#hopDepth"),
    sampleRoster: document.querySelector("#sampleRoster"),
    runButton: document.querySelector("#runButton"),
    resultTitle: document.querySelector("#resultTitle"),
    resultMeta: document.querySelector("#resultMeta"),
    scoreBadge: document.querySelector("#scoreBadge"),
    warnings: document.querySelector("#warnings"),
    results: document.querySelector("#results"),
    oathResults: document.querySelector("#oathResults"),
    datalist: document.querySelector("#officerNames"),
    template: document.querySelector("#groupTemplate"),
  };

  let mode = "roster";
  let activeResultTab = "formation";
  const rosterLimitValues = { groupCount: 4, maxSize: MAX_GROUP_SIZE };
  const duplicateSelectionValues = new Map();

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

  function clampInteger(value, min, max, fallback) {
    if (value === "" || value === null || value === undefined) {
      return Math.max(min, Math.min(max, fallback));
    }
    const number = Number(value);
    const base = Number.isFinite(number) ? Math.round(number) : fallback;
    return Math.max(min, Math.min(max, base));
  }

  function minGroupCount(rosterSize, maxSize = MAX_GROUP_SIZE) {
    return Math.max(1, Math.ceil(rosterSize / maxSize));
  }

  function rosterTokenCount() {
    return parseNames(els.rosterInput.value).length;
  }

  function updateRosterLimitControls(rosterSize = rosterTokenCount()) {
    const maxSize = clampInteger(els.maxSize.value, MIN_GROUP_SIZE, MAX_GROUP_SIZE, rosterLimitValues.maxSize);
    const minCount = minGroupCount(rosterSize, maxSize);
    const maxCount = Math.max(minCount, rosterSize || 1);
    const targetCount = clampInteger(els.groupCount.value, minCount, maxCount, rosterLimitValues.groupCount);

    rosterLimitValues.maxSize = maxSize;
    rosterLimitValues.groupCount = targetCount;
    els.maxSize.min = String(MIN_GROUP_SIZE);
    els.maxSize.max = String(MAX_GROUP_SIZE);
    els.maxSize.value = maxSize;
    els.groupCount.min = String(minCount);
    els.groupCount.max = String(maxCount);
    els.groupCount.value = targetCount;
  }

  function planningOptions(rosterSize, warnings) {
    const rawMaxSize = Number(els.maxSize.value);
    const maxSize = clampInteger(rawMaxSize, MIN_GROUP_SIZE, MAX_GROUP_SIZE, rosterLimitValues.maxSize);
    if (Number.isFinite(rawMaxSize) && Math.round(rawMaxSize) !== maxSize) {
      warnings.push(`집단당 최대 인원은 ${MIN_GROUP_SIZE}~${MAX_GROUP_SIZE} 범위로 조정됩니다.`);
    }

    const minCount = minGroupCount(rosterSize, maxSize);
    const maxCount = Math.max(minCount, rosterSize);
    const rawTargetCount = Number(els.groupCount.value);
    const targetCount = clampInteger(rawTargetCount, minCount, maxCount, rosterLimitValues.groupCount);
    if (Number.isFinite(rawTargetCount) && Math.round(rawTargetCount) !== targetCount) {
      warnings.push(`목표 집단 수는 최대 ${maxSize}명 기준 ${minCount}~${maxCount} 범위로 조정됩니다.`);
    }

    rosterLimitValues.maxSize = maxSize;
    rosterLimitValues.groupCount = targetCount;
    els.maxSize.value = maxSize;
    els.groupCount.value = targetCount;
    updateRosterLimitControls(rosterSize);
    return { mode: "count", maxSize, targetCount };
  }

  function displayName(id) {
    const item = officer(id);
    if (!item) return `#${id}`;
    const candidates = DATA.byName[item.name] || [];
    const index = candidates.indexOf(Number(id));
    return candidates.length > 1 && index >= 0 ? `${item.name}(${index + 1})` : item.name;
  }

  function explicitDuplicateId(token) {
    const match = token.match(/^(.+)\((\d+)\)$/);
    if (!match) return null;
    const candidates = DATA.byName[match[1]] || [];
    if (candidates.length <= 1) return null;
    const index = Number(match[2]) - 1;
    return candidates[index] || null;
  }

  function statsLine(id) {
    const stats = officer(id)?.stats;
    if (!stats) return "";
    return [stats.leadership, stats.war, stats.intelligence, stats.politics, stats.charm]
      .map((value) => String(value).padStart(3, "\u00a0"))
      .join("|");
  }

  function duplicateKey(name, occurrence) {
    return `${name}::${occurrence}`;
  }

  function relationBetween(a, b) {
    const cacheKey = `${activeVirtualPairs ? "v" : "b"}|${edgeKey(a, b)}`;
    if (pairCache.has(cacheKey)) return pairCache.get(cacheKey);

    let ab = directed.get(edgeKey(a, b));
    let ba = directed.get(edgeKey(b, a));
    if (activeVirtualPairs?.has(pairKey(a, b))) {
      ab = "☆";
      ba = "☆";
    }
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
    [...officers.values()]
      .sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id - b.id)
      .forEach((item) => {
        const option = document.createElement("option");
        option.value = displayName(item.id);
        if ((DATA.byName[item.name] || []).length > 1) option.label = statsLine(item.id);
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

  function buildRosterDuplicateState(tokens) {
    const groups = new Map();
    tokens.forEach((token) => {
      if (token.match(/#(\d+)$/)) return;
      const candidates = DATA.byName[token] || [];
      if (candidates.length <= 1) return;
      if (!groups.has(token)) groups.set(token, { name: token, candidates, count: 0 });
      groups.get(token).count += 1;
    });

    const selectors = [];
    const autoAllDuplicateNames = new Set();
    const warnings = [];
    for (const group of groups.values()) {
      if (group.count >= group.candidates.length) {
        autoAllDuplicateNames.add(group.name);
        if (group.count > group.candidates.length) {
          warnings.push(`${group.name}: 후보 ${group.candidates.length}명을 모두 사용하고 중복 입력은 합칩니다.`);
        }
        continue;
      }

      for (let occurrence = 1; occurrence <= group.count; occurrence += 1) {
        selectors.push({
          name: group.name,
          occurrence,
          candidates: group.candidates,
          key: duplicateKey(group.name, occurrence),
        });
      }
    }

    return { selectors, autoAllDuplicateNames, warnings };
  }

  function updateDuplicateSelectors(tokens = parseNames(els.rosterInput.value)) {
    const state = buildRosterDuplicateState(tokens);
    const activeKeys = new Set(state.selectors.map((row) => row.key));
    for (const key of duplicateSelectionValues.keys()) {
      if (!activeKeys.has(key)) duplicateSelectionValues.delete(key);
    }

    els.duplicateSelectors.innerHTML = "";
    els.duplicateSelectors.classList.toggle("hidden", !state.selectors.length || mode !== "roster");
    if (!state.selectors.length) return { ...state, selections: new Map() };

    const title = document.createElement("div");
    title.className = "duplicate-selector-title";
    title.textContent = "동명이인 선택";
    els.duplicateSelectors.appendChild(title);

    const list = document.createElement("div");
    list.className = "duplicate-selector-list";

    const selections = new Map();
    const usedByName = new Map();
    for (const row of state.selectors) {
      const used = usedByName.get(row.name) || new Set();
      const selected = duplicateSelectionValue(row, used);
      used.add(selected);
      usedByName.set(row.name, used);
      selections.set(row.key, selected);
      list.appendChild(duplicateSelectorRow(row, selected));
    }
    els.duplicateSelectors.appendChild(list);

    return { ...state, selections };
  }

  function duplicateSelectionValue(row, used) {
    const stored = Number(duplicateSelectionValues.get(row.key));
    if (row.candidates.includes(stored) && !used.has(stored)) return stored;
    const fallback = row.candidates.find((id) => !used.has(id)) || row.candidates[0];
    duplicateSelectionValues.set(row.key, fallback);
    return fallback;
  }

  function duplicateSelectorRow(row, selected) {
    const wrapper = document.createElement("label");
    wrapper.className = "duplicate-selector-row";
    const name = document.createElement("span");
    name.className = "duplicate-selector-name";
    name.textContent = row.candidates.length > 2 ? `${row.name} 입력 ${row.occurrence}` : row.name;

    const select = document.createElement("select");
    select.dataset.duplicateKey = row.key;
    for (const id of row.candidates) {
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = `${displayName(id)}  ${statsLine(id)}`;
      option.selected = id === selected;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      const nextId = Number(select.value);
      duplicateSelectionValues.set(row.key, nextId);
      if (mode === "roster") renderRoster();
    });

    wrapper.append(name, select);
    return wrapper;
  }

  function resolveNames(tokens, options = {}) {
    const fixed = [];
    const pending = [];
    const warnings = [];
    const duplicateCounters = new Map();
    const autoAllUsed = new Set();
    const duplicateSelections = options.duplicateSelections || new Map();
    const autoAllDuplicateNames = options.autoAllDuplicateNames || new Set();

    for (const token of tokens) {
      const idMatch = token.match(/#(\d+)$/);
      if (idMatch) {
        const id = Number(idMatch[1]);
        if (officers.has(id)) fixed.push({ token, id });
        else warnings.push(`ID ${id}를 찾지 못했습니다.`);
        continue;
      }

      const explicitId = explicitDuplicateId(token);
      if (explicitId) {
        fixed.push({ token, id: explicitId });
        continue;
      }

      const candidates = DATA.byName[token] || [];
      if (candidates.length === 0) {
        warnings.push(`${token}: 장수명을 찾지 못했습니다.`);
      } else if (candidates.length === 1) {
        fixed.push({ token, id: candidates[0] });
      } else if (autoAllDuplicateNames.has(token)) {
        if (!autoAllUsed.has(token)) {
          candidates.forEach((id, index) => fixed.push({ token: `${token}(${index + 1})`, id }));
          autoAllUsed.add(token);
        }
      } else if (duplicateSelections.size) {
        const occurrence = (duplicateCounters.get(token) || 0) + 1;
        duplicateCounters.set(token, occurrence);
        const selected = duplicateSelections.get(duplicateKey(token, occurrence));
        if (candidates.includes(selected)) fixed.push({ token, id: selected });
        else pending.push({ token, candidates });
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

  function withVirtualOaths(oaths, callback) {
    const previous = activeVirtualPairs;
    activeVirtualPairs = new Set();
    for (const oath of oaths) {
      for (let i = 0; i < oath.length; i += 1) {
        for (let j = i + 1; j < oath.length; j += 1) {
          activeVirtualPairs.add(pairKey(oath[i], oath[j]));
        }
      }
    }
    pairCache.clear();
    try {
      return callback();
    } finally {
      activeVirtualPairs = previous;
      pairCache.clear();
    }
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

  function rankGroups(groups) {
    return groups
      .filter((group) => group.length)
      .map((group) =>
        [...group].sort((a, b) => {
          const metrics = groupMetrics(group).buff;
          return metrics.get(b) - metrics.get(a) || primary(b) - primary(a);
        }),
      )
      .sort((a, b) => groupMetrics(b).score - groupMetrics(a).score);
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

    return rankGroups(groups);
  }

  function normalizePlanOptions(options) {
    return typeof options === "number" ? { mode: "size", maxSize: options } : options;
  }

  function planRoster(ids, options) {
    const planOptions = normalizePlanOptions(options);
    const maxSize = planOptions.maxSize;
    const initialGroups = partitionRoster(ids, maxSize);
    const plan = rebalanceGroups(initialGroups, maxSize);

    if (planOptions.mode !== "count") return plan;

    const min = minGroupCount(ids.length, maxSize);
    const targetCount = clampInteger(planOptions.targetCount, min, ids.length, min);
    return fitGroupCount(plan.groups, targetCount, maxSize);
  }

  function rebalanceGroups(initialGroups, maxSize) {
    let groups = rankGroups(initialGroups);

    for (let pass = 0; pass < 10; pass += 1) {
      const best = findBestRebalance(groups, maxSize);
      if (!best || best.delta < 20) break;
      groups = rankGroups(best.groups);
    }

    return { groups };
  }

  function fitGroupCount(initialGroups, targetCount, maxSize) {
    let groups = rankGroups(initialGroups);

    while (groups.length > targetCount) {
      const candidate = findBestGroupCountReduction(groups, maxSize);
      if (!candidate) break;
      groups = rankGroups(candidate.groups);
    }

    while (groups.length < targetCount) {
      const candidate = findBestGroupSplit(groups, maxSize);
      if (!candidate) break;
      groups = rankGroups(candidate.groups);
    }

    return { groups };
  }

  function countShapePenalty(groups, maxSize) {
    if (!groups.length) return 0;
    const sizes = groups.map((group) => group.length);
    const singles = sizes.filter((size) => size === 1).length;
    const tiny = sizes.filter((size) => size > 1 && size <= 3).length;
    const spread = Math.max(...sizes) - Math.min(...sizes);
    const crowded = sizes.filter((size) => size === maxSize).length;
    return singles * 520 + tiny * 120 + spread * 10 + crowded * 4;
  }

  function countAdjustmentDelta(oldGroups, nextGroups, maxSize) {
    return (
      totalScore(nextGroups) -
      totalScore(oldGroups) -
      (countShapePenalty(nextGroups, maxSize) - countShapePenalty(oldGroups, maxSize))
    );
  }

  function findBestGroupCountReduction(groups, maxSize) {
    return [findBestGroupMerge(groups, maxSize), findBestGroupDissolve(groups, maxSize)]
      .filter(Boolean)
      .sort((a, b) => b.delta - a.delta)[0];
  }

  function findBestGroupMerge(groups, maxSize) {
    let best = null;
    for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (groups[i].length + groups[j].length > maxSize) continue;
        const merged = [...groups[i], ...groups[j]];
        const nextGroups = groups
          .map((group, index) => {
            if (index === i) return merged;
            if (index === j) return [];
            return [...group];
          })
          .filter((group) => group.length);
        const row = { groups: nextGroups, delta: countAdjustmentDelta(groups, nextGroups, maxSize) };
        if (!best || row.delta > best.delta) best = row;
      }
    }
    return best;
  }

  function findBestGroupDissolve(groups, maxSize) {
    let best = null;

    for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
      const source = groups[sourceIndex];
      const openSlots = groups.reduce(
        (sum, group, index) => sum + (index === sourceIndex ? 0 : maxSize - group.length),
        0,
      );
      if (source.length > openSlots) continue;

      const nextGroups = groups.map((group) => [...group]);
      const sourceIds = [...source].sort((a, b) => primary(b) - primary(a));
      let failed = false;

      for (const id of sourceIds) {
        let bestTarget = null;
        for (let targetIndex = 0; targetIndex < nextGroups.length; targetIndex += 1) {
          if (targetIndex === sourceIndex) continue;
          const target = nextGroups[targetIndex];
          if (target.length >= maxSize) continue;
          const gain = marginalGain(id, target);
          const balance = maxSize - target.length;
          const score = gain + balance * 0.01;
          if (!bestTarget || score > bestTarget.score) bestTarget = { targetIndex, score };
        }
        if (!bestTarget) {
          failed = true;
          break;
        }
        nextGroups[bestTarget.targetIndex].push(id);
      }

      if (failed) continue;
      nextGroups[sourceIndex] = [];
      const compactGroups = nextGroups.filter((group) => group.length);
      const row = { groups: compactGroups, delta: countAdjustmentDelta(groups, compactGroups, maxSize) };
      if (!best || row.delta > best.delta) best = row;
    }

    return best;
  }

  function findBestGroupSplit(groups, maxSize) {
    let best = null;

    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (group.length < 2) continue;

      for (let count = 1; count <= Math.floor(group.length / 2); count += 1) {
        for (const split of combinations(group, count)) {
          const splitSet = new Set(split);
          const rest = group.filter((id) => !splitSet.has(id));
          if (!rest.length) continue;

          const nextGroups = groups
            .map((row, index) => (index === groupIndex ? rest : [...row]))
            .concat([split]);
          const balance = -Math.abs(rest.length - split.length);
          const row = { groups: nextGroups, delta: countAdjustmentDelta(groups, nextGroups, maxSize), balance };
          if (!best || row.delta > best.delta || (row.delta === best.delta && row.balance > best.balance)) {
            best = row;
          }
        }
      }
    }

    return best;
  }

  function findBestRebalance(groups, maxSize) {
    for (const targetKind of ["full", "open-large", "small"]) {
      for (const smallSize of [3, 2, 1]) {
        const candidates = [findBestSmallGroupExchange(groups, maxSize, smallSize, targetKind)];
        if (smallSize === 1 && targetKind === "full") candidates.push(findBestBridgeRebalance(groups, maxSize));

        const best = candidates
          .filter(Boolean)
          .sort((a, b) => b.delta - a.delta)[0];
        if (best) return best;
      }
    }
    return null;
  }

  function findBestSmallGroupExchange(groups, maxSize, smallSize, targetKind) {
    let best = null;
    for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
      const source = groups[sourceIndex];
      if (source.length !== smallSize) continue;

      for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
        if (targetIndex === sourceIndex) continue;
        const target = groups[targetIndex];
        if (!target.length) continue;
        if (targetKind === "full" && target.length < maxSize) continue;
        if (targetKind === "open-large" && (target.length <= 3 || target.length >= maxSize)) continue;
        if (targetKind === "small" && target.length > 3) continue;

        for (const ejected of ejectionOptions(source, target, maxSize)) {
          const candidate = buildSmallGroupExchangeCandidate(groups, sourceIndex, targetIndex, ejected, maxSize);
          if (!candidate) continue;
          if (!best || candidate.delta > best.delta) best = candidate;
        }
      }
    }
    return best;
  }

  function ejectionOptions(source, target, maxSize) {
    const needed = Math.max(0, target.length + source.length - maxSize);
    const maxEject = Math.min(source.length, 3, target.length - 1);
    if (needed > maxEject) return [];
    if (needed === 0) return [[]];

    const options = [];
    for (let count = needed; count <= maxEject; count += 1) {
      options.push(...combinations(target, count));
    }
    return options;
  }

  function combinations(items, count) {
    if (count === 0) return [[]];
    if (count > items.length) return [];
    const rows = [];

    function walk(start, row) {
      if (row.length === count) {
        rows.push([...row]);
        return;
      }
      for (let i = start; i < items.length; i += 1) {
        row.push(items[i]);
        walk(i + 1, row);
        row.pop();
      }
    }

    walk(0, []);
    return rows;
  }

  function buildSmallGroupExchangeCandidate(groups, sourceIndex, targetIndex, ejected, maxSize) {
    const source = groups[sourceIndex];
    const target = groups[targetIndex];
    const ejectedSet = new Set(ejected);
    const nextTarget = target.filter((id) => !ejectedSet.has(id)).concat(source);
    if (!nextTarget.length) return null;

    const oldScore = groupMetrics(source).score + groupMetrics(target).score;
    const newScore = groupMetrics(nextTarget).score + (ejected.length ? groupMetrics(ejected).score : 0);
    const delta = newScore - oldScore;
    if (delta <= 0) return null;

    let nextGroups = groups
      .map((group, index) => {
        if (index === sourceIndex) return ejected.length ? [...ejected] : [];
        if (index === targetIndex) return nextTarget;
        return [...group];
      })
      .filter((group) => group.length);
    const merge = ejected.length ? findBestEjectedMerge(nextGroups, ejected, maxSize) : null;
    const mergeDelta = merge?.delta || 0;
    if (merge) nextGroups = merge.groups;

    return {
      groups: nextGroups,
      delta: delta + mergeDelta,
    };
  }

  function findBestEjectedMerge(groups, ejected, maxSize) {
    const ejectedSet = new Set(ejected);
    const ejectedIndex = groups.findIndex(
      (group) => group.length === ejected.length && group.every((id) => ejectedSet.has(id)),
    );
    if (ejectedIndex < 0) return null;

    let best = null;
    for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
      if (targetIndex === ejectedIndex) continue;
      const target = groups[targetIndex];
      if (target.length > 3 || target.length + ejected.length > maxSize) continue;

      const merged = [...target, ...ejected];
      const delta = groupMetrics(merged).score - groupMetrics(target).score - groupMetrics(ejected).score;
      if (delta <= 0) continue;

      const nextGroups = groups
        .map((group, index) => {
          if (index === targetIndex) return merged;
          if (index === ejectedIndex) return [];
          return [...group];
        })
        .filter((group) => group.length);
      const row = { groups: nextGroups, delta, target };
      if (!best || row.delta > best.delta) best = row;
    }
    return best;
  }

  function findBestBridgeRebalance(groups, maxSize) {
    const looseIds = groups.filter((group) => group.length === 1).map((group) => group[0]);
    if (!looseIds.length) return null;

    let best = null;
    for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
      const source = groups[sourceIndex];
      if (source.length < maxSize) continue;

      for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
        if (targetIndex === sourceIndex) continue;
        const target = groups[targetIndex];
        if (target.length < 2 || target.length >= maxSize) continue;

        const capacity = maxSize - target.length;
        const anchors = source
          .map((id) => ({ id, score: bridgeScore(id, target, looseIds) }))
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, 6)
          .map((row) => row.id);

        for (const movedAnchors of anchorSubsets(anchors, Math.min(2, capacity))) {
          const candidate = buildBridgeCandidate(groups, sourceIndex, targetIndex, movedAnchors, looseIds, maxSize);
          if (!candidate) continue;
          if (!best || candidate.delta > best.delta) best = candidate;
        }
      }
    }

    return best;
  }

  function bridgeScore(id, target, looseIds) {
    let score = marginalGain(id, target);
    for (const looseId of looseIds) {
      const relation = relationBetween(id, looseId);
      if (!relation) continue;
      score += relation.value * 120 + primary(looseId) * 0.08;
    }
    return score;
  }

  function anchorSubsets(anchors, maxCount) {
    const rows = anchors.map((id) => [id]);
    if (maxCount < 2) return rows;
    for (let i = 0; i < anchors.length; i += 1) {
      for (let j = i + 1; j < anchors.length; j += 1) {
        rows.push([anchors[i], anchors[j]]);
      }
    }
    return rows;
  }

  function buildBridgeCandidate(groups, sourceIndex, targetIndex, movedAnchors, looseIds, maxSize) {
    const movedSet = new Set(movedAnchors);
    const source = groups[sourceIndex];
    const target = groups[targetIndex];
    const sourceBase = source.filter((id) => !movedSet.has(id));
    const targetBase = [...target, ...movedAnchors];
    if (!sourceBase.length || targetBase.length > maxSize) return null;

    const remainingLoose = new Set(looseIds);
    const targetFill = fillFromLoose(targetBase, remainingLoose, maxSize, 120);
    const sourceFill = fillFromLoose(sourceBase, remainingLoose, maxSize, 120);
    const usedLoose = [...targetFill.added, ...sourceFill.added];
    if (!usedLoose.length) return null;

    const oldScore =
      groupMetrics(source).score +
      groupMetrics(target).score +
      usedLoose.reduce((sum, id) => sum + groupMetrics([id]).score, 0);
    const newScore = groupMetrics(sourceFill.group).score + groupMetrics(targetFill.group).score;
    const delta = newScore - oldScore;
    if (delta <= 0) return null;

    const usedLooseSet = new Set(usedLoose);
    const nextGroups = groups
      .map((group, index) => {
        if (index === sourceIndex) return sourceFill.group;
        if (index === targetIndex) return targetFill.group;
        if (group.length === 1 && usedLooseSet.has(group[0])) return [];
        return [...group];
      })
      .filter((group) => group.length);

    return {
      groups: nextGroups,
      delta,
    };
  }

  function fillFromLoose(seedGroup, remainingLoose, maxSize, threshold) {
    const group = [...seedGroup];
    const added = [];
    while (group.length < maxSize && remainingLoose.size) {
      let best = null;
      for (const id of remainingLoose) {
        const gain = marginalGain(id, group);
        if (gain < threshold) continue;
        if (!best || gain > best.gain) best = { id, gain };
      }
      if (!best) break;
      group.push(best.id);
      added.push(best.id);
      remainingLoose.delete(best.id);
    }
    return { group, added };
  }

  function totalScore(groups) {
    return groups.reduce((sum, group) => sum + groupMetrics(group).score, 0);
  }

  function formationStats(groups, baseSmallIds = new Set()) {
    const groupById = new Map();
    groups.forEach((group, index) => {
      for (const id of group) groupById.set(id, index);
    });
    const smallGroups = groups.filter((group) => group.length <= 3);
    let absorbedBaseSmall = 0;
    for (const id of baseSmallIds) {
      const index = groupById.get(id);
      if (index !== undefined && groups[index].length > 3) absorbedBaseSmall += 1;
    }
    return {
      groupCount: groups.length,
      smallCount: smallGroups.length,
      singleCount: groups.filter((group) => group.length === 1).length,
      absorbedBaseSmall,
    };
  }

  function recommendOathSets(ids, planOptions, basePlan, limit = 3) {
    const baseGroups = basePlan.groups;
    const baseScore = totalScore(baseGroups);
    const baseSmallIds = new Set(baseGroups.filter((group) => group.length <= 3).flat());
    const baseClusterSmallIds = new Set(baseGroups.filter((group) => group.length >= 2 && group.length <= 3).flat());
    if (!baseSmallIds.size) return [];

    const baseStats = formationStats(baseGroups, baseSmallIds);
    const candidates = generateOathCandidates(ids, baseGroups, baseSmallIds, baseClusterSmallIds, baseGroups[0]?.[0]);
    const rows = [];
    const seen = new Set();

    function addEvaluation(oaths) {
      const signature = oathSetSignature(oaths);
      if (seen.has(signature)) return;
      seen.add(signature);
      const row = evaluateOathRecommendation(oaths, ids, planOptions, basePlan, baseScore, baseStats, baseSmallIds);
      if (row) rows.push(row);
    }

    for (const candidate of candidates.slice(0, 70)) addEvaluation([candidate.triple]);

    const pairPool = candidates.slice(0, 44);
    for (let i = 0; i < pairPool.length; i += 1) {
      for (let j = i + 1; j < pairPool.length; j += 1) {
        if (oathsOverlap([pairPool[i].triple, pairPool[j].triple])) continue;
        addEvaluation([pairPool[i].triple, pairPool[j].triple]);
      }
    }

    const triplePool = candidates.slice(0, 28);
    for (let i = 0; i < triplePool.length; i += 1) {
      for (let j = i + 1; j < triplePool.length; j += 1) {
        for (let k = j + 1; k < triplePool.length; k += 1) {
          const oaths = [triplePool[i].triple, triplePool[j].triple, triplePool[k].triple];
          if (oathsOverlap(oaths)) continue;
          addEvaluation(oaths);
        }
      }
    }

    return rows
      .sort(
        (a, b) =>
          b.impact - a.impact ||
          b.scoreDelta - a.scoreDelta ||
          a.plan.groups.length - b.plan.groups.length ||
          b.oaths.length - a.oaths.length,
      )
      .slice(0, limit);
  }

  function generateOathCandidates(ids, groups, baseSmallIds, baseClusterSmallIds, mainAnchor) {
    const groupIndex = new Map();
    groups.forEach((group, index) => {
      for (const id of group) groupIndex.set(id, index);
    });

    return combinations3(ids)
      .map((triple) => {
        const smallCount = triple.filter((id) => baseSmallIds.has(id)).length;
        if (!smallCount) return null;
        if (!triple.some((id) => baseClusterSmallIds.has(id))) return null;
        const largeCount = triple.filter((id) => (groups[groupIndex.get(id)]?.length || 0) > 3).length;
        if (!largeCount) return null;

        const distinctGroups = new Set(triple.map((id) => groupIndex.get(id))).size;
        if (distinctGroups < 2) return null;

        const existing = [
          relationBetween(triple[0], triple[1]),
          relationBetween(triple[0], triple[2]),
          relationBetween(triple[1], triple[2]),
        ].filter(Boolean).length;
        const singleCount = triple.filter((id) => groups[groupIndex.get(id)]?.length === 1).length;
        const power = triple.reduce((sum, id) => sum + primary(id), 0);
        const heuristic =
          smallCount * 140 +
          singleCount * 45 +
          distinctGroups * 75 +
          (3 - existing) * 35 +
          existing * 12 +
          (triple.includes(mainAnchor) ? 160 : 0) +
          power * 0.04;

        return { triple, heuristic };
      })
      .filter(Boolean)
      .sort((a, b) => b.heuristic - a.heuristic);
  }

  function evaluateOathRecommendation(oaths, ids, planOptions, basePlan, baseScore, baseStats, baseSmallIds) {
    return withVirtualOaths(oaths, () => {
      const plan = planRoster(ids, planOptions);
      const score = totalScore(plan.groups);
      const scoreDelta = score - baseScore;
      if (scoreDelta <= 0) return null;

      const stats = formationStats(plan.groups, baseSmallIds);
      const mainAnchor = basePlan.groups[0]?.[0];
      const baseMainSize = basePlan.groups[0]?.length || 0;
      const mainGroup = plan.groups.find((group) => group.includes(mainAnchor)) || [];
      const cleanDelta =
        (baseStats.singleCount - stats.singleCount) * 140 +
        (baseStats.smallCount - stats.smallCount) * 90 +
        (baseStats.groupCount - stats.groupCount) * 70 +
        (stats.absorbedBaseSmall - baseStats.absorbedBaseSmall) * 55 +
        (mainGroup.length - baseMainSize) * 300;
      const impact = scoreDelta + cleanDelta;
      if (impact <= 0) return null;

      return {
        oaths,
        plan,
        score,
        scoreDelta,
        cleanDelta,
        impact,
        stats,
      };
    });
  }

  function oathsOverlap(oaths) {
    const seen = new Set();
    for (const oath of oaths) {
      for (const id of oath) {
        if (seen.has(id)) return true;
        seen.add(id);
      }
    }
    return false;
  }

  function oathSignature(oath) {
    return [...oath].sort((a, b) => a - b).join("+");
  }

  function oathSetSignature(oaths) {
    return oaths.map(oathSignature).sort().join("|");
  }

  function clearResults() {
    els.results.innerHTML = "";
    els.oathResults.innerHTML = "";
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

  function setResultTab(tab) {
    activeResultTab = tab;
    for (const button of els.resultTabButtons) button.classList.toggle("active", button.dataset.resultTab === tab);
    els.results.classList.toggle("hidden", tab !== "formation");
    els.oathResults.classList.toggle("hidden", tab !== "oath");
  }

  function setResultTabsVisible(visible) {
    els.resultTabs.classList.toggle("hidden", !visible);
    if (!visible) setResultTab("formation");
  }

  function memberChip(id, buff) {
    const chip = document.createElement("span");
    chip.className = "member-chip";
    chip.textContent = displayName(id);
    const score = document.createElement("strong");
    score.textContent = `+${buff.get(id) || 0}`;
    chip.appendChild(score);
    return chip;
  }

  function relationLine(edge) {
    const row = document.createElement("div");
    row.className = `relation-line relation-card ${REL_CLASS[edge.label]}`;
    row.innerHTML = `<span class="relation-name">${displayName(edge.a)}</span><span class="relation-symbol">${edge.label}</span><span class="relation-name relation-target">${displayName(edge.b)}</span>`;
    row.title = `${displayName(edge.a)} ${edge.arrow} ${edge.label} ${displayName(edge.b)}`;
    return row;
  }

  function renderAffinityList(title, center, rows) {
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.querySelector("h3").textContent = title;
    card.querySelector(".group-score").textContent = `${rows.length}명`;
    card.querySelector(".member-list").remove();

    const relationList = card.querySelector(".relation-list");
    relationList.classList.add("relation-grid", "affinity-list");
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "친애 목록";
    relationList.appendChild(label);

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "relation-line relation-card relation-more";
      empty.textContent = "친애 없음";
      relationList.appendChild(empty);
    }

    for (const row of rows) relationList.appendChild(affinityLine(center, row));
    els.results.appendChild(card);
  }

  function affinityLine(center, row) {
    const relation = row.relation;
    const source = relation.arrow === "<-" ? row.id : center;
    const target = relation.arrow === "<-" ? center : row.id;
    const arrow = relation.arrow === "<->" ? "↔" : "→";
    const node = document.createElement("div");
    node.className = `relation-line relation-card affinity-card ${REL_CLASS[relation.label]}`;
    node.innerHTML = `<span class="relation-name">${displayName(source)}</span><span class="relation-symbol">${relation.label}</span><span class="affinity-arrow">${arrow}</span><span class="relation-name relation-target">${displayName(target)}</span>`;
    node.title = `${displayName(source)} ${relation.label}${arrow} ${displayName(target)}`;
    return node;
  }

  function renderGroup(title, group, options = {}) {
    const metrics = groupMetrics(group);
    const card = els.template.content.firstElementChild.cloneNode(true);
    const parent = options.parent || els.results;
    card.querySelector("h3").textContent = title;
    card.querySelector(".group-score").textContent = `score ${metrics.score}`;

    const memberList = card.querySelector(".member-list");
    for (const id of group) memberList.appendChild(memberChip(id, metrics.buff));

    const relationList = card.querySelector(".relation-list");
    relationList.classList.add("relation-grid");
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "연결 근거";
    relationList.appendChild(label);

    const groupOrder = new Map(group.map((id, index) => [id, index]));
    const edges = metrics.edges.sort(
      (a, b) =>
        groupOrder.get(a.a) - groupOrder.get(b.a) ||
        groupOrder.get(a.b) - groupOrder.get(b.b) ||
        b.value - a.value,
    );
    if (!edges.length) {
      const empty = document.createElement("div");
      empty.className = "relation-line relation-card";
      empty.textContent = "-";
      relationList.appendChild(empty);
    } else {
      for (const edge of edges.slice(0, options.edgeLimit || 24)) relationList.appendChild(relationLine(edge));
      if (edges.length > (options.edgeLimit || 24)) {
        const more = document.createElement("div");
        more.className = "relation-line relation-card relation-more";
        more.textContent = `외 ${edges.length - (options.edgeLimit || 24)}개`;
        relationList.appendChild(more);
      }
    }

    parent.appendChild(card);
    return metrics.score;
  }

  function appendRec(parent, text) {
    const row = document.createElement("div");
    row.className = "rec-line";
    row.textContent = text;
    parent.appendChild(row);
  }

  function appendChangeBadge(parent, label, before, after) {
    if (before === after) return false;
    const badge = document.createElement("span");
    badge.className = "change-badge";
    badge.textContent = `${label} ${before} → ${after}`;
    parent.appendChild(badge);
    return true;
  }

  function renderFormationPreviewCard(group, index, parent) {
    const metrics = groupMetrics(group);
    const card = document.createElement("div");
    card.className = "formation-preview-card";

    const top = document.createElement("div");
    top.className = "group-top";
    const title = document.createElement("h3");
    const topNames = group
      .slice(0, 3)
      .map(displayName)
      .join(", ");
    title.textContent = `${index + 1}집단 · ${topNames}`;
    const score = document.createElement("span");
    score.className = "group-score";
    score.textContent = `score ${metrics.score}`;
    top.append(title, score);
    card.appendChild(top);

    const memberList = document.createElement("div");
    memberList.className = "member-list";
    for (const id of group) memberList.appendChild(memberChip(id, metrics.buff));
    card.appendChild(memberList);
    parent.appendChild(card);
  }

  function renderOathRecommendations(recommendations, basePlan) {
    if (!recommendations.length) {
      const node = document.createElement("div");
      node.className = "empty-state";
      node.textContent = "총점과 편성 안정성이 함께 좋아지는 의형제 추천세트를 찾지 못했습니다.";
      els.oathResults.appendChild(node);
      return;
    }

    recommendations.forEach((recommendation, index) => {
      const card = document.createElement("article");
      card.className = "group-card";

      const top = document.createElement("div");
      top.className = "group-top";
      const title = document.createElement("h3");
      title.textContent = `${index + 1}추천 · 의형제 재편성`;
      const score = document.createElement("span");
      score.className = "group-score";
      score.textContent = `+${Math.round(recommendation.scoreDelta)}`;
      top.append(title, score);
      card.appendChild(top);

      const oathList = document.createElement("div");
      oathList.className = "oath-summary";
      const oathLabel = document.createElement("div");
      oathLabel.className = "section-label";
      oathLabel.textContent = "추천 의형제";
      oathList.appendChild(oathLabel);
      for (const oath of recommendation.oaths) {
        appendRec(oathList, oath.map(displayName).join(" + "));
      }
      card.appendChild(oathList);

      const baseStats = formationStats(basePlan.groups);
      const changeList = document.createElement("div");
      changeList.className = "change-badges";
      const hasGroupChange = appendChangeBadge(changeList, "집단", basePlan.groups.length, recommendation.plan.groups.length);
      const hasSingleChange = appendChangeBadge(changeList, "1인 집단", baseStats.singleCount, recommendation.stats.singleCount);
      if (hasGroupChange || hasSingleChange) {
        const changeSection = document.createElement("div");
        changeSection.className = "recommendations";
        const changeLabel = document.createElement("div");
        changeLabel.className = "section-label";
        changeLabel.textContent = "예상 변화";
        changeSection.append(changeLabel, changeList);
        card.appendChild(changeSection);
      }

      const formationList = document.createElement("div");
      formationList.className = "formation-preview-list";
      const formationLabel = document.createElement("div");
      formationLabel.className = "section-label";
      formationLabel.textContent = "예상 편성";
      formationList.appendChild(formationLabel);
      recommendation.plan.groups.forEach((group, groupIndex) => {
        renderFormationPreviewCard(group, groupIndex, formationList);
      });
      card.appendChild(formationList);

      els.oathResults.appendChild(card);
    });
  }

  function renderRoster() {
    clearResults();
    const tokens = parseNames(els.rosterInput.value);
    const duplicateState = updateDuplicateSelectors(tokens);
    const { ids, warnings } = resolveNames(tokens, {
      duplicateSelections: duplicateState.selections,
      autoAllDuplicateNames: duplicateState.autoAllDuplicateNames,
    });
    warnings.push(...duplicateState.warnings);
    if (!ids.length) {
      renderEmpty("분석할 장수를 입력하세요.");
      return;
    }

    const planOptions = planningOptions(ids.length, warnings);
    const plan = planRoster(ids, planOptions);
    const groups = plan.groups;
    if (planOptions.mode === "count" && groups.length !== planOptions.targetCount) {
      warnings.push(`목표 ${planOptions.targetCount}집단에 최대한 가깝게 ${groups.length}집단으로 편성했습니다.`);
    }
    const total = totalScore(groups);
    const oathRecommendations = activeResultTab === "oath" ? recommendOathSets(ids, planOptions, plan) : [];

    if (activeResultTab === "formation") {
      groups.forEach((group, index) => {
        const topNames = group
          .slice(0, 3)
          .map(displayName)
          .join(", ");
        renderGroup(`${index + 1}집단 · ${topNames}`, group);
      });
    } else {
      renderOathRecommendations(oathRecommendations, plan);
    }

    renderWarnings(warnings);
    setResultTab(activeResultTab);
    if (activeResultTab === "oath") {
      els.resultTitle.textContent = "의형제 추천";
      els.resultMeta.textContent = `${ids.length}명 · 추천 ${oathRecommendations.length}건 · 예상 편성 변화`;
      els.scoreBadge.textContent = `${oathRecommendations.length}건`;
    } else {
      els.resultTitle.textContent = "보유 장수 편성 결과";
      els.resultMeta.textContent = `${ids.length}명 · 목표 ${planOptions.targetCount}집단 · 최대 ${planOptions.maxSize}명`;
      els.scoreBadge.textContent = `${Math.round(total)}`;
    }
  }

  function renderSingle() {
    clearResults();
    setResultTabsVisible(false);
    const { ids, warnings } = resolveNames([els.centerInput.value.trim()]);
    if (!ids.length) {
      renderEmpty("중심 장수를 입력하세요.");
      return;
    }

    const center = ids[0];
    const depth = Math.max(1, Math.min(4, Number(els.hopDepth.value) || 4));
    const paths = findPaths(center, depth);
    const groupPaths = paths
      .filter((row) => row.path.length >= 3)
      .sort((a, b) => b.score - a.score || a.path.length - b.path.length);
    const directRows = [...(neighbors.get(center)?.keys() || [])]
      .map((id) => ({ id, relation: relationBetween(center, id) }))
      .filter((row) => row.relation)
      .sort((a, b) => {
        const directionA = a.relation.arrow === "<->" ? 2 : a.relation.arrow === "->" ? 1 : 0;
        const directionB = b.relation.arrow === "<->" ? 2 : b.relation.arrow === "->" ? 1 : 0;
        return (
          b.relation.value - a.relation.value ||
          directionB - directionA ||
          primary(b.id) - primary(a.id) ||
          displayName(a.id).localeCompare(displayName(b.id), "ko")
        );
      })

    renderAffinityList(`친애 목록 · ${displayName(center)}`, center, directRows);
    renderPathCard(`집단 추천 · ${displayName(center)}`, groupPaths.slice(0, 50));

    renderWarnings(warnings);
    els.resultTitle.textContent = "중심 장수 분석 결과";
    els.resultMeta.textContent = `${displayName(center)} · ${depth}단계 · ☆/◎/○ 포함`;
    els.scoreBadge.textContent = `${groupPaths.length}`;
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
    const relationList = card.querySelector(".relation-list");
    relationList.classList.add("path-relation-list");
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
      parts.push(`<span class="relation-symbol">${relation.label}</span> ${displayName(path[i])}`);
    }
    return parts.join(" ");
  }

  function renderEmpty(text) {
    clearResults();
    const node = document.createElement("div");
    node.className = "empty-state";
    node.textContent = text;
    const parent = mode === "roster" && activeResultTab === "oath" ? els.oathResults : els.results;
    parent.appendChild(node);
    setResultTab(mode === "roster" ? activeResultTab : "formation");
    els.scoreBadge.textContent = "READY";
  }

  function setMode(nextMode) {
    mode = nextMode;
    for (const button of els.segments) button.classList.toggle("active", button.dataset.mode === mode);
    for (const panel of els.panels) panel.classList.toggle("hidden", panel.dataset.panel !== mode);
    setResultTabsVisible(mode === "roster");
    if (mode === "roster") renderRoster();
    else renderSingle();
  }

  function bindEvents() {
    for (const button of els.segments) {
      button.addEventListener("click", () => setMode(button.dataset.mode));
    }
    for (const button of els.resultTabButtons) {
      button.addEventListener("click", () => {
        setResultTab(button.dataset.resultTab);
        if (mode === "roster") renderRoster();
      });
    }
    els.rosterInput.addEventListener("input", () => {
      updateRosterLimitControls();
      updateDuplicateSelectors();
    });
    for (const input of [els.groupCount, els.maxSize]) {
      input.addEventListener("change", () => {
        rosterLimitValues.groupCount = Number(els.groupCount.value) || rosterLimitValues.groupCount;
        rosterLimitValues.maxSize = Number(els.maxSize.value) || rosterLimitValues.maxSize;
        if (mode === "roster") renderRoster();
      });
    }
    els.sampleRoster.addEventListener("click", () => {
      els.rosterInput.value = SAMPLE_ROSTER;
      updateRosterLimitControls();
      updateDuplicateSelectors();
      renderRoster();
    });
    els.runButton.addEventListener("click", () => {
      if (mode === "roster") renderRoster();
      else renderSingle();
    });
  }

  function init() {
    setupGraph();
    setupDatalist();
    bindEvents();
    els.rosterInput.value = "";
    els.centerInput.value = "";
    updateRosterLimitControls();
    updateDuplicateSelectors();
    renderRoster();
  }

  init();
})();
