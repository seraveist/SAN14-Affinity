(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  SAN14.createRecommendations = function createRecommendations(model, planner) {
    const {
      MAX_GROUP_SIZE, RECOMMENDATION_LIMIT, BATTLE_SUPPORT_TRAITS, officer, officerTraits,
      hasSupportTrait, isFemale, fieldPower, affinityReach, displayName, relationBetween,
      groupMetrics, hasAnyTrait, withVirtualOaths, sortUnassigned,
    } = model;
    const {
      planRoster, formationStats, classifyUnassigned, groupBattleProfile, tierInfo,
      roleRebalanceSpecs, profileHasRebalanceRole, roleNeedScore, rosterFitScore,
    } = planner;

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

    function recommendationRoleSpecs() {
      return [
        ...roleRebalanceSpecs(),
        {
          key: "support",
          label: "지원",
          matches: (id) => hasAnyTrait(id, BATTLE_SUPPORT_TRAITS),
          targetNeeds: (profile) => profile.roles.battleCore || profile.size >= 3,
        },
      ];
    }

    function profileHasRecommendationRole(profile, need) {
      if (need.key === "support") return profile.roles.support;
      return profileHasRebalanceRole(profile, need);
    }

    function recommendationRoleNeeds(group, scope) {
      const profile = groupBattleProfile(group, scope);
      return recommendationRoleSpecs().filter((need) => !profileHasRecommendationRole(profile, need) && need.targetNeeds(profile));
    }

    function recommendationRoleComplementScore(id, group, scope) {
      const needs = recommendationRoleNeeds(group, scope);
      if (!needs.length) return fieldPower(id) * 0.1;
      return needs.reduce((sum, need) => sum + (need.matches(id) ? roleNeedScore(id, need.key) : 0), 0);
    }

    function recommendationRoleLabel(need) {
      if (need.key === "morale") return "응원/악주";
      if (need.key === "debuff") return "경국";
      return need.label;
    }

    function recommendationPriorityLabel(need) {
      return ["support", "morale", "debuff"].includes(need.key) ? "범위 버프 보강" : "전투 역할 보정";
    }

    function assignedRoleSourceCandidates(groups, targetIndex, need, scope) {
      const rows = [];
      for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
        if (sourceIndex === targetIndex) continue;
        const source = groups[sourceIndex];
        if (source.length <= 3 || source.filter(need.matches).length < 2) continue;

        for (const id of source.slice(1).filter(need.matches)) {
          const remaining = source.filter((memberId) => memberId !== id);
          if (remaining.length < 2 || !groupMetrics(remaining).edges.length) continue;
          rows.push({
            id,
            sourceRank: 2,
            sourceClass: `${recommendationRoleLabel(need)} 중복`,
            donorIndex: sourceIndex,
          });
        }
      }
      return rows.sort(
        (a, b) =>
          roleNeedScore(b.id, need.key) - roleNeedScore(a.id, need.key) ||
          (rosterFitScore(b.id, groups[targetIndex], scope)?.score || 0) -
            (rosterFitScore(a.id, groups[targetIndex], scope)?.score || 0) ||
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
        if (!row) continue;
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

      for (const target of targetInfos) {
        for (const need of recommendationRoleNeeds(target.group, ids)) {
          const sources = [
            ...roleSourceCandidates(classified, need),
            ...assignedRoleSourceCandidates(groups, target.index, need, ids),
          ]
            .filter((row) => groupIndex.get(row.id) !== target.index)
            .slice(0, 8);
          for (const source of sources) {
            for (const anchor of groupAnchors(target.group, 3)) {
              pushAdjustmentCandidate(rows, {
                kind: "oath",
                priority: 3,
                priorityLabel: recommendationPriorityLabel(need),
                ids: [source.id, anchor],
                anchorId: anchor,
                sourceIds: [source.id],
                targetIndex: target.index,
                needKey: need.key,
                needLabel: recommendationRoleLabel(need),
                sourceRank: source.sourceRank,
                sourceClass: source.sourceClass,
                reason: `${recommendationRoleLabel(need)} 보강`,
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
          const pool = [...source.group, ...target.group];
          const extra = bestThirdMember(pool, base, target.group, pool);
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

    function bestThirdMember(pool, baseIds, targetGroup, scope = pool) {
      return [...new Set(pool)]
        .filter((id) => !baseIds.includes(id))
        .sort(
          (a, b) =>
            recommendationRoleComplementScore(b, targetGroup, scope) - recommendationRoleComplementScore(a, targetGroup, scope) ||
            fieldPower(b) - fieldPower(a) ||
            affinityReach(b).score - affinityReach(a).score,
        )
        .find((id) => !hasExistingAffinityPair([...baseIds, id]));
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
          const specTargetGroup = groups[spec.targetIndex] || [];
          const targetIndex =
            specTargetGroup.includes(female) || specTargetGroup.includes(other)
              ? spec.targetIndex
              : groups[femaleGroupIndex]?.length >= 2
                ? femaleGroupIndex
                : otherGroupIndex;
          if (targetIndex < 0 || !groups[targetIndex]) continue;
          const anchorId = groups[targetIndex].includes(female) ? female : other;
          pushAdjustmentCandidate(rows, {
            kind: "marriage",
            priority: spec.priority,
            priorityLabel: spec.needKey === "support" ? "범위 버프 보강" : spec.priorityLabel,
            ids: [other, female],
            anchorId,
            sourceIds: [anchorId === female ? other : female],
            targetIndex,
            needKey: spec.needKey,
            needLabel: spec.needLabel,
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
              needLabel: "지원",
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
      if (spec.needLabel && !badges.includes(spec.needLabel)) badges.push(spec.needLabel);
      if (spec.needKey === "morale" && !badges.includes("응원/악주")) badges.push("응원/악주");
      const needScore = spec.needKey
        ? sourceIds.reduce((sum, id) => sum + roleNeedScore(id, spec.needKey), 0) * 0.25
        : 0;

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
          needScore +
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

    function recommendationLayoutPlan(spec, ids, planOptions, basePlan) {
      const groups = (basePlan.groups || []).map((group) => [...group]);
      const unassigned = [...(basePlan.unassigned || [])];
      const memberIndex = formationMemberIndex(groups, unassigned);
      const targetIndex = groups[spec.targetIndex] ? spec.targetIndex : memberIndex.get(spec.anchorId);
      if (targetIndex === undefined || targetIndex < 0 || !groups[targetIndex]) return null;

      const targetIds = new Set(groups[targetIndex]);
      const sourceIds = [...new Set(spec.sourceIds || [])].filter((id) => ids.includes(id) && !targetIds.has(id));
      if (!sourceIds.length) return null;
      if (groups[targetIndex].length + sourceIds.length > (planOptions.maxSize || MAX_GROUP_SIZE)) return null;

      const sourceSet = new Set(sourceIds);
      const nextGroups = groups.map((group, index) => {
        const kept = group.filter((id) => !sourceSet.has(id));
        return index === targetIndex ? [...kept, ...sourceIds] : kept;
      });
      const nextUnassigned = sortUnassigned(unassigned.filter((id) => !sourceSet.has(id)));
      const cleanGroups = nextGroups.filter((group) => group.length);

      for (let index = 0; index < nextGroups.length; index += 1) {
        const group = nextGroups[index];
        if (!group.length) continue;
        if (group.length === 1 && groups[index]?.length > 1) return null;
        if (group.length >= 2 && !groupMetrics(group).edges.length) return null;
      }

      return {
        groups: cleanGroups,
        unassigned: nextUnassigned,
        targetCount: basePlan.targetCount || planOptions.targetCount || cleanGroups.length,
      };
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
      const plan = withVirtualOaths([spec.ids], () =>
        planOptions.preserveRecommendationLayout
          ? recommendationLayoutPlan(spec, ids, planOptions, basePlan)
          : planRoster(ids, planOptions),
      );
      if (!plan) return null;
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
      return row.priorityLabel === "범위 버프 보강" || ["support", "morale", "debuff"].includes(row.needKey);
    }

    function recommendationSignature(kind, ids, targetIndex) {
      return `${kind}|${targetIndex}|${[...ids].sort((a, b) => a - b).join("+")}`;
    }

    return Object.freeze({
      recommendOathSets,
      isSupportRecommendation,
    });
  };
})();
