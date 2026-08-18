(() => {
  "use strict";

  const STORAGE_KEY = "room-planner-data-v1";
  const DEFAULT_ROWS = 12;
  const DEFAULT_COLS = 16;
  const CELL_TYPES = new Set(["table", "chair", "teacher"]);
  const TOOLS = new Set(["select", "table", "chair", "teacher", "erase"]);
  const GENDERS = new Set(["M", "F"]);

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));

  let state = loadState();
  let activeTool = "select";
  let selectedStudent = null;
  let isPointerDown = false;
  let editingClassId = null;
  let editingChairKey = null;

  const els = {
    saveStatus: $("#saveStatus"),
    roomList: $("#roomList"),
    classList: $("#classList"),
    roomName: $("#roomName"),
    gridRows: $("#gridRows"),
    gridCols: $("#gridCols"),
    roomGrid: $("#roomGrid"),
    activeClassSelect: $("#activeClassSelect"),
    studentPicker: $("#studentPicker"),
    studentCount: $("#studentCount"),
    assignmentMessage: $("#assignmentMessage"),
    classDialog: $("#classDialog"),
    classDialogTitle: $("#classDialogTitle"),
    classForm: $("#classForm"),
    classNameInput: $("#classNameInput"),
    studentNamesInput: $("#studentNamesInput"),
    studentGenderList: $("#studentGenderList"),
    alternateGenderInput: $("#alternateGenderInput"),
    mustNextRules: $("#mustNextRules"),
    mustTableGroups: $("#mustTableGroups"),
    nextRules: $("#nextRules"),
    notTableGroups: $("#notTableGroups"),
    deleteClassBtn: $("#deleteClassBtn"),
    ruleTemplate: $("#ruleTemplate"),
    chairDialog: $("#chairDialog"),
    chairForm: $("#chairForm"),
    chairColorInput: $("#chairColorInput"),
    chairExcludedInput: $("#chairExcludedInput"),
    chairAlwaysFilledInput: $("#chairAlwaysFilledInput"),
    chairFixedStudentSelect: $("#chairFixedStudentSelect"),
    chairOptionsMessage: $("#chairOptionsMessage")
  };

  function newRoom(name = "New room") {
    return {
      id: uid(),
      name,
      rows: DEFAULT_ROWS,
      cols: DEFAULT_COLS,
      cells: {},
      classSeatProfiles: {},
      activeClassId: null
    };
  }

  function newClass(name = "New class") {
    return {
      id: uid(),
      name,
      students: [],
      studentGenders: {},
      alternateGender: false,
      mustNextRules: [],
      mustTableGroups: [],
      nextRules: [],
      notTableGroups: []
    };
  }

  function defaultState() {
    const room = newRoom("Room 1");
    return { rooms: [room], classes: [], activeRoomId: room.id };
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (parsed && Array.isArray(parsed.rooms) && Array.isArray(parsed.classes) && parsed.rooms.length) {
        parsed.rooms.forEach(normalizeRoom);
        parsed.classes.forEach(normalizeClass);
        if (!parsed.rooms.some((room) => room.id === parsed.activeRoomId)) parsed.activeRoomId = parsed.rooms[0].id;
        return parsed;
      }
    } catch (error) {
      console.warn("Could not load saved planner data", error);
    }
    return defaultState();
  }

  function normalizeRoom(room) {
    room.rows = clamp(Number(room.rows) || DEFAULT_ROWS, 4, 30);
    room.cols = clamp(Number(room.cols) || DEFAULT_COLS, 4, 40);
    room.cells = room.cells && typeof room.cells === "object" ? room.cells : {};
    room.classSeatProfiles = room.classSeatProfiles && typeof room.classSeatProfiles === "object" ? room.classSeatProfiles : {};
    room.activeClassId = room.activeClassId || null;

    const legacyProfileKey = room.activeClassId || "__none__";
    const legacyProfile = ensureSeatProfile(room, legacyProfileKey);
    if (room.assignments && !Object.keys(legacyProfile.assignments).length) {
      legacyProfile.assignments = room.assignments;
    }
    delete room.assignments;
    Object.entries(room.cells).forEach(([key, cell]) => {
      if (!cell || !CELL_TYPES.has(cell.type)) {
        delete room.cells[key];
        return;
      }
      if (cell.type !== "chair") return;
      const legacySettings = {};
      ["color", "excluded", "alwaysFilled", "fixedStudent"].forEach((property) => {
        if (cell[property] !== undefined && cell[property] !== null && cell[property] !== false) legacySettings[property] = cell[property];
        delete cell[property];
      });
      if (Object.keys(legacySettings).length && !legacyProfile.chairSettings[key]) legacyProfile.chairSettings[key] = legacySettings;
    });
  }

  function normalizeClass(classPreset) {
    const rawStudents = Array.isArray(classPreset.students) ? classPreset.students : [];
    const incomingGenders = classPreset.studentGenders && typeof classPreset.studentGenders === "object"
      ? classPreset.studentGenders
      : {};
    const students = [];
    const studentGenders = {};

    rawStudents.forEach((student) => {
      const rawName = typeof student === "string" ? student.trim() : String(student?.name || "").trim();
      const parsed = parseStudentLine(rawName);
      const name = parsed.name;
      if (!name || students.includes(name)) return;
      const rawGender = typeof student === "string"
        ? incomingGenders[name] || incomingGenders[rawName] || parsed.gender
        : student.gender || incomingGenders[name];
      const gender = normalizeGender(rawGender);
      students.push(name);
      if (gender) studentGenders[name] = gender;
    });

    Object.entries(incomingGenders).forEach(([student, gender]) => {
      const parsed = parseStudentLine(student);
      if (students.includes(parsed.name) && normalizeGender(gender)) studentGenders[parsed.name] = normalizeGender(gender);
    });

    classPreset.students = students;
    classPreset.studentGenders = studentGenders;
    classPreset.alternateGender = Boolean(classPreset.alternateGender);
    classPreset.mustNextRules = Array.isArray(classPreset.mustNextRules) ? classPreset.mustNextRules : [];
    classPreset.mustTableGroups = Array.isArray(classPreset.mustTableGroups) ? classPreset.mustTableGroups : [];
    classPreset.nextRules = Array.isArray(classPreset.nextRules) ? classPreset.nextRules : [];
    classPreset.notTableGroups = Array.isArray(classPreset.notTableGroups)
      ? classPreset.notTableGroups
      : Array.isArray(classPreset.tableRules)
        ? classPreset.tableRules.map((rule) => [...rule])
        : [];
  }

  function parseStudentLine(line) {
    const value = String(line || "").trim();
    const parsed = value.match(/^(.*?)\s*(?:[,;]\s*|\s+-\s+|\(([mMfF])\)\s*$)([mMfF])?$/);
    if (!parsed) return { name: value, gender: "" };
    const gender = normalizeGender(parsed[2] || parsed[3]);
    const name = parsed[1].trim();
    return name && gender ? { name, gender } : { name: value, gender: "" };
  }

  function normalizeGender(gender) {
    const value = String(gender || "").trim().toUpperCase();
    return GENDERS.has(value) ? value : "";
  }

  function studentGender(classPreset, student) {
    return normalizeGender(classPreset?.studentGenders?.[student]);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function activeRoom() {
    return state.rooms.find((room) => room.id === state.activeRoomId) || state.rooms[0];
  }

  function activeClass() {
    const room = activeRoom();
    return state.classes.find((item) => item.id === room.activeClassId) || null;
  }

  function ensureSeatProfile(room, classId = room.activeClassId || "__none__") {
    if (!room.classSeatProfiles) room.classSeatProfiles = {};
    if (!room.classSeatProfiles[classId]) room.classSeatProfiles[classId] = { assignments: {}, chairSettings: {} };
    const profile = room.classSeatProfiles[classId];
    profile.assignments = profile.assignments && typeof profile.assignments === "object" ? profile.assignments : {};
    profile.chairSettings = profile.chairSettings && typeof profile.chairSettings === "object" ? profile.chairSettings : {};
    return profile;
  }

  function activeSeatProfile(room = activeRoom()) {
    return ensureSeatProfile(room);
  }

  function activeAssignments(room = activeRoom()) {
    return activeSeatProfile(room).assignments;
  }

  function seatSettings(room, key) {
    return activeSeatProfile(room).chairSettings[key] || {};
  }

  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    els.saveStatus.textContent = "Saving…";
    saveTimer = setTimeout(() => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      els.saveStatus.textContent = "Saved locally";
    }, 120);
  }

  function renderAll() {
    renderRoomList();
    renderClassList();
    renderRoomHeader();
    renderClassSelect();
    renderGrid();
    renderStudentPicker();
  }

  function renderRoomList() {
    els.roomList.innerHTML = "";
    state.rooms.forEach((room) => {
      const button = document.createElement("button");
      button.className = `list-item${room.id === state.activeRoomId ? " active" : ""}`;
      const chairCount = Object.values(room.cells).filter((cell) => cell.type === "chair").length;
      button.innerHTML = `
        <span class="list-item-icon">▦</span>
        <span class="list-item-copy"><strong></strong><span>${room.rows} × ${room.cols} · ${chairCount} chairs</span></span>
      `;
      $("strong", button).textContent = room.name;
      button.addEventListener("click", () => {
        state.activeRoomId = room.id;
        selectedStudent = null;
        hideMessage();
        renderAll();
        save();
      });
      els.roomList.append(button);
    });
  }

  function renderClassList() {
    els.classList.innerHTML = "";
    if (!state.classes.length) {
      els.classList.innerHTML = `<div class="empty-state">No class presets yet.<br>Create one to start assigning seats.</div>`;
      return;
    }
    state.classes.forEach((classPreset) => {
      const button = document.createElement("button");
      button.className = "list-item";
      const detail = `${classPreset.students.length} students${classPreset.alternateGender ? " · alternating M/F" : ""}`;
      button.innerHTML = `
        <span class="list-item-icon">≡</span>
        <span class="list-item-copy"><strong></strong><span>${detail}</span></span>
      `;
      $("strong", button).textContent = classPreset.name;
      button.addEventListener("click", () => openClassDialog(classPreset.id));
      els.classList.append(button);
    });
  }

  function renderRoomHeader() {
    const room = activeRoom();
    els.roomName.value = room.name;
    els.gridRows.value = room.rows;
    els.gridCols.value = room.cols;
    $("#deleteRoomBtn").disabled = state.rooms.length === 1;
  }

  function renderClassSelect() {
    const room = activeRoom();
    els.activeClassSelect.innerHTML = `<option value="">No class selected</option>`;
    state.classes.forEach((classPreset) => {
      const option = document.createElement("option");
      option.value = classPreset.id;
      option.textContent = `${classPreset.name} (${classPreset.students.length})`;
      option.selected = classPreset.id === room.activeClassId;
      els.activeClassSelect.append(option);
    });
  }

  function renderGrid() {
    const room = activeRoom();
    const assignments = activeAssignments(room);
    els.roomGrid.style.setProperty("--cols", room.cols);
    els.roomGrid.innerHTML = "";
    const tableLayout = getTableLayout(room);

    for (let row = 0; row < room.rows; row += 1) {
      for (let col = 0; col < room.cols; col += 1) {
        const key = cellKey(row, col);
        const data = room.cells[key];
        const cell = document.createElement("div");
        cell.className = `grid-cell${data ? ` ${data.type}` : ""}`;
        cell.dataset.key = key;
        cell.dataset.row = row;
        cell.dataset.col = col;
        cell.setAttribute("role", "button");
        const assignedStudent = assignments[key];
        cell.setAttribute(
          "aria-label",
          assignedStudent
            ? `${assignedStudent}, chair at row ${row + 1}, column ${col + 1}`
            : data
              ? `${data.type} at row ${row + 1}, column ${col + 1}`
              : `Empty cell at row ${row + 1}, column ${col + 1}`
        );

        if (data?.type === "table") cell.dataset.table = tableLayout.numberForCell[key];
        if (data?.type === "chair") {
          const settings = seatSettings(room, key);
          if (settings.color) {
            cell.style.setProperty("--chair-color", settings.color);
            cell.style.setProperty("--chair-dark", shadeHex(settings.color, -28));
          }
          if (settings.excluded) cell.classList.add("excluded-chair");
          if (settings.alwaysFilled) cell.classList.add("required-chair");
          if (settings.fixedStudent) cell.classList.add("fixed-chair");
          const nearbyTables = tableGroupsNextToChair(key, tableLayout);
          if (nearbyTables.length > 1) {
            cell.classList.add("ambiguous-chair");
            cell.title = "This chair touches more than one table";
          }
          if (settings.excluded || settings.alwaysFilled || settings.fixedStudent) {
            const badge = document.createElement("span");
            badge.className = "chair-badge";
            badge.textContent = settings.excluded ? "×" : settings.fixedStudent ? "P" : "!";
            badge.title = settings.excluded ? "Excluded chair" : settings.fixedStudent ? `Fixed seat: ${settings.fixedStudent}` : "Always filled";
            cell.append(badge);
          }
        }
        if (data?.type === "chair" && assignments[key]) {
          const label = document.createElement("span");
          label.className = "seat-name";
          label.textContent = assignments[key];
          label.title = assignments[key];
          cell.append(label);
        }
        if (data?.type === "chair" && selectedStudent && !seatSettings(room, key).excluded) cell.classList.add("selected-target");

        cell.addEventListener("pointerdown", (event) => {
          if (event.button !== 0) return;
          event.preventDefault();
          isPointerDown = true;
          useToolOnCell(key);
        });
        cell.addEventListener("pointerup", () => { isPointerDown = false; });
        cell.addEventListener("pointerenter", (event) => {
          if (isPointerDown && event.buttons === 1 && activeTool !== "select") useToolOnCell(key);
          if (event.buttons !== 1) isPointerDown = false;
        });
        els.roomGrid.append(cell);
      }
    }
  }

  function renderStudentPicker() {
    const room = activeRoom();
    const classPreset = activeClass();
    const assignments = activeAssignments(room);
    els.studentPicker.innerHTML = "";
    els.studentCount.textContent = classPreset ? classPreset.students.length : "0";

    if (!classPreset) {
      els.studentPicker.innerHTML = `<div class="empty-state">Choose or create a class list.</div>`;
      return;
    }

    const assigned = new Set(Object.values(assignments));
    classPreset.students.forEach((student) => {
      const gender = studentGender(classPreset, student);
      const button = document.createElement("button");
      button.className = `student-chip${student === selectedStudent ? " selected" : ""}${assigned.has(student) ? " assigned" : ""}`;
      const name = document.createElement("span");
      name.className = "student-chip-name";
      name.textContent = student;
      const meta = document.createElement("span");
      meta.className = "student-chip-meta";
      if (gender) {
        const genderPill = document.createElement("span");
        genderPill.className = `gender-pill ${gender.toLowerCase()}`;
        genderPill.textContent = gender;
        genderPill.title = `Gender: ${gender}`;
        meta.append(genderPill);
      }
      if (assigned.has(student)) {
        const check = document.createElement("span");
        check.className = "student-chip-check";
        check.textContent = "✓";
        check.title = "Assigned";
        meta.append(check);
      }
      button.append(name, meta);
      button.addEventListener("click", () => {
        selectedStudent = selectedStudent === student ? null : student;
        setTool("select");
        renderGrid();
        renderStudentPicker();
      });
      els.studentPicker.append(button);
    });
  }

  function getTableLayout(room) {
    const remaining = new Set(Object.keys(room.cells).filter((key) => room.cells[key].type === "table"));
    const groups = [];

    while (remaining.size) {
      const start = [...remaining].sort(compareCellKeys)[0];
      const cells = [];
      const queue = [start];
      remaining.delete(start);
      while (queue.length) {
        const current = queue.shift();
        cells.push(current);
        for (const neighbor of orthogonalNeighbors(current)) {
          if (!remaining.has(neighbor)) continue;
          remaining.delete(neighbor);
          queue.push(neighbor);
        }
      }
      cells.sort(compareCellKeys);
      groups.push({ id: cells[0], cells });
    }

    groups.sort((a, b) => compareCellKeys(a.cells[0], b.cells[0]));
    const groupForCell = {};
    const numberForCell = {};
    groups.forEach((group, index) => {
      group.number = index + 1;
      group.cells.forEach((key) => {
        groupForCell[key] = group.id;
        numberForCell[key] = group.number;
      });
    });
    return { groups, groupForCell, numberForCell };
  }

  function orthogonalNeighbors(key) {
    const [row, col] = parseCellKey(key);
    return [
      cellKey(row - 1, col),
      cellKey(row + 1, col),
      cellKey(row, col - 1),
      cellKey(row, col + 1)
    ];
  }

  function tableGroupsNextToChair(chair, tableLayout) {
    const groups = new Set();
    for (const neighbor of orthogonalNeighbors(chair)) {
      if (tableLayout.groupForCell[neighbor]) groups.add(tableLayout.groupForCell[neighbor]);
    }
    return [...groups];
  }

  function ambiguousChairKeys(room) {
    const tableLayout = getTableLayout(room);
    return Object.keys(room.cells).filter((key) =>
      room.cells[key].type === "chair" && tableGroupsNextToChair(key, tableLayout).length > 1
    );
  }

  function newAmbiguitiesFromPlacement(room, key, type) {
    const before = new Set(ambiguousChairKeys(room));
    const previous = room.cells[key];
    if (type) room.cells[key] = { type };
    else delete room.cells[key];
    const introduced = ambiguousChairKeys(room).filter((chair) => !before.has(chair));
    if (previous) room.cells[key] = previous;
    else delete room.cells[key];
    return introduced;
  }

  function compareCellKeys(a, b) {
    const [ar, ac] = parseCellKey(a);
    const [br, bc] = parseCellKey(b);
    return ar - br || ac - bc;
  }

  function cellKey(row, col) {
    return `${row},${col}`;
  }

  function parseCellKey(key) {
    return key.split(",").map(Number);
  }

  function shadeHex(hex, amount) {
    const value = hex.replace("#", "");
    if (!/^[0-9a-f]{6}$/i.test(value)) return "#365f76";
    const parts = [0, 2, 4].map((start) => clamp(parseInt(value.slice(start, start + 2), 16) + amount, 0, 255));
    return `#${parts.map((part) => part.toString(16).padStart(2, "0")).join("")}`;
  }

  function useToolOnCell(key) {
    const room = activeRoom();
    const existing = room.cells[key];
    const assignments = activeAssignments(room);
    const settings = seatSettings(room, key);

    if (activeTool === "select") {
      if (existing?.type !== "chair") return;
      if (selectedStudent) {
        if (settings.excluded) {
          showMessage("That chair is excluded from student assignments. Change its chair options first.");
          return;
        }
        if (settings.fixedStudent && settings.fixedStudent !== selectedStudent) {
          showMessage(`That chair is fixed for ${settings.fixedStudent}. Change its chair options first.`);
          return;
        }
        for (const [seat, student] of Object.entries(assignments)) {
          if (student === selectedStudent) delete assignments[seat];
        }
        assignments[key] = selectedStudent;
        selectedStudent = null;
      } else {
        openChairDialog(key);
        return;
      }
      hideMessage();
      renderGrid();
      renderStudentPicker();
      save();
      return;
    }

    const nextType = activeTool === "erase" ? null : activeTool;
    if (activeTool === "erase" || TOOLS.has(activeTool)) {
      const introducedAmbiguities = newAmbiguitiesFromPlacement(room, key, nextType);
      if (introducedAmbiguities.length) {
        showMessage(
          activeTool === "chair"
            ? "That chair would touch two separate tables. Place it beside only one table."
            : "That change would leave a chair touching two separate tables. Move the chair first."
        );
        isPointerDown = false;
        return;
      }
    }

    if (activeTool === "erase") {
      delete room.cells[key];
      Object.values(room.classSeatProfiles).forEach((profile) => {
        delete profile.assignments[key];
        delete profile.chairSettings[key];
      });
    } else if (CELL_TYPES.has(activeTool)) {
      room.cells[key] = { type: activeTool };
      if (activeTool !== "chair") {
        Object.values(room.classSeatProfiles).forEach((profile) => {
          delete profile.assignments[key];
          delete profile.chairSettings[key];
        });
      }
    }
    hideMessage();
    renderGrid();
    renderRoomList();
    save();
  }

  function setTool(tool) {
    activeTool = tool;
    $$(".tool").forEach((button) => button.classList.toggle("active", button.dataset.tool === tool));
  }

  function resizeRoom() {
    const room = activeRoom();
    const rows = clamp(Number(els.gridRows.value) || room.rows, 4, 30);
    const cols = clamp(Number(els.gridCols.value) || room.cols, 4, 40);
    room.rows = rows;
    room.cols = cols;

    Object.keys(room.cells).forEach((key) => {
      const [row, col] = parseCellKey(key);
      if (row >= rows || col >= cols) {
        delete room.cells[key];
        Object.values(room.classSeatProfiles).forEach((profile) => {
          delete profile.assignments[key];
          delete profile.chairSettings[key];
        });
      }
    });
    renderAll();
    save();
  }

  function addRoom() {
    const room = newRoom(`Room ${state.rooms.length + 1}`);
    state.rooms.push(room);
    state.activeRoomId = room.id;
    selectedStudent = null;
    renderAll();
    save();
  }

  function duplicateRoom() {
    const source = activeRoom();
    const room = clone(source);
    room.id = uid();
    room.name = `${source.name} copy`;
    state.rooms.push(room);
    state.activeRoomId = room.id;
    renderAll();
    save();
  }

  function deleteRoom() {
    if (state.rooms.length === 1) return;
    const room = activeRoom();
    if (!confirm(`Delete "${room.name}"?`)) return;
    state.rooms = state.rooms.filter((item) => item.id !== room.id);
    state.activeRoomId = state.rooms[0].id;
    selectedStudent = null;
    renderAll();
    save();
  }

  function clearRoom() {
    if (!confirm("Remove every table, chair, desk, and student name from this room?")) return;
    const room = activeRoom();
    room.cells = {};
    room.classSeatProfiles = {};
    renderAll();
    save();
  }

  function clearNames() {
    activeSeatProfile().assignments = {};
    selectedStudent = null;
    hideMessage();
    renderGrid();
    renderStudentPicker();
    save();
  }

  function openChairDialog(key) {
    const room = activeRoom();
    const chair = room.cells[key];
    if (chair?.type !== "chair") return;
    const settings = seatSettings(room, key);
    editingChairKey = key;
    els.chairColorInput.value = settings.color || "#4d7891";
    els.chairExcludedInput.checked = Boolean(settings.excluded);
    els.chairAlwaysFilledInput.checked = Boolean(settings.alwaysFilled || settings.fixedStudent);
    els.chairFixedStudentSelect.innerHTML = `<option value="">No fixed student</option>`;
    const classPreset = activeClass();
    if (classPreset) {
      classPreset.students.forEach((student) => {
        const option = document.createElement("option");
        option.value = student;
        option.textContent = studentOptionLabel(classPreset, student);
        option.selected = settings.fixedStudent === student;
        els.chairFixedStudentSelect.append(option);
      });
    }
    if (settings.fixedStudent && !classPreset?.students.includes(settings.fixedStudent)) {
      const option = document.createElement("option");
      option.value = settings.fixedStudent;
      option.textContent = `${settings.fixedStudent} (not in selected class)`;
      option.selected = true;
      els.chairFixedStudentSelect.append(option);
    }
    els.chairColorInput.disabled = !classPreset;
    els.chairExcludedInput.disabled = !classPreset;
    els.chairFixedStudentSelect.disabled = !classPreset || els.chairExcludedInput.checked;
    els.chairAlwaysFilledInput.disabled = !classPreset || els.chairExcludedInput.checked;
    els.chairOptionsMessage.hidden = Boolean(classPreset);
    els.chairOptionsMessage.textContent = classPreset ? "" : "Choose a class list before fixing this chair to a student.";
    els.chairDialog.showModal();
  }

  function updateChairOptionControls() {
    const hasClass = Boolean(activeClass());
    const excluded = els.chairExcludedInput.checked;
    els.chairColorInput.disabled = !hasClass;
    els.chairExcludedInput.disabled = !hasClass;
    els.chairAlwaysFilledInput.disabled = excluded || !hasClass;
    els.chairFixedStudentSelect.disabled = excluded || !hasClass;
    if (excluded) {
      els.chairAlwaysFilledInput.checked = false;
      els.chairFixedStudentSelect.value = "";
    }
    if (els.chairFixedStudentSelect.value) els.chairAlwaysFilledInput.checked = true;
  }

  function saveChairOptions() {
    const room = activeRoom();
    const chair = room.cells[editingChairKey];
    if (chair?.type !== "chair" || !activeClass()) return;
    const profile = activeSeatProfile(room);
    const settings = {
      color: els.chairColorInput.value === "#4d7891" ? null : els.chairColorInput.value,
      excluded: els.chairExcludedInput.checked,
      fixedStudent: els.chairExcludedInput.checked ? null : els.chairFixedStudentSelect.value || null
    };
    settings.alwaysFilled = settings.excluded ? false : Boolean(els.chairAlwaysFilledInput.checked || settings.fixedStudent);
    if (settings.color || settings.excluded || settings.fixedStudent || settings.alwaysFilled) profile.chairSettings[editingChairKey] = settings;
    else delete profile.chairSettings[editingChairKey];

    if (settings.excluded) delete profile.assignments[editingChairKey];
    if (settings.fixedStudent && activeClass()?.students.includes(settings.fixedStudent)) {
      Object.entries(profile.assignments).forEach(([seat, student]) => {
        if (student === settings.fixedStudent) delete profile.assignments[seat];
      });
      profile.assignments[editingChairKey] = settings.fixedStudent;
    }
    editingChairKey = null;
    renderGrid();
    renderStudentPicker();
    save();
  }

  function resetChairOptions() {
    els.chairColorInput.value = "#4d7891";
    els.chairExcludedInput.checked = false;
    els.chairAlwaysFilledInput.checked = false;
    els.chairFixedStudentSelect.value = "";
    updateChairOptionControls();
  }

  function clearChairStudent() {
    if (!editingChairKey) return;
    delete activeAssignments()[editingChairKey];
    renderGrid();
    renderStudentPicker();
    save();
  }

  function openClassDialog(classId = null) {
    editingClassId = classId;
    const classPreset = state.classes.find((item) => item.id === classId) || newClass();
    els.classDialogTitle.textContent = classId ? "Edit class list" : "New class list";
    els.classNameInput.value = classPreset.name;
    els.studentNamesInput.value = classPreset.students.join("\n");
    els.alternateGenderInput.checked = Boolean(classPreset.alternateGender);
    els.deleteClassBtn.hidden = !classId;
    renderStudentGenderList(classPreset.students, classPreset.studentGenders);
    renderRules(els.mustNextRules, classPreset.mustNextRules, classPreset.students);
    renderGroups(els.mustTableGroups, classPreset.mustTableGroups, classPreset.students);
    renderRules(els.nextRules, classPreset.nextRules, classPreset.students);
    renderGroups(els.notTableGroups, classPreset.notTableGroups, classPreset.students);
    els.classDialog.showModal();
    setTimeout(() => els.classNameInput.focus(), 0);
  }

  function getDialogStudents() {
    return getDialogStudentEntries().students;
  }

  function getDialogStudentEntries() {
    const students = [];
    const genders = {};
    els.studentNamesInput.value.split("\n").forEach((line) => {
      const parsed = parseStudentLine(line);
      if (!parsed.name || students.includes(parsed.name)) return;
      students.push(parsed.name);
      if (parsed.gender) genders[parsed.name] = parsed.gender;
    });
    return { students, genders };
  }

  function renderStudentGenderList(students, genders = {}) {
    els.studentGenderList.innerHTML = "";
    students.forEach((student) => {
      const row = document.createElement("label");
      row.className = "student-gender-row";
      row.dataset.student = student;
      const name = document.createElement("span");
      name.className = "student-gender-name";
      name.textContent = student;
      const select = document.createElement("select");
      select.className = "student-gender-select";
      select.setAttribute("aria-label", `${student} gender`);
      [
        ["", "Not set"],
        ["M", "M"],
        ["F", "F"]
      ].forEach(([value, label]) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        option.selected = normalizeGender(genders[student]) === value;
        select.append(option);
      });
      row.append(name, select);
      els.studentGenderList.append(row);
    });
  }

  function visibleDialogGenderMap() {
    const genders = {};
    $$(".student-gender-row", els.studentGenderList).forEach((row) => {
      const gender = normalizeGender($(".student-gender-select", row).value);
      if (gender) genders[row.dataset.student] = gender;
    });
    return genders;
  }

  function readDialogGenders(students) {
    const allowed = new Set(students);
    const genders = {};
    Object.entries(visibleDialogGenderMap()).forEach(([student, gender]) => {
      if (allowed.has(student) && gender) genders[student] = gender;
    });
    return genders;
  }

  function studentOptionLabel(classPreset, student) {
    const gender = studentGender(classPreset, student);
    return gender ? `${student} (${gender})` : student;
  }

  function renderRules(container, rules, students) {
    container.innerHTML = "";
    rules.forEach((rule) => addRuleRow(container, rule, students));
  }

  function renderGroups(container, groups, students) {
    container.innerHTML = "";
    groups.forEach((group) => addGroupRow(container, group, students));
  }

  function addRuleRow(container, rule = ["", ""], students = getDialogStudents()) {
    const row = els.ruleTemplate.content.firstElementChild.cloneNode(true);
    const selectA = $(".rule-student-a", row);
    const selectB = $(".rule-student-b", row);
    fillStudentOptions(selectA, students, rule[0]);
    fillStudentOptions(selectB, students, rule[1]);
    $(".remove-rule", row).addEventListener("click", () => row.remove());
    container.append(row);
  }

  function addGroupRow(container, group = ["", ""], students = getDialogStudents()) {
    const row = $("#groupTemplate").content.firstElementChild.cloneNode(true);
    const selects = $(".group-student-selects", row);
    const members = group.length >= 2 ? group : ["", ""];
    const selectLabel = container === els.notTableGroups ? "Student in different-table group" : "Student in same-table group";
    members.forEach((member) => addGroupStudentSelect(selects, students, member, selectLabel));
    $(".add-group-student", row).addEventListener("click", () => addGroupStudentSelect(selects, getDialogStudents(), "", selectLabel));
    $(".remove-group", row).addEventListener("click", () => row.remove());
    container.append(row);
  }

  function addGroupStudentSelect(container, students, selected, selectLabel) {
    const wrapper = document.createElement("div");
    wrapper.className = "group-student";
    const select = document.createElement("select");
    select.className = "group-student-select";
    select.setAttribute("aria-label", selectLabel);
    fillStudentOptions(select, students, selected);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-button remove-group-student";
    remove.title = "Remove student from group";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      if ($$(".group-student", container).length > 2) wrapper.remove();
    });
    wrapper.append(select, remove);
    container.append(wrapper);
  }

  function fillStudentOptions(select, students, selected) {
    select.innerHTML = `<option value="">Choose student</option>`;
    students.forEach((student) => {
      const option = document.createElement("option");
      option.value = student;
      option.textContent = student;
      option.selected = student === selected;
      select.append(option);
    });
  }

  function refreshClassStudentOptions() {
    const visibleGenders = visibleDialogGenderMap();
    const entries = getDialogStudentEntries();
    renderStudentGenderList(entries.students, { ...visibleGenders, ...entries.genders });
    refreshRuleOptions(entries.students);
  }

  function refreshRuleOptions(students = getDialogStudents()) {
    $$(".rule-row", els.classDialog).forEach((row) => {
      [$(".rule-student-a", row), $(".rule-student-b", row)].forEach((select) => {
        fillStudentOptions(select, students, select.value);
      });
    });
    $$(".group-student-select", els.classDialog).forEach((select) => fillStudentOptions(select, students, select.value));
  }

  function readRules(container) {
    return $$(".rule-row", container)
      .map((row) => [$(".rule-student-a", row).value, $(".rule-student-b", row).value])
      .filter(([a, b]) => a && b && a !== b);
  }

  function readGroups(container) {
    return $$(".group-row", container)
      .map((row) => [...new Set($$(".group-student-select", row).map((select) => select.value).filter(Boolean))])
      .filter((group) => group.length >= 2);
  }

  function saveClassFromDialog() {
    const name = els.classNameInput.value.trim();
    const entries = getDialogStudentEntries();
    const students = entries.students;
    if (!name) return;

    let classPreset = state.classes.find((item) => item.id === editingClassId);
    const previousSeatingRules = classPreset
      ? JSON.stringify({
          students: classPreset.students,
          mustNextRules: classPreset.mustNextRules,
          mustTableGroups: classPreset.mustTableGroups,
          nextRules: classPreset.nextRules,
          notTableGroups: classPreset.notTableGroups,
          studentGenders: classPreset.studentGenders,
          alternateGender: classPreset.alternateGender
        })
      : null;
    if (!classPreset) {
      classPreset = newClass();
      state.classes.push(classPreset);
      editingClassId = classPreset.id;
    }
    classPreset.name = name;
    classPreset.students = students;
    classPreset.studentGenders = { ...entries.genders, ...readDialogGenders(students) };
    classPreset.alternateGender = els.alternateGenderInput.checked;
    classPreset.mustNextRules = dedupeRules(readRules(els.mustNextRules));
    classPreset.mustTableGroups = dedupeGroups(readGroups(els.mustTableGroups));
    classPreset.nextRules = dedupeRules(readRules(els.nextRules));
    classPreset.notTableGroups = dedupeGroups(readGroups(els.notTableGroups));
    const seatingRulesChanged = previousSeatingRules !== null && previousSeatingRules !== JSON.stringify({
      students: classPreset.students,
      mustNextRules: classPreset.mustNextRules,
      mustTableGroups: classPreset.mustTableGroups,
      nextRules: classPreset.nextRules,
      notTableGroups: classPreset.notTableGroups,
      studentGenders: classPreset.studentGenders,
      alternateGender: classPreset.alternateGender
    });

    state.rooms.forEach((room) => {
      if (room.activeClassId === classPreset.id && seatingRulesChanged) {
        ensureSeatProfile(room, classPreset.id).assignments = {};
        return;
      }
      Object.entries(ensureSeatProfile(room, classPreset.id).assignments).forEach(([seat, student]) => {
        if (!students.includes(student)) delete ensureSeatProfile(room, classPreset.id).assignments[seat];
      });
      Object.values(ensureSeatProfile(room, classPreset.id).chairSettings).forEach((settings) => {
        if (settings.fixedStudent && !students.includes(settings.fixedStudent)) settings.fixedStudent = null;
      });
    });
    if (!activeRoom().activeClassId) activeRoom().activeClassId = classPreset.id;
    selectedStudent = null;
    renderAll();
    save();
  }

  function dedupeRules(rules) {
    const seen = new Set();
    return rules.filter(([a, b]) => {
      const key = [a, b].sort().join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function dedupeGroups(groups) {
    const seen = new Set();
    return groups.filter((group) => {
      const key = [...group].sort().join("\u0000");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function deleteClass() {
    const classPreset = state.classes.find((item) => item.id === editingClassId);
    if (!classPreset || !confirm(`Delete "${classPreset.name}"?`)) return;
    state.classes = state.classes.filter((item) => item.id !== classPreset.id);
    state.rooms.forEach((room) => {
      if (room.activeClassId === classPreset.id) {
        room.activeClassId = null;
      }
      delete room.classSeatProfiles[classPreset.id];
    });
    editingClassId = null;
    els.classDialog.close();
    selectedStudent = null;
    renderAll();
    save();
  }

  function autoAssign(reshuffle = false) {
    const room = activeRoom();
    const classPreset = activeClass();
    if (!classPreset) {
      showMessage("Choose a class list before assigning seats.");
      return;
    }

    const seats = Object.keys(room.cells).filter((key) => room.cells[key].type === "chair" && !seatSettings(room, key).excluded);
    if (seats.length < classPreset.students.length) {
      showMessage(`This room has ${seats.length} available chairs for ${classPreset.students.length} students. Add or include ${classPreset.students.length - seats.length} more chair${classPreset.students.length - seats.length === 1 ? "" : "s"}.`);
      return;
    }
    if (!classPreset.students.length) {
      showMessage("This class list has no students yet.");
      return;
    }

    const chairProblem = validateChairRequirements(room, classPreset, seats);
    if (chairProblem) {
      showMessage(chairProblem);
      return;
    }

    const layoutProblem = validateLayoutForRules(room, classPreset, seats);
    if (layoutProblem) {
      showMessage(layoutProblem);
      return;
    }

    const solution = solveSeating(room, classPreset, seats, reshuffle);
    if (!solution) {
      showMessage("No arrangement could satisfy every rule. Try adding space between chairs, adding tables, or changing a rule.");
      return;
    }
    activeSeatProfile(room).assignments = solution;
    selectedStudent = null;
    showMessage(`Assigned ${classPreset.students.length} students while satisfying all saved rules.`, true);
    renderGrid();
    renderStudentPicker();
    save();
  }

  function solveSeating(room, classPreset, allSeats, reshuffle) {
    const fixedAssignments = {};
    allSeats.forEach((seat) => {
      const fixedStudent = seatSettings(room, seat).fixedStudent;
      if (fixedStudent) fixedAssignments[seat] = fixedStudent;
    });
    const fixedStudents = new Set(Object.values(fixedAssignments));
    const students = classPreset.students.filter((student) => !fixedStudents.has(student));
    const requiredSeats = new Set(allSeats.filter((seat) => {
      const settings = seatSettings(room, seat);
      return settings.alwaysFilled || settings.fixedStudent;
    }));
    const rules = {
      mustNextPairs: pairSet(classPreset.mustNextRules),
      mustTableGroups: mergeOverlappingGroups(classPreset.mustTableGroups),
      notNextPairs: pairSet(classPreset.nextRules),
      notTablePairs: pairSet(groupsToPairs(classPreset.notTableGroups)),
      alternateGender: Boolean(classPreset.alternateGender),
      studentGenders: classPreset.studentGenders || {}
    };
    const tableForSeat = mapSeatsToTables(room, allSeats);
    const tableSeats = groupSeatsByTable(allSeats, tableForSeat);
    const conflictCount = (student) =>
      classPreset.mustNextRules.filter((rule) => rule.includes(student)).length +
      classPreset.mustTableGroups.filter((rule) => rule.includes(student)).length +
      classPreset.nextRules.filter((rule) => rule.includes(student)).length +
      classPreset.notTableGroups.filter((rule) => rule.includes(student)).length +
      (classPreset.alternateGender && studentGender(classPreset, student) ? 1 : 0);

    students.sort((a, b) => conflictCount(b) - conflictCount(a) || a.localeCompare(b));
    const attempts = reshuffle ? 180 : 100;

    for (let attempt = 0; attempt < attempts; attempt += 1) {
      const seats = shuffle([...allSeats]).sort((a, b) => Number(requiredSeats.has(b)) - Number(requiredSeats.has(a)));
      const order = attempt ? shuffleTies(students, conflictCount) : [...students];
      const assignments = { ...fixedAssignments };
      const studentSeats = Object.fromEntries(Object.entries(fixedAssignments).map(([seat, student]) => [student, seat]));
      let steps = 0;
      const maxSteps = 120000;

      let fixedValid = true;
      const checkedAssignments = {};
      const checkedStudentSeats = {};
      for (const [seat, student] of Object.entries(fixedAssignments)) {
        if (!isPlacementValid(student, seat, checkedStudentSeats, checkedAssignments, rules, allSeats, tableForSeat, tableSeats)) {
          fixedValid = false;
          break;
        }
        checkedAssignments[seat] = student;
        checkedStudentSeats[student] = seat;
      }
      if (!fixedValid) continue;

      function place(index) {
        steps += 1;
        if (steps > maxSteps) return false;
        if (index === order.length) return [...requiredSeats].every((seat) => assignments[seat]);
        const student = order[index];

        for (const seat of seats) {
          if (assignments[seat]) continue;
          if (!isPlacementValid(student, seat, studentSeats, assignments, rules, allSeats, tableForSeat, tableSeats)) continue;
          assignments[seat] = student;
          studentSeats[student] = seat;
          if (place(index + 1)) return true;
          delete assignments[seat];
          delete studentSeats[student];
        }
        return false;
      }

      if (place(0)) return assignments;
    }
    return null;
  }

  function pairSet(rules) {
    return new Set(rules.map(([a, b]) => pairKey(a, b)));
  }

  function pairKey(a, b) {
    return [a, b].sort().join("\u0000");
  }

  function isPlacementValid(student, seat, studentSeats, assignments, rules, allSeats, tableForSeat, tableSeats) {
    const gender = rules.alternateGender ? normalizeGender(rules.studentGenders[student]) : "";
    for (const [otherStudent, otherSeat] of Object.entries(studentSeats)) {
      const pair = pairKey(student, otherStudent);
      if (rules.notNextPairs.has(pair) && seatsAreNextToEachOther(seat, otherSeat)) return false;
      if (rules.notTablePairs.has(pair) && tableForSeat[seat] && tableForSeat[seat] === tableForSeat[otherSeat]) return false;
      if (rules.mustNextPairs.has(pair) && !seatsAreNextToEachOther(seat, otherSeat)) return false;
      if (
        gender &&
        gender === normalizeGender(rules.studentGenders[otherStudent]) &&
        seatsAreNextToEachOther(seat, otherSeat)
      ) return false;
    }

    for (const pair of rules.mustNextPairs) {
      const [a, b] = pair.split("\u0000");
      if (student !== a && student !== b) continue;
      const other = student === a ? b : a;
      if (studentSeats[other]) continue;
      const hasNearbySeat = allSeats.some((candidate) =>
        candidate !== seat &&
        !assignments[candidate] &&
        seatsAreNextToEachOther(seat, candidate)
      );
      if (!hasNearbySeat) return false;
    }

    for (const group of rules.mustTableGroups) {
      if (!group.includes(student)) continue;
      const table = tableForSeat[seat];
      if (!table) return false;
      const placedMembers = group.filter((member) => studentSeats[member]);
      if (placedMembers.some((member) => tableForSeat[studentSeats[member]] !== table)) return false;

      const remainingMembers = group.filter((member) => member !== student && !studentSeats[member]).length;
      const freeTableSeats = (tableSeats[table] || []).filter((candidate) => candidate !== seat && !assignments[candidate]).length;
      if (freeTableSeats < remainingMembers) return false;
    }
    return true;
  }

  function seatsAreNextToEachOther(a, b) {
    const [ar, ac] = parseCellKey(a);
    const [br, bc] = parseCellKey(b);
    return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
  }

  function validateChairRequirements(room, classPreset, seats) {
    const requiredSeats = seats.filter((seat) => {
      const settings = seatSettings(room, seat);
      return settings.alwaysFilled || settings.fixedStudent;
    });
    if (requiredSeats.length > classPreset.students.length) {
      return `${requiredSeats.length} chairs must always be filled, but this class only has ${classPreset.students.length} students.`;
    }

    const seenStudents = new Set();
    const fixedPlacements = [];
    const allChairKeys = Object.keys(room.cells).filter((key) => room.cells[key].type === "chair");
    for (const seat of allChairKeys) {
      const settings = seatSettings(room, seat);
      const fixedStudent = settings.fixedStudent;
      if (!fixedStudent) continue;
      if (settings.excluded) {
        return `A chair fixed for ${fixedStudent} is also excluded. Change that chair's options.`;
      }
      if (!classPreset.students.includes(fixedStudent)) {
        return `A chair is fixed for ${fixedStudent}, who is not in the selected class. Change that chair's options or choose the correct class.`;
      }
      if (seenStudents.has(fixedStudent)) {
        return `${fixedStudent} is fixed to more than one chair. Change one of those chair options.`;
      }
      seenStudents.add(fixedStudent);
      fixedPlacements.push({ seat, student: fixedStudent });
    }

    if (classPreset.alternateGender) {
      for (let i = 0; i < fixedPlacements.length; i += 1) {
        for (let j = i + 1; j < fixedPlacements.length; j += 1) {
          const left = fixedPlacements[i];
          const right = fixedPlacements[j];
          const gender = studentGender(classPreset, left.student);
          if (gender && gender === studentGender(classPreset, right.student) && seatsAreNextToEachOther(left.seat, right.seat)) {
            return `${left.student} and ${right.student} are fixed to directly adjacent chairs but both are marked ${gender}.`;
          }
        }
      }
    }
    return null;
  }

  function validateLayoutForRules(room, classPreset, seats) {
    const mustNextPairs = pairSet(classPreset.mustNextRules);
    const notNextPairs = pairSet(classPreset.nextRules);
    for (const pair of mustNextPairs) {
      if (notNextPairs.has(pair)) {
        const [a, b] = pair.split("\u0000");
        return `${a} and ${b} are set to both sit next to and not sit next to each other. Change one of those rules.`;
      }
    }

    if (classPreset.alternateGender) {
      for (const [a, b] of classPreset.mustNextRules) {
        const genderA = studentGender(classPreset, a);
        const genderB = studentGender(classPreset, b);
        if (genderA && genderA === genderB) {
          return `${a} and ${b} must sit next to each other, but both are marked ${genderA}. Turn off alternating gender or change one gender/rule.`;
        }
      }
    }

    for (const pair of mustNextPairs) {
      const hasNearbyPair = seats.some((seat, index) => seats.slice(index + 1).some((other) => seatsAreNextToEachOther(seat, other)));
      if (!hasNearbyPair) return "The room has no pair of directly adjacent chairs for the students who must sit next to each other.";
    }

    const mustTableGroups = mergeOverlappingGroups(classPreset.mustTableGroups);
    const notTableRules = groupsToPairs(classPreset.notTableGroups);
    const notTablePairs = pairSet(notTableRules);
    for (const group of mustTableGroups) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          if (notTablePairs.has(pairKey(group[i], group[j]))) {
            return `${group[i]} and ${group[j]} are set to both share and not share a table. Change one of those rules.`;
          }
        }
      }
    }

    const hasTableRules = mustTableGroups.length > 0 || classPreset.notTableGroups.length > 0;
    if (!hasTableRules) return null;

    const ambiguousSeats = ambiguousChairKeys(room);
    if (ambiguousSeats.length) {
      return `${ambiguousSeats.length} chair${ambiguousSeats.length === 1 ? " is" : "s are"} next to two separate tables. Move ${ambiguousSeats.length === 1 ? "it" : "them"} so each chair belongs to only one table.`;
    }

    const tableForSeat = mapSeatsToTables(room, seats);
    const tableSeats = groupSeatsByTable(seats, tableForSeat);
    const usableTables = Object.keys(tableSeats).filter((table) => tableSeats[table].length);
    if (!usableTables.length) return "This class has table rules, but the room has no tables with chairs. Add tables and nearby chairs first.";

    for (const group of mustTableGroups) {
      const largestTable = Math.max(...usableTables.map((table) => tableSeats[table].length));
      if (largestTable < group.length) {
        return `No table is big enough for ${group.join(", ")}. Add a table with at least ${group.length} nearby chairs.`;
      }
    }

    const largestSeparateGroup = Math.max(0, ...classPreset.notTableGroups.map((group) => group.length));
    if (largestSeparateGroup > usableTables.length) {
      return `A "must not sit at the same table" group needs ${largestSeparateGroup} separate tables, but this room only has ${usableTables.length} table${usableTables.length === 1 ? "" : "s"} with chairs.`;
    }

    const coloring = canPlaceOnSeparateTables(mustTableGroups, notTableRules, usableTables.length);
    if (coloring === false) {
      return `There are not enough separate tables with chairs to satisfy the "must not sit at the same table" rules. Add another table and nearby chairs.`;
    }
    return null;
  }

  function mergeOverlappingGroups(groups) {
    const merged = groups.map((group) => [...new Set(group.filter(Boolean))]).filter((group) => group.length >= 2);
    let changed = true;
    while (changed) {
      changed = false;
      outer:
      for (let i = 0; i < merged.length; i += 1) {
        for (let j = i + 1; j < merged.length; j += 1) {
          if (merged[i].some((student) => merged[j].includes(student))) {
            merged[i] = [...new Set([...merged[i], ...merged[j]])];
            merged.splice(j, 1);
            changed = true;
            break outer;
          }
        }
      }
    }
    return merged;
  }

  function groupsToPairs(groups) {
    const pairs = [];
    groups.forEach((group) => {
      const members = [...new Set(group.filter(Boolean))];
      for (let i = 0; i < members.length; i += 1) {
        for (let j = i + 1; j < members.length; j += 1) pairs.push([members[i], members[j]]);
      }
    });
    return pairs;
  }

  function canPlaceOnSeparateTables(mustTableGroups, notTableRules, tableCount) {
    const components = mergeOverlappingGroups(mustTableGroups);
    const componentFor = {};
    components.forEach((group, index) => group.forEach((student) => { componentFor[student] = `group-${index}`; }));
    notTableRules.flat().forEach((student) => {
      if (!componentFor[student]) componentFor[student] = `student-${student}`;
    });

    const edges = new Set();
    for (const [a, b] of notTableRules) {
      const left = componentFor[a];
      const right = componentFor[b];
      if (left === right) return false;
      edges.add(pairKey(left, right));
    }
    const nodes = [...new Set(Object.values(componentFor))];
    const degree = (node) => [...edges].filter((edge) => edge.split("\u0000").includes(node)).length;
    nodes.sort((a, b) => degree(b) - degree(a));
    const colors = {};
    let steps = 0;

    function color(index) {
      steps += 1;
      if (steps > 50000) return null;
      if (index === nodes.length) return true;
      const node = nodes[index];
      for (let candidate = 0; candidate < tableCount; candidate += 1) {
        const conflicts = nodes.some((other) =>
          colors[other] === candidate && edges.has(pairKey(node, other))
        );
        if (conflicts) continue;
        colors[node] = candidate;
        const result = color(index + 1);
        if (result !== false) return result;
        delete colors[node];
      }
      return false;
    }
    return color(0);
  }

  function groupSeatsByTable(seats, tableForSeat) {
    const result = {};
    seats.forEach((seat) => {
      const table = tableForSeat[seat];
      if (!table) return;
      if (!result[table]) result[table] = [];
      result[table].push(seat);
    });
    return result;
  }

  function mapSeatsToTables(room, seats) {
    const tableLayout = getTableLayout(room);
    const result = {};
    seats.forEach((seat) => {
      const nearbyGroups = tableGroupsNextToChair(seat, tableLayout);
      if (nearbyGroups.length === 1) result[seat] = nearbyGroups[0];
    });
    return result;
  }

  function shuffle(items) {
    for (let i = items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [items[i], items[j]] = [items[j], items[i]];
    }
    return items;
  }

  function shuffleTies(students, score) {
    return [...students].sort((a, b) => score(b) - score(a) || Math.random() - 0.5);
  }

  function showMessage(text, success = false) {
    els.assignmentMessage.hidden = false;
    els.assignmentMessage.textContent = text;
    els.assignmentMessage.classList.toggle("success", success);
  }

  function hideMessage() {
    els.assignmentMessage.hidden = true;
    els.assignmentMessage.classList.remove("success");
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `room-planner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = JSON.parse(reader.result);
        if (!Array.isArray(imported.rooms) || !Array.isArray(imported.classes) || !imported.rooms.length) throw new Error("Invalid planner backup");
        imported.rooms.forEach(normalizeRoom);
        imported.classes.forEach(normalizeClass);
        imported.activeRoomId = imported.rooms.some((room) => room.id === imported.activeRoomId) ? imported.activeRoomId : imported.rooms[0].id;
        if (!confirm("Replace the current rooms and classes with this backup?")) return;
        state = imported;
        selectedStudent = null;
        renderAll();
        save();
      } catch (error) {
        alert("That file is not a valid Room Planner backup.");
      }
    };
    reader.readAsText(file);
  }

  function bindEvents() {
    document.addEventListener("pointerup", () => { isPointerDown = false; });
    document.addEventListener("pointercancel", () => { isPointerDown = false; });

    $$(".tab").forEach((tab) => tab.addEventListener("click", () => {
      $$(".tab").forEach((item) => item.classList.toggle("active", item === tab));
      $$(".side-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `${tab.dataset.tab}Panel`));
    }));
    $$(".tool").forEach((button) => button.addEventListener("click", () => setTool(button.dataset.tool)));
    $$(".close-dialog").forEach((button) => button.addEventListener("click", () => els.classDialog.close()));
    $$(".close-chair-dialog").forEach((button) => button.addEventListener("click", () => els.chairDialog.close()));

    $("#newRoomBtn").addEventListener("click", addRoom);
    $("#duplicateRoomBtn").addEventListener("click", duplicateRoom);
    $("#deleteRoomBtn").addEventListener("click", deleteRoom);
    $("#resizeGridBtn").addEventListener("click", resizeRoom);
    $("#clearRoomBtn").addEventListener("click", clearRoom);
    $("#clearSeatsBtn").addEventListener("click", clearNames);
    $("#newClassBtn").addEventListener("click", () => openClassDialog());
    $("#addMustNextRuleBtn").addEventListener("click", () => addRuleRow(els.mustNextRules));
    $("#addMustTableGroupBtn").addEventListener("click", () => addGroupRow(els.mustTableGroups));
    $("#addNextRuleBtn").addEventListener("click", () => addRuleRow(els.nextRules));
    $("#addNotTableGroupBtn").addEventListener("click", () => addGroupRow(els.notTableGroups));
    els.deleteClassBtn.addEventListener("click", deleteClass);
    els.studentNamesInput.addEventListener("input", refreshClassStudentOptions);
    els.chairExcludedInput.addEventListener("change", updateChairOptionControls);
    els.chairFixedStudentSelect.addEventListener("change", updateChairOptionControls);
    $("#resetChairOptionsBtn").addEventListener("click", resetChairOptions);
    $("#clearChairStudentBtn").addEventListener("click", clearChairStudent);
    els.chairForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveChairOptions();
      els.chairDialog.close();
    });

    els.classForm.addEventListener("submit", (event) => {
      event.preventDefault();
      saveClassFromDialog();
      els.classDialog.close();
    });

    els.roomName.addEventListener("input", () => {
      activeRoom().name = els.roomName.value || "Untitled room";
      renderRoomList();
      save();
    });
    els.activeClassSelect.addEventListener("change", () => {
      const room = activeRoom();
      room.activeClassId = els.activeClassSelect.value || null;
      ensureSeatProfile(room);
      selectedStudent = null;
      hideMessage();
      renderStudentPicker();
      renderGrid();
      save();
    });

    $("#autoAssignBtn").addEventListener("click", () => autoAssign(false));
    $("#shuffleBtn").addEventListener("click", () => autoAssign(true));
    $("#printBtn").addEventListener("click", () => window.print());
    $("#exportBtn").addEventListener("click", exportBackup);
    $("#importInput").addEventListener("change", (event) => {
      importBackup(event.target.files[0]);
      event.target.value = "";
    });
  }

  bindEvents();
  renderAll();
  save();
  window.addEventListener("beforeunload", () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)));
})();
