// onefile_trends.js
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import cookies from './cookies.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function preparePage(page) {
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 1024 });
}

async function gotoWithRetry(page, url, { tries = 3, wait = 1500 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            await page.goto(url, {
                waitUntil: ['domcontentloaded', 'networkidle2'],
                timeout: 90_000,
            });
            return;
        } catch (e) {
            lastErr = e;
            try { await page.close(); } catch { }
            page = await page.browser().newPage();
            await preparePage(page);
            await sleep(wait * (i + 1));
        }
    }
    throw lastErr;
}

async function autoScroll(page, { step = 1000, delay = 300, limitPx = 90000 } = {}) {
    let total = 0;
    while (total < limitPx) {
        await page.evaluate((s) => window.scrollBy(0, s), step);
        total += step;
        await sleep(delay);
    }
}

async function collectTweets(page) {
    let t = await page.$$eval('div[data-testid="tweetText"]', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    if (t.length > 0) return t;

    t = await page.$$eval('article div[lang]', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    if (t.length > 0) return t;

    t = await page.$$eval('article [data-testid="tweetText"] span', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    return t;
}

function buildCandidates(keyword) {
    const q = (keyword || '').trim();
    const isTag = q.startsWith('#');
    const tag = isTag ? q.slice(1) : '';
    const ko = '&src=typed_query&pf=on&lang=ko';
    const baseHashtag = isTag ? `https://x.com/hashtag/${encodeURIComponent(tag)}` : null;
    const baseSearch = `https://x.com/search?q=${encodeURIComponent(q)}`;
    const mobileHashtag = isTag ? `https://mobile.twitter.com/hashtag/${encodeURIComponent(tag)}` : null;
    const mobileSearch = `https://mobile.twitter.com/search?q=${encodeURIComponent(q)}`;
    const add = (arr, u) => { if (u) arr.push(u); };
    const cand = [];

    const pushSet = (bTag, bSearch) => {
        add(cand, `${bTag}?f=live${ko}`);
        add(cand, `${bTag}?f=top${ko}`);
        add(cand, `${bSearch}&f=live${ko}`);
        add(cand, `${bSearch}&f=top${ko}`);
        add(cand, `${bTag}?f=live`);
        add(cand, `${bTag}?f=top`);
        add(cand, `${bSearch}&f=live`);
        add(cand, `${bSearch}&f=top`);
    };

    if (isTag) {
        pushSet(baseHashtag, baseSearch);
        pushSet(mobileHashtag, mobileSearch);
    } else {
        const asTag = `https://x.com/hashtag/${encodeURIComponent(q)}`;
        const mTag = `https://mobile.twitter.com/hashtag/${encodeURIComponent(q)}`;
        pushSet(asTag, baseSearch);
        pushSet(mTag, mobileSearch);
    }
    return [...new Set(cand.map(u => u.replace('?&', '?')))];
}

async function getReactions(keyword, { browser, sourceUrl } = {}) {
    if (!keyword && !sourceUrl) return [];

    let page = await browser.newPage();
    await preparePage(page);
    if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
    }
    await page.setCacheEnabled(false);

    const visit = async (url) => {
        console.log('[visit]', url);
        await gotoWithRetry(page, url, { tries: 3, wait: 1500 });

        // 에러 배너 감지 후 최대 3회 재시도
        for (let r = 0; r < 3; r++) {
            await Promise.race([
                page.waitForSelector('div[data-testid="tweetText"]', { timeout: 20000 }),
                page.waitForSelector('article', { timeout: 20000 }),
                page.waitForSelector('div[aria-label="Timeline: Search timeline"]', { timeout: 20000 }),
            ]).catch(() => { });

            const html = await page.content();
            if (/Something went wrong|Try reloading/i.test(html)) {
                console.log('[warn] Something went wrong 감지 → reload');
                await page.reload({ waitUntil: ['domcontentloaded', 'networkidle2'] }).catch(() => { });
                await sleep(1500);
                continue;
            }
            break;
        }

        await autoScroll(page, { step: 1000, delay: 300, limitPx: 90000 });

        const html2 = await page.content();
        if (/Sign in|Log in|로그인/i.test(html2)) {
            console.log('[warn] 로그인 페이지 감지:', page.url());
            return [];
        }
        const tweets = await collectTweets(page);
        return Array.from(new Set(tweets.filter(t => t && t.length >= 5)));
    };

    let gathered = [];
    try {
        if (sourceUrl) {
            gathered = await visit(sourceUrl);
        } else {
            const candidates = buildCandidates(keyword);
            for (const url of candidates) {
                try {
                    const chunk = await visit(url);
                    gathered = Array.from(new Set([...gathered, ...chunk]));
                    if (gathered.length >= 40) break;
                } catch {
                    continue;
                }
            }
        }
    } finally {
        try { await page.close(); } catch { }
    }
    return gathered.slice(0, 300);
}

async function getTrends(limit = 10, { browser } = {}) {
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
    await page.close();
    return [...new Set(raw)].slice(0, limit);
}

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        slowMo: 60,
        devtools: true,
        defaultViewport: null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-http2',
            '--disable-features=AutomationControlled',
            '--window-size=1280,900',
        ],
    });

    try {
        const trends = await getTrends(10, { browser });
        if (!trends.length) {
            console.log('트렌드가 비었습니다.');
            return;
        }

        console.log('----------- 실시간 트렌드 -----------');
        trends.forEach((t, i) => console.log(`[${i + 1}] ${t}`));
        console.log('-------------------------------------');

        const results = [];
        for (let i = 0; i < trends.length; i++) {
            const keyword = trends[i];
            console.log(`\n[${i + 1}] '${keyword}' 반응 수집 중...`);
            try {
                const reactions = await getReactions(keyword, { browser });
                console.log(` → 수집된 반응: ${reactions.length}개`);

                const base = keyword.startsWith('#')
                    ? `https://x.com/hashtag/${encodeURIComponent(keyword.slice(1))}`
                    : `https://x.com/search?q=${encodeURIComponent(keyword)}`;
                const tried_urls = [
                    `${base}&f=live`.replace('?&', '?'),
                    `${base}&f=top`.replace('?&', '?'),
                ];

                results.push({
                    index: i + 1,
                    keyword,
                    scraped_at: new Date().toISOString(),
                    count: reactions.length,
                    tried_urls,
                    reactions,
                });
            } catch (e) {
                console.error(` ❌ '${keyword}' 수집 실패:`, e.message);
            }
            await sleep(2000);
        }

        const dir = path.join('data');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, 'trends.json');

        const payload = {
            scraped_at: new Date().toISOString(),
            total: results.length,
            trends: results,
        };
        fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf-8');
        console.log(`\n✅ 전체 데이터 저장 완료: ${file}`);
    } finally {
        await browser.close();
    }
})();