import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import dateMaker from './dateMaker.js'
import cookies from './cookies.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function autoScroll(page, { step = 1000, delay = 300, limitPx = 60000 } = {}) {
  let total = 0;
  while (total < limitPx) {
    await page.evaluate((s) => window.scrollBy(0, s), step);
    total += step;
    await sleep(delay);
  }
}

(async () => {
  const browser = await puppeteer.launch({ headless: true });
  console.log(`Puppeteer 브라우저를 시작함`);

  const page = await browser.newPage();
  console.log(`새 페이지를 엶`);

  if (Array.isArray(cookies) && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`브라우저에 쿠키를 적용함`);
  } else {
    console.log(`쿠키가 비어있음 - 건너뜀`);
  }

  const targetUrl = 'https://x.com/explore/tabs/trending';
  await page.goto(targetUrl, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 60000 });
  console.log(`${targetUrl}로 이동함`);

  await page.setViewport({ width: 1080, height: 1024 });
  console.log(`ViewPort를 설정함`);

  console.log(`페이지가 로드되기를 기다리는 중..(5초)`);
  await sleep(5000);

  const $ = cheerio.load(await page.content());
  console.log(`Cheerio 객체가 생성됨`);

  const trendElement = $('div[aria-label="Timeline: Explore"]');
  console.log(`Trending DIV 태그를 찾음`);

  const elementWithId = trendElement.find('div[dir="ltr"][style="color: rgb(231, 233, 234);"]');
  console.log(`트렌딩 키워드를 포함하는 태그를 찾음`);

  console.log('\n----------- X  실시간 트렌드 -----------');
  let listCount = 1;
  let firstTrend = '';
  for (const e of elementWithId) {
    const $e = $(e);
    let honey = $e.find('span').text() || '';
    const idx = honey.lastIndexOf('#');
    if (idx !== -1) honey = honey.substring(idx);
    if (!firstTrend && honey.trim()) firstTrend = honey.trim();
    console.log(`[${listCount}] ${honey}`);
    listCount++;
  }
  console.log('------------------------------------');

  if (!firstTrend) {
    console.log('상위 키워드를 찾지 못했음 - 종료');
    await browser.close();
    return;
  }

  const dest = firstTrend.startsWith('#')
    ? `https://x.com/hashtag/${encodeURIComponent(firstTrend.slice(1))}?f=live`
    : `https://x.com/search?q=${encodeURIComponent(firstTrend)}&f=live`;

  console.log(`1번 키워드로 이동: ${dest}`);
  await page.goto(dest, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 60000 });

  // 본문 로딩 대기(없어도 되지만 안전)
  await page.waitForSelector('div[data-testid="tweetText"]', { timeout: 60000 }).catch(() => { });
  await autoScroll(page, { step: 1000, delay: 300, limitPx: 60000 });

  const reactions = await page.$$eval('div[data-testid="tweetText"]', nodes =>
    Array.from(new Set(nodes.map(n => (n.innerText || '').trim()).filter(t => t && t.length >= 5)))
  );

  console.log(`수집된 반응 개수: ${reactions.length}`);
  reactions.slice(0, 12).forEach((t, i) => console.log(`- (${i + 1}) ${t}`));
  console.log('...');

  await browser.close();
})();
