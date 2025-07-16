import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import dateMaker from './dateMaker.js'
import cookies from './cookies.js';
import { exec } from 'child_process';

(async () => {
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({
    headless: true
  });
  console.log(`Puppeteer 브라우저를 시작함`);
  
  await browser.setCookie(...cookies);
  console.log(`브라우저에 쿠키를 적용함`);

  const page = await browser.newPage();
  console.log(`새 페이지를 엶`);
  
  // Navigate the page to a URL
  const targetUrl = 'https://x.com/explore/tabs/news';
  await page.goto(targetUrl);
  console.log(`${targetUrl}로 이동함`);
  
  // Set screen size
  await page.setViewport({width: 1080, height: 1024});
  console.log(`ViewPort를 설정함`);

  console.log(`페이지가 로드되기를 기다리는 중..(5초)`);
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Get HTML of the page
  const $ = cheerio.load(await page.content());
  console.log(`Cheerio 객체가 생성됨`)

  // Get element that has div tag with aria-label="Timeline: Explore" attribute
  const trendElement = $('div[aria-label="Timeline: Explore"]');
  console.log(`Trending DIV 태그를 찾음`);

  const elementWithId = trendElement.find('div[dir="ltr"][style="color: rgb(231, 233, 234);"]');
  console.log(`트렌딩 키워드를 포함하는 태그를 찾음`);

  console.log();

  console.log('----------- X  실시간 트렌드 -----------');
  let listCount = 1;
  for (const e of elementWithId) {
    // console.log(e);
    const $e = $(e);
    let honey = $e.find('span').text();;

    // 해시태그 두 번 중복되는 버그 수정
    const indexOfHash = honey.lastIndexOf('#');
    if(indexOfHash !== -1)
      honey = honey.substring(indexOfHash);

    console.log(`[${listCount}] ` + honey);
    listCount++;
  }
  console.log('------------------------------------');
  // 1위 키워드만 추출
  const topKeyword = elementWithId.first().find('span').text();

  // 실행 (searchBing.js로 전달)
  exec(`node searchBing.js "${topKeyword}"`, (error, stdout, stderr) => {
    if (error) {
      console.error("실행 중 오류 발생: ${error.message}");
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(stdout);
  });
  // delay 30 secs
  /* console.log(`30초를 기다리는 중..`);
  await new Promise(resolve => setTimeout(resolve, 30000)); */

  // close and exit
  await browser.close();
})();
