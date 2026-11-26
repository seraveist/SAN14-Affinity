(() => {
  "use strict";
  const api = globalThis.SAN14;
  function layoutMembers(plan, name) {
    const n = value => value.toLocaleString("ko-KR");
    const {escape} = api.ui;
    const members = plan.groups.map((g,i)=>'<li><strong>'+(i+1)+'집단</strong> · '+
        (g.rows.map(r=>name(r.id)+' ('+escape(r.form)+')').join(' · ') || '주력 없음')+
        '<br>지원 '+(g.support==null?'없음':name(g.support))+' / 예비 '+(g.reserve.map(name).join(' · ') || '없음')+
        ' / 공군 '+n(g.attack)+' · 방어 '+n(g.defense)+'</li>').join("");
    return '<ul>'+members+'</ul><p>미편성 · '+(plan.unassigned.map(name).join(' · ') || '없음')+'</p>';
  }

  function countComparison(state, model) {
    const {button, escape} = api.ui;
    const comparison = state.fieldCountComparison;
    if (!comparison || state.stale) return "";
    const heading = '<h3 tabindex="-1" id="fieldComparisonTitle">집단 수별 편성 비교</h3>';
    const close = button("비교 닫기", "field-compare-close");
    if (comparison.loading) return '<section class="surface field-group">'+heading+
      '<p role="status">같은 명단과 관계로 집단 수별 편성을 계산하고 있습니다.</p>'+close+'</section>';
    const n = value => value.toLocaleString("ko-KR");
    const rows = comparison.rows.map(({count, plan, reason}) => {
      if (!plan) return '<tr><th scope="row">'+count+'집단</th><td colspan="5">'+escape(reason)+' · 구성 불가</td></tr>';
      const m = plan.metrics;
      const primary = plan.groups.reduce((sum,g)=>sum+g.ids.length,0);
      const support = plan.groups.filter(g=>g.support!=null).length;
      return '<tr><th scope="row">'+count+'집단'+(plan===state.fieldPlan?' (현재)':'')+'</th>'+
        '<td>'+primary+' + '+support+'</td><td>'+plan.unassigned.length+'</td>'+
        '<td>'+n(m.minAttack)+' / '+n(m.minDefense)+'</td><td>'+n(m.attackGap)+' / '+n(m.defenseGap)+'</td>'+
        '<td>'+m.isolated+'</td></tr>';
    }).join("");
    const name = id => escape(model.displayName(id));
    const proposals = comparison.rows.filter(row=>row.plan && row.plan!==state.fieldPlan).map(({count,plan})=>{
      return '<details class="details"><summary>'+count+'집단 명단과 적용</summary>'+layoutMembers(plan,name)+
        button(count+"집단 편성 적용","field-count-apply",count)+'</details>';
    }).join("");
    return '<section class="field-group surface">'+heading+'<p class="help">집단 수가 달라지면 동시에 출진하는 인원도 달라집니다. 현재 행은 적용한 배치와 중개 가정을 포함합니다.</p>'+
      '<div class="field-count-scroll" tabindex="0" role="region" aria-label="집단 수별 지표"><table class="compare-table">'+
      '<thead><tr><th>집단 수</th><th>주력 + 지원</th><th>미편성</th><th>최저 공군 / 방어</th>'+
      '<th>공군 / 방어 격차</th><th>고립 주력</th></tr></thead><tbody>'+rows+'</tbody></table></div>'+
      proposals+close+'</section>';
  }

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
    const alt = plan.affinityAlternative;
    const affinity = alt ?
      '<details class="surface field-group"><summary>친애를 보완한 대안과 비교</summary><p>주력 내 고립 ' + m.isolated +
      ' → ' + alt.metrics.isolated +
      '명 · 최저 공군 ' + n(m.minAttack) + ' → ' + n(alt.metrics.minAttack) + ' · 최저 방어 ' + n(m.minDefense) +
      ' → ' + n(alt.metrics.minDefense) +
      ' · 공군 격차 ' + n(m.attackGap) + ' → ' + n(alt.metrics.attackGap) + ' · 방어 격차 ' + n(m.defenseGap) + ' → ' +
      n(alt.metrics.defenseGap) + '</p>' +
      layoutMembers(alt,name) + (state.stale ? '' : button("친애 보완 편성 적용","field-affinity-apply")) + '</details>' : '';
    function mediationView() {
      const rows = state.fieldRecommendations;
      if (!rows) return button("의형제·결혼 후보 계산","field-mediation");
      const focus = state.bondFocus;
      const owned = [...state.activeIds].sort((a,b)=>model.displayName(a).localeCompare(model.displayName(b),"ko") || a-b);
      const signed = v => (v>0?"+":"")+n(v);
      const delta = d => "공군 "+signed(d.attack)+" / 방어 "+signed(d.defense)+" · 전법 등급 합 "+signed(d.gradeGain);
      const marital = id => engine.married.has(id) ? "배우자 "+name(engine.married.get(id)) :
        id===792 ? "미혼 가정" : "초기 혼인 미확인";
      const floors = d => n(d.minAttack)+" / "+n(d.minDefense);
      const selectors = [0,1,2].map(i=>{
        const opts = owned.filter(id=>!focus.includes(id) || focus[i]===id).map(id=>
          '<option value="'+id+'"'+(focus[i]===id?' selected':'')+'>'+name(id)+'</option>').join("");
        return '<label for="bondFilter'+i+'">장수 '+(i+1)+'</label> <select data-bond-filter="'+i+'" id="bondFilter'+i+
          '"><option value="">선택 안 함</option>'+opts+'</select>';
      }).join(" ");
      let exact="";
      if (focus.length>=2) {
        if (focus.length===2 && engine.units.get(focus[0]).gender===engine.units.get(focus[1]).gender)
          exact="<p>두 장수를 포함하는 의형제 후보입니다. 세 번째 장수를 지정할 수 있습니다.</p>";
        else {
          const kind=focus.length===3?"oath":"marriage",issue=engine.bondIssue(kind,focus);
          if (issue) exact='<p>'+escape(issue)+'</p>';
          else {
            const evidence=[];
            for (const [i,a] of focus.entries()) for (const b of focus.slice(i+1)) {
              const forward=engine.relation(a,b), reverse=engine.relation(b,a);
              const symbol=r=>labels[r.grade]+" → "+labels[engine.projectRelation(r,kind).grade];
              evidence.push(name(a)+"·"+name(b)+" · 공방 보정 제공자 수 ("+name(a)+" "+(forward.buff?"유지":"+1")+
                ", "+name(b)+" "+(reverse.buff?"유지":"+1")+") · 전법 등급 정방향 "+symbol(forward)+" / 역방향 "+symbol(reverse));
            }
            exact='<p>'+evidence.join("<br>")+'</p>'+button("현재 위치에서 지정 관계만 가정","field-bond-custom");
          }
        }
      }
      function renderRow(r,key,i) {
        const move = r.move;
        let change="";
        if (move?.type==="primary") change=(move.to+1)+"집단 "+name(move.removed)+" → "+name(move.reserve)+" ("+escape(move.form)+")";
        if (move?.type==="support") {
          const source=plan.groups[move.from];
          const fromRole=source.support===move.reserve?"지원":"예비";
          change=name(move.reserve)+" "+(move.from+1)+"집단 "+fromRole+" → "+(move.to+1)+"집단 지원";
          if (move.removed!=null) change+=" · "+name(move.removed)+" → "+(move.from+1)+"집단 "+fromRole;
        }
        const local = r.local, potential = r.potential;
        const at = r.ids.map(id=>{
          const g = plan.groups.findIndex(x=>x.ids.includes(id)||x.support===id||x.reserve.includes(id));
          return name(id)+" ("+(g+1)+"집단)";
        }).join(" · ");
        const rescue = r.bridge ? potential : local;
        const lower = [local.after.minAttack<r.start.minAttack?"공군":"",local.after.minDefense<r.start.minDefense?"방어":""].filter(Boolean);
        return '<li><strong>'+at+'</strong>'+
          (r.kind==="marriage"?'<p>'+r.ids.map(id=>name(id)+' · '+marital(id)).join(' / ')+'</p>':'')+
          (lower.length?'<p class="notice">기존 편성보다 최저 '+lower.join('·')+'가 낮아지는 대안입니다.</p>':'')+
          (change?'<p>'+change+' · 배치만 변경 시 공군 '+signed(r.rotation.attack)+' / 방어 '+signed(r.rotation.defense)+
            ' · 응원 적용 집단 '+r.coverage[0]+' → '+r.coverage[1]+'</p>':'')+
          '<p>'+(move?'새 배치의 중개 순증':'평시 중개 순증')+' · '+delta(local)+
          (r.bridge?' · 대상 합류 시 중개 순증 · '+delta(potential):'')+'</p>'+
          '<p>최저 공군 / 방어 · 기존 '+floors(r.start)+(move?' → 배치만 '+floors(local.before):'')+
          ' → 중개 후 '+floors(local.after)+' · 고립이 해소되는 주력 '+list(local.rescued)+
          (r.bridge?' · 합류 시 '+list(potential.rescued):'')+'</p>'+
          (r.kind==="oath" && rescue.rescued.length ? '<p>기존 관계망에 합류 · '+list(rescue.anchored)+
            ' / 새 관계망을 구성 · '+list(rescue.independent)+'</p>':'')+
          button(move?"이 배치와 중개를 가정":"이 관계를 가정","field-bond-apply",key+"/"+i)+'</li>';
      }
      const appliedBonds = state.fieldHistory.flatMap(step=>step.choices);
      const lastIsBond = state.fieldHistory.at(-1)?.choices.length;
      const history = appliedBonds.length ? '<p>적용한 가정 · '+appliedBonds.map(b=>
        (b.kind==="oath"?"의형제 ":"결혼 ")+list(b.ids)).join(" / ")+'</p>'+(lastIsBond?button("마지막 가정 취소","field-bond-undo"):'') : '';
      const choices = Object.entries(api.fieldBondSections).filter(([key])=>rows[key].length).map(([key,label])=>
        '<details'+(focus.length || key==="local" || key==="marriage" ? ' open':'')+'><summary>'+label+' ('+rows[key].length+')</summary><ol>'+rows[key].map((r,i)=>renderRow(r,key,i)).join("")+'</ol></details>').join("");
      const set=rows.oathSet;
      const bundle=set?.choices.length>1 ? '<details><summary>여러 집단의 의형제를 한 번에 비교</summary>'+
        '<p>'+set.choices.map(r=>list(r.ids)).join(' / ')+' · 중개 '+set.choices.length+'회</p>'+
        '<p>고립이 해소되는 주력 · '+list(set.rescued)+' · 최저 공군 / 방어 '+floors(m)+' → '+floors(set.after)+'</p>'+
        button("이 의형제 조합을 함께 가정","field-bond-set")+'</details>' : '';
      return history+bundle+'<details'+(focus.length?' open':'')+'><summary>특정 장수로 중개 검토</summary><p>'+selectors+'</p>'+
        exact+'</details>'+(choices || '<p>이 조건에서 새 공방·전법 연결을 얻는 후보가 없습니다.</p>');
    }
    return (state.stale ? '<p class="notice">입력이 변경되었습니다. 초안을 다시 만들면 새 조건을 반영합니다.</p>' : '') +
      state.notices.map(t => '<p class="notice">' + escape(t) + '</p>').join("") +
      '<section class="surface field-group"><h2 id="currentTitle" tabindex="-1">편성 알고리즘 v' + escape(plan.version) + ' · ' + api
      .fieldScenarios[plan.scene].name + '</h2>' +
      '<p>최저 공군 <strong>' + n(m.minAttack) + '</strong> · 최저 방어 <strong>' + n(m.minDefense) +
      '</strong> · 집단 간 격차 공군 ' + n(m.attackGap) + ' / 방어 ' + n(m.defenseGap) + '</p>' +
      '<table class="compare-table"><thead><tr><th>집단</th><th>공군</th><th>방어</th><th>주력 관계</th></tr></thead><tbody>' +
      plan.groups.map((g, i) => '<tr><th>' + (i + 1) + '</th><td>' + n(g.attack) + '</td><td>' + n(g.defense) +
        '</td><td>' + g.links.length + '쌍</td></tr>').join("") +
      '</tbody></table><p class="help">장수당 5,000명·사기 100의 육상 야전 추정치입니다. 주력과 지원이 효과 범위에 있고 다른 집단은 독립적으로 출진한다고 가정합니다.</p><div class="form-actions">' +
      (state.stale || state.fieldCountComparison ? '' : button("집단 수 비교","field-compare-counts")) +
      button("편성표 복사","copy-field-plan") +
      (!state.stale && state.fieldHistory.length ? button("직전 변경 취소","field-layout-undo") : '') +
      '</div></section>' + countComparison(state,model) +
      groups.join("") + affinity + '<p><strong>미편성</strong> ' + list(plan.unassigned) +
      '</p><section class="surface field-group"><h3 id="mediationTitle" tabindex="-1">중개 추천</h3>' +
      '<p class="help">평시는 각 집단의 독립 출진, 합류는 대상끼리 같은 군단·정상 상태로 서로 범위에 들어온 경우입니다. 등급 합은 양방향 순서 지표입니다. 중개 자격은 충족으로 가정하며 초기 혼인·결의 기록은 일부만 확인됐습니다. 선택한 가정은 현재 초안에 적용됩니다.</p>' +
      (state.stale ? '새 초안을 만들면 중개 후보를 확인할 수 있습니다.' : mediationView()) + '</section>';
  };
})();
