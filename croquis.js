/* =========================================================
   CROQUIS · CEE Visitas Pro · Joanfe Ribes Oficina Tècnica
   Basado en Croquis CEE v1.0 (Leica DISTO D2 por BLE).
   El croquis vive dentro del expediente: exp.croquis
     { norte, libre, tramos:[ {origin:[x,y], segs:[ {kind,len,alto,mat,vid,ang,zona,cierre} ]} ] }
   (metros, ang en radianes, Y hacia abajo en pantalla)
   norte = ángulo en pantalla (grados, horario desde "arriba") hacia el que apunta el norte real.
   ========================================================= */
(function(){
"use strict";

const MATERIALES = ["PVC","Aluminio","Aluminio RPT","Madera","Hierro"];
const VIDRIOS    = ["Simple","Doble","Doble bajo emisivo","Triple"];
const ALTURA_LIBRE = 2.70;
const DIRS = ['N','NE','E','SE','S','SO','O','NO'];

const $ = id => document.getElementById(id);
const fmt = n => (Math.round(n*100)/100).toFixed(2).replace('.',',');
const opts = (sel, lista) => { sel.innerHTML = lista.map(v => '<option>'+v+'</option>').join(''); };

let exp = null;            // expediente abierto
let onChange = null;       // callback para guardar
let anguloLibre = false;
let pendienteNuevoTramo = false;
let editando = null;       // {t,s}
let strokeAng = 0, strokeOrigen = null;
let zonaSel = 'ext', tipoSel = 'pared';
let view = {s:60, cx:0, cy:0};
let cv, ctx, iniciado = false;

// ---------- Modelo ----------
function vacio(){ return { norte:0, libre:false, tramos:[] }; }
function modelo(){ if(!exp.croquis) exp.croquis = vacio(); return exp.croquis; }
function matDef(e){ const c=(e||exp).checklist||{}; return MATERIALES.includes(c.carpinteria) ? c.carpinteria : 'Aluminio'; }
function vidDef(e){ const c=(e||exp).checklist||{}; return VIDRIOS.includes(c.acristalamiento) ? c.acristalamiento : 'Doble'; }
function hayDibujo(e){ const m=(e||exp)&&(e||exp).croquis; return !!(m && m.tramos && m.tramos.some(t=>t.segs.length)); }
function guardar(){ if(onChange) onChange(); }

function tituloDe(e){
  const d=(e.datos.direccion||'').trim();
  const m=(e.datos.municipio==='Otro' ? (e.datos.municipioCustom||'') : (e.datos.municipio||'')).trim();
  if(d&&m) return d+', '+m+' (Alacant)';
  return d || (m ? m+' (Alacant)' : 'Croquis sin dirección');
}

function puntosTramo(t){
  const pts=[t.origin.slice()]; let p=t.origin.slice();
  for(const s of t.segs){ p=[p[0]+s.len*Math.cos(s.ang), p[1]+s.len*Math.sin(s.ang)]; pts.push(p.slice()); }
  return pts;
}
function bboxDe(m){
  let xs=[],ys=[];
  for(const t of m.tramos) for(const p of puntosTramo(t)){xs.push(p[0]);ys.push(p[1]);}
  if(!xs.length) return null;
  return {x0:Math.min(...xs),x1:Math.max(...xs),y0:Math.min(...ys),y1:Math.max(...ys)};
}
// Área con signo (shoelace). >0 = horario en pantalla (Y hacia abajo)
function areaSigno(pts){ let a=0; for(let i=0;i<pts.length-1;i++) a+=pts[i][0]*pts[i+1][1]-pts[i+1][0]*pts[i][1]; return a/2; }
function normalExterior(a,b,horario){
  const dx=b[0]-a[0], dy=b[1]-a[1]; const L=Math.hypot(dx,dy)||1;
  let nx=dy/L, ny=-dx/L; if(!horario){ nx=-nx; ny=-ny; } return [nx,ny];
}
// Rumbo real (0=N, horario) de la normal exterior, corregido por el norte del dibujo
function rumbo(nx,ny,norteDeg){ let ang=Math.atan2(nx,-ny)*180/Math.PI - norteDeg; return ((ang%360)+360)%360; }
function cardinal(gr){ return DIRS[Math.round(gr/45)%8]; }

function etiquetasHuecos(m){
  let nv=0,np=0; const map=new Map();
  m.tramos.forEach((t,ti)=>t.segs.forEach((s,si)=>{
    if(s.kind==='ventana') map.set(ti+'-'+si,'V'+(++nv));
    if(s.kind==='puerta')  map.set(ti+'-'+si,'P'+(++np));
  }));
  return map;
}
function abrevia(s){ return {'PVC':'PVC','Madera':'mad','Aluminio RPT':'RPT','Hierro':'hierro','Aluminio':'alu'}[s]||s; }
function abreviaVid(v){ return {'Simple':'simple','Doble':'doble','Doble bajo emisivo':'BE','Triple':'triple'}[v]||v; }
function txtHueco(e,s,tag){
  const md=matDef(e), vd=vidDef(e);
  let extra='';
  if(s.mat && s.mat!==md) extra+=' '+abrevia(s.mat);
  if(s.vid && s.vid!==vd) extra+=' '+abreviaVid(s.vid);
  return tag+': '+fmt(s.len)+'×'+fmt(s.alto)+extra;
}

// ---------- Análisis (lo que usa la tarea nocturna) ----------
function analizar(e){
  const m=e.croquis||vacio(); const tags=etiquetasHuecos(m); const norte=m.norte||0;
  const porOri={}; DIRS.forEach(d=>porOri[d]={longitud_m:0, muroBruto_m2:0, huecos_m2:0, muroNeto_m2:0});
  let lMed=0,lCom=0,per=0, sup=0; const huecos=[], tramos=[]; let cerrado=true;
  m.tramos.forEach((t,ti)=>{
    const pts=puntosTramo(t); if(!t.segs.length) return;
    const horario=areaSigno(pts)>0;
    const ini=pts[0], fin=pts[pts.length-1];
    const cierra=Math.hypot(ini[0]-fin[0],ini[1]-fin[1])<0.05;
    if(cierra) sup+=Math.abs(areaSigno(pts)); else cerrado=false;
    const segs=[];
    t.segs.forEach((s,si)=>{
      const ne=normalExterior(pts[si],pts[si+1],horario);
      const gr=rumbo(ne[0],ne[1],norte), ori=cardinal(gr);
      const zona = s.kind==='pared' ? (s.zona||'ext') : 'ext';
      per+=s.len;
      const item={ tipo:s.kind, longitud_m:+s.len.toFixed(3), zona, orientacion:ori, rumbo_grados:+gr.toFixed(1) };
      if(s.kind==='pared'){
        if(zona==='med') lMed+=s.len; else if(zona==='com') lCom+=s.len;
        else { porOri[ori].longitud_m+=s.len; porOri[ori].muroBruto_m2+=s.len*ALTURA_LIBRE; }
      } else {
        const a=s.len*s.alto, tag=tags.get(ti+'-'+si);
        Object.assign(item,{ etiqueta:tag, alto_m:+s.alto.toFixed(3), superficie_m2:+a.toFixed(3), material:s.mat||matDef(e), vidrio:s.vid||vidDef(e) });
        porOri[ori].longitud_m+=s.len; porOri[ori].muroBruto_m2+=s.len*ALTURA_LIBRE; porOri[ori].huecos_m2+=a;
        huecos.push({ etiqueta:tag, tipo:s.kind==='ventana'?'Ventana':'Puerta', ancho_m:+s.len.toFixed(3), alto_m:+s.alto.toFixed(3), superficie_m2:+a.toFixed(3), material:s.mat||matDef(e), vidrio:s.vid||vidDef(e), orientacion:ori });
      }
      segs.push(item);
    });
    tramos.push({ cerrado:cierra, segmentos:segs });
  });
  Object.keys(porOri).forEach(k=>{ const o=porOri[k];
    if(!o.longitud_m){ delete porOri[k]; return; }
    o.muroNeto_m2=o.muroBruto_m2-o.huecos_m2;
    ['longitud_m','muroBruto_m2','huecos_m2','muroNeto_m2'].forEach(c=>o[c]=+o[c].toFixed(2));
  });
  return {
    version:1, generado:new Date().toISOString(),
    numExp:e.numExp||'', direccion:tituloDe(e), fechaVisita:e.datos.fechaVisita||'',
    alturaLibre_m:ALTURA_LIBRE, norte_grados:+(norte).toFixed(1),
    carpinteriaDefecto:matDef(e), vidrioDefecto:vidDef(e),
    poligonoCerrado: cerrado && tramos.length>0,
    superficiePoligono_m2:+sup.toFixed(2), superficieUtil_m2:Math.round(sup),
    longitudTotal_m:+per.toFixed(2), medianera_m:+lMed.toFixed(2), zonaComun_m:+lCom.toFixed(2),
    fachadasPorOrientacion:porOri, huecos, tramos
  };
}

// ---------- Lienzo ----------
const w2s = p => { const W=cv.width/devicePixelRatio,H=cv.height/devicePixelRatio; return [(p[0]-view.cx)*view.s+W/2,(p[1]-view.cy)*view.s+H/2]; };
const s2w = p => { const W=cv.width/devicePixelRatio,H=cv.height/devicePixelRatio; return [(p[0]-W/2)/view.s+view.cx,(p[1]-H/2)/view.s+view.cy]; };

function redim(){
  if(!cv || !exp) return;
  const r=cv.parentElement.getBoundingClientRect();
  if(!r.width || !r.height) return;
  cv.width=r.width*devicePixelRatio; cv.height=r.height*devicePixelRatio;
  ctx.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
  ajustarVista(); dibujar();
}
function ajustarVista(){
  const W=cv.width/devicePixelRatio, H=cv.height/devicePixelRatio;
  const b=bboxDe(modelo());
  if(!b){ view={s:60,cx:0,cy:0}; return; }
  // margen para cotas, proporcional en lienzos pequeños (móvil en horizontal): nunca escala negativa
  const m=Math.min(70, W*0.18, H*0.18), w=Math.max(b.x1-b.x0,0.5), h=Math.max(b.y1-b.y0,0.5);
  view.s=Math.max(Math.min((W-2*m)/w,(H-2*m)/h,120), 2); view.cx=(b.x0+b.x1)/2; view.cy=(b.y0+b.y1)/2;
}

function dibujar(){
  if(!cv||!exp) return;
  const W=cv.width/devicePixelRatio,H=cv.height/devicePixelRatio;
  ctx.clearRect(0,0,W,H);
  ctx.strokeStyle='#EEF3F2'; ctx.lineWidth=1;
  const paso=view.s>=30?view.s:view.s*5;
  if(paso>14){
    for(let x=(W/2-view.cx*view.s)%paso;x<W;x+=paso){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
    for(let y=(H/2-view.cy*view.s)%paso;y<H;y+=paso){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  }
  const m=modelo(), tags=etiquetasHuecos(m);
  m.tramos.forEach((t,ti)=>{
    const pts=puntosTramo(t);
    t.segs.forEach((s,si)=>{
      const a=w2s(pts[si]), b=w2s(pts[si+1]);
      const esHueco=s.kind!=='pared', zona=s.zona||'ext';
      ctx.save();
      if(esHueco){ ctx.strokeStyle='#D93025'; ctx.lineWidth=5; }
      else if(zona==='med'){ ctx.strokeStyle='#22302D'; ctx.lineWidth=6; }
      else if(zona==='com'){ ctx.strokeStyle='#22302D'; ctx.lineWidth=3; ctx.setLineDash([9,5]); }
      else { ctx.strokeStyle='#22302D'; ctx.lineWidth=3; }
      ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke();
      if(zona==='med'){ ctx.strokeStyle='#9AA8A5'; ctx.lineWidth=2; ctx.setLineDash([4,4]); ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); }
      ctx.restore();
      ctx.fillStyle='#22302D'; [a,b].forEach(p=>{ctx.beginPath();ctx.arc(p[0],p[1],2.5,0,7);ctx.fill();});
      etiquetaLinea(a,b,fmt(s.len),'#000',false,+1);
      if(esHueco) etiquetaLinea(a,b,txtHueco(exp,s,tags.get(ti+'-'+si)),'#000',true,-1);
      else if(zona!=='ext') etiquetaLinea(a,b,zona==='med'?'Medianera':'Zona común','#5C7370',true,-1);
    });
    if(t.segs.length===0){ const o=w2s(t.origin); ctx.fillStyle='#4A8A80'; ctx.beginPath(); ctx.arc(o[0],o[1],5,0,7); ctx.fill(); }
  });
  if(trazo.activo && trazo.pts.length>1){
    ctx.strokeStyle='#4A8A80'; ctx.setLineDash([7,5]); ctx.lineWidth=2.5;
    const a=trazo.pts[0], b=trazo.fin; ctx.beginPath();ctx.moveTo(a[0],a[1]);ctx.lineTo(b[0],b[1]);ctx.stroke(); ctx.setLineDash([]);
  }
  $('hint').style.display = hayDibujo() && !pendienteNuevoTramo ? 'none' : 'block';
  if(hayDibujo()) dibujarNorteEn(ctx, W-34, 38, 20, m.norte||0);
  actualizarTotal();
}
function dibujarNorteEn(c, cx, cy, r, norteDeg){
  const a=(norteDeg-90)*Math.PI/180;
  c.save();
  c.strokeStyle='#4A8A80'; c.lineWidth=1.5; c.beginPath(); c.arc(cx,cy,r,0,7); c.stroke();
  const ex=cx+r*Math.cos(a), ey=cy+r*Math.sin(a), bx=cx-r*0.6*Math.cos(a), by=cy-r*0.6*Math.sin(a);
  c.strokeStyle='#22302D'; c.lineWidth=2; c.beginPath(); c.moveTo(bx,by); c.lineTo(ex,ey); c.stroke();
  const pa=0.4; c.fillStyle='#D93025'; c.beginPath(); c.moveTo(ex,ey);
  c.lineTo(ex-9*Math.cos(a-pa),ey-9*Math.sin(a-pa)); c.lineTo(ex-9*Math.cos(a+pa),ey-9*Math.sin(a+pa)); c.closePath(); c.fill();
  c.fillStyle='#22302D'; c.font='700 12px system-ui'; c.textAlign='center'; c.textBaseline='middle';
  c.fillText('N', cx+(r+9)*Math.cos(a), cy+(r+9)*Math.sin(a));
  c.restore();
}
function etiquetaLinea(a,b,txt,col,negrita,lado){
  const mx=(a[0]+b[0])/2,my=(a[1]+b[1])/2;
  let ang=Math.atan2(b[1]-a[1],b[0]-a[0]), flip=1;
  if(ang>Math.PI/2||ang<-Math.PI/2){ ang+=Math.PI; flip=-1; }
  const off=9*(lado||1)*flip;
  ctx.save(); ctx.translate(mx,my); ctx.rotate(ang);
  ctx.font=(negrita?'700 ':'600 ')+'12px system-ui'; ctx.fillStyle=col; ctx.textAlign='center';
  ctx.textBaseline=off<0?'bottom':'top'; ctx.fillText(txt,0,off<0?-4:4); ctx.restore();
}
function actualizarTotal(){
  let tot=0,nv=0,np=0;
  modelo().tramos.forEach(t=>t.segs.forEach(s=>{tot+=s.len; if(s.kind==='ventana')nv++; if(s.kind==='puerta')np++;}));
  const bar=$('totalBar');
  if(tot>0){ const an=analizar(exp); bar.style.display='block';
    bar.textContent='Σ '+fmt(tot)+' m · '+nv+' V · '+np+' P'+(an.superficiePoligono_m2?' · '+fmt(an.superficiePoligono_m2)+' m²':''); }
  else bar.style.display='none';
}

// ---------- Trazo con el dedo ----------
const trazo={activo:false,pts:[],fin:null};
function snap(a){ const paso=anguloLibre?Math.PI/180:Math.PI/4; return Math.round(a/paso)*paso; }
function engancharLienzo(){
  cv.addEventListener('pointerdown',e=>{ trazo.activo=true; trazo.pts=[[e.offsetX,e.offsetY]]; trazo.fin=[e.offsetX,e.offsetY]; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove',e=>{
    if(!trazo.activo) return;
    trazo.fin=[e.offsetX,e.offsetY];
    const a=trazo.pts[0], dx=trazo.fin[0]-a[0], dy=trazo.fin[1]-a[1], d=Math.hypot(dx,dy);
    if(d>8){ const ang=snap(Math.atan2(dy,dx)); trazo.fin=[a[0]+d*Math.cos(ang),a[1]+d*Math.sin(ang)]; }
    dibujar();
  });
  cv.addEventListener('pointerup',()=>{
    if(!trazo.activo) return; trazo.activo=false;
    const a=trazo.pts[0], b=trazo.fin, d=Math.hypot(b[0]-a[0],b[1]-a[1]);
    dibujar(); if(d<25) return;
    strokeAng=snap(Math.atan2(b[1]-a[1],b[0]-a[0]));
    const m=modelo();
    if(m.tramos.length===0) strokeOrigen=[0,0];
    else if(pendienteNuevoTramo) strokeOrigen=s2w(a);
    else strokeOrigen=null;
    abrirSeg();
  });
}

// ---------- Hoja de segmento ----------
function abrirSeg(){
  editando=null; setTipo('pared'); setZona('ext');
  $('segTitulo').textContent='Nuevo tramo';
  $('inLong').value=''; $('inAlto').value=''; $('inMat').value=matDef(); $('inVid').value=vidDef();
  $('laserHint').classList.toggle('visible', !!btCar);
  $('veloSeg').classList.add('abierto');
  setTimeout(()=>$('inLong').focus(),100);
}
function cerrarSeg(){ $('veloSeg').classList.remove('abierto'); editando=null; }
function setTipo(t){
  tipoSel=t;
  ['tPared','tVentana','tPuerta'].forEach(id=>$(id).classList.remove('sel'));
  $({pared:'tPared',ventana:'tVentana',puerta:'tPuerta'}[t]).classList.add('sel');
  $('lblLong').textContent = t==='pared'?'Longitud (m)':'Ancho (m)';
  $('cAlto').style.display = t==='pared'?'none':'block';
  $('cMat').style.display  = t==='pared'?'none':'block';
  $('cZona').style.display = t==='pared'?'block':'none';
}
function setZona(z){
  zonaSel=z;
  ['zExt','zMed','zCom'].forEach(id=>$(id).classList.remove('sel'));
  $({ext:'zExt',med:'zMed',com:'zCom'}[z]).classList.add('sel');
}
function guardarSeg(){
  const len=parseFloat(String($('inLong').value).replace(',','.'));
  if(!(len>0)){ $('inLong').focus(); return; }
  let seg={kind:tipoSel,len,ang:strokeAng};
  if(tipoSel!=='pared'){
    const alto=parseFloat(String($('inAlto').value).replace(',','.'));
    if(!(alto>0)){ $('inAlto').focus(); return; }
    seg.alto=alto; seg.mat=$('inMat').value; seg.vid=$('inVid').value;
  } else seg.zona=zonaSel;
  const m=modelo();
  if(editando){ const s=m.tramos[editando.t].segs[editando.s]; seg.ang=s.ang; if(s.cierre) seg.cierre=true; m.tramos[editando.t].segs[editando.s]=seg; }
  else {
    if(strokeOrigen!==null){ m.tramos.push({origin:strokeOrigen,segs:[]}); pendienteNuevoTramo=false; }
    if(!m.tramos.length) m.tramos.push({origin:[0,0],segs:[]});
    m.tramos[m.tramos.length-1].segs.push(seg);
  }
  cerrarSeg(); ajustarVista(); dibujar(); guardar();
}

// ---------- Botones ----------
function deshacer(){
  const m=modelo();
  for(let i=m.tramos.length-1;i>=0;i--){
    if(m.tramos[i].segs.length){ m.tramos[i].segs.pop(); if(!m.tramos[i].segs.length&&i>0) m.tramos.pop(); break; }
    else m.tramos.pop();
  }
  ajustarVista(); dibujar(); guardar();
}
function nuevoTramo(){ pendienteNuevoTramo=true; $('hint').style.display='block'; $('hint').textContent='Dibuja el nuevo tramo donde quieras: empezará en un punto independiente'; }
function cerrarPoli(){
  const m=modelo(), t=m.tramos[m.tramos.length-1];
  if(!t||t.segs.length<2){ alert('Necesitas al menos dos tramos para cerrar.'); return; }
  const pts=puntosTramo(t), ini=pts[0], fin=pts[pts.length-1];
  const dx=ini[0]-fin[0], dy=ini[1]-fin[1], len=Math.hypot(dx,dy);
  if(len<0.01){ alert('La polilínea ya está cerrada.'); return; }
  if(!confirm('¿Cerrar el contorno con un tramo de pared de '+fmt(len)+' m hasta el punto inicial?')) return;
  t.segs.push({kind:'pared',len,ang:Math.atan2(dy,dx),zona:'ext',cierre:true});
  ajustarVista(); dibujar(); guardar();
}
function setLibre(v){ anguloLibre=v; modelo().libre=v; $('aSnap').classList.toggle('sel',!v); $('aLibre').classList.toggle('sel',v); }

// ---------- Lista ----------
function abrirLista(){
  const cont=$('listaSegs'); cont.innerHTML='';
  const m=modelo(), tags=etiquetasHuecos(m); let n=0;
  const zonaTxt={ext:'exterior',med:'medianera',com:'z. común'};
  m.tramos.forEach((t,ti)=>{
    const pts=puntosTramo(t), horario=areaSigno(pts)>0;
    t.segs.forEach((s,si)=>{
      n++;
      const div=document.createElement('div'); div.className='filaSeg';
      const ne=normalExterior(pts[si],pts[si+1],horario), ori=cardinal(rumbo(ne[0],ne[1],m.norte||0));
      const desc = s.kind==='pared' ? 'Pared · '+fmt(s.len)+' m'
        : tags.get(ti+'-'+si)+' '+(s.kind==='ventana'?'Ventana':'Puerta')+' · '+fmt(s.len)+'×'+fmt(s.alto)+' m';
      const sub = s.kind==='pared'
        ? '<small>'+zonaTxt[s.zona||'ext']+' · '+ori+'</small>'
        : '<small>'+(s.mat||matDef())+' · '+(s.vid||vidDef())+' · '+fmt(s.len*s.alto)+' m² · '+ori+'</small>';
      div.innerHTML='<span class="num">'+n+'</span><span class="txt">'+desc+sub+'</span>';
      const bE=document.createElement('button'); bE.textContent='✏️'; bE.onclick=()=>{ $('veloLista').classList.remove('abierto'); editarSeg(ti,si); };
      const bX=document.createElement('button'); bX.textContent='🗑️';
      bX.onclick=()=>{ m.tramos[ti].segs.splice(si,1); m.tramos=m.tramos.filter((tt,idx)=>tt.segs.length||idx===m.tramos.length-1); ajustarVista(); dibujar(); guardar(); abrirLista(); };
      div.appendChild(bE); div.appendChild(bX); cont.appendChild(div);
    });
  });
  if(!n) cont.innerHTML='<p class="muted">Aún no hay tramos.</p>';
  const an=analizar(exp);
  $('resumenCroquis').innerHTML = n ? ('Superficie del polígono: <b>'+fmt(an.superficiePoligono_m2)+' m²</b>'+(an.poligonoCerrado?'':' (contorno sin cerrar)')+
    '<br>Fachadas: '+Object.keys(an.fachadasPorOrientacion).map(k=>k+' '+fmt(an.fachadasPorOrientacion[k].muroNeto_m2)+' m²').join(' · ')+
    '<br>Altura libre de cálculo: '+fmt(ALTURA_LIBRE)+' m') : '';
  $('veloLista').classList.add('abierto');
}
function editarSeg(ti,si){
  const s=modelo().tramos[ti].segs[si];
  editando={t:ti,s:si}; setTipo(s.kind); setZona(s.zona||'ext');
  $('segTitulo').textContent='Editar tramo';
  $('inLong').value=s.len; $('inAlto').value=s.alto||''; $('inMat').value=s.mat||matDef(); $('inVid').value=s.vid||vidDef();
  $('laserHint').classList.toggle('visible', !!btCar);
  $('veloSeg').classList.add('abierto');
}

// ---------- Bluetooth Leica DISTO ----------
const DISTO_SVC ='3ab10100-f831-4395-b29d-570977d5bf94';
const DISTO_DIST='3ab10101-f831-4395-b29d-570977d5bf94';
let btDev=null, btCar=null;
async function conectarLaser(){
  if(!navigator.bluetooth){ alert('Este navegador no soporta Web Bluetooth.\nUsa Google Chrome en Android.'); return; }
  if(btCar){ btDev.gatt.disconnect(); return; }
  try{
    btDev=await navigator.bluetooth.requestDevice({ filters:[{namePrefix:'DISTO'},{namePrefix:'Leica'}], optionalServices:[DISTO_SVC] });
    btDev.addEventListener('gattserverdisconnected',()=>{ btCar=null; estadoBT(false); });
    const server=await btDev.gatt.connect();
    const svc=await server.getPrimaryService(DISTO_SVC);
    btCar=await svc.getCharacteristic(DISTO_DIST);
    await btCar.startNotifications();
    btCar.addEventListener('characteristicvaluechanged',e=>{ const m=e.target.value.getFloat32(0,true); if(m>0&&m<300) recibirLaser(m); });
    estadoBT(true);
  }catch(err){
    if(err.name!=='NotFoundError') alert('No se pudo conectar: '+err.message+'\n\nComprueba que el DISTO está encendido, el Bluetooth activado (icono BT en su pantalla) y que la app DISTO Plan de Leica está CERRADA.');
    btCar=null; estadoBT(false);
  }
}
function estadoBT(on){ $('btBtn').classList.toggle('on',on); $('btTxt').textContent=on?'D2 ✓':'Láser'; }
function recibirLaser(m){
  if(navigator.vibrate) navigator.vibrate(40);
  if($('veloSeg').classList.contains('abierto')){
    const act=document.activeElement, inLong=$('inLong'), inAlto=$('inAlto');
    const destino=(act===inAlto)?inAlto:inLong;
    destino.value=m.toFixed(2); destino.classList.add('laserOK'); setTimeout(()=>destino.classList.remove('laserOK'),600);
    if(destino===inLong && tipoSel!=='pared') inAlto.focus(); else destino.blur();
  } else {
    const t=$('laserToast'); t.innerHTML='📡 <span class="pt">'+fmt(m)+' m</span>'; t.style.display='block';
    clearTimeout(t._to); t._to=setTimeout(()=>t.style.display='none',2500);
  }
}

// ---------- Norte (rueda manual + brújula corregida) ----------
let norteTmp=0, arrastrandoN=false, sensor={activo:false, ev:null, sx:0, sy:0, n:0};
function abrirNorte(){
  if(!hayDibujo()){ alert('Dibuja primero el croquis.'); return; }
  norteTmp=modelo().norte||0; $('nSensorTxt').textContent=''; pintarNorte(); $('veloNorte').classList.add('abierto');
}
function cerrarNorte(){ pararSensor(); $('veloNorte').classList.remove('abierto'); }
function pintarNorte(){
  const c=$('cvNorte').getContext('2d'); c.clearRect(0,0,260,260);
  dibujarNorteEn(c,130,130,80,norteTmp);
  $('nNorteTxt').textContent=(Math.round(((norteTmp%360)+360)%360)%360)+'°';
}
function anguloDesdeEvento(e){
  const r=$('cvNorte').getBoundingClientRect();
  const x=e.clientX-r.left-130, y=e.clientY-r.top-130;
  return Math.atan2(x,-y)*180/Math.PI;
}
function guardarNorte(){ modelo().norte=((norteTmp%360)+360)%360; cerrarNorte(); dibujar(); guardar(); }

// Rumbo de la parte de arriba de la pantalla (0=N, horario), o null si el sensor no da rumbo absoluto
function rumboPantalla(ev){
  let h=null;
  if(typeof ev.webkitCompassHeading==='number' && !isNaN(ev.webkitCompassHeading)) h=ev.webkitCompassHeading;      // iOS: ya es rumbo
  else if(ev.absolute===true && typeof ev.alpha==='number') h=(360-ev.alpha)%360;                                   // Android absoluto
  if(h==null) return null;
  const giro=(screen.orientation && typeof screen.orientation.angle==='number') ? screen.orientation.angle : (window.orientation||0);
  return ((h+giro)%360+360)%360;
}
function onOrientacion(ev){
  const H=rumboPantalla(ev);
  if(H==null){ if(ev.type==='deviceorientation' && !('ondeviceorientationabsolute' in window) && ev.webkitCompassHeading==null) $('nSensorTxt').textContent='· este móvil no da rumbo absoluto, orienta a mano'; return; }
  const n=(360-H)%360, r=n*Math.PI/180;            // el norte, en pantalla, está a −rumbo
  sensor.sx=sensor.sx*0.85+Math.sin(r)*0.15; sensor.sy=sensor.sy*0.85+Math.cos(r)*0.15; sensor.n++;   // media circular suavizada
  if(sensor.n<3){ sensor.sx=Math.sin(r); sensor.sy=Math.cos(r); }
  norteTmp=Math.atan2(sensor.sx,sensor.sy)*180/Math.PI; if(norteTmp<0) norteTmp+=360;
  $('nSensorTxt').textContent='· brújula activa'; pintarNorte();
}
function usarSensor(){
  if(sensor.activo){ pararSensor(); $('nSensorTxt').textContent='· brújula parada'; return; }
  if(!window.DeviceOrientationEvent){ alert('Este móvil no expone la brújula. Orienta a mano.'); return; }
  const arranca=()=>{
    sensor={activo:true, ev:('ondeviceorientationabsolute' in window)?'deviceorientationabsolute':'deviceorientation', sx:0, sy:0, n:0};
    window.addEventListener(sensor.ev,onOrientacion);
    $('bSensor').textContent='⏹ Parar brújula';
    $('nSensorTxt').textContent='· esperando la brújula…';
  };
  if(typeof DeviceOrientationEvent.requestPermission==='function'){
    DeviceOrientationEvent.requestPermission().then(p=>{ if(p==='granted') arranca(); else alert('Permiso denegado.'); }).catch(()=>alert('No se pudo activar la brújula.'));
  } else arranca();
}
function pararSensor(){
  if(sensor.activo && sensor.ev) window.removeEventListener(sensor.ev,onOrientacion);
  sensor.activo=false; $('bSensor').textContent='🧭 Usar brújula del móvil';
}

// ---------- Exportar ----------
function nombreFichero(e){ const p=window.CEE_prefijoExp?window.CEE_prefijoExp(e.numExp):(e.numExp||''); return (p?p+'_':'')+((e.datos.direccion||'CEE').replace(/[^a-zA-Z0-9_-]/g,'_')); }
function construirPDF(e){
  const {jsPDF}=window.jspdf; const doc=new jsPDF({unit:'mm',format:'a4'});
  const m=e.croquis||vacio(); const tags=etiquetasHuecos(m); const an=analizar(e);
  doc.setFillColor(74,138,128); doc.rect(0,0,210,22,'F');
  doc.setTextColor(255); doc.setFont('helvetica','bold'); doc.setFontSize(13);
  doc.text('CROQUIS DE TOMA DE DATOS · CERTIFICADO DE EFICIENCIA ENERGÉTICA',105,9,{align:'center'});
  doc.setFontSize(11); doc.text((e.numExp?'Exp. '+e.numExp+' · ':'')+tituloDe(e),105,16,{align:'center'});
  doc.setFontSize(8); doc.setFont('helvetica','normal'); doc.text('Visita: '+(e.datos.fechaVisita||'—')+' · Generado: '+new Date().toLocaleDateString('es-ES'),105,20.5,{align:'center'});
  const box={x:15,y:30,w:180,h:135}, b=bboxDe(m);
  if(b){
    const esc=Math.min(box.w/Math.max(b.x1-b.x0,0.5),box.h/Math.max(b.y1-b.y0,0.5))*0.82;
    const ox=box.x+box.w/2-(b.x0+b.x1)/2*esc, oy=box.y+box.h/2-(b.y0+b.y1)/2*esc;
    const W=p=>[p[0]*esc+ox,p[1]*esc+oy];
    m.tramos.forEach((t,ti)=>{
      const pts=puntosTramo(t);
      t.segs.forEach((s,si)=>{
        const a=W(pts[si]), bb=W(pts[si+1]), esHueco=s.kind!=='pared', zona=s.zona||'ext';
        if(esHueco){doc.setDrawColor(217,48,37);doc.setLineWidth(1.2);doc.setLineDashPattern([],0);}
        else if(zona==='med'){doc.setDrawColor(34,48,45);doc.setLineWidth(1.6);doc.setLineDashPattern([],0);}
        else if(zona==='com'){doc.setDrawColor(34,48,45);doc.setLineWidth(0.55);doc.setLineDashPattern([1.5,1.2],0);}
        else{doc.setDrawColor(34,48,45);doc.setLineWidth(0.55);doc.setLineDashPattern([],0);}
        doc.line(a[0],a[1],bb[0],bb[1]); doc.setLineDashPattern([],0);
        const mx=(a[0]+bb[0])/2,my=(a[1]+bb[1])/2; let ang=Math.atan2(bb[1]-a[1],bb[0]-a[0]), flip=1;
        if(ang>Math.PI/2||ang<-Math.PI/2){ang+=Math.PI;flip=-1;}
        const px=Math.sin(ang), py=-Math.cos(ang);
        doc.setTextColor(0,0,0); doc.setFontSize(8); doc.setFont('helvetica','normal');
        const d1=2.4*flip; doc.text(fmt(s.len), mx+px*d1, my+py*d1, {angle:-ang*180/Math.PI,align:'center',baseline:flip>0?'bottom':'top'});
        const d2=-2.4*flip;
        if(esHueco){ doc.setFont('helvetica','bold'); doc.text(txtHueco(e,s,tags.get(ti+'-'+si)), mx+px*d2, my+py*d2, {angle:-ang*180/Math.PI,align:'center',baseline:flip>0?'top':'bottom'}); }
        else if(zona!=='ext'){ doc.setFont('helvetica','bold'); doc.setTextColor(92,115,112); doc.text(zona==='med'?'Medianera':'Zona común', mx+px*d2, my+py*d2, {angle:-ang*180/Math.PI,align:'center',baseline:flip>0?'top':'bottom'}); doc.setTextColor(0,0,0); }
        doc.setFillColor(34,48,45); doc.circle(a[0],a[1],0.45,'F'); doc.circle(bb[0],bb[1],0.45,'F');
      });
    });
    pdfNorte(doc,182,40,8,m.norte||0);
  }
  let y=172;
  doc.setFillColor(74,138,128); doc.rect(15,y,180,7,'F');
  doc.setTextColor(255); doc.setFontSize(8.5); doc.setFont('helvetica','bold');
  const cols=[17,27,46,62,77,93,120,175];
  ['Nº','Tipo','Ancho (m)','Alto (m)','Sup. (m²)','Carpintería','Vidrio','Orient.'].forEach((h,i)=>doc.text(h,cols[i],y+5));
  y+=7; doc.setFont('helvetica','normal'); doc.setTextColor(34,48,45);
  let sumV=0,sumP=0, fila=0;
  an.huecos.forEach(h=>{
    if(y>270){doc.addPage();y=20;}
    if(h.tipo==='Ventana') sumV+=h.superficie_m2; else sumP+=h.superficie_m2;
    if(fila++%2===1){doc.setFillColor(243,247,246);doc.rect(15,y,180,7,'F');}
    [h.etiqueta,h.tipo,fmt(h.ancho_m),fmt(h.alto_m),fmt(h.superficie_m2),h.material,h.vidrio,h.orientacion].forEach((v,i)=>doc.text(String(v),cols[i],y+5));
    y+=7;
  });
  y+=4; if(y>262){doc.addPage();y=20;}
  doc.setFont('helvetica','bold'); doc.setFontSize(9);
  doc.text('Σ Ventanas: '+fmt(sumV)+' m²    Σ Puertas: '+fmt(sumP)+' m²    Superficie del polígono: '+fmt(an.superficiePoligono_m2)+' m²'+(an.poligonoCerrado?'':' (sin cerrar)'),17,y+4);
  doc.text('Longitud total de envolvente medida: '+fmt(an.longitudTotal_m)+' m',17,y+10);
  doc.setFont('helvetica','normal');
  doc.text('Medianera: '+fmt(an.medianera_m)+' m · Zona común: '+fmt(an.zonaComun_m)+' m · Altura libre de cálculo: '+fmt(ALTURA_LIBRE)+' m',17,y+16);
  doc.text('Fachada neta por orientación: '+Object.keys(an.fachadasPorOrientacion).map(k=>k+' '+fmt(an.fachadasPorOrientacion[k].muroNeto_m2)+' m²').join(' · '),17,y+22);
  doc.setDrawColor(122,173,163); doc.setLineWidth(0.4); doc.line(15,286,195,286);
  doc.setFontSize(8); doc.setTextColor(90,110,107);
  doc.text('Joanfe Ribes Oficina Tècnica · Arquitecto Técnico col. 3.184 COAATIEA · 605 875 899 · oficinatecnica@joanferibes.com',105,291,{align:'center'});
  return doc;
}
function pdfNorte(doc,cx,cy,r,norteDeg){
  const a=(norteDeg-90)*Math.PI/180;
  doc.setDrawColor(74,138,128); doc.setLineWidth(0.3); doc.circle(cx,cy,r,'S');
  const ex=cx+r*Math.cos(a), ey=cy+r*Math.sin(a), bx=cx-r*0.6*Math.cos(a), by=cy-r*0.6*Math.sin(a);
  doc.setDrawColor(34,48,45); doc.setLineWidth(0.6); doc.line(bx,by,ex,ey);
  const pa=0.45; doc.setFillColor(217,48,37);
  doc.triangle(ex,ey, ex-3*Math.cos(a-pa),ey-3*Math.sin(a-pa), ex-3*Math.cos(a+pa),ey-3*Math.sin(a+pa),'F');
  doc.setTextColor(34,48,45); doc.setFont('helvetica','bold'); doc.setFontSize(8);
  doc.text('N', cx+(r+3)*Math.cos(a), cy+(r+3)*Math.sin(a), {align:'center',baseline:'middle'});
}
function construirDXF(e){
  const m=e.croquis||vacio(), tags=etiquetasHuecos(m); let s='';
  const linea=(cap,a,b)=>{ s+='0\nLINE\n8\n'+cap+'\n10\n'+a[0].toFixed(3)+'\n20\n'+(-a[1]).toFixed(3)+'\n30\n0\n11\n'+b[0].toFixed(3)+'\n21\n'+(-b[1]).toFixed(3)+'\n31\n0\n'; };
  const texto=(cap,p,h,t,ang)=>{ s+='0\nTEXT\n8\n'+cap+'\n10\n'+p[0].toFixed(3)+'\n20\n'+(-p[1]).toFixed(3)+'\n30\n0\n40\n'+h+'\n1\n'+t+'\n50\n'+(ang||0).toFixed(2)+'\n72\n1\n11\n'+p[0].toFixed(3)+'\n21\n'+(-p[1]).toFixed(3)+'\n31\n0\n'; };
  m.tramos.forEach((t,ti)=>{
    const pts=puntosTramo(t);
    t.segs.forEach((sg,si)=>{
      const a=pts[si], b=pts[si+1];
      const cap = sg.kind==='pared' ? ((sg.zona||'ext')==='med'?'MEDIANERA':(sg.zona==='com'?'ZONA_COMUN':'MUROS')) : 'HUECOS';
      linea(cap,a,b);
      const mm=[(a[0]+b[0])/2,(a[1]+b[1])/2];
      let ang=Math.atan2(-(b[1]-a[1]),b[0]-a[0])*180/Math.PI; if(ang>90||ang<=-90) ang+=180;
      const ar=ang*Math.PI/180, off=0.18, p=[mm[0]-off*Math.sin(ar), mm[1]-off*Math.cos(ar)];
      const txt = sg.kind==='pared' ? sg.len.toFixed(2) : tags.get(ti+'-'+si)+': '+sg.len.toFixed(2)+'x'+sg.alto.toFixed(2)+' '+(sg.mat||matDef(e))+' / '+(sg.vid||vidDef(e));
      texto('COTAS',p,0.15,txt,ang);
    });
  });
  return '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n'+s+'0\nENDSEC\n0\nEOF\n';
}
function descargar(nombre, blob){ const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=nombre; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),4000); }

// ---------- Abrir / cerrar ----------
function iniciar(){
  if(iniciado) return; iniciado=true;
  cv=$('cv'); ctx=cv.getContext('2d');
  opts($('inMat'),MATERIALES); opts($('inVid'),VIDRIOS); opts($('inMatDef'),MATERIALES); opts($('inVidDef'),VIDRIOS);
  engancharLienzo();
  window.addEventListener('resize',()=>{ if(exp) redim(); });
  $('tPared').onclick=()=>setTipo('pared'); $('tVentana').onclick=()=>setTipo('ventana'); $('tPuerta').onclick=()=>setTipo('puerta');
  $('zExt').onclick=()=>setZona('ext'); $('zMed').onclick=()=>setZona('med'); $('zCom').onclick=()=>setZona('com');
  $('bSegCancel').onclick=cerrarSeg; $('bAddSeg').onclick=guardarSeg;
  $('veloSeg').onclick=e=>{ if(e.target.id==='veloSeg') cerrarSeg(); };
  $('bUndo').onclick=deshacer; $('bCerrar').onclick=cerrarPoli; $('bNuevoT').onclick=nuevoTramo;
  $('bNorte').onclick=abrirNorte; $('bLista').onclick=abrirLista;
  $('bListaCerrar').onclick=()=>$('veloLista').classList.remove('abierto');
  $('veloLista').onclick=e=>{ if(e.target.id==='veloLista') $('veloLista').classList.remove('abierto'); };
  $('btBtn').onclick=conectarLaser;
  // Norte
  const cvN=$('cvNorte');
  cvN.addEventListener('pointerdown',e=>{ pararSensor(); arrastrandoN=true; norteTmp=anguloDesdeEvento(e); pintarNorte(); });
  cvN.addEventListener('pointermove',e=>{ if(arrastrandoN){ norteTmp=anguloDesdeEvento(e); pintarNorte(); } });
  cvN.addEventListener('pointerup',()=>{ arrastrandoN=false; });
  $('bSensor').onclick=usarSensor; $('bNorteCancel').onclick=cerrarNorte; $('bNorteOk').onclick=guardarNorte;
  $('veloNorte').onclick=e=>{ if(e.target.id==='veloNorte') cerrarNorte(); };
  // Ajustes
  $('bAjustes').onclick=()=>{ $('inMatDef').value=matDef(); $('inVidDef').value=vidDef(); setLibre(anguloLibre); $('veloAjustes').classList.add('abierto'); };
  const cerrarAjustes=()=>{ exp.checklist.carpinteria=$('inMatDef').value; exp.checklist.acristalamiento=$('inVidDef').value; $('veloAjustes').classList.remove('abierto'); dibujar(); guardar(); };
  $('bAjustesOk').onclick=cerrarAjustes;
  $('veloAjustes').onclick=e=>{ if(e.target.id==='veloAjustes') cerrarAjustes(); };
  $('aSnap').onclick=()=>setLibre(false); $('aLibre').onclick=()=>setLibre(true);
  $('bExpPDF').onclick=()=>{ if(!hayDibujo()) return alert('No hay nada que exportar.'); construirPDF(exp).save('Croquis_'+nombreFichero(exp)+'.pdf'); };
  $('bExpDXF').onclick=()=>{ if(!hayDibujo()) return alert('No hay nada que exportar.'); descargar('Croquis_'+nombreFichero(exp)+'.dxf', new Blob([construirDXF(exp)],{type:'application/dxf'})); };
  $('bExpJSON').onclick=()=>{ if(!hayDibujo()) return alert('No hay nada que exportar.'); descargar('Croquis_'+nombreFichero(exp)+'.json', new Blob([JSON.stringify(analizar(exp),null,2)],{type:'application/json'})); };
  $('bBorrarCroquis').onclick=()=>{ if(!confirm('¿Borrar todo el croquis de este expediente?')) return; exp.croquis=vacio(); pendienteNuevoTramo=false; $('veloAjustes').classList.remove('abierto'); ajustarVista(); dibujar(); guardar(); };
}

function abrir(e, cb){
  iniciar(); exp=e; onChange=cb; modelo();
  anguloLibre=!!exp.croquis.libre; pendienteNuevoTramo=false; editando=null;
  $('croq-title').textContent=(exp.numExp?exp.numExp+' · ':'')+tituloDe(exp);
  $('hint').textContent='Dibuja con el dedo la dirección del primer tramo';
  requestAnimationFrame(()=>redim());
}
function cerrar(){ pararSensor(); ['veloSeg','veloNorte','veloLista','veloAjustes'].forEach(id=>$(id).classList.remove('abierto')); exp=null; onChange=null; }

window.Croquis = {
  MATERIALES, VIDRIOS, ALTURA_LIBRE,
  abrir, cerrar, hayDibujo,
  analizar,
  pdfDataUrl: e => construirPDF(e).output('datauristring'),
  dxfTexto: e => construirDXF(e),
  nombreFichero
};
})();
