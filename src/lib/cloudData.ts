import {useCallback,useEffect,useRef,useState,type Dispatch,type SetStateAction} from 'react'
import leaveNoTracePoster from '../Assets/Artwork/leave-no-trace-show-poster.png'
import {cloudMigrationService,contentService,rehearsalService,releaseService,showService,songService,taskService} from './services'
import {requireSupabase} from './services/core'
import type {MemberContext} from './services'

export type OperationalData={songs:any[];shows:any[];rehearsals:any[];releases:any[];content:any[];tasks:any[]}
export type SyncPhase='local'|'syncing'|'synced'|'offline'|'pending'|'error'
export type MigrationSectionResult={inserted:number;updated:number;skipped:number;failed:number}
export type MigrationResult={sections:Record<keyof OperationalData,MigrationSectionResult>;verified:boolean;counts:Record<keyof OperationalData,number>;nested:Record<string,number>;artworkWarnings:number}
export type CloudController={phase:SyncPhase;message:string;lastSync:string;pendingCount:number;migrationComplete:boolean;migrating:boolean;migrate:(data:OperationalData)=>Promise<MigrationResult>;reload:()=>Promise<void>}

const CACHE_KEY='jst-command-center-v1'
const QUEUE_PREFIX='jst-cloud-pending-v1:'
const LAST_SYNC_PREFIX='jst-cloud-last-sync-v1:'
const MIGRATION_PREFIX='jst-cloud-migration-v1:'
const isOnline=()=>navigator.onLine&&!(import.meta.env.DEV&&new URLSearchParams(window.location.search).has('_jst_offline'))
const sections=['songs','shows','rehearsals','releases','content','tasks'] as const
type Section=typeof sections[number]
type Mutation={id:string;section:Section;operation:'upsert'|'delete';legacyId:string;record?:any;queuedAt:string}
const services={songs:songService,shows:showService,rehearsals:rehearsalService,releases:releaseService,content:contentService,tasks:taskService} as const

const canonicalJson=(value:unknown):unknown=>{
 if(Array.isArray(value))return value.map(canonicalJson)
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,nested])=>[key,canonicalJson(nested)]))
 return value??null
}
const jsonEqual=(a:unknown,b:unknown)=>JSON.stringify(canonicalJson(a))===JSON.stringify(canonicalJson(b))
const timeOrNull=(value?:string)=>value||null
const dateOrNull=(value?:string)=>value||null
const attribution=(member:MemberContext['member'])=>({last_edited_by_member_id:member.id,last_edited_by_name:member.display_name})
const posterReference=(poster?:string)=>!poster?null:poster.startsWith('data:')?null:poster.includes('leave-no-trace-show-poster')?'bundled:leave-no-trace-show-poster':poster
const posterFromReference=(value?:string|null)=>value==='bundled:leave-no-trace-show-poster'?leaveNoTracePoster:(value||'')

const toCloud=(section:Section,item:any,member:MemberContext['member'])=>{
 const base={legacy_id:String(item.id),...attribution(member)}
 if(section==='songs')return {...base,title:item.title,bpm:Number(item.bpm)||0,musical_key:item.key||'',tuning:item.tuning||'',length:item.length||'',status:item.status||'',notes:item.notes||''}
 if(section==='shows')return {...base,name:item.name,venue:item.venue||'',location:item.location||'',show_date:dateOrNull(item.date),load_in:timeOrNull(item.loadIn),soundcheck:timeOrNull(item.soundcheck),set_time:timeOrNull(item.setTime),ticket_goal:Number(item.ticketGoal)||0,tickets_sold:Number(item.ticketsSold)||0,ticket_price:Number(item.ticketPrice)||0,contact:item.contact||'',promoter:item.promoter||'',sound_engineer:item.soundEngineer||'',address:item.address||'',ticket_notes:item.ticketNotes||'',parking_notes:item.parkingNotes||'',entrance_notes:item.entranceNotes||'',wifi_notes:item.wifiNotes||'',green_room_notes:item.greenRoomNotes||'',notes:item.notes||'',quick_notes:item.quickNotes||'',poster_reference:posterReference(item.poster),setlist:item.setlist||[],checklist:{legacy:item.checklist||{},categories:item.checklistV2||[]},merch:item.merch||[],recap:item.recap||null,show_mode_state:{setProgress:item.setProgress||[],setMeta:item.setMeta||{}}}
 if(section==='rehearsals')return {...base,rehearsal_date:dateOrNull(item.date),start_time:timeOrNull(item.startTime),end_time:timeOrNull(item.endTime),location:item.location||'',attendees:item.attendees||'',goals:item.goals||[],songs:item.songs||[],notes:item.notes||'',after_notes:item.after||{},completed:Boolean(item.completed)}
 if(section==='releases')return {...base,song_name:item.songName,release_date:dateOrNull(item.date),artwork_status:item.artwork||'Not Started',recording_status:item.recording||'Not Started',mixing_status:item.mixing||'Not Started',mastering_status:item.mastering||'Not Started',distribution_status:item.distribution||'Not Started',promotion_status:item.promotion||'Not Started',artwork_reference:item.artworkReference||null,promotion_information:item.promotionInformation||{},milestones:item.milestones||[],notes:item.notes||''}
 if(section==='content')return {...base,title:item.title,content_type:item.type||'',platform:item.platform||'',status:item.status||'',song:item.song||'',show_name:item.show||'',planned_date:dateOrNull(item.date),notes:item.notes||''}
 return {...base,name:item.name,category:item.category||'',due_date:dateOrNull(item.due),priority:item.priority||'Normal',assigned:item.assigned||'',notes:item.notes||'',complete:Boolean(item.complete)}
}

const fromCloud=(section:Section,row:any,cached?:any)=>{
 const id=row.legacy_id||row.id
 if(section==='songs')return {id,title:row.title,bpm:row.bpm,key:row.musical_key,tuning:row.tuning,length:row.length,status:row.status,notes:row.notes}
 if(section==='shows'){const checklist=row.checklist||{},mode=row.show_mode_state||{};return {id,name:row.name,venue:row.venue,location:row.location,date:row.show_date||'',loadIn:row.load_in?.slice(0,5)||'',setTime:row.set_time?.slice(0,5)||'',ticketGoal:row.ticket_goal,ticketsSold:row.tickets_sold,ticketPrice:Number(row.ticket_price),contact:row.contact,notes:row.notes,setlist:row.setlist||[],poster:posterFromReference(row.poster_reference)||cached?.poster,recap:row.recap||undefined,soundcheck:row.soundcheck?.slice(0,5)||'',ticketNotes:row.ticket_notes,address:row.address,promoter:row.promoter,soundEngineer:row.sound_engineer,parkingNotes:row.parking_notes,entranceNotes:row.entrance_notes,wifiNotes:row.wifi_notes,greenRoomNotes:row.green_room_notes,quickNotes:row.quick_notes,checklist:checklist.legacy||(!Array.isArray(checklist)?checklist:{}),checklistV2:checklist.categories||(Array.isArray(checklist)?checklist:undefined),merch:row.merch||[],setProgress:mode.setProgress||[],setMeta:mode.setMeta||{}}}
 if(section==='rehearsals')return {id,date:row.rehearsal_date||'',startTime:row.start_time?.slice(0,5)||'',endTime:row.end_time?.slice(0,5)||'',location:row.location,attendees:row.attendees,goals:row.goals||[],songs:row.songs||[],notes:row.notes,after:row.after_notes||{},completed:row.completed}
 if(section==='releases')return {id,songName:row.song_name,date:row.release_date||'',artwork:row.artwork_status,recording:row.recording_status,mixing:row.mixing_status,mastering:row.mastering_status,distribution:row.distribution_status,promotion:row.promotion_status,artworkReference:row.artwork_reference,promotionInformation:row.promotion_information||{},milestones:row.milestones||[],notes:row.notes}
 if(section==='content')return {id,title:row.title,type:row.content_type,platform:row.platform,status:row.status,song:row.song,show:row.show_name,date:row.planned_date||'',notes:row.notes}
 return {id,name:row.name,category:row.category,due:row.due_date||'',priority:row.priority,assigned:row.assigned,notes:row.notes,complete:row.complete}
}

const queueKey=(workspaceId:string)=>QUEUE_PREFIX+workspaceId
const readQueue=(workspaceId:string):Mutation[]=>{try{return JSON.parse(localStorage.getItem(queueKey(workspaceId))||'[]')}catch{return []}}
const writeQueue=(workspaceId:string,queue:Mutation[])=>localStorage.setItem(queueKey(workspaceId),JSON.stringify(queue))
const migrationCounts=(data:OperationalData)=>Object.fromEntries(sections.map(section=>[section,data[section]?.length||0])) as Record<Section,number>
const nestedCounts=(data:OperationalData)=>({setlistSongs:data.shows.reduce((n,s)=>n+(s.setlist?.length||0),0),checklistItems:data.shows.reduce((n,s)=>n+(s.checklistV2||[]).reduce((m:any,c:any)=>m+(c.items?.length||0),0),0),merchItems:data.shows.reduce((n,s)=>n+(s.merch?.length||0),0),recaps:data.shows.filter(s=>s.recap).length,milestones:data.releases.reduce((n,r)=>n+(r.milestones?.length||0),0),rehearsalSongs:data.rehearsals.reduce((n,r)=>n+(r.songs?.length||0),0)})

export function useCloudOperationalData<T extends OperationalData>(initialData:T,context:MemberContext|null):{data:T;setData:Dispatch<SetStateAction<T>>;cloud:CloudController}{
 const [data,setBaseData]=useState<T>(initialData),dataRef=useRef<T>(initialData),contextRef=useRef(context),enabledRef=useRef(false),syncingRef=useRef(false),reloadRef=useRef<()=>Promise<void>>(async()=>{})
 const [phase,setPhase]=useState<SyncPhase>('local'),[message,setMessage]=useState('LOCAL DATA'),[lastSync,setLastSync]=useState(''),[pendingCount,setPendingCount]=useState(0),[migrationComplete,setMigrationComplete]=useState(false),[migrating,setMigrating]=useState(false)
 contextRef.current=context
 const publish=useCallback((next:SyncPhase,text:string,pending?:number)=>{setPhase(next);setMessage(text);window.dispatchEvent(new CustomEvent('jst-sync-status',{detail:{phase:next,message:text,pending:pending??pendingCount}}))},[pendingCount])
 const applyRemote=useCallback((next:T)=>{dataRef.current=next;setBaseData(next);localStorage.setItem(CACHE_KEY,JSON.stringify(next))},[])
 const loadCloud=useCallback(async()=>{if(!context)return;publish('syncing','SYNCING');const rows=await Promise.all(sections.map(section=>services[section].list(context.membership.workspace_id)));const cached=dataRef.current;const next=Object.fromEntries(sections.map((section,index)=>[section,rows[index].map(row=>fromCloud(section,row,(cached[section] as any[]).find(x=>x.id===(row.legacy_id||row.id))))])) as T;applyRemote(next);const at=new Date().toISOString();localStorage.setItem(LAST_SYNC_PREFIX+context.membership.workspace_id,at);setLastSync(at);publish('synced','SYNCED',0)},[context,applyRemote,publish])
 reloadRef.current=loadCloud
 const processQueue=useCallback(async()=>{const current=contextRef.current;if(!current||!enabledRef.current||syncingRef.current)return;let queue=readQueue(current.membership.workspace_id);setPendingCount(queue.length);if(!queue.length){publish(isOnline()?'synced':'offline',isOnline()?'SYNCED':'OFFLINE',0);return}if(!isOnline()){publish('offline',`OFFLINE · ${queue.length} PENDING`,queue.length);return}syncingRef.current=true;publish('syncing',`SYNCING · ${queue.length} PENDING`,queue.length);try{while(queue.length){const mutation=queue[0],service=services[mutation.section];if(mutation.operation==='delete')await service.removeByLegacyId(current.membership.workspace_id,mutation.legacyId);else await service.upsertByLegacyId(current.membership.workspace_id,toCloud(mutation.section,mutation.record,current.member));queue=queue.slice(1);writeQueue(current.membership.workspace_id,queue);setPendingCount(queue.length)}const at=new Date().toISOString();localStorage.setItem(LAST_SYNC_PREFIX+current.membership.workspace_id,at);setLastSync(at);publish('synced','SYNCED',0);await reloadRef.current()}catch(cause){publish('error',cause instanceof Error?`SYNC ERROR · ${cause.message}`:'SYNC ERROR',queue.length)}finally{syncingRef.current=false}},[publish])
 const enqueueDiff=useCallback((before:T,after:T)=>{const current=contextRef.current;if(!current||!enabledRef.current)return;let queue=readQueue(current.membership.workspace_id);for(const section of sections){const oldMap=new Map((before[section] as any[]).map(item=>[String(item.id),item])),newMap=new Map((after[section] as any[]).map(item=>[String(item.id),item]));for(const [id,item] of newMap){if(!oldMap.has(id)||!jsonEqual(oldMap.get(id),item)){queue=queue.filter(m=>!(m.section===section&&m.legacyId===id));queue.push({id:`${Date.now()}-${Math.random()}`,section,operation:'upsert',legacyId:id,record:item,queuedAt:new Date().toISOString()})}}for(const id of oldMap.keys())if(!newMap.has(id)){queue=queue.filter(m=>!(m.section===section&&m.legacyId===id));queue.push({id:`${Date.now()}-${Math.random()}`,section,operation:'delete',legacyId:id,queuedAt:new Date().toISOString()})}}writeQueue(current.membership.workspace_id,queue);setPendingCount(queue.length);publish(isOnline()?'pending':'offline',isOnline()?`CHANGES PENDING · ${queue.length}`:`OFFLINE · ${queue.length} PENDING`,queue.length);void processQueue()},[processQueue,publish])
 const setData=useCallback<Dispatch<SetStateAction<T>>>((action)=>{setBaseData(previous=>{const next=typeof action==='function'?(action as (value:T)=>T)(previous):action;dataRef.current=next;localStorage.setItem(CACHE_KEY,JSON.stringify(next));enqueueDiff(previous,next);return next})},[enqueueDiff])
 useEffect(()=>{
  if(!context)return
  let cancelled=false
  const workspaceId=context.membership.workspace_id
  const cachedMigrationComplete=localStorage.getItem(MIGRATION_PREFIX+workspaceId)==='complete'
  const queued=readQueue(workspaceId).length
  setLastSync(localStorage.getItem(LAST_SYNC_PREFIX+workspaceId)||'')
  setPendingCount(queued)
  if(cachedMigrationComplete&&!isOnline()){
   setMigrationComplete(true)
   enabledRef.current=true
   publish('offline',`OFFLINE${queued?` · ${queued} PENDING`:''}`,queued)
  }else cloudMigrationService.get(workspaceId).then(record=>{
   if(cancelled)return
   const complete=Boolean(record)
   setMigrationComplete(complete)
   enabledRef.current=complete
   if(complete){
    localStorage.setItem(MIGRATION_PREFIX+workspaceId,'complete')
    return loadCloud().then(()=>processQueue())
   }
   publish('local','LOCAL DATA · MIGRATION AVAILABLE')
  }).catch(cause=>{
   if(cachedMigrationComplete){
    setMigrationComplete(true)
    enabledRef.current=true
    publish('offline',`OFFLINE${queued?` · ${queued} PENDING`:''}`,queued)
   }else publish('error',cause instanceof Error?`CLOUD SETUP REQUIRED · ${cause.message}`:'CLOUD SETUP REQUIRED')
  })
  const online=()=>void processQueue()
  const offline=()=>publish('offline',`OFFLINE · ${readQueue(workspaceId).length} PENDING`)
  window.addEventListener('online',online)
  window.addEventListener('offline',offline)
  return()=>{cancelled=true;window.removeEventListener('online',online);window.removeEventListener('offline',offline)}
 },[context?.membership.workspace_id])
 useEffect(()=>{if(!context||!migrationComplete)return;let timer=0;const refresh=()=>{if(readQueue(context.membership.workspace_id).length)return;clearTimeout(timer);timer=window.setTimeout(()=>void loadCloud(),180)};let channel=requireSupabase().channel(`jst-ops-${context.membership.workspace_id}`);for(const table of ['songs','shows','rehearsals','releases','content_items','tasks'])channel=channel.on('postgres_changes',{event:'*',schema:'public',table,filter:`workspace_id=eq.${context.membership.workspace_id}`},refresh);channel.subscribe();return()=>{clearTimeout(timer);void requireSupabase().removeChannel(channel)}},[context?.membership.workspace_id,migrationComplete,loadCloud])
 const migrate=useCallback(async(local:OperationalData):Promise<MigrationResult>=>{
  if(!context)throw new Error('The JST workspace is not available.')
  if(!isOnline())throw new Error('Connect to the internet before migrating local data.')
  setMigrating(true)
  publish('syncing','MIGRATING LOCAL DATA')
  const results=Object.fromEntries(sections.map(section=>[section,{inserted:0,updated:0,skipped:0,failed:0}])) as Record<Section,MigrationSectionResult>
  const uploadErrors:string[]=[]
  try{
   for(const section of sections){
    const existing=await services[section].list(context.membership.workspace_id)
    const existingByLegacy=new Map(existing.map(row=>[String(row.legacy_id||row.id),row]))
    for(const item of local[section]){
     const payload=toCloud(section,item,context.member)
     const prior=existingByLegacy.get(String(item.id))
     const normalizedPrior=prior?toCloud(section,fromCloud(section,prior),context.member):null
     if(normalizedPrior&&Object.entries(payload).every(([key,value])=>jsonEqual((normalizedPrior as any)[key],value))){
      results[section].skipped++
      continue
     }
     try{
      await services[section].upsertByLegacyId(context.membership.workspace_id,payload)
      if(prior)results[section].updated++
      else results[section].inserted++
     }catch(cause){
      results[section].failed++
      uploadErrors.push(`${section}/${item.id}: ${cause instanceof Error?cause.message:String(cause)}`)
     }
    }
   }
   const counts=migrationCounts(local)
   const cloudRows=await Promise.all(sections.map(section=>services[section].list(context.membership.workspace_id)))
   const countMismatches=sections.filter((section,index)=>cloudRows[index].length!==counts[section]).map((section,index)=>`${section} expected ${counts[section]}, found ${cloudRows[index].length}`)
   const fieldMismatches:string[]=[]
   for(const [index,section] of sections.entries())for(const item of local[section]){
    const row=cloudRows[index].find(candidate=>(candidate.legacy_id||candidate.id)===String(item.id))
    if(!row){
     fieldMismatches.push(`${section}/${item.id} missing`)
     continue
    }
    const expected=toCloud(section,item,context.member)
    const actual=toCloud(section,fromCloud(section,row),context.member)
    const differing=Object.entries(expected).filter(([key,value])=>!key.startsWith('last_edited')&&!jsonEqual((actual as any)[key],value)).map(([key])=>key)
    if(differing.length)fieldMismatches.push(`${section}/${item.id}: ${differing.join(', ')}`)
   }
   const noFailures=sections.every(section=>results[section].failed===0)
   const verified=!countMismatches.length&&!fieldMismatches.length&&noFailures
   const nested=nestedCounts(local)
   const artworkWarnings=local.shows.filter(show=>show.poster?.startsWith('data:')).length
   if(!verified){
    const details=[...uploadErrors,...countMismatches,...fieldMismatches].slice(0,8).join(' | ')
    throw new Error(`Cloud verification failed${details?`: ${details}`:''}. Local data remains authoritative and untouched.`)
   }
   await cloudMigrationService.complete(context.membership.workspace_id,counts)
   localStorage.setItem(MIGRATION_PREFIX+context.membership.workspace_id,'complete')
   setMigrationComplete(true)
   enabledRef.current=true
   await loadCloud()
   return {sections:results,verified,counts,nested,artworkWarnings}
  }catch(cause){
   publish('error',cause instanceof Error?'MIGRATION ERROR':'MIGRATION ERROR')
   throw cause
  }finally{
   setMigrating(false)
  }
 },[context,loadCloud,publish])
 return {data,setData,cloud:{phase,message,lastSync,pendingCount,migrationComplete,migrating,migrate,reload:loadCloud}}
}
