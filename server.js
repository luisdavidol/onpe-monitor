const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');
let Firestore;
try {
    ({Firestore} = require('@google-cloud/firestore'));
} catch (e) {
    console.log('Firestore module not available');
}

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
let fetchStartTime = null;
let lastScrapeDuration = null;
let browserInstance = null;
let scrapeError = null;
let consecutiveErrors = 0;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const CANDIDATES = {
    candidate1: { name: "Keiko Fujimori", party: "Fuerza Popular", color: "#e91e63" },
    candidate2: { name: "Roberto Sánchez", party: "Juntos por el Perú", color: "#2196f3" }
};

async function getBrowser() {
    if (browserInstance) {
        try {
            await browserInstance.version();
            return browserInstance;
        } catch (e) {
            console.log('Chrome muerto, relanzando...');
            try { await browserInstance.close(); } catch (_) {}
            browserInstance = null;
        }
    }

    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            console.log(`Chrome intento ${attempt}/3...`);
            browserInstance = await puppeteer.launch({
                headless: 'new',
                executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
                timeout: 30000,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-gpu',
                    '--disable-extensions'
                ]
            });
            console.log('Chrome listo');
            return browserInstance;
        } catch (e) {
            console.error(`Fallo intento ${attempt}: ${e.message.substring(0, 80)}`);
            if (attempt < 3) await new Promise(r => setTimeout(r, 5000));
            else throw e;
        }
    }
}

async function scrapePage(browser, url, extractor) {
    let page = null;
    try {
        page = await browser.newPage();
        await page.setUserAgent(UA);
        await page.setDefaultNavigationTimeout(30000);
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await new Promise(r => setTimeout(r, 15000));
        const result = await page.evaluate(extractor);
        return result;
    } catch (e) {
        console.error(`scrapePage(${url.split('/').pop()}):`, e.message.substring(0, 60));
        throw e;
    } finally {
        if (page) await page.close().catch(() => {});
    }
}

const RESUMEN_EXTRACTOR = () => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim());
    let keikoVotes = 0, robertoVotes = 0, actasPorcentaje = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('%') && !line.includes('votos') && i < 5) {
            const m = line.match(/([\d.]+)\s*%/);
            if (m) actasPorcentaje = parseFloat(m[1]);
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
};

const ACTAS_EXTRACTOR = () => {
    const text = document.body.innerText;
    const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let cPct = 0, cCant = 0, ePct = 0, eCant = 0, pPct = 0, pCant = 0, total = 0, proc = 0;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes('Procesadas al')) { const m = line.match(/([\d.]+)\s*%/); if (m) proc = parseFloat(m[1]); }
        if (line.includes('Contabilizadas') && !line.includes('Actas')) {
            for (let j = i; j < Math.min(i + 3, lines.length); j++) { const m = lines[j].match(/([\d.]+)\s*%/); if (m && !lines[j].includes('Procesadas')) { cPct = parseFloat(m[1]); break; } }
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) { if (lines[j].includes('%')) continue; const n = parseInt(lines[j].replace(/[,.\s]/g, '')); if (n > 100) { cCant = n; break; } }
        }
        if (line.includes('envío al JEE') || line.includes('envio al JEE')) {
            for (let j = i; j < Math.min(i + 3, lines.length); j++) { const m = lines[j].match(/([\d.]+)\s*%/); if (m) { ePct = parseFloat(m[1]); break; } }
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) { if (lines[j].includes('%')) continue; const n = parseInt(lines[j].replace(/[,.\s]/g, '')); if (n > 0) { eCant = n; break; } }
        }
        if (line.includes('Pendientes') && !line.includes('envío')) {
            for (let j = i; j < Math.min(i + 3, lines.length); j++) { const m = lines[j].match(/([\d.]+)\s*%/); if (m) { pPct = parseFloat(m[1]); break; } }
            for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) { if (lines[j].includes('%')) continue; const n = parseInt(lines[j].replace(/[,.\s]/g, '')); if (n >= 0) { pCant = n; break; } }
        }
        if (line.startsWith('TOTAL')) { const m = line.replace(/[,.\s]/g, '').match(/(\d+)/); if (m) total = parseInt(m[1]); }
    }
    return { cPct, cCant, ePct, eCant, pPct, pCant, total, proc };
};

async function scrapeWithPuppeteer(providedBrowser) {
    let browser = null;
    try {
        browser = providedBrowser || await getBrowser();

        let resumen, actas;
        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                console.log(`Scrape intento ${attempt}/2...`);
                console.log('Scrapeando resumen...');
                resumen = await scrapePage(browser, 'https://resultadosegundavuelta.onpe.gob.pe/main/resumen', RESUMEN_EXTRACTOR);
                console.log('Scrapeando actas...');
                actas = await scrapePage(browser, 'https://resultadosegundavuelta.onpe.gob.pe/main/actas', ACTAS_EXTRACTOR);
                break;
            } catch (e) {
                console.log(`Scrape fallo intento ${attempt}: ${e.message.substring(0, 60)}`);
                const isFatal = e.message.includes('Connection closed') || e.message.includes('Target closed') || e.message.includes('Session closed');
                if (isFatal && browser) {
                    try { await browser.close(); } catch (_) {}
                    browserInstance = null;
                    console.log('Browser recreado tras error fatal');
                    if (attempt < 2) {
                        browser = await getBrowser();
                    }
                }
                if (attempt === 2) throw e;
                await new Promise(r => setTimeout(r, 5000));
            }
        }

        console.log('Resumen:', JSON.stringify(resumen));
        console.log('Actas:', JSON.stringify(actas));

        if (resumen.keikoVotes > 0 || resumen.robertoVotes > 0 || actas.total > 0) {
            return {
                candidate1: { ...CANDIDATES.candidate1, votes: resumen.keikoVotes || 0 },
                candidate2: { ...CANDIDATES.candidate2, votes: resumen.robertoVotes || 0 },
                actasContabilizadas: resumen.actasPorcentaje || actas.cPct || 0,
                actas: {
                    contabilizadas: { porcentaje: actas.cPct, cantidad: actas.cCant },
                    envioJee: { porcentaje: actas.ePct, cantidad: actas.eCant },
                    pendientes: { porcentaje: actas.pPct, cantidad: actas.pCant },
                    procesadas: actas.proc,
                    total: actas.total
                },
                timestamp: new Date().toISOString()
            };
        }

        console.log('Sin datos');
        return null;
    } catch (e) {
        console.error('scrapeWithPuppeteer error:', e.message);
        if (browser) {
            try { await browser.close(); } catch (_) {}
            browserInstance = null;
        }
        throw e;
    }
}

async function fetchONPEData() {
    if (isFetching) {
        const age = fetchStartTime ? (Date.now() - fetchStartTime) / 1000 : 0;
        if (age > 180) {
            console.log('Scrape stale (' + Math.round(age) + 's), reset...');
            isFetching = false;
        } else {
            return cachedData;
        }
    }
    isFetching = true;
    fetchStartTime = Date.now();
    scrapeError = null;

    try {
        let browser = null;
        try {
            browser = await getBrowser();
        } catch (e) {
            console.error('Chrome launch failed:', e.message);
        }

        if (!browser) {
            isFetching = false;
            fetchStartTime = null;
            consecutiveErrors++;
            scrapeError = 'Chrome no disponible';
            return cachedData;
        }

        fetchStartTime = Date.now();

        const result = await Promise.race([
            scrapeWithPuppeteer(browser),
            new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout 120s')), 120000))
        ]);

        lastScrapeDuration = Date.now() - fetchStartTime;

        if (result) {
            cachedData = result;
            lastFetch = new Date();
            consecutiveErrors = 0;
            scrapeError = null;
            console.log('Cache actualizado en ' + lastScrapeDuration + 'ms');
        } else {
            consecutiveErrors++;
            scrapeError = 'Sin datos de ONPE';
        }
        return result || cachedData;
    } catch (error) {
        lastScrapeDuration = Date.now() - fetchStartTime;
        consecutiveErrors++;
        scrapeError = error.message;
        console.error('Error (' + consecutiveErrors + '):', error.message);
        return cachedData;
    } finally {
        isFetching = false;
        fetchStartTime = null;
    }
}

app.get('/api/results', (req, res) => {
    const age = lastFetch ? (Date.now() - lastFetch.getTime()) / 1000 : Infinity;
    const maxAge = 60;

    res.json({
        ...(cachedData || {
            candidate1: { ...CANDIDATES.candidate1, votes: 0 },
            candidate2: { ...CANDIDATES.candidate2, votes: 0 },
            actasContabilizadas: 0,
            actas: { contabilizadas: { porcentaje: 0, cantidad: 0 }, envioJee: { porcentaje: 0, cantidad: 0 }, pendientes: { porcentaje: 0, cantidad: 0 }, procesadas: 0, total: 0 },
            timestamp: null
        }),
        _meta: {
            scrapeDurationMs: lastScrapeDuration,
            cacheAgeMs: lastFetch ? Date.now() - lastFetch.getTime() : null,
            isLive: !isFetching,
            isFetching,
            hasData: cachedData !== null,
            error: scrapeError,
            consecutiveErrors
        }
    });

    if (age > maxAge && !isFetching) {
        fetchONPEData().catch(e => console.error('Background refresh error:', e.message));
    }
});

app.get('/api/candidates', (req, res) => res.json(CANDIDATES));

app.get('/api/status', (req, res) => {
    res.json({
        lastFetch: lastFetch ? lastFetch.toISOString() : null,
        hasData: cachedData !== null,
        isFetching,
        scrapeDurationMs: lastScrapeDuration,
        cacheAgeMs: lastFetch ? Date.now() - lastFetch.getTime() : null,
        error: scrapeError,
        consecutiveErrors
    });
});

app.get('/api/refresh', async (req, res) => {
    if (isFetching && cachedData) {
        return res.json(cachedData);
    }
    const data = await fetchONPEData();
    res.json(data || cachedData || { error: 'No disponible', retry: true });
});

let db = null;
const SOCIAL_DOC = 'social/stats';
let firestoreAvailable = false;

if (Firestore) {
    try {
        db = new Firestore();
        console.log('Firestore inicializado');
    } catch (e) {
        console.log('Firestore no disponible:', e.message);
        db = null;
    }
} else {
    console.log('Firestore no disponible (modulo no cargado)');
}

async function checkFirestore() {
    if (!db) return false;
    try {
        await db.doc(SOCIAL_DOC).get();
        firestoreAvailable = true;
        console.log('Firestore OK');
        return true;
    } catch (e) {
        console.log('Firestore no accesible (modo local)');
        firestoreAvailable = false;
        db = null;
        return false;
    }
}

async function loadSocial() {
    if (!firestoreAvailable) return { views: 0, likes: 0, comments: [] };
    try { const doc = await db.doc(SOCIAL_DOC).get(); if (doc.exists) return doc.data(); }
    catch (e) { console.error('Error loading social:', e.message); }
    return { views: 0, likes: 0, comments: [] };
}

async function saveSocial(data) {
    if (!firestoreAvailable) return;
    try { await db.doc(SOCIAL_DOC).set(data); }
    catch (e) { console.error('Error saving social:', e.message); }
}

app.get('/api/social', async (req, res) => res.json(await loadSocial()));

app.post('/api/social/view', async (req, res) => {
    try {
        if (firestoreAvailable) {
            await db.doc(SOCIAL_DOC).update({ views: db.FieldValue.increment(1) });
            const doc = await db.doc(SOCIAL_DOC).get();
            res.json({ views: doc.data()?.views || 0 });
        } else {
            const data = await loadSocial(); data.views = (data.views || 0) + 1; await saveSocial(data); res.json({ views: data.views });
        }
    } catch (e) { const data = await loadSocial(); data.views = (data.views || 0) + 1; await saveSocial(data); res.json({ views: data.views }); }
});

app.post('/api/social/like', async (req, res) => {
    try {
        if (firestoreAvailable) {
            await db.doc(SOCIAL_DOC).update({ likes: db.FieldValue.increment(1) });
            const doc = await db.doc(SOCIAL_DOC).get();
            res.json({ likes: doc.data()?.likes || 0 });
        } else {
            const data = await loadSocial(); data.likes = (data.likes || 0) + 1; await saveSocial(data); res.json({ likes: data.likes });
        }
    } catch (e) { const data = await loadSocial(); data.likes = (data.likes || 0) + 1; await saveSocial(data); res.json({ likes: data.likes }); }
});

app.post('/api/social/comment', async (req, res) => {
    const { name, text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: 'Comentario vacío' });
    const comment = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7), name: (name || 'Anónimo').trim(), text: text.trim(), date: new Date().toISOString() };
    try {
        if (firestoreAvailable) {
            await db.doc(SOCIAL_DOC).update({ comments: db.FieldValue.arrayUnion(comment) });
            const doc = await db.doc(SOCIAL_DOC).get();
            let comments = doc.data()?.comments || [];
            if (comments.length > 200) { comments = comments.slice(-200); await db.doc(SOCIAL_DOC).update({ comments }); }
            res.json(comment);
        } else {
            const data = await loadSocial(); data.comments.push(comment); if (data.comments.length > 200) data.comments = data.comments.slice(-200); await saveSocial(data); res.json(comment);
        }
    } catch (e) { const data = await loadSocial(); data.comments.push(comment); if (data.comments.length > 200) data.comments = data.comments.slice(-200); await saveSocial(data); res.json(comment); }
});

app.listen(PORT, async () => {
    console.log(`Servidor en http://localhost:${PORT}`);
    
    const fsOk = await checkFirestore();
    if (fsOk) {
        try {
            const doc = await db.doc(SOCIAL_DOC).get();
            if (!doc.exists) await db.doc(SOCIAL_DOC).set({ views: 0, likes: 0, comments: [] });
            const d = doc.exists ? doc.data() : { views: 0, likes: 0, comments: [] };
            console.log(`Social: ${d.views} views, ${d.likes} likes`);
        } catch (e) { console.error('Firestore init:', e.message); }
    } else {
        console.log('Social: modo local (sin Firestore)');
    }

    setTimeout(() => {
        fetchONPEData().then(d => {
            if (d) console.log('Datos iniciales OK');
            else console.log('Sin datos iniciales, se servirá vacío hasta próximo intento');
        });
    }, 2000);
});

setInterval(() => {
    if (isFetching) {
        const age = fetchStartTime ? (Date.now() - fetchStartTime) / 1000 : 0;
        if (age > 180) {
            console.log('Scrape stale reset via interval');
            isFetching = false;
        }
    }
    if (!isFetching) fetchONPEData().catch(() => {});
}, 45000);
