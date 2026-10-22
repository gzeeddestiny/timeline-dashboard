import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/supabasePages';
export const extraTables = {
  plans: ['v2_plans','task_key','task_key,start_date,end_date,version'],
  dependencies: ['v2_dependencies','predecessor','predecessor,successor'],
  views: ['v2_saved_views','id','id,name,config'],
  layouts: ['v2_layouts','owner_id','owner_id,layout'],
};
export async function fetchExtra(kind) {
  const [table,order,columns] = extraTables[kind];
  return fetchAllRows((from,to) => {
    let query = supabase.from(table).select(columns).order(order);
    if (kind === 'dependencies') query = query.order('successor');
    return query.range(from,to);
  });
}
export async function mutateV2(action, payload) {
  const {data,error} = await supabase.rpc('v2_mutate',{p_action:action,p_payload:payload});
  if (error) throw error;
  return data;
}
const feedColumns = {
  v2_comments:'id,task_key,author_id,author_email,body,version,created_at,updated_at',
  v2_events:'id,task_key,action,actor_email,created_at',
  v2_mentions:'id,comment_id,task_key,actor_email,read_at,created_at',
};
export async function fetchFeed(table, taskKey, cursor = null) {
  let query = supabase.from(table).select(feedColumns[table]).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(100);
  if (taskKey) query = query.eq('task_key',taskKey);
  if (cursor) query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
  const {data,error,status} = await query;
  if (error) throw Object.assign(error,{status});
  return data || [];
}
