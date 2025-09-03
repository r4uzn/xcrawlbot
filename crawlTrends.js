// crawlTrends.js
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import cookies from './cookies.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export default async function getTrends(limit = 10) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
    }

    await page.goto('https://x.com/explore/tabs/trending', {
        waitUntil: ['domcontentloaded', 'networkidle2'],
        timeout: 60000
    });

    await page.setViewport({ width: 1080, height: 1024 });
    await sleep(5000);

    const $ = cheerio.load(await page.content());
    const trendElement = $('div[aria-label="Timeline: Explore"]');
    const elementWithId = trendElement.find('div[dir="ltr"][style="color: rgb(231, 233, 234);"]');

    const raw = [];
    for (const e of elementWithId) {
        const $e = $(e);
        let t = ($e.find('span').text() || '').trim();
        const idx = t.lastIndexOf('#');
        if (idx !== -1) t = t.substring(idx);
        if (t) raw.push(t);
    }

    const trends = [...new Set(raw)].slice(0, limit);
    await browser.close();
    return trends;
}
