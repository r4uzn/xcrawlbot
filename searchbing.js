// searchBing.js
import puppeteer from 'puppeteer';

const keyword = process.argv[2];

if (!keyword) {
  console.error('검색어 인자가 없습니다.');
  process.exit(1);
}

const newsUrl = `https://www.bing.com/news/search?q=${encodeURIComponent(keyword)}`;

console.log(`Bing 뉴스탭 검색 중: ${newsUrl}`);

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox']
});

const page = await browser.newPage();
await page.goto(newsUrl, { waitUntil: 'domcontentloaded' });

await page.setViewport({ width: 1280, height: 800 });

console.log('뉴스 기사 제목 추출 중...');

const titles = await page.$$eval('a.title', anchors =>
  anchors.slice(0, 5).map(el => el.textContent.trim())
);

console.log('\n Bing 뉴스 상위 기사 5건:');
titles.forEach((title, idx) => {
  console.log(`[${idx + 1}] ${title}`);
});

await browser.close();
