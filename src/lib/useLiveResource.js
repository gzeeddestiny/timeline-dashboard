import { useCallback, useEffect, useRef, useState } from 'react';
import { blockedRead, READ_INTERVAL } from './readPolicy';

export function useLiveResource(loader, initialData) {
  const [state, setState] = useState({ data:initialData, loading:true, error:'', fetchedAt:null, loader:null });
  const version = useRef(0);
  const currentRead = useRef(null);
  const last = useRef({loader:null,at:0,error:null});
  const reload = useCallback(async (explicit = true) => {
    if ((explicit === false || explicit === "timer") && (document.visibilityState === 'hidden' || (last.current.loader === loader && (blockedRead(last.current.error) || (explicit === false && Date.now()-last.current.at < READ_INTERVAL))))) return;
    if (currentRead.current?.loader === loader) return currentRead.current.promise;
    const current = ++version.current;
    const promise = (async () => {
      try {
        const data = await Promise.resolve().then(loader);
        if (current === version.current) {
          last.current = {loader,at:Date.now(),error:null};
          setState({data,loading:false,error:'',fetchedAt:new Date().toISOString(),loader});
        }
      } catch (error) {
        if (current === version.current) {
          last.current = {loader,at:Date.now(),error};
          setState(old => ({...old,data:old.loader === loader ? old.data : undefined,loader,loading:false,error:error.message}));
        }
      } finally {
        if (currentRead.current?.promise === promise) currentRead.current = null;
      }
    })();
    currentRead.current = {loader,promise};
    return promise;
  }, [loader]);
  useEffect(() => {
    const refreshVisible = () => reload(false);
    const onActivity = () => { if (document.visibilityState !== 'hidden') void reload(true); };
    const initial = setTimeout(() => reload(false), 0);
    const timer = setInterval(() => reload("timer"), READ_INTERVAL);
    window.addEventListener('focus', refreshVisible);
    window.addEventListener('timeline:activity', onActivity);
    document.addEventListener('visibilitychange', refreshVisible);
    const invalidate = () => { version.current++; currentRead.current=null; };
    return () => {
      invalidate();
      clearTimeout(initial); clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      window.removeEventListener('timeline:activity', onActivity);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [reload]);
  return state.loader && state.loader !== loader ? { data:initialData, loading:true, error:'',fetchedAt:null,reload } : {...state,data:state.data ?? initialData,reload};
}
