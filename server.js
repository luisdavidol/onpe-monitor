const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
const {Firestore} = require('@google-cloud/firestore');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

let cachedData = null;
let lastFetch = null;
let isFetching = false;

const CANDIDATES = {
    candidate1: {
        name: "Keiko Fujimori",
        party: "Fuerza Popular",
        color: "#e91e63"
    },
    candidate2: {
        name: "Roberto Sánchez",
        party: "Juntos por el Perú",
        color: "#2196f3"
    }
};

async function scrapeWithPuppeteer() {
    let browser = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`Chrome intento ${attempt}/3...`);
            browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
            });
            break;
        } catch (e) {
            console.error(`Fallo intento ${attempt}: ${e.message.substring(0, 80)}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
            else throw e;
        }
    }

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setDefaultNavigationTimeout(45000);

        console.log('Navegando a ONPE...');
        try {
            await page.goto('https://resultadosegundavuelta.onpe.gob.pe/main/resumen', {
                waitUntil: 'networkidle2',
                timeout: 45000
            });
        } catch (e) {
            console.log('Nav warning:', e.message.substring(0, 80));
        }

        console.log('Esperando renderizado...');
        await new Promise(r => setTimeout(r, 8000));

        console.log('Extrayendo datos...');
        const data = await page.evaluate(() => {
            const text = document.body.innerText;
            const lines = text.split('\n').map(l => l.trim());

            let keikoVotes = 0;
            let robertoVotes = 0;
            let actasPorcentaje = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.includes('%') && !line.includes('votos')) {
                    const match = line.match(/([\d.]+)\s*%/);
                    if (match && i < 5) {
                        actasPorcentaje = parseFloat(match[1]);
                    }
                }

                if (line.includes('FUJIMORI') && !line.includes('ROBERTO')) {
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        const voteLine = lines[j];
                        const match = voteLine.match(/([\d']+),\s*(\d+)\s*votos/i);
                        if (match) {
                            keikoVotes = parseInt((match[1] + match[2]).replace(/'/g, ''));
                            break;
                        }
                    }
                }
                if (line.includes('SANCHEZ') || (line.includes('ROBERTO') && line.length < 30)) {
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        const voteLine = lines[j];
                        const match = voteLine.match(/([\d']+),\s*(\d+)\s*votos/i);
                        if (match) {
                            robertoVotes = parseInt((match[1] + match[2]).replace(/'/g, ''));
                            break;
                        }
                    }
                }
            }

            return { keikoVotes, robertoVotes, actasPorcentaje };
        });

        await browser.close();
        browser = null;

        console.log('Extraido:', JSON.stringify(data));

        if (data.keikoVotes > 0 || data.robertoVotes > 0) {
            return {
                candidate1: { ...CANDIDATES.candidate1, votes: data.keikoVotes || 0 },
                candidate2: { ...CANDIDATES.candidate2, votes: data.robertoVotes || 0 },
                actasContabilizadas: data.actasPorcentaje || 0,
                timestamp: new Date().toISOString()
            };
        }

        console.log('Sin votos encontrados');
        return null;
    } finally {
        if (browser) try { await browser.close(); } catch (_) {}
    }
}

async function fetchONPEData() {
    if (isFetching) return cachedData;
    isFetching = true;

    try {
        const result = await Promise.race([
            scrapeWithPuppeteer(),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 120s')), 120000))
        ]);

        if (result) {
            cachedData = result;
            lastFetch = new Date();
            console.log('Cache actualizado');
        }
        return result;
    } catch (error) {
        console.error('Error:', error.message);
        return null;
    } finally {
        isFetching = false;
    }
}

app.get('/api/results', async (req, res) => {
    if (cachedData) return res.json(cachedData);
    const data = await fetchONPEData();
    if (data) res.json(data);
    else res.status(500).json({ error: 'No se pudieron obtener los datos de ONPE' });
});

app.get('/api/candidates', (req, res) => res.json(CANDIDATES));

app.get('/api/status', (req, res) => {
    res.json({ lastFetch: lastFetch ? lastFetch.toISOString() : null, hasData: cachedData !== null, isFetching });
});

app.get('/api/refresh', async (req, res) => {
    const data = await fetchONPEData();
    if (data) res.json(data);
    else res.status(500).json({ error: 'Error al obtener datos' });
});

const db = new Firestore();
const SOCIAL_DOC = 'social/stats';

async function loadSocial() {
    try {
        const doc = await db.doc(SOCIAL_DOC).get();
        if (doc.exists) return doc.data();
    } catch (e) { console.error('Error loading social:', e.message); }
    return { views: 0, likes: 0, comments: [] };
}

async function saveSocial(data) {
    try { await db.doc(SOCIAL_DOC).set(data); }
    catch (e) { console.error('Error saving social:', e.message); }
}

app.get('/api/social', async (req, res) => res.json(await loadSocial()));

app.post('/api/social/view', async (req, res) => {
    try {
        await db.doc(SOCIAL_DOC).update({ views: db.FieldValue.increment(1) });
        const doc = await db.doc(SOCIAL_DOC).get();
        res.json({ views: doc.data()?.views || 0 });
    } catch (e) {
        const data = await loadSocial();
        data.views = (data.views || 0) + 1;
        await saveSocial(data);
        res.json({ views: data.views });
    }
});

app.post('/api/social/like', async (req, res) => {
    try {
        await db.doc(SOCIAL_DOC).update({ likes: db.FieldValue.increment(1) });
        const doc = await db.doc(SOCIAL_DOC).get();
        res.json({ likes: doc.data()?.likes || 0 });
    } catch (e) {
        const data = await loadSocial();
        data.likes = (data.likes || 0) + 1;
        await saveSocial(data);
        res.json({ likes: data.likes });
    }
});

app.post('/api/social/comment', async (req, res) => {
    const { name, text } = req.body;
    if (!text || text.trim().length === 0) return res.status(400).json({ error: 'El comentario no puede estar vacio' });
    const comment = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        name: (name || 'Anonimo').trim(),
        text: text.trim(),
        date: new Date().toISOString()
    };
    try {
        await db.doc(SOCIAL_DOC).update({ comments: db.FieldValue.arrayUnion(comment) });
        const doc = await db.doc(SOCIAL_DOC).get();
        let comments = doc.data()?.comments || [];
        if (comments.length > 200) {
            comments = comments.slice(-200);
            await db.doc(SOCIAL_DOC).update({ comments });
        }
        res.json(comment);
    } catch (e) {
        const data = await loadSocial();
        data.comments.push(comment);
        if (data.comments.length > 200) data.comments = data.comments.slice(-200);
        await saveSocial(data);
        res.json(comment);
    }
});

app.listen(PORT, async () => {
    console.log(`Servidor en http://localhost:${PORT}`);
    try {
        const doc = await db.doc(SOCIAL_DOC).get();
        if (!doc.exists) await db.doc(SOCIAL_DOC).set({ views: 0, likes: 0, comments: [] });
        const d = doc.exists ? doc.data() : { views: 0, likes: 0, comments: [] };
        console.log(`Social: ${d.views} views, ${d.likes} likes`);
    } catch (e) { console.error('Firestore init:', e.message); }

    setTimeout(() => fetchONPEData().then(d => console.log(d ? 'Datos OK' : 'Sin datos')), 1000);
});

setInterval(() => fetchONPEData(), 60000);
