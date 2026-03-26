const { Pool } = require('pg');
const fs   = require('fs');
const path = require('path');

// ── Connection pool ───────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
});

// ── Convenience wrapper ───────────────────────────────────
// query(sql, [params]) → array of row objects
// queryOne(sql, [params]) → first row or undefined
// run(sql, [params]) → { rowCount, rows }
async function query(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows;
}
async function queryOne(sql, params = []) {
  const res = await pool.query(sql, params);
  return res.rows[0];
}
async function run(sql, params = []) {
  const res = await pool.query(sql, params);
  return { rowCount: res.rowCount, rows: res.rows };
}

// ── Auto-create schema on first run ──────────────────────
async function initSchema() {
  const schemaPath = path.join(__dirname, '../schema-pg.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');
  await pool.query(sql);
  console.log('✓ PostgreSQL schema ready');
}

initSchema().catch(err => {
  console.error('FATAL: could not init DB schema:', err.message);
  process.exit(1);
});

module.exports = { query, queryOne, run, pool };
