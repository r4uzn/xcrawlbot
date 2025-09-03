// check_cookie.js
import puppeteer from 'puppeteer';
import cookies from './cookies.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  if (Array.isArray(cookies) && cookies.length) await page.setCookie(...cookies);
  await page.goto('https://x.com/home', { waitUntil: ['domcontentloaded','networkidle2'], timeout: 60000 });
  await sleep(2000);
  const html = await page.content();
  const loggedOut = /Sign in|Log in|로그인/i.test(html);
  console.log(loggedOut ? '쿠키 무효/만료(로그인 안됨)' : '쿠키 유효(로그인 상태)');
  await browser.close();
})();
