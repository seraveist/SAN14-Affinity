(() => {
  "use strict";
  const api = globalThis.SAN14;

  // Yield one alternative at a time so the UI can stop when the roster or a bond changes.
  api.compareFieldCounts = function* (engine, current) {
    if (engine.scene !== current.scene) throw new Error("현재 편성과 시나리오가 다릅니다.");
    const ids = [...current.unassigned];
    for (const g of current.groups) {
      ids.push(...g.ids, ...g.reserve);
      if (g.support != null) ids.push(g.support);
    }
    const fixed = current.fixedCoreIds ?? [];
    const counts = new Set([1, 2, 3, 4, current.groups.length]);
    if (fixed.length > 4) {
      for (let n = fixed.length; n <= Math.min(10, fixed.length + 3); n++) counts.add(n);
    }
    for (const count of [...counts].sort((a,b) => a-b)) {
      if (count > ids.length) yield {count, reason: "보유 장수 " + ids.length + "명"};
      else if (count < fixed.length) yield {count, reason: "고정 코어 " + fixed.length + "명"};
      else if (count === current.groups.length) yield {count, plan: current};
      else yield {count, plan: api.planField(engine, {ids, groupCount: count, fixedCoreIds: fixed})};
    }
  };

  api.fieldPlanText = function(plan, displayName, bonds = []) {
    const names = ids => ids.length ? ids.map(displayName).join(" · ") : "없음";
    const m = plan.metrics;
    const lines = [
      "편성 알고리즘 v" + plan.version + " · " + api.fieldScenarios[plan.scene].name + " · " + plan.groups.length + "집단",
      "최저 공군 / 방어 " + m.minAttack + " / " + m.minDefense +
        " · 집단 간 격차 " + m.attackGap + " / " + m.defenseGap,
    ];
    if (plan.fixedCoreIds?.length) lines.push("고정 코어 · " + names(plan.fixedCoreIds));
    for (const [i,g] of plan.groups.entries()) {
      lines.push("", (i+1) + "집단 · 공군 " + g.attack + " / 방어 " + g.defense,
        "주력 · " + (g.rows.map(r => displayName(r.id) + " (" + r.form + ")").join(" · ") || "없음"),
        "지원 · " + (g.support == null ? "없음" : displayName(g.support)), "예비 · " + names(g.reserve));
    }
    lines.push("", "미편성 · " + names(plan.unassigned));
    for (const b of bonds) lines.push((b.kind === "oath" ? "의형제 가정 · " : "결혼 가정 · ") + names(b.ids));
    return lines.join("\n");
  };
})();
