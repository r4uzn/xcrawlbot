import fs from 'fs';
import path from 'path';
import getTrends from './crawlTrends.js';
import getReactions from './crawlReactions.js';

(async () => {
    const trends = await getTrends(10);
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
            const reactions = await getReactions(keyword);
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

        await new Promise((res) => setTimeout(res, 2000));
    }

    // 한 파일로 저장
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
})();
