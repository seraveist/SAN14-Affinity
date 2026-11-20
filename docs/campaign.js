(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};

  const FORMATION_ROLES = {
    "어린": ["전열"], "방원": ["전열"], "안행": ["후열"],
    "학익": ["점령"], "장사": ["산악"], "추행": ["기동"], "봉시": ["돌격"],
    "정란": ["공성"], "충차": ["파성"], "투석": ["공성", "파성"],
  };
  const SUPPORT_TRAITS = new Set(["보좌", "신장", "응원", "악주", "경국", "호위"]);
  const AMBIGUOUS_TARGET = "동명이인 대상 확인 필요";

  SAN14.createCampaign = function createCampaign(model, planner) {
    const audit = model.DATA.relationshipEvidence ?? {};
    const reviewByPair = new Map();
    const dislikeByPair = new Map();
    const inferredPairs = new Set();
    const key = (a, b) => a < b ? a + "|" + b : b + "|" + a;

    function addReason(source, target, reason) {
      const pair = key(source, target);
      if (!reviewByPair.has(pair)) reviewByPair.set(pair, new Set());
      reviewByPair.get(pair).add(reason);
    }

    for (const row of audit.ambiguous ?? []) {
      if (row.relation === "X") continue;
      for (const id of row.targets) addReason(row.source, id, AMBIGUOUS_TARGET);
    }
    for (const row of audit.conflicts ?? []) addReason(row.source, row.target, "원본 등급 상충");
    for (const row of audit.inferred ?? []) {
      if (row.relation !== "X") inferredPairs.add(key(row.source, row.targets[0]));
    }
    for (const row of audit.dislikes ?? []) {
      const pair = key(row.source, row.target);
      const status = row.needsReview ? "대상 확인 필요" : "혐오 기록";
      if (dislikeByPair.get(pair) !== "혐오 기록") dislikeByPair.set(pair, status);
    }

    function evidence(a, b) {
      const pair = key(a, b);
      const review = reviewByPair.get(pair);
      return {
        relation: model.relationBetween(a, b),
        ambiguous: review?.has(AMBIGUOUS_TARGET) ?? false,
        review: [...(review ?? [])],
        inferred: inferredPairs.has(pair),
        dislike: dislikeByPair.get(pair) ?? "",
      };
    }

    function groupTitle(plan, index) {
      if (index === -1) return "미편성";
      const group = plan.groups[index];
      return group?.length ? model.displayName(group[0]) + " 집단" : (index + 1) + "집단 (비어 있음)";
    }

    function snapshot(plan, options, priorKeys) {
      return {
        groups: plan.groups.map((group) => [...group]),
        unassigned: [...(plan.unassigned ?? [])],
        groupKeys: priorKeys ?? plan.groups.map((group) => group[0]),
        options: { ...options, targetCount: plan.targetCount ?? options.targetCount },
        manual: false,
      };
    }

    function memberIndex(plan, id) {
      return plan.groups.findIndex((group) => group.includes(id));
    }

    function move(plan, id, destination) {
      const source = memberIndex(plan, id);
      if (source === destination || !Number.isInteger(destination)) return null;
      if (destination < -1 || destination >= plan.groups.length) return null;
      if (source < 0 && !plan.unassigned.includes(id)) return null;
      const groups = plan.groups.map((group) => group.filter((member) => member !== id));
      const unassigned = plan.unassigned.filter((member) => member !== id);
      if (destination < 0) unassigned.push(id);
      else groups[destination].push(id);
      return { ...plan, groups, unassigned, manual: true };
    }

    function destinations(plan, id) {
      const source = memberIndex(plan, id);
      const rows = plan.groups.flatMap((group, index) => {
        if (index === source) return [];
        const summary = model.groupRelationSummary(id, group);
        return [{ index, size: group.length, links: summary.links, quality: summary.quality }];
      });
      rows.sort((a, b) => b.links - a.links || b.quality - a.quality || a.index - b.index);
      if (source >= 0) rows.push({ index: -1, size: plan.unassigned.length, links: 0 });
      return rows;
    }

    function placements(plan) {
      const result = new Map(plan.unassigned.map((id) => [id, { key: -1, label: "미편성" }]));
      plan.groups.forEach((group, index) => {
        const place = { key: plan.groupKeys[index], label: groupTitle(plan, index) };
        for (const id of group) result.set(id, place);
      });
      return result;
    }

    function scoredPlan(plan) {
      const relations = new Map();
      let linkedCount = 0;
      let multiLinkedCount = 0;
      let highGradeCount = 0;
      for (const group of plan.groups) {
        const metrics = model.groupMetrics(group);
        for (const row of metrics.edges) relations.set(key(row.a, row.b), row);
        linkedCount += metrics.linkedCount;
        multiLinkedCount += metrics.multiLinkedCount;
        highGradeCount += metrics.highGradeCount;
      }
      return {
        ...planner.formationStats(plan.groups, plan.unassigned),
        score: planner.totalScore(plan.groups),
        linkedCount,
        multiLinkedCount,
        highGradeCount,
        relations,
      };
    }

    function compare(before, after, virtualIds = []) {
      const oldPlaces = placements(before);
      const newPlaces = placements(after);
      const from = scoredPlan(before);
      const to = virtualIds.length
        ? model.withVirtualOaths([virtualIds], () => scoredPlan(after))
        : scoredPlan(after);
      const moves = [];
      for (const [id, place] of newPlaces) {
        const previous = oldPlaces.get(id);
        if (previous?.key !== place.key) moves.push({ id, from: previous?.label ?? "명단 밖", to: place.label });
      }
      const added = [...to.relations].filter(([pair]) => !from.relations.has(pair)).map(([, row]) => row);
      const lost = [...from.relations].filter(([pair]) => !to.relations.has(pair)).map(([, row]) => row);
      const updated = [];
      for (const [pair, next] of to.relations) {
        const previous = from.relations.get(pair);
        if (!previous) continue;
        if (previous.gradeValue !== next.gradeValue || previous.virtual !== next.virtual) updated.push({ previous, next });
      }
      const status = (members) => members.length ? planner.groupBattleProfile(members).roles : {};
      const roleChanges = [];
      const roles = { front: "전열", rear: "후열", siege: "공성·파성", support: "지원", guard: "호위" };
      const groupKeys = new Set([...before.groupKeys, ...after.groupKeys]);
      for (const groupKey of groupKeys) {
        const oldIndex = before.groupKeys.indexOf(groupKey);
        const newIndex = after.groupKeys.indexOf(groupKey);
        const previous = status(before.groups[oldIndex] ?? []);
        const next = status(after.groups[newIndex] ?? []);
        const gained = [];
        const removed = [];
        for (const [role, label] of Object.entries(roles)) {
          if (next[role] && !previous[role]) gained.push(label);
          if (previous[role] && !next[role]) removed.push(label);
        }
        if (gained.length || removed.length) {
          roleChanges.push({ group: newIndex < 0 ? groupTitle(before, oldIndex) : groupTitle(after, newIndex), gained, removed });
        }
      }
      return { from, to, moves, added, lost, updated, roleChanges };
    }

    function deployment(selection) {
      const officers = [];
      const roles = new Map();
      for (const [id, proposed] of selection) {
        const available = model.officerFormationNames(id);
        if (!model.officer(id)) continue;
        const formation = available.includes(proposed) ? proposed : "";
        const traits = model.officerTraits(id).filter((name) => SUPPORT_TRAITS.has(name));
        officers.push({ id, formation, traits });
        for (const role of FORMATION_ROLES[formation] ?? []) {
          if (!roles.has(role)) roles.set(role, []);
          roles.get(role).push(id);
        }
      }

      const pairs = [];
      for (let i = 0; i < officers.length; i++) {
        for (const target of officers.slice(i + 1)) {
          const source = officers[i];
          const item = evidence(source.id, target.id);
          const supporters = [source, target].filter((row) => row.traits.includes("보좌")).map((row) => row.id);
          if (item.relation || supporters.length || item.dislike) {
            pairs.push({ a: source.id, b: target.id, ...item, supporters });
          }
        }
      }
      return { officers, roles, pairs };
    }

    function formatPlan(plan) {
      return [
        ...plan.groups.map((group, index) => groupTitle(plan, index) + " · " + group.map(model.displayName).join(", ")),
        "미편성 · " + (plan.unassigned.map(model.displayName).join(", ") || "없음"),
      ].join("\n");
    }

    return Object.freeze({ evidence, groupTitle, snapshot, memberIndex, move, destinations, compare, deployment, formatPlan });
  };
})();
