# Study OS · GATE 2027 — Project Handoff (v26)

Owner: Prakhar. GATE CS 2027 aspirant (exam: 1 Feb 2027), ADHD — needs zero-decision, low-friction systems.
App: single-file PWA at `prakharkumarchandraker.github.io/ADHD-Study-Timer/`
**Feature freeze in effect** except: (1) bug fixes with error screenshots, (2) the Test Series feature specced below.

---

## 1. ARCHITECTURE (do not violate these)

- **One file:** `index.html` (~765KB, ~10k lines). Vanilla JS, no build step. Main app = ONE classic `<script>` (all functions/vars are globals). Firebase bootstrap = separate `<script type="module">` exposing `window._fb`.
- **Companion files:** `sw.js` (service worker — **bump `CACHE` string every deploy**, currently `studyos-v26`), `manifest.json`, 3 icons.
- **State:** `ST` object (done, pyqTopics, potato, skips, flags, revisions, revDone, subjOrder, pinnedNext, revUnits, revSubjects, revBlockMode, **rotation**). Persisted via `lsSet` with `v5_` localStorage prefix + Firebase Realtime DB snapshots (`saveGateState()`, merge logic with last-write-wins for subjOrder & rotation).
- **Curriculum:** `SUBJ`, `ALL_TASKS`, `LABELS`, `COLORS` — consts built at load from `v5_curriculum_meta` localStorage (user-editable via Curriculum Manager; applying reloads the page). Lecture + PYQ task types. ID remapping preserves done/flags/pins across curriculum edits.
- **Single source of truth:** `buildSched()` — pure projection from today onward (day → sessions → item chunks `{taskId, subject, chunk, totalDur, isFirst, isLast, isSplit, isPinned…}`). EVERYTHING reads it: next-task pill, hero, focus overlay, Daily Minimum (`dmBuildSnapFromSched`), exports, Panic button. Lesson learned: cards that compute their own numbers rot (the old hardcoded Total Syllabus card). New features must derive from `buildSched()` or live `ALL_TASKS`+`ST`.
- **Day boundary:** 4am, via `getToday()`. Dates are `YYYY-MM-DD` strings; helpers `addD`, `fromStr`, `toStr`, `fmtShort`, `daysBetween`.
- **Key signatures (arity bugs caused prod crashes — check before calling):** `getPace(studyDaysMap)`, `getNextTask(sched)`, `dmBuildTierList(budgetMins, doneSet)`, `showT(title,body)`, `haptic(arr)`, `esc(s)`.
- **Editing convention:** new features are appended as self-contained IIFE `<script>` modules before `</body>`, with `typeof` guards and try/catch around app calls; surgical str-replace for core functions. After ANY edit: extract all inline scripts and `node --check` each; behavioral tests in Node with mocked `ST/ALL_TASKS/SESSIONS` for scheduler changes.
- **Theme:** "Graphite & Signal" — flat, no gradients. Dark: bg #0f1113, surfaces #16181b/#1d2024/#262a2f, text #eceef0, muted #7b828c, accent blue #4d9fec, green #3ecf8e, red #f2545b, amber #e8b339. Fonts: Inter (`--fn`) + JetBrains Mono (`--mo`), tabular numerals. Light mode exists — **always use CSS vars, never hardcode dark colors in normal-tab UI** (caused invisible-text bugs in v25). Focus overlay + export cards are always-dark zones (white-alpha OK there).

## 2. FEATURE MAP (v19→v26 this week)

- **Core (pre-existing):** timetable slots (`ALL_SLOTS`/`SESSIONS`), habits (build/quit), todos, stats (week compare, history calendar), revision/SRS (9 passes P1–P9, Easy/Hard/Blank, unit-level, 3 blocking modes, 30-day calendar), Daily Minimum Target (frozen daily snapshot + speed tiers), Speed Completion Calculator, morning/night JPG exports (html2canvas), push notifications via SW, PIN lock, presence/conflict-resolution sync.
- **v20 Panic Start:** `panicStart()` — one tap → picks next task (pin wins) → 10-min micro free-focus → fullscreen → momentum prompt (+15 chain / stop guilt-free). Daily count `v5_panic_<date>`.
- **v22 Focus Mode 2.0:** screen Wake Lock; hold-to-exit 2.5s (`.fo-exit-btn`); exit guard (wrapped `exitFocusOverlay(force)` blocks back-gesture/fullscreen-loss unless armed); distraction shield (leave counter `v5_fleave_<date>` + named call-back toast); 45s return-nudge notification; parking lot input → todos with 📥 prefix; calm dim after 25s idle (`.fo-dimmed`).
- **v23 Subject Rotation:** `ST.rotation = {on:1, phases:[["C","DS"],…], days:{0:[…]…6:[…]}}`. 1–4 subjects parallel; daily GATE minutes split equally; phase order = study order; **backfill** (subject finishes → next in master order joins same day-set); per-weekday overrides; partials carry per-subject. `getRotation()` validates (filters to SUBJ, dedupes, unassigned subjects trail as solo phases). `rotSimFinishDates(rot,subjData,speed,dailyMins,today)` powers rotation-aware Speed Calculator (∥ marker). Editor card `#rotCard` on GATE tab; picker disables subjects assigned to other phases (P1 tag).
- **v24:** live Syllabus Progress card (`sylRender`, replaces hardcoded block); Pace card (verdict + Doing/Need/Done-by) replacing old velocity tracker.
- **v25:** `getPace(getStudyDays())` crash fix; Daily-Min higher tiers walk `buildSched()` under rotation; 37-test Node suite passed.
- **v26:** light-mode fixes (Add-Habit sheet & inputs → vars; hist-cal + habit month-grid day numbers → vars; misc hover borders); week-delta float rounding (`Math.round((a-b)*10)/10`).
- **Pending ideas (frozen):** mistake log (approved as next feature alongside tests).

## 3. NEXT FEATURE: TEST SERIES (spec — build this in new chat)

**Goal:** import coaching test-series schedules (ACE done, MADE EASY pending, +1 unknown provider later), auto-plan when Prakhar should TAKE each test, integrate with rotation/readiness, log scores + mistakes.

**Import pattern (decided):** do NOT build PDF parsing into the PWA. Claude analyzes PDFs in chat → emits `tests JSON` → app imports via paste/file (same pattern as curriculum JSON). Schema:
```json
{ "provider":"ACE", "tests":[ {"id":"ACE27-T01","name":"Engineering Mathematics","type":"topic","subjects":["Engineering Mathematics"],"q":15,"min":42,"marks":25,"activation":"2026-04-13","series":"2027"} ] }
```
Types: `topic` | `subject_grand` | `multi_grand` | `flm`. Store in `ST.tests` (synced) as `{…, planned:null, taken:null, score:null, max:null, notes:""}`.

**Auto-scheduling rules (agreed direction):**
1. A test becomes *eligible* when (a) `today >= activation` AND (b) readiness: all its `subjects` ≥ ~90% first-pass complete (compute live from ALL_TASKS/ST.done; map provider subject names → curriculum subjects via an alias table, e.g. "Programming"→"C Programming", "Databases"→"DBMS", "General Aptitude"→"Aptitude"; Engineering Math/Discrete Math may not exist in curriculum → treat as always-ready or user-marked).
2. Planner assigns `planned` dates: topic tests right after subject completion (from `rotSimFinishDates`/buildSched projection); subject grand ≈ +7 days after its topic tests; multi-grand when both subjects done; FLMs only after ~70% total syllabus, then weekly, 2×/week in Jan.
3. Tests render as a card/tab: Upcoming (eligible now, with readiness %), Planned (future, with reason "waiting: OS 62%"), Done (score, percentile field). Test day = special timetable block (3h for FLM); option to mark a day as "Test day" which the rotation treats like a day rule.
4. Score entry → mini **mistake log** per test: rows {question topic, subject, reason: concept/silly/slow}. This is the rank-driving feature.

**UI:** new "🧪 Tests" section on GATE tab below rotation (or its own tab if nav allows). Keep zero-decision spirit: a "Next test for you" hero line.

## 4. EXTRACTED: ACE GATE-2027 CS TEST SERIES (ready to import)

All tests stay active from activation until the GATE-2027 exam. 6:00 PM activation.

**Topic-wise (15Q · 42min · 25M), activations:**
T01 Engineering Mathematics — 2026-04-13 · T02 Discrete Math-1 — 2026-04-21 · T03 Discrete Math-2 — 2026-04-28 · T04 Digital Logic-1 — 2026-05-05 · T05 Digital Logic-2 — 2026-05-05 · T06 COA-1 — 2026-05-12 · T07 COA-2 — 2026-05-12 · T08 Computer Networks-1 — 2026-05-19 · T09 Computer Networks-2 — 2026-05-19 · T10 TOC-1 — 2026-05-26 · T11 TOC-2 — 2026-05-26 · T12 OS-1 — 2026-06-02 · T13 OS-2 — 2026-06-02 · T14 Algorithms-1 — 2026-06-09 · T15 Algorithms-2 — 2026-06-09 · T16 DBMS-1 — 2026-06-09 · T17 DBMS-2 — 2026-06-09 · T18 Compiler Design — 2026-06-09 · T19 Programming(C) — 2026-06-09 · T20 Data Structures — 2026-06-09 · T21 Verbal — 2026-06-09 · T22 Quant — 2026-06-09 · T23 Analytical/Spatial — 2026-06-09
*(Note: PDF groups dates loosely; ±1 batch uncertainty on T04–T23 mapping — all already activated by 09-06-2026 anyway, so for planning purposes: ALL topic tests are live NOW.)*

**Subject-wise Grand (30Q · 83min · 50M):** T24 Engg Math, T25 Discrete, T26 DLD, T27 COA, T28 CN, T29 TOC, T30 OS, T31 Algo, T32 DBMS, T33 CD, T34 Programming, T35 DS, T36 Aptitude — activations weekly 2026-06-16 → 2026-07-21 (T24–25: 16-06; T26–27: 23-06; T28–29: 30-06; T30–31: 07-07; T32–33: 14-07; T34–36: 21-07).

**FLM 1st series (65Q · 180min · 100M):** T37 04-08 · T38 11-08 · T39 18-08 · T40 25-08 · T41 01-09 · T42 08-09 (2026).

**Multi-Subject Grand (30Q · 83min · 50M):** T43 Prog+DS — 29-09 · T44 COA+DLD — 29-09 · T45 TOC+CD — 06-10 · T46 CN+DBMS — 06-10 · T47 OS+Algo — 13-10 · T48 Math+Apti — 13-10 (2026).

**FLM 2nd series:** T49 27-10 · T50 03-11 · T51 10-11 · T52 17-11 · T53 29-12-2026 · T54 05-01-2027.

**Free GATE-2026 OTS (54 tests, same structure): ALL LIVE NOW** (topic: 25-03-2026, grands: 01-04-2026, FLMs: 10-04-2026). Same subjects/types — use as the practice pool.

**MADE EASY:** schedule pages failed extraction (blank in PDF text layer). Known: CS series, 48 tests, 1584+ questions, commencing 01-04-2026. → Re-upload schedule pages as screenshots/new PDF in the new chat. Third provider PDF: pending from Prakhar.

## 5. TEST-TAKING STRATEGY (agreed advice, encode into planner defaults)

- **Activation date ≠ take date.** Tests stay live till exam. Take a test when the SUBJECT is ready, never to "keep up" with the coaching calendar.
- Per subject: finish first pass → take ACE-2026 (free) topic tests of that subject within 2–3 days → review every wrong answer into mistake log → ~1 week later (after P1/P2 revision) take the 2027 topic tests → subject grand after that.
- **FLMs:** none before ~70% syllabus. With Nov-15 first-pass target: start FLMs late Nov, weekly; January: 2/week, alternating ACE/MADE EASY; last FLM ≥5 days before exam. 24 FLMs exist across providers — taking ~12–15 well-reviewed beats 24 rushed. A test without mistake-log review is worth ~30% of one with it.
- Multi-subject grands (Sep–Oct dates) slot naturally after both subjects' grands.
- Never take a test on a cold subject — it burns a fresh paper and morale.

## 6. DEPLOY CHECKLIST
Replace `index.html` + `sw.js` → bump SW `CACHE` → hard refresh → check console for red errors. Rotation/curriculum sync via Firebase; curriculum apply reloads page.
