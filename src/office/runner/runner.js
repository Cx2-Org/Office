// Runner mode (the online site's default; ?demo plays the fictional demo instead): the CI bot team from its public
// status feed, polled every 30 s. Each bot account is a boss at its own desks, each of its jobs a subagent, each running
// machine a small server box on the boss's desk; the queue goes on the whiteboard. The mapping is in feed.js.
import { state } from '../core/state.js';
import { $, el, rand } from '../core/env.js';
import { setConn, upsertSession } from '../net/live.js';
import { onEvent } from '../life/incidents.js';
import { onTodos } from '../ui/whiteboard.js';
import { demoLog } from '../demo/demo.js';
import { logLine } from '../demo/demo-log.js';
import { feedSessions, finishedJobs, jobId, jobTag, jobsMap, machinesSnap, queueTodos, toolsOf } from './feed.js';
import { t as tr } from '../../i18n/index.js';

const FEED = 'https://raw.githubusercontent.com/Cx2-Org/Runner/status/status.json';
const live = new Map();   // session id -> the session object this page keeps (subs keep their last step)
let snap = { runner: true, machines: 0, queued: 0, cpu: { percent: 15 }, devServers: [] }, prevJobs = null, seq = 0;
/** what the Mac panel reads in runner mode: the machines only (ui/mac-drawer.js) */
export const runnerSnap = () => snap;

function emit(s, type, label = '', extra = {}) {
  const now = Date.now(), e = { id: ++seq, ts: now, sess: s.id, name: s.name, type, label, ...extra };
  if (!extra.agent && !['wait', 'stop', 'substart', 'substop', 'deploy'].includes(type)) s.last = { type, label };
  s.lastAt = now;
  const k = { read: 'read', grep: 'read', edit: 'edit', write: 'edit', bash: 'cmd' }[type];
  if (k && !extra.agent) s.counts[k] = (s.counts[k] || 0) + 1;
  const st = { prompt: 'prompts', read: 'read', grep: 'read', edit: 'edit', write: 'edit', bash: 'cmd', test: 'cmd', deploy: 'deploy' }[type];
  if (st) state.stats[st] = (state.stats[st] || 0) + 1;
  logLine(demoLog, extra.agent || s.id, type === 'prompt' ? { role: 'user', text: label, ts: now }
    : !['wait', 'stop', 'substart', 'substop', 'testok', 'testfail'].includes(type) ? { role: 'tool', type: type === 'test' ? 'bash' : type, label, ts: now } : null);
  upsertSession({ ...s, subs: s.subs.map((x) => ({ ...x })) });
  onEvent(e);
}

// every 1.5–3.2 s (the demo's pace) one of the boss's jobs takes a step by its phase; now and then the boss too
function tick(s) {
  setTimeout(() => {
    if (s.subs.length && s.status !== 'rest') {
      const sub = s.subs[(s.turn = (s.turn || 0) + 1) % s.subs.length], job = s.jobs.find((j) => jobId(j.number) === sub.id);
      const tools = toolsOf(job), type = tools[Math.floor(Math.random() * tools.length)];
      sub.last = { type, label: sub.type }; sub.steps = (sub.steps || 0) + 1;
      emit(s, type, sub.type, { agent: sub.id, agentType: sub.type, quiet: true });
      if (s.status === 'work' && Math.random() < 0.5) emit(s, type, job ? jobTag(job) : sub.type);
    }
    tick(s);
  }, rand(1500, 3200));
}

function apply(feed) {
  const first = prevJobs === null, finished = first ? [] : finishedJobs(prevJobs, feed).filter((x) => x.done);
  const reported = new Set(finished.map((x) => x.bot));   // (their stop comes with the test result)
  for (const f of feedSessions(feed)) {
    let s = live.get(f.id);
    if (!s) {
      s = { id: f.id, pid: 0, name: f.name, dir: f.dir, link: null, desk: -1, status: f.status, lastPrompt: f.lastPrompt, taskStart: f.status === 'rest' ? 0 : Date.now(),
        usage: { cost: f.cost, ctx: 0, ctxMax: 200000, model: f.jobs[0]?.model || '', out: 0 },
        counts: { read: 0, edit: 0, cmd: 0, web: 0 }, subs: f.subs.map((x) => ({ ...x, last: null, steps: 0 })), doneSubs: [], todos: [], last: null, lastAt: Date.now(), jobs: f.jobs, stuck: f.stuck };
      live.set(s.id, s); upsertSession(s, !first); tick(s);
      continue;
    }
    const was = s.status, had = new Map(s.subs.map((x) => [x.id, x]));
    Object.assign(s, { status: f.status, stuck: f.stuck, lastPrompt: f.lastPrompt, jobs: f.jobs, usage: { ...(s.usage || {}), cost: f.cost } });
    s.subs = f.subs.map((x) => Object.assign(had.get(x.id) || { last: null, steps: 0 }, x));
    const ids = new Set(s.subs.map((x) => x.id));
    for (const [id, x] of had) if (!ids.has(id)) emit(s, 'substop', x.type, { agent: id });
    for (const x of s.subs) if (!had.has(x.id)) emit(s, 'substart', x.type, { agent: x.id, quiet: false });
    if (s.status === 'work' && was !== 'work') { s.taskStart = Date.now(); emit(s, 'prompt', s.lastPrompt); }
    else if (s.status === 'wait' && was !== 'wait') emit(s, 'wait', tr('demo.runner.stuck', { job: f.stuck?.label || '' }));
    else if (s.status === 'rest' && was !== 'rest') { s.taskStart = 0; if (reported.has(s.name)) upsertSession({ ...s, subs: [] }); else emit(s, 'stop'); }
    else upsertSession({ ...s, subs: s.subs.map((x) => ({ ...x })) });
  }
  // finished work: a run at the test board, green from a score of 6, then the report; a 9 or better is a deploy
  for (const { number, bot, done } of finished) {
    const s = [...live.values()].find((x) => x.name === bot); if (!s) continue;
    const tag = jobTag({ number, code: done.code }), score = Number(done.score), ok = score >= 6;
    emit(s, 'test', tag, { runner: 'ci' });
    setTimeout(() => {
      emit(s, ok ? 'testok' : 'testfail', 'ci', ok ? { pass: 1, fail: 0 } : { pass: 0, fail: 1 });
      if (score >= 9) emit(s, 'deploy', tag);
      emit(s, 'stop', tag);
    }, rand(3500, 6500));
  }
  prevJobs = jobsMap(feed);
  snap = machinesSnap(feed);
  state.todos = queueTodos(feed.queue, tr); onTodos();
  $('demo-chip').replaceChildren('CI', el('span', 'demo-more', ` · ${tr('demo.runner.chip', { machines: snap.machines, waiting: feed.queue?.waiting ?? 0 })}`));
}

async function poll() {
  const src = new URLSearchParams(location.search).get('feed') || FEED;   // (?feed=…: a local copy, for testing)
  try {
    const r = await fetch(`${src}${src.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    apply(await r.json());
    setConn(true); state.connectedOnce = true;
  } catch { setConn(false); }
}

export function startRunner() {
  $('demo-chip').hidden = false;
  $('btn-mac').hidden = true;   // (no Mac behind this page: the machines are the boxes on the desks and the chip's count)
  state.stats = { prompts: 0, read: 0, edit: 0, cmd: 0, deploy: 0 };
  state.todos = []; onTodos();
  poll(); setInterval(poll, 30_000);
}
