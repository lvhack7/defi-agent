import { open, readFile, stat, unlink } from 'node:fs/promises';
import { readFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

function ownerPid(contents: string): number | undefined {
  let pid: unknown;
  try { pid = JSON.parse(contents)?.pid; } catch { /* legacy plain PID */ }
  if (pid === undefined && /^\d+$/.test(contents.trim())) pid = Number(contents.trim());
  return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined;
}
function isDead(pid: number): boolean {
  try { process.kill(pid, 0); return false; }
  catch (error) {
    // EPERM is not proof that a process is dead.
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

export async function acquireRuntimeLock(path = new URL('./.runtime.lock', import.meta.url)) {
  let handle;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { handle = await open(path, 'wx'); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const previous = await stat(path);
        const contents = await readFile(path, 'utf8');
        const pid = ownerPid(contents);
        if (!pid) throw new Error('Runtime lock is incomplete or invalid. Confirm the backend and CLI are stopped before removing agent/.runtime.lock.');
        if (!isDead(pid)) throw new Error(`Agent backend or CLI process ${pid} is running, or cannot be checked. Use http://localhost:3100 if the server is already running, or stop it with Ctrl+C before restarting.`);
        // Serialize stale-file removal so two simultaneous restarts cannot delete a new owner's file.
        const recoveryPath = new URL(`${path.href}.recovery`);
        const recovery = await open(recoveryPath, 'wx').catch((failure: NodeJS.ErrnoException) => {
          if (failure.code === 'EEXIST') throw new Error('Another startup is recovering the runtime lock. Retry shortly. If a recovery file remains after a crash, confirm all agent processes are stopped before removing it.');
          throw failure;
        });
        try {
          const current = await stat(path);
          if (previous.ino !== current.ino || previous.mtimeMs !== current.mtimeMs || await readFile(path, 'utf8') !== contents) continue;
          if (!isDead(pid)) continue;
          await unlink(path);
        } finally {
          await recovery.close();
          await unlink(recoveryPath).catch(() => {});
        }
      } catch (failure) {
        if ((failure as NodeJS.ErrnoException).code !== 'ENOENT') throw failure;
      }
    }
  }
  if (!handle) throw new Error('Runtime lock changed during startup. Retry after the other startup finishes.');
  const owner = JSON.stringify({ pid: process.pid, token: randomUUID() });
  try { await handle.writeFile(owner); }
  catch (error) { await handle.close(); await unlink(path).catch(() => {}); throw error; }

  let released = false;
  const onExit = () => {
    // Synchronous cleanup also runs after a startup exception or a normal exit.
    try { if (readFileSync(path, 'utf8') === owner) unlinkSync(path); } catch { /* already removed */ }
  };
  const onSignal = async () => { await release(); process.exit(); };
  const release = async () => {
    if (released) return;
    released = true;
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    process.removeListener('exit', onExit);
    await handle.close();
    try { if (await readFile(path, 'utf8') === owner) await unlink(path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  process.once('exit', onExit);
  return release;
}
