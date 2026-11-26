(() => {
  "use strict";
  const api = globalThis.SAN14;
  const version = "1.0";
  api.fieldAlgorithmVersion = version;
  const sum = values => values.reduce((a, b) => a + b, 0);
  const cmp = (a, b) => { for (let i = 0; i < a.length; i++)
      if (a[i] !== b[i]) return a[i] - b[i]; return 0; };
  const sorted = ids => [...ids].sort((a, b) => a - b);

  function summary(groups, ref) {
    const attacks = groups.map(g => g.attack),
      defenses = groups.map(g => g.defense);
    const minAttack = Math.min(...attacks),
      minDefense = Math.min(...defenses);
    const attackGap = Math.max(...attacks) - minAttack,
      defenseGap = Math.max(...defenses) - minDefense;
    const a = minAttack / ref.attack,
      d = minDefense / ref.defense;
    const gaps = [attackGap / ref.attack, defenseGap / ref.defense];
    const unsafe = sum(groups.map(g => Math.max(0, Math.min(2, g.ids.length) - g.frontCount) + Math.max(0, g
      .exposed.length - 1)));
    const isolated = sum(groups.map(g => g.isolated.length)),
      links = sum(groups.map(g => g.links.length));
    const grade = sum(groups.map(g => g.gradeSum));
    const strength = sum(groups.map(g => Math.sqrt(g.attack * g.defense)));
    // Compare capability floors to fixed reference values. A high-scoring new front cannot raise the denominator.
    return {
      minAttack,
      minDefense,
      attackGap,
      defenseGap,
      unsafe,
      isolated,
      links,
      strength,
      rank: [-unsafe, Math.floor(100 * Math.min(a, d)), Math.floor(100 * Math.max(a, d)),
        -Math.floor(100 * Math.max(...gaps)), -Math.floor(100 * sum(gaps)), -isolated, grade, links, strength
      ]
    };
  }
  // Refuse artificial compression when all sorted attack/defense panels stay equal or deteriorate.
  function better(left, right, ref) {
    const l = summary(left, ref),
      r = summary(right, ref);
    if (l.unsafe !== r.unsafe) return l.unsafe < r.unsafe;
    const values = groups => ["attack", "defense"].flatMap(k => groups.map(g => g[k]).sort((a, b) => a - b));
    const a = values(left),
      b = values(right);
    if (a.some((v, i) => v !== b[i])) {
      if (a.every((v, i) => v >= b[i])) return true;
      if (a.every((v, i) => v <= b[i])) return false;
    }
    return cmp(l.rank, r.rank) > 0;
  }
  api.fieldSummary = summary;
  api.preferFieldPlan = better;
  api.planField = function(engine, input) {
    const { units, relation } = engine;
    const ids = sorted(new Set(input.ids));
    if (!ids.length || ids.some(id => !units.has(id))) throw new Error("유효한 보유 장수 ID가 필요합니다.");
    const fixed = [...new Set(input.fixedCoreIds || [])];
    if (fixed.some(id => !ids.includes(id))) throw new Error("명단에 없는 고정 코어입니다.");
    const requested = input.groupCount === "auto" || input.groupCount == null ? Math.ceil(ids.length / 10) :
      Number(input.groupCount);
    if (!Number.isInteger(requested) || requested < 1 || fixed.length > 10) throw new Error(
    "집단 수와 코어를 확인하세요.");
    const count = Math.min(10, ids.length, Math.max(requested, fixed.length));
    const pinned = new Set(fixed);
    const candidates = ids.filter(id => !units.get(id).dedicated || pinned.has(id));
    const byPower = (a, b) => units.get(b).power - units.get(a).power || a - b;
    const ordered = [...candidates].sort(byPower);
    // Bound the swap neighborhood for very large custom rosters; keep all officers available for reserves.
    const shortlist = sorted(new Set([...fixed, ...ordered.slice(0, Math.max(60, 10 * count))]));
    const degree = new Map(shortlist.map(id => [id, sum(shortlist.filter(b => b !== id).map(b => Number(
      relation(id, b).natural)))]));
    const fit = (id, t) => {
      const ties = t.map(b => relation(id, b));
      return units.get(id).power * .25 + sum(ties.map(r => r.hate ? -120 : r.natural ? 32 + 6 * r.grade :
        0)) +
        12 * Number(t.some(b => units.get(b).war < 70) && units.get(id).traits.has("호위"));
    };
    const slots = Math.min(shortlist.length, 5 * count);
    const referenceUnits = ordered.slice(0, slots);
    const target = (axis) => Math.max(1, sum(referenceUnits.map(id => {
      const u = units.get(id);
      return u.base * Math.max(...u.field.map(f => engine.formations[f][axis]));
    })) / count);
    const reference = { attack: target(0), defense: target(1) };
    const cache = new Map();

    function pickForms(members, support) {
      const t = sorted(members),
        key = t.join(",") + "/" + support;
      if (cache.has(key)) return cache.get(key);
      const context = t.map(id => engine.profile(id, support == null ? t : [...t, support]));
      const options = t.map((id, i) => units.get(id).field.map(f => engine.panel(context[i], f)));
      // Coordinate search from a balanced starting position. Never assume a particular formation is mandatory.
      const chosen = options.map(rows => rows.reduce((best, r) =>
        Math.sqrt(r.attack * r.defense) - 55 * r.exposed > Math.sqrt(best.attack * best.defense) - 55 *
        best.exposed ? r : best));

      function shape(rows) {
        const a = sum(rows.map(r => r.attack)),
          d = sum(rows.map(r => r.defense));
        const fronts = rows.filter(r => r.frontline).length,
          risk = rows.filter(r => r.exposed).length;
        return [-Math.max(0, Math.min(2, rows.length) - fronts) - Math.max(0, risk - 1),
          Math.min(a / reference.attack, d / reference.defense), Math.sqrt(a * d) - 55 * risk
        ];
      }
      let rank = shape(chosen);
      for (let pass = 0; pass < 4; pass++) {
        let changed = false;
        for (let i = 0; i < t.length; i++) {
          let best = chosen[i];
          for (const alt of options[i]) {
            chosen[i] = alt;
            const next = shape(chosen);
            if (cmp(next, rank) > 0) { rank = next;
              best = alt;
              changed = true; }
          }
          chosen[i] = best;
        }
        if (!changed) break;
      }
      const field = engine.evaluate(t, support, chosen.map(r => r.form));
      cache.set(key, field);
      return field;
    }

    function draft(mode) {
      const seeds = [...fixed];
      while (seeds.length < Math.min(count, shortlist.length)) {
        const remaining = shortlist.filter(i => !seeds.includes(i));
        const priority = id => units.get(id).power + (mode === 2 ? 0 : 5) * degree.get(id) -
          (mode === 0 ? 15 : 90) * sum(seeds.map(b => Number(relation(id, b).natural)));
        remaining.sort((a, b) => priority(b) - priority(a) || a - b);
        seeds.push(remaining[0]);
      }
      const lineup = Array.from({ length: count }, (_, i) => seeds[i] == null ? [] : [seeds[i]]);
      const used = new Set(seeds);
      while (used.size < slots) {
        const size = Math.min(...lineup.map(t => t.length));
        let pick = null;
        for (const [g, t] of lineup.entries())
          if (t.length === size)
            for (const id of shortlist)
              if (!used.has(id)) {
                const rareTie = mode === 0 ? 0 : sum(t.filter(b => relation(id, b).natural).map(b =>
                  (mode === 1 ? 160 : 280) / Math.max(1, Math.min(degree.get(id), degree.get(b)))));
                const score = fit(id, t) + rareTie;
                if (!pick || score > pick.score) pick = { id, g, score };
              }
        lineup[pick.g].push(pick.id);
        used.add(pick.id);
      }
      let groups = lineup.map(t => pickForms(t, null));
      // Allocate the extra slot before improving groups. Revisit support assignments during the same search.
      function availableSupports(assigned) {
        return ids.filter(id => !assigned.has(id) && units.get(id).canSupport)
          .sort((a, b) => Number(units.get(b).cheer) - Number(units.get(a).cheer) || byPower(a, b));
      }
      const supports = availableSupports(used);
      const wants = field => field.ids.some(id => units.get(id).gender === "남");
      for (const id of supports) {
        let best = null;
        for (const [g, t] of groups.entries()) {
          if (t.support != null || (units.get(id).cheer && !wants(t) && groups.some(h => h.support == null &&
              wants(h)))) continue;
          const next = [...groups];
          next[g] = pickForms(t.ids, id);
          if (!best || better(next, best, reference)) best = next;
        }
        if (best) groups = best;
        if (groups.every(t => t.support != null)) break;
      }
      // Bounded best-improvement swaps, including bench promotions and cross-front support exchanges.
      for (let pass = 0; pass < 8; pass++) {
        let best = groups;
        const deployed = new Set(groups.flatMap(t => [...t.ids, t.support]));
        const bench = shortlist.filter(i => !deployed.has(i));
        const extra = availableSupports(deployed).slice(0, Math.max(12, count));
        const consider = trial => { if (better(trial, best, reference)) best = trial; };
        for (const [g, t] of groups.entries()) {
          for (const id of t.ids)
            if (!pinned.has(id)) {
              const rest = t.ids.filter(x => x !== id);
              for (const b of bench) {
                const trial = [...groups];
                trial[g] = pickForms([...rest, b], t.support);
                consider(trial);
              }
              for (let h = 0; h < g; h++)
                for (const b of groups[h].ids)
                  if (!pinned.has(b)) {
                    const trial = [...groups];
                    trial[g] = pickForms([...rest, b], t.support);
                    trial[h] = pickForms([...groups[h].ids.filter(x => x !== b), id], groups[h].support);
                    consider(trial);
                  }
              // A dual-role support can move into the line when another officer can take over its slot.
              for (const [h, other] of groups.entries())
                if (other.support != null && !units.get(other.support).dedicated && units.get(id).canSupport) {
                  const trial = [...groups];
                  trial[g] = pickForms([...rest, other.support], g === h ? id : t.support);
                  if (g !== h) trial[h] = pickForms(other.ids, id);
                  consider(trial);
                }
            }
          for (const b of extra) {
            const trial = [...groups];
            trial[g] = pickForms(t.ids, b);
            consider(trial);
          }
          for (let h = 0; h < g; h++)
            if (t.support !== groups[h].support) {
              const trial = [...groups];
              trial[g] = pickForms(t.ids, groups[h].support);
              trial[h] = pickForms(groups[h].ids, t.support);
              consider(trial);
            }
        }
        if (best === groups) break;
        groups = best;
      }
      // Tune formations against all fronts, including spread, after roster membership settles.
      for (let pass = 0; pass < 3; pass++) {
        let changed = false;
        for (let g = 0; g < count; g++)
          for (let i = 0; i < groups[g].ids.length; i++) {
            const t = groups[g];
            let best = groups;
            for (const f of units.get(t.ids[i]).field)
              if (f !== t.forms[i]) {
                const forms = [...t.forms];
                forms[i] = f;
                const trial = [...groups];
                trial[g] = engine.evaluate(t.ids, t.support, forms);
                if (better(trial, best, reference)) best = trial;
              }
            if (best !== groups) { groups = best;
              changed = true; }
          }
        if (!changed) break;
      }
      return groups;
    }
    let groups = draft(0);
    if (count > 1 && ids.length <= 60)
      for (const mode of [1, 2]) {
        const alternative = draft(mode);
        if (better(alternative, groups, reference)) groups = alternative;
      }
    // Price the cost of reconnecting isolated fighters while retaining the same primary and support pools.
    let connected = groups;
    for (let pass = 0; pass < 3 && count > 1; pass++) {
      let best = connected;
      const start = summary(connected, reference);
      let fewest = start.isolated;
      if (!fewest) break;
      for (let g = 0; g < count; g++)
        for (let h = 0; h < g; h++) {
          const left = connected[g],
            right = connected[h];
          for (const a of left.ids)
            for (const b of right.ids) {
              if (pinned.has(a) || pinned.has(b)) continue;
              const trial = [...connected];
              trial[g] = pickForms(left.ids.map(id => id === a ? b : id), left.support);
              trial[h] = pickForms(right.ids.map(id => id === b ? a : id), right.support);
              const m = summary(trial, reference);
              if (m.unsafe > start.unsafe || m.isolated >= start.isolated) continue;
              if (m.isolated < fewest || (m.isolated === fewest && better(trial, best, reference))) {
                best = trial;
                fewest = m.isolated;
              }
            }
        }
      if (best === connected) break;
      connected = best;
    }
    let alternativeLayout = null;
    if (connected !== groups) {
      if (better(connected, groups, reference)) groups = connected;
      else alternativeLayout = connected;
    }
    function completeLayout(layout) {
      const groups = layout.map((group, i) => ({
        ...group,
        core: fixed[i] ?? [...group.ids].sort(byPower)[0] ?? null,
        reserve: [],
      }));
      const deployed = new Set(groups.flatMap(g => [...g.ids, g.support]));
      const remaining = ids.filter(i => !deployed.has(i)).sort(byPower);
      const unassigned = [];
      for (const id of remaining) {
        let best = null,
          score = -Infinity;
        for (const g of groups) {
          if (g.reserve.length >= 5 || g.ids.length + Number(g.support != null) + g.reserve.length >= 10)
            continue;
          const active = g.support == null ? g.ids : [...g.ids, g.support];
          const tie = fit(id, active) + .15 * fit(id, g.reserve) - 2 * g.reserve.length;
          if (tie > score) {
            best = g;
            score = tie;
          }
        }
        if (best) best.reserve.push(id);
        else unassigned.push(id);
      }
      return { version, scene: engine.scene, fixedCoreIds: [...fixed], groups, reference,
        metrics: summary(groups, reference), unassigned, affinityAlternative: null };
    }
    const plan = completeLayout(groups);
    if (alternativeLayout) plan.affinityAlternative = completeLayout(alternativeLayout);
    return plan;
  };
})();
