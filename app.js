import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

const app = express();

// ========== CONFIGURATION ========== //
app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

// Sheet configuration with headers
const SHEETS = {
  DAWA: {
    name: 'Dawa',
    headers: ['id', 'jina', 'aina', 'kiasi']
  },
  WATUMIAJI: {
    name: 'Watumiaji',
    headers: ['id', 'jina']
  },
  MATUMIZI: {
    name: 'Matumizi',
    headers: ['id', 'dawaId', 'mtumiajiId', 'kiasi', 'tarehe']
  }
};

// ========== DATABASE FUNCTIONS ========== //
async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });

    try {
      await fs.access(excelPath);
      console.log('✅ Database file exists');
      
      // Verify all sheets exist with correct headers
      const workbook = xlsx.readFile(excelPath);
      for (const [key, config] of Object.entries(SHEETS)) {
        if (!workbook.Sheets[config.name]) {
          throw new Error(`Missing sheet: ${config.name}`);
        }
        
        // Verify headers
        const sheet = workbook.Sheets[config.name];
        const sheetHeaders = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
        
        if (sheetHeaders.length === 0) {
          console.warn(`Sheet ${config.name} has no headers, recreating...`);
          const newSheet = xlsx.utils.json_to_sheet([{}], { header: config.headers });
          workbook.Sheets[config.name] = newSheet;
          await xlsx.writeFile(workbook, excelPath);
        }
      }
    } catch (error) {
      console.log('Initializing new database file...');
      const workbook = xlsx.utils.book_new();
      
      // Create each sheet with proper headers
      for (const [key, config] of Object.entries(SHEETS)) {
        const worksheet = xlsx.utils.json_to_sheet([{}], { header: config.headers });
        xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
      }
      
      await xlsx.writeFile(workbook, excelPath);
      console.log('📄 Created new database with all sheets');
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
    
    if (!sheet) {
      console.warn(`Sheet ${config.name} not found`);
      return [];
    }
    
    // Get headers from sheet or use configured ones
    const sheetHeaders = xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
    const headers = sheetHeaders.length > 0 ? sheetHeaders : config.headers;
    
    // Convert to JSON with proper headers
    const data = xlsx.utils.sheet_to_json(sheet, { header: headers });
    
    console.log(`Read ${data.length} records from ${config.name}`);
    return data;
  } catch (error) {
    console.error(`❌ Error reading ${sheetKey}:`, error);
    return [];
  }
}

async function writeSheet(sheetKey, data) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    
    // Get existing headers or use configured ones
    const sheet = workbook.Sheets[config.name];
    const sheetHeaders = sheet ? (xlsx.utils.sheet_to_json(sheet, { header: 1 })[0] || [] : [];
    const headers = sheetHeaders.length > 0 ? sheetHeaders : config.headers;
    
    // Create new worksheet with headers
    const worksheet = xlsx.utils.json_to_sheet(data, { header: headers });
    workbook.Sheets[config.name] = worksheet;
    
    await xlsx.writeFile(workbook, excelPath);
    console.log(`📝 Updated ${config.name} with ${data.length} records`);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetKey}:`, error);
    return false;
  }
}

// ========== APPLICATION SETUP ========== //
async function startApp() {
  await initializeDatabase();

  // Middleware
  app.use(helmet());
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.static(path.join(__dirname, 'public')));

  // ========== ROUTES ========== //

  // Dashboard
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
          kilichobaki: (Number(medicine.kiasi) || 0 - totalUsed
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

  // Add Medicine
  app.get('/dawa/ongeza', (req, res) => res.render('add-medicine'));
  app.post('/dawa/ongeza', async (req, res, next) => {
    try {
      const { jina, aina, kiasi } = req.body;
      
      // Validation
      if (!jina || !aina || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', { 
          message: 'Tafadhali jaza taarifa zote sahihi' 
        });
      }

      const dawa = await readSheet('DAWA');
      
      // Check for duplicates
      if (dawa.some(d => d.jina?.toLowerCase() === jina.toLowerCase())) {
        return res.status(400).render('error', { 
          message: 'Dawa yenye jina hili tayari ipo' 
        });
      }

      // Add new medicine
      const newMedicine = {
        id: nanoid(),
        jina,
        aina,
        kiasi: Number(kiasi)
      };

      const success = await writeSheet('DAWA', [...dawa, newMedicine]);
      
      if (!success) {
        throw new Error('Failed to save medicine');
      }

      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // Add User
  app.get('/mtumiaji/ongeza', (req, res) => res.render('add-user'));
  app.post('/mtumiaji/ongeza', async (req, res, next) => {
    try {
      const { jina } = req.body;
      
      if (!jina || jina.trim().length < 2) {
        return res.status(400).render('error', {
          message: 'Jina la mtumiaji linahitajika'
        });
      }

      const watumiaji = await readSheet('WATUMIAJI');
      const newUser = { 
        id: nanoid(), 
        jina: jina.trim() 
      };

      await writeSheet('WATUMIAJI', [...watumiaji, newUser]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // Log Usage
  app.get('/matumizi/sajili', async (req, res, next) => {
    try {
      const [dawa, watumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      
      res.render('log-usage', { 
        dawa, 
        watumiaji,
        error: dawa.length === 0 ? 'Hakuna dawa zilizosajiliwa' : 
              watumiaji.length === 0 ? 'Hakuna watumiaji waliosajiliwa' : null
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
    try {
      const { dawaId, mtumiajiId, kiasi } = req.body;
      const tarehe = new Date().toISOString().split('T')[0];

      // Validation
      if (!dawaId || !mtumiajiId || !kiasi || isNaN(kiasi) || Number(kiasi) <= 0) {
        return res.status(400).render('error', {
          message: 'Tafadhali jaza taarifa zote kwa usahihi'
        });
      }

      const [dawaList, matumizi] = await Promise.all([
        readSheet('DAWA'),
        readSheet('MATUMIZI')
      ]);

      // Check medicine exists
      const dawa = dawaList.find(d => d.id === dawaId);
      if (!dawa) {
        return res.status(404).render('error', {
          message: 'Dawa hiyo haipo kwenye mfumo'
        });
      }

      // Calculate remaining quantity
      const used = matumizi
        .filter(m => m.dawaId === dawaId)
        .reduce((sum, m) => sum + (Number(m.kiasi) || 0, 0);
      
      const remaining = (dawa.kiasi || 0) - used;
      
      if (remaining < Number(kiasi)) {
        return res.status(400).render('error', {
          message: `Kiasi kilichobaki (${remaining}) hakitoshi`
        });
      }

      // Record usage
      const newUsage = {
        id: nanoid(),
        dawaId,
        mtumiajiId,
        kiasi: Number(kiasi),
        tarehe
      };

      await writeSheet('MATUMIZI', [...matumizi, newUsage]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  // ========== ADMIN ROUTES ========== //
  app.get('/admin/headers-check', async (req, res) => {
    try {
      const workbook = xlsx.readFile(excelPath);
      const results = Object.entries(SHEETS).map(([key, config]) => {
        const sheet = workbook.Sheets[config.name];
        const raw = sheet ? xlsx.utils.sheet_to_json(sheet, { header: 1 }) : [];
        
        return {
          sheet: config.name,
          expectedHeaders: config.headers,
          actualHeaders: raw[0] || [],
          recordCount: raw.length - 1,
          status: raw[0]?.length === config.headers.length ? '✅' : '❌'
        };
      });

      res.render('headers-check', { results });
    } catch (error) {
      console.error('❌ Sheet header check failed:', error);
      res.status(500).render('error', { message: 'Hitilafu katika ukaguzi wa headers' });
    }
  });

  app.get('/admin/sheet-dump', async (req, res) => {
  try {
    const [dawa, matumizi, watumiaji] = await Promise.all([
      readSheet(SHEETS.DAWA),
      readSheet(SHEETS.MATUMIZI),
      readSheet(SHEETS.WATUMIAJI)
    ]);

    res.render('sheet-dump', { dawa, matumizi, watumiaji });
  } catch (error) {
    console.error('❌ Sheet dump failed:', error);
    res.status(500).render('error', { message: 'Hitilafu katika kusoma data zote' });
  }
});


  // ========== ERROR HANDLERS ========== //
  app.use((req, res) => {
    res.status(404).render('error', { message: 'Ukurasa haupatikani' });
  });

  app.use((err, req, res, next) => {
    console.error('🔥 Server Error:', err);
    res.status(500).render('error', { 
      message: 'Kuna tatizo la seva. Tafadhali jaribu tena baadaye.' 
    });
  });

  // ========== START SERVER ========== //
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Mfumo unatumika kwenye http://localhost:${PORT}`);
  });
}

startApp().catch(error => {
  console.error('💥 Failed to start application:', error);
  process.exit(1);
});
