/* Project a single decision on the current deployment without altering its relationships. */
(() => {
  "use strict";
  const api = globalThis.SAN14;
  api.fieldMediation = function(engine, plan) {
    const { units, relation } = engine;
    const deployed = new Map();
    plan.groups.forEach((group, index) => {
      const active = group.support == null ? group.ids : [...group.ids, group.support];
      for (const id of active) deployed.set(id, {
        group: index,
        active,
        form: group.rows.find(row => row.id === id)?.form,
        isolated: group.isolated.includes(id),
      });
    });
    const people = [...deployed.keys()].sort((a, b) => a - b);
    const out = { local: [], bridge: [], rotation: [], marriage: [] };

    function allowable(a, b) {
      const r = relation(a, b);
      return !r.family && !r.hate && !r.spouse && !r.oath;
    }

    function measure(ids, kind, meeting) {
      let attack = 0,
        defense = 0,
        gradeGain = 0;
      const rescued = [],
        improved = new Set();
      for (const a of ids) {
        const d = deployed.get(a);
        const contacts = ids.filter(b => b !== a && (meeting || deployed.get(b).group === d.group));
        const neighbors = [...new Set([...d.active, ...contacts])];
        let extra = 0;
        for (const b of contacts) {
          const r = relation(a, b);
          const gradeDelta = kind === "oath" ? 3 - r.grade : Math.max(0, 1 - r.grade);
          const newLink = !r.natural;
          if (!r.buff) extra++;
          // A dedicated support never adds a sixth tactic or a sixth combat panel.
          if (d.form && deployed.get(b).form) {
            gradeGain += gradeDelta;
            if (d.isolated && newLink && !rescued.includes(a)) rescued.push(a);
          }
          if ((d.form && !r.buff) || (d.form && deployed.get(b).form && (gradeDelta || newLink))) {
            improved.add(a);
            improved.add(b);
          }
        }
        if (d.form && extra) {
          const p = engine.profile(a, neighbors);
          const before = engine.panel(p, d.form),
            after = engine.panel(p, d.form, extra);
          attack += after.attack - before.attack;
          defense += after.defense - before.defense;
        }
      }
      return { attack, defense, gradeGain, rescued, participants: improved.size };
    }

    function consider(ids, kind, rotation = null) {
      const groups = new Set(ids.map(id => deployed.get(id).group));
      const local = measure(ids, kind, false);
      const bridge = groups.size > 1;
      const potential = bridge ? measure(ids, kind, true) : local;
      if (potential.participants !== ids.length) return;
      const key = rotation ? "rotation" : kind === "marriage" ? "marriage" : bridge ? "bridge" : "local";
      const rank = [potential.rescued.length, local.rescued.length,
        Math.min(potential.attack / plan.reference.attack, potential.defense / plan.reference.defense),
        local.attack + local.defense, potential.gradeGain, potential.attack + potential.defense
      ];
      if (rotation) {
        rank.splice(2, 0, Math.min((local.attack + rotation.attack) / plan.reference.attack,
          (local.defense + rotation.defense) / plan.reference.defense));
      }
      out[key].push({ ids, local, potential, bridge, rotation, rank });
    }
    for (let i = 0; i < people.length; i++)
      for (let j = i + 1; j < people.length; j++) {
        const a = people[i],
          b = people[j];
        if (!allowable(a, b)) continue;
        if (units.get(a).gender !== units.get(b).gender) {
          if (!engine.married.has(a) && !engine.married.has(b)) consider([a, b], "marriage");
          continue;
        }
        if (engine.sworn.has(a) || engine.sworn.has(b)) continue;
        for (const c of people.slice(j + 1)) {
          if (engine.sworn.has(c) || units.get(c).gender !== units.get(a).gender) continue;
          if (allowable(a, c) && allowable(b, c)) consider([a, b, c], "oath");
        }
      }
    // Compare a reserve's own-front rotation to the same rotation before the oath.
    // Keep the other fronts, the current support and the fixed core in place.
    for (const [index, g] of plan.groups.entries())
      for (const reserve of g.reserve) {
        const newcomer = units.get(reserve);
        if (newcomer.dedicated || engine.sworn.has(reserve)) continue;
        let best;
        for (const row of g.rows) {
          if (row.id === g.core) continue;
          const slot = g.ids.indexOf(row.id);
          const main = g.ids.map(id => id === row.id ? reserve : id);
          for (const form of newcomer.field) {
            const forms = g.forms.map((f, i) => i === slot ? form : f);
            const next = engine.evaluate(main, g.support, forms);
            if (next.frontCount < Math.min(2, g.frontCount) || next.exposed.length > Math.max(1, g.exposed
                .length)) continue;
            const floor = Math.min(next.attack / plan.reference.attack, next.defense / plan.reference.defense);
            if (!best || floor > best.floor) best = { next, floor, removed: row.id, form };
          }
        }
        if (!best) continue;
        const { next, removed, form } = best;
        const active = g.support == null ? next.ids : [...next.ids, g.support];
        const saved = new Map(active.map(id => [id, deployed.get(id)]));
        for (const id of active) deployed.set(id, {
          group: index,
          active,
          form: next.rows.find(r => r.id === id)?.form,
          isolated: next.isolated.includes(id) && (id === reserve || saved.get(id).isolated)
        });
        const companions = next.ids.filter(id => id !== reserve && !engine.sworn.has(id) &&
          units.get(id).gender === newcomer.gender && allowable(id, reserve));
        for (let i = 0; i < companions.length; i++)
          for (const b of companions.slice(i + 1)) {
            const a = companions[i];
            if (allowable(a, b)) consider([reserve, a, b], "oath", {
              reserve,
              removed,
              form,
              attack: next.attack - g.attack,
              defense: next.defense - g.defense
            });
          }
        for (const [id, entry] of saved) {
          if (entry) deployed.set(id, entry);
          else deployed.delete(id);
        }
      }
    for (const key of Object.keys(out)) {
      out[key].sort((a, b) => {
        for (let i = 0; i < a.rank.length; i++)
          if (a.rank[i] !== b.rank[i]) return b.rank[i] - a.rank[i];
        return 0;
      });
      out[key] = out[key].slice(0, 3);
    }
    return out;
  };
})();
