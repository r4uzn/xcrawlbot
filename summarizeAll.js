// summarizeAll.js
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import searchNews from './searchGoogleNews.js'; // 앞서 만든 RSS 모듈 사용

const ROOT = 'data';
const INPUT = path.join(ROOT, 'trends.json');
const OUT_DIR = path.join(ROOT, 'summaries');

function runSummarizer(payload) {
    return new Promise((resolve, reject) => {
        const py = spawn('python3', ['summarize.py']); // 환경에 따라 'python' 사용
        let out = '', err = '';
        py.stdout.on('data', d => (out += d.toString()));
        py.stderr.on('data', d => (err += d.toString()));
        py.on('close', code => {
            if (code !== 0) return reject(new Error(err || `summarize.py exit ${code}`));
            try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
        });
        py.stdin.write(JSON.stringify(payload));
        py.stdin.end();
    });
}

(async () => {
    if (!fs.existsSync(INPUT)) {
        console.error(`❌ 입력 파일이 없습니다: ${INPUT}`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(INPUT, 'utf-8'));
    const trends = raw.trends || [];
    if (!trends.length) {
        console.error('❌ trends.json에 trends 배열이 비어있음');
        process.exit(1);
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });

    const results = [];
    for (const t of trends) {
        const { index, keyword, reactions = [] } = t;
        console.log(`\n[${index}] '${keyword}' 요약 중... (reactions ${reactions.length}개)`);

        try {
            // Google 뉴스 RSS 3~5건
            const news = await searchNews(keyword, 5);

            // 요약기 호출
            const summary = await runSummarizer({ keyword, reactions, news });

            // 개별 저장
            const file = path.join(OUT_DIR, `keyword${index}.json`);
            fs.writeFileSync(file, JSON.stringify({
                index, keyword, summary, samples: reactions.slice(0, 8), news
            }, null, 2), 'utf-8');
            console.log(` ✅ 저장: ${file}`);

            results.push({ index, keyword, summary });
        } catch (e) {
            console.error(` ❌ '${keyword}' 요약 실패:`, e.message);
            results.push({ index, keyword, error: String(e) });
        }

        // 무리 방지
        await new Promise(r => setTimeout(r, 800));
    }

    // 전체 합본
    const allFile = path.join(OUT_DIR, 'all.json');
    fs.writeFileSync(allFile, JSON.stringify({
        generated_at: new Date().toISOString(),
        total: results.length,
        items: results
    }, null, 2), 'utf-8');

    console.log(`\n🚀 전체 요약 완료 → ${allFile}`);
})();
