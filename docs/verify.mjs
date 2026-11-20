import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "./model.js";
import "./roster.js";
import "./planner.js";
import "./recommendations.js";
import "./campaign.js";
import "./ui.js";

const [html, dataScript, samples] = await Promise.all([
  readFile(new URL("./index.html", import.meta.url), "utf8"),
  readFile(new URL("./data.js", import.meta.url), "utf8"),
  readFile(new URL("./regression_samples.json", import.meta.url), "utf8").then(JSON.parse),
]);
const sandbox = { window: {} };
vm.runInNewContext(dataScript, sandbox);
const data = sandbox.window.SAN14_DATA;
const { SAN14 } = globalThis;
const model = SAN14.createModel(data);
const roster = SAN14.createRoster(model);
const planner = SAN14.createPlanner(model, roster);
const campaign = SAN14.createCampaign(model, planner);

for (const file of [...html.matchAll(/(?:src|href)="\.\/([^"?]+)/g)].map((match) => match[1])) {
  assert.ok((await readFile(new URL("./" + file, import.meta.url))).length, "Missing browser asset " + file);
}
for (const id of ["rosterForm", "rosterInput", "workspace", "dexSearch", "detailDialog"]) {
  assert.ok(html.includes('id="' + id + '"'), "Missing HTML control " + id);
}
assert.equal(model.officers.size, 1000);
assert.equal(data.edges.length, 4721);
assert.equal(Object.keys(data.traitDescriptions).length, 158);
assert.equal([...model.officers.values()].filter((item) => item.eventStats).length, 2);
assert.equal([...model.officers.keys()].filter((id) => model.officerFormationNames(id).length).length, 1000);
assert.equal(data.relationshipEvidence.missing.filter((row) => row.relation !== "X").length, 9);
assert.equal(data.relationshipEvidence.ambiguous.filter((row) => row.relation !== "X").length, 92);
assert.equal(data.relationshipEvidence.conflicts.length, 13);
const ceDirections = Object.entries(data.ceAffinity.outgoing).flatMap(([source, targets]) =>
  targets.map((target) => [Number(source), target]),
);
assert.equal(ceDirections.length, 1577);
assert.ok(ceDirections.every(([source, target]) => source !== target && model.officer(source) && model.officer(target)));
assert.equal(ceDirections.filter(([source, target]) => data.ceAffinity.outgoing[target]?.includes(source)).length / 2, 577);
assert.equal(ceDirections.filter(([source, target]) => !data.ceAffinity.outgoing[target]?.includes(source)).length, 423);
assert.equal(JSON.stringify(data.presets), JSON.stringify(samples));
assert.ok(data.ceTraits.traits["호위"].description.includes("단기접전"));
assert.equal(roster.resolveRoster("없는장수 constructor").ids.length, 0);

const id = (label) => roster.resolveNames([label]).ids[0];
const affinity = (a, b) => model.relationBetween(id(a), id(b));
const ideok = id("이적");
const liubei = id("유비");
const iToLiu = affinity("이적", "유비");
assert.deepEqual(iToLiu.personal, { outgoing: true, incoming: false });
assert.deepEqual(affinity("유비", "이적").personal, { outgoing: false, incoming: true });
assert.deepEqual(affinity("윤묵", "송충").personal, { outgoing: true, incoming: true });
assert.equal(affinity("하후상", "하후덕").personal, null);
assert.equal(affinity("조조", "조창").kinship, "부모·자녀");
assert.equal(affinity("조조", "조창").personal, null);
assert.deepEqual([...model.scenarioAffinityTargets(id("장료"))], [id("악진"), id("이전")]);
assert.match(SAN14.ui.combatRelationText("왕보", affinity("왕보", "관우"), "관우"), /→.*일방 친애.*기존 연계 ☆ \/ ○/);
assert.match(SAN14.ui.combatRelationText("하후상", affinity("하후상", "하후덕"), "하후덕"), /기존 연계 ○/);
assert.equal(model.relationBetween(ideok, ideok), null);
assert.equal(model.relationBetween(ideok, undefined), null);
const ungraded = ceDirections.find(([source, target]) => !data.edges.some((row) =>
  (row.source === source && row.target === target) || (row.source === target && row.target === source),
));
assert.ok(ungraded);
assert.equal(model.relationBetween(...ungraded).gradeValue, 0);
assert.equal(model.groupMetrics(ungraded).quality, 0);
assert.equal(model.groupMetrics(ungraded).edges.length, 1);
const ambiguous = campaign.evidence(id("순욱(2)"), id("순상"));
assert.ok(ambiguous.ambiguous);
assert.equal(ambiguous.relation?.gradeValue ?? 0, 0);
const oneWayMetrics = model.groupMetrics([ideok, liubei]);
assert.deepEqual([...oneWayMetrics.linksByOfficer.values()], [1, 1]);
assert.equal(oneWayMetrics.highGradeCount, 0);
assert.deepEqual([...model.groupMetrics([id("윤묵"), id("송충")]).linksByOfficer.values()], [1, 1]);
const controls = { mode: "count", targetCount: 1, maxSize: 15, fixedCoreIds: [] };
const oneWayGroup = campaign.snapshot({ groups: [[ideok, liubei]] }, controls);
const reversedGroup = campaign.snapshot({ groups: [[liubei, ideok]] }, controls, oneWayGroup.groupKeys);
assert.equal(campaign.compare(oneWayGroup, reversedGroup).updated.length, 0);
const assumedMutual = campaign.compare(oneWayGroup, reversedGroup, oneWayGroup.groups[0]);
assert.equal(assumedMutual.updated[0].previous.gradeValue, 1);
assert.equal(assumedMutual.updated[0].next.gradeValue, 3);
assert.equal(assumedMutual.updated[0].next.virtual, true);
assert.deepEqual(assumedMutual.updated[0].next.personal, { outgoing: false, incoming: true });
assert.equal(assumedMutual.from.linkedCount, assumedMutual.to.linkedCount);
assert.equal(affinity("이적", "유비").gradeValue, 1);
const guan = id("관우");
const zhang = id("장비");
const xiahou = id("하후패");
const rosterPlan = campaign.snapshot(planner.planRoster([guan, zhang, xiahou], controls), controls);
assert.ok(rosterPlan.unassigned.includes(xiahou));
const preview = campaign.move(rosterPlan, xiahou, 0);
assert.equal(preview.unassigned.includes(xiahou), false);
assert.equal(rosterPlan.unassigned.includes(xiahou), true);
assert.deepEqual(campaign.compare(rosterPlan, preview).moves.map((row) => row.id), [xiahou]);
const hypothetical = campaign.compare(rosterPlan, preview, [guan, xiahou]);
assert.ok(hypothetical.added.some((pair) => [pair.a, pair.b].includes(xiahou)));
assert.equal(model.relationBetween(guan, xiahou), null);
const deploy = campaign.deployment(new Map([[guan, "어린"], [zhang, ""], [xiahou, ""]]));
assert.ok(deploy.pairs.some((pair) => pair.supporters.includes(xiahou)));
assert.deepEqual(deploy.roles.get("전열"), [guan]);
const wang = id("왕릉");
const first = campaign.deployment(new Map([[wang, "어린"]]));
const second = campaign.deployment(new Map([[wang, "안행"]]));
assert.ok(first.roles.has("전열") && !first.roles.has("후열"));
assert.ok(second.roles.has("후열") && !second.roles.has("전열"));
const liu = roster.resolveRoster("유비 관우 장비 장포 장포(1)");
assert.ok(liu.ids.includes(id("장포(1)")) && liu.ids.includes(id("장포(2)")));
assert.match(roster.statsLine(id("장포(1)")), /\d/);
console.log("Verified affinity directions and grades, data, ambiguous edges, deployed formations, original data isolation, comparison and duplicate inputs.");
