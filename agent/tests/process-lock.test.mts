import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { acquireRuntimeLock } from '../process-lock.mts';
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'defi-lock-'));
  return { path: pathToFileURL(join(dir, 'runtime.lock')), cleanup: () => rm(dir, { recursive: true, force: true }) };
}
test('live owner is preserved and release is idempotent', async () => {
  const f = await fixture();
  const release = await acquireRuntimeLock(f.path);
  try {
    await assert.rejects(acquireRuntimeLock(f.path), /is running, or cannot be checked/);
    assert.equal(JSON.parse(await readFile(f.path, 'utf8')).pid, process.pid);
    await release(); await release();
    await assert.rejects(readFile(f.path), { code: 'ENOENT' });
  } finally { await release(); await f.cleanup(); }
});
test('recovers a legacy lock only after the owning process exited', async () => {
  const f = await fixture();
  const child = spawnSync(process.execPath, ['-e', '']);
  assert.equal(child.status, 0);
  await writeFile(f.path, String(child.pid));
  const release = await acquireRuntimeLock(f.path);
  try { assert.equal(JSON.parse(await readFile(f.path, 'utf8')).pid, process.pid); }
  finally { await release(); await f.cleanup(); }
});
test('does not delete an invalid lock or a replacement owner record', async () => {
  const f = await fixture();
  try {
    await writeFile(f.path, 'broken');
    await assert.rejects(acquireRuntimeLock(f.path), /incomplete or invalid/);
    assert.equal(await readFile(f.path, 'utf8'), 'broken');
    await rm(f.path);
    const release = await acquireRuntimeLock(f.path);
    await writeFile(f.path, 'replacement');
    await release();
    assert.equal(await readFile(f.path, 'utf8'), 'replacement');
  } finally { await f.cleanup(); }
});
test('a startup exception removes its own lock on process exit', async () => {
  const f = await fixture();
  try {
    const moduleUrl = new URL('../process-lock.mts', import.meta.url).href;
    const child = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `const {acquireRuntimeLock}=await import(${JSON.stringify(moduleUrl)});await acquireRuntimeLock(new URL(${JSON.stringify(f.path.href)}));throw new Error('fixture startup failure')`]);
    assert.equal(child.status, 1);
    await assert.rejects(readFile(f.path), { code: 'ENOENT' });
  } finally { await f.cleanup(); }
});

test('simultaneous recovery never removes the winning process lock', async () => {
  const f = await fixture();
  const child = spawnSync(process.execPath, ['-e', '']);
  await writeFile(f.path, String(child.pid));
  const results = await Promise.allSettled([acquireRuntimeLock(f.path), acquireRuntimeLock(f.path)]);
  try {
    const winners = results.filter(result => result.status === 'fulfilled');
    assert.equal(winners.length, 1);
    assert.equal(JSON.parse(await readFile(f.path, 'utf8')).pid, process.pid);
  } finally {
    for (const result of results) if (result.status === 'fulfilled') await result.value();
    await f.cleanup();
  }
});
