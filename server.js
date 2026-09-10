/**
 * Exercise slider instrument — server.
 * Node + Express. Serves the page, holds the session state, streams changes to clients.
 *
 * Environment variables:
 *   FACILITATOR_CODE  code for the facilitator panel        (default: chair)
 *   DATA_DIR          where the JSON file is written        (default: ./data)
 *   DATABASE_URL      if set, Postgres is used instead of the file
 *   PORT              set automatically by Render
 */

const express = require('express');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const CODE = process.env.FACILITATOR_CODE || 'chair';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');

const DEFAULT_STATE = {
  session: {
    title: 'Diplomatic responses to a regional AI-enabled incident',
    round: 1,
    phase: 'closed',
    rounds: ['Round 1: Trigger', 'Round 2: Escalation', 'Round 3: Global emergency'],
    questions: [
      { text: 'How concerned are you?',
        left: 'Not at all (0)', right: 'Extremely (10)' },
      { text: 'Should this be termed a crisis?',
        left: 'No', right: 'Yes' },
      { text: 'How well do you understand the cause of the problem?',
        left: 'Not at all (0)', right: 'Completely (10)' }
    ]
  },
  responses: {}   // { pid: { "1": [q1,q2,q3], "2": [...], "3": [...] } }
};

/* ------------------------------------------------------------------ */
/* Storage: Postgres when DATABASE_URL is set, otherwise a JSON file.   */
/* ------------------------------------------------------------------ */
let state = JSON.parse(JSON.stringify(DEFAULT_STATE));
let pool = null;
let writeTimer = null;

async function loadState() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    await pool.query('CREATE TABLE IF NOT EXISTS instrument_state (id int PRIMARY KEY, doc jsonb NOT NULL)');
    const r = await pool.query('SELECT doc FROM instrument_state WHERE id = 1');
    if (r.rows.length) {
      state = r.rows[0].doc;
      console.log('State loaded from Postgres.');
    } else {
      await persistNow();
      console.log('New state written to Postgres.');
    }
    return;
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    state = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    console.log('State loaded from ' + DATA_FILE);
  } catch (e) {
    console.log('No saved state found. Starting fresh at ' + DATA_FILE);
    persistNow();
  }
}

async function persistNow() {
  try {
    if (pool) {
      await pool.query(
        'INSERT INTO instrument_state (id, doc) VALUES (1, $1) ' +
        'ON CONFLICT (id) DO UPDATE SET doc = EXCLUDED.doc', [state]);
    } else {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DATA_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(state));
      fs.renameSync(tmp, DATA_FILE);
    }
  } catch (e) {
    console.error('Could not save state:', e.message);
  }
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(persistNow, 400);
}

/* ------------------------------------------------------------------ */
/* Live updates                                                        */
/* ------------------------------------------------------------------ */
const clients = new Set();
let dataPingAt = 0;
let dataPingTimer = null;

function send(res, payload) {
  res.write('data: ' + JSON.stringify(payload) + '\n\n');
}
function broadcastSession() {
  clients.forEach(res => send(res, { type: 'session', session: state.session }));
}
function broadcastData() {
  // at most one ping every 1.5s, so thirty people dragging sliders stays cheap
  const now = Date.now();
  if (now - dataPingAt > 1500) {
    dataPingAt = now;
    clients.forEach(res => send(res, { type: 'data' }));
  } else if (!dataPingTimer) {
    dataPingTimer = setTimeout(() => {
      dataPingTimer = null;
      dataPingAt = Date.now();
      clients.forEach(res => send(res, { type: 'data' }));
    }, 1500);
  }
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */
const app = express();
app.use(express.json({ limit: '32kb' }));

// The page lives beside this file. Nothing else in the folder is served.
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));

function ok(code) { return String(code || '') === String(CODE); }
function deny(res) { return res.status(403).json({ error: 'That code is not right.' }); }
function clean(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return isNaN(n) ? null : Math.round(n * 10) / 10;
}

app.get('/api/state', (req, res) => res.json(state.session));

app.get('/api/mine', (req, res) => {
  const pid = String(req.query.pid || '');
  res.json({ pid, v: state.responses[pid] || {} });
});

app.post('/api/save', (req, res) => {
  const { pid, round, vals } = req.body || {};
  if (!pid || !Array.isArray(vals)) return res.status(400).json({ error: 'bad request' });
  if (Number(round) !== state.session.round || state.session.phase !== 'open') {
    return res.json({ ok: false, reason: 'closed', session: state.session });
  }
  if (!state.responses[pid]) state.responses[pid] = {};
  state.responses[pid][String(round)] = [clean(vals[0]), clean(vals[1]), clean(vals[2])];
  persist();
  broadcastData();
  res.json({ ok: true });
});

app.get('/api/events', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders && res.flushHeaders();
  send(res, { type: 'session', session: state.session });
  clients.add(res);
  const beat = setInterval(() => res.write(': ping\n\n'), 20000);
  req.on('close', () => { clearInterval(beat); clients.delete(res); });
});

/* ------------------------------- admin ------------------------------- */
app.post('/api/admin/check', (req, res) =>
  ok(req.body && req.body.code) ? res.json({ ok: true }) : deny(res));

app.get('/api/admin/all', (req, res) => {
  if (!ok(req.query.code)) return deny(res);
  res.json({
    session: state.session,
    records: Object.keys(state.responses).map(pid => ({ pid, v: state.responses[pid] }))
  });
});

app.post('/api/admin/round', (req, res) => {
  if (!ok(req.body && req.body.code)) return deny(res);
  const r = Number(req.body.round);
  if (r >= 1 && r <= 3) state.session.round = r;
  state.session.phase = req.body.phase === 'open' ? 'open' : 'closed';
  persist();
  broadcastSession();
  res.json(state.session);
});

app.post('/api/admin/config', (req, res) => {
  if (!ok(req.body && req.body.code)) return deny(res);
  const c = req.body.cfg || {};
  if (typeof c.title === 'string') state.session.title = c.title;
  if (Array.isArray(c.rounds)) state.session.rounds = c.rounds.map(String).slice(0, 3);
  if (Array.isArray(c.questions)) {
    state.session.questions = c.questions.slice(0, 3).map(q => ({
      text: String(q.text || ''), left: String(q.left || ''), right: String(q.right || '')
    }));
  }
  persist();
  broadcastSession();
  res.json(state.session);
});

app.post('/api/admin/clear', (req, res) => {
  if (!ok(req.body && req.body.code)) return deny(res);
  state.responses = {};
  state.session.round = 1;
  state.session.phase = 'closed';
  persist();
  broadcastSession();
  broadcastData();
  res.json(state.session);
});

app.get('/api/admin/export.csv', (req, res) => {
  if (!ok(req.query.code)) return deny(res);
  const q = state.session.questions.map(x => '"' + x.text.replace(/"/g, '""') + '"');
  let out = 'participant,round,' + q.join(',') + '\n';
  Object.keys(state.responses).forEach(pid => {
    for (let r = 1; r <= 3; r++) {
      const v = state.responses[pid][String(r)];
      if (!v) continue;
      out += [pid, r, v[0] === null ? '' : v[0], v[1] === null ? '' : v[1],
              v[2] === null ? '' : v[2]].join(',') + '\n';
    }
  });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', 'attachment; filename="exercise-results-' + stamp + '.csv"');
  res.send(out);
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

/* ------------------------------------------------------------------ */
loadState().then(() => {
  app.listen(PORT, () => console.log('Listening on ' + PORT));
});

['SIGTERM', 'SIGINT'].forEach(sig =>
  process.on(sig, async () => { await persistNow(); process.exit(0); }));
