// server.js
import express from 'express';
import { spawn } from 'child_process';
import getTrends from './crawlTrends.js';
import getReactions from './crawlReactions.js';
import searchNews from './searchGoogleNews.js';

const app = express();

app.get('/api/trends', async (_req, res) => {
    try {
        const keywords = await getTrends(10);
        res.json({ as_of: new Date().toISOString(), keywords });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

app.get('/api/issue', async (req, res) => {
    const keyword = (req.query.keyword || '').toString();
    if (!keyword) return res.status(400).json({ error: 'keyword required' });

    try {
        const [reactions, news] = await Promise.all([
            getReactions(keyword),
            searchNews(keyword, 5)
        ]);
        const summary = await summarizePython({ keyword, reactions, news });
        res.json({
            keyword,
            summary,
            samples: { reactions: reactions.slice(0, 8) },
            meta: { scraped_at: new Date().toISOString() }
        });
    } catch (e) {
        res.status(500).json({ error: String(e) });
    }
});

function summarizePython(input) {
    return new Promise((resolve, reject) => {
        const py = spawn('python3', ['summarize.py']);
        let out = '', err = '';
        py.stdout.on('data', d => out += d.toString());
        py.stderr.on('data', d => err += d.toString());
        py.on('close', code => {
            if (code !== 0) return reject(new Error(err || `exit ${code}`));
            try { resolve(JSON.parse(out)); } catch (e) { reject(e); }
        });
        py.stdin.write(JSON.stringify(input));
        py.stdin.end();
    });
}

app.listen(3000, () => console.log('http://localhost:3000'));
