import {useEffect,useState} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {CalendarClock,CalendarDays,CheckSquare,Clapperboard,Disc3,Download,Home,Music2,Plus,Settings,X} from 'lucide-react';

const desktop=[['Dashboard',Home],['Shows',CalendarDays],['Rehearsals',CalendarClock],['Releases',Disc3],['Songs',Music2],['Content',Clapperboard],['Tasks',CheckSquare]] as const;
const mobile=[['Dashboard','Home',Home],['Shows','Shows',CalendarDays],['Rehearsals','Rehearse',CalendarClock],['Releases','Releases',Disc3],['Songs','Songs',Music2],['Tasks','Tasks',CheckSquare]] as const;
type Props={page:string;onNavigate:(page:string)=>void;onQuickAdd:(section:string)=>void};

export default function AppNav({page,onNavigate,onQuickAdd}:Props){
 const [more,setMore]=useState(false),[quick,setQuick]=useState(false),[settings,setSettings]=useState(false),[installEvent,setInstallEvent]=useState<any>(null),[update,setUpdate]=useState<ServiceWorkerRegistration|null>(null);
 useEffect(()=>{const install=(e:any)=>{e.preventDefault();setInstallEvent(e)};window.addEventListener('beforeinstallprompt',install);if('serviceWorker'in navigator){navigator.serviceWorker.register('/sw.js').then(reg=>{if(reg.waiting)setUpdate(reg);reg.addEventListener('updatefound',()=>reg.installing?.addEventListener('statechange',()=>{if(reg.waiting&&navigator.serviceWorker.controller)setUpdate(reg)}))});navigator.serviceWorker.addEventListener('controllerchange',()=>location.reload())}return()=>window.removeEventListener('beforeinstallprompt',install)},[]);
 useEffect(()=>{const openMore=()=>setMore(true);window.addEventListener('jst-mobile-more',openMore);return()=>window.removeEventListener('jst-mobile-more',openMore)},[]);
 const go=(p:string)=>{onNavigate(p);setMore(false);setSettings(false)};
 const add=(p:string)=>{onQuickAdd(p);setQuick(false)};
 return <>
  <nav className="desktopNav">{desktop.map(([name,Icon])=><button className={page===name?'active':''} onClick={()=>go(name)} key={name}><Icon/>{name}</button>)}</nav>
  <nav className="mobileBottomNav">{mobile.map(([name,label,Icon])=><button className={page===name?'active':''} onClick={()=>go(name)} key={name}><Icon/><span>{label}</span></button>)}</nav>
  <button className="quickAddFab" aria-label="Quick Add" onClick={()=>setQuick(true)}><Plus/></button>
  {more&&<div className="mobileSheet compactSheet"><div className="sheetHandle"/><div className="sheetHead"><b>MORE</b><button className="icon" onClick={()=>setMore(false)}><X/></button></div><div className="moreGrid"><button onClick={()=>go('Content')}><Clapperboard/>Content</button><button onClick={()=>go('Data')}><Settings/>Settings / Data</button>{installEvent&&<button onClick={async()=>{await installEvent.prompt();setInstallEvent(null)}}><Download/>Install JST Command</button>}</div></div>}
  {quick&&<div className="mobileSheet quickSheet"><div className="sheetHandle"/><div className="sheetHead"><div><span>KEEP IT MOVING</span><b>QUICK ADD</b></div><button className="icon" onClick={()=>setQuick(false)}><X/></button></div><div className="quickGrid">{[['Shows','Show',CalendarDays],['Rehearsals','Rehearsal',CalendarClock],['Releases','Release',Disc3],['Songs','Song',Music2],['Content','Content',Clapperboard],['Tasks','Task',CheckSquare]].map(([section,label,Icon]:any)=><button key={section} onClick={()=>add(section)}><Icon/>{label}</button>)}</div></div>}
  {update&&<div className="updateToast"><div><b>JST Command Center update ready</b><span>Your local data is safe.</span></div><button onClick={()=>update.waiting?.postMessage({type:'SKIP_WAITING'})}>Update</button><button className="textBtn" onClick={()=>setUpdate(null)}>Later</button></div>}
 </>;
}

function PwaChrome(){const [page,setPage]=useState('Dashboard');useEffect(()=>{const changed=(e:Event)=>setPage((e as CustomEvent<string>).detail);window.addEventListener('jst-page-changed',changed);return()=>window.removeEventListener('jst-page-changed',changed)},[]);return <AppNav page={page} onNavigate={next=>window.dispatchEvent(new CustomEvent('jst-navigate',{detail:next}))} onQuickAdd={section=>window.dispatchEvent(new CustomEvent('jst-quick-add',{detail:section}))}/>}
let chromeRoot:Root|null=null,chromeHost:HTMLElement|null=null,chromeGeneration=0;
export function mountAppChrome(){chromeGeneration++;if(!chromeRoot){chromeHost=document.createElement('div');chromeHost.id='jst-app-chrome';document.body.appendChild(chromeHost);chromeRoot=createRoot(chromeHost);chromeRoot.render(<PwaChrome/>)}return()=>{const cleanupGeneration=++chromeGeneration;queueMicrotask(()=>{if(chromeGeneration!==cleanupGeneration)return;chromeRoot?.unmount();chromeHost?.remove();chromeRoot=null;chromeHost=null})}}
