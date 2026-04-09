console.log('Script loaded - starting execution');

const SYSTEM = `You are a warm, empathetic personal journal companion embedded in a private diary app called Solace. Your role is to help users reflect, process their thoughts, and capture their experiences meaningfully.

Core Identity: You are not a chatbot. You are a trusted confidant — patient, perceptive, and always present. You exist solely to serve the writer's inner world.

When a user shares a journal entry or writes about their day:
- Lead with empathy — acknowledge feelings before offering anything else
- Reflect back what you heard so the user feels truly seen
- Ask exactly ONE thoughtful follow-up question to invite deeper exploration
- Never overwhelm with multiple questions or unsolicited advice

When a user asks for writing help:
- Help them find words for feelings they can't quite name
- Offer 2-3 tailored prompts based on their mood or situation
- Suggest, never prescribe — it's their voice, not yours

Tone Rules:
- Warm and unhurried, like a wise friend with unlimited time
- Never clinical, preachy, performatively cheerful, or robotic
- Mirror the user's energy — gentle when they're low, bright when they're excited
- Keep responses to 2-4 sentences max unless they ask for more
- This is their diary. You are a guest in it.

Hard Rules:
- NEVER diagnose, prescribe, or act as a therapist
- NEVER offer unsolicited feedback on the user's choices or values
- If serious distress or self-harm is mentioned, respond with deep care and gently direct them to professional support
- Every entry is sacred — handle each word with the care it deserves`;

// ══════════════════════════════════════════
// STATE
// ══════════════════════════════════════════
let failCount = 0;
let lockUntil = 0;
let entries = [];
let curId = null;
let curMood = '';
let curTags = [];
let aiHistory = [];
let exportFmt = 'txt';
let exportScope = 'current';
let activeMoodFilter = '';
let searchQuery = '';
let calendarMonth = new Date();
let isDarkMode = false;
let promptIndex = 0;
let pendingNewEntryId = null;

const PROMPTS = [
  "What's something small that made you smile today?",
  "How are you feeling right now, and why?",
  "What challenged you today, and what did you learn?",
  "Who or what are you grateful for today?",
  "Describe a moment of peace or calm from your day.",
  "What would you do if you had no fear?",
  "What's something you want to remember about today?",
  "How did you take care of yourself today?",
  "What's on your mind the most right now?",
  "What brought you joy today, no matter how small?",
  "If today was a color, what would it be and why?",
  "What's something you're proud of lately?",
  "What do you need right now?",
  "Write about a conversation that stayed with you.",
  "What does success look like for you this week?",
  "When did you feel most like yourself today?",
  "What are you dreaming about?",
  "Describe what's in your heart right now.",
  "What would you tell your past self?",
  "What gives you hope?"
];

// ══════════════════════════════════════════
// INIT
// ══════════════════════════════════════════
function init() {
  console.log('Init starting...');
  const savedPin = localStorage.getItem('sol_pin');
  const name = localStorage.getItem('sol_name');
  console.log('Saved PIN exists:', !!savedPin);
  console.log('Saved name:', name);
  entries = JSON.parse(localStorage.getItem('sol_entries') || '[]');
  console.log('Entries loaded:', entries.length);
  entries = entries.map(e => {
    if (!e.sections) {
      e.sections = e.body ? [{ id: sid(), ts: e.date, text: e.body }] : [];
      delete e.body;
    }
    return e;
  });

  // Load theme preference
  isDarkMode = localStorage.getItem('sol_dark_mode') === 'true';
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    document.getElementById('theme-toggle').textContent = '☀️';
  }

  if (!savedPin) { 
    console.log('No PIN found - showing setup screen');
    show('setup-screen'); 
  }
  else {
    if (name) document.getElementById('lock-greet').textContent = 'Welcome back, ' + name;
    console.log('PIN found - showing lock screen');
    show('lock-screen');
  }

  document.getElementById('h-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday:'long', month:'long', day:'numeric', year:'numeric'
  });

  // FIX: attach modal overlay listener here after DOM ready, not at bottom of script
  document.getElementById('export-modal').addEventListener('click', function(e) {
    if (e.target === this) closeExportModal();
  });
  document.getElementById('calendar-modal').addEventListener('click', function(e) {
    if (e.target === this) closeCalendar();
  });
  document.getElementById('settings-modal').addEventListener('click', function(e) {
    if (e.target === this) closeSettings();
  });
  document.getElementById('prompt-modal').addEventListener('click', function(e) {
    if (e.target === this) closePrompt();
  });
  console.log('Init complete');
}

function show(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function sid() { return 'sec_' + Date.now() + '_' + Math.random().toString(36).slice(2,6); }

// ══════════════════════════════════════════
// SETUP
// ══════════════════════════════════════════
function goStep2() {
  console.log('goStep2 called');
  alert('Continue button clicked!');
  const name = document.getElementById('inp-name').value.trim();
  console.log('Name entered:', name);
  if (!name) { 
    document.getElementById('err1').textContent = 'Please enter your name.'; 
    console.log('No name provided');
    return; 
  }
  alert('Name is: ' + name);
  document.getElementById('err1').textContent = '';
  document.getElementById('s1').classList.remove('active');
  document.getElementById('s2').classList.add('active');
  document.getElementById('inp-pin1').focus();
  console.log('Moved to step 2');
}

function finishSetup() {
  const p1 = document.getElementById('inp-pin1').value.trim();
  const p2 = document.getElementById('inp-pin2').value.trim();
  const err = document.getElementById('err2');
  if (!/^\d{4}$/.test(p1)) { err.textContent = 'PIN must be exactly 4 digits.'; return; }
  if (p1 !== p2) { err.textContent = 'PINs do not match. Try again.'; return; }
  err.textContent = '';
  localStorage.setItem('sol_name', document.getElementById('inp-name').value.trim());
  localStorage.setItem('sol_pin', p1);
  openApp();
}

// ══════════════════════════════════════════
// LOCK / PIN
// ══════════════════════════════════════════
let pinBuffer = '';

function nkPress(n) {
  // FIX: hard return during lockout period; show live remaining seconds
  if (Date.now() < lockUntil) {
    const secs = Math.ceil((lockUntil - Date.now()) / 1000);
    document.getElementById('lock-err').textContent = 'Too many attempts. Wait ' + secs + 's.';
    return;
  }
  if (pinBuffer.length >= 4) return;
  pinBuffer += String(n);
  updateDots();
  if (pinBuffer.length === 4) setTimeout(checkPin, 180);
}

function nkDel() {
  pinBuffer = pinBuffer.slice(0, -1);
  updateDots();
  document.getElementById('lock-err').textContent = '';
}

function updateDots() {
  for (let i = 0; i < 4; i++)
    document.getElementById('pd' + i).classList.toggle('on', i < pinBuffer.length);
}

function checkPin() {
  const saved = localStorage.getItem('sol_pin');
  if (pinBuffer === saved) {
    // FIX: reset lockUntil on success
    failCount = 0; lockUntil = 0; pinBuffer = ''; updateDots(); openApp();
  } else {
    failCount++;
    if (failCount >= 5) {
      lockUntil = Date.now() + 30000;
      document.getElementById('lock-err').textContent = 'Too many attempts. Locked for 30s.';
    } else {
      document.getElementById('lock-err').textContent = 'Incorrect PIN. ' + (5 - failCount) + ' attempt' + (5 - failCount === 1 ? '' : 's') + ' left.';
    }
    const dots = document.getElementById('pin-dots');
    dots.style.animation = 'none';
    dots.offsetHeight;
    dots.style.animation = 'shakeX 0.45s ease';
    pinBuffer = '';
    setTimeout(updateDots, 460);
  }
}

function lockApp() {
  pinBuffer = ''; updateDots();
  document.getElementById('lock-err').textContent = '';
  show('lock-screen');
}

function resetAll(e) {
  e.preventDefault();
  if (!confirm('This will permanently delete all your diary entries and reset your PIN. Are you sure?')) return;
  localStorage.clear(); location.reload();
}

// ══════════════════════════════════════════
// APP
// ══════════════════════════════════════════
function openApp() {
  show('app-screen');
  renderList();
  renderStats();
  if (entries.length === 0) showEmpty();
  else loadEntry(entries[0].id);
}

function showEmpty() {
  document.getElementById('ed-empty').style.display = 'flex';
  document.getElementById('ed-content').style.display = 'none';
  // FIX: clear curId so updateWordCount / save guards work correctly
  curId = null;
}

function showEditor() {
  document.getElementById('ed-empty').style.display = 'none';
  document.getElementById('ed-content').style.display = 'flex';
  document.getElementById('ed-content').style.flexDirection = 'column';
}

// ══════════════════════════════════════════
// SEARCH & FILTER
// ══════════════════════════════════════════
function filterEntries() {
  // FIX: flush live DOM text into state before searching so unsaved text is found
  flushSectionsFromDOM();
  searchQuery = document.getElementById('search-in').value.toLowerCase().trim();
  renderList();
}

function setMoodFilter(btn, mood) {
  activeMoodFilter = mood;
  document.querySelectorAll('.mf-btn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
  renderList();
}

function getFilteredEntries() {
  return entries.filter(e => {
    const matchesMood = !activeMoodFilter || e.mood === activeMoodFilter;
    if (!matchesMood) return false;
    if (!searchQuery) return true;
    const fullText = (e.title || '') + ' ' + (e.sections || []).map(s => s.text).join(' ') + ' ' + (e.tags || []).join(' ');
    return fullText.toLowerCase().includes(searchQuery);
  });
}

// FIX: sync live textarea values into entries state before any read operation
function flushSectionsFromDOM() {
  if (!curId) return;
  document.querySelectorAll('.section-body').forEach(ta => {
    const secId = ta.dataset.secId;
    if (!secId) return;
    const e = entries.find(x => x.id === curId);
    if (!e) return;
    const sec = e.sections.find(s => s.id === secId);
    if (sec) sec.text = ta.value;
  });
}

// ══════════════════════════════════════════
// ENTRIES LIST
// ══════════════════════════════════════════
function renderList() {
  const list = document.getElementById('entries-list');
  list.innerHTML = '';
  const filtered = getFilteredEntries();
  if (filtered.length === 0) {
    list.innerHTML = '<div style="padding:1rem;font-size:0.78rem;color:var(--muted);text-align:center;">' +
      (entries.length === 0 ? 'No entries yet.<br/>Create your first one!' : 'No matches found.') + '</div>';
    return;
  }
  filtered.forEach(e => {
    const div = document.createElement('div');
    div.className = 'entry-row' + (e.id === curId ? ' active' : '');
    div.onclick = () => loadEntry(e.id);
    const snippet = (e.sections && e.sections[0]) ? e.sections[0].text.slice(0, 60) : '';
    // FIX: build innerHTML without template literal interpolation of untrusted id into onclick
    const delBtn = document.createElement('button');
    delBtn.className = 'er-del';
    delBtn.textContent = '✕';
    delBtn.onclick = (ev) => deleteEntry(ev, e.id);

    const title = document.createElement('div');
    title.className = 'er-title';
    title.textContent = e.title || 'Untitled';

    const date = document.createElement('div');
    date.className = 'er-date';
    date.textContent = fmtDate(e.date);

    div.appendChild(delBtn);
    div.appendChild(title);
    div.appendChild(date);

    if (e.mood) {
      const mood = document.createElement('div');
      mood.className = 'er-mood';
      mood.textContent = e.mood;
      div.appendChild(mood);
    }
    if (snippet) {
      const snip = document.createElement('div');
      snip.style.cssText = 'font-size:0.7rem;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      snip.textContent = snippet;
      div.appendChild(snip);
    }
    list.appendChild(div);
  });
}

function newEntry() {
  const id = 'e' + Date.now();
  const now = new Date().toISOString();
  const entry = { id, title:'', sections:[{ id:sid(), ts:now, text:'' }], mood:'', tags:[], date:now };
  entries.unshift(entry);
  save();
  
  // Initialize editor immediately so user can save anytime
  curId = id;
  curMood = '';
  curTags = [];
  renderList();
  renderStats();
  showEditor();
  document.getElementById('ed-title').value = '';
  document.getElementById('ed-meta').textContent = fmtDate(now);
  resetMoodBtns();
  renderTags();
  renderSections();
  
  // Show prompt after editor is ready
  pendingNewEntryId = id;
  promptIndex = Math.floor(Math.random() * PROMPTS.length);
  showPrompt();
}

function showPrompt() {
  document.getElementById('prompt-text').textContent = PROMPTS[promptIndex];
  document.getElementById('prompt-modal').classList.add('open');
}

function closePrompt() {
  document.getElementById('prompt-modal').classList.remove('open');
  pendingNewEntryId = null;
}

function skipPrompt() {
  // Show next prompt
  promptIndex = (promptIndex + 1) % PROMPTS.length;
  showPrompt();
}

function usePrompt() {
  if (pendingNewEntryId) {
    document.getElementById('ed-title').value = PROMPTS[promptIndex];
    pendingNewEntryId = null;
    closePrompt();
    document.querySelector('.section-body').focus();
  }
}

function startBlank() {
  if (pendingNewEntryId) {
    pendingNewEntryId = null;
    closePrompt();
    document.getElementById('ed-title').focus();
  }
}

function loadEntry(id) {
  const e = entries.find(x => x.id === id);
  if (!e) return;
  curId = id; curMood = e.mood || ''; curTags = [...(e.tags || [])];
  showEditor();
  document.getElementById('ed-title').value = e.title || '';
  document.getElementById('ed-meta').textContent = fmtDate(e.date);
  document.querySelectorAll('.mbtn').forEach(b => b.classList.toggle('on', b.textContent.trim() === curMood));
  renderTags(); renderSections(); renderList();
  updateWordCount();
}

function saveEntry() {
  if (!curId) return;
  const e = entries.find(x => x.id === curId);
  if (!e) return;
  // FIX: flush live DOM content before saving
  flushSectionsFromDOM();
  e.title = document.getElementById('ed-title').value.trim() || 'Untitled';
  e.mood = curMood;
  e.tags = [...curTags];
  save(); renderList(); renderStats();
  toast('Entry saved ✓');
}

// FIX: separate silent auto-save that does NOT force title to 'Untitled' on blank new entries
function autoSave() {
  if (!curId) return;
  const e = entries.find(x => x.id === curId);
  if (!e) return;
  flushSectionsFromDOM();
  const titleVal = document.getElementById('ed-title').value.trim();
  if (titleVal) e.title = titleVal;
  e.mood = curMood;
  e.tags = [...curTags];
  save();
}

function deleteEntry(ev, id) {
  ev.stopPropagation();
  if (!confirm('Delete this entry?')) return;
  entries = entries.filter(e => e.id !== id);
  if (curId === id) {
    curId = null;
    // FIX: guard empty array — don't call entries[0].id when entries is empty
    if (entries.length > 0) loadEntry(entries[0].id);
    else showEmpty();
  }
  save(); renderList(); renderStats();
  toast('Entry deleted');
}

function save() { localStorage.setItem('sol_entries', JSON.stringify(entries)); }

// ══════════════════════════════════════════
// SECTIONS (timestamped blocks)
// ══════════════════════════════════════════
function renderSections() {
  const e = entries.find(x => x.id === curId);
  const container = document.getElementById('sections-container');
  container.innerHTML = '';
  if (!e) return;

  e.sections.forEach((sec, idx) => {
    container.appendChild(makeSectionBlock(sec, idx, e.sections.length));
    if (idx < e.sections.length - 1) container.appendChild(makeDivider(idx));
  });

  const addBtn = document.createElement('button');
  addBtn.className = 'add-section-btn';
  addBtn.innerHTML = '<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add timestamped section';
  addBtn.onclick = () => addSection();
  container.appendChild(addBtn);

  // FIX: use requestAnimationFrame so textareas are painted before height measurement
  requestAnimationFrame(autoGrowAll);
}

function makeSectionBlock(sec, idx, total) {
  const block = document.createElement('div');
  block.className = 'section-block';
  block.dataset.secId = sec.id;

  const header = document.createElement('div');
  header.className = 'section-header';

  const ts = document.createElement('div');
  ts.className = 'section-timestamp';
  ts.textContent = fmtTimestamp(sec.ts);

  const delBtn = document.createElement('button');
  delBtn.className = 'section-del-btn';
  delBtn.title = 'Delete section';
  delBtn.textContent = '✕';
  delBtn.onclick = () => deleteSection(sec.id);
  if (total === 1) delBtn.style.display = 'none';

  header.appendChild(ts);
  header.appendChild(delBtn);

  const ta = document.createElement('textarea');
  ta.className = 'section-body';
  ta.placeholder = idx === 0 ? 'This space is yours alone. Write freely…' : 'Continue your thought…';
  ta.value = sec.text || '';
  ta.dataset.secId = sec.id;

  // FIX: always look up section from entries by secId to avoid stale closure reference
  ta.oninput = function() {
    const entry = entries.find(x => x.id === curId);
    if (entry) {
      const s = entry.sections.find(s => s.id === this.dataset.secId);
      if (s) s.text = this.value;
    }
    autoGrow(this);
    updateWordCount();
  };

  ta.onkeydown = function(ev) {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === 's') {
      ev.preventDefault(); saveEntry();
    }
  };

  block.appendChild(header);
  block.appendChild(ta);
  return block;
}

function makeDivider(afterIdx) {
  const div = document.createElement('div');
  div.className = 'section-divider';
  div.innerHTML = '<span>· · ·</span>';
  div.title = 'Click to insert section here';
  div.onclick = () => addSectionAt(afterIdx + 1);
  return div;
}

function addSection(insertAt) {
  const e = entries.find(x => x.id === curId);
  if (!e) return;
  const newSec = { id: sid(), ts: new Date().toISOString(), text: '' };
  if (insertAt !== undefined) e.sections.splice(insertAt, 0, newSec);
  else e.sections.push(newSec);
  save();
  renderSections();
  setTimeout(() => {
    const ta = document.querySelector('textarea[data-sec-id="' + newSec.id + '"]');
    if (ta) ta.focus();
  }, 60);
}

function addSectionAt(idx) { addSection(idx); }

function deleteSection(secId) {
  const e = entries.find(x => x.id === curId);
  if (!e || e.sections.length <= 1) return;
  if (!confirm('Delete this section?')) return;
  e.sections = e.sections.filter(s => s.id !== secId);
  save(); renderSections(); updateWordCount();
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = el.scrollHeight + 'px';
}

function autoGrowAll() {
  document.querySelectorAll('.section-body').forEach(autoGrow);
}

function updateWordCount() {
  // FIX: guard when no entry is open to avoid crash
  if (!curId) { document.getElementById('word-count').textContent = ''; return; }
  const e = entries.find(x => x.id === curId);
  if (!e) return;
  const allText = (e.sections || []).map(s => s.text).join(' ');
  const words = allText.trim() ? allText.trim().split(/\s+/).length : 0;
  const chars = allText.length;
  document.getElementById('word-count').textContent =
    words + ' word' + (words !== 1 ? 's' : '') + ' · ' + chars + ' character' + (chars !== 1 ? 's' : '');
}

// ══════════════════════════════════════════
// MOOD & TAGS
// ══════════════════════════════════════════
function pickMood(btn, mood) {
  curMood = mood;
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('on'));
  btn.classList.add('on');
}

function resetMoodBtns() {
  document.querySelectorAll('.mbtn').forEach(b => b.classList.remove('on'));
  curMood = '';
}

function tagKey(e) {
  if (e.key === 'Enter' || e.key === ',') {
    e.preventDefault();
    // FIX: strip commas, trim whitespace, reject empty strings and duplicates
    const val = document.getElementById('tag-in').value.replace(/,/g, '').trim();
    if (val && !curTags.includes(val)) { curTags.push(val); renderTags(); }
    document.getElementById('tag-in').value = '';
  }
}

function removeTag(tag) { curTags = curTags.filter(t => t !== tag); renderTags(); }

function renderTags() {
  const wrap = document.getElementById('tags-wrap');
  wrap.querySelectorAll('.tag-pill').forEach(p => p.remove());
  const input = document.getElementById('tag-in');
  curTags.forEach(tag => {
    const pill = document.createElement('div');
    pill.className = 'tag-pill';
    // FIX: use DOM creation instead of innerHTML with injected tag strings to prevent XSS
    const span = document.createElement('span');
    span.textContent = tag;
    const btn = document.createElement('button');
    btn.textContent = '✕';
    btn.onclick = () => removeTag(tag);
    pill.appendChild(span);
    pill.appendChild(btn);
    wrap.insertBefore(pill, input);
  });
}

// ══════════════════════════════════════════
// STATS
// ══════════════════════════════════════════
function renderStats() {
  const grid = document.getElementById('stats-grid');
  if (!grid) return;

  const totalEntries = entries.length;
  const totalWords = entries.reduce((sum, e) => {
    const txt = (e.sections || []).map(s => s.text).join(' ').trim();
    return sum + (txt ? txt.split(/\s+/).length : 0);
  }, 0);

  const streak = calcStreak();
  const moodCounts = {};
  entries.forEach(e => { if (e.mood) moodCounts[e.mood] = (moodCounts[e.mood] || 0) + 1; });
  const moodOrder = ['🌟 Great','😊 Good','😐 Okay','😔 Low','😤 Frustrated'];
  const maxMood = Math.max(...Object.values(moodCounts), 1);

  grid.innerHTML =
    '<div class="streak-box">' +
      '<div class="streak-flame">🔥</div>' +
      '<div class="streak-info">' +
        '<div class="streak-num">' + streak + ' day' + (streak !== 1 ? 's' : '') + '</div>' +
        '<div class="streak-lbl">Writing streak</div>' +
      '</div>' +
    '</div>' +
    '<div class="stat-box"><div class="stat-num">' + totalEntries + '</div><div class="stat-lbl">Entries</div></div>' +
    '<div class="stat-box"><div class="stat-num">' + fmtNum(totalWords) + '</div><div class="stat-lbl">Words</div></div>' +
    '<div class="mood-bar-wrap"><div class="mood-bar-lbl">Mood overview</div><div class="mood-bars">' +
    moodOrder.map(m => {
      const cnt = moodCounts[m] || 0;
      const pct = cnt ? Math.round((cnt / maxMood) * 100) : 0;
      return '<div class="mood-bar-row">' +
        '<span style="width:18px">' + m.split(' ')[0] + '</span>' +
        '<div class="mood-bar-fill-wrap"><div class="mood-bar-fill" style="width:' + pct + '%"></div></div>' +
        '<span class="mood-bar-count">' + cnt + '</span>' +
        '</div>';
    }).join('') +
    '</div></div>';
}

// FIX: streak handles today-only, yesterday-only (not yet written today), and consecutive days correctly
function calcStreak() {
  if (entries.length === 0) return 0;
  const days = new Set(entries.map(e => e.date.slice(0, 10)));
  let streak = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let d = new Date(today);

  // If no entry today, check if streak should start from yesterday
  if (!days.has(d.toISOString().slice(0, 10))) {
    d.setDate(d.getDate() - 1);
    if (!days.has(d.toISOString().slice(0, 10))) return 0;
  }

  while (true) {
    const key = d.toISOString().slice(0, 10);
    if (days.has(key)) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

function fmtNum(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'k' : n; }

// ══════════════════════════════════════════
// EXPORT
// ══════════════════════════════════════════
function openExportModal() { document.getElementById('export-modal').classList.add('open'); }
function closeExportModal() { document.getElementById('export-modal').classList.remove('open'); }

function selectExportFmt(fmt) {
  exportFmt = fmt;
  ['txt','html','json'].forEach(f => {
    document.getElementById('opt-' + f).classList.toggle('selected', f === fmt);
  });
}

function selectScope(scope) {
  exportScope = scope;
  ['current','all'].forEach(s => {
    document.getElementById('scope-' + s).classList.toggle('selected', s === scope);
  });
}

function doExport() {
  // FIX: flush live DOM content before exporting
  flushSectionsFromDOM();
  const toExport = exportScope === 'all' ? entries : entries.filter(e => e.id === curId);
  if (!toExport.length) { toast('Nothing to export.'); closeExportModal(); return; }

  let content = '', filename = '', mime = '';

  if (exportFmt === 'txt') {
    content = toExport.map(e => {
      const sections = (e.sections || []).map(s =>
        ' [' + fmtTimestamp(s.ts) + ']\n ' + (s.text || '(empty)')
      ).join('\n\n');
      return '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
        (e.title || 'Untitled') + '\n' +
        fmtDate(e.date) + (e.mood ? ' | ' + e.mood : '') + (e.tags && e.tags.length ? ' | #' + e.tags.join(' #') : '') + '\n' +
        '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n' +
        sections + '\n';
    }).join('\n\n');
    filename = 'solace-diary-' + Date.now() + '.txt';
    mime = 'text/plain';

  } else if (exportFmt === 'json') {
    content = JSON.stringify({ exported: new Date().toISOString(), entries: toExport }, null, 2);
    filename = 'solace-backup-' + Date.now() + '.json';
    mime = 'application/json';

  } else if (exportFmt === 'html') {
    const entriesHTML = toExport.map(e => {
      const sectionsHTML = (e.sections || []).map(s =>
        '<div class="section">' +
        '<div class="sec-ts">' + fmtTimestamp(s.ts) + '</div>' +
        '<p>' + esc(s.text || '').replace(/\n/g,'<br/>') + '</p>' +
        '</div>'
      ).join('');
      return '<article>' +
        '<h2>' + esc(e.title || 'Untitled') + '</h2>' +
        '<div class="meta">' + fmtDate(e.date) + (e.mood ? ' &nbsp;·&nbsp; ' + e.mood : '') + (e.tags && e.tags.length ? ' &nbsp;·&nbsp; #' + e.tags.join(' #') : '') + '</div>' +
        sectionsHTML + '</article>';
    }).join('');

    content = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>' +
      '<title>Solace — My Diary</title>' +
      '<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;1,400&family=Lato:wght@300;400;700&display=swap" rel="stylesheet"/>' +
      '<style>body{font-family:\'Lato\',sans-serif;max-width:720px;margin:0 auto;padding:3rem 2rem;background:#f7f4ee;color:#1c1c1c;}' +
      'h1{font-family:\'Playfair Display\',serif;color:#013220;font-size:2.5rem;font-weight:400;letter-spacing:0.1em;margin-bottom:0.2rem;}' +
      '.subtitle{color:#6b7c74;font-size:0.8rem;letter-spacing:0.2em;text-transform:uppercase;margin-bottom:3rem;}' +
      'article{margin-bottom:3rem;padding:2rem;background:white;border-radius:16px;border:1px solid rgba(1,121,111,0.15);}' +
      'h2{font-family:\'Playfair Display\',serif;font-size:1.6rem;color:#013220;font-weight:400;margin-bottom:0.3rem;}' +
      '.meta{font-size:0.75rem;color:#6b7c74;margin-bottom:1.5rem;letter-spacing:0.05em;}' +
      '.section{margin-bottom:1.5rem;}' +
      '.sec-ts{font-size:0.65rem;color:#01796F;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.4rem;padding-bottom:0.3rem;border-bottom:1px solid rgba(1,121,111,0.15);}' +
      'p{font-family:\'Playfair Display\',serif;font-size:1.1rem;line-height:1.9;color:#1c1c1c;}</style></head><body>' +
      '<h1>Solace</h1>' +
      '<div class="subtitle">My Private Diary — Exported ' + new Date().toLocaleDateString() + '</div>' +
      entriesHTML + '</body></html>';
    filename = 'solace-diary-' + Date.now() + '.html';
    mime = 'text/html';
  }

  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  closeExportModal();
  toast('Exported successfully ✓');
}

// ══════════════════════════════════════════
// THEME
// ══════════════════════════════════════════
function toggleTheme() {
  isDarkMode = !isDarkMode;
  if (isDarkMode) {
    document.body.classList.add('dark-mode');
    document.getElementById('theme-toggle').textContent = '☀️';
  } else {
    document.body.classList.remove('dark-mode');
    document.getElementById('theme-toggle').textContent = '🌙';
  }
  localStorage.setItem('sol_dark_mode', isDarkMode);
}

// ══════════════════════════════════════════
// CALENDAR
// ══════════════════════════════════════════
function openCalendar() {
  calendarMonth = new Date();
  renderCalendar();
  document.getElementById('calendar-modal').classList.add('open');
}

function closeCalendar() {
  document.getElementById('calendar-modal').classList.remove('open');
}

function renderCalendar() {
  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();

  // Set header
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cal-month-year').textContent = monthNames[month] + ' ' + year;

  // Get all dates that have entries
  const entryDates = new Set(entries.map(e => e.date.slice(0, 10)));

  // Build calendar
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDate = new Date(firstDay);
  startDate.setDate(startDate.getDate() - firstDay.getDay());

  const grid = document.getElementById('cal-grid');
  grid.innerHTML = '';

  // Day labels
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  dayLabels.forEach(label => {
    const labelEl = document.createElement('div');
    labelEl.className = 'cal-day-label';
    labelEl.textContent = label;
    grid.appendChild(labelEl);
  });

  // Days
  const currentDate = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 42; i++) {
    const dayBtn = document.createElement('button');
    dayBtn.className = 'cal-day';
    dayBtn.textContent = currentDate.getDate();

    const dateStr = currentDate.toISOString().slice(0, 10);
    if (currentDate.getMonth() !== month) dayBtn.classList.add('other-month');
    if (entryDates.has(dateStr)) dayBtn.classList.add('has-entry');
    if (currentDate.getTime() === today.getTime()) dayBtn.classList.add('today');

    const clickDate = new Date(currentDate);
    dayBtn.onclick = () => {
      const entriesOnDate = entries.filter(e => e.date.slice(0, 10) === clickDate.toISOString().slice(0, 10));
      if (entriesOnDate.length > 0) {
        closeCalendar();
        loadEntry(entriesOnDate[0].id);
      }
    };

    grid.appendChild(dayBtn);
    currentDate.setDate(currentDate.getDate() + 1);
  }
}

function prevMonth() {
  calendarMonth.setMonth(calendarMonth.getMonth() - 1);
  renderCalendar();
}

function nextMonth() {
  calendarMonth.setMonth(calendarMonth.getMonth() + 1);
  renderCalendar();
}

// ══════════════════════════════════════════
// SETTINGS
// ══════════════════════════════════════════
function openSettings() {
  document.getElementById('pin-err').textContent = '';
  document.getElementById('old-pin').value = '';
  document.getElementById('new-pin1').value = '';
  document.getElementById('new-pin2').value = '';
  document.getElementById('settings-modal').classList.add('open');
}

function closeSettings() {
  document.getElementById('settings-modal').classList.remove('open');
}

function changePIN() {
  const oldPin = document.getElementById('old-pin').value.trim();
  const newPin1 = document.getElementById('new-pin1').value.trim();
  const newPin2 = document.getElementById('new-pin2').value.trim();
  const err = document.getElementById('pin-err');

  if (!oldPin) { err.textContent = 'Enter your current PIN.'; return; }
  if (!newPin1) { err.textContent = 'Enter a new PIN.'; return; }
  if (!newPin2) { err.textContent = 'Confirm your new PIN.'; return; }
  if (!/^\d{4}$/.test(newPin1)) { err.textContent = 'PIN must be exactly 4 digits.'; return; }
  if (newPin1 !== newPin2) { err.textContent = 'New PINs do not match.'; return; }

  const savedPin = localStorage.getItem('sol_pin');
  if (oldPin !== savedPin) { err.textContent = 'Current PIN is incorrect.'; return; }

  localStorage.setItem('sol_pin', newPin1);
  err.textContent = '';
  closeSettings();
  toast('PIN updated ✓');
}
// ══════════════════════════════════════════
// FIX: clear input before async call so UI feels instant; don't wait for response
function chipSend(text) {
  document.getElementById('ai-in').value = text;
  sendAI();
}

async function sendAI() {
  const input = document.getElementById('ai-in');
  const text = input.value.trim();
  if (!text) return;
  input.value = ''; // FIX: clear immediately

  // FIX: flush DOM before reading section content for AI context
  flushSectionsFromDOM();

  const e = entries.find(x => x.id === curId);
  let userMsg = text;
  if (e && e.sections) {
    const fullText = e.sections.map(s => '[' + fmtTimestamp(s.ts) + '] ' + s.text).join('\n\n');
    if (fullText.trim()) {
      userMsg = '[Current entry' + (e.title ? ' titled "' + e.title + '"' : '') +
        ': "' + fullText.slice(0, 400) + (fullText.length > 400 ? '…' : '') + '"]\n\n' + text;
    }
  }

  addMsg('user', text);
  aiHistory.push({ role: 'user', content: userMsg });
  const typingEl = addTyping();

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': 'sk-ant-YOUR_API_KEY_HERE',
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 1000,
        system: SYSTEM,
        messages: aiHistory
      })
    });
    const data = await res.json();
    typingEl.remove();
    if (data.content && data.content[0]) {
      const reply = data.content.map(b => b.text || '').join('');
      addMsg('ai', reply);
      aiHistory.push({ role: 'assistant', content: reply });
    } else {
      addMsg('ai', "I'm here — something went quiet on my end. Try again?");
    }
  } catch (err) {
    typingEl.remove();
    addMsg('ai', "I couldn't connect just now. Check your connection and try again.");
  }
}

// FIX: use textContent (safe, no XSS); white-space:pre-wrap in CSS handles newlines correctly
function addMsg(role, text) {
  const msgs = document.getElementById('ai-msgs');
  const div = document.createElement('div');
  div.className = 'msg ' + role;
  div.textContent = text;
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

function addTyping() {
  const msgs = document.getElementById('ai-msgs');
  const div = document.createElement('div');
  div.className = 'msg typing';
  div.innerHTML = '<span class="dot"></span><span class="dot"></span><span class="dot"></span>';
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

// ══════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════
function esc(s) {
  return String(s)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;');
}

// FIX: guard against invalid date strings
function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleDateString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric' });
}

function fmtTimestamp(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return iso || '';
  return d.toLocaleString('en-US', { weekday:'short', month:'short', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true });
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// FIX: use autoSave() not saveEntry() for background saves to avoid overwriting blank titles
setInterval(() => { if (curId) autoSave(); }, 30000);

function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const isOpen = sidebar.classList.contains('show');
  if (isOpen) {
    sidebar.classList.remove('show');
    document.removeEventListener('click', closeSidebarOnClick);
  } else {
    sidebar.classList.add('show');
    setTimeout(() => document.addEventListener('click', closeSidebarOnClick), 10);
  }
}

function closeSidebarOnClick(e) {
  const sidebar = document.querySelector('.sidebar');
  if (!sidebar.contains(e.target) && !e.target.closest('.menu-btn')) {
    sidebar.classList.remove('show');
    document.removeEventListener('click', closeSidebarOnClick);
  }
}

init();
