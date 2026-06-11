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

        // Pagina 1: Resumen (votos)
        console.log('Scrapeando /main/resumen...');
        try {
            await page.goto('https://resultadosegundavuelta.onpe.gob.pe/main/resumen', {
                waitUntil: 'networkidle2', timeout: 45000
            });
        } catch (e) { console.log('Nav warning:', e.message.substring(0, 80)); }

        await new Promise(r => setTimeout(r, 8000));

        const resumen = await page.evaluate(() => {
            const text = document.body.innerText;
            const lines = text.split('\n').map(l => l.trim());
            let keikoVotes = 0, robertoVotes = 0, actasPorcentaje = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.includes('%') && !line.includes('votos')) {
                    const match = line.match(/([\d.]+)\s*%/);
                    if (match && i < 5) actasPorcentaje = parseFloat(match[1]);
                }
                if (line.includes('FUJIMORI') && !line.includes('ROBERTO')) {
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        const m = lines[j].match(/([\d']+),\s*(\d+)\s*votos/i);
                        if (m) { keikoVotes = parseInt((m[1] + m[2]).replace(/'/g, '')); break; }
                    }
                }
                if ((line.includes('SANCHEZ') || (line.includes('ROBERTO') && line.length < 30)) && !line.includes('FUJIMORI')) {
                    for (let j = i + 1; j < Math.min(i + 6, lines.length); j++) {
                        const m = lines[j].match(/([\d']+),\s*(\d+)\s*votos/i);
                        if (m) { robertoVotes = parseInt((m[1] + m[2]).replace(/'/g, '')); break; }
                    }
                }
            }
            return { keikoVotes, robertoVotes, actasPorcentaje };
        });

        console.log('Resumen:', JSON.stringify(resumen));

        // Pagina 2: Actas (contabilizadas, pendientes, envio JEE)
        console.log('Scrapeando /main/actas...');
        try {
            await page.goto('https://resultadosegundavuelta.onpe.gob.pe/main/actas', {
                waitUntil: 'networkidle2', timeout: 45000
            });
        } catch (e) { console.log('Nav warning:', e.message.substring(0, 80)); }

        await new Promise(r => setTimeout(r, 8000));

        const actas = await page.evaluate(() => {
            const text = document.body.innerText;
            const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);

            let contabilizadasPct = 0, contabilizadasCant = 0;
            let envioJeePct = 0, envioJeeCant = 0;
            let pendientesPct = 0, pendientesCant = 0;
            let total = 0;
            let procesadasPct = 0;

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];

                if (line.includes('Procesadas al')) {
                    const m = line.match(/([\d.]+)\s*%/);
                    if (m) procesadasPct = parseFloat(m[1]);
                }

                if (line.includes('Contabilizadas') && !line.includes('Actas')) {
                    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
                        const m = lines[j].match(/([\d.]+)\s*%/);
                        if (m && !lines[j].includes('Procesadas')) { contabilizadasPct = parseFloat(m[1]); break; }
                    }
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        if (lines[j].includes('%')) continue;
                        const n = parseInt(lines[j].replace(/[,.\s]/g, ''));
                        if (n > 100) { contabilizadasCant = n; break; }
                    }
                }

                if (line.includes('envío al JEE') || line.includes('envio al JEE')) {
                    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
                        const m = lines[j].match(/([\d.]+)\s*%/);
                        if (m) { envioJeePct = parseFloat(m[1]); break; }
                    }
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        if (lines[j].includes('%')) continue;
                        const n = parseInt(lines[j].replace(/[,.\s]/g, ''));
                        if (n > 0) { envioJeeCant = n; break; }
                    }
                }

                if (line.includes('Pendientes') && !line.includes('envío')) {
                    for (let j = i; j < Math.min(i + 3, lines.length); j++) {
                        const m = lines[j].match(/([\d.]+)\s*%/);
                        if (m) { pendientesPct = parseFloat(m[1]); break; }
                    }
                    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
                        if (lines[j].includes('%')) continue;
                        const n = parseInt(lines[j].replace(/[,.\s]/g, ''));
                        if (n >= 0) { pendientesCant = n; break; }
                    }
                }

                if (line.startsWith('TOTAL')) {
                    const m = line.replace(/[,.\s]/g, '').match(/(\d+)/);
                    if (m) total = parseInt(m[1]);
                }
            }

            return { contabilizadasPct, contabilizadasCant, envioJeePct, envioJeeCant, pendientesPct, pendientesCant, total, procesadasPct };
        });

        console.log('Actas:', JSON.stringify(actas));

        await browser.close();
        browser = null;

        if (resumen.keikoVotes > 0 || resumen.robertoVotes > 0 || actas.total > 0) {
            return {
                candidate1: { ...CANDIDATES.candidate1, votes: resumen.keikoVotes || 0 },
                candidate2: { ...CANDIDATES.candidate2, votes: resumen.robertoVotes || 0 },
                actasContabilizadas: resumen.actasPorcentaje || 0,
                actas: {
                    contabilizadas: { porcentaje: actas.contabilizadasPct, cantidad: actas.contabilizadasCant },
                    envioJee: { porcentaje: actas.envioJeePct, cantidad: actas.envioJeeCant },
                    pendientes: { porcentaje: actas.pendientesPct, cantidad: actas.pendientesCant },
                    procesadas: actas.procesadasPct,
                    total: actas.total
                },
                timestamp: new Date().toISOString()
            };
        }

        console.log('Sin datos encontrados');
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

setInterval(() => fetchONPEData(), 20000);
