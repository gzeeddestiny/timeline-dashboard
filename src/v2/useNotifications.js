import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { listNotifications } from '../lib/fullSystem';
import { blockedRead, quietOptions, READ_INTERVAL } from '../lib/readPolicy';
// Reference counted per QueryClient/account: both headers own one subscription.
const subscriptions = new WeakMap();
export function useNotifications(email, enabled) {
  const client = useQueryClient();
  const key = ['v2-notifications', email];
  const query = useQuery({ queryKey:key, queryFn:listNotifications, ...quietOptions(enabled, false) });
  useEffect(() => {
    if (!enabled || !email) return;
    let entries = subscriptions.get(client);
    if (!entries) { entries = new Map(); subscriptions.set(client, entries); }
    let entry = entries.get(email);
    if (!entry) {
      entry = { users:0, timer:null };
      entry.channel = supabase.channel(`v2-notifications:${email}`)
        .on('postgres_changes', {event:'*',schema:'public',table:'notifications',filter:`recipient_email=eq.${email}`}, () => {
          if (entry.timer) return;
          entry.timer = setTimeout(() => {
            entry.timer = null;
            const state = client.getQueryState(['v2-notifications', email]);
            if (!blockedRead(state?.error)) client.invalidateQueries({queryKey:['v2-notifications',email],refetchType:document.visibilityState === 'hidden' ? 'none' : 'active'});
          }, 500);
        }).subscribe();
      entry.interval = setInterval(() => {
        const state = client.getQueryState(['v2-notifications',email]);
        if (document.visibilityState !== 'hidden' && !blockedRead(state?.error))
          client.invalidateQueries({queryKey:['v2-notifications',email]});
      }, READ_INTERVAL);
      entries.set(email, entry);
    }
    entry.users++;
    return () => {
      if (--entry.users === 0) {
        clearTimeout(entry.timer); clearInterval(entry.interval); supabase.removeChannel(entry.channel); entries.delete(email);
      }
    };
  }, [client,email,enabled]);
  return {...query, setItems: update => client.setQueryData(key, update)};
}
