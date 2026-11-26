import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "./model.js";
import "./roster.js";
import "./field-model.js";
import "./field-planner.js";
import "./field-mediation.js";

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL("./data.js", import.meta.url), "utf8"), sandbox);
const data = sandbox.window.SAN14_DATA,
  api = globalThis.SAN14;
const model = api.createModel(data),
  roster = api.createRoster(model);
const names = text => Array.from(roster.resolveRoster(text).ids);
const liu = names("유비 관우 장비 조운 제갈량 황충 위연 서서 방통 법정 이엄 엄안 관평 진도 요화 주창 감씨 미씨 마초 마대 마운록 오의 관흥 하후씨 강유");
const cao = names("조조 조인 하후돈 하후연 하후상 #393 순유 곽가 변씨 조비 조창 #16 장료 이전 악진 서황 장합 사마의 가후 전위 허저 등애 학소 #111 조진");
const wu = names(data.presets.find(x => x.key === "sun").text.replace("노숙", "#997").replace("장소", "#631").replace(
  "주태", "#373"));
assert.deepEqual([liu.length, cao.length, wu.length], [25, 25, 32]);
const e = api.createFieldModel(data, model, "01"),
  later = api.createFieldModel(data, model, "06");
const cached = new Map();

function checkPlan(plan, engine, owned, count) {
  assert.equal(plan.version, "1.0");
  assert.equal(plan.groups.length, count);
  const used = [...plan.unassigned];
  for (const g of plan.groups) {
    const active = g.support == null ? g.ids : [...g.ids, g.support];
    assert.ok(g.ids.length <= 5 && g.reserve.length <= 5 && active.length + g.reserve.length <= 10);
    if (g.support != null) assert.ok(engine.units.get(g.support).canSupport);
    assert.ok(g.core == null || g.ids.includes(g.core));
    used.push(...active, ...g.reserve);
    const again = engine.evaluate(g.ids, g.support, g.forms);
    assert.equal(again.attack, g.attack);
    assert.equal(again.defense, g.defense);
    assert.ok(g.links.every(r => g.ids.includes(r.a) && g.ids.includes(r.b)));
    assert.equal(g.frontCount, g.rows.filter(r => r.frontline).length);
  }
  assert.deepEqual(used.sort((a, b) => a - b), [...owned].sort((a, b) => a - b));
  assert.deepEqual(plan.metrics, api.fieldSummary(plan.groups, plan.reference));
  if (plan.affinityAlternative) {
    assert.ok(plan.affinityAlternative.metrics.isolated < plan.metrics.isolated);
    assert.deepEqual(plan.affinityAlternative.groups.flatMap(g => g.ids).sort((a, b) => a - b),
      plan.groups.flatMap(g => g.ids).sort((a, b) => a - b));
  }
}
for (const engine of [e, later])
  for (const [faction, ids] of Object.entries({ 유비: liu, 조조: cao, 손권: wu })) {
    for (let count = 1; count <= 4; count++) {
      const plan = api.planField(engine, { ids, groupCount: count });
      checkPlan(plan, engine, ids, count);
      assert.equal(plan.groups.flatMap(g => g.ids).length, 5 * count);
      assert.equal(plan.metrics.unsafe, 0);
      if (count === 4) {
        cached.set(faction + engine.scene, plan);
        const m = plan.metrics;
        console.log(engine.scene, faction, "4집단 · 최저 공군/방어", m.minAttack, m.minDefense, "격차", m.attackGap, m
          .defenseGap);
      }
    }
  }
const sum = g => [g.attack, g.defense];
const main = [988, 902, 179, 412, 389],
  forms = ["어린", "어린", "봉시", "어린", "방원"];
assert.deepEqual(sum(e.evaluate(main, null, forms)), [3685, 3738]);
assert.deepEqual(sum(e.evaluate(main, 558, forms)), [4131, 4188]);
assert.equal(e.evaluate([558], null, ["방원"]).frontCount, 0);
assert.ok(e.panel(e.profile(902, [902]), "어린").exposed);
assert.ok(!e.panel(e.profile(902, [902, 373]), "어린").exposed);
assert.ok(e.profile(988, [988, 379]).music);
assert.ok(!e.profile(988, [988]).music);
assert.equal(e.relation(442, 241).natural, false);
assert.equal(e.relation(442, 241).buff, true);
assert.equal(e.relation(241, 442).buff, false);
assert.equal(e.profile(952, [952, 147]).friends, 1);
assert.equal(e.relation(952, 147).grade, 3);
assert.ok(e.relation(557, 586).natural && e.relation(988, 902).natural);
assert.equal(e.relation(102, 663).ab, false);
assert.equal(later.relation(102, 663).ab, true);
assert.equal(e.married.get(792), undefined);
assert.equal(later.married.get(656), 120);
assert.equal(later.married.get(440), 249);
assert.ok(!e.married.has(656));
assert.ok(!e.sworn.has(557) && later.sworn.has(557));
assert.equal(e.units.get(120).cheer, false);
assert.throws(() => e.evaluate([952, 952], null, ["어린", "어린"]));
assert.throws(() => e.evaluate([558], null, ["봉시"]));
assert.throws(() => api.planField(e, { ids: [12345], groupCount: 1 }));
assert.deepEqual(api.planField(e, { ids: [...wu].reverse(), groupCount: 4 }), cached.get("손권01"));
assert.equal(api.planField(e, { ids: wu, groupCount: "auto" }).groups.length, 4);
const fixed = api.planField(e, { ids: liu, groupCount: 2, fixedCoreIds: [952, 147, 656] });
assert.deepEqual(fixed.groups.map(g => g.core), [952, 147, 656]);
const tiny = api.planField(e, { ids: [792], groupCount: 1 });
checkPlan(tiny, e, [792], 1);
assert.deepEqual(sum(tiny.groups[0]), [0, 0]);
const single = api.planField(e, { ids: [952], groupCount: 4 });
checkPlan(single, e, [952], 1);
const sun = cached.get("손권01");
assert.equal(new Set(sun.groups.map(g => g.support)).size, 4);
assert.ok(sun.groups.every(g => e.units.get(g.support).cheer));
const joined = (groups, a, b) => groups.some(g => g.ids.includes(a) && g.ids.includes(b));
const choices = [sun.groups, sun.affinityAlternative?.groups].filter(Boolean);
assert.ok(choices.some(groups => joined(groups, 557, 586) && joined(groups, 988, 902)));
const liuFour = cached.get("유비01");
assert.ok(liuFour.groups.some(g => g.support === 241));
assert.ok(liuFour.groups.some(g => g.support === 163) && liuFour.groups.some(g => g.support === 792));
const caoFour = cached.get("조조06");
const before = JSON.stringify(caoFour);
const rec = api.fieldMediation(later, caoFour);
assert.equal(JSON.stringify(caoFour), before);
for (const kind of ["local", "bridge", "rotation"]) {
  assert.ok(rec[kind].length);
  for (const candidate of rec[kind]) {
    assert.equal(new Set(candidate.ids).size, 3);
    assert.equal(candidate.potential.participants, 3);
    assert.ok(candidate.ids.every(id => !later.sworn.has(id)));
    if (kind === "bridge") assert.ok(candidate.potential.attack >= candidate.local.attack);
    if (kind === "rotation") assert.ok(caoFour.groups.some(g => g.reserve.includes(candidate.rotation.reserve) && g
      .ids.includes(candidate.rotation.removed)));
  }
}
assert.ok(!api.fieldMediation(e, liuFour).marriage.some(c => c.ids.includes(816)));
const split = main.slice(0, 3).map((id, i) => e.evaluate([id], null, [forms[i]]));
const separate = api.fieldMediation(e, { groups: split.map(g => ({ ...g, reserve: [] })),
  reference: { attack: 1000, defense: 1000 } });
assert.ok(separate.bridge.some(r => r.local.attack === 0 && r.local.defense === 0 && r.potential.attack > 0));
const pair = e.evaluate([147], 792, ["어린"]);
const marriage = api.fieldMediation(e, { groups: [{ ...pair, core: 147, reserve: [] }], reference: { attack: 1000,
    defense: 1000 } });
assert.deepEqual(marriage.marriage[0].ids, [147, 792]);
const mock = (attack, defense) => ({ attack, defense, ids: [1, 2], exposed: [], frontCount: 2, isolated: [],
  links: [], gradeSum: 0 });
const ref = { attack: 100, defense: 100 },
  baseline = [mock(100, 100), mock(160, 160)];
assert.equal(api.preferFieldPlan([mock(100, 100), mock(140, 140)], baseline, ref), false);
assert.ok(api.preferFieldPlan([mock(110, 105), mock(151, 150)], baseline, ref));
assert.ok(!api.preferFieldPlan([mock(90, 125), mock(170, 170)], baseline, ref));
console.log("24개 분할 사례와 정원·재현성·공방·호위·범위 지원·시나리오·중개 회귀 검증 통과");
