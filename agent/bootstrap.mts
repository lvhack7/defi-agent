import { createInterface } from 'node:readline/promises';
import { assistantText } from '@zoowork-ai/sdk';
import { acquireRuntimeLock } from './process-lock.mts';
const release = await acquireRuntimeLock();
const { chat } = await import('./runtime.mts');
const prompt = createInterface({ input: process.stdin, output: process.stdout });
try {
  while (true) {
    let message: string;
    try { message = (await prompt.question('\nYou (or /quit): ')).trim(); } catch { break; }
    if (message === '/quit') break;
    if (message) await chat(message, event => process.stdout.write(assistantText(event)));
  }
} finally { prompt.close(); await release(); }
