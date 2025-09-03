// getTrendTargets.js
import puppeteer from 'puppeteer';
import * as cheerio from 'cheerio';
import cookies from './cookies.js';

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

export default async function getTrendTargets(limit = 10) {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    if (Array.isArray(cookies) && cookies.length > 0) {
        await page.setCookie(...cookies);
    }

    await page.setViewport({ width: 1080, height: 1024 });

    const url = 'https://x.com/explore/tabs/trending';
    await page.goto(url, { waitUntil: ['domcontentloaded', 'networkidle2'], timeout: 60000 });
    await sleep(3000);

    // anchors 수집
    const anchors = await page.$$eval('div[aria-label="Timeline: Explore"] a[href]', els =>
        els.map(e => ({
            href: e.getAttribute('href') || '',
            text: (e.innerText || '').trim()
        }))
            .filter(a => a.href && !a.href.startsWith('#'))
    );

    // label 추출은 형님이 쓰던 방식과 최대한 유사하게
    const html = await page.content();
    const $ = cheerio.load(html);
    const trendElement = $('div[aria-label="Timeline: Explore"]');
    const titles = [];
    trendElement.find('div[dir="ltr"][style="color: rgb(231, 233, 234);"]').each((_, el) => {
        let t = $(el).find('span').text() || '';
        const idx = t.lastIndexOf('#');
        if (idx !== -1) t = t.substring(idx);
        t = t.trim();
        if (t) titles.push(t);
    });

    // 링크 우선순위: 이벤트 > 해시태그 > 검색
    const abs = (u) => (u.startsWith('http') ? u : `https://x.com${u}`);
    const prefer = (list, pred) => {
        const hit = list.find(pred);
        return hit ? abs(hit.href) : null;
    };

    // 후보 URL 집합 생성
    const urls = {
        events: anchors.filter(a => a.href.startsWith('/i/events/')).map(a => abs(a.href)),
        hashtag: anchors.filter(a => a.href.startsWith('/hashtag/')).map(a => abs(a.href)),
        search: anchors.filter(a => a.href.startsWith('/search?')).map(a => abs(a.href)),
    };

    // 타이틀과 URL을 매칭: 순서대로 이벤트/해시태그/검색에서 뽑되, 중복 제거
    const seen = new Set();
    const items = [];
    function push(label, url) {
        if (!url || seen.has(url)) return;
        seen.add(url);
        items.push({ label, url });
    }

    // 1) 해시태그 타이틀이면 해시태그 URL 우선
    titles.forEach(t => {
        if (t.startsWith('#')) {
            const tag = encodeURIComponent(t.slice(1));
            const u = urls.hashtag.find(u => u.includes(`/hashtag/${tag}`)) || urls.search.find(u => u.includes(tag));
            push(t, u);
        }
    });
    // 2) 나머지 타이틀은 검색/이벤트에서
    titles.forEach(t => {
        if (!t.startsWith('#')) {
            const q = encodeURIComponent(t);
            const u = urls.events[0] || urls.search.find(u => u.includes(q)) || urls.hashtag[0];
            push(t, u);
        }
    });
    // 3) 부족하면 남은 링크들로 채우기
    [...urls.events, ...urls.hashtag, ...urls.search].forEach(u => push('(unknown)', u));

    await browser.close();
    return items.slice(0, limit);
}
