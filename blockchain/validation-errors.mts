import { BaseFeeError } from './base-fees.mts';

export function validationFailure(error: unknown, stage: string) {
  const failedStage = error instanceof BaseFeeError ? error.component : stage;
  let current = error, type = 'UnknownError', code: number | undefined, httpStatus: number | undefined;
  const seen = new Set<unknown>();
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const value = current as { name?: unknown; code?: unknown; status?: unknown; cause?: unknown };
    if (typeof value.name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,80}$/.test(value.name)) type = value.name;
    if (typeof value.code === 'number' && Number.isFinite(value.code)) code = value.code;
    if (typeof value.status === 'number' && value.status >= 100 && value.status < 600) httpStatus = value.status;
    current = value.cause;
  }
  return { stage: failedStage, type, ...(code !== undefined ? { code } : {}), ...(httpStatus !== undefined ? { httpStatus } : {}) };
}
