// The account key confirms the intended account; Sites supplies authentication.
export const ACCOUNT_CHANGED='ACCOUNT_CHANGED';
const changedError=()=>Object.assign(new Error('로그인한 계정이 변경되었어요. 현재 계정을 다시 확인해 주세요.'),{status:409,code:ACCOUNT_CHANGED});
export function createAccountApi({getAccountKey,onAccountChanged,fetcher=globalThis.fetch,base='/moaflow/api'}){
 let locked=false;
 return async function api(path,{method='GET',body}={}){
  if(locked&&path!=='session')throw changedError();
  const accountKey=getAccountKey(),headers=new Headers(body?{'Content-Type':'application/json'}:{});
  if(accountKey)headers.set('X-Moaflow-Account',accountKey);
  const response=await fetcher(base+'/'+path,{method,credentials:'same-origin',headers,...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw new Error('서버 응답을 읽지 못했어요.');}
  if(!response.ok){
   if(data.code===ACCOUNT_CHANGED){if(!locked){locked=true;onAccountChanged();}throw changedError();}
   throw Object.assign(new Error(data.error||'요청을 마치지 못했어요.'),{status:response.status,code:data.code});
  }
  return data;
 };
}
