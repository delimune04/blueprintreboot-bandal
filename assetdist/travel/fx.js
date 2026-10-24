let snapshot=null,overrides={};const storageKey='bandal-travel-fx-v1';
export function configureFx(data){snapshot=data;try{const v=JSON.parse(localStorage.getItem(storageKey)||'{}');overrides=Object.fromEntries(Object.entries(v).filter(([c,r])=>['JPY','EUR','GBP','CZK','HUF'].includes(c)&&Number.isFinite(r.value)&&r.value>0&&r.value<100000&&/^\d{4}-\d{2}-\d{2}$/.test(r.date)));}catch{overrides={}}}
export function fxRate(currency){if(currency==='KRW')return{rate:1,date:'환산 없음',source:'원화 금액'};const manual=overrides[currency];if(manual)return{rate:manual.value,date:manual.date,source:'사용자 입력'};const r=snapshot?.rates?.find(r=>r.currency===currency&&r.unit===1);return r&&Number.isFinite(r.krwPerUnit)&&r.krwPerUnit>0?{rate:r.krwPerUnit,date:r.quoteDate,source:'ECB 참고환율 · 원화 교차계산'}:null;}
export function krwEstimate(amount,currency){const r=fxRate(currency);return Number.isFinite(amount)&&r?amount*r.rate:null;}
export function krwLabel(amount,currency){if(currency==='KRW')return'';const n=krwEstimate(amount,currency);return n===null?'':`약 ${Math.round(n).toLocaleString('ko-KR')}원`;}
export function setFxOverride(currency,value,date){if(!['JPY','EUR','GBP','CZK','HUF'].includes(currency)||!Number.isFinite(value)||value<=0||value>=100000||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('외화 1단위당 원화 환율을 0보다 크게 입력해 주세요.');overrides[currency]={value,date};localStorage.setItem(storageKey,JSON.stringify(overrides));}
export function resetFxOverride(currency){delete overrides[currency];localStorage.setItem(storageKey,JSON.stringify(overrides));}
export function fxSource(){return snapshot?.sourceUrl||null;}

export function clearFxOverrides(){overrides={};localStorage.removeItem(storageKey);}
