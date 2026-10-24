// The provider runs on a separate origin. No project data or parent-storage access is shared.
export const FLIGHT_PAGE_URL='https://flights.bandal.app/';
export function setupFlightWidget(){
 const narrow=window.matchMedia('(max-width: 650px)');
 const open=document.getElementById('openFlightWidget'),close=document.getElementById('closeFlightWidget'),mount=document.getElementById('flightWidgetMount'),status=document.getElementById('flightWidgetStatus');
 open.addEventListener('click',()=>{
  if(narrow.matches||mount.firstChild)return;
  const frame=document.createElement('iframe');
  frame.title='BANDAL 항공권 검색 · Travelpayouts';frame.className='flight-widget-frame';
  frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox');
  frame.setAttribute('referrerpolicy','strict-origin-when-cross-origin');
  frame.setAttribute('allow',"geolocation 'none'; camera 'none'; microphone 'none'; payment 'none'");
  frame.src=FLIGHT_PAGE_URL;
  mount.append(frame);open.hidden=true;open.setAttribute('aria-expanded','true');close.hidden=false;
  status.textContent='항공 검색창을 열었어요. 출발지·연도·날짜·인원을 직접 확인하세요. 결과가 표시되지 않거나 새 창이 차단되면 ‘별도 창에서 검색’을 이용해 주세요.';
 });
 narrow.addEventListener('change',()=>{if(narrow.matches){mount.replaceChildren();close.hidden=true;open.hidden=false;open.setAttribute('aria-expanded','false');status.textContent='휴대폰에서는 별도 항공 검색창을 이용해 주세요.';}});
 close.addEventListener('click',()=>{mount.replaceChildren();close.hidden=true;open.hidden=false;open.setAttribute('aria-expanded','false');status.textContent='외부 검색창을 닫았어요. 입력 조건은 항공 서비스의 저장 정책에 따라 남을 수 있습니다.';open.focus();});
}
