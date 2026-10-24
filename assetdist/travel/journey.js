import {distance,hasCoords,travelMinutes,formatMinutes,PACE,CITY,isKnownClosed} from './engine.js';
import {currencyFor,regionDefaults} from './cities.js';
export {currencyFor};
export const money = (value,currency='JPY') => value==null ? '확인 필요' : new Intl.NumberFormat('ko-KR',{style:'currency',currency,maximumFractionDigits:['JPY','KRW'].includes(currency)?0:2}).format(value);
export const matchesRegion = (city,region) => region==='both'?['osaka','kyoto'].includes(city):city===region;
export function rankPlaces(pois,settings){
  return pois.filter(p=>!p.custom&&matchesRegion(p.city,settings.region)).map(p=>{
    const liked=(settings.interests||[]).includes(p.category);
    const short=p.duration<=90;
    const free=p.price===0;
    const score=(liked?45:0)+(settings.pace==='relaxed'&&short?18:short?5:0)+(settings.budget==='free'?(free?80:-35):free?10:0)+(hasCoords(p)?5:0);
    const reasons=[liked?'선택한 취향에 맞아요':null,settings.pace==='relaxed'&&short?'여유 있게 둘러보기 좋아요':null,free?'일반 구역 입장료가 없어요':null,`${p.duration||60}분 정도 머무르는 코스`].filter(Boolean);
    return {...p,score,reasons};
  }).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,'ko')).map((p,i)=>({...p,rank:i+1}));
}
export function routeDirection(from,to,mode='transit'){const place=p=>hasCoords(p)?`${p.lat},${p.lng}`:`${p.name}, ${CITY[p.city]||''}`;const u=new URL('https://www.google.com/maps/dir/');u.searchParams.set('api','1');u.searchParams.set('origin',place(from));u.searchParams.set('destination',place(to));u.searchParams.set('travelmode',['walking','driving'].includes(mode)?mode:'transit');return u.href;}
function resolveDefaultLeg(from,to,settings,data){
  const currency=currencyFor(to.city||from.city||settings.region);
  const km=distance(from,to);
  const candidate=(data.transitLegs||[]).find(l=>l.fromId===from.id&&l.toId===to.id&&!l.alternativeOnly);
  const suspended=candidate&&settings.travelDate&&isKnownClosed(candidate,settings.travelDate);
  const exact=suspended?null:candidate;
  if(exact&&(settings.transport!=='walk'||exact.mode==='walk')){
    const minutes=Number.isFinite(exact.durationMinutes)?exact.durationMinutes:travelMinutes(from,to);
    return {...exact,from,to,km,mapsUrl:routeDirection(from,to,exact.mode==='walk'?'walking':'transit'),currency:exact.currency||currency,minutes,fare:Number.isFinite(exact.fare)?exact.fare:null,modeCode:exact.mode,verifiedRoute:true,timeBasis:exact.durationIsEstimate===false?'공식 안내 소요시간':'계획용 예상시간',routeUrl:exact.routeUrl||routeDirection(from,to),passIds:exact.passIds||[],mode:({metro:'지하철',rail:'철도',bus:'버스',walk:'도보'}[exact.mode]||exact.mode||'대중교통')};
  }
  const walking=settings.transport==='walk'||(km!==null&&km<=1.2);
  const minutes=km===null?30:walking?Math.ceil(km*1.35/4.5*60/5)*5:travelMinutes(from,to);
  return {from,to,currency,km,mapsUrl:routeDirection(from,to,walking?'walking':'transit'),minutes,fare:walking&&km!==null?0:null,mode:walking?'도보':'대중교통 확인 필요',modeCode:walking?'walk':'transit',verifiedRoute:false,passIds:[],routeUrl:routeDirection(from,to),timeBasis:km===null?'위치 미확인 · 임시 30분':walking?'직선거리로 추정한 도보시간':'직선거리로 추정한 이동시간',serviceSuspended:!!suspended,notes:suspended?'공식 자료상 선택일 운휴인 구간입니다. 이 시간은 직선거리 추정이며 실제 대체 경로·운임을 확인해야 합니다.':km===null?'위치가 없어 시간표에 임시 30분을 배정했어요. 실제 경로·시간·운임은 확인해야 합니다.':walking?'거리 × 우회계수 1.35, 시속 4.5km 기준입니다. 실제 보행로·횡단보도·계단은 미반영입니다.':'검증된 구간표에 없는 경로예요. 노선·승하차역·운임은 길찾기에서 확인해 주세요.'};
}
export function legKey(from,to){const identity=p=>p.custom||p.id==='custom-origin'?[p.id,p.name,p.lat,p.lng]:[p.id];return encodeURIComponent(JSON.stringify([identity(from),identity(to)]));}
export function legCandidates(from,to,settings,data){
 const date=settings.travelDate,base=resolveDefaultLeg(from,to,settings,data),curated=(data.transitLegs||[]).filter(l=>l.fromId===from.id&&l.toId===to.id),result=[{...base,optionId:'auto',title:'추천 이동',reason:base.verifiedRoute?'공식 자료가 있는 구간을 우선했어요.':base.modeCode==='walk'?'가까운 거리라 도보를 제안해요.':'검증된 노선이 없어 외부 길찾기 확인이 필요해요.',selectable:true}];
 for(const leg of curated){const closed=date&&isKnownClosed(leg,date),conditional=leg.validWeekdays?.length&&date&&!leg.validWeekdays.includes(new Date(date+'T00:00:00Z').getUTCDay());const resolved=resolveDefaultLeg(from,to,{...settings,transport:'auto',travelDate:null},{...data,transitLegs:[{...leg,alternativeOnly:false}]});result.push({...resolved,optionId:'curated:'+leg.id,title:leg.line||resolved.mode,reason:leg.alternativeOnly?'특정 요일에 운행하는 별도 노선이에요.':'공식 노선·운임 자료가 있는 선택지예요.',selectable:!closed&&!conditional,unavailableReason:closed?'선택일 운휴가 확인됐어요.':conditional?'평일·공휴일 운행 여부를 확인하지 못해 선택할 수 없어요. 공식 시간표를 확인해 주세요.':null});}
 const walk=resolveDefaultLeg(from,to,{...settings,transport:'walk'},{...data,transitLegs:curated.filter(l=>l.mode==='walk')});result.push({...walk,mode:'도보',modeCode:'walk',optionId:'walking',title:'걸어서 이동',reason:'직선거리 기반 도보 추정입니다. 실제 보행 가능 경로는 Google Maps에서 확인해 주세요.',selectable:true});
 if(!curated.some(l=>l.mode!=='walk'))result.push({...base,optionId:'transit',title:'대중교통 직접 확인',mode:'대중교통 확인 필요',modeCode:'transit',timeBasis:'직선거리로 추정한 대중교통 이동시간',verifiedRoute:false,fare:null,passIds:[],minutes:travelMinutes(from,to),mapsUrl:routeDirection(from,to,'transit'),reason:'이 구간의 검증된 노선·운임이 아직 없어요.',notes:'표시 시간은 직선거리 기반 계획용 추정입니다. 배차·환승·실제 운임은 확인해야 해요.',selectable:true});
 result.push({from,to,km:distance(from,to),currency:base.currency,optionId:'taxi',title:'택시·차량 이동 검토',mode:'택시·차량 확인 필요',modeCode:'car',minutes:30,fare:null,verifiedRoute:false,durationUnknown:true,timeBasis:'시간 미확인 · 일정에 임시 30분 배정',passIds:[],mapsUrl:routeDirection(from,to,'driving'),routeUrl:routeDirection(from,to,'driving'),reason:'차량 이동을 원하는 경우 직접 선택해 주세요. 추천 운임이나 소요시간이 확인된 상품은 아닙니다.',notes:'Google Maps 운전 경로는 택시 견적이 아닙니다. 실제 택시·차량 이용 가능 여부, 요금과 소요시간을 따로 확인하세요.',selectable:true});return result;
}
export function resolveLeg(from,to,settings,data){const key=legKey(from,to),choice=settings.legChoices?.[key];if(!choice)return{...resolveDefaultLeg(from,to,settings,data),choiceKey:key,optionId:'auto'};const found=legCandidates(from,to,settings,data).find(o=>o.optionId===choice.optionId);if(!found||!found.selectable)return{...resolveDefaultLeg(from,to,settings,data),choiceKey:key,optionId:'auto',choiceNeedsReview:true,choiceNotice:'이전에 고른 이동 방법이 현재 날짜·구간에 맞는지 확인할 수 없어 추천값을 임시 사용해요.'};return{...found,choiceKey:key,choiceNeedsReview:choice.reviewedDate!==settings.travelDate,choiceNotice:choice.reviewedDate!==settings.travelDate?'방문 날짜가 바뀌었어요. 선택한 이동 방법을 다시 확인해 주세요.':null};}

function mealAfterIndex(day,dict,settings,data){if(!day.stops.length)return 0;const parts=(settings.startTime||'09:00').split(':').map(Number);let clock=parts[0]*60+parts[1],previous=settings.basePoint||null;const target=clock<14*60+30?11*60+30:clock+120;for(let i=0;i<day.stops.length;i++){const p=dict[day.stops[i]];if(!p)continue;if(previous)clock+=resolveLeg(previous,p,{...settings,travelDate:day.date},data).minutes;clock+=p.duration||60;if(clock>=target)return i;previous=p;}return day.stops.length-1;}
export function mealCandidates(day,dict,data,afterIndex,preference='nearby',includeAll=false){
  if(afterIndex===undefined)afterIndex=mealAfterIndex(day,dict,{startTime:'09:00',transport:'auto'},data);
  if(!day.stops.length)return[];
  const index=Math.min(afterIndex,day.stops.length-1),a=dict[day.stops[index]],b=dict[day.stops[index+1]]||a;
  return (data.restaurants||[]).filter(r=>r.city===a.city&&(includeAll||hasCoords(r)&&!isKnownClosed(r,day.date))).map(r=>({
    ...r,mealMatch:preference==='nearby'?0:preference==='cafe'?Number(/카페|차|티룸|베이커리|커피|cafe|tea|bakery/i.test([r.cuisine,r.name].join(' '))):Number(!/카페|티룸|베이커리|cafe|tea|bakery/i.test([r.cuisine,r.name].join(' '))),nearKm:distance(a,r),detourKm:hasCoords(r)&&hasCoords(a)&&hasCoords(b)?Math.max(0,distance(a,r)+distance(r,b)-distance(a,b)):null
  })).filter(r=>includeAll||r.nearKm<=2.5&&r.detourKm<=2.5).sort((a,b)=>b.mealMatch-a.mealMatch||(a.detourKm??Infinity)-(b.detourKm??Infinity)).slice(0,includeAll?100:3);
}
export function buildDayTimeline(day,dict,settings,data,mealChoice){
 const currency=currencyFor(settings.region),start=/^\d\d:\d\d$/.test(settings.startTime||'')?settings.startTime:'09:00',startMinutes=Number(start.slice(0,2))*60+Number(start.slice(3));let clock=startMinutes,prev=settings.basePoint||null;
 const entries=[],legs=[],known={attractions:0,transport:0,mealBudget:0};let unknownAttractions=0,unknownFares=0,unknownMeals=0,missingHotelAccess=false,travel=0,visit=0;
 const finiteBudget=v=>Number.isFinite(v)&&v>=0?v:null;
 const breakfastIncluded=settings.breakfastIncluded===true,breakfastBudget=breakfastIncluded?0:finiteBudget(settings.breakfastBudget);
 entries.push({type:'meal',kind:'breakfast',restaurant:null,candidates:[],allCandidates:[],budget:breakfastBudget,included:breakfastIncluded,start:Math.max(0,startMinutes-60),end:Math.max(0,startMinutes-15),minutes:45});if(breakfastBudget===null)unknownMeals++;else known.mealBudget+=breakfastBudget;
 const afterIndex=mealAfterIndex(day,dict,{...settings,legChoices:day.choices?.legs},data),candidates=mealCandidates(day,dict,data,afterIndex,settings.mealPreference||'nearby');let lunchRestaurant=null,lunchDone=false;
 const addLeg=(from,to)=>{const leg=resolveLeg(from,to,{...settings,travelDate:day.date,legChoices:day.choices?.legs},data);entries.push({type:'leg',...leg,start:clock,end:clock+leg.minutes});clock+=leg.minutes;travel+=leg.minutes;legs.push(leg);if(leg.fare===null)unknownFares++;else known.transport+=leg.fare;};
 const addMeal=(kind,index)=>{const choice=kind==='lunch'?day.choices?.meal:day.choices?.dinner,selectedId=choice?.id??(kind==='lunch'?mealChoice:undefined),allCandidates=mealCandidates(day,dict,data,index,settings.mealPreference||'nearby',true),near=mealCandidates(day,dict,data,index,settings.mealPreference||'nearby'),automatic=near.find(r=>(!r.mealServices||r.mealServices.includes(kind))&&(kind!=='dinner'||r.id!==lunchRestaurant?.id)),candidateRestaurant=selectedId==='none'?null:selectedId?allCandidates.find(r=>r.id===selectedId)||null:automatic||null,restaurant=candidateRestaurant?.mealServices&&!candidateRestaurant.mealServices.includes(kind)?null:candidateRestaurant;
 const mealNeedsReview=!!(choice&&choice.reviewedDate!==day.date||selectedId&&selectedId!=='none'&&!restaurant||restaurant&&isKnownClosed(restaurant,day.date)),budget=kind==='lunch'?(finiteBudget(settings.mealBudget)??regionDefaults(settings.region).mealBudget):finiteBudget(settings.dinnerBudget);
 if(kind==='dinner'&&clock<18*60){entries.push({type:'freeTime',start:clock,end:18*60,minutes:18*60-clock});clock=18*60;}
 if(restaurant&&prev)addLeg(prev,restaurant);const minutes=restaurant?.duration||60,window=restaurant?.mealTimeWindows?.[kind],asMinute=value=>/^\d{2}:\d{2}$/.test(value||'')?Number(value.slice(0,2))*60+Number(value.slice(3)):null,lastOrder=asMinute(window?.lastOrder),closes=asMinute(window?.close),timeNeedsReview=!!window&&(lastOrder!==null&&clock>lastOrder||closes!==null&&clock+minutes>closes);entries.push({type:'meal',kind,restaurant,candidates:near,allCandidates,budget,mealNeedsReview:mealNeedsReview||timeNeedsReview,start:clock,end:clock+minutes,minutes});clock+=minutes;if(budget===null)unknownMeals++;else known.mealBudget+=budget;if(restaurant)prev=restaurant;if(kind==='lunch'){lunchRestaurant=restaurant;lunchDone=true;const rest=Math.max(0,(Number(settings.breakTime)||90)-minutes);if(rest){entries.push({type:'break',minutes:rest,start:clock,end:clock+rest});clock+=rest;}}};
 if(settings.hotelName){entries.push({type:'origin',name:settings.hotelName,label:'숙소 출발',start:clock});if(prev){const access=settings.hotelAccessMinutes,knownAccess=Number.isFinite(access)&&access>=0;entries.push({type:'hotelAccess',name:prev.name,minutes:knownAccess?access:null,start:clock});if(knownAccess){clock+=access;travel+=access}else missingHotelAccess=true;}else missingHotelAccess=true;}
 if(prev)entries.push({type:'origin',name:prev.name,label:settings.hotelName?'선택한 출발 거점':'오늘의 출발 거점',start:clock});
 for(let i=0;i<day.stops.length;i++){const p=dict[day.stops[i]];if(!p)continue;if(prev)addLeg(prev,p);entries.push({type:'poi',poi:p,index:i,start:clock,end:clock+(p.duration||60)});clock+=p.duration||60;visit+=p.duration||60;if(Number.isFinite(p.price))known.attractions+=p.price;else unknownAttractions++;prev=p;if(i===afterIndex)addMeal('lunch',i);}
 if(!lunchDone){if(clock<12*60)clock=12*60;addMeal('lunch',Math.max(0,day.stops.length-1));}addMeal('dinner',Math.max(0,day.stops.length-1));
 if(settings.basePoint&&prev&&prev.id!==settings.basePoint.id){addLeg(prev,settings.basePoint);entries.push({type:'origin',name:settings.basePoint.name,label:'출발 거점으로 복귀',start:clock});if(settings.hotelName){const access=settings.hotelAccessMinutes;if(Number.isFinite(access)&&access>=0){clock+=access;travel+=access;}entries.push({type:'origin',name:settings.hotelName,label:Number.isFinite(access)?'숙소 복귀':'숙소 복귀 · 거점에서의 이동 미포함',start:Number.isFinite(access)?clock:null});}}
 return{entries,legs,candidates,restaurant:lunchRestaurant,currency,known,unknownAttractions,unknownFares,unknownMeals,missingHotelAccess,subtotal:known.attractions+known.transport+known.mealBudget,travel,visit,startMinutes,endMinutes:clock,total:clock-startMinutes,over:Math.max(0,travel+visit+entries.filter(e=>e.type==='break'||e.type==='meal'&&e.kind!=='breakfast').reduce((n,e)=>n+e.minutes,0)-(PACE[settings.pace]||480))};
}
export function passEstimate(pass,journey,day,dict){
  const currency=pass.currency||currencyFor(pass.city),sameCurrency=currency===journey.currency;
  const routeSavings=journey.legs.filter(l=>l.passIds?.includes(pass.id)&&Number.isFinite(l.fare)).reduce((s,l)=>s+l.fare,0);
  const covered=(pass.includedPoiIds||[]).filter(id=>day.stops.includes(id)&&Number.isFinite(dict[id]?.price));
  const attractionSavings=covered.reduce((s,id)=>s+dict[id].price,0);
  const baseline=journey.known.attractions+journey.known.transport;
  const valid=(!pass.validFrom||day.date>=pass.validFrom)&&(!pass.validUntil||day.date<=pass.validUntil);
  const comparable=pass.autoCompare!==false&&!(pass.validHours>24)&&journey.endMinutes<1440&&sameCurrency&&valid&&Number.isFinite(pass.price)&&(routeSavings+attractionSavings)>0;
  return {comparable,valid,currency,covered,routeSavings,attractionSavings,baseline,withPass:comparable?pass.price+Math.max(0,baseline-routeSavings-attractionSavings):null,difference:comparable?routeSavings+attractionSavings-pass.price:null,unknown:journey.unknownAttractions+journey.unknownFares};
}
export function clockLabel(minutes){if(minutes==null)return'시간 확인';const next=Math.floor(minutes/1440);const m=((minutes%1440)+1440)%1440;return`${next?'다음 날 ':''}${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;}
