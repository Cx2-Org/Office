// Runner mode, the pure part: the CI bots' public status feed (Cx2-Org/Runner status.json) turned into the office's
// sessions (one boss per bot account), subagents (one per job) and to-dos. No DOM here, so tests/unit can import it.
// The feed only carries numbers and codes: nothing here makes up a task's title.

// what a job's phase looks like at work (the same tool kinds the demo plays)
export const PHASE_TOOLS = { plan: ['read', 'grep'], code: ['edit', 'write'], work: ['edit', 'write'], done: ['test'], restart: ['bash'] };
export const toolsOf = (job) => PHASE_TOOLS[job?.phase?.key] || PHASE_TOOLS.work;

const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot';
// ('demo-sub-…': demo-log.js keeps only the latest subagents' logs)
export const jobId = (n) => `demo-sub-r${n}`;
export const botId = (name) => `runner-${slug(name)}`;
export const jobTag = (j) => `#${j.number}${j.code ? ` ${j.code}` : ''}`;
/** "#17 E09 · ubuntu" (the machine's OS without "-latest"; no machine, no OS) */
export function jobLabel(j) {
  const os = j.machine?.os ? String(j.machine.os).replace(/-latest$/, '') : '';
  return os ? `${jobTag(j)} · ${os}` : jobTag(j);
}
const jobDesc = (j) => [j.phase?.text, j.progress?.total ? `${j.progress.done || 0}/${j.progress.total}` : ''].filter(Boolean).join(' · ');

/** The sessions the feed describes: [{ id, name, dir, status, stuck, lastPrompt, subs: [{ id, type, desc, model, … }] }] */
export function feedSessions(feed) {
  return (feed?.bots || []).map((b) => {
    const jobs = (b.jobs || []).filter((j) => j && j.number != null);
    const status = b.state === 'stuck' ? 'wait' : jobs.length ? 'work' : 'rest';
    return {
      id: botId(b.name), name: b.name, dir: `~/runner/${b.name}`, role: b.role || '', status,
      // Chi phí thật 24 giờ của bot (giá API quy đổi), runner tính từ dòng "CHI PHÍ" của từng lượt làm.
      cost: Number(feed?.costs?.bots?.[b.name]?.cost24) || 0,
      stuck: b.state === 'stuck' && jobs[0] ? { kind: 'repeat', label: jobTag(jobs[0]) } : null,
      lastPrompt: jobs[0] ? [jobTag(jobs[0]), jobs[0].phase?.text].filter(Boolean).join(' · ') : '',
      jobs,
      subs: jobs.map((j) => ({ id: jobId(j.number), number: j.number, type: jobLabel(j), desc: jobDesc(j), model: j.model || '', startedAt: Date.parse(j.machine?.startedAt) || 0 })),
    };
  });
}

/** The whiteboard: the queue's next items ("#86 WI1 — Spider Man"), then one line of counts. `tr` translates. */
export function queueTodos(queue, tr) {
  if (!queue) return [];
  const next = (queue.next || []).map((q) => ({ id: `q-${q.number}`, text: `${jobTag(q)}${q.bot ? ` — ${q.bot}` : ''}`, done: false }));
  return [...next, { id: 'q-counts', text: tr('demo.runner.counts', { ready: queue.ready ?? 0, blocked: queue.blocked ?? 0, waiting: queue.waiting ?? 0 }), done: false }];
}

/** Jobs gone since `prev` (Map number -> bot name), each with its entry in `done` if it has one. */
export function finishedJobs(prev, feed) {
  const now = new Set(); for (const b of feed?.bots || []) for (const j of b.jobs || []) now.add(j.number);
  const done = new Map((feed?.done || []).map((d) => [d.number, d]));
  return [...prev].filter(([n]) => !now.has(n)).map(([number, bot]) => ({ number, bot, done: done.get(number) || null }));
}
export const jobsMap = (feed) => new Map((feed?.bots || []).flatMap((b) => (b.jobs || []).map((j) => [j.number, b.name])));

/** The machines as the Mac panel's dev servers (a small box on the owning boss's desk), and how busy they keep the racks. */
export function machinesSnap(feed) {
  const owner = jobsMap(feed), list = feed?.machines || [];
  const running = list.filter((m) => m.status === 'in_progress');
  return {
    at: Date.now(), runner: true, machines: running.length, queued: list.length - running.length,
    cpu: { percent: Math.min(100, 15 + running.length * 20) },
    devServers: running.map((m) => {
      const bot = owner.get(m.issue);
      return { pid: m.issue, label: `#${m.issue} ${String(m.os || '').replace(/-latest$/, '')}`.trim(), ports: [m.issue], cpu: 60,
        owner: bot ? { sid: botId(bot), name: bot, alive: true } : null };
    }),
  };
}
