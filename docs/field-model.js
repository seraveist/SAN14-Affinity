/* Land battle estimates shared by draft generation and mediation comparisons. */
(() => {
  "use strict";
  const api = globalThis.SAN14 ??= {};
  const formations = {
    어린: [30, 30],
    봉시: [45, 18],
    안행: [30, 12],
    방원: [10, 40],
    학익: [15, 30],
    장사: [21, 21],
    추행: [5, 5],
    정란: [10, 20],
    충차: [10, 18],
    투석: [14, 16],
  };
  const siege = new Set(["정란", "충차", "투석"]);
  const melee = new Set(["어린", "봉시", "학익", "장사", "추행"]);
  const front = new Set(["어린", "봉시", "방원", "학익", "장사"]);
  const pair = (a, b) => a < b ? a * 65536 + b : b * 65536 + a;
  const scenarios = {
    "01": { name: "황건의 난", married: [
        [521, 816]
      ], sworn: [
        [952, 147, 656]
      ] },
    "06": { name: "한중쟁탈전", married: [
        [521, 816],
        [526, 459],
        [656, 120],
        [557, 584],
        [379, 411],
        [902, 558],
        [576, 444],
        [440, 249]
      ], sworn: [
        [952, 147, 656],
        [557, 379]
      ] },
  };
  api.fieldScenarios = scenarios;
  api.createFieldModel = function(data, model, scene = "01", decisions = []) {
    const initial = scenarios[scene];
    if (!initial) throw new Error("지원하지 않는 시나리오입니다.");
    const blocked = new Set(data.relationshipEvidence.dislikes.filter(r => !r.needsReview).map(r => pair(r
      .source, r.target)));
    const married = new Map(initial.married.flatMap(([a, b]) => [
      [a, b],
      [b, a]
    ]));
    const sworn = new Set(initial.sworn.flat());
    const oathPairs = new Set(initial.sworn.flatMap(group =>
      group.flatMap((a, i) => group.slice(i + 1).map(b => pair(a, b)))));
    const units = new Map();
    for (const o of model.officers.values()) {
      const traits = new Set(o.traits.map(t => t.name));
      const forms = o.formations.map(f => f.ko).filter(f => formations[f]);
      const field = forms.filter(f => !siege.has(f));
      const { leadership: lead, war } = o.stats;
      const cheer = traits.has("응원");
      units.set(o.id, {
        id: o.id,
        name: model.displayName(o.id),
        gender: o.gender,
        lead,
        war,
        traits,
        cheer,
        // A fighter with an aura can also lead a unit. Low-combat cheer officers occupy the extra slot.
        dedicated: cheer && lead < 60 && war < 60,
        canSupport: ["응원", "악주", "보좌", "호위", "신장", "강장", "효장", "간웅"].some(t => traits.has(t)),
        forms,
        field: field.length ? field : forms,
        base: 10 + lead / 10 + Math.min(Math.sqrt(5000), 4 * lead / 3) / 20,
        power: model.fieldPower(o.id),
        compatibility: o.compatibility
      });
    }
    const likes = new Map(Object.entries(data.ceAffinity.outgoing).map(([a, bs]) => [+a, new Set(bs)]));
    if (scene === "06")
      for (const [a, bs] of Object.entries(data.ceAffinity.variantAdded)) {
        if (!likes.has(+a)) likes.set(+a, new Set());
        for (const b of bs) likes.get(+a).add(b);
      }
    const cache = new Map();
    const simulated = new Map();
    function bondIssue(kind, ids) {
      const oath = kind === "oath";
      if (!oath && kind !== "marriage") return "알 수 없는 중개 종류입니다.";
      if (ids.length !== (oath ? 3 : 2) || new Set(ids).size !== ids.length || ids.some(id => !units.has(id)))
        return oath ? "의형제는 서로 다른 장수 3명을 선택하세요." : "결혼은 서로 다른 장수 2명을 선택하세요.";
      const genders = new Set(ids.map(id => units.get(id).gender));
      if (genders.size !== (oath ? 1 : 2)) return oath ? "의형제는 동성 3명끼리 맺습니다." : "결혼은 이성 2명이 대상입니다.";
      for (const id of ids) {
        if (oath && sworn.has(id)) return units.get(id).name + "에게 이미 의형제가 있습니다.";
        if (!oath && married.has(id)) return units.get(id).name + "의 배우자는 " + units.get(married.get(id)).name + "입니다.";
      }
      for (const [i,a] of ids.entries()) for (const b of ids.slice(i+1)) {
        const r = relation(a,b);
        if (r.family || r.hate) return units.get(a).name + "·" + units.get(b).name + " 사이에 " +
          (r.family || "혐오") + " 관계가 있습니다.";
      }
      return "";
    }

    function projectRelation(r, kind) {
      return {...r, natural:true, buff:true, oath:kind === "oath" || r.oath,
        spouse:kind === "marriage" || r.spouse, grade:kind === "oath" ? 3 : Math.max(1,r.grade)};
    }

    function relation(a, b) {
      const key = a * 65536 + b;
      if (cache.has(key)) return cache.get(key);
      const ab = likes.get(a)?.has(b) || false,
        ba = likes.get(b)?.has(a) || false;
      const k = pair(a, b),
        hate = blocked.has(k),
        family = model.familyBetween(a, b);
      const recorded = model.relationBetween(a, b)?.gradeValue || 0;
      const kin = !!family && (family !== "같은 혈족" || recorded > 0);
      const spouse = married.get(a) === b && !simulated.has(k),
        oath = oathPairs.has(k);
      const natural = !hate && (ab || ba || kin || spouse || oath);
      const assist = !hate && units.get(b).traits.has("보좌");
      let grade = Math.min(3, Number(ab) + Number(ba) + Number(kin));
      if (spouse) grade = Math.max(1, grade, recorded);
      if (assist) {
        const delta = Math.abs(units.get(a).compatibility - units.get(b).compatibility);
        const distance = Math.min(delta, 150 - delta);
        grade = grade === 0 ? (distance <= 41 ? 2 : 1) : grade === 1 ? (distance <= 26 ? 3 : 2) : 3;
      }
      const r = {
        ab,
        ba,
        kin,
        family,
        spouse,
        oath,
        hate,
        natural,
        assist,
        buff: natural || assist,
        grade: hate ? 0 : oath ? 3 : grade
      };
      const result = simulated.has(k) ? projectRelation(r, simulated.get(k)) : r;
      cache.set(key, result);
      return result;
    }

    function profile(id, nearby) {
      const u = units.get(id),
        aura = new Map();
      let friends = 0;
      for (const other of nearby) {
        if (id === other) continue;
        if (relation(id, other).buff) friends++;
        for (const trait of units.get(other).traits) aura.set(trait, (aura.get(trait) || 0) + 1);
      }
      const count = t => aura.get(t) || 0;
      const common = .2 * count("간웅") + .2 * Number(u.traits.has("임재") && nearby.filter(v => v !== id)
        .length >= 3);
      const cheer = u.gender === "남" ? .1 * count("응원") : 0;
      return {
        id,
        base: u.base,
        friends,
        guard: count("호위") > 0,
        music: count("악주") > 0,
        cheer,
        attackAura: common + .3 * count("신장") + .15 * count("효장") + .3 * Number(u.traits.has("소탕")),
        defenseAura: common + .3 * count("신장") + .15 * count("강장") + .3 * Number(u.traits.has("견수"))
      };
    }

    function panel(p, form, extraFriends = 0) {
      const field = !siege.has(form),
        coeff = formations[form],
        u = units.get(p.id);
      const base = p.base * (1 + .1 * (p.friends + extraFriends));
      return {
        id: p.id,
        form,
        attack: Math.floor(base * coeff[0] * (1 + Math.min(.5, p.cheer + (field ? p.attackAura : 0)))),
        defense: 1 + Math.floor(base * coeff[1] * (1 + Math.min(.5, p.cheer + (field ? p.defenseAura : 0)))),
        exposed: u.war < 70 && !p.guard && melee.has(form),
        frontline: !u.dedicated && (u.war >= 70 || p.guard) && front.has(form)
      };
    }

    function evaluate(ids, support, forms) {
      if (new Set([...ids, ...(support == null ? [] : [support])]).size !== ids.length + (support != null ? 1 :
          0) ||
        ids.length > 5 || ids.length !== forms.length) throw new Error("출진 명단을 확인하세요.");
      const active = support == null ? ids : [...ids, support];
      const rows = ids.map((id, i) => {
        if (!units.get(id)?.forms.includes(forms[i])) throw new Error("보유하지 않은 진형입니다.");
        return panel(profile(id, active), forms[i]);
      });
      const links = [];
      let gradeSum = 0;
      for (let i = 0; i < ids.length; i++)
        for (const b of ids.slice(i + 1)) {
          const a = ids[i],
            r = relation(a, b);
          gradeSum += r.grade + relation(b, a).grade;
          if (r.natural) links.push({ a, b, grade: r.grade, reverseGrade: relation(b, a).grade });
        }
      const joined = new Set(links.flatMap(r => [r.a, r.b]));
      return {
        ids: [...ids],
        support,
        forms: [...forms],
        rows,
        links,
        gradeSum,
        isolated: ids.filter(id => !joined.has(id)),
        ...sumPanels(rows),
        supportLinks: support == null ? [] : ids.filter(id => relation(id, support).natural)
      };
    }

    function sumPanels(rows) {
      return {
        attack: rows.reduce((v, r) => v + r.attack, 0),
        defense: rows.reduce((v, r) => v + r.defense, 0),
        frontCount: rows.filter(r => r.frontline).length,
        exposed: rows.filter(r => r.exposed).map(r => r.id)
      };
    }
    for (const {kind,ids} of decisions) {
      const issue = bondIssue(kind,ids);
      if (issue) throw new Error(issue);
      if (kind === "oath") ids.forEach(id => sworn.add(id));
      else {
        married.set(ids[0],ids[1]);
        married.set(ids[1],ids[0]);
      }
      for (const [i,a] of ids.entries()) for (const b of ids.slice(i+1)) simulated.set(pair(a,b),kind);
      cache.clear();
    }
    function withBond(kind, ids) {
      return api.createFieldModel(data, model, scene, [...decisions,{kind,ids:[...ids]}]);
    }
    return { scene, initial, units, relation, profile, panel, evaluate, sumPanels, married, sworn, formations,
      pair, bondIssue, projectRelation, withBond };
  };
})();
