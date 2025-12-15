(function () {
  if (window.initColumnManager) return;

  const STYLE_ID = "colmgr-style-v1";
  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .cm-overlay{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(2px);display:none;z-index:9999;align-items:center;justify-content:center;padding:24px}
      .cm-modal{width:min(980px,96vw);max-height:min(88vh,920px);overflow:auto;background:#111827;border:1px solid #1f2937;border-radius:14px;box-shadow:0 20px 80px rgba(0,0,0,.6);color:#e5e7eb}
      .cm-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 10px;border-bottom:1px solid #1f2937}
      .cm-title{font-weight:900;font-size:16px}
      .cm-sub{color:#9ca3af;font-size:13px;margin-top:4px}
      .cm-close{appearance:none;border:1px solid #1f2937;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:800}
      .cm-body{padding:14px 16px 16px}
      .cm-row{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
      .cm-selected-wrap{flex:1;min-width:280px}
      .cm-selected{display:flex;gap:8px;flex-wrap:wrap;padding:12px;border:1px solid #1f2937;border-radius:12px;background:#0f172a}
      .cm-chip{display:inline-flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid #1f2937;border-radius:999px;background:#0b1220;color:#e5e7eb;font-weight:800;font-size:12px;cursor:grab;user-select:none}
      .cm-chip[aria-disabled="true"]{opacity:.7;cursor:default}
      .cm-grip{opacity:.7;letter-spacing:1px}
      .cm-x{appearance:none;border:0;background:transparent;color:#9ca3af;font-weight:900;cursor:pointer;padding:0 2px}
      .cm-x:hover{color:#fff}
      .cm-count{font-weight:900}
      .cm-actions{display:flex;gap:10px;align-items:center}
      .cm-btn{appearance:none;border:1px solid #1f2937;background:#0f172a;color:#e5e7eb;border-radius:10px;padding:8px 10px;cursor:pointer;font-weight:900}
      .cm-btn.primary{background:#2563eb;border-color:#1d4ed8}
      .cm-btn.danger{background:transparent;color:#e5e7eb}
      .cm-groups{margin-top:14px;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
      @media(max-width:900px){.cm-groups{grid-template-columns:1fr}}
      .cm-group{border:1px solid #1f2937;border-radius:12px;background:#0f172a;padding:12px}
      .cm-group h3{margin:0 0 10px;font-size:13px;color:#9ca3af;text-transform:uppercase;letter-spacing:.08em}
      .cm-pills{display:flex;gap:8px;flex-wrap:wrap}
      .cm-pill{appearance:none;border:1px solid #1f2937;background:#0b1220;color:#e5e7eb;border-radius:999px;padding:8px 10px;cursor:pointer;font-weight:900;font-size:12px}
      .cm-pill.on{outline:2px solid rgba(147,197,253,.6);border-color:#2b3b53}
      .cm-pill[disabled]{opacity:.55;cursor:not-allowed}
      .cm-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:14px}
    `;
    document.head.appendChild(style);
  }

  function safeParse(json) {
    try { return JSON.parse(json); } catch { return null; }
  }

  function uniq(arr) {
    const out = [];
    const seen = new Set();
    for (const x of arr) {
      if (seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
    return out;
  }

  function applyColumnsToTable(table, allIds, selectedOrder) {
    const selected = new Set(selectedOrder);
    const finalOrder = [...selectedOrder, ...allIds.filter((id) => !selected.has(id))];

    const headRow = table.querySelector("thead tr");
    if (!headRow) return;
    for (const id of allIds) {
      const th = headRow.querySelector(`th[data-col="${id}"]`);
      if (th) th.style.display = selected.has(id) ? "" : "none";
    }
    for (const id of finalOrder) {
      const th = headRow.querySelector(`th[data-col="${id}"]`);
      if (th) headRow.appendChild(th);
    }

    const bodyRows = Array.from(table.querySelectorAll("tbody tr"));
    for (const tr of bodyRows) {
      for (const id of allIds) {
        const td = tr.querySelector(`td[data-col="${id}"]`);
        if (td) td.style.display = selected.has(id) ? "" : "none";
      }
      for (const id of finalOrder) {
        const td = tr.querySelector(`td[data-col="${id}"]`);
        if (td) tr.appendChild(td);
      }
    }
  }

  function initColumnManager(opts) {
    ensureStyles();
    const {
      table,
      columns,
      storageKey,
      button,
      maxSelected = null,
    } = opts || {};

    if (!table || !columns?.length || !storageKey || !button) return null;

    const allIds = columns.map((c) => c.id);
    const lockedIds = new Set(columns.filter((c) => c.locked).map((c) => c.id));
    const defaults = columns.filter((c) => c.defaultVisible !== false).map((c) => c.id);

    function normalizeSelected(list) {
      const lockedFirst = [...lockedIds].filter((id) => allIds.includes(id));

      const pickedNonLocked = uniq(
        (list || []).filter((id) => allIds.includes(id) && !lockedIds.has(id)),
      );

      const defaultNonLocked = uniq(
        defaults.filter((id) => allIds.includes(id) && !lockedIds.has(id)),
      );

      const nonLocked = (pickedNonLocked.length ? pickedNonLocked : defaultNonLocked)
        .slice(0, maxSelected || 9999);

      return uniq([...lockedFirst, ...nonLocked]);
    }

    function loadSelected() {
      const raw = localStorage.getItem(storageKey);
      const parsed = raw ? safeParse(raw) : null;
      return normalizeSelected(parsed?.selected || parsed);
    }

    function saveSelected(selected) {
      localStorage.setItem(storageKey, JSON.stringify({ selected }));
    }

    let selectedOrder = loadSelected();

    function apply() {
      applyColumnsToTable(table, allIds, selectedOrder);
    }

    // Overlay + modal (single instance per manager)
    const overlay = document.createElement("div");
    overlay.className = "cm-overlay";
    overlay.innerHTML = `
      <div class="cm-modal" role="dialog" aria-modal="true" aria-label="Metrics">
        <div class="cm-head">
          <div>
            <div class="cm-title">Choose metrics</div>
            <div class="cm-sub">Add, hide and reorder columns</div>
          </div>
          <button class="cm-close" type="button">✕</button>
        </div>
        <div class="cm-body">
          <div class="cm-row">
            <div class="cm-selected-wrap">
              <div class="cm-sub"><span class="cm-count" id="cmCount">0</span>${maxSelected ? ` / ${maxSelected}` : ` / ${columns.length}`} selected</div>
              <div class="cm-selected" id="cmSelected"></div>
            </div>
            <div class="cm-actions">
              <button class="cm-btn" type="button" id="cmReset">Reset</button>
            </div>
          </div>

          <div class="cm-groups" id="cmGroups"></div>

          <div class="cm-foot">
            <button class="cm-btn danger" type="button" id="cmCancel">Cancel</button>
            <button class="cm-btn primary" type="button" id="cmApply">Apply changes</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    const modal = overlay.querySelector(".cm-modal");
    const closeBtn = overlay.querySelector(".cm-close");
    const cancelBtn = overlay.querySelector("#cmCancel");
    const applyBtn = overlay.querySelector("#cmApply");
    const resetBtn = overlay.querySelector("#cmReset");
    const selectedEl = overlay.querySelector("#cmSelected");
    const groupsEl = overlay.querySelector("#cmGroups");
    const countEl = overlay.querySelector("#cmCount");

    function open() {
      draft = selectedOrder.slice();
      renderModal();
      overlay.style.display = "flex";
    }

    function close() {
      overlay.style.display = "none";
    }

    function labelOf(id) {
      return columns.find((c) => c.id === id)?.label || id;
    }

    function groupOf(col) {
      return col.group || "Other";
    }

    function isSelected(id) {
      return draft.includes(id);
    }

    function canAddMore() {
      if (!maxSelected) return true;
      return draft.filter((id) => !lockedIds.has(id)).length < maxSelected;
    }

    function toggle(id) {
      if (lockedIds.has(id)) return;
      if (isSelected(id)) {
        draft = draft.filter((x) => x !== id);
        return;
      }
      if (!canAddMore()) return;
      draft.push(id);
    }

    function move(id, toIndex) {
      const from = draft.indexOf(id);
      if (from === -1) return;
      draft.splice(from, 1);
      draft.splice(Math.max(0, Math.min(draft.length, toIndex)), 0, id);
    }

    function renderModal() {
      const selectedCount = draft.filter((id) => !lockedIds.has(id)).length;
      countEl.textContent = String(selectedCount);

      selectedEl.innerHTML = "";
      for (const id of draft) {
        const locked = lockedIds.has(id);
        const chip = document.createElement("div");
        chip.className = "cm-chip";
        chip.draggable = !locked;
        chip.dataset.id = id;
        chip.setAttribute("aria-disabled", locked ? "true" : "false");
        chip.innerHTML = `
          <span class="cm-grip">⋮⋮</span>
          <span>${labelOf(id)}</span>
          ${locked ? "" : `<button class="cm-x" type="button" aria-label="Remove">×</button>`}
        `;
        const x = chip.querySelector(".cm-x");
        if (x) {
          x.addEventListener("click", (e) => {
            e.stopPropagation();
            toggle(id);
            renderModal();
          });
        }
        chip.addEventListener("dragstart", (e) => {
          if (locked) return;
          e.dataTransfer.setData("text/plain", id);
          e.dataTransfer.effectAllowed = "move";
        });
        chip.addEventListener("dragover", (e) => {
          if (locked) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        chip.addEventListener("drop", (e) => {
          e.preventDefault();
          const moving = e.dataTransfer.getData("text/plain");
          if (!moving || lockedIds.has(moving) || moving === id) return;
          move(moving, draft.indexOf(id));
          renderModal();
        });
        selectedEl.appendChild(chip);
      }

      const byGroup = new Map();
      for (const col of columns) {
        const g = groupOf(col);
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push(col);
      }

      groupsEl.innerHTML = "";
      for (const [g, cols] of byGroup.entries()) {
        const box = document.createElement("div");
        box.className = "cm-group";
        box.innerHTML = `<h3>${g}</h3><div class="cm-pills"></div>`;
        const pills = box.querySelector(".cm-pills");
        for (const col of cols) {
          const btn = document.createElement("button");
          btn.className = "cm-pill" + (isSelected(col.id) ? " on" : "");
          btn.type = "button";
          btn.textContent = col.label;
          const disabled = lockedIds.has(col.id) || (!isSelected(col.id) && !canAddMore());
          btn.disabled = disabled;
          btn.addEventListener("click", () => {
            toggle(col.id);
            renderModal();
          });
          pills.appendChild(btn);
        }
        groupsEl.appendChild(box);
      }
    }

    let draft = selectedOrder.slice();

    function reset() {
      localStorage.removeItem(storageKey);
      selectedOrder = loadSelected();
      apply();
    }

    function commit() {
      selectedOrder = normalizeSelected(draft);
      saveSelected(selectedOrder);
      apply();
      close();
    }

    button.addEventListener("click", open);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    cancelBtn.addEventListener("click", close);
    resetBtn.addEventListener("click", () => {
      draft = normalizeSelected([]);
      renderModal();
    });
    applyBtn.addEventListener("click", commit);

    // initial apply
    apply();

    return { apply, getSelected: () => selectedOrder.slice() };
  }

  window.initColumnManager = initColumnManager;
})();
