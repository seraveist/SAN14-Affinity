import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import vm from "node:vm";

const root = resolve("webapp");
const [html, app, dataScript] = await Promise.all([
  readFile(resolve(root, "index.html"), "utf-8"),
  readFile(resolve(root, "app.js"), "utf-8"),
  readFile(resolve(root, "data.js"), "utf-8"),
]);

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(dataScript, sandbox);

const data = sandbox.window.SAN14_DATA;
const requiredIds = [
  "rosterInput",
  "centerInput",
  "maxSize",
  "hopDepth",
  "sampleRoster",
  "showMarriage",
  "showOath",
  "runButton",
  "resultTitle",
  "resultMeta",
  "scoreBadge",
  "warnings",
  "results",
  "officerNames",
  "groupTemplate",
];

const missingIds = requiredIds.filter((id) => !html.includes(`id="${id}"`));
const missingFiles = ["./styles.css", "./data.js", "./app.js"].filter((path) => !html.includes(path));
const positiveEdges = data.edges.filter((edge) => ["☆", "◎", "○"].includes(edge.relation)).length;
const officerCount = Object.keys(data.officers).length;
const names = ["유비", "관우", "장비", "조운", "제갈량", "후씨"];
const missingNames = names.filter((name) => !data.byName[name]);

const result = {
  officerCount,
  positiveEdges,
  missingIds,
  missingFiles,
  missingNames,
  appBytes: app.length,
};

console.log(JSON.stringify(result, null, 2));

if (missingIds.length || missingFiles.length || missingNames.length || officerCount < 1000 || positiveEdges < 4000) {
  process.exitCode = 1;
}
