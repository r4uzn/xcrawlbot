import puppeteer from 'puppeteer';
import dateMaker from './dateMaker.js'
import cookies from './cookies.js';
import { exec } from 'child_process';

(async () => {
  // Launch the browser and open a new blank page
  const browser = await puppeteer.launch({
    headless: true
  });
  console.log(`Puppeteer 브라우저를 시작함`);

  const page = await browser.newPage();
  console.log(`새 페이지를 엶`);

  // Set cookies (브라우저가 아니라 페이지에 설정)
  if (Array.isArray(cookies) && cookies.length > 0) {
    await page.setCookie(...cookies);
    console.log(`브라우저에 쿠키를 적용함`);
  } else {
    console.log(`쿠키가 비어있음 - 건너뜀`);
  }

  // Set screen size
  await page.setViewport({ width: 1080, height: 1024 });
  console.log(`ViewPort를 설정함`);

  // Navigate the page to a URL
  const targetUrl = 'https://x.com/explore/tabs/news';
  await page.goto(targetUrl, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 60000 });
  console.log(`${targetUrl}로 이동함`);

  // 페이지 로딩 완료 대기 - 고정 5초 대신 구체적 셀렉터 대기
  const trendContainer = 'div[aria-label="Timeline: Explore"]';
  await page.waitForSelector(trendContainer, { timeout: 60000 });
  console.log(`트렌드 컨테이너 로드됨`);

  // 더 견고한 셀렉터로 텍스트 추출 (style 의존 제거)
  const trendSelector = `${trendContainer} div[dir="ltr"] span`;
  const rawTrends = await page.$$eval(trendSelector, spans =>
    spans
      .map(s => (s.textContent || '').trim())
      .filter(Boolean)
  );

  // 해시태그/키워드 정제: 해시태그가 두 번 중복되는 케이스 방지
  const trends = rawTrends
    .map(t => {
      const idx = t.lastIndexOf('#');
      return idx !== -1 ? t.substring(idx) : t;
    })
    // 의미없는 짧은 토큰 제거 및 중복 제거
    .filter(t => t.length > 1)
    .filter((t, i, arr) => arr.indexOf(t) === i);

  console.log();
  console.log('----------- X  실시간 트렌드 -----------');
  trends.forEach((t, i) => {
    console.log(`[${i + 1}] ${t}`);
  });
  console.log('------------------------------------');

  // 1위 키워드만 추출
  const topKeyword = trends[0] || '';
  if (!topKeyword) {
    console.log('상위 키워드를 찾지 못했음 - 종료');
    await browser.close();
    return;
  }

  // 실행 (searchbing.js로 전달) - 파일명 케이스 일치
  exec(`node searchbing.js "${topKeyword}"`, (error, stdout, stderr) => {
    if (error) {
      console.error(`실행 중 오류 발생: ${error.message}`);
      return;
    }
    if (stderr) {
      console.error(`stderr: ${stderr}`);
      return;
    }
    console.log(stdout);
  });

  // close and exit
  await browser.close();
})();
