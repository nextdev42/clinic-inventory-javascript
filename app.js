import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { nanoid } from 'nanoid';
import { promises as fs } from 'fs';
import xlsx from 'xlsx';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import moment from 'moment';

const app = express();

app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: 'siri-yako-hapa',
  resave: false,
  saveUninitialized: true,
  cookie: { secure: false } // secure:true kwa HTTPS
}));

app.set('trust proxy', 1);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.join(__dirname, 'data');
const excelPath = path.join(dataDir, 'database.xlsx');

const SHEETS = {
  DAWA: { name: 'Dawa', headers: ['id', 'jina', 'aina', 'kiasi', 'tarehe', 'UPDATED_AT'] },
  WATUMIAJI: { name: 'Watumiaji', headers: ['id', 'jina',  'maelezo', 'clinicId'] }, // *** clinicId added ***
  MATUMIZI: { name: 'Matumizi', headers: ['id', 'dawaId', 'mtumiajiId', 'mtumiajiJina', 'maelezo', 'kiasi', 'tarehe', 'clinicId'] }, // *** clinicId added ***
  CLINICS: { name: 'Clinics', headers: ['id', 'jina'] } // *** new Clinics sheet ***
};

async function initializeDatabase() {
  try {
    await fs.mkdir(dataDir, { recursive: true });
    let workbook;
    try {
      await fs.access(excelPath);
      workbook = xlsx.readFile(excelPath);
      for (const config of Object.values(SHEETS)) {
        if (!workbook.Sheets[config.name]) {
          const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
          xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
        }
      }
    } catch {
      workbook = xlsx.utils.book_new();
      for (const config of Object.values(SHEETS)) {
        const worksheet = xlsx.utils.aoa_to_sheet([config.headers]);
        xlsx.utils.book_append_sheet(workbook, worksheet, config.name);
      }
    }

    // *** Add default clinics if none exist ***
    const clinicsSheet = workbook.Sheets[SHEETS.CLINICS.name];
    const clinicsData = clinicsSheet ? xlsx.utils.sheet_to_json(clinicsSheet) : [];
    if (!clinicsData.length) {
      const defaultClinics = [
        { id: 'C001', jina: 'Kisiwani' },
        { id: 'C002', jina: 'Mikwambe' },
        { id: 'C003', jina: 'Kibada' },
        { id: 'C004', jina: 'Jirambe' }
      ];
      const ws = xlsx.utils.json_to_sheet(defaultClinics, { header: SHEETS.CLINICS.headers });
      workbook.Sheets[SHEETS.CLINICS.name] = ws;
    }

    await xlsx.writeFile(workbook, excelPath);
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
        // force lowercase keys
        id: item.id || '',
        jina: item.jina || item.JINA || '',
        aina: item.aina || item.AINA || '',
        kiasi: item.kiasi || item.KIASI || '',
        tarehe: item.tarehe ? new Date(item.tarehe).toISOString() : '',
        UPDATED_AT: item.UPDATED_AT || new Date().toISOString()
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
      const clinicId = 'C001'; 
      const [dawa, watumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      const filteredWatumiaji = watumiaji.filter(u => u.clinicId === clinicId);
      res.render('log-usage', { dawa, watumiaji: filteredWatumiaji, error: null, mtumiajiId: null });

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
      if (watumiaji.some(w => w.jina.toLowerCase() === jina.trim().toLowerCase())) {
        return res.status(400).render('error', {
          message: 'Tayari kuna mtumiaji mwenye jina hili.'
        });
      }

      const newUser = { id: nanoid(), jina: jina.trim(), maelezo: description?.trim() || '',  clinicId: 'C001' };
      await writeSheet('WATUMIAJI', [...watumiaji, newUser]);
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  app.post('/matumizi/sajili', async (req, res, next) => {
  try {
    const { mtumiajiId, dawaList } = req.body;

    if (!mtumiajiId) {
      return res.status(400).render('error', {
        message: 'Tafadhali chagua mtumiaji.'
      });
    }

    if (!dawaList) {
      return res.status(400).render('error', {
        message: 'Tafadhali chagua angalau dawa moja.'
      });
    }

    const dawaArray = Array.isArray(dawaList) 
      ? dawaList 
      : Object.values(dawaList);

    const confirmedDawa = [];
    const errors = [];

    for (const d of dawaArray) {
      if (d.confirmed !== 'true') continue;

      const quantity = parseInt(d.kiasi, 10);
      if (isNaN(quantity)) {
        errors.push(`Kiasi cha ${d.id} si namba halali`);
        continue;
      }

      if (quantity <= 0) {
        errors.push(`Kiasi cha ${d.id} kinaweza kuwa chini ya 1`);
        continue;
      }

      confirmedDawa.push({
        ...d,
        kiasi: quantity
      });
    }

    if (errors.length > 0) {
      return res.status(400).render('error', {
        message: `Hitilafu katika kiasi: ${errors.join(', ')}`
      });
    }

    if (confirmedDawa.length === 0) {
      const [dawa, watumiaji] = await Promise.all([
        readSheet('DAWA'),
        readSheet('WATUMIAJI')
      ]);
      return res.render('log-usage', {
        dawa,
        watumiaji,
        error: 'Hakuna dawa zilizothibitishwa kutolewa. Tafadhali chagua angalau dawa moja.',
        mtumiajiId
      });
    }

    const [allDawa, watumiaji, existingMatumizi] = await Promise.all([
      readSheet('DAWA'),
      readSheet('WATUMIAJI'),
      readSheet('MATUMIZI')
    ]);

    const stockChecks = [];
    const validUsages = [];

    for (const d of confirmedDawa) {
      const medicine = allDawa.find(m => m.id === d.id);

      if (!medicine) {
        stockChecks.push(`Dawa ya ${d.id} haipo kwenye mfumo`);
        continue;
      }

      const totalUsed = existingMatumizi
        .filter(m => m.dawaId === d.id)
        .reduce((sum, m) => sum + (Number(m.kiasi) || 0), 0);

      const remainingStock = (Number(medicine.kiasi) || 0) - totalUsed;

      if (d.kiasi > remainingStock) {
        stockChecks.push(`Dawa ya ${medicine.jina} inabaki ${remainingStock} pekee`);
        continue;
      }

      validUsages.push(d);
    }

    if (stockChecks.length > 0) {
      return res.status(400).render('error', {
        message: `Hitilafu ya hisa: ${stockChecks.join(', ')}`
      });
    }

    const mtumiaji = watumiaji.find(w => w.id === mtumiajiId);
    if (!mtumiaji) {
      return res.status(400).render('error', {
        message: 'Mtumiaji aliyechaguliwa hayupo kwenye mfumo'
      });
    }

    const newMatumizi = validUsages.map(d => ({
      id: nanoid(),
      mtumiajiId,
      mtumiajiJina: mtumiaji.jina,
      maelezo: mtumiaji.maelezo || '',
      dawaId: d.id,
      kiasi: d.kiasi,
      tarehe: d.tarehe || new Date().toISOString()
    }));

    await writeSheet('MATUMIZI', [...existingMatumizi, ...newMatumizi]);
    return res.redirect('/ripoti/matumizi');

  } catch (error) {
    next(error);
  }
});

  app.get('/mtumiaji/transfer', async (req, res, next) => {
  try {
    const [watumiaji, clinics] = await Promise.all([
      readSheet('WATUMIAJI'),
      readSheet('CLINICS')
    ]);

    // Fetch session messages
    const successMessage = req.session.successMessage;
    const errorMessage = req.session.errorMessage;

    // Clear session messages after reading
    delete req.session.successMessage;
    delete req.session.errorMessage;

    // ✅ Pass both successMessage and errorMessage
    res.render('transfer-user', { watumiaji, clinics, successMessage, errorMessage });

  } catch (error) {
    next(error);
  }
});



app.post('/mtumiaji/transfer', async (req, res, next) => {
  try {
    const { userId, newClinic } = req.body;
    
    // Validate inputs
    if (!userId || !newClinic) {
      return res.status(400).render('error', {
        message: 'Tafadhali chagua mtumiaji na kliniki mpya'
      });
    }

    // Read current data
    const [watumiaji, clinics] = await Promise.all([
      readSheet('WATUMIAJI'),
      readSheet('CLINICS')
    ]);

    // Verify clinic exists
    const clinicExists = clinics.some(c => c.id === newClinic);
    if (!clinicExists) {
      return res.status(400).render('error', {
        message: 'Kliniki iliyochaguliwa haipo kwenye mfumo'
      });
    }

    // Find and update user
    const userIndex = watumiaji.findIndex(u => u.id === userId);
    if (userIndex === -1) {
      return res.status(404).render('error', {
        message: 'Mtumiaji aliyechaguliwa hayupo kwenye mfumo'
      });
    }

    // Create updated array
    const updatedWatumiaji = [...watumiaji];
    updatedWatumiaji[userIndex] = {
      ...updatedWatumiaji[userIndex],
      clinicId: newClinic
    };

    // Write back to sheet
    const writeSuccess = await writeSheet('WATUMIAJI', updatedWatumiaji);
    if (!writeSuccess) {
      throw new Error('Failed to save changes to Excel file');
    }

    // Verify the change was saved
    const verifyData = await readSheet('WATUMIAJI');
    const updatedUser = verifyData.find(u => u.id === userId);
    
    if (!updatedUser || updatedUser.clinicId !== newClinic) {
      throw new Error('Verification failed - change not persisted');
    }

    // Redirect with success message
    req.session.successMessage = 'Mtumiaji amehamishwa kwa mafanikio!';
    res.redirect('/mtumiaji/transfer');

  } catch (error) {
    console.error('Transfer error:', error);
    next(error);
  }
});

      
    
app.get('/ripoti/matumizi', async (req, res, next) => {
  try {
    const { mode, from, to, tarehe, mtumiajiId } = req.query;
    const [watumiaji, dawa, matumizi] = await Promise.all([
      readSheet('WATUMIAJI'),
      readSheet('DAWA'),
      readSheet('MATUMIZI')
    ]);

    let startDate = null;
    let endDate = null;

    // Convert tarehe/from/to to Date objects if available
    const tareheDate = tarehe ? new Date(tarehe) : null;
    const fromDate = from ? new Date(from) : null;
    const toDate = to ? new Date(to) : null;

    if (mode === 'day' && tareheDate) {
      startDate = new Date(tareheDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(tareheDate);
      endDate.setHours(23, 59, 59, 999);
    } else if (mode === 'week' && tareheDate) {
      const day = tareheDate.getDay(); // 0 = Sunday
      const diffToMonday = day === 0 ? 6 : day - 1;
      startDate = new Date(tareheDate);
      startDate.setDate(tareheDate.getDate() - diffToMonday);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(startDate);
      endDate.setDate(startDate.getDate() + 6);
      endDate.setHours(23, 59, 59, 999);
    } else if (mode === 'month' && tareheDate) {
      startDate = new Date(tareheDate.getFullYear(), tareheDate.getMonth(), 1);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(tareheDate.getFullYear(), tareheDate.getMonth() + 1, 0);
      endDate.setHours(23, 59, 59, 999);
    } else if (fromDate && toDate) {
      startDate = new Date(fromDate);
      startDate.setHours(0, 0, 0, 0);
      endDate = new Date(toDate);
      endDate.setHours(23, 59, 59, 999);
    }

    // Filter matumizi by date range
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

    // First get all users who have consumption records in the filtered period
    const usersWithConsumption = new Set(
      filteredMatumizi.map(m => m.mtumiajiId)
    );

    // Only process users who have actual consumption
    const report = watumiaji
      .filter(user => usersWithConsumption.has(user.id))
      .map(user => {
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

    // Report title
    let reportTitle = 'Ripoti ya Matumizi';

    if (mode === 'day' && tareheDate) {
      reportTitle = `Ripoti ya Siku: ${formatDate(tareheDate)}`;
    } else if (mode === 'week' && startDate && endDate) {
      reportTitle = `Ripoti ya Wiki: ${formatDate(startDate)} - ${formatDate(endDate)}`;
    } else if (mode === 'month' && tareheDate) {
      const mwezi = tareheDate.toLocaleDateString('sw-TZ', { month: 'long', year: 'numeric' });
      reportTitle = `Ripoti ya Mwezi: ${mwezi}`;
    } else if (fromDate && toDate) {
      reportTitle = `Ripoti ya Kuanzia ${formatDate(fromDate)} hadi ${formatDate(toDate)}`;
    }

    res.render('report-usage', {
      report,
      mode,
      from,
      to,
      tarehe,
      reportTitle,
      query: { aina: mode, start: from, end: to },
      watumiaji,
      mtumiajiId,
      dawa,
      error: null
    });
  } catch (error) {
    next(error);
  }
});
      

app.get('/admin/statistics', async (req, res, next) => {
  try {
    const [watumiaji, matumizi, dawa, clinics] = await Promise.all([
      readSheet('WATUMIAJI').catch(() => []),
      readSheet('MATUMIZI').catch(() => []),
      readSheet('DAWA').catch(() => []),
      readSheet('CLINICS').catch(() => [])
    ]);

    // 1. Prepare clinic statistics
    const clinicStats = {
      totalUsers: watumiaji.length,
      activeUsers: 0,
      inactiveUsers: 0,
      byClinic: {}
    };

    // 2. Prepare medicine statistics
    const medicineStats = {
      totalUsage: 0,
      byMedicine: {},
      mostUsed: []
    };

    // 3. Create lookup maps
    const clinicMap = {};
    clinics.forEach(clinic => {
      clinicMap[clinic.id] = clinic.jina;
      clinicStats.byClinic[clinic.jina] = {
        totalUsers: 0,
        activeUsers: 0,
        inactiveUsers: 0
      };
    });

    const dawaMap = {};
    dawa.forEach(item => {
      dawaMap[item.id] = item;
      medicineStats.byMedicine[item.jina] = {
        totalUsed: 0,
        remaining: parseInt(item.kilichobaki) || 0
      };
    });

    // 4. Process user data
    watumiaji.forEach(user => {
      const clinicName = clinicMap[user.clinicId] || 'Unknown';
      clinicStats.byClinic[clinicName].totalUsers++;
    });

    // 5. Process medicine usage
const activeUsers = new Set();
const clinicUserMap = {}; // { 'Clinic Name': Set() }

matumizi.forEach(usage => {
  const medicine = dawaMap[usage.dawaId];
  if (!medicine) return;

  const clinicName = clinicMap[usage.clinicId] || 'Unknown';
  const kiasi = parseInt(usage.kiasi) || 0;
  const mtumiajiId = usage.mtumiajiId;

  // Update medicine stats
  medicineStats.byMedicine[medicine.jina].totalUsed += kiasi;
  medicineStats.totalUsage += kiasi;

  // Track global active users
  activeUsers.add(mtumiajiId);

  // Track unique users per clinic
  if (!clinicUserMap[clinicName]) {
    clinicUserMap[clinicName] = new Set();
  }
  clinicUserMap[clinicName].add(mtumiajiId);
});

// 6. Calculate active/inactive users per clinic
clinicStats.activeUsers = activeUsers.size;
clinicStats.inactiveUsers = clinicStats.totalUsers - clinicStats.activeUsers;

Object.entries(clinicUserMap).forEach(([clinicName, userSet]) => {
  clinicStats.byClinic[clinicName].activeUsers = userSet.size;
  clinicStats.byClinic[clinicName].inactiveUsers = 
    clinicStats.byClinic[clinicName].totalUsers - userSet.size;
});

    // 7. Prepare most used medicines
    medicineStats.mostUsed = Object.entries(medicineStats.byMedicine)
      .sort((a, b) => b[1].totalUsed - a[1].totalUsed)
      .slice(0, 5)
      .map(([name, data]) => ({
        name,
        totalUsed: data.totalUsed,
        remaining: data.remaining
      }));

    // 8. Prepare data for charts
    const chartData = {
      clinics: {
        labels: Object.keys(clinicStats.byClinic),
        datasets: [{
          label: 'Watumiaji Wote',
          data: Object.values(clinicStats.byClinic).map(c => c.totalUsers),
          backgroundColor: 'rgba(37, 99, 235, 0.7)'
        }, {
          label: 'Watumiaji Waliotumia',
          data: Object.values(clinicStats.byClinic).map(c => c.activeUsers),
          backgroundColor: 'rgba(22, 163, 74, 0.7)'
        }]
      },
      medicines: {
        labels: Object.keys(medicineStats.byMedicine),
        data: Object.values(medicineStats.byMedicine).map(m => m.totalUsed),
        backgroundColor: 'rgba(220, 38, 38, 0.7)'
      }
    };

    res.render('admin-statistics', {
      clinicStats,
      medicineStats,
      chartData: JSON.stringify(chartData),
      helpers: {
        formatCount: (count) => count?.toString() || '0'
      }
    });

  } catch (error) {
    console.error('Error in /admin/statistics:', error);
    next(error);
  }
});
    



app.get('/mtumiaji/futa/:id', async (req, res, next) => {
  try {
    const { id } = req.params;

    const watumiaji = await readSheet('WATUMIAJI');
    const mtumiaji = watumiaji.find(w => w.id === id);

    if (!mtumiaji) {
      return res.status(404).render('error', { message: 'Mtumiaji hajapatikana.' });
    }

    const updated = watumiaji.filter(w => w.id !== id);
    await writeSheet('WATUMIAJI', updated);

    // No need to remove anything from MATUMIZI
    res.redirect('/');
  } catch (error) {
    next(error);
  }
});

      
  app.get('/admin/watumiaji', async (req, res, next) => {
  try {
    const { clinicId, dawaType, dawaContent, selectedMedicine } = req.query;

    // 1. Read all data with error handling
    const [watumiaji, clinics, matumizi, dawa] = await Promise.all([
      readSheet('WATUMIAJI').catch(() => []),
      readSheet('CLINICS').catch(() => []),
      readSheet('MATUMIZI').catch(() => []),
      readSheet('DAWA').catch(() => [])
    ]);

    // 2. Create lookup maps
    const clinicMap = clinics.reduce((map, clinic) => {
      if (clinic?.id) map[clinic.id] = clinic;
      return map;
    }, {});

    const dawaMap = dawa.reduce((map, med) => {
      if (med?.id) map[med.id] = med;
      return map;
    }, {});

    // 3. Initialize statistics with template-required structure
    const stats = {
      totalUsers: watumiaji.length,
      activeUsers: 0,
      inactiveUsers: 0,
      summary: {
        totalConsumption: 0,
        averageUsagePerUser: 0,
        clinicsSummary: []
      },
      medicineUsage: {},
      userUsage: {},
      clinicStats: {},
      usersPerClinic: {},
      allMedicines: dawa.filter(d => d?.id).map(d => ({
        id: d.id,
        jina: d.jina || 'Unknown',
        aina: d.type || 'Unknown',
        remaining: parseInt(d.kilichobaki) || 0
      })),
      mostConsumedMedicines: []
    };

    // 4. Track active users and medicine usage
    const activeUserIds = new Set();
    
    matumizi.forEach(usage => {
      if (!usage?.dawaId || !usage?.mtumiajiId) return;
      
      const medicine = dawaMap[usage.dawaId];
      if (!medicine) return;

      const usageAmount = parseInt(usage.kiasi) || 0;
      const usageDate = usage.tarehe ? new Date(usage.tarehe) : null;
      const user = watumiaji.find(u => u.id === usage.mtumiajiId);
      const clinicId = user?.clinicId;

      if (!user || !clinicId) return;

      // Track active users
      activeUserIds.add(usage.mtumiajiId);

      // Initialize user usage tracking
      if (!stats.userUsage[usage.mtumiajiId]) {
        stats.userUsage[usage.mtumiajiId] = {
          totalUsed: 0,
          medicines: {},
          lastDate: null,
          clinicId: clinicId
        };
      }

      // Update usage totals
      stats.userUsage[usage.mtumiajiId].totalUsed += usageAmount;
      stats.summary.totalConsumption += usageAmount;

      // Track medicine usage per user
      if (!stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId]) {
        stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0,
          lastUsed: null
        };
      }
      
      const userMed = stats.userUsage[usage.mtumiajiId].medicines[usage.dawaId];
      userMed.totalUsed += usageAmount;

      // Update dates if available
      if (usageDate && !isNaN(usageDate.getTime())) {
        if (!stats.userUsage[usage.mtumiajiId].lastDate || 
            usageDate > stats.userUsage[usage.mtumiajiId].lastDate) {
          stats.userUsage[usage.mtumiajiId].lastDate = usageDate;
        }
        if (!userMed.lastUsed || usageDate > userMed.lastUsed) {
          userMed.lastUsed = usageDate;
        }
      }

      // Track global medicine usage
      if (!stats.medicineUsage[usage.dawaId]) {
        stats.medicineUsage[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0,
          remaining: parseInt(medicine.kilichobaki) || 0,
          users: new Set(),
          clinics: new Set()
        };
      }
      stats.medicineUsage[usage.dawaId].totalUsed += usageAmount;
      stats.medicineUsage[usage.dawaId].users.add(usage.mtumiajiId);
      stats.medicineUsage[usage.dawaId].clinics.add(clinicId);

      // Track clinic-specific usage
      if (!stats.clinicStats[clinicId]) {
        stats.clinicStats[clinicId] = {
          name: clinicMap[clinicId]?.jina || 'Unknown',
          totalUsers: 0,
          activeUsers: 0,
          inactiveUsers: 0,
          medicinesUsed: {},
          totalConsumption: 0
        };
      }
      stats.clinicStats[clinicId].totalConsumption += usageAmount;
      
      if (!stats.clinicStats[clinicId].medicinesUsed[usage.dawaId]) {
        stats.clinicStats[clinicId].medicinesUsed[usage.dawaId] = {
          name: medicine.jina || 'Unknown',
          totalUsed: 0
        };
      }
      stats.clinicStats[clinicId].medicinesUsed[usage.dawaId].totalUsed += usageAmount;
    });

    // 5. Calculate user statistics
    stats.activeUsers = activeUserIds.size;
    stats.inactiveUsers = stats.totalUsers - stats.activeUsers;
    stats.summary.averageUsagePerUser = stats.activeUsers > 0 
      ? (stats.summary.totalConsumption / stats.activeUsers).toFixed(2)
      : '0.00';

    // 6. Calculate clinic statistics
    watumiaji.forEach(user => {
      if (!user?.clinicId) return;
      
      const clinicName = clinicMap[user.clinicId]?.jina || 'Unknown';
      stats.usersPerClinic[clinicName] = (stats.usersPerClinic[clinicName] || 0) + 1;

      if (stats.clinicStats[user.clinicId]) {
        stats.clinicStats[user.clinicId].totalUsers++;
        if (activeUserIds.has(user.id)) {
          stats.clinicStats[user.clinicId].activeUsers++;
        } else {
          stats.clinicStats[user.clinicId].inactiveUsers++;
        }
      }
    });

    // 7. Prepare most consumed medicines
    stats.mostConsumedMedicines = Object.entries(stats.medicineUsage)
      .map(([id, data]) => ({
        id,
        name: data.name,
        totalUsed: data.totalUsed,
        remaining: data.remaining,
        userCount: data.users.size,
        clinicCount: data.clinics.size
      }))
      .sort((a, b) => b.totalUsed - a.totalUsed)
      .slice(0, 5);

    // 8. Prepare clinic summaries
    stats.summary.clinicsSummary = Object.values(stats.clinicStats).map(clinic => {
      const mostUsed = Object.entries(clinic.medicinesUsed)
        .sort((a, b) => b[1].totalUsed - a[1].totalUsed)[0];
      
      return {
        name: clinic.name,
        totalUsers: clinic.totalUsers,
        activeUsers: clinic.activeUsers,
        inactiveUsers: clinic.inactiveUsers,
        totalConsumption: clinic.totalConsumption,
        mostUsedMedicine: mostUsed ? {
          name: mostUsed[1].name,
          amount: mostUsed[1].totalUsed
        } : null,
        usagePercentage: stats.summary.totalConsumption > 0
          ? ((clinic.totalConsumption / stats.summary.totalConsumption) * 100).toFixed(2)
          : '0.00'
      };
    });

    // 9. Prepare user data for display
    let filteredUsers = watumiaji.map(user => {
      const usage = stats.userUsage[user.id] || {};
      return {
        ...user,
        clinic: clinicMap[user.clinicId]?.jina || 'Unknown',
        totalUsed: usage.totalUsed || 0,
        medicinesUsed: usage.medicines
          ? Object.values(usage.medicines).map(m => `${m.name} (${m.totalUsed})`).join(', ')
          : 'Hajatumia',
        lastUsage: usage.lastDate ? usage.lastDate.toLocaleDateString('sw-TZ') : 'Hajatumia',
        status: usage.totalUsed ? 'Active' : 'Inactive',
        dawaDetails: usage.medicines || {}
      };
    });

    // 10. Apply filters
    if (clinicId) {
      filteredUsers = filteredUsers.filter(user => user.clinicId === clinicId);
    }
    if (dawaType) {
      filteredUsers = filteredUsers.filter(user => 
        Object.keys(user.dawaDetails).some(dawaId => 
          dawaMap[dawaId]?.type === dawaType
        )
      );
    }
    if (dawaContent) {
      const searchTerm = dawaContent.toLowerCase();
      filteredUsers = filteredUsers.filter(user => 
        Object.values(user.dawaDetails).some(m => 
          m.name.toLowerCase().includes(searchTerm)
        )
      );
    }

    // 11. Prepare selected medicine report if requested
    let selectedMedicineReport = null;
    if (selectedMedicine && stats.medicineUsage[selectedMedicine]) {
      const medicine = stats.medicineUsage[selectedMedicine];
      selectedMedicineReport = {
        name: medicine.name,
        totalUsed: medicine.totalUsed,
        remaining: medicine.remaining,
        userCount: medicine.users.size,
        clinicCount: medicine.clinics.size,
        users: Array.from(medicine.users).map(userId => {
          const user = watumiaji.find(u => u.id === userId) || {};
          const usage = stats.userUsage[userId]?.medicines[selectedMedicine] || {};
          return {
            id: userId,
            name: user.jina || 'Unknown',
            clinic: clinicMap[user.clinicId]?.jina || 'Unknown',
            amountUsed: usage.totalUsed || 0,
            lastUsed: usage.lastUsed ? usage.lastUsed.toLocaleDateString('sw-TZ') : 'N/A'
          };
        }),
        clinics: Array.from(medicine.clinics).map(clinicId => {
          const clinic = clinicMap[clinicId] || {};
          const clinicUsage = stats.clinicStats[clinicId]?.medicinesUsed[selectedMedicine] || {};
          return {
            id: clinicId,
            name: clinic.jina || 'Unknown',
            amountUsed: clinicUsage.totalUsed || 0
          };
        })
      };
    }

    // 12. Render with all required data
    res.render('wote-watumiaji', {
      watumiaji: filteredUsers,
      clinics: clinics.filter(c => c?.id),
      allMedicines: stats.allMedicines,
      filters: { clinicId, dawaType, dawaContent, selectedMedicine },
      stats: {
        ...stats,
        selectedMedicine: selectedMedicineReport,
        clinicCount: clinics.length // Added for template compatibility
      },
      formatCount: (count) => count?.toString() || '0',
      formatDate: (date) => date ? new Date(date).toLocaleDateString('sw-TZ') : 'N/A'
    });

  } catch (error) {
    console.error('Error in /admin/watumiaji:', error);
    next(error);
  }
});  



app.post('/dawa/ongeza-stock', async (req, res) => {
  try {
    const { jina, kiasi } = req.body;

    const dawa = await readSheet('DAWA');

    const dawaIndex = dawa.findIndex(d =>
      (d.jina || '').trim().toLowerCase() === jina.trim().toLowerCase()
    );

    if (dawaIndex === -1) {
      return res.status(400).send('Dawa haikupatikana.');
    }

    const kiasiMpya = Number(dawa[dawaIndex].kiasi || 0) + Number(kiasi);
    dawa[dawaIndex].kiasi = kiasiMpya;
    dawa[dawaIndex].UPDATED_AT = new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD

    await writeSheet('DAWA', dawa);

    res.redirect('/dawa/ongeza-stock?success=1');
  } catch (error) {
    console.error('Hitilafu wakati wa kuongeza stock:', error);
    res.status(500).send('Hitilafu ya ndani ya seva.');
  }
});


  
app.get('/dawa/ongeza-stock', async (req, res, next) => {
  try {
    const dawa = await readSheet('DAWA');

    const dawaList = dawa.map(d => ({
      JINA: (d.jina || '').trim(),
      KIASI: Number(d.kiasi) || 0,
      UPDATED_AT: d.UPDATED_AT || d.tarehe || ''
    }));

    const success = req.query.success === '1'; // ✅ ongeza hii

    res.render('ongeza-stock', { dawaList, success }); // ✅ sasa success ipo
  } catch (error) {
    console.error('Hitilafu wakati wa kusoma dawa:', error);
    res.status(500).send('Hitilafu katika kusoma taarifa za dawa.');
  }
});


  app.get('/test-read', async (req, res) => {
  const data = await readSheet('WATUMIAJI');
  res.json(data);
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
