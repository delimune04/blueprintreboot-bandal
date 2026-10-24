// Supported city datasets; budgets are editable planning defaults, never price quotes.
export const CITY_CATALOG=[
  {key:'osaka',label:'오사카',country:'일본',aliases:['osaka','大阪','오사카'],currency:'JPY',dailyBudget:3000,mealBudget:1500},
  {key:'kyoto',label:'교토',country:'일본',aliases:['kyoto','京都','교토'],currency:'JPY',dailyBudget:3000,mealBudget:1500},
  {key:'rome',label:'로마',country:'이탈리아',aliases:['rome','roma','로마'],currency:'EUR',dailyBudget:40,mealBudget:20},
  {key:'tokyo',label:'도쿄',country:'일본',aliases:['tokyo','東京','도쿄','동경'],currency:'JPY',dailyBudget:3000,mealBudget:1500},
  {key:'paris',label:'파리',country:'프랑스',aliases:['paris','파리'],currency:'EUR',dailyBudget:40,mealBudget:20},
  {key:'london',label:'런던',country:'영국',aliases:['london','런던'],currency:'GBP',dailyBudget:40,mealBudget:20},
  {key:'seoul',label:'서울',country:'대한민국',aliases:['seoul','서울'],currency:'KRW',dailyBudget:30000,mealBudget:null},
  {"key":"barcelona","label":"바르셀로나","country":"스페인","aliases":["barcelona","바르셀로나"],"currency":"EUR","dailyBudget":40,"mealBudget":null},
  {"key":"madrid","label":"마드리드","country":"스페인","aliases":["madrid","마드리드"],"currency":"EUR","dailyBudget":40,"mealBudget":null},
  {"key":"lisbon","label":"리스본","country":"포르투갈","aliases":["lisbon","lisboa","리스본"],"currency":"EUR","dailyBudget":40,"mealBudget":null},
  {"key":"amsterdam","label":"암스테르담","country":"네덜란드","aliases":["amsterdam","암스테르담"],"currency":"EUR","dailyBudget":40,"mealBudget":null},
  {"key":"prague","label":"프라하","country":"체코","aliases":["prague","praha","프라하"],"currency":"CZK","dailyBudget":1000,"mealBudget":null},
  {"key":"vienna","label":"빈","country":"오스트리아","aliases":["vienna","wien","빈","비엔나"],"currency":"EUR","dailyBudget":40,"mealBudget":null},
  {key:'both',label:'오사카 + 교토',country:'일본 · 두 도시',aliases:['간사이','오사카교토','오사카+교토','osaka+kyoto','osakakyoto'],currency:'JPY',dailyBudget:3000,mealBudget:1500}
];
export const CITY=Object.fromEntries(CITY_CATALOG.filter(c=>c.key!=='both').map(c=>[c.key,c.label]));
export const regionDefaults=region=>CITY_CATALOG.find(c=>c.key===region)||CITY_CATALOG[0];
export const currencyFor=region=>regionDefaults(region).currency;
export const SUPPORTED_NAMES=Object.values(CITY).join(' · ');
