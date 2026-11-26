/* A mediation decision has three comparable states: current deployment, movement alone, then the bond. */
(() => {
  "use strict";
  const api = globalThis.SAN14;
  const active = g => g.support == null ? g.ids : [...g.ids, g.support];
  const compare = (a, b) => {
    for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) return b[i] - a[i];
    return 0;
  };

  function rerate(engine, group, changes = {}) {
    const g = { ...group, ...changes };
    return { ...g, ...engine.evaluate(g.ids, g.support, g.forms) };
  }

  // Return a new layout. Applying a recommendation repeats exactly the movement shown in its preview.
  function moveGroups(engine, original, move) {
    if (!move) return original;
    const groups = [...original];
    const to = original[move.to];
    if (move.type === "primary") {
      const slot = to.ids.indexOf(move.removed);
      if (slot < 0 || !to.reserve.includes(move.reserve) || move.removed === to.core) throw Error("교대할 장수가 달라졌습니다.");
      groups[move.to] = rerate(engine, to, {
        ids: to.ids.map((id, i) => i === slot ? move.reserve : id),
        forms: to.forms.map((f, i) => i === slot ? move.form : f),
        reserve: to.reserve.map(id => id === move.reserve ? move.removed : id)
      });
    } else {
      const from = original[move.from],
        id = move.reserve,
        outgoing = to.support;
      if (!engine.units.get(id)?.canSupport || (from.support !== id && !from.reserve.includes(id)))
        throw Error("지원 위치가 달라졌습니다.");
      if (move.from === move.to) {
        const reserve = to.reserve.filter(x => x !== id);
        if (outgoing != null) reserve.push(outgoing);
        groups[move.to] = rerate(engine, to, { support: id, reserve });
      } else {
        if (outgoing == null && active(to).length + to.reserve.length >= 10) return null;
        if (from.support === id) groups[move.from] = rerate(engine, from, { support: outgoing });
        else {
          const reserve = from.reserve.filter(x => x !== id);
          if (outgoing != null) reserve.push(outgoing);
          groups[move.from] = { ...from, reserve };
        }
        groups[move.to] = rerate(engine, to, { support: id });
      }
    }
    return groups;
  }

  function deployment(engine, groups) {
    const positions = new Map();
    const totals = groups.map(g => ({ attack: g.attack, defense: g.defense }));
    let cheerFronts = 0;
    for (const [index, g] of groups.entries()) {
      const near = active(g);
      if (g.ids.some(id => engine.units.get(id).gender === "남" &&
          near.some(b => b !== id && engine.units.get(b).cheer))) cheerFronts++;
      for (const id of near) {
        const row = g.rows.find(r => r.id === id);
        const degree = row ? g.links.filter(link => link.a === id || link.b === id).length : 0;
        positions.set(id, { index, near, row, degree, isolated: g.isolated.includes(id), profile: engine.profile(id, near) });
      }
    }
    return {
      positions,
      totals,
      cheerFronts,
      unsafe: groups.reduce((sum, g) => sum +
        Math.max(0, Math.min(2, g.ids.length) - g.frontCount) + Math.max(0, g.exposed.length - 1), 0)
    };
  }

  function panels(totals) {
    const attacks = totals.map(g => g.attack),
      defenses = totals.map(g => g.defense);
    const minAttack = Math.min(...attacks),
      minDefense = Math.min(...defenses);
    return {
      minAttack,
      minDefense,
      attackGap: Math.max(...attacks) - minAttack,
      defenseGap: Math.max(...defenses) - minDefense,
      attack: attacks.reduce((a, b) => a + b, 0),
      defense: defenses.reduce((a, b) => a + b, 0)
    };
  }

  function measure(engine, context, home, ids, kind, meeting) {
    const totals = context.totals.map(g => ({ ...g }));
    const beforeTotals = context.totals.map(g => ({ ...g }));
    const improved = new Set(),
      rescued = [],
      reinforced = [],
      anchors = new Set();
    let attack = 0,
      defense = 0,
      gradeGain = 0;
    for (const a of ids) {
      const pos = context.positions.get(a);
      if (!pos.row) continue;
      const contacts = ids.filter(b => b !== a && (meeting || context.positions.get(b).index === pos.index));
      const visitors = contacts.filter(b => !pos.near.includes(b));
      const profile = visitors.length ? engine.profile(a, [...pos.near, ...visitors]) : pos.profile;
      const before = visitors.length ? engine.panel(profile, pos.row.form) : pos.row;
      const hasVisitingFriend = visitors.some(b => context.positions.get(b).row && engine.relation(a, b).natural);
      if (!pos.isolated || hasVisitingFriend) anchors.add(a);
      let extra = 0,
        connected = false;
      for (const b of contacts) {
        const r = engine.relation(a, b),
          after = engine.projectRelation(r, kind);
        const mainPair = !!context.positions.get(b).row;
        const grade = mainPair ? after.grade - r.grade : 0;
        if (!r.buff) extra++;
        gradeGain += grade;
        if (mainPair && !r.natural) connected = true;
        if (!r.buff || grade) {
          improved.add(a);
          improved.add(b);
        }
      }
      if (connected && pos.isolated && !hasVisitingFriend && (!home.positions.get(a)?.row || home.positions.get(a).isolated))
        rescued.push(a);
      else if (connected && pos.degree === 1 && (home.positions.get(a)?.degree ?? 0) <= 1) reinforced.push(a);
      const after = extra ? engine.panel(profile, pos.row.form, extra) : before;
      attack += after.attack - before.attack;
      defense += after.defense - before.defense;
      for (const stat of ["attack", "defense"]) {
        beforeTotals[pos.index][stat] += before[stat] - pos.row[stat];
        totals[pos.index][stat] += after[stat] - pos.row[stat];
      }
    }
    const anchored = rescued.filter(a => [...anchors].some(b => meeting || context.positions.get(a).index === context.positions.get(b).index));
    const independent = rescued.filter(a => !anchored.includes(a));
    return { attack, defense, gradeGain, rescued, anchored, independent, reinforced, participants: improved.size, before: panels(beforeTotals), after: panels(totals) };
  }

  const sections = {
    local: "집단 내 3인 의형제",
    bridge: "집단 간 3인 의형제",
    rotation: "예비 교대 후 3인 의형제",
    marriage: "현재 배치에서 결혼",
    marriageBridge: "집단 간 결혼",
    marriageMove: "지원 재배치 후 결혼",
    marriageRotation: "예비 교대 후 결혼"
  };
  api.fieldBondSections = sections;

  // At most six deployed officers per front: every feasible local selection is zero, one or two disjoint trios.
  function localOathSet(rows, home, ref) {
    const totals = home.totals.map(g => ({ ...g })),
      chosen = [];
    for (const [index, front] of home.totals.entries()) {
      const options = rows.filter(r => home.positions.get(r.ids[0]).index === index);
      let best = [],
        bestRank = null;

      function score(selection) {
        const a = front.attack + selection.reduce((sum, r) => sum + r.local.attack, 0);
        const d = front.defense + selection.reduce((sum, r) => sum + r.local.defense, 0);
        const rank = [selection.reduce((sum, r) => sum + r.local.rescued.length, 0),
          Math.min(a / ref.attack, d / ref.defense), Math.max(a / ref.attack, d / ref.defense),
          selection.reduce((sum, r) => sum + r.local.gradeGain, 0), -selection.length
        ];
        if (!bestRank || compare(rank, bestRank) < 0) { bestRank = rank;
          best = selection; }
      }
      for (const [i, a] of options.entries()) {
        score([a]);
        for (const b of options.slice(i + 1))
          if (a.ids.every(id => !b.ids.includes(id))) score([a, b]);
      }
      for (const r of best) {
        chosen.push(r);
        totals[index].attack += r.local.attack;
        totals[index].defense += r.local.defense;
      }
    }
    return { choices: chosen, after: panels(totals), rescued: chosen.flatMap(r => r.local.rescued) };
  }

  api.fieldMediation = function(engine, plan, focus = []) {
    const groups = plan.groups,
      home = deployment(engine, groups),
      start = panels(home.totals);
    const result = Object.fromEntries(Object.keys(sections).map(key => [key, new Map()]));
    const canInclude = ids => focus.every(id => ids.includes(id));
    const floorRank = p => {
      const a = p.minAttack / plan.reference.attack,
        d = p.minDefense / plan.reference.defense;
      return [Math.floor(100 * Math.min(a, d)), Math.floor(100 * Math.max(a, d))];
    };

    function consider(kind, members, ctx = home, move = null) {
      if (!canInclude(members) || engine.bondIssue(kind, members)) return;
      const ids = [...members].sort((a, b) => a - b);
      const bridge = ids.some(id => ctx.positions.get(id).index !== ctx.positions.get(ids[0]).index);
      const local = measure(engine, ctx, home, ids, kind, false);
      const potential = bridge ? measure(engine, ctx, home, ids, kind, true) : local;
      if (potential.participants !== ids.length) return;
      const layout = local.before;
      const preservesFloors = local.after.minAttack >= start.minAttack && local.after.minDefense >= start.minDefense;
      const rank = [-ctx.unsafe, Number(preservesFloors), ...floorRank(local.after), local.rescued.length,
        local.anchored.length, ctx.cheerFronts,
        ...(bridge ? [...floorRank(potential.after), potential.rescued.length, potential.anchored.length] : []),
        -Math.max(local.after.attackGap / plan.reference.attack, local.after.defenseGap / plan.reference.defense),
        Math.min(potential.attack / plan.reference.attack, potential.defense / plan.reference.defense),
        potential.reinforced.length, local.gradeGain, potential.gradeGain, potential.attack + potential.defense
      ];
      const key = kind === "oath" ? (move ? "rotation" : bridge ? "bridge" : "local") :
        (move ? (move.type === "support" ? "marriageMove" : "marriageRotation") : bridge ? "marriageBridge" : "marriage");
      const idKey = ids.join(",");
      const prior = result[key].get(idKey);
      if (prior && compare(rank, prior.rank) >= 0) return;
      const rotation = move ? { ...move, attack: layout.attack - start.attack, defense: layout.defense - start.defense } : null;
      result[key].set(idKey, {
        kind,
        ids,
        bridge,
        move,
        rotation,
        local,
        potential,
        rank,
        coverage: [home.cheerFronts, ctx.cheerFronts],
        start
      });
    }
    const officers = [...home.positions.keys()].sort((a, b) => a - b);
    for (const [i, a] of officers.entries())
      for (let j = i + 1; j < officers.length; j++) {
        const b = officers[j];
        if (engine.units.get(a).gender !== engine.units.get(b).gender) consider("marriage", [a, b]);
        else if (!engine.sworn.has(a) && !engine.sworn.has(b)) {
          for (let k = j + 1; k < officers.length; k++) consider("oath", [a, b, officers[k]]);
        }
      }
    // Preserve all other fronts, all cores, and the five primary tactic slots.
    for (const [index, g] of groups.entries()) {
      for (const reserve of g.reserve || []) {
        const unit = engine.units.get(reserve);
        if (unit.dedicated || (engine.sworn.has(reserve) && engine.married.has(reserve))) continue;
        if (focus.some(id => id !== reserve && !active(g).includes(id))) continue;
        for (const row of g.rows) {
          if (row.id === g.core) continue;
          for (const form of unit.field) {
            const move = { type: "primary", to: index, reserve, removed: row.id, form };
            const layout = moveGroups(engine, groups, move),
              next = layout[index];
            if (next.frontCount < Math.min(2, g.frontCount) || next.exposed.length > Math.max(1, g.exposed.length)) continue;
            const ctx = deployment(engine, layout);
            const others = active(next).filter(id => id !== reserve);
            for (const [i, a] of others.entries()) {
              if (engine.units.get(a).gender !== unit.gender) consider("marriage", [reserve, a], ctx, move);
              else
                for (const b of others.slice(i + 1)) consider("oath", [reserve, a, b], ctx, move);
            }
          }
        }
      }
      // Evaluate both fronts when sending an aura officer to a potential spouse.
      for (const reserve of [g.support, ...(g.reserve || [])]) {
        if (reserve == null || !engine.units.get(reserve).canSupport || engine.married.has(reserve)) continue;
        for (const [to, target] of groups.entries()) {
          if (target.support === reserve) continue;
          const partners = target.ids.filter(id => canInclude([id, reserve]) && !engine.bondIssue("marriage", [id, reserve]));
          if (!partners.length) continue;
          const move = { type: "support", from: index, to, reserve, removed: target.support };
          const layout = moveGroups(engine, groups, move);
          if (!layout) continue;
          const ctx = deployment(engine, layout);
          if (ctx.unsafe > home.unsafe) continue;
          for (const id of partners) consider("marriage", [id, reserve], ctx, move);
        }
      }
    }
    const oathSet = focus.length ? null : localOathSet([...result.local.values()], home, plan.reference);
    for (const key of Object.keys(result)) result[key] = [...result[key].values()].sort((a, b) =>
      compare(a.rank, b.rank) || a.ids.join(",").localeCompare(b.ids.join(","))).slice(0, 3);
    return { ...result, oathSet };
  };

  api.previewFieldBond = function(engine, plan, candidate) {
    const { kind, ids, move } = candidate;
    const nextEngine = engine.withBond(kind, ids);
    const layout = moveGroups(engine, plan.groups, move);
    if (!layout) throw Error("집단 정원을 확인하세요.");
    const owned = new Set([...(plan.unassigned || []), ...layout.flatMap(g => [...active(g), ...(g.reserve || [])])]);
    if (!ids.every(id => owned.has(id))) throw Error("보유 명단에 없는 중개 대상입니다.");
    const groups = layout.map(g => rerate(nextEngine, g));
    // A membership change also changes which affinity-preserving alternative is relevant.
    const nextPlan = { ...plan, groups, metrics: api.fieldSummary(groups, plan.reference), affinityAlternative: null };
    return { engine: nextEngine, plan: nextPlan };
  };
})();
