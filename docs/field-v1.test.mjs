import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
import "./model.js";
import "./roster.js";
import "./field-model.js";
import "./field-planner.js";
import "./field-mediation.js";
import "./field-comparison.js";

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
const frozenBaseline = JSON.parse(await readFile(new URL("./field-v1-baseline.json",import.meta.url),"utf8"));

function layoutDigest(plan) {
  const groups = plan.groups.map(g => [g.core, g.ids, g.forms, g.support, g.reserve, g.attack, g.defense, g.isolated, g.gradeSum]);
  return createHash("sha256").update(JSON.stringify([groups,plan.unassigned])).digest("hex");
}


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
let mediationCases = 0;

function checkMediation(engine, plan, ids) {
  const saved = JSON.stringify(plan);
  const alternatives = api.fieldMediation(engine,plan);
  for (const key of Object.keys(api.fieldBondSections)) {
    for (const row of alternatives[key]) {
      const {engine: projected,plan: after} = api.previewFieldBond(engine,plan,row);
      checkPlan(after,projected,ids,plan.groups.length);
      const stat = k => after.groups.reduce((sum,g)=>sum+g[k],0);
      for (const axis of ["attack","defense"]) {
        assert.equal(stat(axis),row.local.after[axis]);
        assert.equal(stat(axis)-row.start[axis],(row.rotation?.[axis] || 0)+row.local[axis]);
      }
      for (const axis of ["minAttack","minDefense","attackGap","defenseGap"])
        assert.equal(after.metrics[axis],row.local.after[axis]);
      assert.equal(after.groups.reduce((sum,g)=>sum+g.gradeSum,0)-
        plan.groups.reduce((sum,g)=>sum+g.gradeSum,0),row.local.gradeGain+
        (row.move ? after.groups.reduce((sum,g)=>sum+engine.evaluate(g.ids,g.support,g.forms).gradeSum,0)-
        plan.groups.reduce((sum,g)=>sum+g.gradeSum,0) : 0));
      assert.equal(row.local.rescued.length,row.local.independent.length+row.local.anchored.length);
      assert.equal(row.potential.participants,row.ids.length);
      assert.ok(projected.bondIssue(row.kind,row.ids));
      if (row.kind==="marriage") assert.equal(projected.married.get(row.ids[0]),row.ids[1]);
      for (const a of row.ids) for (const b of row.ids.filter(id=>id!==a)) {
        const expected=engine.projectRelation(engine.relation(a,b),row.kind);
        assert.deepEqual(projected.relation(a,b),expected);
      }
      mediationCases++;
    }
  }
  const set = alternatives.oathSet;
  let combined = {engine,plan};
  const people = set.choices.flatMap(r=>r.ids);
  assert.equal(people.length,new Set(people).size);
  for (const r of set.choices) combined=api.previewFieldBond(combined.engine,combined.plan,r);
  assert.equal(combined.plan.metrics.minAttack,set.after.minAttack);
  assert.equal(combined.plan.metrics.minDefense,set.after.minDefense);
  assert.equal(JSON.stringify(plan),saved);
}

for (const engine of [e, later])
  for (const [faction, ids] of Object.entries({ 유비: liu, 조조: cao, 손권: wu })) {
    for (let count = 1; count <= 4; count++) {
      const plan = api.planField(engine, { ids, groupCount: count });
      checkPlan(plan, engine, ids, count);
      assert.equal(plan.version, frozenBaseline.version);
      assert.equal(layoutDigest(plan), frozenBaseline.layouts[engine.scene+"/"+faction][count-1],
        engine.scene+" "+faction+" "+count+"집단 기준 편성");
      checkMediation(engine, plan, ids);
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

const target = api.fieldMediation(e,liuFour,[147,792]);
const distance = target.marriageBridge[0], transfer = target.marriageMove[0];
assert.deepEqual([distance.local.attack,distance.local.defense,distance.potential.attack,distance.potential.defense],[0,0,76,76]);
assert.deepEqual([transfer.rotation.attack,transfer.rotation.defense,transfer.local.attack,transfer.local.defense],[-66,-87,76,76]);
assert.deepEqual([transfer.local.after.minAttack,transfer.local.after.minDefense],[4044,3299]);
const marriagePreview=api.previewFieldBond(e,liuFour,transfer);
const second=api.fieldMediation(marriagePreview.engine,marriagePreview.plan,[792]);
assert.ok(Object.keys(api.fieldBondSections).filter(k=>k.startsWith("marriage")).every(k=>!second[k].length));
assert.equal(e.married.has(792),false);
assert.ok(later.bondIssue("marriage",[440,792]).includes("황월영"));
assert.ok(e.bondIssue("oath",[442,344]));
assert.ok(e.bondIssue("oath",[442,344,344]));
assert.ok(e.bondIssue("marriage",[952,147]));
assert.ok(e.bondIssue("oath",[521,518,442]).includes("혈족"));
assert.ok(e.bondIssue("marriage",[3,769]));
assert.equal(e.bondIssue("marriage",[147,792]),"");
assert.equal(e.bondIssue("oath",[163,792,120]),"");
const withMarriage=e.withBond("marriage",[147,792]);
assert.equal(withMarriage.married.get(792),147);
assert.ok(withMarriage.sworn.has(147));
assert.throws(()=>withMarriage.withBond("marriage",[521,792]));
const existing=e.withBond("marriage",[952,163]);
assert.equal(existing.profile(952,[952,163]).friends,e.profile(952,[952,163]).friends);
const preferred=api.fieldMediation(later,caoFour).local[0];
assert.deepEqual(preferred.potential.independent,preferred.potential.rescued);
assert.equal(preferred.potential.independent.length,3);
const twoMains=e.evaluate([521,709],124,["어린",e.units.get(709).field[0]]);
assert.equal(e.bondIssue("oath",[521,709,124]),"");
assert.equal(api.fieldMediation(e,{groups:[{...twoMains,reserve:[]}],reference:{attack:1000,defense:1000}}).local.length,0);
const aid=e.withBond("oath",[241,442,344]);
assert.equal(aid.profile(442,[241,442]).friends,e.profile(442,[241,442]).friends);
assert.equal(aid.profile(241,[241,442]).friends,e.profile(241,[241,442]).friends+1);
assert.equal(aid.relation(442,344).grade,3);
console.log("중개 미리보기와 적용 일치",mediationCases,"건 · 동시 의형제·중복 혼인·범위·응원 재배치 검증 통과");

for (const engine of [e, later]) {
  for (const [faction, ids] of Object.entries({유비:liu,조조:cao,손권:wu})) {
    const current = cached.get(faction+engine.scene);
    const rows = [...api.compareFieldCounts(engine,current)];
    assert.deepEqual(rows.map(r=>r.count),[1,2,3,4]);
    assert.equal(rows[3].plan,current);
    for (const {count,plan} of rows) {
      assert.equal(layoutDigest(plan),frozenBaseline.layouts[engine.scene+"/"+faction][count-1]);
      if (plan.affinityAlternative) checkPlan(plan.affinityAlternative,engine,ids,count);
    }
  }
}
const pinnedCounts = [...api.compareFieldCounts(e,fixed)];
assert.ok(pinnedCounts.slice(0,2).every(row=>!row.plan && row.reason.includes("고정 코어")));
assert.deepEqual(pinnedCounts[3].plan.groups.slice(0,3).map(g=>g.core),[952,147,656]);
assert.deepEqual(pinnedCounts[3].plan.fixedCoreIds,[952,147,656]);
const smallCounts = [...api.compareFieldCounts(e,single)];
assert.ok(smallCounts.slice(1).every(row=>!row.plan && row.reason.includes("보유 장수")));
const fiveCores = api.planField(e,{ids:liu,groupCount:5,fixedCoreIds:[952,147,656,596,440]});
const extended = [...api.compareFieldCounts(e,fiveCores)];
assert.deepEqual(extended.filter(r=>r.plan).map(r=>r.count),[5,6,7,8]);
const rebalanced = [...api.compareFieldCounts(marriagePreview.engine,marriagePreview.plan)];
assert.strictEqual(rebalanced[3].plan,marriagePreview.plan);
assert.deepEqual(rebalanced[1].plan,api.planField(marriagePreview.engine,{ids:liu,groupCount:2}));
assert.equal(marriagePreview.engine.married.get(792),147);
assert.throws(()=>[...api.compareFieldCounts(later,liuFour)]);
const text = api.fieldPlanText(marriagePreview.plan,model.displayName,[{kind:"marriage",ids:[147,792]}]);
for (const phrase of ["v1.0","황건의 난","4집단","4044 / 3299","지원 · 미씨","결혼 가정 · 관우 · 미씨","미편성"]) assert.ok(text.includes(phrase),phrase);
assert.equal(api.fieldAlgorithmVersion,frozenBaseline.version);
console.log("기준 커밋 24개 편성 일치 · 집단 수 비교, 고정 코어, 친애 대안 및 중개 후 재분할 검증 통과");
