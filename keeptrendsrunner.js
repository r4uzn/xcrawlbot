// trendsRunner.js
import getTrends from './crawlTrends.js';
import getReactions from './crawlReactions.js';

const idx = parseInt(process.argv[2] || '1', 10);

(async () => {
    const trends = await getTrends(10); // 이미 잘 동작하는 모듈
    if (!trends.length) {
        console.log('트렌드가 비었습니다.');
        return;
    }

    console.log('----------- 트렌드 -----------');
    trends.forEach((t, i) => console.log(`[${i + 1}] ${t}`));
    console.log('------------------------------');

    const i = Math.max(1, Math.min(idx, trends.length));
    const keyword = trends[i - 1];
    console.log(`선택: [${i}] ${keyword}`);

    const reactions = await getReactions(keyword, { cycles: 26 });
    console.log(`수집된 반응: ${reactions.length}개`);
    console.log(reactions.slice(0, 10));
})();
