// crawlReactions.js
import puppeteer from 'puppeteer';
import cookies from './cookies.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

// ---- 핵심: 안전한 goto 재시도 래퍼 ----
async function gotoWithRetry(page, url, { tries = 3, wait = 1500 } = {}) {
    let lastErr;
    for (let i = 0; i < tries; i++) {
        try {
            await page.goto(url, {
                waitUntil: ['domcontentloaded', 'networkidle2'],
                timeout: 90_000,
            });
            return; // 성공
        } catch (e) {
            lastErr = e;
            // 간헐적 net::ERR_CONNECTION_CLOSED / DNS / TLS 오류 재시도
            await sleep(wait * (i + 1)); // 지수 백오프
            // 실패 시 페이지 새로 교체 (세션 깨끗하게)
            try { await page.close(); } catch { }
            page = await page.browser().newPage();
            await preparePage(page);
        }
    }
    throw lastErr;
}

async function preparePage(page) {
    // 한국어 우선 + 최신 데스크톱 UA (차단/리디렉션 완화)
    await page.setExtraHTTPHeaders({
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    });
    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
    );
    await page.setViewport({ width: 1280, height: 1024 });
}

async function autoScroll(page, { step = 1000, delay = 300, limitPx = 60000 } = {}) {
    let total = 0;
    while (total < limitPx) {
        await page.evaluate((s) => window.scrollBy(0, s), step);
        total += step;
        await sleep(delay);
    }
}

async function collectTweets(page) {
    // 기본
    let t = await page.$$eval('div[data-testid="tweetText"]', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    if (t.length > 0) return t;

    // 폴백 1: 언어 블록
    t = await page.$$eval('article div[lang]', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    if (t.length > 0) return t;

    // 폴백 2: span 기반
    t = await page.$$eval('article [data-testid="tweetText"] span', ns =>
        ns.map(n => (n.innerText || '').trim()).filter(Boolean)
    );
    return t;
}

async function visitAndCollect(page, url) {
    await gotoWithRetry(page, url, { tries: 3, wait: 1500 });
    // 타임라인/로딩 표시 대기(있으면)
    await Promise.race([
        page.waitForSelector('div[aria-label="Timeline: Search timeline"]', { timeout: 15000 }),
        page.waitForSelector('div[role="progressbar"]', { timeout: 15000 }),
    ]).catch(() => { });
    await autoScroll(page, { step: 1000, delay: 300, limitPx: 60000 });

    const tweets = await collectTweets(page);
    return Array.from(new Set(tweets.filter(t => t && t.length >= 5)));
}

function buildCandidates(keyword) {
    const q = (keyword || '').trim();
    const isTag = q.startsWith('#');
    const tag = isTag ? q.slice(1) : '';

    const ko = '&src=typed_query&pf=on&lang=ko';
    const baseHashtag = isTag ? `https://x.com/hashtag/${encodeURIComponent(tag)}` : null;
    const baseSearch = `https://x.com/search?q=${encodeURIComponent(q)}`;

    // live/top 모두 + (키워드/해시태그) 상호 보완
    const cand = [];
    if (isTag) {
        cand.push(`${baseHashtag}?f=live${ko}`);
        cand.push(`${baseHashtag}?f=top${ko}`);
        cand.push(`${baseSearch}&f=live${ko}`);
        cand.push(`${baseSearch}&f=top${ko}`);
    } else {
        cand.push(`${baseSearch}&f=live${ko}`);
        cand.push(`${baseSearch}&f=top${ko}`);
        const asTag = `https://x.com/hashtag/${encodeURIComponent(q)}`;
        cand.push(`${asTag}?f=live${ko}`);
        cand.push(`${asTag}?f=top${ko}`);
    }

    return [...new Set(cand.map(u => u.replace('?&', '?')))];
}

/**
 * @param {string} keyword
 * @param {{sourceUrl?: string}} opts
 */
export default async function getReactions(keyword, opts = {}) {
    const { sourceUrl } = opts;
    if (!keyword && !sourceUrl) return [];

    const browser = await puppeteer.launch({
        headless: true,
        // 네트워크 불안정/HTTP2 이슈 완화용 플래그 (환경에 따라 유효)
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-features=site-per-process',
            '--disable-features=IsolateOrigins',
            '--disable-http2', // 일부 환경에서 H2로 인한 연결 종료를 우회
        ],
        ignoreHTTPSErrors: true,
    });

    let page = await browser.newPage();
    await preparePage(page);

    if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
    }

    let gathered = [];

    try {
        if (sourceUrl) {
            gathered = await visitAndCollect(page, sourceUrl);
        } else {
            const candidates = buildCandidates(keyword);
            for (const url of candidates) {
                try {
                    const chunk = await visitAndCollect(page, url);
                    gathered = Array.from(new Set([...gathered, ...chunk]));
                    if (gathered.length >= 20) break; // 어느 정도 모였으면 중단
                } catch (e) {
                    // net::ERR_CONNECTION_CLOSED 등은 다음 후보로
                    continue;
                }
            }
        }
    } finally {
        await browser.close();
    }

    return gathered.slice(0, 300);
}
