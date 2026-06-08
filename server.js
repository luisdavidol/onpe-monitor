const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

async function fetchONPEData() {
    if (isFetching) {
        console.log('Ya hay una solicitud en curso, esperando...');
        return cachedData;
    }

    isFetching = true;
    let browser = null;

    try {
        console.log('Iniciando Puppeteer...');
        browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        await page.setDefaultNavigationTimeout(45000);

        console.log('Navegando a ONPE...');
        await page.goto('https://resultadosegundavuelta.onpe.gob.pe/main/resumen', {
            waitUntil: 'networkidle2',
            timeout: 45000
        });

        console.log('Esperando datos...');
        await new Promise(resolve => setTimeout(resolve, 8000));

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

        console.log('Datos extraídos:', data);

        if (data.keikoVotes > 0 || data.robertoVotes > 0) {
            cachedData = {
                candidate1: {
                    ...CANDIDATES.candidate1,
                    votes: data.keikoVotes || 0
                },
                candidate2: {
                    ...CANDIDATES.candidate2,
                    votes: data.robertoVotes || 0
                },
                actasContabilizadas: data.actasPorcentaje || 0,
                timestamp: new Date().toISOString()
            };
            lastFetch = new Date();
            console.log('Cache actualizado:', cachedData);
            return cachedData;
        } else {
            console.log('No se encontraron votos');
            return null;
        }

    } catch (error) {
        console.error('Error fetching ONPE data:', error.message);
        if (browser) await browser.close().catch(() => {});
        return null;
    } finally {
        isFetching = false;
    }
}

app.get('/api/results', async (req, res) => {
    console.log('Solicitud a /api/results');

    if (cachedData) {
        const age = lastFetch ? (Date.now() - lastFetch.getTime()) / 1000 : 0;
        console.log(`Sirviendo datos en cache (edad: ${age.toFixed(0)}s)`);
        return res.json(cachedData);
    }

    console.log('No hay cache, obteniendo datos...');
    const data = await fetchONPEData();

    if (data) {
        res.json(data);
    } else {
        res.status(500).json({ error: 'No se pudieron obtener los datos de ONPE' });
    }
});

app.get('/api/candidates', (req, res) => {
    res.json(CANDIDATES);
});

app.get('/api/status', (req, res) => {
    res.json({
        lastFetch: lastFetch ? lastFetch.toISOString() : null,
        hasData: cachedData !== null,
        isFetching: isFetching
    });
});

app.get('/api/refresh', async (req, res) => {
    console.log('Solicitud de refresh manual');
    const data = await fetchONPEData();
    if (data) {
        res.json(data);
    } else {
        res.status(500).json({ error: 'Error al obtener datos' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
    console.log('Iniciando captura de datos en background...');

    setTimeout(() => {
        fetchONPEData().then(data => {
            if (data) {
                console.log('Datos iniciales obtenidos exitosamente');
            } else {
                console.log('No se pudieron obtener datos iniciales');
            }
        });
    }, 1000);
});

setInterval(() => {
    console.log('Actualización programada...');
    fetchONPEData();
}, 60000);