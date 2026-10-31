import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchExtra, extraTables } from './data';
import { missingSchema, quietOptions } from '../lib/readPolicy';
export function useExtras(id, enabled, fixture) {
  const client = useQueryClient();
  const schemaKey = ['v2-schema',id];
  const schema = useQuery({queryKey:schemaKey,queryFn:()=>null,enabled:false});
  const kinds = Object.keys(extraTables);
  const queries = useQueries({queries:kinds.map(kind => ({
    queryKey:['v2-extra',id,kind],
    queryFn:async () => { try { return await fetchExtra(kind); } catch(error) { if(missingSchema(error)) client.setQueryData(schemaKey,error); throw error; } },
    ...quietOptions(enabled && !schema.data,false),
    initialData: fixture ? kind === 'plans' ? Object.values(fixture.plans) : kind === 'layouts' ? [{layout:fixture.layout}] : fixture[kind] : undefined,
  }))});
  return {
    data:{plans:Object.fromEntries((queries[0].data || []).map(p=>[p.task_key,p])),dependencies:queries[1].data || [],views:queries[2].data || [],layout:queries[3].data?.[0]?.layout || null},
    error:schema.data || queries.find(q=>q.error)?.error,
    refetch:async () => { client.setQueryData(schemaKey,null); return Promise.all(queries.map(q=>q.refetch())); },
  };
}
