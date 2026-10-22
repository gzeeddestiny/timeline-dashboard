import { supabase } from '../lib/supabase';
import { fetchAllRows } from '../lib/supabasePages';
import { fetchSystemState } from '../lib/fullSystem';
const workflowResources = ['remarks','workflow','priorities','nextActions'];
export async function snapshotPatch(state, resource, key) {
  const mapValue = (map, value) => {
    const next = {...(state[map] || {})};
    if (value !== undefined && value !== null && value !== '') next[key] = value;
    else delete next[key];
    return next;
  };
  if (workflowResources.includes(resource)) {
    const {data:row,error} = await supabase.from('task_workflow').select('task_key,status,note,priority,next_action,note_version').eq('task_key',key).maybeSingle();
    if (error) throw error;
    return {...state, remarks:mapValue('remarks',row?.note), noteVersions:mapValue('noteVersions',row?.note_version || 0), workflow:mapValue('workflow',row?.status), priorities:mapValue('priorities',row?.priority), nextActions:mapValue('nextActions',row?.next_action)};
  }
  if (resource === 'assignments') {
    const {data,error} = await supabase.from('assignments').select('brand_key,value').eq('brand_key',key).maybeSingle();
    if (error) throw error;
    return {...state,assignments:mapValue('assignments',data?.value)};
  }
  if (resource === 'projectAssignments') {
    const {data,error} = await supabase.from('brand_workstreams').select('id,assignment').eq('id',key).maybeSingle();
    if (error) throw error;
    return {...state,brandProjects:state.brandProjects.map(p => p.id === key ? {...p,assignment:data?.assignment || {}} : p)};
  }
  if (resource === 'teamMembers') {
    const teamMembers = await fetchAllRows((from,to)=>supabase.from('team_members').select('name,role,avatar').order('name').range(from,to));
    return {...state,teamMembers};
  }
  return fetchSystemState({structureOnly:true,previous:state});
}
