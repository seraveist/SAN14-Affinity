(() => {
  "use strict";
  const api = globalThis.SAN14;
  api.renderFieldPlan = function(state, model) {
    const { fieldPlan: plan, fieldEngine: engine } = state;
    const { escape, button } = api.ui;
    const name = id => escape(model.displayName(id));
    const list = ids => ids.length ? ids.map(name).join(" · ") : "없음";
    const n = value => value.toLocaleString("ko-KR");
    const labels = ["–", "○", "◎", "☆"];
    const m = plan.metrics;
    const groups = plan.groups.map((group, i) => {
      const bare = engine.evaluate(group.ids, null, group.forms);
      const links = group.links.map(({ a, b, grade, reverseGrade }) => {
        const r = engine.relation(a, b);
        const type = [r.ab || r.ba ? "친애" : "", r.kin ? r.family : "", r.spouse ? "배우자" : "", r.oath ?
          "의형제" : ""
        ].filter(Boolean).join("·");
        const arrow = r.ab && r.ba ? "↔" : r.ab ? "→" : r.ba ? "←" : "·";
        return name(a) + " " + arrow + " " + name(b) + " (" + escape(type) + ", " + labels[grade] + (
          grade !== reverseGrade ? " / " + labels[reverseGrade] : "") + ")";
      });
      const active = group.support == null ? group.ids : [...group.ids, group.support];
      const support = group.support == null ? "없음" : name(group.support) + " (" + [...engine.units.get(
          group.support).traits].filter(t => ["응원", "악주", "보좌", "호위", "신장", "강장", "효장", "간웅"].includes(t))
        .map(escape).join("·") + ")";
      return '<section class="surface field-group"><h3>' + (i + 1) + '집단' + (group.core == null ? "" :
          " · " + name(group.core)) + '</h3>' +
        '<p><strong>주력</strong> ' + (group.rows.map(r => button(model.displayName(r.id), "officer", r.id,
          "text") + " (" + escape(r.form) + ")").join(" · ") || "없음") + '</p>' +
        '<p><strong>별도 지원</strong> ' + support + ' · 주력 공군 +' + n(group.attack - bare.attack) + ' / 방어 +' +
        n(group.defense - bare.defense) + '</p>' +
        '<p><strong>예비</strong> ' + list(group.reserve) + '</p><details><summary>관계와 진형 근거</summary>' +
        '<p>주력 직접 관계 ' + links.length + '쌍 · ' + (links.join(", ") || "없음") +
        '</p><p>주력 내 직접 관계가 없는 장수 · ' + list(group.isolated) + '</p>' +
        '<p>지원과 직접 관계가 있는 주력 · ' + list(group.supportLinks) + '</p><p>보좌 제공자 · ' + list(active.filter(id =>
          engine.units.get(id).traits.has("보좌"))) + ' · 악주 제공자 · ' + list(active.filter(id => engine.units
          .get(id).traits.has("악주"))) + '</p>' +
        '<p>전열 수행 ' + group.frontCount + '명 · 호위 없이 근접 진형을 쓰는 저무력 장수 · ' + list(group.exposed) +
        '</p></details></section>';
    });
    const delta = x => '공군 +' + n(x.attack) + ' / 방어 +' + n(x.defense) + ' · 연계 등급 합 +' + x.gradeGain;
    const alt = plan.affinityAlternative;
    const affinity = alt ?
      '<details class="surface field-group"><summary>친애를 보완한 대안과 비교</summary><p>주력 내 고립 ' + m.isolated +
      ' → ' + alt.metrics.isolated +
      '명 · 최저 공군 ' + n(m.minAttack) + ' → ' + n(alt.metrics.minAttack) + ' · 최저 방어 ' + n(m.minDefense) +
      ' → ' + n(alt.metrics.minDefense) +
      ' · 공군 격차 ' + n(m.attackGap) + ' → ' + n(alt.metrics.attackGap) + ' · 방어 격차 ' + n(m.defenseGap) + ' → ' +
      n(alt.metrics.defenseGap) + '</p>' +
      alt.groups.map((g, i) => '<p>' + (i + 1) + '집단 · ' + g.rows.map(r => name(r.id) + ' (' + escape(r.form) +
        ')').join(' · ') + ' · ' + n(g.attack) + ' / ' + n(g.defense) + '</p>').join('') + '</details>' : '';
    const recommendations = state.fieldRecommendations;
    const alternatives = recommendations ? Object.entries({ local: "집단 내 3인 의형제", bridge: "집단 간 3인 의형제",
        rotation: "예비 교대 후 3인 의형제", marriage: "결혼" }).map(([key, label]) =>
        '<h4>' + label + '</h4>' + (recommendations[key].length ? '<ul>' + recommendations[key].map(r =>
          '<li>' + list(r.ids) + (r.rotation ? ' · ' + name(r.rotation.removed) + ' → ' + name(r.rotation
              .reserve) + ' (' + escape(r.rotation.form) + ') · 교대 자체 공군 ' + n(r.rotation.attack) +
            ' / 방어 ' + n(r.rotation.defense) + ' · 교대 후 중개 ' : ' · 평시 ') + delta(r.local) +
          (r.bridge ? ' · 합류 시 ' + delta(r.potential) : '') + ' · 새 직접 관계를 얻는 고립 주력 ' + list(r.potential
            .rescued) + '</li>').join("") + '</ul>' : '<p>이 배치에서 이득이 있는 후보가 없습니다.</p>')).join("") :
      button("의형제·결혼 후보 계산", "field-mediation");
    return (state.stale ? '<p class="notice">입력이 변경되었습니다. 초안을 다시 만들면 새 조건을 반영합니다.</p>' : '') +
      state.notices.map(t => '<p class="notice">' + escape(t) + '</p>').join("") +
      '<section class="surface field-group"><h2 id="currentTitle" tabindex="-1">편성 알고리즘 v1.0 · ' + api
      .fieldScenarios[plan.scene].name + '</h2>' +
      '<p>최저 공군 <strong>' + n(m.minAttack) + '</strong> · 최저 방어 <strong>' + n(m.minDefense) +
      '</strong> · 집단 간 격차 공군 ' + n(m.attackGap) + ' / 방어 ' + n(m.defenseGap) + '</p>' +
      '<table class="compare-table"><thead><tr><th>집단</th><th>공군</th><th>방어</th><th>주력 관계</th></tr></thead><tbody>' +
      plan.groups.map((g, i) => '<tr><th>' + (i + 1) + '</th><td>' + n(g.attack) + '</td><td>' + n(g.defense) +
        '</td><td>' + g.links.length + '쌍</td></tr>').join("") +
      '</tbody></table><p class="help">장수당 5,000명·사기 100의 육상 야전 추정치입니다. 주력과 지원이 효과 범위에 있고 다른 집단은 독립적으로 출진한다고 가정합니다.</p></section>' +
      groups.join("") + affinity + '<p><strong>미편성</strong> ' + list(plan.unassigned) +
      '</p><section class="surface field-group"><h3>중개 추천</h3>' +
      '<p class="help">평시는 현재 배치, 합류 시는 대상끼리 범위에 들어왔을 때의 증가량입니다. 후보는 각각 별도 대안이며, 연계 등급은 발동률의 백분율이 아닙니다. 중개 자격은 충족한 것으로 보고 확인된 혼인·결의·혈연·혐오를 제외합니다. 혼인 기록은 일부 장수만 확인됐습니다.</p>' +
      (state.stale ? '새 초안을 만들면 중개 후보를 확인할 수 있습니다.' : alternatives) + '</section>';
  };
})();
