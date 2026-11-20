(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  SAN14.createPlanner = function createPlanner(model, roster) {
    const {
      MAX_GROUP_SIZE, MAX_GROUP_COUNT, DEFAULT_AUTO_GROUP_COUNT_LIMIT, TIER_ORDER,
      FRONT_FORMATIONS, REAR_FORMATIONS, SIEGE_FORMATIONS, MORALE_TRAITS, DEBUFF_TRAITS,
      BATTLE_SUPPORT_TRAITS, officer, primary, traitScore, officerTraits, hasSupportTrait,
      fieldPower, roleTags, affinityReach, displayName, relationBetween,
      groupMetrics, hasAnyTrait, hasGuardTrait, hasAnyFormation, groupRelationSummary,
      rankGroups, sortUnassigned, hasRosterRelation, mainStat, isIndependentCoreType, isCommandCoreType,
    } = model;
    const { clampInteger, maxPlanningGroupCount } = roster;
    const DEFAULT_TARGET_COUNT = 4;

    function groupBattleProfile(group, scope = group) {
      const metrics = groupMetrics(group);
      const size = group.length;
      const possibleEdges = (size * Math.max(0, size - 1)) / 2;
      const core = group[0];
      const coreInfo = tierInfo(core, scope);
      const relationDensity = possibleEdges ? metrics.edges.length / possibleEdges : 0;
      const averageLinks = size ? metrics.linkEnds / size : 0;
      const roles = {
        battleCore: coreInfo.core || coreInfo.key || isCommandCoreType(core) || group.some(isIndependentCoreType),
        front: group.some((id) => hasAnyFormation(id, FRONT_FORMATIONS)),
        rear: group.some((id) => hasAnyFormation(id, REAR_FORMATIONS)),
        siege: group.some((id) => hasAnyFormation(id, SIEGE_FORMATIONS)),
        support: group.some((id) => hasAnyTrait(id, BATTLE_SUPPORT_TRAITS)),
        guard: group.some(hasGuardTrait),
        morale: group.some((id) => officerTraits(id).includes("응원") || officerTraits(id).includes("악주")),
        debuff: group.some((id) => officerTraits(id).includes("경국")),
      };
      const readyLinks = metrics.edges.length >= Math.max(2, Math.min(4, Math.ceil(size / 3)));
      const battleReady = size >= 3 && roles.battleCore && readyLinks;
      const marginal = !battleReady && size >= 2 && roles.battleCore && metrics.edges.length > 0;

      return {
        group,
        core,
        coreInfo,
        metrics,
        size,
        relationDensity,
        averageLinks,
        roles,
        battleReady,
        marginal,
      };
    }

    function battleRoleScore(roles) {
      return (
        (roles.front ? 180 : 0) +
        (roles.rear ? 150 : 0) +
        (roles.front && roles.rear ? 140 : 0) +
        (roles.siege ? 90 : 0) +
        (roles.support ? 120 : 0) +
        (roles.guard ? 80 : 0) +
        (roles.morale ? 70 : 0) +
        (roles.debuff ? 70 : 0)
      );
    }

    function battleGroupAutoScore(profile) {
      const { coreInfo, metrics, relationDensity, averageLinks, roles, size } = profile;
      const relationScore =
        metrics.quality * 92 + metrics.edges.length * 42 + metrics.linkEnds * 12 + relationDensity * 360 + averageLinks * 90;
      const coreScore =
        coreInfo.power * 0.82 +
        (roles.battleCore ? 320 : 0) +
        (coreInfo.core ? 220 : coreInfo.key ? 150 : coreInfo.upper ? 60 : 0);
      const sizeScore = Math.min(size, 12) * 72 + Math.max(0, size - 3) * 18;
      const smallPenalty = size <= 1 ? 900 : size === 2 ? 470 : size === 3 ? 90 : 0;
      const weakPenalty = roles.battleCore ? 0 : 420;
      return relationScore + coreScore + sizeScore + battleRoleScore(roles) - smallPenalty - weakPenalty;
    }

    function evaluateAutoRosterPlan(plan, ids, planOptions) {
      const groups = (plan.groups || []).filter((group) => group.length);
      const unassigned = plan.unassigned || [];
      const profiles = groups.map((group) => groupBattleProfile(group, ids));
      const stats = formationStats(groups, unassigned);
      const battleReadyCount = profiles.filter((profile) => profile.battleReady).length;
      const marginalCount = profiles.filter((profile) => profile.marginal).length;
      const tinyCount = profiles.filter((profile) => profile.size <= 2).length;
      const weakCoreCount = profiles.filter((profile) => !profile.roles.battleCore).length;
      const assignedCount = ids.length - unassigned.length;
      const targetCount = plan.targetCount || planOptions.targetCount || stats.groupCount;
      const relationTotal = profiles.reduce((sum, profile) => sum + profile.metrics.quality, 0);
      const roleCompleteCount = profiles.filter((profile) => profile.roles.front && profile.roles.rear).length;
      const groupScores = profiles.reduce((sum, profile) => sum + battleGroupAutoScore(profile), 0);
      const splitValue =
        battleReadyCount * 760 +
        marginalCount * 160 +
        stats.groupCount * 150 +
        assignedCount * 28 +
        relationTotal * 20 +
        roleCompleteCount * 150;
      const splitPenalty =
        unassigned.length * 72 + stats.smallCount * 180 + tinyCount * 1250 + weakCoreCount * 480 + stats.singleCount * 900;

      return {
        score: Math.round(groupScores + splitValue - splitPenalty),
        targetCount,
        groupCount: stats.groupCount,
        battleReadyCount,
        marginalCount,
        roleCompleteCount,
        linkedCount: profiles.reduce((sum, { metrics }) => sum + metrics.linkedCount, 0),
        multiLinkedCount: profiles.reduce((sum, { metrics }) => sum + metrics.multiLinkedCount, 0),
        smallCount: stats.smallCount,
        singleCount: stats.singleCount,
        tinyCount,
        weakCoreCount,
        unassignedCount: unassigned.length,
        assignedCount,
      };
    }

    function compareAutoRosterCandidates(a, b) {
      return (
        b.evaluation.score - a.evaluation.score ||
        b.evaluation.battleReadyCount - a.evaluation.battleReadyCount ||
        b.evaluation.roleCompleteCount - a.evaluation.roleCompleteCount ||
        a.evaluation.unassignedCount - b.evaluation.unassignedCount ||
        b.evaluation.linkedCount - a.evaluation.linkedCount ||
        b.evaluation.multiLinkedCount - a.evaluation.multiLinkedCount ||
        a.evaluation.tinyCount - b.evaluation.tinyCount ||
        b.targetCount - a.targetCount
      );
    }

    function autoTargetCountRange(ids, planOptions) {
      const maxCount = maxPlanningGroupCount(ids.length, planOptions.maxGroupCount);
      const fixedCoreCount = new Set((planOptions.fixedCoreIds || []).filter((id) => ids.includes(id))).size;
      const minCount = Math.max(1, Math.min(fixedCoreCount, maxCount));
      return { minCount, maxCount };
    }

    function autoRosterPlanCandidates(ids, planOptions) {
      const { minCount, maxCount } = autoTargetCountRange(ids, planOptions);
      const rows = [];
      for (let targetCount = minCount; targetCount <= maxCount; targetCount += 1) {
        const candidateOptions = { ...planOptions, mode: "count", targetCount };
        const plan = planRosterCoreFirst(ids, candidateOptions);
        const evaluation = evaluateAutoRosterPlan(plan, ids, candidateOptions);
        rows.push({ targetCount, plan, evaluation });
      }
      return rows.sort(compareAutoRosterCandidates);
    }

    function planRosterAuto(ids, planOptions) {
      const candidates = autoRosterPlanCandidates(ids, planOptions);
      const best = candidates[0] || { targetCount: 1, plan: { groups: [], unassigned: [...ids] }, evaluation: null };
      const finalGroupCount = best.plan.groups?.length || best.targetCount;
      return {
        ...best.plan,
        targetCount: finalGroupCount,
        auto: {
          attemptedTargetCount: best.targetCount,
          selectedGroupCount: finalGroupCount,
          evaluation: best.evaluation,
          candidates: candidates.map((row) => ({
            targetCount: row.targetCount,
            evaluation: row.evaluation,
          })),
        },
      };
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

    function roleRebalanceSpecs() {
      return [
        {
          key: "guard",
          label: "호위",
          matches: hasGuardTrait,
          duplicateRelief: 260,
          baseRoleValue: 150,
          maxScoreLoss: 220,
          minAdjustedDelta: 360,
          targetNeeds: (profile) => profile.roles.battleCore || profile.size >= 3,
        },
        {
          key: "morale",
          label: "응원/악주",
          matches: (id) => hasAnyTrait(id, MORALE_TRAITS),
          duplicateRelief: 220,
          baseRoleValue: 130,
          maxScoreLoss: 170,
          minAdjustedDelta: 340,
          targetNeeds: (profile) => profile.roles.battleCore || profile.size >= 3,
        },
        {
          key: "debuff",
          label: "경국",
          matches: (id) => hasAnyTrait(id, DEBUFF_TRAITS),
          duplicateRelief: 190,
          baseRoleValue: 120,
          maxScoreLoss: 150,
          minAdjustedDelta: 330,
          targetNeeds: (profile) => profile.roles.battleCore || profile.size >= 3,
        },
        {
          key: "siege",
          label: "공성",
          matches: (id) => hasAnyFormation(id, SIEGE_FORMATIONS),
          duplicateRelief: 180,
          baseRoleValue: 120,
          maxScoreLoss: 140,
          minAdjustedDelta: 330,
          targetNeeds: (profile) => profile.roles.battleCore || profile.size >= 4,
        },
        {
          key: "rear",
          label: "후열",
          matches: (id) => hasAnyFormation(id, REAR_FORMATIONS),
          duplicateRelief: 120,
          baseRoleValue: 90,
          maxScoreLoss: 90,
          minAdjustedDelta: 300,
          targetNeeds: (profile) => profile.roles.front || profile.battleReady,
        },
        {
          key: "front",
          label: "전열",
          matches: (id) => hasAnyFormation(id, FRONT_FORMATIONS),
          duplicateRelief: 120,
          baseRoleValue: 90,
          maxScoreLoss: 90,
          minAdjustedDelta: 300,
          targetNeeds: (profile) => profile.roles.rear || profile.battleReady,
        },
      ];
    }

    function profileHasRebalanceRole(profile, spec) {
      if (spec.key === "guard") return profile.roles.guard;
      if (spec.key === "morale") return profile.roles.morale;
      if (spec.key === "debuff") return profile.roles.debuff;
      if (spec.key === "siege") return profile.roles.siege;
      if (spec.key === "rear") return profile.roles.rear;
      if (spec.key === "front") return profile.roles.front;
      return false;
    }

    function groupRebalanceRoleCount(group, spec) {
      return group.filter(spec.matches).length;
    }

    function roleRebalanceValue(profile, spec) {
      const formationCombo =
        (spec.key === "front" && profile.roles.rear) || (spec.key === "rear" && profile.roles.front) ? 170 : 0;
      const battleValue = profile.roles.battleCore ? 140 : 0;
      const readyValue = profile.battleReady ? 65 : 0;
      const siegeValue = spec.key === "siege" && (profile.roles.front || profile.roles.rear) ? 55 : 0;
      const supportValue =
        (spec.key === "guard" || spec.key === "morale" || spec.key === "debuff") && (profile.roles.front || profile.roles.rear)
          ? 60
          : 0;
      return spec.baseRoleValue + formationCombo + battleValue + readyValue + siegeValue + supportValue;
    }

    function isRoleRebalanceTarget(group, scope, spec) {
      const profile = groupBattleProfile(group, scope);
      return !profileHasRebalanceRole(profile, spec) && spec.targetNeeds(profile);
    }

    function findBestRoleRebalance(groups, scope, maxSize) {
      const baseScore = totalScore(groups);
      let best = null;

      for (const spec of roleRebalanceSpecs()) {
        for (let sourceIndex = 0; sourceIndex < groups.length; sourceIndex += 1) {
          const source = groups[sourceIndex];
          const sourceRoleCount = groupRebalanceRoleCount(source, spec);
          if (sourceRoleCount < 2) continue;

          for (const id of source.slice(1).filter(spec.matches)) {
            const nextSource = source.filter((memberId) => memberId !== id);
            if (groupRebalanceRoleCount(nextSource, spec) < 1) continue;
            if (nextSource.length < 2 || !groupMetrics(nextSource).edges.length) continue;

            const currentFit = rosterFitScore(id, nextSource, scope);
            if (!currentFit) continue;

            for (let targetIndex = 0; targetIndex < groups.length; targetIndex += 1) {
              if (sourceIndex === targetIndex) continue;

              const target = groups[targetIndex];
              if (!isRoleRebalanceTarget(target, scope, spec)) continue;

              const swapIds = target.length < maxSize ? [null] : target.slice(1).filter((memberId) => !spec.matches(memberId));
              for (const swapId of swapIds) {
                const targetBase = swapId ? target.filter((memberId) => memberId !== swapId) : target;
                if (targetBase.length < 2 || !groupMetrics(targetBase).edges.length) continue;

                const nextSourceWithSwap = swapId ? [...nextSource, swapId] : nextSource;
                if (nextSourceWithSwap.length > maxSize) continue;
                if (swapId) {
                  const swapFit = rosterFitScore(swapId, nextSource, scope);
                  if (!canUseRosterFit(swapFit, "upper")) continue;
                  if (swapFit.relation.quality < 2) continue;
                }

                const targetFit = rosterFitScore(id, targetBase, scope);
                if (!canUseRosterFit(targetFit, "upper")) continue;
                if (targetFit.relation.quality < 2) continue;

                const nextGroups = groups.map((group, index) => {
                  if (index === sourceIndex) return nextSourceWithSwap;
                  if (index === targetIndex) return [...targetBase, id];
                  return [...group];
                });
                const scoreDelta = totalScore(nextGroups) - baseScore;
                if (scoreDelta < -spec.maxScoreLoss) continue;

                const targetProfile = groupBattleProfile(targetBase, scope);
                const duplicateRelief = Math.max(0, sourceRoleCount - 1) * spec.duplicateRelief;
                const roleValue = roleRebalanceValue(targetProfile, spec);
                const relationValue =
                  targetFit.relation.quality * 45 + targetFit.relation.links * 30 + targetFit.relation.star * 90;
                const balanceRelief = Math.max(0, source.length - target.length) * 24;
                const lostRelationCost = Math.max(0, currentFit.relation.quality - targetFit.relation.quality) * 25;
                const swapRelief = swapId ? 80 : 0;
                const adjustedDelta =
                  scoreDelta + duplicateRelief + roleValue + relationValue + balanceRelief + swapRelief - lostRelationCost;
                if (adjustedDelta < spec.minAdjustedDelta) continue;

                const row = { spec, id, sourceIndex, targetIndex, swapId, adjustedDelta, scoreDelta };
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
      }

      return best;
    }

    function rebalanceDuplicateBattleRoles(initialGroups, scope, maxSize) {
      const groups = initialGroups.map((group) => [...group]);

      for (let pass = 0; pass < 8; pass += 1) {
        const best = findBestRoleRebalance(groups, scope, maxSize);
        if (!best) break;
        groups[best.sourceIndex] = groups[best.sourceIndex].filter((id) => id !== best.id);
        if (best.swapId) {
          groups[best.targetIndex] = groups[best.targetIndex].filter((id) => id !== best.swapId);
          groups[best.sourceIndex].push(best.swapId);
        }
        groups[best.targetIndex].push(best.id);
      }

      return groups;
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
      const maxCount = maxPlanningGroupCount(ids.length, planOptions.maxGroupCount);
      const targetCount =
        planOptions.mode === "count"
          ? clampInteger(planOptions.targetCount, 1, maxCount, DEFAULT_TARGET_COUNT)
          : Math.max(1, Math.min(maxCount, minGroupCount(ids.length, maxSize)));
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
      const roleBalanced = rebalanceDuplicateBattleRoles(revalidated, ids, maxSize);
      return { ...cleanupCoreRosterPlan(roleBalanced, remaining, ids), targetCount };
    }

    function normalizePlanOptions(options) {
      if (typeof options === "number") return { mode: "size", maxSize: options };
      const normalizedMode = options?.mode || "count";
      return {
        mode: normalizedMode,
        maxSize: options?.maxSize || MAX_GROUP_SIZE,
        maxGroupCount:
          options?.maxGroupCount ?? (normalizedMode === "auto" ? DEFAULT_AUTO_GROUP_COUNT_LIMIT : MAX_GROUP_COUNT),
        targetCount: options?.targetCount ?? DEFAULT_TARGET_COUNT,
        fixedCoreIds: options?.fixedCoreIds || [],
      };
    }

    function planRoster(ids, options) {
      const planOptions = normalizePlanOptions(options);
      if (planOptions.mode === "auto") return planRosterAuto(ids, planOptions);
      return planRosterCoreFirst(ids, planOptions);
    }

    function totalScore(groups) {
      return groups.reduce((sum, group) => sum + groupMetrics(group).score, 0);
    }

    function formationStats(groups, unassigned = []) {
      const nonEmptyGroups = groups.filter((group) => group.length);
      return {
        groupCount: nonEmptyGroups.length,
        smallCount: nonEmptyGroups.filter((group) => group.length <= 3).length,
        singleCount: nonEmptyGroups.filter((group) => group.length === 1).length,
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
        (a, b) => metrics.linksByOfficer.get(b) - metrics.linksByOfficer.get(a) || fieldPower(b) - fieldPower(a),
      );
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
      if (key === "front" || key === "rear") {
        return fieldPower(id) * 0.72 + mainStat(id) * 1.1 + traitScore(id) * 8;
      }
      if (key === "siege") {
        return (
          (stats.leadership || 0) * 0.85 +
          (stats.intelligence || 0) * 0.65 +
          (stats.politics || 0) * 0.35 +
          fieldPower(id) * 0.32
        );
      }
      if (key === "guard") {
        return (stats.leadership || 0) * 0.8 + (stats.war || 0) * 1.15 + fieldPower(id) * 0.35 + traitScore(id) * 8;
      }
      if (key === "morale" || key === "debuff" || key === "support") {
        return (
          fieldPower(id) * 0.34 +
          (stats.charm || 0) * 0.85 +
          (stats.intelligence || 0) * 0.45 +
          (stats.politics || 0) * 0.35 +
          traitScore(id) * 10
        );
      }
      if (key === "advisor") return (stats.intelligence || 0) * 1.4 + (stats.politics || 0) * 0.7 + fieldPower(id) * 0.1;
      if (key === "admin") return (stats.politics || 0) * 1.3 + (stats.intelligence || 0) * 0.4 + fieldPower(id) * 0.1;
      return (stats.leadership || 0) * 1.2 + Math.max(stats.war || 0, stats.intelligence || 0) + fieldPower(id) * 0.1;
    }

    return Object.freeze({
      planRoster,
      autoRosterPlanCandidates,
      evaluateAutoRosterPlan,
      classifyUnassigned,
      totalScore,
      formationStats,
      groupBattleProfile,
      tierInfo,
      roleRebalanceSpecs,
      profileHasRebalanceRole,
      roleNeedScore,
      rosterFitScore,
    });
  };
})();
