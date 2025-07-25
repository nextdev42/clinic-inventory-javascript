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
      let workbookModified = false;
      for (const config of Object.values(SHEETS)) {
        if (!workbook.Sheets[config.name]) {
          const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
          xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
          workbookModified = true;
        }
      }
      if (workbookModified) {
        await xlsx.writeFile(workbook, excelPath);
      }
    } catch (e) {
      // If file doesn't exist, create it
      if (e.code === 'ENOENT') {
        const workbook = xlsx.utils.book_new();
        for (const config of Object.values(SHEETS)) {
          const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
          xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
        }
        await xlsx.writeFile(workbook, excelPath);
      } else {
        throw e; // Re-throw other errors
      }
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
        console.warn(`Sheet '${config.name}' not found in workbook. Returning empty array.`);
        return [];
    }
    // Read all rows, then check if the first row is actually headers
    const rawData = xlsx.utils.sheet_to_json(sheet, { header: 1 });
    if (!rawData || rawData.length === 0) {
        return []; // Empty sheet
    }
    
    const sheetHeaders = rawData[0];
    // If the sheet headers don't match the expected headers, assume first row is data
    // This part is tricky; simpler to just use fixed headers for safety or validate strictly.
    // For simplicity, let's use the defined headers for parsing after the first row.
    return xlsx.utils.sheet_to_json(sheet, { header: config.headers, range: 1 }); // Skip header row
  } catch (error) {
    console.error(`❌ Error reading ${sheetKey}:`, error);
    return [];
  }
}

async function writeSheet(sheetKey, data) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);

    // Convert data to match headers explicitly, ensuring 'tarehe' is ISO string
    const dataToWrite = data.map(item => {
        const newItem = {};
        config.headers.forEach(header => {
            if (header === 'tarehe' && item.tarehe) {
                newItem[header] = new Date(item.tarehe).toISOString();
            } else {
                newItem[header] = item[header] !== undefined ? item[header] : null;
            }
        });
        return newItem;
    });

    const worksheet = xlsx.utils.json_to_sheet(dataToWrite, { header: config.headers });
    workbook.Sheets[config.name] = worksheet;
    await xlsx.writeFile(workbook, excelPath);
    return true;
  } catch (error) {
    console.error(`❌ Error writing ${sheetKey}:`, error);
    return false;
  }
}

async function appendSheet(sheetKey, newData) {
  try {
    const config = SHEETS[sheetKey];
    const workbook = xlsx.readFile(excelPath);
    const sheet = workbook.Sheets[config.name];

    // Read existing data skipping the header row
    const existingData = xlsx.utils.sheet_to_json(sheet, { header: config.headers, range: 1 });

    // Ensure newData items have correct 'tarehe' format and match headers
    const formattedNewData = newData.map(item => {
        const newItem = {};
        config.headers.forEach(header => {
            if (header === 'tarehe' && item.tarehe) {
                newItem[header] = new Date(item.tarehe).toISOString();
            } else {
                newItem[header] = item[header] !== undefined ? item[header] : null;
            }
        });
        return newItem;
    });

    // Combine existing data with new data
    const combined = [...existingData, ...formattedNewData];

    // Create a new worksheet with headers
    const newSheet = xlsx.utils.json_to_sheet(combined, { header: config.headers });

    workbook.Sheets[config.name] = newSheet;

    await xlsx.writeFile(workbook, excelPath);

    return true;
  } catch (error) {
    console.error(`❌ Error appending to sheet ${sheetKey}:`, error);
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
      res.render('log-usage', { dawa, watumiaji, error: null, mtumiajiId: null });

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
      if (watumiaji.some(w => w.jina?.toLowerCase() === jina.trim().toLowerCase())) {
        return res.status(400).render('error', {
          message: 'Tayari kuna mtumiaji mwenye jina hili.'
        });
      }

      const newUser = { id: nanoid(), jina: jina.trim(), maelezo: description?.trim() || '' };
      await writeSheet('WATUMIAJI', [...watumiaji, newUser]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
    try {
      // The `mtumiajiId` is sent directly from the select element's name
      const { mtumiajiId, dawaList = [] } = req.body;

      if (!mtumiajiId) {
        const [dawa, watumiaji] = await Promise.all([
          readSheet('DAWA'),
          readSheet('WATUMIAJI')
        ]);
        return res.render('log-usage', {
          dawa,
          watumiaji,
          error: "Tafadhali chagua mtumiaji.",
          mtumiajiId: null // Keep null as no user was truly selected
        });
      }

      const [watumiaji, allDawa] = await Promise.all([
        readSheet('WATUMIAJI'),
        readSheet('DAWA')
      ]);

      // Find the selected user object
      const mtumiajiObj = watumiaji.find(w => w.id === mtumiajiId);
      if (!mtumiajiObj) {
        const [dawa, users] = await Promise.all([
            readSheet('DAWA'),
            readSheet('WATUMIAJI')
        ]);
        return res.status(400).render('log-usage', {
            dawa, users,
            error: "Mtumiaji aliyechaguliwa hajapatikana.",
            mtumiajiId: mtumiajiId // Pass back the ID to keep selection if possible
        });
      }

      const newUsages = [];
      const updatedDawaQuantities = {}; // To track updated quantities for dawa

      // Process selected medicines
      for (const item of dawaList) {
        // Only process if the checkbox was checked
        if (item.confirmed === 'true') {
          const dawaId = item.id;
          const kiasi = parseInt(item.kiasi);

          const dawaFound = allDawa.find(d => d.id === dawaId);

          if (!dawaFound || isNaN(kiasi) || kiasi <= 0 || kiasi > dawaFound.kiasi) {
            // If any selected medicine has invalid quantity or doesn't exist,
            // return an error. You might want to be more specific here.
            const [dawa, users] = await Promise.all([
              readSheet('DAWA'),
              readSheet('WATUMIAJI')
            ]);
            return res.status(400).render('log-usage', {
              dawa, users,
              error: "Kiasi cha dawa kilichochaguliwa si sahihi au hakitoshi.",
              mtumiajiId: mtumiajiId // Keep selected user in form
            });
          }

          newUsages.push({
            id: nanoid(),
            dawaId: dawaFound.id,
            mtumiajiId: mtumiajiObj.id,
            mtumiajiJina: mtumiajiObj.jina,
            maelezo: mtumiajiObj.maelezo || '',
            kiasi: kiasi,
            tarehe: new Date().toISOString()
          });

          // Update the quantity for the medicine
          updatedDawaQuantities[dawaFound.id] = (updatedDawaQuantities[dawaFound.id] || dawaFound.kiasi) - kiasi;
        }
      }

      if (newUsages.length === 0) {
        const [dawa, users] = await Promise.all([
          readSheet('DAWA'),
          readSheet('WATUMIAJI')
        ]);
        return res.status(400).render('log-usage', {
          dawa, users,
          error: "Tafadhali chagua angalau dawa moja na uweke kiasi sahihi.",
          mtumiajiId: mtumiajiId // Keep selected user in form
        });
      }

      // 1. Append new usages to MATUMIZI sheet
      const usageSuccess = await appendSheet('MATUMIZI', newUsages);
      if (!usageSuccess) {
        return res.status(500).render('error', { message: 'Tatizo limejitokeza kuandika matumizi.' });
      }

      // 2. Update DAWA quantities
      const updatedAllDawa = allDawa.map(dawaItem => {
          if (updatedDawaQuantities.hasOwnProperty(dawaItem.id)) {
              return { ...dawaItem, kiasi: updatedDawaQuantities[dawaItem.id] };
          }
          return dawaItem;
      });

      const dawaUpdateSuccess = await writeSheet('DAWA', updatedAllDawa);
      if (!dawaUpdateSuccess) {
          // This is a critical error as usage was logged but stock not updated.
          // In a real system, you'd want a transaction or rollback.
          console.error('CRITICAL ERROR: Matumizi logged but Dawa stock not updated!');
          return res.status(500).render('error', { message: 'Matumizi yamehifadhiwa, lakini kulikuwa na tatizo la kusasisha stoo ya dawa. Tafadhali wasiliana na msimamizi.' });
      }

      res.redirect('/ripoti/matumizi');

    } catch (err) {
      console.error('❌ Error in /matumizi/sajili POST:', err);
      next(err);
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
            // Ensure tarehe is a valid date string
            if (!m.tarehe || isNaN(new Date(m.tarehe).getTime())) {
                console.warn(`Invalid date format for usage ID ${m.id}: ${m.tarehe}`);
                return false; // Exclude invalid dates
            }
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
          timeZone: 'Africa/Nairobi' // Keep timezone consistent
        });
      }

      function formatTime(dateStr) {
        const date = new Date(dateStr);
        if (isNaN(date.getTime())) return '--:--';
        return date.toLocaleTimeString('sw-TZ', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Africa/Nairobi' // Keep timezone consistent
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
            dawa: medicine ? medicine.jina : 'Dawa haijulikani', // More descriptive
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

  app.get('/admin/maelezo-dump', async (req, res, next) => {
    try {
      const watumiaji = await readSheet('WATUMIAJI');
      const dump = watumiaji.map(u => ({
        jina: u.jina,
        maelezo: u.maelezo || '[hakuna]',
        length: (u.maelezo || '').length
      }));

      res.render('maelezo-dump', { dump });
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
