// QA-стенд: рендер /ecosystem, /onchain, /calendar в LIVE-ветке при подмене ответов внешних API в браузере проверки.
// Запуск: cd /tmp/shot (puppeteer-core + @sparticuz/chromium) && node <этот файл>. Не подтверждает соединение с API — только контракт отображения.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const now=Date.now(), H=3600000, day=86400;
const chains=[['Ethereum',62e9],['Solana',9.1e9],['BSC',5.6e9],['Tron',8.2e9],['Avalanche',1.3e9],['Sui',1.9e9],['Arbitrum',2.8e9],['Base',4.1e9],['OP Mainnet',0.7e9],['Polygon',1.1e9],['Other',20e9]].map(([name,tvl])=>({name,tvl,tokenSymbol:null}));
const hist=Array.from({length:12},(_,i)=>({date:Math.floor(now/1000)-(11-i)*day,tvl:60e9*(1+0.003*i)}));
const mock={
 'api.llama.fi/v2/chains':chains,
 'api.llama.fi/v2/historicalChainTvl':hist,
 'mempool.space/api/v1/mining/hashrate/3d':{hashrates:[{timestamp:1,avgHashrate:640e18},{timestamp:2,avgHashrate:655e18}],currentHashrate:661e18,currentDifficulty:126.4e12},
 'mempool.space/api/v1/difficulty-adjustment':{progressPercent:62.3,difficultyChange:1.87,remainingBlocks:760,estimatedRetargetDate:now+5.2*24*H},
 'mempool.space/api/v1/fees/recommended':{fastestFee:14,halfHourFee:11,hourFee:8,economyFee:3,minimumFee:1},
 'mempool.space/api/mempool':{count:31240,vsize:18_400_000,total_fee:41_200_000},
 'mempool.space/api/blocks/tip/height':915402,
 'fapi.binance.com/fapi/v1/premiumIndex':['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT'].map(s=>({symbol:s,markPrice:'1',indexPrice:'1',lastFundingRate:'0.0001',nextFundingTime:now+3*H,time:now})),
 'fapi.binance.com/fapi/v1/exchangeInfo':{serverTime:now,symbols:[{symbol:'BTCUSDT_261226',pair:'BTCUSDT',contractType:'CURRENT_QUARTER',deliveryDate:now+85*24*H,onboardDate:now,status:'TRADING',quoteAsset:'USDT'},{symbol:'ETHUSDT_261226',pair:'ETHUSDT',contractType:'CURRENT_QUARTER',deliveryDate:now+85*24*H,onboardDate:now,status:'TRADING',quoteAsset:'USDT'},{symbol:'BTCUSDT_270326',pair:'BTCUSDT',contractType:'NEXT_QUARTER',deliveryDate:now+176*24*H,onboardDate:now,status:'TRADING',quoteAsset:'USDT'}]},
};
for (const w of [390,1440]) {
  const browser = await puppeteer.launch({ args: [...chromium.args,'--no-sandbox'], executablePath: await chromium.executablePath(), headless: true });
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request',req=>{const u=req.url().replace(/^https?:\/\//,'');const k=Object.keys(mock).find(k=>u.startsWith(k));if(k)req.respond({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify(mock[k])});else req.continue();});
  await page.setViewport({ width: w, height: 900 });
  await page.goto('http://localhost:5173/', { waitUntil: 'networkidle2' });
  try { await page.evaluate(()=>{localStorage.setItem('cryptora_theme','dark');}); } catch {}
  for (const r of ['ecosystem','onchain','calendar']) {
    await page.goto('http://localhost:5173/'+r, { waitUntil: 'networkidle2' }); await new Promise(res=>setTimeout(res,2000));
    await page.screenshot({ path: `/home/user/CRYPTORA/screenshots/polish-e/reflive-${r}-${w}.png`, fullPage: true });
  }
  await browser.close();
}
