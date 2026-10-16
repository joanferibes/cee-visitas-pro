/* CEE VISITAS PRO · PWA v1 — Joanfe Ribes Oficina Tècnica
   Visitas + croquis en una sola app. Basada en CEE Visitas v11 y Croquis CEE v1.0. */
(function(){
"use strict";

const DEFAULT_SCRIPT_URL = (window.CEE_CONFIG && window.CEE_CONFIG.scriptUrl) || "";

const MUNIS = ["","Pedreguer","Dénia","Ondara","Xàbia","Teulada","Moraira","Jesús Pobre","Gata de Gorgos","El Verger","El Poble Nou de Benitatxell","Els Poblets","Beniarbeig","Benidoleig","Benimeli","Benissa","Calp","Orba","Parcent","Senija","Lliber","Xaló","Alcalalí","Sagra","Murla","Ràfol d'Almúnia","Pego","Oliva","Tormos","Otro"];
const MUNI_ALIAS = {"benitachell":"El Poble Nou de Benitatxell","benitatxell":"El Poble Nou de Benitatxell","el poble nou de benitatxell":"El Poble Nou de Benitatxell","poble nou de benitatxell":"El Poble Nou de Benitatxell","el poble nou":"El Poble Nou de Benitatxell","denia":"Dénia","jabea":"Xàbia","javea":"Xàbia","el vergel":"El Verger","calpe":"Calp","jalon":"Xaló","jalón":"Xaló","rafol de almunia":"Ràfol d'Almúnia","rafol d'almunia":"Ràfol d'Almúnia","ràfol de almunia":"Ràfol d'Almúnia"};
const GRUPOS_FOTO = { fachada:"fachada", detalle:"detalle", placas:"placa", croquisExtra:"croquis_extra" };

// ---------------- IndexedDB (base propia, no se mezcla con la app actual) ----------------
const DB_NAME="cee_visitas_pro_v1", DB_VER=1;
function openDB(){ return new Promise((res,rej)=>{ const req=indexedDB.open(DB_NAME,DB_VER); req.onupgradeneeded=(e)=>{const db=e.target.result; if(!db.objectStoreNames.contains("expedientes")) db.createObjectStore("expedientes",{keyPath:"id"}); if(!db.objectStoreNames.contains("config")) db.createObjectStore("config",{keyPath:"key"});}; req.onsuccess=()=>res(req.result); req.onerror=()=>rej(req.error); });}
async function dbGetAll(s){ const db=await openDB(); return new Promise((r,j)=>{const q=db.transaction(s,"readonly").objectStore(s).getAll(); q.onsuccess=()=>r(q.result||[]); q.onerror=()=>j(q.error);}); }
async function dbGet(s,k){ const db=await openDB(); return new Promise((r,j)=>{const q=db.transaction(s,"readonly").objectStore(s).get(k); q.onsuccess=()=>r(q.result||null); q.onerror=()=>j(q.error);}); }
async function dbPut(s,o){ const db=await openDB(); return new Promise((r,j)=>{const tx=db.transaction(s,"readwrite"); tx.objectStore(s).put(o); tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error);}); }
async function dbDelete(s,k){ const db=await openDB(); return new Promise((r,j)=>{const tx=db.transaction(s,"readwrite"); tx.objectStore(s).delete(k); tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error);}); }
async function dbClear(s){ const db=await openDB(); return new Promise((r,j)=>{const tx=db.transaction(s,"readwrite"); tx.objectStore(s).clear(); tx.oncomplete=()=>r(); tx.onerror=()=>j(tx.error);}); }

// ---------------- Backend ----------------
let _cb=0;
function jsonp(url,params,timeout){ timeout=timeout||25000; return new Promise((resolve,reject)=>{
  if(!url){ reject(new Error("Falta la URL del Apps Script (⚙ Configuración)")); return; }
  const cbName="_gasCb_"+Date.now()+"_"+(++_cb);
  const qs=Object.keys(params||{}).map(k=>encodeURIComponent(k)+"="+encodeURIComponent(params[k])).join("&");
  const full=url+(url.indexOf("?")>-1?"&":"?")+qs+(qs?"&":"")+"callback="+cbName;
  const sc=document.createElement("script");
  const t=setTimeout(()=>{clean(); reject(new Error("Tiempo agotado"));},timeout);
  function clean(){ clearTimeout(t); try{delete window[cbName];}catch(e){window[cbName]=undefined;} if(sc.parentNode) sc.parentNode.removeChild(sc); }
  window[cbName]=(data)=>{clean(); resolve(data);};
  sc.onerror=()=>{clean(); reject(new Error("Error de red"));};
  sc.src=full; document.head.appendChild(sc);
});}
// POST con text/plain: sin preflight CORS; el Apps Script responde JSON
async function apiPost(payload, timeout){
  const url=await backendUrl();
  if(!url) throw new Error("Falta la URL del Apps Script (⚙ Configuración)");
  const ctl=new AbortController(); const t=setTimeout(()=>ctl.abort(), timeout||120000);
  try{
    const r=await fetch(url,{method:"POST",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify(payload),signal:ctl.signal});
    const j=await r.json();
    if(!j || j.status!=="ok") throw new Error((j&&j.message)||"Respuesta inesperada del servidor");
    return j;
  } finally { clearTimeout(t); }
}
async function backendUrl(){ const c=await getCfg(); return c.scriptUrl||DEFAULT_SCRIPT_URL; }
async function apiStatus(){ return jsonp(await backendUrl(),{action:"status"},10000); }
async function apiListarSolicitudes(){ return jsonp(await backendUrl(),{action:"listar"}); }
async function apiDetalleSolicitud(id){ return jsonp(await backendUrl(),{action:"detalle",id}); }
async function apiActualizarEstadoSolicitud(id,estado){ return jsonp(await backendUrl(),{action:"actualizar_estado",id,estado}); }
async function apiListarExpedientes(){ return jsonp(await backendUrl(),{action:"listar_exp"}); }
async function apiGuardarExpediente(id,datos,estado){
  const b64=btoa(unescape(encodeURIComponent(JSON.stringify(datos))));
  return jsonp(await backendUrl(),{action:"guardar_exp",id,datos:b64,estado:estado||"pendiente"},40000);
}
async function apiBorrarExpediente(id){ return jsonp(await backendUrl(),{action:"borrar_exp",id}); }

async function getCfg(){
  const c=await dbGet("config","main");
  return c||{ key:"main", scriptUrl:DEFAULT_SCRIPT_URL, emailColab:(window.CEE_CONFIG&&window.CEE_CONFIG.emailColab)||"", tecnico:"", firma:"Un saludo,\n\nJuan Felipe Ribes Aranda\nArquitecto Técnico · col. 3.184\nJoanfe Ribes Oficina Tècnica\nTel. 605 875 899\njoanferibes@gmail.com", lastSync:"" };
}
async function saveCfg(c){ c.key="main"; await dbPut("config",c); }

// ---------------- Estado y utilidades ----------------
const state={currentTab:"pendiente", expCurrent:null, online:navigator.onLine, firma:{ctx:null, drawing:false, hasDrawn:false}, camera:{stream:null, activeKey:null, n:0}, importing:false, subiendo:false, fileKey:null};
const $=(id)=>document.getElementById(id);
function go(id){ document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active")); const t=$("screen-"+id); if(t) t.classList.add("active"); state.pantalla=id; window.scrollTo(0,0); }
// Nº de expediente: se escribe tal cual (233-26-C); los ficheros llevan delante 2026233_ como siempre
function prefijoExp(n){
  n=String(n||"").trim(); if(!n) return "";
  let m=n.match(/^(\d{1,4})\s*[-\/]\s*(\d{2})(?:\s*[-\/]\s*[A-Za-z]+)?$/);
  if(m) return "20"+m[2]+("000"+m[1]).slice(-Math.max(3,m[1].length));
  m=n.match(/^(\d{7})_*$/); if(m) return m[1];
  return n.replace(/[^\w-]/g,"").replace(/_+$/,"");
}
window.CEE_prefijoExp=prefijoExp;
function toast(m,ms){ const t=$("toast"); t.textContent=m; t.classList.add("show"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("show"),ms||2800); }
function showSync(m){ const b=$("sync-bar"); $("sync-text").textContent=m; b.classList.add("visible"); }
function hideSync(){ $("sync-bar").classList.remove("visible"); }
function setStatus(on){ state.online=on; const d=$("status-dot"), t=$("status-text"); if(on){ d.className="dot on"; t.textContent="Online"; } else { d.className="dot off"; t.textContent="Offline"; } }
function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function formatFecha(iso){ if(!iso) return "—"; try{const d=new Date(iso); return d.toLocaleDateString("es-ES")+" "+d.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"});}catch(e){return "—";} }
function matchMuni(m){ if(!m) return ""; const t=String(m).trim().toLowerCase(); if(MUNI_ALIAS[t]) return MUNI_ALIAS[t]; for(const o of MUNIS){ if(o && o.toLowerCase()===t) return o; } return "__custom__:" + String(m).trim(); }
function normFecha(f){ if(!f) return ""; try{ if(/^\d{4}-\d{2}-\d{2}/.test(f)) return f.slice(0,10); const d=new Date(f); if(!isNaN(d)) return d.toISOString().slice(0,10);}catch(e){} return ""; }
function muniDe(exp){ return exp.datos.municipio==="Otro" ? (exp.datos.municipioCustom||"") : (exp.datos.municipio||""); }
function hoyISO(){ return new Date().toISOString().slice(0,10); }

function pedirMunicipioCustom(initial, onOk){
  const modal=$("modal-muni"); const inp=$("muni-custom");
  inp.value = initial || ""; modal.style.display="flex"; setTimeout(()=>inp.focus(), 100);
  function close(){ modal.style.display="none"; $("muni-ok").onclick=null; $("muni-cancel").onclick=null; }
  $("muni-ok").onclick=()=>{ const v = inp.value.trim(); close(); onOk(v); };
  $("muni-cancel").onclick=()=>{ close(); onOk(null); };
}

function nuevoExpedienteVacio(){
  return { id:"exp_"+Date.now()+"_"+Math.random().toString(36).slice(2,7), app:"pro", origen:"manual", fechaCreacion:new Date().toISOString(), fechaActualizacion:new Date().toISOString(), estado:"pendiente", solicitudId:"", numExp:"",
    datos:{nombre:"", tipoDocumento:"DNI", numeroDocumento:"", telefono:"", email:"", direccion:"", municipio:"", municipioCustom:"", codigoPostal:"", referenciaCatastral:"", fechaVisita:"", observaciones:""},
    checklist:{tipoViv:"", reformaImportante:false, reformaAnyo:"", posAislamiento:"", murosEspesor:"", carpinteria:"", acristalamiento:"", permeabilidad:"", techo:"", techoAislada:"", suelo:"", calTipo:"", calComb:"", calDist:"", calAntig:"", calPct:"", refTipo:"", refComb:"", refAntig:"", refPct:"", acsTipo:"", acsModalidad:"", acsAcum:"", acsComb:"", acsMixta:false, renPaneles:false, renPotencia:"", firmaReq:false, observaciones:""},
    fotos:{fachada:[], detalle:[], placas:[], croquisExtra:[], firma:""},
    croquis:null, drive:{folderId:"", url:"", subido:"", fecha:""}, pendienteSync:false };
}
// Completa expedientes que llegan de la hoja (o de versiones viejas) con la estructura actual
function normalizar(exp){
  const base=nuevoExpedienteVacio();
  exp.datos=Object.assign(base.datos, exp.datos||{});
  exp.checklist=Object.assign(base.checklist, exp.checklist||{});
  const f=exp.fotos||{};
  exp.fotos={ fachada:[].concat(f.fachada||[]).filter(Boolean), detalle:[].concat(f.detalle||[]).filter(Boolean), placas:[].concat(f.placas||[]).filter(Boolean), croquisExtra:[].concat(f.croquisExtra||[], f.croq1||[], f.croq2||[]).filter(Boolean), firma:f.firma||"" };
  if(!exp.drive) exp.drive=base.drive;
  if(exp.croquis===undefined) exp.croquis=null;
  return exp;
}

async function guardarExpedienteLocal(exp){ exp.fechaActualizacion=new Date().toISOString(); exp.pendienteSync=true; await dbPut("expedientes",exp); }

// A la hoja solo van datos y checklist (como en la app actual); fotos y croquis van a Drive
async function pushExpediente(exp){
  try{
    const res=await apiGuardarExpediente(exp.id,{origen:exp.origen, fechaCreacion:exp.fechaCreacion, solicitudId:exp.solicitudId, numExp:exp.numExp, datos:exp.datos, checklist:exp.checklist, drive:{url:exp.drive.url||""}},exp.estado);
    if(res && res.status==="ok"){ exp.pendienteSync=false; exp.fechaActualizacion=res.fechaActualizacion||exp.fechaActualizacion; await dbPut("expedientes",exp); return true; }
    return false;
  }catch(e){ return false; }
}

async function eliminarExpedienteLocal(id){
  const exp = await dbGet("expedientes", id); if(!exp) return;
  if(!confirm("¿Eliminar este expediente?\n\n\""+(exp.datos.direccion||"(sin dirección)")+"\"\n"+(exp.datos.nombre||"")+"\n\nLa carpeta de Drive, si existe, no se borra.")) return;
  let servidorOk=false, msg="";
  try{ const res=await apiBorrarExpediente(id); servidorOk = !!(res && (res.status==="ok" || String(res.message||"").toLowerCase().indexOf("no encontrado")>=0)); msg=(res&&res.message)||""; }
  catch(e){ msg="Sin conexión"; }
  await dbDelete("expedientes", id);
  toast(servidorOk?"Expediente eliminado":"Borrado local (servidor: "+msg+")");
  renderHome();
}

async function sincronizar(){
  showSync("Sincronizando…");
  try{
    const todos=await dbGetAll("expedientes");
    let pOk=0, pFail=0;
    for(const exp of todos.filter(e=>e.pendienteSync)){ if(await pushExpediente(exp)) pOk++; else pFail++; }
    const res=await apiListarExpedientes();
    let pull=0;
    if(res && res.status==="ok" && Array.isArray(res.expedientes)){
      const locales=await dbGetAll("expedientes");
      for(const r of res.expedientes){
        // Solo por id: las filas repetidas de una misma solicitud se guardan aparte y la lista las agrupa
        const local=locales.find(e=>e.id===r.id);
        if(!local){
          const exp=nuevoExpedienteVacio();
          exp.id=r.id; exp.fechaActualizacion=r.fechaActualizacion||exp.fechaActualizacion; exp.estado=r.estado||"pendiente";
          if(r.datos){
            if(r.datos.datos) exp.datos=Object.assign(exp.datos,r.datos.datos);
            if(r.datos.checklist) exp.checklist=Object.assign(exp.checklist,r.datos.checklist);
            if(r.datos.origen) exp.origen=r.datos.origen;
            if(r.datos.solicitudId) exp.solicitudId=r.datos.solicitudId;
            if(r.datos.numExp) exp.numExp=r.datos.numExp;
            if(r.datos.fechaCreacion) exp.fechaCreacion=r.datos.fechaCreacion;
            if(r.datos.drive && r.datos.drive.url) exp.drive.url=r.datos.drive.url;
          }
          exp.pendienteSync=false; await dbPut("expedientes",exp); pull++;
        } else if(!local.pendienteSync){
          if(new Date(r.fechaActualizacion||0).getTime()>new Date(local.fechaActualizacion||0).getTime()){
            normalizar(local);
            local.fechaActualizacion=r.fechaActualizacion; local.estado=r.estado||local.estado;
            if(r.datos){
              if(r.datos.datos) local.datos=Object.assign(local.datos,r.datos.datos);
              if(r.datos.checklist) local.checklist=Object.assign(local.checklist,r.datos.checklist);
              if(r.datos.numExp) local.numExp=r.datos.numExp;
            }
            await dbPut("expedientes",local); pull++;
          }
        }
      }
    }
    // Solicitudes del formulario web que aún no tienen expediente: entran solas en Pendientes
    try{
      const rs=await apiListarSolicitudes();
      if(rs && rs.status==="ok" && Array.isArray(rs.solicitudes)){
        const locales=await dbGetAll("expedientes");
        for(const s of rs.solicitudes){
          if(!s.id || (s.estado||"pendiente")!=="pendiente") continue;
          if(locales.some(e=>e.solicitudId===String(s.id))) continue;
          const exp=nuevoExpedienteVacio(); exp.id="sol_"+s.id; exp.origen="formulario"; exp.solicitudId=String(s.id);
          rellenarDesdeSolicitud(exp,s); exp.pendienteSync=false; await dbPut("expedientes",exp); pull++;
        }
      }
    }catch(e){}
    const cfg=await getCfg(); cfg.lastSync=new Date().toISOString(); await saveCfg(cfg);
    setStatus(true); hideSync(); renderHome();
    toast("Sincronizado · ↑"+pOk+" ↓"+pull+(pFail?" · "+pFail+" fallo":""));
    return true;
  }catch(e){ setStatus(false); hideSync(); toast("Sin conexión — guardado en local"); return false; }
}

// ---------------- Pantalla inicio ----------------
// La hoja tiene filas repetidas de la misma solicitud (una por móvil/navegador que la importó) y filas vacías.
// Se agrupan por solicitud y se muestra la más avanzada (enviado > visitado > pendiente).
const RANGO={pendiente:1, visitado:2, enviado:3};
function expVacio(e){
  const d=e.datos||{}, f=e.fotos||{};
  return !d.direccion && !d.nombre && !e.numExp && !(e.croquis&&e.croquis.tramos&&e.croquis.tramos.length) &&
    !["fachada","detalle","placas","croquisExtra"].some(k=>(f[k]||[]).length);
}
function claveGrupo(e){ return e.solicitudId ? "s:"+e.solicitudId : "i:"+e.id; }
function masAvanzado(a,b){
  const ra=RANGO[a.estado]||1, rb=RANGO[b.estado]||1;
  if(ra!==rb) return ra>rb;
  return new Date(a.fechaActualizacion||0).getTime() > new Date(b.fechaActualizacion||0).getTime();
}
function agruparExpedientes(exps){
  const g=new Map();
  for(const e of exps){ if(expVacio(e)) continue; const k=claveGrupo(e), a=g.get(k); if(!a || masAvanzado(e,a)) g.set(k,e); }
  return [...g.values()];
}
async function cambiarEstadoGrupo(exp, nuevo){
  const todos=await dbGetAll("expedientes"), k=claveGrupo(exp);
  for(const e of todos.filter(x=>claveGrupo(x)===k)){
    normalizar(e); e.estado=nuevo; await guardarExpedienteLocal(e); pushExpediente(e).catch(()=>{});
  }
  if(exp.solicitudId) apiActualizarEstadoSolicitud(exp.solicitudId, nuevo==="pendiente"?"pendiente":nuevo).catch(()=>{});
}
async function marcarTerminado(exp){
  if(!confirm("¿Marcar como terminado?\n\n"+(exp.datos.direccion||"(sin dirección)")+"\n\nPasa a Enviados y deja de salir en Pendientes y Visitados.")) return;
  await cambiarEstadoGrupo(exp,"enviado"); toast("Marcado como terminado ✓"); renderHome();
}
async function reabrir(exp){
  if(!confirm("¿Volver a poner en Pendientes?\n\n"+(exp.datos.direccion||"(sin dirección)"))) return;
  await cambiarEstadoGrupo(exp,"pendiente"); toast("Vuelve a Pendientes"); renderHome();
}

async function renderHome(){
  const exps=agruparExpedientes(await dbGetAll("expedientes"));
  const pend=exps.filter(e=>e.estado==="pendiente"), vis=exps.filter(e=>e.estado==="visitado"), env=exps.filter(e=>e.estado==="enviado");
  $("cnt-pend").textContent=pend.length; $("cnt-vis").textContent=vis.length; $("cnt-env").textContent=env.length;
  const tab=state.currentTab, list = tab==="pendiente"?pend: tab==="visitado"?vis: env;
  list.sort((a,b)=>new Date(b.fechaActualizacion||0)-new Date(a.fechaActualizacion||0));
  const cont=$("list-exps"); cont.innerHTML="";
  $("empty-list").style.display = list.length? "none":"block";
  for(const exp of list){
    const badge = exp.estado==="pendiente"?"pend": exp.estado==="visitado"?"vis":"env";
    const muni=muniDe(exp);
    const numExp=exp.numExp?"Exp. "+exp.numExp+" · ":"";
    const fechaStr=exp.datos.fechaVisita?"Visita: "+exp.datos.fechaVisita:("Últ. "+formatFecha(exp.fechaActualizacion));
    const marcas=(exp.pendienteSync?" · ↑":"")+(exp.drive&&exp.drive.url?" · ☁️":"");
    const item=document.createElement("div"); item.className="list-item";
    item.innerHTML='<div class="li-title">'+esc(exp.datos.direccion||"(sin dirección)")+esc(muni?", "+muni:"")+'</div><div class="li-sub">'+esc(exp.datos.nombre||"(sin nombre)")+'</div><div class="li-meta"><span>'+esc(numExp+fechaStr+marcas)+'</span><div class="li-meta-right"><span class="badge '+badge+'">'+esc(exp.estado)+'</span>'+
      (exp.estado==="enviado"?'<button class="btn-estado-exp" title="Volver a pendientes" type="button">↩</button>':'<button class="btn-estado-exp" title="Marcar como terminado" type="button">✔</button>')+
      '<button class="btn-delete-exp" title="Eliminar de este dispositivo" type="button">🗑</button></div></div>';
    item.onclick=()=>abrirExpediente(exp.id);
    item.querySelector(".btn-estado-exp").onclick=(ev)=>{ ev.stopPropagation(); if(exp.estado==="enviado") reabrir(exp); else marcarTerminado(exp); };
    item.querySelector(".btn-delete-exp").onclick=(ev)=>{ ev.stopPropagation(); eliminarExpedienteLocal(exp.id); };
    cont.appendChild(item);
  }
}

async function abrirExpediente(id){
  const exp=await dbGet("expedientes",id);
  if(!exp){ toast("No encontrado"); return; }
  state.expCurrent=normalizar(exp);
  rellenarFormDatos(exp); rellenarChecklist(exp);
  $("datos-title").textContent=exp.datos.direccion||"Expediente";
  go("datos");
}

// ---------------- Importar del formulario web ----------------
async function mostrarImportar(){ go("importar"); await cargarSolicitudes(); }
async function cargarSolicitudes(){
  const cont=$("list-solicitudes"); cont.innerHTML="<p class='muted'>Cargando…</p>"; $("empty-sol").style.display="none";
  try{
    const res=await apiListarSolicitudes(); cont.innerHTML="";
    if(!res || res.status!=="ok"){ cont.innerHTML="<p class='muted'>Error: "+esc(res&&res.message||"desconocido")+"</p>"; return; }
    const sols=(res.solicitudes||[]).filter(s=>(s.estado||"pendiente")==="pendiente").reverse();
    if(sols.length===0){ $("empty-sol").style.display="block"; return; }
    for(const s of sols){
      const item=document.createElement("div"); item.className="list-item";
      item.innerHTML='<div class="li-title">'+esc(s.direccion||"(sin dirección)")+esc(s.municipio?", "+s.municipio:"")+'</div><div class="li-sub">'+esc(s.nombre||"")+'</div><div class="li-meta"><span>'+esc(s.fecha||"")+'</span><span class="badge '+(s.estado==="visitado"?"vis":"pend")+'">'+esc(s.estado||"pendiente")+'</span></div>';
      item.onclick=()=>importarSolicitud(s.id);
      cont.appendChild(item);
    }
  }catch(e){ cont.innerHTML="<p class='muted'>No se pudo conectar: "+esc(e.message)+"</p>"; }
}
function rellenarDesdeSolicitud(exp,s){
  exp.datos.nombre=s.nombre||""; exp.datos.tipoDocumento=s.tipoDocumento||"DNI";
  exp.datos.numeroDocumento=s.numeroDocumento||""; exp.datos.telefono=s.telefono||"";
  exp.datos.email=s.email||""; exp.datos.direccion=s.direccion||"";
  exp.datos.codigoPostal=s.codigoPostal||""; exp.datos.referenciaCatastral=s.referenciaCatastral||"";
  exp.datos.fechaVisita=normFecha(s.fechaVisita); exp.datos.observaciones=s.observaciones||"";
  const muni=matchMuni(s.municipio);
  if(muni.startsWith("__custom__:")){ exp.datos.municipio="Otro"; exp.datos.municipioCustom=muni.substring(11); }
  else { exp.datos.municipio=muni; exp.datos.municipioCustom=""; }
}
async function importarSolicitud(id){
  if(state.importing){ toast("Espera… ya se está importando"); return; }
  state.importing=true; toast("Importando…");
  try{
    const res=await apiDetalleSolicitud(id);
    if(!res || res.status!=="ok" || !res.solicitud){ toast("No se pudo cargar"); return; }
    const s=res.solicitud;
    // Si ya existe (en este móvil o en la hoja, aunque lo importara otro móvil) se abre ese: así no se duplica
    let todos=await dbGetAll("expedientes");
    if(!todos.some(e=>e.solicitudId===String(id)) && navigator.onLine){ await sincronizar(); todos=await dbGetAll("expedientes"); }
    const mismos=todos.filter(e=>e.solicitudId===String(id));
    let exp=mismos.length ? mismos.reduce((a,b)=>masAvanzado(b,a)?b:a) : null;
    if(exp){
      normalizar(exp);
      if(exp.estado!=="pendiente" && !confirm("Esta solicitud ya está "+exp.estado+". ¿Abrirla igualmente?")) return;
      if(!exp.datos.direccion) rellenarDesdeSolicitud(exp,s);
    } else { exp=nuevoExpedienteVacio(); exp.id="sol_"+id; exp.origen="formulario"; exp.solicitudId=String(id); rellenarDesdeSolicitud(exp,s); }
    await guardarExpedienteLocal(exp);
    state.expCurrent=exp; pushExpediente(exp).catch(()=>{});
    rellenarFormDatos(exp); rellenarChecklist(exp);
    $("datos-title").textContent=exp.datos.direccion||"Expediente";
    go("datos"); toast("Importada ✓");
  }catch(e){ toast("Error: "+e.message); }
  finally{ state.importing=false; }
}

// ---------------- Datos ----------------
function rellenarFormDatos(exp){
  const d=exp.datos;
  $("f-numexp").value=exp.numExp||"";
  $("f-nombre").value=d.nombre||""; $("f-tipodoc").value=d.tipoDocumento||"DNI";
  $("f-numdoc").value=d.numeroDocumento||""; $("f-tel").value=d.telefono||"";
  $("f-email").value=d.email||""; $("f-direccion").value=d.direccion||"";
  $("f-muni").innerHTML=MUNIS.map(m=>'<option value="'+esc(m)+'"'+(m===d.municipio?" selected":"")+'>'+esc(m||"— seleccionar —")+'</option>').join("");
  $("f-cp").value=d.codigoPostal||""; $("f-refcat").value=d.referenciaCatastral||"";
  $("f-fechavisita").value=d.fechaVisita||""; $("f-obs").value=d.observaciones||"";
  if(d.municipio==="Otro"){ $("f-muni-custom-row").style.display="block"; $("f-muni-custom-inp").value=d.municipioCustom||""; }
  else $("f-muni-custom-row").style.display="none";
}
function leerFormDatos(exp){
  exp.numExp=$("f-numexp").value.trim();
  exp.datos.nombre=$("f-nombre").value.trim(); exp.datos.tipoDocumento=$("f-tipodoc").value;
  exp.datos.numeroDocumento=$("f-numdoc").value.trim(); exp.datos.telefono=$("f-tel").value.trim();
  exp.datos.email=$("f-email").value.trim(); exp.datos.direccion=$("f-direccion").value.trim();
  exp.datos.municipio=$("f-muni").value;
  exp.datos.municipioCustom = exp.datos.municipio==="Otro" ? $("f-muni-custom-inp").value.trim() : "";
  exp.datos.codigoPostal=$("f-cp").value.trim();
  exp.datos.referenciaCatastral=$("f-refcat").value.trim(); exp.datos.fechaVisita=$("f-fechavisita").value;
  exp.datos.observaciones=$("f-obs").value.trim();
}
function onCambiarMuni(){
  const row=$("f-muni-custom-row");
  if($("f-muni").value==="Otro"){
    row.style.display="block"; const inp=$("f-muni-custom-inp");
    if(!inp.value.trim()) pedirMunicipioCustom("", v=>{ if(v) inp.value=v; else { $("f-muni").value=""; row.style.display="none"; } });
  } else row.style.display="none";
}

// ---------------- Checklist ----------------
function rellenarChecklist(exp){
  const c=exp.checklist;
  $("c-tipoViv").value=c.tipoViv||"";
  $("c-reforma").checked=!!c.reformaImportante; $("c-reformaAnyo").value=c.reformaAnyo||"";
  $("c-reformaAnyo-row").style.display=c.reformaImportante?"block":"none";
  $("c-posAisl").value=c.posAislamiento||""; $("c-murosEspesor").value=c.murosEspesor||"";
  $("c-carpinteria").value=c.carpinteria||""; $("c-acristalamiento").value=c.acristalamiento||"";
  $("c-permeabilidad").value=c.permeabilidad||"";
  $("c-techo").value=c.techo||""; $("c-techoAislada").value=c.techoAislada||""; $("c-suelo").value=c.suelo||"";
  $("c-calTipo").value=c.calTipo||""; $("c-calComb").value=c.calComb||""; $("c-calDist").value=c.calDist||""; $("c-calAntig").value=c.calAntig||""; $("c-calPct").value=c.calPct||"";
  toggleCalef();
  $("c-refTipo").value=c.refTipo||""; $("c-refComb").value=c.refComb||""; $("c-refAntig").value=c.refAntig||""; $("c-refPct").value=c.refPct||"";
  toggleRefri();
  $("c-acsTipo").value=c.acsTipo||""; $("c-acsModalidad").value=c.acsModalidad||""; $("c-acsAcum").value=c.acsAcum||""; $("c-acsComb").value=c.acsComb||"";
  $("c-acsMixta").checked=!!c.acsMixta;
  $("c-renPaneles").checked=!!c.renPaneles; $("c-renPotencia").value=c.renPotencia||"";
  $("c-ren-row").style.display=c.renPaneles?"block":"none";
  $("c-obs").value=c.observaciones||"";
  $("c-firmaReq").checked=!!c.firmaReq;
  $("firma-box").style.display=c.firmaReq?"block":"none";
  Object.keys(GRUPOS_FOTO).forEach(k=>renderGaleria(k));
  pintarDriveInfo(exp);
}
function leerChecklist(exp){
  const c=exp.checklist;
  c.tipoViv=$("c-tipoViv").value;
  c.reformaImportante=$("c-reforma").checked; c.reformaAnyo=$("c-reformaAnyo").value.trim();
  c.posAislamiento=$("c-posAisl").value; c.murosEspesor=$("c-murosEspesor").value;
  c.carpinteria=$("c-carpinteria").value; c.acristalamiento=$("c-acristalamiento").value; c.permeabilidad=$("c-permeabilidad").value;
  c.techo=$("c-techo").value; c.techoAislada=$("c-techoAislada").value; c.suelo=$("c-suelo").value;
  c.calTipo=$("c-calTipo").value; c.calComb=$("c-calComb").value; c.calDist=$("c-calDist").value; c.calAntig=$("c-calAntig").value; c.calPct=$("c-calPct").value;
  c.refTipo=$("c-refTipo").value; c.refComb=$("c-refComb").value; c.refAntig=$("c-refAntig").value; c.refPct=$("c-refPct").value;
  c.acsTipo=$("c-acsTipo").value; c.acsModalidad=$("c-acsModalidad").value; c.acsAcum=$("c-acsAcum").value; c.acsComb=$("c-acsComb").value; c.acsMixta=$("c-acsMixta").checked;
  c.renPaneles=$("c-renPaneles").checked; c.renPotencia=$("c-renPotencia").value;
  c.firmaReq=$("c-firmaReq").checked;
  c.observaciones=$("c-obs").value.trim();
  if(c.firmaReq && state.firma.hasDrawn){ const cv=$("firma-canvas"); if(cv) exp.fotos.firma=cv.toDataURL("image/png"); }
  else if(!c.firmaReq) exp.fotos.firma="";
}
function toggleCalef(){ $("c-calef-detalle").style.display=$("c-calTipo").value==="No tiene instalada"?"none":"block"; }
function toggleRefri(){ $("c-refri-detalle").style.display=$("c-refTipo").value==="No tiene instalada"?"none":"block"; }
function toggleReforma(){ $("c-reformaAnyo-row").style.display=$("c-reforma").checked?"block":"none"; }
function toggleRen(){ $("c-ren-row").style.display=$("c-renPaneles").checked?"block":"none"; }
function toggleFirma(){ const on=$("c-firmaReq").checked; $("firma-box").style.display=on?"block":"none"; if(on) setTimeout(()=>initFirmaCanvas(),50); }
function irAChecklist(){
  go("checklist");
  const exp=state.expCurrent;
  if(exp && exp.checklist.firmaReq) setTimeout(()=>{ initFirmaCanvas(); if(exp.fotos.firma) pintarFirmaEnCanvas(exp.fotos.firma); },100);
}

// ---------------- Firma (igual que la app actual) ----------------
function initFirmaCanvas(){
  const cv=$("firma-canvas"); if(!cv) return;
  const rect=cv.getBoundingClientRect(); if(rect.width===0) return;
  const dpr=window.devicePixelRatio||1;
  cv.width=rect.width*dpr; cv.height=rect.height*dpr;
  const ctx=cv.getContext("2d"); ctx.scale(dpr,dpr);
  ctx.strokeStyle="#1338BE"; ctx.lineWidth=4.5; ctx.lineCap="round"; ctx.lineJoin="round";
  state.firma.ctx=ctx; state.firma.drawing=false; state.firma.hasDrawn=false;
  $("firma-info").textContent="—";
  cv.onpointerdown=(e)=>{ e.preventDefault(); state.firma.drawing=true; const p=puntoCanvas(cv,e); ctx.beginPath(); ctx.moveTo(p.x,p.y); };
  cv.onpointermove=(e)=>{ if(!state.firma.drawing) return; e.preventDefault(); const p=puntoCanvas(cv,e); ctx.lineTo(p.x,p.y); ctx.stroke(); state.firma.hasDrawn=true; $("firma-info").textContent="✓ Firma capturada"; };
  cv.onpointerup=cv.onpointerleave=cv.onpointercancel=()=>{ state.firma.drawing=false; };
}
function puntoCanvas(cv,e){ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; }
function clearFirma(){
  const cv=$("firma-canvas"); const ctx=state.firma.ctx; if(!cv||!ctx) return;
  ctx.clearRect(0,0,cv.width,cv.height); state.firma.hasDrawn=false; $("firma-info").textContent="—";
  if(state.expCurrent) state.expCurrent.fotos.firma="";
}
function pintarFirmaEnCanvas(dataUrl){
  const cv=$("firma-canvas"); if(!cv) return; const ctx=cv.getContext("2d"); const img=new Image();
  img.onload=()=>{ const r=cv.getBoundingClientRect(); ctx.clearRect(0,0,cv.width,cv.height); ctx.drawImage(img,0,0,r.width,r.height); state.firma.hasDrawn=true; $("firma-info").textContent="✓ Firma guardada"; };
  img.src=dataUrl;
}

// ---------------- Fotos múltiples ----------------
function renderGaleria(key){
  const exp=state.expCurrent, cont=$("gal-"+key); if(!cont||!exp) return;
  cont.innerHTML="";
  (exp.fotos[key]||[]).forEach((v,i)=>{
    const d=document.createElement("div"); d.className="ft";
    d.innerHTML = v.startsWith("data:application/pdf") ? "<span>PDF "+(i+1)+"</span>" : '<img alt="">';
    if(!v.startsWith("data:application/pdf")) d.querySelector("img").src=v;
    const b=document.createElement("button"); b.textContent="✕"; b.title="Quitar";
    b.onclick=async()=>{ if(!confirm("¿Quitar esta foto?")) return; exp.fotos[key].splice(i,1); await guardarExpedienteLocal(exp); renderGaleria(key); };
    d.appendChild(b); cont.appendChild(d);
  });
}
async function abrirCamara(key,title){
  state.camera.activeKey=key; state.camera.n=0;
  $("camera-title").textContent=title||"Capturar foto"; $("camera-count").textContent="Puedes hacer varias seguidas.";
  $("modal-camera").style.display="flex";
  try{
    const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:"environment",width:{ideal:1920},height:{ideal:1080}}});
    state.camera.stream=stream; $("camera-video").srcObject=stream; $("camera-video").play();
  }catch(err){ cerrarCamara(); toast("No se pudo acceder a la cámara: "+err.message); }
}
function cerrarCamara(){
  if(state.camera.stream){ state.camera.stream.getTracks().forEach(t=>t.stop()); state.camera.stream=null; }
  $("camera-video").srcObject=null; $("modal-camera").style.display="none";
  const k=state.camera.activeKey; state.camera.activeKey=null; if(k) renderGaleria(k);
}
async function capturarFoto(){
  const video=$("camera-video"), canvas=$("camera-canvas"), key=state.camera.activeKey, exp=state.expCurrent;
  if(!key||!exp||!video.videoWidth) return;
  let w=video.videoWidth, h=video.videoHeight; const max=1600;
  if(w>h && w>max){ h=Math.round(h*max/w); w=max; } else if(h>=w && h>max){ w=Math.round(w*max/h); h=max; }
  canvas.width=w; canvas.height=h; canvas.getContext("2d").drawImage(video,0,0,w,h);
  exp.fotos[key].push(canvas.toDataURL("image/jpeg",0.85));
  await guardarExpedienteLocal(exp);
  state.camera.n++; $("camera-count").textContent="✓ "+state.camera.n+" foto(s) guardada(s). Sigue o pulsa Cerrar.";
  if(navigator.vibrate) navigator.vibrate(30);
}
function redimensionar(file,maxDim,q){ return new Promise(resolve=>{
  const r=new FileReader();
  r.onload=e=>{ const img=new Image(); img.onload=()=>{ let w=img.width,h=img.height;
      if(w>h && w>maxDim){ h=h*maxDim/w; w=maxDim; } else if(h>maxDim){ w=w*maxDim/h; h=maxDim; }
      const c=document.createElement("canvas"); c.width=w; c.height=h; c.getContext("2d").drawImage(img,0,0,w,h); resolve(c.toDataURL("image/jpeg",q)); };
    img.src=e.target.result; };
  r.readAsDataURL(file);
});}
function leerComoDataUrl(file){ return new Promise(res=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.readAsDataURL(file); }); }
async function onFicherosElegidos(e){
  const key=state.fileKey, exp=state.expCurrent; const files=[...(e.target.files||[])];
  e.target.value=""; if(!key||!exp||!files.length) return;
  for(const f of files){ exp.fotos[key].push(f.type==="application/pdf" ? await leerComoDataUrl(f) : await redimensionar(f,1600,0.85)); }
  await guardarExpedienteLocal(exp); renderGaleria(key); toast(files.length+" archivo(s) añadido(s)");
}

// ---------------- PDF del checklist ----------------
async function generateChecklistPDF(exp){
  const doc=new window.jspdf.jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
  const lm=20, pw=170; let y=15;
  doc.setFillColor(74,138,128); doc.rect(0,0,210,28,"F");
  doc.setTextColor(255,255,255); doc.setFontSize(16); doc.setFont("helvetica","bold"); doc.text("CHECKLIST VISITA CEE",lm,12);
  doc.setFontSize(10); doc.setFont("helvetica","normal"); doc.text("Joanfe Ribes · Oficina Tècnica",lm,19); doc.text("Tel. 605 875 899 · joanferibes.com",lm,24);
  if(exp.numExp){ doc.setFontSize(11); doc.setFont("helvetica","bold"); doc.text("Exp. "+exp.numExp,200,12,{align:"right"}); }
  doc.setFontSize(9); doc.setFont("helvetica","normal"); doc.text(new Date().toLocaleDateString("es-ES"),200,19,{align:"right"});
  y=36; doc.setTextColor(0,0,0);
  function title(t){ if(y>260){ doc.addPage(); y=15; } doc.setFillColor(74,138,128); doc.rect(lm,y-4,pw,7,"F"); doc.setTextColor(255,255,255); doc.setFontSize(10); doc.setFont("helvetica","bold"); doc.text(t,lm+3,y+1); doc.setTextColor(0,0,0); y+=10; }
  function row(label,value){ if(y>275){ doc.addPage(); y=15; } doc.setFontSize(9); doc.setFont("helvetica","bold"); doc.text(label+":",lm,y); doc.setFont("helvetica","normal"); const v=String(value==null||value===""?"—":value); const lines=doc.splitTextToSize(v,pw-55); doc.text(lines,lm+55,y); y+=5.5*Math.max(1,lines.length); }
  const d=exp.datos, c=exp.checklist;
  title("DATOS GENERALES");
  row("Dirección",(d.direccion||"")+(d.codigoPostal?", "+d.codigoPostal:"")); row("Municipio",muniDe(exp)); row("Cliente",d.nombre);
  row(d.tipoDocumento||"DNI",d.numeroDocumento); row("Teléfono",d.telefono); row("Email",d.email);
  row("Ref. catastral",d.referenciaCatastral); row("Fecha visita",d.fechaVisita); row("Tipo inmueble",c.tipoViv);
  row("Reforma importante", c.reformaImportante?("Sí — Año "+(c.reformaAnyo||"?")):"No"); y+=3;
  title("ENVOLVENTE — MUROS / FACHADA"); row("Posibilidad aislamiento",c.posAislamiento); row("Espesor muros",c.murosEspesor?c.murosEspesor+" cm":""); y+=2;
  title("ENVOLVENTE — HUECOS"); row("Carpintería (defecto)",c.carpinteria); row("Acristalamiento (defecto)",c.acristalamiento); row("Permeabilidad",c.permeabilidad); y+=2;
  title("ENVOLVENTE — CUBIERTA Y SUELO"); row("Techo",(c.techo||"")+(c.techoAislada?" · "+c.techoAislada:"")); row("Suelo",c.suelo); y+=2;
  if(window.Croquis.hayDibujo(exp)){
    const an=window.Croquis.analizar(exp);
    title("CROQUIS");
    row("Superficie del polígono", an.superficiePoligono_m2.toFixed(2).replace(".",",")+" m²"+(an.poligonoCerrado?"":" (sin cerrar)"));
    row("Huecos", an.huecos.length+" ("+an.huecos.reduce((s,h)=>s+h.superficie_m2,0).toFixed(2).replace(".",",")+" m²)");
    row("Fachada neta", Object.keys(an.fachadasPorOrientacion).map(k=>k+" "+an.fachadasPorOrientacion[k].muroNeto_m2.toFixed(2).replace(".",",")).join(" · ")+" m²");
    y+=2;
  }
  title("CALEFACCIÓN");
  if(c.calTipo==="No tiene instalada") row("Sistema","No tiene instalada");
  else { row("Sistema",c.calTipo); row("Combustible",c.calComb); row("Distribución",c.calDist); row("Antigüedad",c.calAntig); row("% vivienda calefactada",c.calPct?c.calPct+" %":""); }
  y+=2; title("REFRIGERACIÓN");
  if(c.refTipo==="No tiene instalada") row("Sistema","No tiene instalada");
  else { row("Tipo (distribución)",c.refTipo); row("Sistema / energía",c.refComb); row("Antigüedad",c.refAntig); row("% vivienda climatizada",c.refPct?c.refPct+" %":""); }
  y+=2; title("ACS"); row("Tipo",c.acsTipo); row("Modalidad",c.acsModalidad); row("Acumulación",c.acsAcum); row("Combustible",c.acsComb); row("Mixta con calefacción",c.acsMixta?"Sí":"No");
  y+=2; title("ENERGÍAS RENOVABLES");
  if(c.renPaneles){ row("Paneles solares","Sí"); row("Potencia instalada",c.renPotencia?c.renPotencia+" kW":""); } else row("Paneles solares","No dispone");
  y+=2; title("FOTOS"); row("Fachada",exp.fotos.fachada.length); row("Detalle",exp.fotos.detalle.length); row("Placas de equipos",exp.fotos.placas.length);
  y+=2;
  if(c.observaciones){ title("OBSERVACIONES"); doc.setFontSize(9); doc.setFont("helvetica","normal"); const lines=doc.splitTextToSize(c.observaciones,pw); doc.text(lines,lm,y); y+=5*lines.length+2; }
  if(c.firmaReq && exp.fotos.firma){
    if(y>220){ doc.addPage(); y=20; }
    title("FIRMA DEL TITULAR");
    try{ doc.addImage(exp.fotos.firma,"PNG",lm,y,80,30); y+=32; doc.setFontSize(8); doc.setFont("helvetica","italic"); doc.text(d.nombre+"  ·  "+new Date().toLocaleDateString("es-ES"),lm,y); }catch(e){}
  }
  return doc.output("datauristring");
}

// ---------------- Carpeta de Drive del expediente ----------------
function carpetaDe(exp){
  const muni=muniDe(exp);
  return { direccion:(exp.datos.direccion||"SIN DIRECCION")+(muni?", "+muni:""), fecha:exp.datos.fechaVisita||hoyISO(), folderId:(exp.drive&&exp.drive.folderId)||"" };
}
function nombreBase(exp){ const p=prefijoExp(exp.numExp); return p?p+"_":""; }
function datosJson(exp){
  return JSON.stringify({
    app:"cee-visitas-pro", version:1, generado:new Date().toISOString(),
    id:exp.id, numExp:exp.numExp||"", origen:exp.origen, solicitudId:exp.solicitudId||"", estado:exp.estado,
    datos:exp.datos, municipio:muniDe(exp), checklist:exp.checklist,
    croquis: window.Croquis.hayDibujo(exp) ? window.Croquis.analizar(exp) : null,
    fotos:{ fachada:exp.fotos.fachada.length, detalle:exp.fotos.detalle.length, placas:exp.fotos.placas.length, croquisExtra:exp.fotos.croquisExtra.length, firma:!!exp.fotos.firma }
  }, null, 2);
}
// Lista de ficheros del expediente: [{nombre, dataUrl|texto, mime}]
async function ficherosExpediente(exp, paraCorreo){
  const nb=nombreBase(exp), lista=[];
  if(!paraCorreo) lista.push({nombre:"datos.json", texto:datosJson(exp), mime:"application/json"});
  lista.push({nombre:nb+"checklist.pdf", dataUrl:await generateChecklistPDF(exp)});
  if(window.Croquis.hayDibujo(exp)){
    lista.push({nombre:nb+"croquis.pdf", dataUrl:window.Croquis.pdfDataUrl(exp)});
    lista.push({nombre:nb+"croquis.dxf", texto:window.Croquis.dxfTexto(exp), mime:"application/dxf"});
    lista.push({nombre:nb+"croquis.json", texto:JSON.stringify(window.Croquis.analizar(exp),null,2), mime:"application/json"});
  }
  Object.keys(GRUPOS_FOTO).forEach(k=>{
    exp.fotos[k].forEach((v,i)=>{
      const pdf=v.startsWith("data:application/pdf");
      lista.push({nombre:nb+GRUPOS_FOTO[k]+"_"+(i+1)+(pdf?".pdf":".jpg"), dataUrl:v});
    });
  });
  if(exp.fotos.firma) lista.push({nombre:nb+"firma.png", dataUrl:exp.fotos.firma});
  return lista;
}
function pintarDriveInfo(exp){
  const el=$("drive-info"); if(!el) return;
  el.innerHTML = exp.drive && exp.drive.url ? 'Última subida: '+esc(formatFecha(exp.drive.subido))+' · <a href="'+esc(exp.drive.url)+'" target="_blank" rel="noopener">abrir carpeta</a>' : "Aún no se ha subido a Drive.";
}
async function guardarEnDrive(exp){
  if(state.subiendo){ toast("Ya se está subiendo"); return false; }
  if(!navigator.onLine){ toast("Sin conexión: súbelo a Drive cuando tengas cobertura"); return false; }
  if(!(await backendUrl())){ toast("Falta la URL del Apps Script (⚙ Configuración)"); return false; }
  state.subiendo=true;
  try{
    const ficheros=await ficherosExpediente(exp,false);
    let fallos=[];
    for(let i=0;i<ficheros.length;i++){
      const f=ficheros[i];
      showSync("Subiendo a Drive "+(i+1)+"/"+ficheros.length+" · "+f.nombre);
      let ok=false, intento=0;
      while(!ok && intento<3){
        intento++;
        try{
          const r=await apiPost(Object.assign({tipo:"subir_fichero", carpeta:carpetaDe(exp)}, f), 180000);
          if(r.folderId){ exp.drive.folderId=r.folderId; exp.drive.url=r.url||exp.drive.url; }
          ok=true;
        }catch(e){ if(intento>=3) fallos.push(f.nombre); }
      }
    }
    hideSync();
    if(fallos.length){ await guardarExpedienteLocal(exp); toast("Drive: fallaron "+fallos.length+" fichero(s). Pulsa otra vez para reintentar.",5000); pintarDriveInfo(exp); return false; }
    exp.drive.subido=new Date().toISOString(); exp.drive.fecha=exp.datos.fechaVisita||hoyISO();
    await guardarExpedienteLocal(exp); pushExpediente(exp).catch(()=>{});
    pintarDriveInfo(exp); toast("☁️ Guardado en Drive ("+ficheros.length+" ficheros)");
    return true;
  }catch(e){ hideSync(); toast("Error al subir a Drive: "+e.message,5000); return false; }
  finally{ state.subiendo=false; }
}

// ---------------- Impresos firmados (igual que ahora: acta + delegación por correo) ----------------
async function generarImpresosFirmados(){
  const exp=state.expCurrent; if(!exp) return;
  leerChecklist(exp);
  if(!exp.checklist.firmaReq){ toast("Activa primero 'Necesidad de firma del titular'"); return; }
  if(!exp.fotos.firma){ toast("Falta la firma del propietario"); return; }
  if(!exp.datos.nombre || !exp.datos.numeroDocumento){ toast("Faltan nombre o DNI del propietario"); return; }
  if(!exp.datos.direccion){ toast("Falta la dirección"); return; }
  await guardarExpedienteLocal(exp);
  showSync("Generando impresos firmados…");
  try{
    await apiPost({
      tipo:"impresos_firmados", numExp:prefijoExp(exp.numExp)||"sin", nombre:exp.datos.nombre, numeroDocumento:exp.datos.numeroDocumento,
      direccion:exp.datos.direccion, municipio:muniDe(exp), codigoPostal:exp.datos.codigoPostal,
      referenciaCatastral:exp.datos.referenciaCatastral, telefono:exp.datos.telefono, fechaVisita:exp.datos.fechaVisita,
      tipoPropiedad:"parte_edificio", firmaPropietario:exp.fotos.firma, carpeta:carpetaDe(exp)
    }, 180000);
    hideSync(); toast("✓ Impresos enviados a tu correo", 5000);
  }catch(e){ hideSync(); toast("Error: "+e.message, 5000); }
}

// ---------------- Correo al colaborador (un solo borrador con todo) ----------------
async function abrirPantallaEmail(){
  const exp=state.expCurrent; if(!exp) return;
  const cfg=await getCfg(), c=exp.checklist, muniStr=muniDe(exp);
  $("e-to").value=cfg.emailColab||"";
  $("e-asunto").value="CEE "+(prefijoExp(exp.numExp)?prefijoExp(exp.numExp)+"__":"")+(exp.datos.direccion||"");
  let croq="";
  if(window.Croquis.hayDibujo(exp)){
    const an=window.Croquis.analizar(exp);
    croq="\n\nCROQUIS\n- Superficie del polígono: "+an.superficiePoligono_m2.toFixed(2)+" m²"+(an.poligonoCerrado?"":" (contorno sin cerrar)")+"\n- Huecos: "+an.huecos.length+"\n- Fachada neta por orientación: "+Object.keys(an.fachadasPorOrientacion).map(k=>k+" "+an.fachadasPorOrientacion[k].muroNeto_m2.toFixed(2)).join(" · ")+" m² (altura libre 2,70 m)";
  }
  $("e-body").value="Hola,\n\nAdjunto datos y documentación de la visita para el certificado energético:\n\nDATOS DEL INMUEBLE\n- Expediente: "+(exp.numExp||"—")+"\n- Cliente: "+exp.datos.nombre+"\n- Dirección: "+exp.datos.direccion+"\n- Municipio: "+muniStr+" (CP "+exp.datos.codigoPostal+")\n- Ref. catastral: "+exp.datos.referenciaCatastral+"\n- Teléfono: "+exp.datos.telefono+"\n- Fecha de visita: "+exp.datos.fechaVisita+(cfg.tecnico?"\n- Visita realizada por: "+cfg.tecnico:"")+"\n- Tipo inmueble: "+c.tipoViv+(c.reformaImportante?"\n- Reforma importante: Sí (año "+(c.reformaAnyo||"?")+")":"")+
    "\n\nENVOLVENTE\n- Aislamiento posible en fachada: "+(c.posAislamiento||"—")+"\n- Espesor muros: "+(c.murosEspesor||"—")+" cm\n- Carpintería: "+(c.carpinteria||"—")+" · Acristalamiento: "+(c.acristalamiento||"—")+" · Permeabilidad: "+(c.permeabilidad||"—")+"\n- Techo: "+(c.techo||"—")+(c.techoAislada?" ("+c.techoAislada+")":"")+"\n- Suelo: "+(c.suelo||"—")+
    croq+
    "\n\nINSTALACIONES\n- Calefacción: "+(c.calTipo||"—")+(c.calTipo&&c.calTipo!=="No tiene instalada"?" · "+(c.calComb||"")+" · "+(c.calDist||"")+" · "+(c.calAntig||"")+" · "+(c.calPct||0)+"% vivienda":"")+
    "\n- Refrigeración: "+(c.refTipo||"—")+(c.refTipo&&c.refTipo!=="No tiene instalada"?" · "+(c.refComb||"")+" · "+(c.refAntig||"")+" · "+(c.refPct||0)+"% vivienda":"")+
    "\n- ACS: "+(c.acsTipo||"—")+(c.acsModalidad?" · "+c.acsModalidad:"")+(c.acsAcum?" · "+c.acsAcum:"")+(c.acsComb?" · "+c.acsComb:"")+(c.acsMixta?" · mixta con calefacción":"")+
    "\n- Renovables: "+(c.renPaneles?"Paneles "+(c.renPotencia||"?")+" kW":"No dispone")+
    "\n\nOBSERVACIONES\n"+(c.observaciones||"—")+
    "\n\nSe adjuntan: checklist en PDF, croquis (PDF, DXF y JSON), fotos"+(exp.fotos.placas.length?" (incluidas placas de equipos)":"")+(c.firmaReq?" y firma del titular":"")+"."+
    (exp.drive&&exp.drive.url?"\nCarpeta del expediente: "+exp.drive.url:"")+
    "\n\n"+(cfg.firma||"");
  go("email");
}
async function crearBorradorGmail(){
  const exp=state.expCurrent; if(!exp) return;
  const to=$("e-to").value.trim(), subject=$("e-asunto").value.trim(), body=$("e-body").value;
  if(!to){ toast("Falta destinatario"); return; }
  if(!window.jspdf){ toast("jsPDF no cargado, reintenta"); return; }
  showSync("Preparando adjuntos…");
  try{
    const adjuntos=await ficherosExpediente(exp,true);
    showSync("Creando borrador en Gmail ("+adjuntos.length+" adjuntos)…");
    const r=await apiPost({tipo:"borrador", to, subject, body, adjuntos}, 240000);
    hideSync(); toast("✓ Borrador creado en Gmail con "+r.adjuntos+" adjuntos", 4000);
    exp.estado="enviado"; await guardarExpedienteLocal(exp); pushExpediente(exp).catch(()=>{});
    if(exp.solicitudId) apiActualizarEstadoSolicitud(exp.solicitudId,"enviado").catch(()=>{});
  }catch(e){ hideSync(); toast("Error: "+e.message, 5000); }
}

// ---------------- Configuración ----------------
async function cargarCfgUI(){
  const cfg=await getCfg();
  $("cfg-url").value=cfg.scriptUrl||DEFAULT_SCRIPT_URL; $("cfg-colab").value=cfg.emailColab||""; $("cfg-firma").value=cfg.firma||""; $("cfg-tecnico").value=cfg.tecnico||"";
  $("sync-info").textContent=cfg.lastSync?"Última sincronización: "+formatFecha(cfg.lastSync):"Sin sincronizar todavía";
}
async function guardarCfgUI(){
  const cfg=await getCfg();
  cfg.scriptUrl=$("cfg-url").value.trim()||DEFAULT_SCRIPT_URL; cfg.emailColab=$("cfg-colab").value.trim(); cfg.firma=$("cfg-firma").value; cfg.tecnico=$("cfg-tecnico").value.trim();
  await saveCfg(cfg); toast("Configuración guardada");
}
async function testConexion(){
  showSync("Probando conexión…");
  try{ const res=await apiStatus(); hideSync();
    if(res && res.status==="ok"){ setStatus(true); toast("✓ Conectado · "+(res.service||"OK")+" v"+(res.version||"?")); } else toast("Respuesta inesperada");
  }catch(e){ hideSync(); setStatus(false); toast("Sin conexión: "+e.message); }
}

// ---------------- Croquis ----------------
function abrirCroquis(){
  const exp=state.expCurrent; if(!exp) return;
  go("croquis");
  window.Croquis.abrir(exp, ()=>guardarExpedienteLocal(exp));
}
// Pestañas Datos / Croquis / Checklist / Enviar: se puede saltar de una a otra en cualquier momento.
// Antes de cambiar se guarda lo que haya en la pantalla actual.
async function guardarPantallaActual(){
  const exp=state.expCurrent; if(!exp) return;
  const desde=state.pantalla;
  if(desde==="datos") leerFormDatos(exp);
  else if(desde==="checklist") leerChecklist(exp);
  else if(desde==="croquis") window.Croquis.cerrar();
  await guardarExpedienteLocal(exp);
  if(desde==="datos"||desde==="checklist") pushExpediente(exp).catch(()=>{});
}
async function irA(dest){
  const exp=state.expCurrent; if(!exp || state.pantalla===dest) return;
  await guardarPantallaActual();
  if(dest==="datos"){ rellenarFormDatos(exp); go("datos"); }
  else if(dest==="croquis") abrirCroquis();
  else if(dest==="checklist"){ rellenarChecklist(exp); irAChecklist(); }
  else if(dest==="email") await abrirPantallaEmail();
}
async function salirAInicio(){ await guardarPantallaActual(); go("home"); renderHome(); }

// ---------------- Arranque ----------------
async function init(){
  if("serviceWorker" in navigator){ try{ await navigator.serviceWorker.register("sw.js?v=2"); }catch(e){} }
  const optsSel=(id,lista)=>{ $(id).innerHTML='<option value="">—</option>'+lista.map(v=>'<option>'+v+'</option>').join(""); };
  optsSel("c-carpinteria", window.Croquis.MATERIALES); optsSel("c-acristalamiento", window.Croquis.VIDRIOS);

  document.querySelectorAll("[data-go]").forEach(b=>{ b.onclick=()=>go(b.getAttribute("data-go")); });
  document.querySelectorAll(".tab").forEach(t=>{ t.onclick=()=>{ document.querySelectorAll(".tab").forEach(x=>x.classList.remove("active")); t.classList.add("active"); state.currentTab=t.getAttribute("data-tab"); renderHome(); }; });
  $("btn-nuevo").onclick=()=>go("nuevo");
  $("btn-sync").onclick=()=>sincronizar();
  $("btn-cfg").onclick=async()=>{ await cargarCfgUI(); go("cfg"); };
  $("btn-origen-web").onclick=()=>mostrarImportar();
  $("btn-origen-manual").onclick=()=>{ state.expCurrent=nuevoExpedienteVacio(); rellenarFormDatos(state.expCurrent); rellenarChecklist(state.expCurrent); $("datos-title").textContent="Nuevo expediente"; go("datos"); };
  $("btn-importar-reload").onclick=()=>cargarSolicitudes();

  $("btn-guardar-datos").onclick=async()=>{
    if(!state.expCurrent) return;
    leerFormDatos(state.expCurrent); await guardarExpedienteLocal(state.expCurrent);
    const ok=await pushExpediente(state.expCurrent);
    toast(ok?"Guardado ✓ (sigue en pendientes)":"Guardado en local (↑ pendiente)"); renderHome();
  };
  document.querySelectorAll("[data-paso]").forEach(b=>{ b.onclick=()=>irA(b.getAttribute("data-paso")); });
  $("croq-back").onclick=()=>salirAInicio();
  $("bCroqSig").onclick=()=>irA("checklist");
  $("chk-back").onclick=()=>salirAInicio();
  $("datos-back").onclick=()=>salirAInicio();

  $("btn-guardar").onclick=async()=>{
    const exp=state.expCurrent; if(!exp) return;
    leerChecklist(exp);
    if(exp.estado!=="enviado") exp.estado="visitado";
    await guardarExpedienteLocal(exp);
    const ok=await pushExpediente(exp);
    toast(ok?"Guardado ✓ (marcado como visitado)":"Guardado en local (↑ pendiente)");
    renderHome();
    if(navigator.onLine) await guardarEnDrive(exp);
  };
  $("btn-drive").onclick=async()=>{ const exp=state.expCurrent; if(!exp) return; leerChecklist(exp); await guardarExpedienteLocal(exp); await guardarEnDrive(exp); };
  $("btn-enviar").onclick=async()=>{ const exp=state.expCurrent; if(!exp) return; leerChecklist(exp); await guardarExpedienteLocal(exp); await abrirPantallaEmail(); };
  $("btn-crear-borrador").onclick=()=>crearBorradorGmail();
  $("btn-generar-impresos").onclick=()=>generarImpresosFirmados();

  $("c-reforma").onchange=toggleReforma; $("c-calTipo").onchange=toggleCalef; $("c-refTipo").onchange=toggleRefri;
  $("c-renPaneles").onchange=toggleRen; $("c-firmaReq").onchange=toggleFirma;
  $("btn-firma-clear").onclick=clearFirma;
  $("f-muni").onchange=onCambiarMuni;

  document.querySelectorAll("[data-cam]").forEach(b=>{ b.onclick=()=>abrirCamara(b.getAttribute("data-cam"), b.getAttribute("data-cam-title")); });
  document.querySelectorAll("[data-file]").forEach(b=>{ b.onclick=()=>{ state.fileKey=b.getAttribute("data-file"); (b.getAttribute("data-pdf")?$("inp-fotos-pdf"):$("inp-fotos")).click(); }; });
  $("inp-fotos").onchange=onFicherosElegidos; $("inp-fotos-pdf").onchange=onFicherosElegidos;
  $("camera-cancel").onclick=cerrarCamara; $("camera-capture").onclick=capturarFoto;

  $("btn-save-cfg").onclick=()=>guardarCfgUI();
  $("btn-sync-now").onclick=()=>sincronizar();
  $("btn-test-conn").onclick=()=>testConexion();
  $("btn-reset-local").onclick=async()=>{ if(!confirm("¿Borrar datos locales? Los del servidor y Drive se mantienen.")) return; await dbClear("expedientes"); toast("Datos locales borrados"); renderHome(); };

  window.addEventListener("online",()=>{ setStatus(true); sincronizar(); });
  window.addEventListener("offline",()=>setStatus(false));
  setStatus(navigator.onLine);
  await renderHome();
  const idParam=new URLSearchParams(location.search).get("id");
  if(idParam){ await mostrarImportar(); await importarSolicitud(idParam); }
  if(navigator.onLine && (await backendUrl())) setTimeout(()=>sincronizar(),500);
}
document.addEventListener("DOMContentLoaded",init);
})();
