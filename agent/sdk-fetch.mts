import type { ZooworkConfig } from '@zoowork-ai/sdk';

type SdkFetch = NonNullable<ZooworkConfig['fetch']>;

// Bound API requests without cutting off the long-lived SSE response. The
// stream receives its own turn deadline through documented streamEvents.signal.
export function boundedSdkFetch(fetcher: SdkFetch = fetch, timeoutMs = 30000): SdkFetch {
  return (input, init = {}) => {
    if (new Headers(init.headers).get('accept')?.includes('text/event-stream')) return fetcher(input, init);
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return fetcher(input, { ...init, signal });
  };
}
