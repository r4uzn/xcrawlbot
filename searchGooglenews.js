// searchGoogleNews.js
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';

const NEWS_DIR = 'data';
const NEWS_FILE = path.join(NEWS_DIR, 'news.json');

export default async function searchNews(keyword, limit = 5) {
    if (!keyword) throw new Error('검색 키워드가 필요합니다.');

    const url =
        `https://news.google.com/rss/search?q=${encodeURIComponent(keyword)}&hl=ko&gl=KR&ceid=KR:ko`;

    const res = await fetch(url, {
        headers: {
            'User-Agent':
                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36',
        },
    });
    if (!res.ok) throw new Error(`RSS 요청 실패: ${res.status}`);

    const xml = await res.text();

    // 아주 가벼운 파서(정규식): 제목/링크/날짜/소스만 추출
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => {
        const block = m[1];
        const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || [])[1]
            || (block.match(/<title>(.*?)<\/title>/) || [])[1] || '제목 없음';
        const link = (block.match(/<link>(.*?)<\/link>/) || [])[1] || '';
        const publishedAt = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
        const source = (block.match(/<source[^>]*>(.*?)<\/source>/) || [])[1] || '알 수 없음';
        return { title, url: link, publishedAt, source };
    }).slice(0, limit);

    return items;
}

// --- 직접 실행 감지(윈도우/ESM 대응) ---
function isRunDirectly() {
    try {
        const thisFile = path.resolve(fileURLToPath(import.meta.url));
        const entry = path.resolve(process.argv[1] || '');
        return thisFile === entry;
    } catch {
        return false;
    }
}

if (isRunDirectly()) {
    (async () => {
        try {
            const keyword = process.argv[2];
            if (!keyword) {
                console.error('❌ 키워드를 입력하세요. 예) node searchGoogleNews.js "만루홈런"');
                process.exit(1);
            }

            console.log(`[news] 검색어: ${keyword}`);
            const news = await searchNews(keyword, 5);

            fs.mkdirSync(NEWS_DIR, { recursive: true });
            fs.writeFileSync(
                NEWS_FILE,
                JSON.stringify(
                    {
                        keyword,
                        scraped_at: new Date().toISOString(),
                        total: news.length,
                        news,
                    },
                    null,
                    2
                ),
                'utf-8'
            );

            console.log(`✅ 뉴스 ${news.length}건 저장: ${NEWS_FILE}`);
        } catch (err) {
            console.error('❌ 오류:', err.message);
            process.exit(1);
        }
    })();
}
