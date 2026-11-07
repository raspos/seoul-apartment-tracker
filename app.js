'use strict';
const $=id=>document.getElementById(id);
const labels={alltime:'역대 신고가',loaded:'신고가',pending:'비교자료 적재 중',tie:'이전 기록과 같음',baseline:'첫 거래 · 비교 없음',normal:'일반 거래',cancelled:'해제 · 판정 제외'};
let data=null,filtered=[],page=0,loading=false,selectedDistricts=[],series=[],queryPeriod=null,selectedDay=null;
const Core=TrackerCore;
const API=TrackerAPI;
let tradeTotal=0,recordTotal=0,topRows=[],overviewRequest=0,tradeRequest=0,recordRequest=0;
let chartMode='daily',recordRows=[],recordPage=0,recordDate=null;
const fmt=n=>n==null?'—':Number(n).toLocaleString('ko-KR');
const won=n=>n==null?'—':(Number(n)/10000).toLocaleString('ko-KR',{maximumFractionDigits:4});
const inEok=n=>n==null?null:Number(n)/10000;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key=r=>JSON.stringify([r.district,r.dong,r.jibun,r.name,r.areaGroup??Math.floor(Number(r.area))]);
function message(s,error=false){$('notice').textContent=s;$('notice').hidden=!s;$('notice').classList.toggle('error',error);}
async function load(){
 if(loading)return;loading=true;
 try{const previousRevision=data?.revision;const loadedPeriod=queryPeriod||Core.monthRange(today);data={...await API.get('/api/summary',loadedPeriod),overviewPeriod:loadedPeriod};
 if($('district').options.length===1){for(const [code,name]of Object.entries(data.districts)){for(const id of ['district','loadDistrict','neighborhoodDistrict','regionalDistrict']){$(id).add(new Option(name,code));}}}
 $('setup').hidden=data.configured;
 const cs=data.coverage,ms=cs.map(x=>x.month).sort();
 $('basis').textContent=data.asOf?`업데이트 ${data.asOf.slice(0,10)} · ${new Set(cs.map(x=>x.district)).size}/25개 구`:'아직 연결된 자료가 없습니다';
 const tasks=data.tasks,done=tasks.filter(t=>t.state==='done').length,failed=tasks.filter(t=>t.state==='failed');
 $('progress').max=tasks.length||1;$('progress').value=done;
 $('jobStatus').textContent=`${data.running?'적재 중':'대기'} · 2021년부터 ${fmt(data.history?.done||0)}/${fmt(data.history?.total||0)} 구·월 · 실패 ${failed.length}`;
 if(data.running){const percent=Math.floor((data.history?.done||0)/(data.history?.total||1)*100);message(`과거 자료 불러오는 중 · ${percent}%`);}
 $('failures').replaceChildren(...failed.map(t=>{const li=document.createElement('li');li.textContent=`${data.districts[t.district]} ${t.month}: ${t.error}`;return li;}));
 $('start').disabled=data.running||!data.configured;$('resume').disabled=data.running||!data.configured;$('stop').disabled=!data.running;
 $('coverageCount').textContent=`${cs.length}개 구·월 수집 완료`;
 $('coverage').innerHTML=Object.entries(data.districts).map(([d,n])=>{const c=cs.filter(x=>x.district===d);return `<div class="coverage-item"><b>${esc(n)}</b><small>${c.length?c.length+'개월 · '+fmt(c.reduce((a,x)=>a+x.count,0))+'건':'미적재 · 비교 불가'}</small>${c.length?`<details><summary>완료 월과 갱신 시각</summary>${c.map(x=>`<div>${x.month} · ${fmt(x.count)}건<br><small>${esc(x.fetched)}</small></div>`).join('')}</details>`:''}</div>`;}).join('');
 if(failed.length)message('자료 적재 실패 · 데이터 관리에서 확인하세요.',true);
 else if(!data.running)message(data.configured?'':'API 키 미설정 · .env에서 연결해 주세요.');
 await updateOverview(queryPeriod===null,data);
 await filter();
 performance.mark('tracker-core-ready');if(!document.documentElement.dataset.coreReadyMs)document.documentElement.dataset.coreReadyMs=String(Math.round(performance.now()));
 if(previousRevision!==data.revision)window.DistanceView?.refresh();
 }catch{message('서버에서 자료를 불러오지 못했습니다. 서버 실행 상태를 확인하고 다시 시도하세요.',true);}finally{loading=false;}
}
function tradeQuery(){return {start:$('from').value&&$('from').value>queryPeriod.start?$('from').value:queryPeriod.start,end:$('to').value&&$('to').value<queryPeriod.end?$('to').value:queryPeriod.end,district:$('district').value,name:$('name').value.trim(),areaMin:$('areaMin').value,areaMax:$('areaMax').value,priceMin:$('priceMin').value,priceMax:$('priceMax').value,kind:$('kind').value,cancelled:$('cancelled').checked?'1':'0'};}
async function filter(){if(!data||!queryPeriod)return;page=0;return refreshTrades();}
async function refreshTrades(){const token=++tradeRequest;try{const result=await API.get('/api/trades',{...tradeQuery(),page:page+1,perPage:50});if(token!==tradeRequest)return;filtered=result.items;tradeTotal=result.total;render();}catch(e){message(e.message,true);}}
async function updateOverview(newQuery=false,initial=null){
 if(newQuery){
  $('policyInfo').hidden=true;
  const month=chartMode==='monthly'?$('queryYear').value+'-01':$('queryMonth').value;
  if(!month||month<'2021-01'||month>today){message('조회 월을 확인해 주세요.',true);return false;}
  queryPeriod=chartMode==='all'?{start:'2021-01-01',end:currentDate}:chartMode==='monthly'?{start:month.slice(0,4)+'-01-01',end:month.slice(0,4)+'-12-31'}:Core.monthRange(month);selectedDay=null;recordDate=null;recordPage=0;
  $('nextMonth').disabled=chartMode==='monthly'?month.slice(0,4)>=today.slice(0,4):month>=today;$('prevMonth').disabled=chartMode==='monthly'?month.slice(0,4)<='2021':month<='2021-01';
 }
 if(!queryPeriod)return false;
 const token=++overviewRequest;
 try{
 const response=initial&&initial.overviewPeriod.start===queryPeriod.start&&initial.overviewPeriod.end===queryPeriod.end?initial:await API.get('/api/summary',{...queryPeriod,compact:'1'});if(token!==overviewRequest)return false;
 data={...data,...response};const overview=data.overview;
 if(newQuery||!selectedDistricts.length)selectedDistricts=Core.chooseDistricts(overview.recordDistricts.map(d=>({district:d,cancelled:false})));
 $('loaded').textContent=fmt(overview.recordCount);$('count').textContent=fmt(overview.count);$('latest').textContent=overview.latest||'—';
 const counts=overview.regionCounts,max=Math.max(1,...Object.values(counts));
 $('distribution').innerHTML=Object.entries(data.districts).map(([d,n])=>`<div class="district-row"><span>${n}</span><span class="bar"><i data-width="${counts[d]/max*100}"></i></span><span>${fmt(counts[d])}</span></div>`).join('');
 for(const bar of document.querySelectorAll('[data-width]'))bar.style.width=bar.dataset.width+'%';
 if(chartMode==='daily')series=overview.daily;else{const groups=new Map();for(const d of overview.daily){const m=d.day.slice(0,7);if(!groups.has(m))groups.set(m,{...d,day:m+'-01',count:0,loaded:0});const item=groups.get(m);item.count+=d.count;item.loaded+=d.loaded;}series=[...groups.values()];}
 renderDaily();await Promise.all([renderRecords(),renderTop()]);return true;
 }catch(e){message(e.message,true);return false;}
}

function dayDescription(d){const label=chartMode!=='daily'?d.day.slice(0,4)+'년 '+Number(d.day.slice(5,7))+'월':d.day.slice(5).replace('-','월 ')+'일';return `${label} · ${d.day>currentDate?'예정':fmt(d.count)+'건'}${d.covered<25?' · 비교 완료 '+d.covered+'/25개 구':''}`;}
function selectDay(day){const d=series.find(x=>x.day===day);if(!d)return;selectedDay=day;$('dailyReadout').textContent=dayDescription(d);for(const b of $('dailyChart').querySelectorAll('[data-day]'))b.setAttribute('aria-pressed',String(b.dataset.day===day));}
function showRecordDate(day){recordDate=day;recordPage=0;renderRecords();}
function showPolicy(index){const p=Core.policies[index];if(!p)return;$('policyInfo').hidden=false;$('policyInfo').innerHTML=`<span>${p.date} 발표</span><b>${esc(p.name)}</b><a href="${esc(p.url)}" target="_blank" rel="noreferrer">공식 발표 ↗</a>`;}
function renderDaily(){
 const max=Math.max(4,Math.ceil(Math.max(...series.map(d=>d.count),0)/4)*4);
 const w=Math.max(280,$('dailyChart').clientWidth||800),h=290,left=36,right=12,top=64,bottom=36,step=(w-left-right)/series.length;
 const x=i=>left+(i+.5)*step,y=v=>h-bottom-v/max*(h-top-bottom),barWidth=Math.max(3,Math.min(36,step*.58));
 const past=series.filter(d=>d.day<=currentDate),n=past.length?Math.min(...past.map(d=>d.covered)):0;
 $('chartSubtitle').textContent=chartMode==='all'?'2021년부터 현재까지 · 월별 건수 · 이번 달 진행 중':chartMode==='monthly'?'2021년부터 비교 · 월별 건수':'2021년부터 비교 · 일별 건수';
 $('dailyCoverage').textContent=n===25?'2021년부터 비교':n?`비교 완료 ${n}/25개 구`:'비교자료 적재 중';
 $('monthRecords').innerHTML=(past.some(d=>d.covered)?fmt(series.reduce((sum,d)=>sum+d.count,0)):'—')+'<span>건</span>';
 const covered=data.coverage.map(c=>c.month).sort();
 $('coverageDescription').textContent=`조회 ${queryPeriod.start} ~ ${queryPeriod.end} · 비교 이력 ${covered.length?covered[0]+' ~ '+covered.at(-1):'없음'}`;
 const grid=Array.from({length:5},(_,i)=>{const v=max/4*i;return `<line x1="${left}" x2="${w-right}" y1="${y(v)}" y2="${y(v)}" class="grid-line"/><text x="${left-10}" y="${y(v)+4}" text-anchor="end" class="axis-label">${v}</text>`;}).join('');
 const dates=series.map((d,i)=>{const show=chartMode==='all'?d.day.slice(5,7)==='01':chartMode==='monthly'||i===0||i===series.length-1||[7,14,21].includes(i);const label=chartMode==='all'?d.day.slice(0,4):chartMode==='monthly'?i+1+'월':i+1+'일';return show?`<text x="${x(i)}" y="${h-10}" text-anchor="middle" class="axis-label">${label}</text>`:'';}).join('');
 const bars=series.map((d,i)=>`<g data-day="${d.day}" tabindex="0" role="button" aria-label="${esc(dayDescription(d))}" aria-pressed="${d.day===selectedDay}"><title>${esc(dayDescription(d))}</title><rect x="${left+i*step}" y="${top}" width="${step}" height="${h-top-bottom}" class="chart-hit"/>${d.covered&&d.day<=currentDate?`<rect x="${x(i)-barWidth/2}" y="${y(d.count)}" width="${barWidth}" height="${Math.max(2,y(0)-y(d.count))}" rx="3" class="record-bar ${d.complete?'':'partial-bar'}"/>`:''}</g>`).join('');
 const events=Core.policies.map((p,i)=>({...p,index:i})).filter(p=>p.date>=queryPeriod.start&&p.date<=queryPeriod.end);
 const flags=events.map((p,j)=>{const i=series.findIndex(d=>chartMode!=='daily'?d.day.slice(0,7)===p.date.slice(0,7):d.day===p.date);if(i<0)return '';const xp=x(i),fy=18+(j%2)*23;if(chartMode==='all')return `<g data-policy="${p.index}" role="button" tabindex="0" aria-label="${p.date} ${esc(p.name)}"><title>${p.date} ${esc(p.name)}</title><line x1="${xp}" x2="${xp}" y1="${fy+6}" y2="${h-bottom}" class="policy-line"/><path d="M${xp},${fy-7} l7,7 -7,7 -7,-7Z" class="policy-flag"/></g>`;return `<g data-policy="${p.index}" role="button" tabindex="0" aria-label="${p.date} ${esc(p.name)}"><title>${p.date} ${esc(p.name)} · 클릭해서 공식 발표 보기</title><line x1="${xp}" x2="${xp}" y1="${fy+6}" y2="${h-bottom}" class="policy-line"/><rect x="${Math.max(left,Math.min(w-64,xp-24))}" y="${fy-12}" width="50" height="22" rx="5" class="policy-flag"/><text x="${Math.max(left,Math.min(w-64,xp-24))+25}" y="${fy+3}" text-anchor="middle" class="policy-flag-label">${p.short.replace(' 대책','')}</text></g>`;}).join('');
 $('dailyChart').innerHTML=`<svg viewBox="0 0 ${w} ${h}" aria-label="신고가 ${chartMode!=='daily'?'월별':'일별'} 막대그래프">${grid}${dates}${bars}${flags}</svg>${!past.some(d=>d.covered)?'<div class="chart-empty"><span class="chart-loader" aria-hidden="true"></span><b>과거 거래를 비교하고 있어요</b><span>자료 수집이 끝나면 표시됩니다</span></div>':''}`;
 $('policyEvents').innerHTML=events.length?'<span class="policy-legend">● 주요 대책 발표일</span>'+events.map(p=>`<button type="button" data-policy="${p.index}">${esc(p.short)}</button>`).join(''):'';
 $('dailyRows').innerHTML=series.map(d=>`<tr><td>${chartMode!=='daily'?d.day.slice(0,7):d.day}</td><td>${d.day>currentDate?'—':fmt(d.count)}</td><td>${d.covered} / 25</td><td>${d.day>currentDate?'예정':d.complete?'비교 완료':'비교자료 적재 중'}</td></tr>`).join('');
 if(selectedDay)selectDay(selectedDay);else $('dailyReadout').textContent=past.some(d=>d.covered)?'막대를 누르면 해당 기간의 신고가를 볼 수 있습니다':'2021년부터 비교자료를 확인하고 있습니다';
}
function recordGap(r){
 if(!r.previousDay)return '';
 const a=new Date(r.previousDay+'T00:00:00Z'),b=new Date(r.day+'T00:00:00Z');
 let months=(b.getUTCFullYear()-a.getUTCFullYear())*12+b.getUTCMonth()-a.getUTCMonth();
 if(b.getUTCDate()<a.getUTCDate())months--;
 const years=Math.floor(months/12),rest=months%12;
 const span=months>0?(years?years+'년':'')+(years&&rest?' ':'')+(rest?rest+'개월':''):fmt(r.recordGapDays)+'일';
 return `<span>${span} 만에 신고가</span><small>이전 기록 ${r.previousDay}</small>`;
}
async function renderRecords(){
 const token=++recordRequest;let start=queryPeriod.start,end=queryPeriod.end;if(recordDate){if(chartMode==='daily')start=end=recordDate;else{const range=Core.monthRange(recordDate.slice(0,7));start=range.start;end=range.end;}}
 const result=await API.get('/api/trades',{start,end,kind:'record',page:recordPage+1,perPage:12});if(token!==recordRequest)return;
 recordRows=result.items;recordTotal=result.total;const rows=recordRows,visible=recordRows;
 $('recordsPeriod').textContent=(chartMode==='all'?'2021.01 ~ '+today.replace('-','.'):chartMode==='monthly'?queryPeriod.start.slice(0,4)+'년':queryPeriod.start.slice(0,7).replace('-','.'))+' · 2021년부터 비교';
 $('recordCount').textContent=fmt(recordTotal)+'건';$('clearRecordDate').hidden=!recordDate;
 $('recordDate').textContent=recordDate?(chartMode!=='daily'?recordDate.slice(0,7):recordDate):'';
 $('recordList').innerHTML=visible.length?visible.map(r=>`<article class="record-card"><div class="record-card-top"><span class="record-badge">신고가</span><time>${r.day}</time></div><button class="trade-link record-name" data-record-index="${recordRows.indexOf(r)}">${esc(r.name)}</button><p>${esc(data.districts[r.district])} ${esc(r.dong)} · ${esc(r.area)}㎡ · ${esc(r.floor||'—')}층</p><div class="record-price"><strong>${won(r.price)}<small>억원</small></strong><span>+${won(r.delta)}억 · +${r.rate}%</span></div><div class="record-before">이전 기록 ${won(r.previous)}억 <span>→</span> ${won(r.price)}억</div><div class="record-gap" title="${esc(r.previousDay||'')} → ${r.day} · ${fmt(r.recordGapDays)}일">${recordGap(r)}</div></article>`).join(''):`<div class="empty"><h3>${series.some(d=>d.covered)?'해당 기간의 신고가 거래가 없습니다':'비교자료 적재 후 신고가를 확인할 수 있습니다'}</h3></div>`;
 $('recordPages').textContent=`${recordTotal?recordPage+1:0} / ${Math.ceil(recordTotal/12)}`;
 $('recordPrev').disabled=recordPage===0;$('recordNext').disabled=(recordPage+1)*12>=recordTotal;
}
function regionCards(regions,prefix,source){return regions.map(region=>`<article class="district-card"><div class="district-card-head"><h3>${esc(data.districts[region.district])}</h3><span>신고가 TOP ${region.items.length}</span></div><ol>${region.items.map((r,i)=>`<li><span class="rank">${i+1}</span><div><button class="trade-link" data-${prefix}-index="${source.indexOf(r)}">${esc(r.name)}</button><small>${esc(r.dong)} · ${esc(r.area)}㎡ · ${esc(r.floor)}층</small><small>${r.day}</small></div><b>${won(r.price)}<small>억원</small></b></li>`).join('')}</ol></article>`).join('');}
async function renderTop(){const result=await API.get('/api/records/regions',{...queryPeriod,districts:selectedDistricts.join(',')});const regions=selectedDistricts.length?result.regions:[];topRows=regions.flatMap(r=>r.items);$('selectedCount').textContent=regions.length+' / 4개 구';$('selectionInfo').textContent='신고가가 있는 구 중 최대 4곳을 무작위 선정합니다. 각 구의 거래금액 상위 3건입니다.';$('topDistricts').innerHTML=regions.length?regionCards(regions,'top',topRows):'<div class="empty"><h3>신고가 거래가 없습니다</h3></div>';}

function cells(r,index,detail=false){return `<tr><td>${detail?`<b>${esc(r.name)}</b>`:`<button class="trade-link" data-row="${index}">${esc(r.name)}</button>`}${Core.isRecord(r)?'<span class="record-badge table-record-badge">신고가</span>':''}<small>${esc(data.districts[r.district])} ${esc(r.dong)} ${esc(r.jibun||'지번 없음 · 식별 주의')}</small></td><td>${esc(r.area)}㎡<small>비교: ${esc(r.areaGroup)}㎡ 그룹</small></td><td><b>${won(r.price)}</b><small>억원</small></td><td>${esc(r.floor)}</td><td>${r.day}</td><td>${won(r.previous)}</td><td>${r.delta==null?'—':(r.delta>0?'+':'')+won(r.delta)}<small>${r.rate==null?'—':(r.rate>0?'+':'')+r.rate+'%'}</small></td><td>${r.cancelled?'해제 '+esc(r.cancelDay):'미해제'}</td></tr>`;}
function render(){if($('filteredCount'))$('filteredCount').textContent=fmt(tradeTotal)+'건';$('trades').innerHTML=filtered.map((r,i)=>cells(r,i)).join('');$('empty').hidden=tradeTotal>0;$('pages').textContent=`${fmt(tradeTotal)}건 · ${tradeTotal?page+1:0} / ${Math.ceil(tradeTotal/50)} 페이지`;$('prev').disabled=page===0;$('next').disabled=(page+1)*50>=tradeTotal;}
function detail(index,source=filtered){const row=source[index];if(row)window.DistanceView?.detail(row.groupId,currentDate);}

async function post(path,body={}){try{const r=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});const result=await r.json();if(!r.ok)throw Error(result.error||'요청 실패');await load();}catch(e){message(e.message,true);}}
let filterTimer;$('filters').addEventListener('input',()=>{clearTimeout(filterTimer);filterTimer=setTimeout(filter,180);});$('filters').addEventListener('submit',e=>e.preventDefault());$('filters').addEventListener('reset',()=>setTimeout(filter,0));
$('periodQuery').addEventListener('submit',e=>{e.preventDefault();if(!data){message('자료를 먼저 불러와 주세요.',true);return;}updateOverview(true).then(ok=>{if(ok)filter();});});
for(const event of ['pointerover','focusin'])$('dailyChart').addEventListener(event,e=>{const b=e.target.closest('[data-day]');if(b)selectDay(b.dataset.day);});
$('dailyChart').addEventListener('click',e=>{const policy=e.target.closest('[data-policy]');if(policy){showPolicy(Number(policy.dataset.policy));return;}const b=e.target.closest('[data-day]');if(b){selectDay(b.dataset.day);showRecordDate(b.dataset.day);}});
$('policyEvents').onclick=e=>{const b=e.target.closest('[data-policy]');if(b)showPolicy(Number(b.dataset.policy));};
$('dailyChart').addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){const b=e.target.closest('[data-day]');if(b){e.preventDefault();selectDay(b.dataset.day);showRecordDate(b.dataset.day);}const p=e.target.closest('[data-policy]');if(p){e.preventDefault();showPolicy(Number(p.dataset.policy));}}});
$('topDistricts').addEventListener('click',e=>{const b=e.target.closest('[data-top-index]');if(b)detail(Number(b.dataset.topIndex),topRows);});
$('trades').addEventListener('click',e=>{const b=e.target.closest('[data-row]');if(b)detail(Number(b.dataset.row));});$('closeDetail').onclick=()=>$('detail').close();
$('recordList').onclick=e=>{const b=e.target.closest('[data-record-index]');if(b)detail(Number(b.dataset.recordIndex),recordRows);};
$('recordPrev').onclick=()=>{recordPage--;renderRecords();};$('recordNext').onclick=()=>{recordPage++;renderRecords();};$('clearRecordDate').onclick=()=>{recordDate=null;recordPage=0;renderRecords();};
$('prev').onclick=()=>{page--;refreshTrades();};$('next').onclick=()=>{page++;refreshTrades();};$('refresh').onclick=load;$('stop').onclick=()=>post('/api/stop');$('resume').onclick=()=>post('/api/resume');
$('ingest').closest('section').hidden=true;$('setup').hidden=true;$('ingest').onsubmit=e=>{e.preventDefault();post('/api/start',{districts:$('loadDistrict').value?[$('loadDistrict').value]:[],start:$('loadStart').value.replace('-',''),end:$('loadEnd').value.replace('-','')});};
$('csv').onclick=()=>API.downloadCSV(tradeQuery()).catch(e=>message(e.message,true));
const today="2026-11";$('loadStart').value='2021-01';$('loadEnd').value=today;$('loadEnd').max=today;$('loadStart').max=today;
const currentDate="2026-11-07";
$('queryMonth').value=today;$('queryMonth').max=today;
$('queryMonth').addEventListener('change',()=>{if(data)updateOverview(true).then(ok=>{if(ok)filter();});});
function moveMonth(step){if(chartMode==='monthly')$('queryYear').value=String(Number($('queryYear').value)+step);else{const [year,month]=$('queryMonth').value.split('-').map(Number);$('queryMonth').value=new Date(Date.UTC(year,month-1+step,1)).toISOString().slice(0,7);}if(data)updateOverview(true).then(ok=>{if(ok)filter();});}
for(let year=2021;year<=Number(today.slice(0,4));year++)$('queryYear').add(new Option(year+'년',String(year)));
$('queryYear').value=today.slice(0,4);
$('queryYear').onchange=()=>{if(data)updateOverview(true).then(ok=>{if(ok)filter();});};
function setChartMode(mode){if(mode===chartMode)return;if(mode==='monthly')$('queryYear').value=$('queryMonth').value.slice(0,4);else{const month=$('queryYear').value+$('queryMonth').value.slice(4);$('queryMonth').value=month>today?today:month;}chartMode=mode;$('periodQuery').hidden=mode==='all';$('queryMonth').hidden=mode!=='daily';$('queryYear').hidden=mode!=='monthly';$('dailyMode').setAttribute('aria-pressed',String(mode==='daily'));$('monthlyMode').setAttribute('aria-pressed',String(mode==='monthly'));$('allMode').setAttribute('aria-pressed',String(mode==='all'));$('policyInfo').hidden=true;if(data)updateOverview(true).then(ok=>{if(ok)filter();});}
$('dailyMode').onclick=()=>setChartMode('daily');$('monthlyMode').onclick=()=>setChartMode('monthly');$('allMode').onclick=()=>setChartMode('all');
$('prevMonth').onclick=()=>moveMonth(-1);$('nextMonth').onclick=()=>moveMonth(1);
new ResizeObserver(()=>{if(series.length)renderDaily();}).observe($('dailyChart'));
$('dataSettings').addEventListener('toggle',()=>{if($('dataSettings').open)load();});
let neighborhoodRows=[],neighborhoodPage=0,neighborhoodSelection=null;
function switchView(view){$('overviewView').hidden=!['overview','distance','apartments'].includes(view);document.body.classList.toggle('distance-only',view==='distance');document.body.classList.toggle('apartment-only',view==='apartments');$('distanceTab').setAttribute('aria-pressed',String(view==='distance'));$('apartmentTab').setAttribute('aria-pressed',String(view==='apartments'));$('neighborhoodView').hidden=view!=='neighborhood';$('regionalView').hidden=view!=='regional';$('neighborhoodTab').setAttribute('aria-pressed',String(view==='neighborhood'));$('regionalTab').setAttribute('aria-pressed',String(view==='regional'));if(view==='regional')renderRegional();}
function openNeighborhood(open){switchView(open?'neighborhood':'overview');}
$('shuffleDistricts').onclick=()=>{if(!data)return;selectedDistricts=Core.chooseDistricts(data.overview.recordDistricts.map(d=>({district:d,cancelled:false})));renderTop();};
$('regionalTab').onclick=()=>switchView('regional');$('backFromRegional').onclick=()=>switchView('overview');
$('regionalMonth').value=today;$('regionalMonth').max=today;
$('regionalMonth').onchange=renderRegional;$('regionalDistrict').onchange=renderRegional;
let regionalRows=[];
async function renderRegional(){if(!data)return;const range=Core.monthRange($('regionalMonth').value||today);const result=await API.get('/api/records/regions',{...range,district:$('regionalDistrict').value});regionalRows=result.regions.flatMap(r=>r.items);$('regionalSummary').textContent=`${$('regionalMonth').value.replace('-','.')} · 신고가 ${fmt(result.total)}건 · ${result.regions.length}개 구`;$('regionalList').innerHTML=result.regions.length?regionCards(result.regions,'regional',regionalRows):'<div class="empty"><h3>해당 월의 신고가 거래가 없습니다</h3></div>';}
$('regionalList').onclick=e=>{const b=e.target.closest('[data-regional-index]');if(b)detail(Number(b.dataset.regionalIndex),regionalRows);};
$('neighborhoodTab').onclick=()=>openNeighborhood(true);$('backOverview').onclick=()=>openNeighborhood(false);
for(const link of document.querySelectorAll('.page-nav a,.settings-link'))link.addEventListener('click',()=>openNeighborhood(false));
$('neighborhoodFrom').value=today+'-01';$('neighborhoodTo').value=currentDate;$('neighborhoodFrom').max=currentDate;$('neighborhoodTo').max=currentDate;
$('neighborhoodDistrict').onchange=async()=>{const result=await API.get('/api/dongs',{district:$('neighborhoodDistrict').value});$('neighborhoodDong').replaceChildren(new Option('전체 동',''));for(const name of result.items)$('neighborhoodDong').add(new Option(name,name));};
$('neighborhoodForm').onsubmit=e=>{e.preventDefault();if(!data)return;const district=$('neighborhoodDistrict').value,dong=$('neighborhoodDong').value,start=$('neighborhoodFrom').value,end=$('neighborhoodTo').value;if(!district||start>end){$('neighborhoodSummary').textContent='동네와 기간을 확인해 주세요.';return;}neighborhoodSelection={district,dong,start,end};neighborhoodPage=0;renderNeighborhood();};
let neighborhoodTotal=0;
async function renderNeighborhood(){const q=neighborhoodSelection;if(!q)return;const result=await API.get('/api/trades',{...q,kind:'record',page:neighborhoodPage+1,perPage:20});neighborhoodRows=result.items;neighborhoodTotal=result.total;const rows=neighborhoodRows;
 $('neighborhoodTitle').textContent=data.districts[q.district]+(q.dong?' '+q.dong:'')+' 신고가';$('neighborhoodSummary').textContent=`${q.start} ~ ${q.end} · ${fmt(result.total)}건 · 2021년부터 비교`;
 $('neighborhoodRows').innerHTML=rows.map((r,i)=>`<tr><td><button class="trade-link" data-neighborhood-index="${i}">${esc(r.name)}</button><small>${esc(r.dong)}</small></td><td>${esc(r.area)}㎡</td><td><b>${won(r.price)}</b></td><td>${esc(r.floor)}</td><td>${r.day}</td><td>${won(r.previous)}</td><td>+${won(r.delta)}</td></tr>`).join('');
 $('neighborhoodEmpty').hidden=rows.length>0;$('neighborhoodEmpty').textContent='이 조건의 신고가 거래가 없습니다.';$('downloadNeighborhood').disabled=!rows.length;$('neighborhoodPrev').disabled=neighborhoodPage===0;$('neighborhoodNext').disabled=(neighborhoodPage+1)*20>=result.total;$('neighborhoodPages').textContent=`${result.total?neighborhoodPage+1:0} / ${result.pages}`;}
$('neighborhoodPrev').onclick=()=>{neighborhoodPage--;renderNeighborhood();};$('neighborhoodNext').onclick=()=>{neighborhoodPage++;renderNeighborhood();};
$('neighborhoodRows').onclick=e=>{const b=e.target.closest('[data-neighborhood-index]');if(b)detail(Number(b.dataset.neighborhoodIndex),neighborhoodRows);};
$('downloadNeighborhood').onclick=async()=>{
 if(!neighborhoodSelection||!neighborhoodRows.length)return;const button=$('downloadNeighborhood');button.disabled=true;
 try{
 await document.fonts.ready;const q=neighborhoodSelection,rows=neighborhoodRows,width=1440,rowHeight=90,height=246+rows.length*rowHeight+120;
 const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;const ctx=canvas.getContext('2d');ctx.scale(2,2);ctx.fillStyle='#f7f8f1';ctx.fillRect(0,0,width,height);
 const text=(value,x,y,size=18,color='#20382b',weight=400)=>{ctx.font=weight+' '+size+'px "Malgun Gothic",sans-serif';ctx.fillStyle=color;ctx.fillText(String(value),x,y);};
 const wrap=(value,x,y,maxWidth)=>{let line='',offset=0;for(const char of value){ctx.font='600 18px "Malgun Gothic",sans-serif';if(ctx.measureText(line+char).width>maxWidth){text(line,x,y+offset,18,'#20382b',600);line='';offset+=23;}line+=char;}text(line,x,y+offset,18,'#20382b',600);};
 text('서울 아파트 신고가 트래커',42,43,16,'#66805a',600);text($('neighborhoodTitle').textContent,42,95,34,'#173d29',700);
 text(`${q.start} ~ ${q.end}  |  ${fmt(neighborhoodTotal)}건 중 ${neighborhoodPage*20+1}~${neighborhoodPage*20+rows.length}건`,42,135,18,'#63745f');
 text('2021년 이후 · 동일 단지 / 전용면적 소수점 내림 기준 · 해제 거래 제외',42,169,16,'#63745f');
 const xs=[42,482,642,802,882,1072,1232],headers=['단지 / 법정동','전용면적','거래가(억)','층','계약일','이전 기록(억)','상승액(억)'];
 ctx.fillStyle='#234e35';ctx.fillRect(26,198,width-52,48);headers.forEach((v,i)=>text(v,xs[i],229,17,'#eff6e4',600));
 rows.forEach((r,i)=>{const y=246+i*rowHeight;ctx.fillStyle=i%2?'#edf2e6':'#ffffff';ctx.fillRect(26,y,width-52,rowHeight);wrap(r.name,xs[0],y+29,420);text(r.dong,xs[0],y+76,15,'#738267');[r.area+'㎡',won(r.price),r.floor,r.day,won(r.previous),'+'+won(r.delta)].forEach((v,j)=>text(v,xs[j+1],y+45,18,j===1?'#245435':'#20382b',j===1?700:400));});
 const foot=246+rows.length*rowHeight;text('출처: 국토교통부 아파트 매매 실거래가 상세 자료',42,foot+39,16,'#63745f');text('자료 갱신 '+(data.asOf?data.asOf.slice(0,10):'—')+' · '+(neighborhoodPage+1)+' / '+Math.ceil(neighborhoodTotal/20)+' 페이지',42,foot+71,16,'#63745f');
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error();const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=($('neighborhoodTitle').textContent+'_'+q.start+'_'+q.end+'_'+(neighborhoodPage+1)+'.png').replace(/[\\/:*?"<>|]/g,'_');a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }catch{$('neighborhoodSummary').textContent='이미지 저장에 실패했습니다. 다시 시도해 주세요.';}finally{button.disabled=!neighborhoodRows.length;}
};
load();setInterval(()=>{if(data?.running||!data?.configured)load();},5000);
