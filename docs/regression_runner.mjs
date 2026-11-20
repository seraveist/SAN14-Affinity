import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import "./model.js";
import "./roster.js";
import "./planner.js";
import "./recommendations.js";

class FakeClassList {
  add() {}
  remove() {}
  toggle() {}
}

class FakeElement {
  constructor() {
    this.children = [];
    this.classList = new FakeClassList();
    this.dataset = {};
    this.style = {};
    this.value = "";
    this.checked = true;
    this.innerHTML = "";
    this.textContent = "";
    this.options = [];
  }

  appendChild(node) {
    this.children.push(node);
    return node;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener() {}
  remove() {}
  querySelector() {
    return new FakeElement();
  }
  querySelectorAll() {
    return [];
  }
  cloneNode() {
    return new FakeElement();
  }
  setAttribute(name, value) {
    this[name] = value;
  }
}

const args = new Set(process.argv.slice(2));
const outputJson = args.has("--json");
const compare = args.has("--compare");
const appSource = args.has("--app=head") ? "head" : "worktree";
const baseline = "c5ba4fc3eb6f369d0af3aa676056901446485192";

function fakeDocument() {
  const template = new FakeElement();
  template.content = { firstElementChild: new FakeElement() };
  return {
    querySelector(selector) {
      return selector === "#groupTemplate" ? template : new FakeElement();
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return new FakeElement();
    },
    createDocumentFragment() {
      return new FakeElement();
    },
  };
}

async function loadData(source) {
  const dataScript = source === "head"
    ? execFileSync("git", ["show", baseline + ":docs/data.js"], { encoding: "utf8" })
    : await readFile("docs/data.js", "utf8");
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(dataScript, sandbox);
  return sandbox.window.SAN14_DATA;
}

function exposeAppApi(appScript) {
  const replacement = `
  setupGraph();
  window.SAN14_TEST_API = {
    parseNames,
    buildRosterDuplicateState,
    resolveNames,
    planRoster,
    groupMetrics,
    totalScore,
    autoRosterPlanCandidates: typeof autoRosterPlanCandidates === "function" ? autoRosterPlanCandidates : null,
    evaluateAutoRosterPlan: typeof evaluateAutoRosterPlan === "function" ? evaluateAutoRosterPlan : null,
    classifyUnassigned,
    recommendOathSets,
    passesRecommendationFilters,
    displayName,
    formationStats,
    primary
  };
})();`;
  return appScript.replace(/\s+init\(\);\s*\}\)\(\);\s*$/, replacement);
}

async function createApi(source) {
  const data = await loadData(source);
  if (source === "worktree") {
    const model = globalThis.SAN14.createModel(data);
    const roster = globalThis.SAN14.createRoster(model);
    const planner = globalThis.SAN14.createPlanner(model, roster);
    const recommendations = globalThis.SAN14.createRecommendations(model, planner);
    return { ...model, ...roster, ...planner, ...recommendations, passesRecommendationFilters: () => true };
  }
  const appScript = exposeAppApi(execFileSync("git", ["show", baseline + ":docs/app.js"], { encoding: "utf8" }));
  const sandbox = {
    window: { SAN14_DATA: data },
    document: fakeDocument(),
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(appScript, sandbox);
  return sandbox.window.SAN14_TEST_API;
}

function groupSummary(api, group, index) {
  const metrics = api.groupMetrics(group);
  const connections = metrics.linksByOfficer ?? metrics.buff;
  const members = [...group]
    .sort((a, b) => (connections.get(b) || 0) - (connections.get(a) || 0) || api.primary(b) - api.primary(a))
    .map((id) => `${api.displayName(id)}+${connections.get(id) || 0}`);
  const edges = metrics.edges
    .sort((a, b) => b.value - a.value || api.displayName(a.a).localeCompare(api.displayName(b.a), "ko"))
    .slice(0, 10)
    .map((edge) => `${api.displayName(edge.a)} ${edge.label} ${api.displayName(edge.b)}`);

  return {
    index: index + 1,
    score: metrics.score,
    size: group.length,
    members,
    edges,
  };
}

function unassignedSummary(api, unassigned, groups, ids) {
  return api.classifyUnassigned(unassigned, groups, ids).map((section) => {
    if (section.lines) {
      return {
        title: section.title,
        lines: section.lines.map((line) => line.ids.map(api.displayName).join(" + ")),
      };
    }
    return {
      title: section.title,
      members: section.ids.map(api.displayName),
    };
  });
}

function recommendationSummary(api, recommendation) {
  return {
    kind: recommendation.kind === "marriage" ? "결혼(미혼 가정)" : "의형제",
    combo: recommendation.ids.map(api.displayName).join(" + "),
    stability: recommendation.stability
      ? {
          penalty: recommendation.stability.penalty,
          star: recommendation.stability.starBreaks,
          double: recommendation.stability.doubleBreaks,
          core: recommendation.stability.coreBreaks,
        }
      : null,
    change: {
      groups: `${recommendation.baseStats.groupCount}->${recommendation.stats.groupCount}`,
      small: `${recommendation.baseStats.smallCount}->${recommendation.stats.smallCount}`,
      single: `${recommendation.baseStats.singleCount}->${recommendation.stats.singleCount}`,
      unassigned: `${recommendation.baseStats.unassignedCount}->${recommendation.stats.unassignedCount}`,
    },
  };
}

async function runRegression(source) {
  const api = await createApi(source);
  const samples = JSON.parse(await readFile("docs/regression_samples.json", "utf8"));

  return samples.map((sample) => {
    const tokens = api.parseNames(sample.text);
    const duplicateState = api.buildRosterDuplicateState(tokens);
    const resolved = api.resolveNames(tokens, {
      autoAllDuplicateNames: duplicateState.autoAllDuplicateNames,
      duplicateSelections: new Map(),
    });
    const warnings = [...duplicateState.warnings, ...resolved.warnings];
    const options = {
      mode: "count",
      targetCount: sample.groupCount,
      maxSize: sample.maxSize,
      maxGroupCount: sample.maxGroupCount,
      fixedCoreIds: [],
    };
    const plan = api.planRoster(resolved.ids, options);
    const recommendations = api
      .recommendOathSets(resolved.ids, options, plan, 6)
      .filter(api.passesRecommendationFilters)
      .slice(0, 3);

    return {
      key: sample.key,
      name: sample.name,
      algorithm: "v1.4",
      inputCount: tokens.length,
      resolvedCount: resolved.ids.length,
      score: api.totalScore(plan.groups),
      stats: api.formationStats(plan.groups, plan.unassigned),
      warnings,
      groups: plan.groups.map((group, index) => groupSummary(api, group, index)),
      unassigned: unassignedSummary(api, plan.unassigned || [], plan.groups, resolved.ids),
      recommendations: recommendations.map((row) => recommendationSummary(api, row)),
    };
  });
}

function summarize(results) {
  return results
    .map((sample) => {
      const lines = [
        `## ${sample.name}`,
        `총점 ${sample.score} / ${sample.resolvedCount}명 / ${sample.stats.groupCount}집단 / 미편성 ${sample.stats.unassignedCount}명 / ${sample.algorithm}`,
      ];
      if (sample.warnings.length) lines.push(`동명이인: ${sample.warnings.join(" / ")}`);
      for (const group of sample.groups) {
        lines.push(`- ${group.index}집단 score ${group.score}: ${group.members.join(", ")}`);
      }
      if (sample.unassigned.length) {
        lines.push(
          `- 미편성: ${sample.unassigned
            .map((section) => `${section.title} ${section.members ? section.members.join(", ") : section.lines.join(" / ")}`)
            .join(" | ")}`,
        );
      }
      if (sample.recommendations.length) {
        lines.push(
          `- 추천: ${sample.recommendations
            .map((row) => `${row.kind} ${row.combo}`)
            .join(" / ")}`,
        );
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

function summarizeCompare(before, after, beforeLabel = "이전", afterLabel = "현재") {
  const beforeByKey = new Map(before.map((sample) => [sample.key, sample]));
  return after
    .map((sample) => {
      const previous = beforeByKey.get(sample.key);
      const scoreDelta = sample.score - previous.score;
      const unassignedDelta = sample.stats.unassignedCount - previous.stats.unassignedCount;
      const lines = [
        `## ${sample.name}`,
        `${beforeLabel} -> ${afterLabel}`,
        `총점 ${previous.score} -> ${sample.score} (${scoreDelta >= 0 ? "+" : ""}${scoreDelta})`,
        `미편성 ${previous.stats.unassignedCount} -> ${sample.stats.unassignedCount} (${unassignedDelta >= 0 ? "+" : ""}${unassignedDelta})`,
      ];
      for (let index = 0; index < sample.groups.length; index += 1) {
        const prevGroup = previous.groups[index];
        const group = sample.groups[index];
        const beforeMembers = prevGroup ? prevGroup.members.join(", ") : "";
        const afterMembers = group.members.join(", ");
        if (beforeMembers !== afterMembers) {
          lines.push(`- ${group.index}집단 변경: ${beforeMembers || "(없음)"} => ${afterMembers}`);
        }
      }
      return lines.join("\n");
    })
    .join("\n\n");
}

if (compare) {
  const before = await runRegression("head");
  const after = await runRegression("worktree");
  if (outputJson) {
    console.log(JSON.stringify({ before, after }, null, 2));
  } else {
    console.log(summarizeCompare(before, after, baseline.slice(0, 7), "현재"));
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) process.exitCode = 1;
} else {
  const results = await runRegression(appSource);
  if (outputJson) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(summarize(results));
  }
}
