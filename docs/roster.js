(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  SAN14.createRoster = function createRoster(model) {
    const {
      DATA, officers, officer, primary, displayName, relationBetween,
      MAX_GROUP_SIZE, MAX_GROUP_COUNT, DEFAULT_AUTO_GROUP_COUNT_LIMIT,
    } = model;

    function candidatesFor(name) {
      return Object.hasOwn(DATA.byName, name) ? DATA.byName[name] : [];
    }

    function clampInteger(value, min, max, fallback) {
      if (value === "" || value === null || value === undefined) {
        return Math.max(min, Math.min(max, fallback));
      }
      const number = Number(value);
      const base = Number.isFinite(number) ? Math.round(number) : fallback;
      return Math.max(min, Math.min(max, base));
    }

    function isAutoGroupCountValue(value) {
      const text = String(value ?? "").trim().toLowerCase();
      return text === "auto" || text === "자동";
    }

    function maxPlanningGroupCount(rosterSize = 0, groupCountLimit = MAX_GROUP_COUNT) {
      const size = Number(rosterSize);
      const limit = clampInteger(groupCountLimit, 1, MAX_GROUP_COUNT, DEFAULT_AUTO_GROUP_COUNT_LIMIT);
      return Math.max(1, Math.min(limit, Number.isFinite(size) && size > 0 ? Math.round(size) : limit));
    }

    function explicitDuplicateId(token) {
      const match = token.match(/^(.+)\((\d+)\)$/);
      if (!match) return null;
      const candidates = candidatesFor(match[1]);
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
        const candidates = candidatesFor(token);
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

        const candidates = candidatesFor(token);
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

    function resolveRoster(text, selectedIds = new Map()) {
      const tokens = parseNames(text);
      const duplicateState = buildRosterDuplicateState(tokens);
      const explicitIds = new Set(tokens.map((token) => {
        const byId = token.match(/#(\d+)$/);
        return byId ? Number(byId[1]) : explicitDuplicateId(token);
      }).filter((id) => id != null));
      const selections = new Map();
      const used = new Map();
      for (const row of duplicateState.selectors) {
        const alreadySelected = used.get(row.name) ?? new Set();
        const remaining = row.candidates.filter((id) => !explicitIds.has(id));
        if (remaining.length) row.candidates = remaining;
        const requested = selectedIds.get(row.key);
        const id = row.candidates.includes(requested) && !alreadySelected.has(requested)
          ? requested
          : row.candidates.find((candidate) => !alreadySelected.has(candidate)) ?? row.candidates[0];
        selections.set(row.key, id);
        alreadySelected.add(id);
        used.set(row.name, alreadySelected);
      }
      const resolved = resolveNames(tokens, {
        duplicateSelections: selections,
        autoAllDuplicateNames: duplicateState.autoAllDuplicateNames,
      });
      return {
        ids: resolved.ids,
        selectors: duplicateState.selectors,
        selections,
        warnings: [...duplicateState.warnings, ...resolved.warnings],
        autoAllDuplicateNames: duplicateState.autoAllDuplicateNames,
      };
    }

    function resolvePlanOptions(ids, requestedCount, coreText, roster) {
      const cores = resolveNames(parseNames(coreText), {
        duplicateSelections: roster.selections,
        autoAllDuplicateNames: roster.autoAllDuplicateNames,
      });
      const warnings = cores.warnings.map((message) => `고정 코어 · ${message}`);
      const fixedCoreIds = cores.ids.filter((id) => {
        if (ids.includes(id)) return true;
        warnings.push(`${displayName(id)}은 보유 명단에 없어 코어에서 제외했습니다.`);
        return false;
      });
      const maxGroupCount = maxPlanningGroupCount(ids.length);
      const minCount = Math.max(1, Math.min(fixedCoreIds.length, maxGroupCount));
      if (fixedCoreIds.length > MAX_GROUP_COUNT) {
        warnings.push(`고정 코어는 최대 ${MAX_GROUP_COUNT}명까지 반영합니다.`);
      }
      const shared = { maxSize: MAX_GROUP_SIZE, fixedCoreIds: fixedCoreIds.slice(0, maxGroupCount) };
      if (isAutoGroupCountValue(requestedCount)) {
        const limit = maxPlanningGroupCount(ids.length, Math.max(DEFAULT_AUTO_GROUP_COUNT_LIMIT, minCount));
        return { options: { ...shared, mode: "auto", maxGroupCount: limit }, warnings };
      }
      const targetCount = clampInteger(requestedCount, minCount, maxGroupCount, 4);
      if (Number(requestedCount) !== targetCount) {
        warnings.push(`목표 집단 수를 ${targetCount}개로 조정했습니다.`);
      }
      return { options: { ...shared, mode: "count", maxGroupCount, targetCount }, warnings };
    }

    return Object.freeze({
      parseNames,
      buildRosterDuplicateState,
      resolveNames,
      resolveRoster,
      resolvePlanOptions,
      clampInteger,
      maxPlanningGroupCount,
      statsLine,
    });
  };
})();
