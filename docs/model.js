(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  SAN14.createModel = function createModel(DATA) {
    const REL_VALUE = { "☆": 3, "◎": 2, "○": 1 };
    const MAX_GROUP_SIZE = 15;
    const MAX_GROUP_COUNT = 10;
    const DEFAULT_AUTO_GROUP_COUNT_LIMIT = 5;
    const RECOMMENDATION_LIMIT = 6;
    const SUPPORT_TRAITS = new Set(["보좌", "응원", "악주"]);
    const TIER_ORDER = { reserve: 0, support: 1, upper: 2, key: 3, core: 4 };
    const FRONT_FORMATIONS = new Set(["방원", "어린"]);
    const REAR_FORMATIONS = new Set(["안행"]);
    const SIEGE_FORMATIONS = new Set(["정란", "충차", "투석"]);
    const MORALE_TRAITS = new Set(["응원", "악주"]);
    const DEBUFF_TRAITS = new Set(["경국"]);
    const BATTLE_SUPPORT_TRAITS = new Set(["보좌", "응원", "악주", "경국", "호위"]);
    const officers = new Map(
      Object.entries(DATA.officers).map(([id, record]) => [Number(id), { ...record, id: Number(id) }]),
    );
    const directed = new Map();
    const pairCache = new Map();
    const neighbors = new Map();
    const personalLikes = new Map(Object.entries(DATA.ceAffinity?.outgoing ?? {}).map(([id, targets]) => [Number(id), new Set(targets)]));
    const scenarioLikes = DATA.ceAffinity?.variantAdded ?? {};
    const family = DATA.ceAffinity?.family ?? {};
    const audit = DATA.relationshipEvidence ?? {};
    const disputedPairs = new Set(
      (audit.conflicts ?? []).map(({ source, target }) => pairKey(source, target)),
    );
    for (const row of audit.ambiguous ?? []) {
      if (row.relation === "X") continue;
      for (const target of row.targets) disputedPairs.add(pairKey(row.source, target));
    }
    let activeVirtualPairs = null;

    setupGraph();

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

    function traitDescription(name) {
      return DATA.traitDescriptions?.[name] || "";
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

    function displayName(id) {
      const item = officer(id);
      if (!item) return `#${id}`;
      const candidates = DATA.byName[item.name] || [];
      const index = candidates.indexOf(Number(id));
      return candidates.length > 1 && index >= 0 ? `${item.name}(${index + 1})` : item.name;
    }

    function personalAffinity(a, b) {
      const outgoing = personalLikes.get(a)?.has(b) ?? false;
      const incoming = personalLikes.get(b)?.has(a) ?? false;
      return outgoing || incoming ? { outgoing, incoming } : null;
    }

    function familyBetween(a, b) {
      const [bloodA, fatherA, motherA] = family[a] ?? [];
      const [bloodB, fatherB, motherB] = family[b] ?? [];
      if (fatherA === b || motherA === b || fatherB === a || motherB === a) return "부모·자녀";
      if ((fatherA && fatherA === fatherB) || (motherA && motherA === motherB)) return "형제자매";
      if (bloodA && bloodA === bloodB) return "같은 혈족";
      return "";
    }

    function relationBetween(a, b) {
      if (a === b || !officers.has(a) || !officers.has(b)) return null;
      const cacheKey = `${activeVirtualPairs ? "v" : "b"}|${edgeKey(a, b)}`;
      if (pairCache.has(cacheKey)) return pairCache.get(cacheKey);
      const pair = pairKey(a, b);
      const virtual = activeVirtualPairs?.has(pair) ?? false;
      const personal = personalAffinity(a, b);
      const kinship = familyBetween(a, b);
      const grades = virtual ? ["☆"] : [
        ...new Set([directed.get(edgeKey(a, b)), directed.get(edgeKey(b, a))].filter(Boolean)),
      ].sort((first, second) => REL_VALUE[second] - REL_VALUE[first]);
      const gradeValue = virtual || !disputedPairs.has(pair) ? REL_VALUE[grades[0]] || 0 : 0;
      const isCloseFamily = kinship === "부모·자녀" || kinship === "형제자매";
      if (!personal && !isCloseFamily && !gradeValue) {
        pairCache.set(cacheKey, null);
        return null;
      }

      // A confirmed connection without an old grade can still qualify for placement.
      const relation = { personal, kinship, grades, gradeValue, value: gradeValue || 1, virtual };
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
      for (const [source, targets] of personalLikes) {
        for (const target of targets) addNeighbor(source, target);
      }
      for (const [source, [, father, mother]] of Object.entries(family)) {
        for (const parent of [father, mother]) {
          if (officers.has(parent)) addNeighbor(Number(source), parent);
        }
      }
    }

    function groupMetrics(group) {
      const linksByOfficer = new Map(group.map((id) => [id, 0]));
      const edges = [];
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const a = group[i];
          const b = group[j];
          const relation = relationBetween(a, b);
          if (!relation) continue;
          linksByOfficer.set(a, linksByOfficer.get(a) + 1);
          linksByOfficer.set(b, linksByOfficer.get(b) + 1);
          edges.push({ a, b, ...relation });
        }
      }

      const base = group.reduce((sum, id) => sum + primary(id), 0);
      const linkEnds = edges.length * 2;
      const linkCounts = [...linksByOfficer.values()];
      const quality = edges.reduce((sum, edge) => sum + edge.gradeValue, 0);
      return {
        score: Math.round(base + linkEnds * 15 + quality * 10),
        base,
        linkEnds,
        quality,
        linksByOfficer,
        linkedCount: linkCounts.filter((count) => count > 0).length,
        multiLinkedCount: linkCounts.filter((count) => count > 1).length,
        highGradeCount: edges.filter((edge) => edge.gradeValue >= 2).length,
        edges,
      };
    }

    function hasAnyTrait(id, traitSet) {
      return officerTraits(id).some((name) => traitSet.has(name));
    }

    function hasGuardTrait(id) {
      return officerTraits(id).includes("호위");
    }

    function hasAnyFormation(id, formationSet) {
      return officerFormationNames(id).some((name) => formationSet.has(name));
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
          const metrics = groupMetrics(group).linksByOfficer;
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

    function officerFormationNames(id) {
      return (officer(id)?.formations || []).map((formation) => formation.ko || formation.name).filter(Boolean);
    }

    function directRelations(center) {
      return [...(neighbors.get(center)?.keys() || [])]
        .map((id) => ({ id, relation: relationBetween(center, id) }))
        .filter((row) => row.relation)
        .sort((a, b) => b.relation.gradeValue - a.relation.gradeValue ||
          displayName(a.id).localeCompare(displayName(b.id), "ko"));
    }

    function scenarioAffinityTargets(center) {
      return scenarioLikes[center] ?? [];
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

    return Object.freeze({
      DATA,
      officers,
      REL_VALUE,
      MAX_GROUP_SIZE,
      MAX_GROUP_COUNT,
      DEFAULT_AUTO_GROUP_COUNT_LIMIT,
      RECOMMENDATION_LIMIT,
      TIER_ORDER,
      FRONT_FORMATIONS,
      REAR_FORMATIONS,
      SIEGE_FORMATIONS,
      MORALE_TRAITS,
      DEBUFF_TRAITS,
      BATTLE_SUPPORT_TRAITS,
      officer,
      primary,
      traitScore,
      officerTraits,
      traitDescription,
      hasSupportTrait,
      isFemale,
      fieldPower,
      roleTags,
      affinityReach,
      displayName,
      relationBetween,
      groupMetrics,
      hasAnyTrait,
      hasGuardTrait,
      hasAnyFormation,
      withVirtualOaths,
      groupRelationSummary,
      rankGroups,
      sortUnassigned,
      hasRosterRelation,
      mainStat,
      isIndependentCoreType,
      isCommandCoreType,
      officerFormationNames,
      directRelations,
      familyBetween,
      scenarioAffinityTargets,
      findPaths,
    });
  };
})();
