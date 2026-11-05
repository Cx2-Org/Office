import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedSessions, finishedJobs, jobsMap, machinesSnap, queueTodos, toolsOf } from '../../src/office/runner/feed.js';

const job = (number, code, key, machine = { os: 'ubuntu-latest', startedAt: '2026-11-05T17:10:00Z', status: 'in_progress' }) =>
  ({ number, code, phase: { key, text: key === 'code' ? 'Đang code' : key }, progress: { done: 1, total: 3 }, model: 'opus', machine });
const FEED = {
  at: '2026-11-05T17:25:10.008Z',
  bots: [
    { name: 'Captain Queenie', role: 'Trưởng nhóm', state: 'code', jobs: [job(17, 'E09', 'code'), job(18, 'E10', 'plan', null)] },
    { name: 'Iron Man', state: 'idle', jobs: [] },
    { name: 'Spider Man', state: 'stuck', jobs: [job(21, 'WI0', 'restart')] },
  ],
  machines: [{ issue: 17, os: 'ubuntu-latest', status: 'in_progress' }, { issue: 21, os: 'macos-latest', status: 'in_progress' }, { issue: 30, os: 'ubuntu-latest', status: 'queued' }],
  queue: { waiting: 71, blocked: 70, ready: 1, next: [{ number: 86, code: 'WI1', bot: 'Spider Man' }] },
  done: [{ number: 6, code: 'D00', bot: 'Iron Man', score: 9, confidence: 90 }],
};

test('one boss per bot, one subagent per job, status from its jobs', () => {
  const [q, iron, spider] = feedSessions(FEED);
  assert.equal(q.name, 'Captain Queenie'); assert.equal(q.status, 'work');
  assert.deepEqual(q.subs.map((s) => s.type), ['#17 E09 · ubuntu', '#18 E10'], 'no machine, no OS');
  assert.equal(q.subs[0].desc, 'Đang code · 1/3'); assert.equal(q.subs[0].model, 'opus');
  assert.equal(q.lastPrompt, '#17 E09 · Đang code');
  assert.equal(iron.status, 'rest'); assert.deepEqual(iron.subs, []);
  assert.equal(spider.status, 'wait'); assert.deepEqual(spider.stuck, { kind: 'repeat', label: '#21 WI0' });
  assert.notEqual(q.dir, spider.dir, 'each bot its own area');
  assert.equal(new Set(feedSessions(FEED).flatMap((s) => s.subs.map((x) => x.id))).size, 3);
});

test('phases play tools', () => {
  assert.deepEqual(toolsOf({ phase: { key: 'plan' } }), ['read', 'grep']);
  assert.deepEqual(toolsOf({ phase: { key: 'done' } }), ['test']);
  assert.deepEqual(toolsOf({ phase: { key: 'restart' } }), ['bash']);
  assert.deepEqual(toolsOf({ phase: { key: '??' } }), ['edit', 'write']);
});

test('the queue on the whiteboard, never a made-up title', () => {
  const t = queueTodos(FEED.queue, (k, v) => `${k}:${v.ready}/${v.blocked}`);
  assert.equal(t[0].text, '#86 WI1 — Spider Man');
  assert.equal(t[1].text, 'demo.runner.counts:1/70');
});

test('a job gone from the feed is finished, with its score when done lists it', () => {
  const prev = new Map([[6, 'Iron Man'], [17, 'Captain Queenie'], [99, 'Iron Man']]);
  assert.deepEqual(finishedJobs(prev, FEED), [{ number: 6, bot: 'Iron Man', done: FEED.done[0] }, { number: 99, bot: 'Iron Man', done: null }]);
  assert.deepEqual([...jobsMap(FEED).keys()], [17, 18, 21]);
});

test('running machines become boxes on their boss\'s desk', () => {
  const m = machinesSnap(FEED);
  assert.equal(m.machines, 2); assert.equal(m.queued, 1);
  assert.deepEqual(m.devServers.map((d) => [d.label, d.owner.sid]), [['#17 ubuntu', 'runner-captain-queenie'], ['#21 macos', 'runner-spider-man']]);
});

test('chi phí thật 24 giờ theo bot', () => {
  const feed = { bots: [{ name: 'Iron Man', state: 'idle', jobs: [] }, { name: 'Spider Man', state: 'idle', jobs: [] }],
    costs: { bots: { 'Iron Man': { cost24: 3.25 } } } };
  const [iron, spider] = feedSessions(feed);
  assert.equal(iron.cost, 3.25);
  assert.equal(spider.cost, 0);
});
