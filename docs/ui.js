(() => {
  "use strict";
  const SAN14 = globalThis.SAN14 ??= {};
  const entities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => entities[char]);
  const relationGuide = "화살표는 CE에서 개인적으로 친애하는 상대를 가리킵니다. 연계 등급은 기존 편성 자료에서 가져왔습니다.";
  const number = new Intl.NumberFormat("ko-KR");
  const classes = {
    neutral: "button small",
    primary: "button primary",
    quiet: "button quiet small",
    text: "text-button",
  };

  function button(label, action, value = "", tone = "neutral", attributes = "") {
    return `<button type="button" class="${classes[tone]}" data-action="${action}" data-value="${escape(value)}" ${attributes}>${escape(label)}</button>`;
  }

  function badge(label, tone = "") {
    return `<span class="badge ${tone}">${escape(label)}</span>`;
  }

  function relationSymbol({ outgoing, incoming }) {
    const arrow = outgoing && incoming ? "↔" : outgoing ? "→" : "←";
    const labels = { "↔": "서로 친애", "→": "앞 장수가 뒤 장수를 친애", "←": "뒤 장수가 앞 장수를 친애" };
    return `<span class="relation-symbol"><span aria-hidden="true">${arrow}</span><span class="visually-hidden">${labels[arrow]}</span></span>`;
  }

  function personalAffinityText(nameA, personal, nameB) {
    const kind = personal.outgoing && personal.incoming ? "쌍방 친애" : "일방 친애";
    return `${escape(nameA)} ${relationSymbol(personal)} ${escape(nameB)} ${badge(kind)}`;
  }

  function combatRelationText(nameA, relation, nameB) {
    const names = `${escape(nameA)} · ${escape(nameB)}`;
    if (!relation) return names;
    const title = relation.personal ? personalAffinityText(nameA, relation.personal, nameB) : names;
    const grade = relation.virtual ? "가상 연계 ☆" : relation.gradeValue
      ? "기존 연계 " + relation.grades.join(" / ")
      : "연계 등급 미확인";
    const kinship = relation.kinship ? " " + badge(relation.kinship) : "";
    return `${title}${kinship} ${badge(grade)}`;
  }

  function relationEvidence({ review, inferred }) {
    if (review.length) return review.map((reason) => badge(reason, "attention")).join(" ");
    return inferred ? badge("이름 대조") : "";
  }

  function options(items, selected) {
    return items.map(([value, label]) =>
      `<option value="${escape(value)}"${String(value) === String(selected) ? " selected" : ""}>${escape(label)}</option>`,
    ).join("");
  }

  function banner(message) {
    return `<p class="notice">${escape(message)}</p>`;
  }

  function createFeedback(document) {
    const dialog = document.querySelector("#detailDialog");
    const title = document.querySelector("#dialogTitle");
    const body = document.querySelector("#dialogBody");
    const status = document.querySelector("#status");
    let restoreFocus = null;
    let timer;

    dialog.addEventListener("close", () => {
      if (restoreFocus?.isConnected) restoreFocus.focus();
      else document.querySelector("nav [aria-current]")?.focus();
      restoreFocus = null;
    });
    document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());

    function announce(message) {
      clearTimeout(timer);
      status.textContent = message;
      timer = setTimeout(() => { status.textContent = ""; }, 4300);
    }

    function openDialog(label, content) {
      if (!dialog.open) restoreFocus = document.activeElement;
      title.textContent = label;
      body.innerHTML = content;
      if (!dialog.open) dialog.showModal();
      dialog.scrollTop = 0;
      title.focus();
    }

    async function copy(text, label) {
      try {
        await navigator.clipboard.writeText(text);
        announce(label + " 복사 완료");
      } catch {
        openDialog(label + " 복사", '<label for="copyText">복사할 내용</label><textarea id="copyText" class="copy-field" readonly rows="7" style="resize: none">' + escape(text) + '</textarea>');
        const field = document.querySelector("#copyText");
        field.focus();
        field.select();
      }
    }

    return { announce, openDialog, closeDialog: () => dialog.close(), copy };
  }

  SAN14.ui = { escape, number, button, badge, personalAffinityText, combatRelationText, relationSymbol, relationEvidence, relationGuide, options, banner, createFeedback };
})();
