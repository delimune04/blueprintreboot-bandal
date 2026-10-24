export const ACCOUNT_CHANGED = 'ACCOUNT_CHANGED';
const changed = () => Object.assign(new Error('로그인 계정이 변경되었습니다. 새로고침 후 본인 계정을 확인해 주세요.'), {code: ACCOUNT_CHANGED, status:409});
/** The account key is a stale-tab guard, never a substitute for server identity. */
export function createFinanceApi({getAccountKey, onAccountChanged, fetcher=globalThis.fetch, base='/finance/api'}) {
 let locked=false;
 return async function api(path,{method='GET',body}={}) {
  const isSession=path==='session', publicRead=isSession||path.startsWith('companies/')||path.startsWith('shared/');
  if(locked&&!publicRead) throw changed();
  const expected=getAccountKey();
  const headers=new Headers({'Accept':'application/json'});
  if(body!==undefined) headers.set('Content-Type','application/json');
  if(expected&&!publicRead) headers.set('X-Finance-Account',expected);
  const response=await fetcher(`${base}/${path}`,{method,headers,credentials:'same-origin',cache:'no-store',...(body!==undefined?{body:JSON.stringify(body)}:{})});
  let data; try {data=await response.json();} catch {throw new Error('서버 응답을 읽을 수 없습니다. 잠시 후 다시 시도해 주세요.');}
  if((!publicRead&&expected!==getAccountKey())||data.code===ACCOUNT_CHANGED||data.error?.code===ACCOUNT_CHANGED||(!publicRead&&expected&&response.status===401)){if(!locked){locked=true;onAccountChanged();}throw changed();}
  if(!response.ok) throw Object.assign(new Error(typeof data.error==='string'?data.error:data.error?.message||data.message||'요청을 완료하지 못했습니다.'),{status:response.status,code:data.code||data.error?.code});
  return data;
 };
}
