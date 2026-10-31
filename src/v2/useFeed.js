import { useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { quietOptions } from '../lib/readPolicy';
import { fetchFeed } from './data';

// Poll only the newest page; retained older pages are loaded on explicit demand.
export function useFeed(queryKey, table, taskKey, enabled) {
  const client = useQueryClient();
  const identity = JSON.stringify(queryKey);
  const resetFirst = useRef(false);
  const [tail,setTail] = useState({identity,pages:[],error:null,busy:false});
  const pages = tail.identity === identity ? tail.pages : [];
  const first = useQuery({queryKey,queryFn:async()=>{
    const fresh = await fetchFeed(table,taskKey);
    const old = client.getQueryData(queryKey) || [];
    const reset = resetFirst.current; resetFirst.current = false;
    // Preserve already loaded rows displaced by new arrivals at the page boundary.
    // Rows inside the refreshed range are authoritative (including deletions).
    if (reset || fresh.length < 100) return fresh;
    const end = fresh.at(-1);
    return [...fresh,...old.filter(row=>row.created_at < end.created_at || (row.created_at === end.created_at && row.id < end.id))];
  },...quietOptions(enabled)});
  const pageQueries = useQueries({queries:pages.map(cursor => ({queryKey:[...queryKey,'page',cursor.created_at,cursor.id],queryFn:()=>fetchFeed(table,taskKey,cursor),enabled:false,staleTime:Infinity}))});
  const current = [first.data || [], ...pageQueries.map(q=>q.data || [])];
  const seen = new Set();
  const data = current.flat().filter(row => { if (seen.has(row.id)) return false; seen.add(row.id); return true; });
  const lastPage = current.at(-1);
  const loadMore = async () => {
    if (tail.busy || lastPage.length < 100) return;
    setTail({identity,pages,busy:true,error:null});
    try {
      const cursor = lastPage.at(-1);
      await client.fetchQuery({queryKey:[...queryKey,'page',cursor.created_at,cursor.id], queryFn:()=>fetchFeed(table,taskKey,cursor),staleTime:Infinity});
      setTail({identity,pages:[...pages,cursor],busy:false,error:null});
    } catch (error) { setTail({identity,pages,busy:false,error}); }
  };
  const refetch = async () => {
    resetFirst.current = true;
    const result = await first.refetch();
    resetFirst.current = false;
    if (!result.error) {
      await client.invalidateQueries({queryKey:[...queryKey,'page'],refetchType:'none'});
      setTail({identity,pages:[],busy:false,error:null});
    }
    return result;
  };
  return {...first,data,error:first.error || (tail.identity === identity ? tail.error : null),hasNext:lastPage.length >= 100,loadMore,refetch,isFetchingMore:tail.busy};
}
