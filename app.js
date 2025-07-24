import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

const SHEETS = {
  DAWA: { name: 'Dawa', headers: ['id', 'jina', 'aina', 'kiasi'] },
  WATUMIAJI: { name: 'Watumiaji', headers: ['id', 'jina',  'maelezo'] },
  MATUMIZI: { name: 'Matumizi', headers: ['id', 'dawaId', 'mtumiajiId', 'mtumiajiJina', 'maelezo', 'kiasi', 'tarehe'] }

};

async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    try {
      await fs.access(excelPath);
      const workbook = xlsx.readFile(excelPath);
      for (const config of Object.values(SHEETS)) {
        if (!workbook.Sheets[config.name]) {
          const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
          xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
        }
      }
      await xlsx.writeFile(workbook, excelPath);
    } catch {
      const workbook = xlsx.utils.book_new();
      for (const config of Object.values(SHEETS)) {
        const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
        xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
      }
      await xlsx.writeFile(workbook, excelPath);
    }
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    throw error;
  }
}

async function readSheet(sheetKey) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[config.name];
    const sheetHeaders = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const headers = sheetHeaders.length > 0 ? sheetHeaders : config.headers;
    return xlsx.utils.sheet_to_json(sheet, { header: headers }).slice(1);
  } catch (error) {
    console.error(`❌ Error reading ${sheetKey}:`, error);
    return [];
  }
}

async function writeSheet(sheetKey, data) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    const worksheet = xlsx.utils.json_to_sheet(
      data.map(item => ({
        ...item,
        tarehe: item.tarehe ? new Date(item.tarehe).toISOString() : ''
      })),
      { header: config.headers }
    );
    workbook.Sheets[config.name] = worksheet;
    await xlsx.writeFile(workbook, excelPath);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetKey}:`, error);
    return false;
  }
}

async function startApp() {
  await initializeDatabase();

  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(express.static(path.join(__dirname, 'public')));

  app.get('/', async (req, res, next) => {
    try {
      const [dawa, matumizi] = await Promise.all([
        readSheet('DAWA'),
        readSheet('MATUMIZI')
      ]);

      const ripoti = dawa.map(medicine => {
        const totalUsed = matumizi
          .filter(usage => usage.dawaId === medicine.id)
          .reduce((sum, usage) => sum + (Number(usage.kiasi) || 0), 0);
        return {
          ...medicine,
          jumlaMatumizi: totalUsed,
          kilichobaki: (Number(medicine.kiasi) || 0) - totalUsed
        };
      });

      res.render('dashboard', {
        dawa: ripoti,
        error: ripoti.length === 0 ? 'Hakuna data ya dawa kupatikana' : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/dawa/ongeza', (req, res) => {
    res.render('add-medicine');
  });

  app.get('/mtumiaji/ongeza', (req, res) => {
    res.render('add-user');
  });

  app.get('/matumizi/sajili', async (req, res, next) => {
    try {
      const [dawa, watumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      res.render('log-usage', { dawa, watumiaji });
    } catch (error) {
      next(error);
    }
  });

  app.post('/dawa/ongeza', async (req, res, next) => {
    try {
      const { jina, aina, kiasi } = req.body;
      if (!jina || !aina || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', {
          message: 'Tafadhali jaza taarifa zote sahihi'
        });
      }

      const dawa = await readSheet('DAWA');
      if (dawa.some(d => d.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', {
          message: 'Dawa yenye jina hili tayari ipo'
        });
      }

      const newMedicine = {
        id: nanoid(),
        jina,
        aina,
        kiasi: Number(kiasi)
      };

      await writeSheet('DAWA', [...dawa, newMedicine]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.post('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const { jina, description} = req.body;
      if (!jina || jina.trim().length < 2) {
        return res.status(400).render('error', {
          message: 'Jina la mtumiaji linahitajika'
        });
      }

      const watumiaji = await readSheet('WATUMIAJI');
      const newUser = { id: nanoid(), jina: jina.trim(), maelezo: description?.trim() || '' };
      await writeSheet('WATUMIAJI', [...watumiaji, newUser]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
  try {
    const { mtumiajiId, dawaList } = req.body;

    if (!mtumiajiId || !dawaList) {
      return res.status(400).render('error', {
        message: 'Tafadhali chagua mtumiaji na angalau dawa moja.'
      });
    }

    const dawaArray = Array.isArray(dawaList)
      ? dawaList
      : Object.values(dawaList);

    const confirmedDawa = dawaArray.filter(d => d.confirmed === 'true');

    if (confirmedDawa.length === 0) {
      const [dawa, watumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      return res.render('log-usage', {
        dawa,
        watumiaji,
        error: 'Hakuna dawa zilizo thibitishwa kutolewa. Tafadhali chagua angalau dawa moja.'
      });
    }

    const watumiaji = await readSheet('WATUMIAJI');
    const mtumiaji = watumiaji.find(w => w.id === mtumiajiId);

    const matumizi = confirmedDawa.map(d => ({
      id: nanoid(),
      mtumiajiId,
      mtumiajiJina: mtumiaji?.jina || '',
      maelezo: mtumiaji?.maelezo || '',
      dawaId: d.id,
      kiasi: parseInt(d.kiasi, 10) || 0,
      tarehe: d.tarehe || new Date().toISOString()
    }));

    const existingMatumizi = await readSheet('MATUMIZI');
    await writeSheet('MATUMIZI', [...existingMatumizi, ...matumizi]);

    return res.redirect('/ripoti/matumizi');
  } catch (error) {
    next(error);
  }
});



  app.get('/ripoti/matumizi', async (req, res, next) => {
  try {
    const { mode, from, to } = req.query;
    const [watumiaji, dawa, matumizi] = await Promise.all([
      readSheet('WATUMIAJI'),
      readSheet('DAWA'),
      readSheet('MATUMIZI')
    ]);

    const now = new Date();
    let startDate = null;
    let endDate = null;

    if (mode === 'week') {
      const day = now.getDay();
      startDate = new Date(now);
      startDate.setDate(now.getDate() - day);
      startDate.setHours(0, 0, 0, 0);
    } else if (mode === 'month') {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
    } else if (from && to) {
      startDate = new Date(from);
      endDate = new Date(to);
      endDate.setHours(23, 59, 59, 999);
    }

    const filteredMatumizi = startDate
      ? matumizi.filter(m => {
          const t = new Date(m.tarehe);
          return t >= startDate && (!endDate || t <= endDate);
        })
      : matumizi;

    function formatDate(dateStr) {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return 'Tarehe haijulikani';
      return date.toLocaleDateString('sw-TZ', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Africa/Nairobi'
      });
    }

    function formatTime(dateStr) {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '--:--';
      return date.toLocaleTimeString('sw-TZ', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Africa/Nairobi'
      });
    }

    const report = watumiaji.map(user => {
      const userUsages = filteredMatumizi.filter(m => m.mtumiajiId === user.id);
      const byDate = {};

      userUsages.forEach(usage => {
        const day = formatDate(usage.tarehe);
        if (!byDate[day]) byDate[day] = [];

        const medicine = dawa.find(d => d.id === usage.dawaId);
        const formattedTime = formatTime(usage.tarehe);

        byDate[day].push({
          dawa: medicine ? medicine.jina : 'Haijulikani',
          kiasi: usage.kiasi,
          saa: formattedTime
        });
      });

      return {
        jina: user.jina,
        matumiziByDate: byDate
      };
    });

    res.render('report-usage', {
      report,
      mode,
      from,
      to,
      query: {
        aina: mode,
        start: from,
        end: to
      }
    });
  } catch (error) {
    next(error);
  }
});


  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err);
    res.status(500).render('error', {
      message: 'Kuna tatizo la seva. Tafadhali jaribu tena baadaye.'
    });
  });

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo unatumika kwenye http://localhost:${PORT}`);
  });
}

startApp().catch(error => {
  console.error('💥 Failed to start application:', error);
  process.exit(1);
});
