(() => {
  const DATA = window.SAN14_DATA;
  const REL_VALUE = { "☆": 3, "◎": 2, "○": 1 };
  const REL_LABEL = { 3: "☆", 2: "◎", 1: "○" };
  const REL_CLASS = { "☆": "star", "◎": "double", "○": "single" };
  const MAX_GROUP_SIZE = 30;
  const MIN_GROUP_SIZE = 3;
  const RECOMMENDATION_LIMIT = 6;
  const SUPPORT_TRAITS = new Set(["보좌", "응원", "악주"]);
  const TIER_ORDER = { reserve: 0, support: 1, upper: 2, key: 3, core: 4 };
  const THEME_STORAGE_KEY = "san14-theme";
  const APP_VERSION = "v1.3";
  const REGRESSION_SAMPLES = {
    cao: {
      groupCount: 4,
      maxSize: 20,
      text: "조조 조인 조홍 조순 조휴 하후돈 하후연 하후덕 하후상 순욱 순유 곽가 유엽 정욱 변씨 환씨 조비 조창 조식 조충 우금 우금 장료 이전 악진 서황 장합 사마의 조엄 가후 전위 허저 종요 장창포 종회 등애 학소",
    },
    liu: {
      groupCount: 4,
      maxSize: 20,
      text: "유비 관우 장비 손건 미축 미방 감씨 미씨 조운 주창 진도 요화 제갈량 황월영 방통 서서 위연 황충 마초 마대 마운록 장임 황권 엄안 뇌동 법정 오란 오의 오반 유봉 관평 관색 관흥 관은병 장포 하후씨 장씨 강유 왕보 조루",
    },
    sun: {
      groupCount: 4,
      maxSize: 20,
      text: "손책 주유 대교 소교 노숙 정보 한당 황개 주치 여범 장소 장굉 조무 감녕 여몽 손권 오국태 육손 손씨 장흠 전종 주연 주태 손하 손익 손상향 서씨 제갈근 손교 손유 태사자 태사향",
    },
    yuan: {
      groupCount: 4,
      maxSize: 20,
      text: "원소 유씨 원담 원희 원상 고간 안량 문추 고람 장합 저수 전풍 저곡 심배 봉기 곽도 순우경 전예 선우보 염유 전주 유화",
    },
  };

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
    coreInput: document.querySelector("#coreInput"),
    centerInput: document.querySelector("#centerInput"),
    groupCount: document.querySelector("#groupCount"),
    maxSize: document.querySelector("#maxSize"),
    duplicateSelectors: document.querySelector("#duplicateSelectors"),
    recommendationFilters: document.querySelector("#recommendationFilters"),
    recommendationFilterInputs: [...document.querySelectorAll("[data-rec-filter]")],
    hopDepth: document.querySelector("#hopDepth"),
    sampleRosterButtons: [...document.querySelectorAll("[data-sample-roster]")],
    themeToggle: document.querySelector("#themeToggle"),
    runButtons: [...document.querySelectorAll("[data-run-action]")],
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
  const rosterLimitValues = { groupCount: 4, maxSize: 20 };
  const recommendationFilterValues = { oath: true, marriage: true, rescue: true, support: true };
  const duplicateSelectionValues = new Map();

  function preferredSystemTheme() {
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function setTheme(theme, persist = false) {
    const nextTheme = theme === "dark" ? "dark" : "light";
    if (document.documentElement?.dataset) document.documentElement.dataset.theme = nextTheme;
    if (els.themeToggle) {
      els.themeToggle.textContent = nextTheme === "dark" ? "☀" : "☾";
      els.themeToggle.setAttribute("aria-label", `${nextTheme === "dark" ? "라이트" : "다크"} 테마로 변경`);
      els.themeToggle.title = `${nextTheme === "dark" ? "라이트" : "다크"} 테마`;
    }
    if (persist) {
      try {
        window.localStorage?.setItem(THEME_STORAGE_KEY, nextTheme);
      } catch {
        // Theme persistence is optional.
      }
    }
  }

  function initTheme() {
    let savedTheme = document.documentElement?.dataset?.theme;
    if (!savedTheme) {
      try {
        savedTheme = window.localStorage?.getItem(THEME_STORAGE_KEY);
      } catch {
        savedTheme = null;
      }
    }
    setTheme(savedTheme || preferredSystemTheme());
  }

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

  function officerTraits(id) {
    return officer(id)?.traits?.map((trait) => trait.name) || [];
  }

  function hasSupportTrait(id) {
    return officerTraits(id).some((name) => SUPPORT_TRAITS.has(name));
  }

  function isFemale(id) {
    return officer(id)?.gender === "여";
  }

  function fieldPower(id) {
    const stats = officer(id)?.stats || {};
    const leadership = stats.leadership || 0;
    const war = stats.war || 0;
    const intelligence = stats.intelligence || 0;
    const politics = stats.politics || 0;
    const highBattleStat = Math.max(war, intelligence);
    const lowBattleStat = Math.min(war, intelligence);
    return leadership * 1.5 + highBattleStat + lowBattleStat * 0.25 + politics * 0.15 + traitScore(id) * 4;
  }

  function roleTags(id) {
    const stats = officer(id)?.stats || {};
    const tags = [];
    if ((stats.leadership || 0) >= 75 && (stats.war || 0) >= 70) tags.push("전투");
    if ((stats.leadership || 0) >= 70 && (stats.intelligence || 0) >= 70) tags.push("지휘");
    if ((stats.intelligence || 0) >= 80 && (stats.politics || 0) >= 70) tags.push("참모");
    if ((stats.politics || 0) >= 75) tags.push("실무");
    if (hasSupportTrait(id)) tags.push("지원");
    return tags.length ? tags : ["보조"];
  }

  function affinityReach(id, scope = null) {
    const pool = scope || [...(neighbors.get(id)?.keys() || [])];
    let links = 0;
    let quality = 0;
    let star = 0;
    for (const other of pool) {
      if (other === id) continue;
      const relation = relationBetween(id, other);
      if (!relation) continue;
      links += 1;
      quality += relation.value;
      if (relation.value === 3) star += 1;
    }
    return {
      links,
      quality,
      star,
      score: links * 100 + quality * 18 + star * 24 + fieldPower(id) * 0.04,
    };
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

  function coreTokenCount() {
    return parseNames(els.coreInput.value).length;
  }

  function updateRosterLimitControls(rosterSize = rosterTokenCount(), minTargetCount = coreTokenCount()) {
    const maxSize = clampInteger(els.maxSize.value, MIN_GROUP_SIZE, MAX_GROUP_SIZE, rosterLimitValues.maxSize);
    const minCount = Math.max(1, minTargetCount);
    const maxCount = rosterSize
      ? Math.max(minCount, rosterSize)
      : Math.max(minCount, rosterLimitValues.groupCount, Number(els.groupCount.value) || 1);
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

  function planningOptions(rosterSize, warnings, minTargetCount = 1) {
    const rawMaxSize = Number(els.maxSize.value);
    const maxSize = clampInteger(rawMaxSize, MIN_GROUP_SIZE, MAX_GROUP_SIZE, rosterLimitValues.maxSize);
    if (Number.isFinite(rawMaxSize) && Math.round(rawMaxSize) !== maxSize) {
      warnings.push(`집단 상한은 ${MIN_GROUP_SIZE}~${MAX_GROUP_SIZE} 범위로 조정됩니다.`);
    }

    const minCount = Math.max(1, minTargetCount);
    const maxCount = Math.max(minCount, rosterSize);
    const rawTargetCount = Number(els.groupCount.value);
    const targetCount = clampInteger(rawTargetCount, minCount, maxCount, rosterLimitValues.groupCount);
    if (Number.isFinite(rawTargetCount) && Math.round(rawTargetCount) !== targetCount) {
      warnings.push(`목표 집단 수는 ${minCount}~${maxCount} 범위로 조정됩니다.`);
    }

    rosterLimitValues.maxSize = maxSize;
    rosterLimitValues.groupCount = targetCount;
    els.maxSize.value = maxSize;
    els.groupCount.value = targetCount;
    updateRosterLimitControls(rosterSize, minCount);
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
      .split(/[\s,，、]+/)
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

  function resolveFixedCoreIds(rosterIds, duplicateState, warnings) {
    const tokens = parseNames(els.coreInput.value);
    if (!tokens.length) return [];

    const resolved = resolveNames(tokens, {
      duplicateSelections: duplicateState.selections,
      autoAllDuplicateNames: duplicateState.autoAllDuplicateNames,
    });
    warnings.push(...resolved.warnings.map((warning) => `코어 고정: ${warning}`));

    const rosterSet = new Set(rosterIds);
    const fixed = [];
    for (const id of resolved.ids) {
      if (!rosterSet.has(id)) {
        warnings.push(`코어 고정: ${displayName(id)} 장수는 보유 장수 목록에 없어 제외했습니다.`);
        continue;
      }
      if (!fixed.includes(id)) fixed.push(id);
    }
    return fixed;
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

  function groupRelationSummary(id, group) {
    let links = 0;
    let quality = 0;
    let star = 0;
    for (const other of group) {
      if (other === id) continue;
      const relation = relationBetween(id, other);
      if (!relation) continue;
      links += 1;
      quality += relation.value;
      if (relation.value === 3) star += 1;
    }
    return { links, quality, star };
  }

  function rankGroups(groups) {
    return groups
      .filter((group) => group.length)
      .map((group) => {
        const [anchor, ...members] = group;
        const metrics = groupMetrics(group).buff;
        return [
          anchor,
          ...members.sort((a, b) => metrics.get(b) - metrics.get(a) || primary(b) - primary(a)),
        ];
      })
      .sort((a, b) => groupMetrics(b).score - groupMetrics(a).score);
  }

  function sortUnassigned(ids) {
    return [...ids].sort((a, b) => fieldPower(b) - fieldPower(a) || primary(b) - primary(a));
  }

  function hasRosterRelation(id, ids) {
    return ids.some((other) => other !== id && relationBetween(id, other));
  }

  function mainStat(id) {
    const stats = officer(id)?.stats || {};
    return Math.max(stats.leadership || 0, stats.war || 0, stats.intelligence || 0);
  }

  function isIndependentCoreType(id) {
    const stats = officer(id)?.stats || {};
    return roleTags(id).includes("전투") || ((stats.leadership || 0) >= 85 && (stats.war || 0) >= 75);
  }

  function isCommandCoreType(id) {
    return isIndependentCoreType(id) || mainStat(id) >= 90 || fieldPower(id) >= 285;
  }

  function tierInfo(id, scope = null) {
    const stats = officer(id)?.stats || {};
    const reach = affinityReach(id, scope);
    const globalReach = affinityReach(id);
    const highStat = mainStat(id);
    const support = hasSupportTrait(id);
    const power = fieldPower(id);
    const key =
      highStat >= 90 ||
      (highStat >= 85 && traitScore(id) >= 10) ||
      (highStat >= 85 && power >= 205);
    const upper = key || reach.links >= 2 || highStat >= 80 || traitScore(id) >= 8 || power >= 180;
    const eliteSupport = support && key && (highStat >= 90 || power >= 280);
    const canLead = !support || eliteSupport;
    const core =
      canLead &&
      ((reach.links >= 3 && (key || globalReach.links >= 6 || power >= 190)) ||
        (key && reach.links >= 2) ||
        (upper && globalReach.links >= 8 && reach.links >= 2));
    const tier = core ? "core" : support ? "support" : key ? "key" : upper ? "upper" : "reserve";
    const coreScore =
      reach.score * 2.2 +
      globalReach.score * 0.35 +
      power * 0.85 +
      highStat * 2.1 +
      traitScore(id) * 18 +
      (isIndependentCoreType(id) ? 120 : 0) +
      (isCommandCoreType(id) ? 180 : 0) +
      (key ? 180 : 0) +
      (upper ? 80 : 0) -
      (support && !upper ? 80 : 0);

    return {
      tier,
      rank: TIER_ORDER[tier],
      support,
      key,
      upper,
      core,
      highStat,
      reach,
      globalReach,
      power,
      coreScore,
    };
  }

  function strongerUnselectedCorePenalty(id, selectedCores, scope) {
    const info = tierInfo(id, scope);
    let penalty = 0;
    for (const other of scope) {
      if (other === id || selectedCores.includes(other)) continue;
      const relation = relationBetween(id, other);
      if (!relation || relation.value < 2) continue;
      const otherInfo = tierInfo(other, scope);
      if (otherInfo.coreScore <= info.coreScore + 180) continue;
      const rate = isIndependentCoreType(id) ? 0.18 : 0.42;
      penalty = Math.max(penalty, (otherInfo.coreScore - info.coreScore) * rate + relation.value * 90);
    }
    return penalty;
  }

  function coreCoverageScore(id, selectedCores, scope) {
    if (!selectedCores.length) return -strongerUnselectedCorePenalty(id, selectedCores, scope);

    let unique = 0;
    let overlap = 0;
    for (const other of scope) {
      if (other === id || selectedCores.includes(other)) continue;
      const relation = relationBetween(id, other);
      if (!relation) continue;

      const selectedBest = selectedCores.reduce(
        (best, core) => Math.max(best, relationBetween(core, other)?.value || 0),
        0,
      );
      const otherInfo = tierInfo(other, scope);
      const tierWeight = otherInfo.key ? 1.45 : otherInfo.upper ? 1.12 : otherInfo.support ? 0.8 : 0.45;
      if (relation.value > selectedBest) unique += (relation.value - selectedBest) * 120 * tierWeight + 35;
      else if (selectedBest) overlap += relation.value * 42 * tierWeight;
    }

    const directCorePenalty = selectedCores.reduce((sum, core) => {
      const relation = relationBetween(id, core);
      if (!relation) return sum;
      return sum + relation.value * (isIndependentCoreType(id) ? 28 : 120);
    }, 0);
    return unique - overlap - directCorePenalty - strongerUnselectedCorePenalty(id, selectedCores, scope);
  }

  function selectedCoreCoverage(id, selectedCores) {
    return selectedCores.reduce((best, core) => Math.max(best, relationBetween(core, id)?.value || 0), 0);
  }

  function lineMemberRows(id, scope, selectedCores) {
    return scope
      .filter((other) => other !== id && !selectedCores.includes(other))
      .map((other) => {
        const relation = relationBetween(id, other);
        if (!relation) return null;
        const covered = selectedCoreCoverage(other, selectedCores);
        const unique = Math.max(0, relation.value - covered);
        const info = tierInfo(other, scope);
        const tierBonus = info.key ? 220 : info.upper ? 150 : info.support ? 80 : 40;
        const coveredPenalty = covered >= relation.value ? covered * 190 : 0;
        const value =
          relation.value * 190 +
          unique * 280 +
          (relation.value === 3 ? 260 : 0) +
          tierBonus +
          fieldPower(other) * 0.14 -
          coveredPenalty;
        return { id: other, relation, covered, unique, value };
      })
      .filter(Boolean)
      .filter((row) => row.relation.value >= 2 || row.unique > 0)
      .filter((row) => row.value > 120)
      .sort((a, b) => b.value - a.value || fieldPower(b.id) - fieldPower(a.id));
  }

  function candidateLineInfo(id, scope, selectedCores) {
    const members = lineMemberRows(id, scope, selectedCores).slice(0, 3);
    if (!members.length) return { members: [], score: 0, protection: false };

    const lineIds = [id, ...members.map((row) => row.id)];
    const metrics = groupMetrics(lineIds);
    const uniqueCount = members.filter((row) => row.unique > 0).length;
    const starCount = metrics.edges.filter((edge) => edge.value === 3).length;
    const coreCovered = selectedCoreCoverage(id, selectedCores);
    const absorbablePenalty = coreCovered >= 2 ? 0.42 : coreCovered ? 0.72 : 1;
    const lineScore =
      (metrics.quality * 180 +
        metrics.edges.length * 80 +
        starCount * 220 +
        uniqueCount * 360 +
        members.reduce((sum, row) => sum + row.value, 0) * 0.32) *
      absorbablePenalty;

    return {
      members: members.map((row) => row.id),
      score: lineScore,
      protection: uniqueCount >= 2 && (starCount >= 2 || metrics.quality >= 5),
    };
  }

  function coreIndependencePenalty(id, selectedCores, scope, line, targetCount) {
    if (!selectedCores.length) return 0;

    const coverage = selectedCoreCoverage(id, selectedCores);
    if (coverage < 2) return 0;

    const earlyCoreSlot = selectedCores.length < 3;
    const requiredLineScore = earlyCoreSlot
      ? coverage >= 3
        ? 1300
        : 1050
      : coverage >= 3
        ? 950
        : 760;
    const protectedLineScore = line.protection ? requiredLineScore * 0.78 : requiredLineScore;
    const deficit = Math.max(0, protectedLineScore - line.score);
    if (!deficit) return 0;

    const pressure = targetCount <= 3 ? 1.15 : targetCount <= 4 ? 1 : 0.72;
    const commandRelief = isCommandCoreType(id) ? 120 : 0;
    return Math.max(0, (coverage * 190 + deficit * 0.82) * pressure - commandRelief);
  }

  function narrowCorePenalty(id, targetCount, line) {
    if (isCommandCoreType(id)) return 0;
    const base = targetCount <= 4 ? 720 : targetCount <= 6 ? 360 : 0;
    if (!base) return 0;

    const protectedLine = line.protection && line.members.length >= 3;
    if (!protectedLine) return base;

    const relief = Math.max(0, line.score - 1000) * 1.25 + 120;
    return Math.max(0, base - Math.min(base, relief));
  }

  function selectRosterCores(ids, targetCount, fixedCoreIds = []) {
    const scope = [...ids];
    const selected = [...new Set(fixedCoreIds.filter((id) => scope.includes(id)))].slice(0, targetCount);
    const candidates = scope
      .map((id) => ({ id, info: tierInfo(id, scope) }))
      .filter(
        (row) =>
          hasRosterRelation(row.id, scope) &&
          (!row.info.support || row.info.core) &&
          (row.info.rank >= TIER_ORDER.upper || row.info.reach.links >= 2),
      )
      .sort(
        (a, b) =>
          b.info.coreScore - a.info.coreScore ||
          b.info.rank - a.info.rank ||
          b.info.power - a.info.power ||
          displayName(a.id).localeCompare(displayName(b.id), "ko"),
      );

    const limit = Math.min(targetCount, candidates.length);
    while (selected.length < targetCount && selected.length < fixedCoreIds.length + limit) {
      let best = null;
      for (const row of candidates) {
        if (selected.includes(row.id)) continue;
        const spread = coreCoverageScore(row.id, selected, scope);
        const line = candidateLineInfo(row.id, scope, selected);
        const lineBonus = selected.length >= 3 ? line.score * 0.95 : 0;
        const independencePenalty = coreIndependencePenalty(row.id, selected, scope, line, targetCount);
        const narrowPenalty = narrowCorePenalty(row.id, targetCount, line);
        const score = row.info.coreScore + spread + lineBonus - narrowPenalty - independencePenalty;
        const candidate = { id: row.id, score };
        if (!best || candidate.score > best.score) best = candidate;
      }
      if (!best) break;
      selected.push(best.id);
    }
    return selected;
  }

  function seedProtectedCoreLines(groups, remaining, scope, maxSize) {
    const cores = groups.map((group) => group[0]);
    for (const group of groups) {
      const core = group[0];
      const otherCores = cores.filter((id) => id !== core);
      const line = candidateLineInfo(core, scope, otherCores);
      if (!line.protection) continue;

      for (const id of line.members) {
        if (group.length >= maxSize) break;
        if (!remaining.has(id)) continue;
        const relation = relationBetween(core, id);
        const covered = selectedCoreCoverage(id, otherCores);
        if (!relation || covered >= relation.value) continue;
        group.push(id);
        remaining.delete(id);
      }
    }
  }

  function candidatePhaseMatches(info, phase) {
    if (phase === "key") return info.tier === "key" || info.tier === "core";
    if (phase === "upper") return info.tier === "upper";
    if (phase === "support") return info.support && info.rank <= TIER_ORDER.support;
    return info.tier === "reserve";
  }

  function candidateSortValue(id, scope) {
    const info = tierInfo(id, scope);
    return info.rank * 10000 + info.power * 18 + info.reach.score + traitScore(id) * 80;
  }

  function rosterFitScore(id, group, scope) {
    const relation = groupRelationSummary(id, group);
    if (!relation.links) return null;

    const info = tierInfo(id, scope);
    const coreRelation = relationBetween(id, group[0])?.value || 0;
    const supportBonus = info.support ? (group.some(hasSupportTrait) ? 30 : 180) : 0;
    const roleBonus = roleComplementScore(id, group) * 0.16;
    const directCoreBonus = coreRelation * 280;
    const relationScore = relation.quality * 120 + relation.links * 58 + relation.star * 140;
    const abilityScore = info.power * 0.22 + traitScore(id) * 8 + info.highStat * 0.9;
    const sizeBonus = Math.max(0, 7 - group.length) * 12;

    return {
      score: relationScore + directCoreBonus + supportBonus + roleBonus + abilityScore + sizeBonus,
      relation,
      info,
    };
  }

  function rosterFitThreshold(phase) {
    if (phase === "key") return 210;
    if (phase === "upper") return 185;
    if (phase === "support") return 145;
    return 260;
  }

  function canUseRosterFit(row, phase) {
    if (!row) return false;
    if (phase !== "reserve") return true;
    return row.relation.links >= 2 || row.relation.star > 0 || row.relation.quality >= 3;
  }

  function bestRosterGroupFor(id, groups, scope, maxSize, phase) {
    let best = null;
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      if (group.length >= maxSize) continue;
      const row = rosterFitScore(id, group, scope);
      if (!canUseRosterFit(row, phase)) continue;
      if (row.score < rosterFitThreshold(phase)) continue;
      const candidate = { index, ...row };
      if (!best || candidate.score > best.score) best = candidate;
    }
    return best;
  }

  function assignRosterPhase(groups, remaining, scope, maxSize, phase) {
    const candidates = [...remaining]
      .filter((id) => candidatePhaseMatches(tierInfo(id, scope), phase))
      .sort((a, b) => candidateSortValue(b, scope) - candidateSortValue(a, scope));

    for (const id of candidates) {
      if (!remaining.has(id)) continue;
      const target = bestRosterGroupFor(id, groups, scope, maxSize, phase);
      if (!target) continue;
      groups[target.index].push(id);
      remaining.delete(id);
    }
  }

  function packageMemberRows(seed, remaining, coreIds) {
    return [...remaining]
      .filter((id) => id !== seed)
      .map((id) => {
        const relation = relationBetween(seed, id);
        if (!relation) return null;
        const covered = selectedCoreCoverage(id, coreIds);
        const unique = Math.max(0, relation.value - covered);
        const info = tierInfo(id, [...remaining]);
        const value =
          relation.value * 210 +
          unique * 250 +
          (relation.value === 3 ? 260 : 0) +
          (info.key ? 180 : info.upper ? 120 : info.support ? 70 : 35) +
          fieldPower(id) * 0.12 -
          (covered >= relation.value ? covered * 170 : 0);
        return { id, relation, value };
      })
      .filter(Boolean)
      .filter((row) => row.relation.value >= 2 || row.value >= 280)
      .sort((a, b) => b.value - a.value || fieldPower(b.id) - fieldPower(a.id));
  }

  function smallLinePackage(seed, remaining, scope, coreIds) {
    const members = packageMemberRows(seed, remaining, coreIds).slice(0, 2).map((row) => row.id);
    if (!members.length) return null;

    const ids = [seed, ...members];
    const metrics = groupMetrics(ids);
    if (!metrics.edges.length) return null;
    const starCount = metrics.edges.filter((edge) => edge.value === 3).length;
    const quality = metrics.quality;
    const packageScore =
      quality * 170 +
      metrics.edges.length * 90 +
      starCount * 230 +
      ids.reduce((sum, id) => sum + fieldPower(id), 0) * 0.18;
    if (packageScore < 520) return null;

    return { ids, score: packageScore, quality, starCount };
  }

  function smallLinePackages(remaining, scope, coreIds) {
    const bySignature = new Map();
    for (const seed of remaining) {
      const line = smallLinePackage(seed, remaining, scope, coreIds);
      if (!line) continue;
      const signature = [...line.ids].sort((a, b) => a - b).join("+");
      const previous = bySignature.get(signature);
      if (!previous || line.score > previous.score) bySignature.set(signature, line);
    }
    return [...bySignature.values()].sort((a, b) => b.score - a.score);
  }

  function packageGroupFit(line, group, scope) {
    let links = 0;
    let quality = 0;
    let star = 0;

    for (const id of line.ids) {
      for (const other of group) {
        const relation = relationBetween(id, other);
        if (!relation) continue;
        links += 1;
        quality += relation.value;
        if (relation.value === 3) star += 1;
      }
    }

    if (!links) return null;

    const roleValue = line.ids.reduce((sum, id) => sum + roleComplementScore(id, group) * 0.08, 0);
    const score =
      quality * 210 +
      links * 75 +
      star * 180 +
      line.score * 0.55 +
      roleValue +
      line.ids.reduce((sum, id) => sum + fieldPower(id), 0) * 0.08;

    return { score, links, quality, star };
  }

  function assignSmallLinePackages(groups, remaining, scope, maxSize) {
    const coreIds = groups.map((group) => group[0]);

    for (let pass = 0; pass < 6; pass += 1) {
      let best = null;
      const packages = smallLinePackages(remaining, scope, coreIds);
      for (const line of packages) {
        if (!line.ids.every((id) => remaining.has(id))) continue;

        for (let index = 0; index < groups.length; index += 1) {
          const group = groups[index];
          if (group.length + line.ids.length > maxSize) continue;
          const fit = packageGroupFit(line, group, scope);
          if (!fit) continue;

          const threshold = line.ids.length >= 3 ? 960 : 720;
          if (fit.score < threshold) continue;
          const row = { index, line, fit, score: fit.score + line.score * 0.25 };
          if (!best || row.score > best.score) best = row;
        }
      }

      if (!best) break;
      for (const id of best.line.ids) {
        groups[best.index].push(id);
        remaining.delete(id);
      }
    }
  }

  function groupSizeBalancePenalty(groups) {
    if (!groups.length) return 0;
    const sizes = groups.map((group) => group.length);
    const total = sizes.reduce((sum, size) => sum + size, 0);
    const average = total / sizes.length;
    const spread = Math.max(...sizes) - Math.min(...sizes);
    const deviation = sizes.reduce((sum, size) => sum + Math.abs(size - average), 0);
    const tiny = sizes.filter((size) => size > 1 && size <= 3).length;
    return deviation * 60 + spread * 18 + tiny * 90;
  }

  function movablePackageFollowers(seed, source) {
    return source
      .slice(1)
      .filter((id) => id !== seed)
      .map((id) => {
        const relation = relationBetween(seed, id);
        if (!relation) return null;

        const sourceWithoutPair = source.filter((other) => other !== seed && other !== id);
        const remainingFit = groupRelationSummary(id, sourceWithoutPair);
        const dependsOnSeed =
          remainingFit.links === 0 || relation.value === 3 || relation.value >= remainingFit.quality;
        if (!dependsOnSeed) return null;

        const value =
          relation.value * 180 +
          (remainingFit.links ? -remainingFit.quality * 75 : 210) +
          (relation.value === 3 ? 160 : 0) +
          fieldPower(id) * 0.08;
        return { id, relation, value };
      })
      .filter(Boolean)
      .sort((a, b) => b.value - a.value || fieldPower(b.id) - fieldPower(a.id));
  }

  function sourceMovePackages(seed, source) {
    const followers = movablePackageFollowers(seed, source).slice(0, 2).map((row) => row.id);
    const rows = [];

    for (let count = 1; count <= followers.length; count += 1) {
      const ids = [seed, ...followers.slice(0, count)];
      const metrics = groupMetrics(ids);
      if (!metrics.edges.length) continue;

      const starCount = metrics.edges.filter((edge) => edge.value === 3).length;
      const score =
        metrics.quality * 170 +
        metrics.edges.length * 90 +
        starCount * 230 +
        ids.reduce((sum, id) => sum + fieldPower(id), 0) * 0.12;
      rows.push({ ids, score, quality: metrics.quality, starCount });
    }

    return rows;
  }

  function findBestPackageRebalance(groups, scope, maxSize) {
    const baseScore = totalScore(groups);
    const baseBalancePenalty = groupSizeBalancePenalty(groups);
    let best = null;

    for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
      const source = groups[sourceIndex];
      if (source.length <= 4) continue;

      for (const seed of source.slice(1)) {
        for (const line of sourceMovePackages(seed, source)) {
          const moving = new Set(line.ids);
          const nextSource = source.filter((id) => !moving.has(id));
          if (nextSource.length < 2 || !groupMetrics(nextSource).edges.length) continue;

          for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
            if (sourceIndex === targetIndex) continue;

            const target = groups[targetIndex];
            if (target.length + line.ids.length > maxSize) continue;
            if (source.length - target.length < line.ids.length + 1) continue;

            const targetFit = packageGroupFit(line, target, scope);
            if (!targetFit || targetFit.score < 680) continue;

            const nextGroups = groups.map((group, index) => {
              if (index === sourceIndex) return nextSource;
              if (index === targetIndex) return [...group, ...line.ids];
              return [...group];
            });

            const scoreDelta = totalScore(nextGroups) - baseScore;
            if (scoreDelta < -80) continue;

            const balanceDelta = baseBalancePenalty - groupSizeBalancePenalty(nextGroups);
            if (balanceDelta <= 0) continue;

            const adjustedDelta = scoreDelta + balanceDelta + targetFit.score * 0.03;
            if (adjustedDelta < 220) continue;

            const row = { sourceIndex, targetIndex, ids: line.ids, adjustedDelta, scoreDelta, balanceDelta };
            if (
              !best ||
              row.adjustedDelta > best.adjustedDelta ||
              (row.adjustedDelta === best.adjustedDelta && row.scoreDelta > best.scoreDelta)
            ) {
              best = row;
            }
          }
        }
      }
    }

    return best;
  }

  function balanceCoreRosterGroups(initialGroups, scope, maxSize) {
    const groups = initialGroups.map((group) => [...group]);

    for (let pass = 0; pass < 8; pass += 1) {
      let best = null;
      for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
        const source = groups[sourceIndex];
        if (source.length <= 2) continue;

        for (const id of source.slice(1)) {
          const sourceWithoutId = source.filter((other) => other !== id);
          const current = rosterFitScore(id, sourceWithoutId, scope);
          if (!current) continue;

          for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
            if (sourceIndex === targetIndex) continue;
            const target = groups[targetIndex];
            if (target.length >= maxSize) continue;

            const targetFit = rosterFitScore(id, target, scope);
            if (!canUseRosterFit(targetFit, "upper")) continue;
            const sizeRelief = Math.max(0, source.length - target.length) * 28;
            const delta = targetFit.score - current.score + sizeRelief;
            if (delta < 180) continue;

            const row = { id, sourceIndex, targetIndex, delta };
            if (!best || row.delta > best.delta) best = row;
          }
        }
      }

      if (!best) break;
      groups[best.sourceIndex] = groups[best.sourceIndex].filter((id) => id !== best.id);
      groups[best.targetIndex].push(best.id);
    }

    for (let pass = 0; pass < 4; pass += 1) {
      const best = findBestPackageRebalance(groups, scope, maxSize);
      if (!best) break;
      const moving = new Set(best.ids);
      groups[best.sourceIndex] = groups[best.sourceIndex].filter((id) => !moving.has(id));
      groups[best.targetIndex].push(...best.ids);
    }

    return groups;
  }

  function isKeyUpperRevalidationTarget(id, scope) {
    const info = tierInfo(id, scope);
    return !info.support && (info.tier === "key" || info.tier === "upper" || info.tier === "core");
  }

  function revalidationMoveLines(seed, source, scope) {
    if (!isKeyUpperRevalidationTarget(seed, scope)) return [];

    return sourceMovePackages(seed, source)
      .filter((line) => line.ids.length >= 2 && !line.starCount)
      .filter((line) => line.ids.every((id) => id !== source[0]))
      .sort((a, b) => b.ids.length - a.ids.length || b.score - a.score);
  }

  function findBestKeyUpperRevalidation(groups, scope, maxSize) {
    const baseScore = totalScore(groups);
    const baseBalancePenalty = groupSizeBalancePenalty(groups);
    let best = null;

    for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
      const source = groups[sourceIndex];
      if (source.length <= 3) continue;

      for (const seed of source.slice(1)) {
        for (const line of revalidationMoveLines(seed, source, scope)) {
          const moving = new Set(line.ids);
          const nextSource = source.filter((id) => !moving.has(id));
          if (nextSource.length < 2 || !groupMetrics(nextSource).edges.length) continue;

          for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
            if (sourceIndex === targetIndex) continue;

            const target = groups[targetIndex];
            if (target.length + line.ids.length > maxSize) continue;
            if (source.length < target.length + line.ids.length) continue;

            const targetFit = packageGroupFit(line, target, scope);
            if (!targetFit || targetFit.score < 620) continue;

            const currentFit = packageGroupFit(line, nextSource, scope);
            const nextGroups = groups.map((group, index) => {
              if (index === sourceIndex) return nextSource;
              if (index === targetIndex) return [...group, ...line.ids];
              return [...group];
            });
            const scoreDelta = totalScore(nextGroups) - baseScore;
            if (scoreDelta < -110) continue;

            const balanceDelta = baseBalancePenalty - groupSizeBalancePenalty(nextGroups);
            const sizeRelief = Math.max(0, source.length - target.length) * 34;
            const lineBonus = line.ids.length >= 2 ? 90 : 0;
            const targetCompactBonus = targetFit.quality * 34 + targetFit.links * 20 + targetFit.star * 80;
            const lostQualityPenalty = Math.max(0, (currentFit?.quality || 0) - targetFit.quality) * 42;
            const adjustedDelta =
              scoreDelta + balanceDelta * 0.7 + sizeRelief + lineBonus + targetCompactBonus - lostQualityPenalty;
            if (adjustedDelta < 260) continue;

            const row = {
              sourceIndex,
              targetIndex,
              ids: line.ids,
              adjustedDelta,
              scoreDelta,
              balanceDelta,
            };
            if (
              !best ||
              row.adjustedDelta > best.adjustedDelta ||
              (row.adjustedDelta === best.adjustedDelta && row.scoreDelta > best.scoreDelta)
            ) {
              best = row;
            }
          }
        }
      }
    }

    return best;
  }

  function revalidateKeyUpperAssignments(initialGroups, scope, maxSize) {
    const groups = initialGroups.map((group) => [...group]);

    for (let pass = 0; pass < 5; pass += 1) {
      const best = findBestKeyUpperRevalidation(groups, scope, maxSize);
      if (!best) break;
      const moving = new Set(best.ids);
      groups[best.sourceIndex] = groups[best.sourceIndex].filter((id) => !moving.has(id));
      groups[best.targetIndex].push(...best.ids);
    }

    return groups;
  }

  function cleanupCoreRosterPlan(groups, remaining, scope) {
    const unassigned = new Set(remaining);
    const cleanGroups = [];

    for (const group of groups) {
      const unique = [...new Set(group)];
      if (unique.length < 2 || !groupMetrics(unique).edges.length) {
        unique.forEach((id) => unassigned.add(id));
      } else {
        cleanGroups.push(unique);
      }
    }

    return { groups: rankGroups(cleanGroups), unassigned: sortUnassigned([...unassigned]) };
  }

  function planRosterCoreFirst(ids, planOptions) {
    const maxSize = planOptions.maxSize;
    const targetCount =
      planOptions.mode === "count"
        ? clampInteger(planOptions.targetCount, 1, Math.max(1, ids.length), rosterLimitValues.groupCount)
        : Math.max(1, Math.min(ids.length, minGroupCount(ids.length, maxSize)));
    const cores = selectRosterCores(ids, targetCount, planOptions.fixedCoreIds || []);
    const groups = cores.map((id) => [id]);
    const remaining = new Set(ids.filter((id) => !cores.includes(id)));

    seedProtectedCoreLines(groups, remaining, ids, maxSize);
    for (const phase of ["key", "upper", "support"]) {
      assignRosterPhase(groups, remaining, ids, maxSize, phase);
    }

    assignSmallLinePackages(groups, remaining, ids, maxSize);
    assignRosterPhase(groups, remaining, ids, maxSize, "reserve");
    assignSmallLinePackages(groups, remaining, ids, maxSize);
    const balanced = balanceCoreRosterGroups(groups, ids, maxSize);
    const revalidated = revalidateKeyUpperAssignments(balanced, ids, maxSize);
    return cleanupCoreRosterPlan(revalidated, remaining, ids);
  }

  function normalizePlanOptions(options) {
    return typeof options === "number" ? { mode: "size", maxSize: options } : options;
  }

  function planRoster(ids, options) {
    const planOptions = normalizePlanOptions(options);
    return planRosterCoreFirst(ids, planOptions);
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

  function totalScore(groups) {
    return groups.reduce((sum, group) => sum + groupMetrics(group).score, 0);
  }

  function formationStats(groups, unassigned = []) {
    return {
      groupCount: groups.length,
      smallCount: groups.filter((group) => group.length <= 3).length,
      singleCount: groups.filter((group) => group.length === 1).length,
      unassignedCount: unassigned.length,
    };
  }

  function isStrongUnassignedCandidate(id, scope) {
    const info = tierInfo(id, scope);
    return info.key || info.power >= 250 || info.highStat >= 85 || traitScore(id) >= 12;
  }

  function lineIdsForDisplay(ids) {
    const metrics = groupMetrics(ids);
    return [...ids].sort(
      (a, b) => (metrics.buff.get(b) || 0) - (metrics.buff.get(a) || 0) || fieldPower(b) - fieldPower(a),
    );
  }

  function sectionMemberIds(section) {
    if (section.ids) return section.ids;
    const ids = [];
    for (const line of section.lines || []) {
      for (const id of line.ids) {
        if (!ids.includes(id)) ids.push(id);
      }
    }
    return ids;
  }

  function classifyUnassigned(ids, groups = [], scope = null) {
    if (!ids.length) return [];

    const scopeIds = scope || [...new Set(groups.flat().concat(ids))];
    const coreIds = groups.map((group) => group[0]).filter(Boolean);
    const remaining = new Set(ids);
    const sections = [];

    const lineRows = [];
    for (const line of smallLinePackages(remaining, scopeIds, coreIds)) {
      const lineIds = lineIdsForDisplay(line.ids.filter((id) => remaining.has(id)));
      if (lineIds.length < 2 || lineIds.some((id) => !remaining.has(id))) continue;
      lineRows.push({ ...line, ids: lineIds });
      for (const id of lineIds) remaining.delete(id);
    }
    if (lineRows.length) {
      sections.push({ key: "line", title: "후보 라인", lines: lineRows });
    }

    const strong = sortUnassigned([...remaining].filter((id) => isStrongUnassignedCandidate(id, scopeIds)));
    for (const id of strong) remaining.delete(id);
    if (strong.length) {
      sections.push({ key: "strong", title: "강력 단독", ids: strong });
    }

    const support = sortUnassigned([...remaining].filter(hasSupportTrait));
    for (const id of support) remaining.delete(id);
    if (support.length) {
      sections.push({ key: "support", title: "보조 후보", ids: support });
    }

    const general = sortUnassigned([...remaining]);
    if (general.length) {
      sections.push({ key: "general", title: "일반 미편성", ids: general });
    }

    return sections;
  }

  function classifiedUnassignedSources(ids, groups, unassigned) {
    const sections = classifyUnassigned(unassigned, groups, ids);
    const byKey = new Map(sections.map((section) => [section.key, section]));
    const lineSources = (byKey.get("line")?.lines || []).map((line, index) => ({
      index: -1,
      group: line.ids,
      size: line.ids.length,
      lineScore: line.score,
      sourceClass: "후보 라인",
      sourceRank: 0,
      lineIndex: index,
    }));

    return {
      sections,
      lineSources,
      strongIds: byKey.get("strong")?.ids || [],
      supportIds: byKey.get("support")?.ids || [],
      generalIds: byKey.get("general")?.ids || [],
    };
  }

  function roleGeneralThreshold(key) {
    if (key === "field") return 175;
    if (key === "advisor") return 165;
    return 150;
  }

  function roleSourceCandidates(classified, need) {
    const rows = [];
    const seen = new Set();

    function add(ids, sourceRank, sourceClass, threshold = 0) {
      for (const id of ids) {
        if (seen.has(id) || !need.matches(id) || roleNeedScore(id, need.key) < threshold) continue;
        seen.add(id);
        rows.push({ id, sourceRank, sourceClass });
      }
    }

    add(classified.strongIds, 0, "강력 단독");
    add(classified.supportIds, 1, "보조 후보");
    add(classified.generalIds, 3, "일반 미편성", roleGeneralThreshold(need.key));

    return rows.sort(
      (a, b) =>
        a.sourceRank - b.sourceRank ||
        roleNeedScore(b.id, need.key) - roleNeedScore(a.id, need.key) ||
        fieldPower(b.id) - fieldPower(a.id),
    );
  }

  function recommendOathSets(ids, planOptions, basePlan, limit = RECOMMENDATION_LIMIT) {
    const candidates = dedupeAdjustmentCandidates(generateAdjustmentCandidates(ids, basePlan.groups, basePlan.unassigned || []));
    const rows = [];
    const seen = new Set();

    for (const spec of candidates.slice(0, 42)) {
      const signature = recommendationSignature(spec.kind, spec.ids, spec.targetIndex);
      if (seen.has(signature)) continue;
      seen.add(signature);
      const row = hydrateRecommendation(spec, ids, planOptions, basePlan);
      if (
        row.stats.unassignedCount <= row.baseStats.unassignedCount &&
        recommendationKeepsSourceWithAnchor(row) &&
        !isRecommendationTooUnstable(row)
      ) {
        rows.push(row);
      }
    }

    return rows.sort(compareRecommendationRows).slice(0, limit);
  }

  function generateAdjustmentCandidates(ids, groups, unassigned = []) {
    const groupIndex = groupIndexMap(groups);
    for (const id of unassigned) groupIndex.set(id, -1);
    const infos = groups.map((group, index) => ({ index, group, size: group.length }));
    const rows = [];
    const targetInfos = infos.filter((info) => info.size >= 2);
    const classified = classifiedUnassignedSources(ids, groups, unassigned);
    const smallLines = infos
      .filter((info) => info.size >= 2 && info.size <= 3)
      .map((info) => ({ ...info, sourceClass: "소규모 라인", sourceRank: 0 }));
    const lineSources = [...classified.lineSources, ...smallLines];

    for (const source of lineSources) {
      for (const target of targetInfos.filter((info) => info.index !== source.index)) {
        addBridgeCandidates(rows, {
          kind: "oath",
          priority: 1,
          priorityLabel: "소규모 라인 병합",
          source,
          target,
          sourceRank: source.sourceRank,
          sourceClass: source.sourceClass,
          reason:
            source.index < 0
              ? "후보 집단 병합"
              : "소집단 병합",
        });
      }
    }

    for (const singleId of classified.strongIds.slice(0, 12)) {
      for (const target of targetInfos) {
        for (const anchor of groupAnchors(target.group, 4)) {
          pushAdjustmentCandidate(rows, {
            kind: "oath",
            priority: 2,
            priorityLabel: "강력 단독 투입",
            ids: [singleId, anchor],
            anchorId: anchor,
            sourceIds: [singleId],
            targetIndex: target.index,
            sourceRank: 0,
            sourceClass: "강력 단독",
            reason: "미편성 구제",
          });
        }
      }
    }

    for (const target of smallLines) {
      for (const pair of combinations(classified.strongIds, 2).slice(0, 36)) {
        for (const anchor of groupAnchors(target.group, 3)) {
          pushAdjustmentCandidate(rows, {
            kind: "oath",
            priority: 2,
            priorityLabel: "강력 단독 투입",
            ids: [anchor, ...pair],
            anchorId: anchor,
            sourceIds: pair,
            targetIndex: target.index,
            sourceRank: 1,
            sourceClass: "강력 단독",
            reason: "신집단 독립",
          });
        }
      }
    }

    for (const target of infos) {
      for (const need of missingRoleNeeds(target.group)) {
        const sources = roleSourceCandidates(classified, need).filter((row) => groupIndex.get(row.id) !== target.index).slice(0, 8);
        for (const source of sources) {
          for (const anchor of groupAnchors(target.group, 3)) {
            pushAdjustmentCandidate(rows, {
              kind: "oath",
              priority: 3,
              priorityLabel: "역할 부족 보정",
              ids: [source.id, anchor],
              anchorId: anchor,
              sourceIds: [source.id],
              targetIndex: target.index,
              needKey: need.key,
              sourceRank: source.sourceRank,
              sourceClass: source.sourceClass,
              reason: `${need.label} 보강`,
            });
          }
        }
      }
    }

    for (const spec of rows.filter((row) => row.kind === "oath")) addMarriageCandidatesFromSpec(rows, spec, groups, groupIndex);
    addSupportMarriageCandidates(rows, ids, groups, groupIndex, classified.supportIds);
    return rows.sort(compareAdjustmentSpecs);
  }

  function groupIndexMap(groups) {
    const map = new Map();
    groups.forEach((group, index) => {
      for (const id of group) map.set(id, index);
    });
    return map;
  }

  function groupAnchors(group, limit = 4) {
    return [...group]
      .sort(
        (a, b) =>
          affinityReach(b).score - affinityReach(a).score ||
          affinityReach(b, group).score - affinityReach(a, group).score ||
          fieldPower(b) - fieldPower(a),
      )
      .slice(0, limit);
  }

  function addBridgeCandidates(rows, { kind, priority, priorityLabel, source, target, reason, sourceRank = 0, sourceClass = "" }) {
    const sourceAnchors = [...source.group]
      .sort((a, b) => fieldPower(b) - fieldPower(a) || affinityReach(b).score - affinityReach(a).score)
      .slice(0, 2);

    for (const sourceAnchor of sourceAnchors) {
      for (const targetAnchor of groupAnchors(target.group, 4)) {
        const base = [sourceAnchor, targetAnchor];
        const extra = bestThirdMember([...source.group, ...target.group], base, target.group);
        pushAdjustmentCandidate(rows, {
          kind,
          priority,
          priorityLabel,
          ids: extra ? [...base, extra] : base,
          anchorId: targetAnchor,
          sourceIds: source.group,
          targetIndex: target.index,
          sourceRank,
          sourceClass,
          reason,
        });
      }
    }
  }

  function bestThirdMember(pool, baseIds, targetGroup) {
    return [...new Set(pool)]
      .filter((id) => !baseIds.includes(id))
      .sort(
        (a, b) =>
          roleComplementScore(b, targetGroup) - roleComplementScore(a, targetGroup) ||
          fieldPower(b) - fieldPower(a) ||
          affinityReach(b).score - affinityReach(a).score,
      )
      .find((id) => !hasExistingAffinityPair([...baseIds, id]));
  }

  function roleComplementScore(id, group) {
    const needs = missingRoleNeeds(group);
    if (!needs.length) return fieldPower(id) * 0.1;
    return needs.reduce((sum, need) => sum + (need.matches(id) ? roleNeedScore(id, need.key) : 0), 0);
  }

  function missingRoleNeeds(group) {
    const tags = new Set(group.flatMap(roleTags));
    const needs = [];
    if (!(tags.has("전투") || tags.has("지휘"))) {
      needs.push({
        key: "field",
        label: "전투/지휘",
        matches: (id) => roleTags(id).some((tag) => tag === "전투" || tag === "지휘"),
      });
    }
    if (!tags.has("참모")) {
      needs.push({
        key: "advisor",
        label: "참모",
        matches: (id) => roleTags(id).includes("참모"),
      });
    }
    if (group.length >= 6 && !tags.has("실무")) {
      needs.push({
        key: "admin",
        label: "실무",
        matches: (id) => roleTags(id).includes("실무"),
      });
    }
    return needs;
  }

  function roleNeedScore(id, key) {
    const stats = officer(id)?.stats || {};
    if (key === "advisor") return (stats.intelligence || 0) * 1.4 + (stats.politics || 0) * 0.7 + fieldPower(id) * 0.1;
    if (key === "admin") return (stats.politics || 0) * 1.3 + (stats.intelligence || 0) * 0.4 + fieldPower(id) * 0.1;
    return (stats.leadership || 0) * 1.2 + Math.max(stats.war || 0, stats.intelligence || 0) + fieldPower(id) * 0.1;
  }

  function addMarriageCandidatesFromSpec(rows, spec, groups, groupIndex) {
    if (spec.priority > 3) return;
    for (let i = 0; i < spec.ids.length; i += 1) {
      for (let j = i + 1; j < spec.ids.length; j += 1) {
        const a = spec.ids[i];
        const b = spec.ids[j];
        if (!isMarriagePair(a, b)) continue;
        if (groupIndex.get(a) === groupIndex.get(b)) continue;
        const female = isFemale(a) ? a : b;
        const other = female === a ? b : a;
        const femaleGroupIndex = groupIndex.get(female);
        const otherGroupIndex = groupIndex.get(other);
        const targetIndex = groups[femaleGroupIndex]?.length >= 2 ? femaleGroupIndex : otherGroupIndex;
        if (targetIndex < 0 || !groups[targetIndex]) continue;
        pushAdjustmentCandidate(rows, {
          kind: "marriage",
          priority: spec.priority,
          priorityLabel: spec.needKey === "support" ? "범위 버프 보강" : spec.priorityLabel,
          ids: [other, female],
          anchorId: targetIndex === femaleGroupIndex ? female : other,
          sourceIds: [targetIndex === femaleGroupIndex ? other : female],
          targetIndex,
          needKey: spec.needKey,
          sourceRank: spec.sourceRank,
          sourceClass: spec.sourceClass,
          reason: "미혼 상태 가정",
        });
      }
    }
  }

  function addSupportMarriageCandidates(rows, ids, groups, groupIndex, preferredSupportIds = []) {
    const preferredSet = new Set(preferredSupportIds);
    const supportFemales = [
      ...preferredSupportIds.filter((id) => isFemale(id) && hasSupportTrait(id)),
      ...ids.filter((id) => !preferredSet.has(id) && isFemale(id) && hasSupportTrait(id)),
    ];
    if (!supportFemales.length) return;

    for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
      const target = groups[targetIndex];
      if (target.some(hasSupportTrait)) continue;
      const anchors = groupAnchors(target, 5).filter((id) => !isFemale(id));
      if (!anchors.length) continue;

      for (const female of supportFemales) {
        const donorIndex = groupIndex.get(female);
        if (donorIndex === targetIndex || !canBorrowSupportFemale(female, groups[donorIndex])) continue;
        const preferred = preferredSet.has(female);
        for (const anchor of anchors) {
          pushAdjustmentCandidate(rows, {
            kind: "marriage",
            priority: 4,
            priorityLabel: "범위 버프 보강",
            ids: [anchor, female],
            anchorId: anchor,
            sourceIds: [female],
            targetIndex,
            needKey: "support",
            sourceRank: preferred ? 0 : 2,
            sourceClass: preferred ? "보조 후보" : "응원/악주 여무장",
            reason: `${displayName(target[0])} 집단에 응원/악주 버프 보강`,
          });
        }
      }
    }
  }

  function canBorrowSupportFemale(female, sourceGroup = []) {
    if (sourceGroup.length <= 3) return true;
    return sourceGroup.filter(hasSupportTrait).length > 1 && sourceGroup.includes(female);
  }

  function isMarriagePair(a, b) {
    return isFemale(a) !== isFemale(b);
  }

  function pushAdjustmentCandidate(rows, spec) {
    const ids = [...new Set(spec.ids)];
    if (ids.length !== spec.ids.length || ids.length < 2 || ids.length > 3) return;
    if (spec.kind === "marriage" && (ids.length !== 2 || !isMarriagePair(ids[0], ids[1]))) return;

    const pairStats = candidatePairStats(ids);
    if (pairStats.existingPairs || !pairStats.newPairs) return;

    const anchorId = spec.anchorId || ids[0];
    const sourceIds = [...new Set(spec.sourceIds || ids.filter((id) => id !== anchorId))];
    const anchorReach = affinityReach(anchorId);
    const sourcePower = sourceIds.reduce((sum, id) => sum + fieldPower(id), 0);
    const badges = relationBadges(pairStats);
    if (spec.kind === "marriage") badges.unshift("미혼 가정");
    if (spec.needKey === "support" && !badges.includes("응원/악주")) badges.push("응원/악주");

    rows.push({
      ...spec,
      ids,
      anchorId,
      sourceIds,
      sourceRank: spec.sourceRank ?? 9,
      sourceClass: spec.sourceClass || "",
      pairStats,
      anchorReach,
      score:
        sourcePower +
        anchorReach.score * 0.55 +
        pairStats.newPairs * 140 +
        pairStats.upgradedPairs * 70 +
        (ids.length === 3 ? 35 : 0) -
        pairStats.existingPairs * 12,
      badges,
    });
  }

  function candidatePairStats(ids) {
    const stats = { newPairs: 0, upgradedPairs: 0, existingPairs: 0, hasStarPair: false };
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const relation = relationBetween(ids[i], ids[j]);
        if (relation) {
          stats.existingPairs += 1;
          if (relation.value === 3) stats.hasStarPair = true;
          else stats.upgradedPairs += 1;
        } else {
          stats.newPairs += 1;
        }
      }
    }
    return stats;
  }

  function hasExistingAffinityPair(ids) {
    return candidatePairStats(ids).existingPairs > 0;
  }

  function relationBadges(pairStats) {
    const badges = [];
    if (pairStats.newPairs) badges.push(`신규 연결 ${pairStats.newPairs}`);
    if (pairStats.upgradedPairs) badges.push(`친애 강화 ${pairStats.upgradedPairs}`);
    return badges;
  }

  function dedupeAdjustmentCandidates(candidates) {
    const bestByPurpose = new Map();
    for (const candidate of candidates) {
      const key = adjustmentPurposeKey(candidate);
      const previous = bestByPurpose.get(key);
      if (!previous || compareAdjustmentSpecs(candidate, previous) < 0) bestByPurpose.set(key, candidate);
    }
    return [...bestByPurpose.values()].sort(compareAdjustmentSpecs);
  }

  function adjustmentPurposeKey(candidate) {
    return [
      candidate.kind,
      candidate.priority,
      candidate.targetIndex,
      candidate.needKey || "",
      [...candidate.sourceIds].sort((a, b) => a - b).join("+"),
    ].join("|");
  }

  function compareAdjustmentSpecs(a, b) {
    return (
      a.priority - b.priority ||
      (a.sourceRank ?? 9) - (b.sourceRank ?? 9) ||
      b.anchorReach.score - a.anchorReach.score ||
      b.score - a.score ||
      b.pairStats.newPairs - a.pairStats.newPairs ||
      displayName(a.anchorId).localeCompare(displayName(b.anchorId), "ko")
    );
  }

  function formationMemberIndex(groups, unassigned = []) {
    const map = new Map();
    groups.forEach((group, index) => {
      for (const id of group) map.set(id, index);
    });
    for (const id of unassigned) {
      if (!map.has(id)) map.set(id, -1);
    }
    return map;
  }

  function inSameAssignedGroup(map, a, b) {
    const groupA = map.get(a);
    const groupB = map.get(b);
    return groupA !== undefined && groupA >= 0 && groupA === groupB;
  }

  function recommendationKeepsSourceWithAnchor(row) {
    const groupMap = formationMemberIndex(row.plan.groups || [], row.plan.unassigned || []);
    const anchorGroup = groupMap.get(row.anchorId);
    if (anchorGroup === undefined || anchorGroup < 0) return false;

    const sourceIds = [...new Set(row.sourceIds || [])].filter((id) => id !== row.anchorId);
    return sourceIds.length ? sourceIds.every((id) => groupMap.get(id) === anchorGroup) : true;
  }

  function recommendationStability(basePlan, nextPlan) {
    const baseGroups = basePlan.groups || [];
    const nextIndex = formationMemberIndex(nextPlan.groups || [], nextPlan.unassigned || []);
    const stats = {
      starBreaks: 0,
      doubleBreaks: 0,
      singleBreaks: 0,
      coreBreaks: 0,
      penalty: 0,
      badges: [],
    };

    for (const group of baseGroups) {
      if (group.length < 2) continue;
      const core = group[0];
      for (const id of group.slice(1)) {
        const relation = relationBetween(core, id);
        if (!relation || relation.value < 2) continue;
        if (!inSameAssignedGroup(nextIndex, core, id)) stats.coreBreaks += 1;
      }

      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const relation = relationBetween(group[i], group[j]);
          if (!relation || inSameAssignedGroup(nextIndex, group[i], group[j])) continue;
          if (relation.value === 3) stats.starBreaks += 1;
          else if (relation.value === 2) stats.doubleBreaks += 1;
          else stats.singleBreaks += 1;
        }
      }
    }

    stats.penalty =
      stats.starBreaks * 720 + stats.doubleBreaks * 180 + stats.singleBreaks * 35 + stats.coreBreaks * 90;

    if (stats.starBreaks) stats.badges.push("분파 안정성 제외");
    else if (stats.coreBreaks >= 3 || stats.doubleBreaks >= 2) stats.badges.push("분파 안정성 낮음");
    else if (stats.penalty) stats.badges.push("분파 변동 감점");

    return stats;
  }

  function isRecommendationTooUnstable(row) {
    return row.stability.starBreaks > 0 || row.stability.coreBreaks >= 4 || row.impact < 0;
  }

  function hydrateRecommendation(spec, ids, planOptions, basePlan) {
    const plan = withVirtualOaths([spec.ids], () => planRoster(ids, planOptions));
    const baseStats = formationStats(basePlan.groups, basePlan.unassigned || []);
    const stats = formationStats(plan.groups, plan.unassigned || []);
    const stability = recommendationStability(basePlan, plan);
    const shapeGain =
      (baseStats.singleCount - stats.singleCount) * 90 +
      (baseStats.smallCount - stats.smallCount) * 60 +
      (baseStats.groupCount - stats.groupCount) * 35 +
      (baseStats.unassignedCount - stats.unassignedCount) * 120;
    return {
      ...spec,
      plan,
      baseStats,
      stats,
      stability,
      badges: [...spec.badges, ...stability.badges],
      impact: spec.score + shapeGain - stability.penalty,
    };
  }

  function compareRecommendationRows(a, b) {
    const unassignedGainA = a.baseStats.unassignedCount - a.stats.unassignedCount;
    const unassignedGainB = b.baseStats.unassignedCount - b.stats.unassignedCount;
    const kindRankA = a.kind === "marriage" ? 1 : 0;
    const kindRankB = b.kind === "marriage" ? 1 : 0;
    return (
      a.priority - b.priority ||
      (a.sourceRank ?? 9) - (b.sourceRank ?? 9) ||
      unassignedGainB - unassignedGainA ||
      kindRankA - kindRankB ||
      a.stability.penalty - b.stability.penalty ||
      b.impact - a.impact ||
      b.anchorReach.score - a.anchorReach.score ||
      b.score - a.score
    );
  }

  function isSupportRecommendation(row) {
    return row.priorityLabel === "범위 버프 보강" || row.needKey === "support";
  }

  function passesRecommendationFilters(row) {
    if (row.kind === "oath" && !recommendationFilterValues.oath) return false;
    if (row.kind === "marriage" && !recommendationFilterValues.marriage) return false;
    if (isSupportRecommendation(row)) return recommendationFilterValues.support;
    return recommendationFilterValues.rescue;
  }

  function recommendationSignature(kind, ids, targetIndex) {
    return `${kind}|${targetIndex}|${[...ids].sort((a, b) => a - b).join("+")}`;
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
    els.recommendationFilters.classList.toggle("hidden", !(mode === "roster" && tab === "oath"));
  }

  function setResultTabsVisible(visible) {
    els.resultTabs.classList.toggle("hidden", !visible);
    els.recommendationFilters.classList.toggle("hidden", !(visible && mode === "roster" && activeResultTab === "oath"));
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

  function relationNote(text) {
    const row = document.createElement("div");
    row.className = "relation-line relation-card relation-more";
    row.textContent = text;
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
    const arrow = relation.arrow === "<->" ? "↔" : relation.arrow === "<-" ? "←" : "→";
    const node = document.createElement("div");
    node.className = `relation-line relation-card affinity-card ${REL_CLASS[relation.label]}`;
    node.innerHTML = `<span class="relation-name">${displayName(center)}</span><span class="relation-symbol">${relation.label}</span><span class="affinity-arrow">${arrow}</span><span class="relation-name relation-target">${displayName(row.id)}</span>`;
    node.title = `${displayName(center)} ${relation.label}${arrow} ${displayName(row.id)}`;
    return node;
  }

  function scoreToneClass(score) {
    if (score >= 2500) return "tone-score-top";
    if (score >= 2000) return "tone-score-high";
    if (score >= 1500) return "tone-score-mid";
    return "tone-score-low";
  }

  function unassignedToneClass(key) {
    if (key === "strong") return "tone-strong";
    if (key === "support") return "tone-support";
    if (key === "line") return "tone-line";
    return "tone-unassigned";
  }

  function renderGroup(title, group, options = {}) {
    const metrics = groupMetrics(group);
    const card = els.template.content.firstElementChild.cloneNode(true);
    const parent = options.parent || els.results;
    card.classList.add(options.toneClass || scoreToneClass(metrics.score));
    card.querySelector("h3").textContent = title;
    card.querySelector(".group-score").textContent = `${group.length}명 | ${metrics.score}`;

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
    card.className = `formation-preview-card ${scoreToneClass(metrics.score)}`;

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
    score.textContent = `${group.length}명 | ${metrics.score}`;
    top.append(title, score);
    card.appendChild(top);

    const memberList = document.createElement("div");
    memberList.className = "member-list";
    for (const id of group) memberList.appendChild(memberChip(id, metrics.buff));
    card.appendChild(memberList);
    parent.appendChild(card);
  }

  function unassignedSectionLabel(section) {
    if (section.key === "line") return "후보";
    if (section.key === "strong") return "단독";
    if (section.key === "support") return "보조";
    return "미편성";
  }

  function unassignedSectionDescription(section) {
    if (section.key === "line") return "미편성 장수끼리 2~3인 친애 라인을 만들 수 있는 후보";
    if (section.key === "strong") return "능력치/개성 기준으로 편성 가치가 높은 단독 후보";
    if (section.key === "support") return "보좌/응원/악주 계열 보조 개성 후보";
    return "연결과 역할 보정 점수가 낮아 추천 후순위로 남은 장수";
  }

  function renderUnassignedSection(section, parent) {
    const ids = sectionMemberIds(section);
    const card = els.template.content.firstElementChild.cloneNode(true);
    card.classList.add(unassignedToneClass(section.key));
    card.querySelector("h3").textContent = unassignedSectionLabel(section);
    card.querySelector(".group-score").textContent =
      section.key === "line" ? `${ids.length}명 / ${section.lines.length}라인` : `${ids.length}명`;

    const subtitle = document.createElement("p");
    subtitle.className = "group-subtitle";
    subtitle.textContent = unassignedSectionDescription(section);
    card.querySelector(".group-top").after(subtitle);

    const memberList = card.querySelector(".member-list");
    const buff = new Map(ids.map((id) => [id, 0]));
    for (const id of ids) memberList.appendChild(memberChip(id, buff));

    const relationList = card.querySelector(".relation-list");
    relationList.classList.add("relation-grid");
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = "분류기준";
    relationList.appendChild(label);
    relationList.appendChild(relationNote("-"));

    parent.appendChild(card);
  }

  function renderUnassigned(ids, parent = els.results, groups = [], scope = null) {
    if (!ids.length) return;
    for (const section of classifyUnassigned(ids, groups, scope)) renderUnassignedSection(section, parent);
  }

  function renderUnassignedPreviewSection(section, parent) {
    const ids = sectionMemberIds(section);
    const card = document.createElement("div");
    card.className = `formation-preview-card ${unassignedToneClass(section.key)}`;

    const top = document.createElement("div");
    top.className = "group-top";
    const title = document.createElement("h3");
    const label = unassignedSectionLabel(section);
    title.textContent = `${label} · ${ids
      .map(displayName)
      .slice(0, 3)
      .join(", ")}`;
    const score = document.createElement("span");
    score.className = "group-score";
    score.textContent = section.key === "line" ? `${ids.length}명 / ${section.lines.length}라인` : `${ids.length}명`;
    top.append(title, score);
    card.appendChild(top);

    const memberList = document.createElement("div");
    memberList.className = "member-list";
    const buff = new Map(ids.map((id) => [id, 0]));
    for (const id of ids) memberList.appendChild(memberChip(id, buff));
    card.appendChild(memberList);
    parent.appendChild(card);
  }

  function renderUnassignedPreviewCard(ids, parent, groups = [], scope = null) {
    if (!ids.length) return;
    for (const section of classifyUnassigned(ids, groups, scope)) renderUnassignedPreviewSection(section, parent);
  }

  function renderOathRecommendations(recommendations, totalAvailable = recommendations.length) {
    if (!recommendations.length) {
      const node = document.createElement("div");
      node.className = "empty-state";
      node.textContent = totalAvailable
        ? "현재 필터 조건에 맞는 의형제/결혼 보정 후보가 없습니다."
        : `${APP_VERSION} 기준으로 추천할 의형제/결혼 보정 후보를 찾지 못했습니다.`;
      els.oathResults.appendChild(node);
      return;
    }

    recommendations.forEach((recommendation, index) => {
      const card = document.createElement("article");
      card.className = "group-card";

      const top = document.createElement("div");
      top.className = "group-top";
      const title = document.createElement("h3");
      title.textContent = `${index + 1}추천 · ${recommendation.kind === "marriage" ? "결혼(미혼 가정)" : "의형제"} 보정`;
      top.append(title);
      card.appendChild(top);

      const summaryFrame = document.createElement("div");
      summaryFrame.className = "recommendation-frame";

      const oathList = document.createElement("div");
      oathList.className = "oath-summary";
      const oathLabel = document.createElement("div");
      oathLabel.className = "section-label";
      oathLabel.textContent = "추천 조합";
      oathList.appendChild(oathLabel);
      appendRec(oathList, recommendation.ids.map(displayName).join(" + "));
      summaryFrame.appendChild(oathList);

      const changeList = document.createElement("div");
      changeList.className = "change-badges";
      const hasGroupChange = appendChangeBadge(
        changeList,
        "집단",
        recommendation.baseStats.groupCount,
        recommendation.stats.groupCount,
      );
      const hasSmallChange = appendChangeBadge(
        changeList,
        "소집단",
        recommendation.baseStats.smallCount,
        recommendation.stats.smallCount,
      );
      const hasSingleChange = appendChangeBadge(
        changeList,
        "1인 집단",
        recommendation.baseStats.singleCount,
        recommendation.stats.singleCount,
      );
      const hasUnassignedChange = appendChangeBadge(
        changeList,
        "미편성",
        recommendation.baseStats.unassignedCount,
        recommendation.stats.unassignedCount,
      );
      if (hasGroupChange || hasSmallChange || hasSingleChange || hasUnassignedChange) {
        const changeSection = document.createElement("div");
        changeSection.className = "recommendations";
        const changeLabel = document.createElement("div");
        changeLabel.className = "section-label";
        changeLabel.textContent = "예상 변화";
        changeSection.append(changeLabel, changeList);
        summaryFrame.appendChild(changeSection);
      }
      card.appendChild(summaryFrame);

      const formationList = document.createElement("div");
      formationList.className = "formation-preview-list recommendation-frame";
      const formationLabel = document.createElement("div");
      formationLabel.className = "section-label";
      formationLabel.textContent = "예상 편성";
      formationList.appendChild(formationLabel);
      recommendation.plan.groups.forEach((group, groupIndex) => {
        renderFormationPreviewCard(group, groupIndex, formationList);
      });
      renderUnassignedPreviewCard(
        recommendation.plan.unassigned || [],
        formationList,
        recommendation.plan.groups,
        [...new Set(recommendation.plan.groups.flat().concat(recommendation.plan.unassigned || []))],
      );
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
      renderEmpty("보유 장수를 입력하세요.");
      return;
    }

    const fixedCoreIds = resolveFixedCoreIds(ids, duplicateState, warnings);
    const planOptions = {
      ...planningOptions(ids.length, warnings, fixedCoreIds.length),
      fixedCoreIds,
    };
    const plan = planRoster(ids, planOptions);
    const groups = plan.groups;
    const unassigned = plan.unassigned || [];
    if (planOptions.mode === "count" && groups.length !== planOptions.targetCount) {
      warnings.push(`목표 ${planOptions.targetCount}집단에 최대한 가깝게 ${groups.length}집단으로 편성했습니다.`);
    }
    const total = totalScore(groups);
    const allOathRecommendations =
      activeResultTab === "oath" ? recommendOathSets(ids, planOptions, plan, RECOMMENDATION_LIMIT * 4) : [];
    const oathRecommendations = allOathRecommendations.filter(passesRecommendationFilters).slice(0, RECOMMENDATION_LIMIT);

    if (activeResultTab === "formation") {
      groups.forEach((group, index) => {
        const topNames = group
          .slice(0, 3)
          .map(displayName)
          .join(", ");
        renderGroup(`${index + 1}집단 · ${topNames}`, group);
      });
      renderUnassigned(unassigned, els.results, groups, ids);
    } else {
      renderOathRecommendations(oathRecommendations, allOathRecommendations.length);
    }

    renderWarnings(warnings);
    setResultTab(activeResultTab);
    if (activeResultTab === "oath") {
      els.resultTitle.textContent = "의형제/결혼 추천";
      els.resultMeta.textContent = `${ids.length}명 · 추천 ${oathRecommendations.length}/${allOathRecommendations.length}건 · ${APP_VERSION} 보정 후보`;
      els.scoreBadge.textContent = `${oathRecommendations.length}건`;
    } else {
      els.resultTitle.textContent = "보유 장수 편성 결과";
      els.resultMeta.textContent = `${ids.length}명 · 목표 ${planOptions.targetCount}집단 · 상한 ${planOptions.maxSize}명 · 코어 고정 ${fixedCoreIds.length}명 · 미편성 ${unassigned.length}명`;
      els.scoreBadge.textContent = `${Math.round(total)}`;
    }
  }

  function renderSingle() {
    clearResults();
    setResultTabsVisible(false);
    const { ids, warnings } = resolveNames([els.centerInput.value.trim()]);
    if (!ids.length) {
      renderEmpty("분석할 장수를 입력하세요.");
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
    els.resultTitle.textContent = "단일 장수 분석 결과";
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
    label.className = "section-label path-section-label";
    label.textContent = "연결 근거";
    relationList.before(label);

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
    setEmptyResultHeader();
  }

  function setEmptyResultHeader() {
    if (mode === "single") {
      els.resultTitle.textContent = "단일 장수 분석 결과";
      els.resultMeta.textContent = "분석할 장수를 입력하고 분석하세요.";
    } else if (activeResultTab === "oath") {
      els.resultTitle.textContent = "의형제/결혼 추천";
      els.resultMeta.textContent = "보유 장수를 입력하고 분석하세요.";
    } else {
      els.resultTitle.textContent = "보유 장수 편성 결과";
      els.resultMeta.textContent = "보유 장수를 입력하고 분석하세요.";
    }
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
    els.coreInput.addEventListener("input", () => {
      updateRosterLimitControls();
    });
    for (const input of [els.groupCount, els.maxSize]) {
      input.addEventListener("change", () => {
        rosterLimitValues.groupCount = Number(els.groupCount.value) || rosterLimitValues.groupCount;
        rosterLimitValues.maxSize = Number(els.maxSize.value) || rosterLimitValues.maxSize;
        if (mode === "roster") renderRoster();
      });
    }
    for (const input of els.recommendationFilterInputs) {
      input.addEventListener("change", () => {
        recommendationFilterValues[input.dataset.recFilter] = input.checked;
        if (mode === "roster" && activeResultTab === "oath") renderRoster();
      });
    }
    for (const button of els.sampleRosterButtons) {
      button.addEventListener("click", () => {
        const sample = REGRESSION_SAMPLES[button.dataset.sampleRoster];
        if (!sample) return;
        els.rosterInput.value = sample.text;
        els.coreInput.value = "";
        rosterLimitValues.groupCount = sample.groupCount;
        rosterLimitValues.maxSize = sample.maxSize;
        els.groupCount.value = sample.groupCount;
        els.maxSize.value = sample.maxSize;
        updateRosterLimitControls();
        updateDuplicateSelectors();
        renderRoster();
        button.closest(".preset-popover")?.removeAttribute("open");
      });
    }
    els.themeToggle?.addEventListener("click", () => {
      const current = document.documentElement?.dataset?.theme === "dark" ? "dark" : "light";
      setTheme(current === "dark" ? "light" : "dark", true);
    });
    for (const button of els.runButtons) {
      button.addEventListener("click", () => {
        if (mode === "roster") renderRoster();
        else renderSingle();
      });
    }
  }

  function init() {
    setupGraph();
    setupDatalist();
    initTheme();
    bindEvents();
    els.rosterInput.value = "";
    els.coreInput.value = "";
    els.centerInput.value = "";
    updateRosterLimitControls();
    updateDuplicateSelectors();
    renderRoster();
  }

  init();
})();
