// server.js
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const DB_FILE = path.join(__dirname, 'pfms.db');

// Middlewares
app.use(cors());
app.use(bodyParser.json()); // parse application/json

// Serve static files (your html/css/js)
app.use(express.static(__dirname)); // serves index.html, dashboard.html, assets/ etc.

// Open (or create) DB
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) return console.error('Failed to open DB:', err.message);
  console.log('Connected to SQLite DB:', DB_FILE);
});

// Create tables if not exist
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT,
    description TEXT,
    amount REAL NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    month INTEGER NOT NULL,
    year INTEGER NOT NULL,
    amount REAL NOT NULL,
    UNIQUE(month, year)
  )`);

  // Insert demo admin user if missing (password 'admin') - only for demo
  db.get(`SELECT id FROM users WHERE username = ?`, ['admin'], (err, row) => {
    if (err) console.error(err);
    if (!row) {
      db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, ['admin', 'admin']);
      console.log('Inserted demo user admin/admin');
    }
  });
});

// ----------------- API routes ------------------

// POST /api/login { username, password } => { ok: true }
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ ok: false, error: 'Missing fields' });

  db.get(`SELECT id FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err) return res.status(500).json({ ok: false, error: 'DB error' });
    if (!row) return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    return res.json({ ok: true, userId: row.id });
  });
});

// GET /api/transactions?month=0&year=2025  -> returns array
app.get('/api/transactions', (req, res) => {
  const month = typeof req.query.month !== 'undefined' ? Number(req.query.month) : null;
  const year = typeof req.query.year !== 'undefined' ? Number(req.query.year) : null;

  if (month !== null && Number.isInteger(month) && year !== null && Number.isInteger(year)) {
    // Filter by month/year
    const start = new Date(year, month, 1).toISOString().slice(0,10);
    const endDate = new Date(year, month + 1, 1);
    endDate.setSeconds(endDate.getSeconds() - 1);
    const end = endDate.toISOString().slice(0,10);
    // We'll filter using SQLite date functions — simpler: match substr(date,1,7) = 'YYYY-MM'
    const monthStr = `${year}-${String(month + 1).padStart(2,'0')}`;
    db.all(`SELECT * FROM transactions WHERE substr(date,1,7)=? ORDER BY date DESC, id DESC`, [monthStr], (err, rows) => {
      if (err) return res.status(500).json({ ok:false, error:'DB error' });
      return res.json({ ok:true, transactions: rows });
    });
  } else {
    db.all(`SELECT * FROM transactions ORDER BY date DESC, id DESC`, [], (err, rows) => {
      if (err) return res.status(500).json({ ok:false, error:'DB error' });
      return res.json({ ok:true, transactions: rows });
    });
  }
});

// POST /api/transactions { date, type, category, description, amount } -> inserted row
app.post('/api/transactions', (req, res) => {
  const { date, type, category, description, amount } = req.body || {};
  if (!date || !type || typeof amount === 'undefined') return res.status(400).json({ ok:false, error:'Missing fields' });

  db.run(`INSERT INTO transactions (date, type, category, description, amount) VALUES (?,?,?,?,?)`,
    [date, type, category || null, description || null, amount],
    function(err) {
      if (err) return res.status(500).json({ ok:false, error:'DB error' });
      db.get(`SELECT * FROM transactions WHERE id = ?`, [this.lastID], (err2, row) => {
        if (err2) return res.status(500).json({ ok:false, error:'DB error' });
        return res.json({ ok:true, transaction: row });
      });
    });
});

// DELETE /api/transactions/:id
app.delete('/api/transactions/:id', (req, res) => {
  const id = Number(req.params.id);
  db.run(`DELETE FROM transactions WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ ok:false, error:'DB error' });
    return res.json({ ok:true, deleted: this.changes });
  });
});

// GET /api/budgets -> return array of budgets
app.get('/api/budgets', (req, res) => {
  db.all(`SELECT month, year, amount FROM budgets`, [], (err, rows) => {
    if (err) return res.status(500).json({ ok:false, error:'DB error' });
    return res.json({ ok:true, budgets: rows });
  });
});

// POST /api/budgets { month:0-11, year, amount } -> upsert
app.post('/api/budgets', (req, res) => {
  const { month, year, amount } = req.body || {};
  if (typeof month === 'undefined' || typeof year === 'undefined' || typeof amount === 'undefined') {
    return res.status(400).json({ ok:false, error:'Missing fields' });
  }
  // Upsert: try update, if zero rows updated, insert
  db.run(`UPDATE budgets SET amount = ? WHERE month = ? AND year = ?`, [amount, month, year], function(err) {
    if (err) return res.status(500).json({ ok:false, error:'DB error' });
    if (this.changes === 0) {
      db.run(`INSERT INTO budgets (month, year, amount) VALUES (?,?,?)`, [month, year, amount], function(err2) {
        if (err2) return res.status(500).json({ ok:false, error:'DB error' });
        return res.json({ ok:true, upserted: true });
      });
    } else {
      return res.json({ ok:true, upserted: true });
    }
  });
});

// fallback info
app.get('/api/ping', (req, res) => res.json({ ok:true, ts: Date.now() }));

// start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PFMS backend listening on http://localhost:${PORT}`);
});
