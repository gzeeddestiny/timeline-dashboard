export const READ_INTERVAL = 120_000;
export function missingSchema(error) {
  return ['42P01', '42703', 'PGRST202', 'PGRST204', 'PGRST205'].includes(error?.code);
}
export function blockedRead(error) {
  return missingSchema(error) || [401, 402, 403, 429].includes(Number(error?.status || error?.code)) ||
    ['42501', 'PGRST301', 'PGRST302', 'PGRST303'].includes(error?.code) || /quota|rate.?limit|payment required|exceed.*limit/i.test(error?.message || '');
}
export function quietOptions(enabled = true, poll = true) {
  return {
    enabled,
    staleTime: READ_INTERVAL,
    retry: false,
    retryOnMount: false,
    refetchOnMount: q => !blockedRead(q.state.error),
    refetchOnWindowFocus: q => !blockedRead(q.state.error),
    refetchOnReconnect: q => !blockedRead(q.state.error),
    refetchInterval: q => enabled && poll && !blockedRead(q.state.error) ? READ_INTERVAL : false,
    refetchIntervalInBackground: false,
  };
}
