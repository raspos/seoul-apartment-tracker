/* Pure presentation selectors. No API key or synthetic runtime data. */
(function(root){
 'use strict';
 function monthRange(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('조회 월을 선택하세요.');
  const [year,m]=month.split('-').map(Number);
  return {start:month+'-01',end:new Date(Date.UTC(year,m,0)).toISOString().slice(0,10)};
 }
 function periodRows(rows,start,end){return rows.filter(r=>!r.cancelled&&r.day>=start&&r.day<=end);}
 function isRecord(r){return !r.cancelled&&(r.kind==='loaded'||r.kind==='alltime');}
 function recordRows(rows,start,end){return periodRows(rows,start,end).filter(isRecord);}
 function neighborhoodRecords(rows,district,dong,start,end){
  return recordRows(rows,start,end).filter(r=>r.district===district&&(!dong||r.dong===dong));
 }
 function monthlySeries(rows,coverage,districts,year,historyStart=null){
  return monthlyRangeSeries(rows,coverage,districts,year+'-01-01',year+'-12-31',historyStart);
 }
 function monthlyRangeSeries(rows,coverage,districts,start,end,historyStart=null){
  const days=dailySeries(rows,coverage,districts,start,end,historyStart);
  const months=new Map();
  for(const d of days){const month=d.day.slice(0,7);if(!months.has(month))months.set(month,{...d,day:month+'-01',count:0,loaded:0,alltime:0});const p=months.get(month);p.count+=d.count;p.loaded+=d.loaded;p.alltime+=d.alltime;}
  return [...months.values()];
 }
 // Selected major announcements. Dates are announcement dates, not enforcement dates.
 const policies=[
  {date:'2021-02-04',short:'2·4 대책',name:'공공주도 3080+ 주택공급 확대방안',url:'https://www.korea.kr/news/policyNewsView.do?newsId=148883564'},
  {date:'2022-08-16',short:'8·16 대책',name:'국민 주거안정 실현방안',url:'https://epts.kdi.re.kr/archive/frwdHist/view2?EPIC_NUM=229073'},
  {date:'2023-01-03',short:'1·3 대책',name:'규제지역 해제 등 부동산 규제 정상화',url:'https://www.korea.kr/briefing/policyBriefingView.do?newsId=156546653'},
  {date:'2024-01-10',short:'1·10 대책',name:'주택공급 확대 및 건설경기 보완방안',url:'https://www.korea.kr/news/policyNewsView.do?newsId=148924663'},
  {date:'2024-08-08',short:'8·8 대책',name:'국민 주거안정을 위한 주택공급 확대방안',url:'https://mofe.go.kr/nw/nes/detailNesDtaView.do?menuNo=4010100&searchBbsId1=MOSFBBS_000000000028&searchNttId1=MOSF_000000000070135'},
  {date:'2025-06-27',short:'6·27 대책',name:'가계부채 관리 강화 방안',url:'https://www.fsc.go.kr/po010105/84824'},
  {date:'2025-09-07',short:'9·7 대책',name:'주택공급 확대방안',url:'https://m.korea.kr/briefing/policyBriefingView.do?newsId=156721813'},
  {date:'2025-10-15',short:'10·15 대책',name:'주택시장 안정화 대책',url:'https://s.nts.go.kr/nts/na/ntt/selectNttInfo.do?mi=2201&nttSn=1345899'},
  {date:'2026-01-29',short:'1·29 대책',name:'도심 주택공급 확대 및 신속화 방안',url:'https://m.korea.kr/briefing/policyBriefingView.do?newsId=156742030'},
  {date:'2026-08-13',short:'8·13 대책',name:'주택 신속공급 방안 및 부동산 금융 종합대책',url:'https://www.korea.kr/briefing/pressReleaseView.do?newsId=156774325'}
 ];
 function dailySeries(rows,coverage,districts,start,end,historyStart=null){
  const first=Date.parse(start+'T00:00:00Z'),last=Date.parse(end+'T00:00:00Z');
  if(!Number.isFinite(first)||!Number.isFinite(last)||first>last)throw Error('올바른 조회 기간을 선택하세요.');
  const counts=new Map();
  for(const r of periodRows(rows,start,end)){
   if(r.kind!=='loaded'&&r.kind!=='alltime')continue;
   const c=counts.get(r.day)||{loaded:0,alltime:0};c[r.kind]++;counts.set(r.day,c);
  }
  const completed=new Set(coverage.map(c=>c.district+':'+c.month));
  const byMonth=new Map();
  function coveredDistricts(month){
   if(byMonth.has(month))return byMonth.get(month);
   const required=[];
   if(historyStart){
    for(let m=historyStart;m<=month;){required.push(m);const y=Number(m.slice(0,4)),n=Number(m.slice(4));m=String(y+(n===12))+String(n%12+1).padStart(2,'0');}
   }else required.push(month);
   const count=required.length?districts.filter(d=>required.every(m=>completed.has(d+':'+m))).length:0;
   byMonth.set(month,count);return count;
  }
  const series=[];
  for(let t=first;t<=last;t+=86400000){
   const day=new Date(t).toISOString().slice(0,10),month=day.slice(0,7).replace('-','');
   const covered=coveredDistricts(month),c=counts.get(day)||{loaded:0,alltime:0};
   series.push({day,...c,count:c.loaded+c.alltime,covered,complete:covered===districts.length});
  }
  return series;
 }
 function chooseDistricts(rows,rng=Math.random){
  const candidates=[...new Set(rows.filter(r=>!r.cancelled).map(r=>r.district))];
  for(let i=candidates.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[candidates[i],candidates[j]]=[candidates[j],candidates[i]];}
  return candidates.slice(0,4);
 }
 function topTrades(rows,district){return rows.filter(r=>!r.cancelled&&r.district===district).sort((a,b)=>b.price-a.price||b.day.localeCompare(a.day)||a.name.localeCompare(b.name)).slice(0,3);}
 const api={monthRange,periodRows,dailySeries,monthlySeries,monthlyRangeSeries,isRecord,recordRows,neighborhoodRecords,policies,chooseDistricts,topTrades};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.TrackerCore=api;
})(globalThis);
