import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// ✅ Trust proxy (important for rateLimit to work correctly)
app.set('trust proxy', 1);

// ✅ Fix __dirname in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ✅ Paths and constants
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');
const SHEETS = {
  DAWA: 'Dawa',
  WATUMIAJI: 'Watumiaji',
  MATUMIZI: 'Matumizi'
};

// ✅ Initialize Excel DB
async function initializeDatabase() {
  await fs.mkdir(dataDir, { recursive: true });

  try {
    await fs.access(excelPath);
    console.log('✅ Excel database exists');
  } catch {
    const workbook = xlsx.utils.book_new();
    Object.values(SHEETS).forEach(sheet =>
      xlsx.utils.book_append_sheet(workbook, xlsx.utils.json_to_sheet([]), sheet)
    );
    xlsx.writeFile(workbook, excelPath);
    console.log('📄 New Excel database created');
  }
}

// ✅ Read Excel sheet
async function readSheet(sheetName) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return [];
    return xlsx.utils.sheet_to_json(sheet);
  } catch (error) {
    console.error(`❌ Failed to read ${sheetName}:`, error);
    return [];
  }
}

// ✅ Write Excel sheet
async function writeSheet(sheetName, data) {
  try {
    const workbook = xlsx.readFile(excelPath);
    const newSheet = xlsx.utils.json_to_sheet(data);
    workbook.Sheets[sheetName] = newSheet;
    xlsx.writeFile(workbook, excelPath);
  } catch (error) {
    console.error(`❌ Failed to write ${sheetName}:`, error);
  }
}

// ✅ Start app
async function startApp() {
  await initializeDatabase();

  app.use(helmet());

  app.use(rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false
  }));

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // =================== ROUTES ==================== //

  app.get('/', async (req, res, next) => {
    try {
      const [dawa, matumizi] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.MATUMIZI)
      ]);

      const ripoti = dawa.map(d => {
        const jumla = matumizi
          .filter(m => m.dawaId === d.id)
          .reduce((sum, m) => sum + Number(m.kiasi || 0), 0);
        return {
          ...d,
          jumlaMatumizi: jumla,
          kilichobaki: (d.kiasi || 0) - jumla
        };
      });

      res.render('dashboard', { dawa: ripoti, error: ripoti.length === 0 ? 'Hakuna data ya dawa kupatikana' : null });
    } catch (err) {
      next(err);
    }
  });

  app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));
  app.post('/dawa/ongeza', async (req, res, next) => {
    try {
      const { jina, aina, kiasi } = req.body;
      if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', { message: 'Tafadhali jaza taarifa zote sahihi' });
      }

      const dawaList = await readSheet(SHEETS.DAWA);
      if (dawaList.some(d => d.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', { message: 'Dawa hiyo tayari ipo' });
      }

      dawaList.push({ id: nanoid(), jina, aina, kiasi: Number(kiasi) });
      await writeSheet(SHEETS.DAWA, dawaList);
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  });

  app.get('/mtumiaji/ongeza', (req, res) => res.render('add-user'));
  app.post('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const jina = req.body.jina?.trim();
      if (!jina) return res.status(400).render('error', { message: 'Jina la mtumiaji linahitajika' });

      const watumiaji = await readSheet(SHEETS.WATUMIAJI);
      if (watumiaji.some(w => w.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', { message: 'Mtumiaji huyu tayari yupo' });
      }

      watumiaji.push({ id: nanoid(), jina });
      await writeSheet(SHEETS.WATUMIAJI, watumiaji);
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  });

  app.get('/matumizi/sajili', async (req, res, next) => {
    try {
      const [dawa, watumiaji] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.WATUMIAJI)
      ]);
      res.render('log-usage', {
        dawa,
        watumiaji,
        error: dawa.length === 0 || watumiaji.length === 0 ? 'Hakuna data ya dawa au watumiaji' : null
      });
    } catch (err) {
      next(err);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
    try {
      const { mtumiajiId, dawaId, kiasi, imethibitishwa } = req.body;
      if (!imethibitishwa || !mtumiajiId || !dawaId || !kiasi || isNaN(kiasi)) {
        return res.status(400).render('error', { message: 'Tafadhali jaza taarifa zote kwa usahihi' });
      }

      const [dawaList, matumizi] = await Promise.all([
        readSheet(SHEETS.DAWA),
        readSheet(SHEETS.MATUMIZI)
      ]);

      const dawa = dawaList.find(d => d.id === dawaId);
      if (!dawa) return res.status(404).render('error', { message: 'Dawa haijapatikana' });

      const used = matumizi.filter(m => m.dawaId === dawaId)
        .reduce((sum, m) => sum + Number(m.kiasi || 0), 0);

      const remaining = dawa.kiasi - used;
      if (remaining < Number(kiasi)) {
        return res.status(400).render('error', { message: `Hakuna dawa ya kutosha. Iliyobaki: ${remaining}` });
      }

      matumizi.push({
        id: nanoid(),
        mtumiajiId,
        dawaId,
        kiasi: Number(kiasi),
        tarehe: new Date().toISOString().split('T')[0]
      });

      await writeSheet(SHEETS.MATUMIZI, matumizi);
      res.redirect('/');
    } catch (err) {
      next(err);
    }
  });

  // 🔴 404 and error
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server error:', err);
    res.status(500).render('error', { message: 'Hitilafu ya seva' });
  });

  // ✅ Start server
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo wa dawa unaendeshwa kwenye http://localhost:${PORT}`);
  });
}

startApp();
