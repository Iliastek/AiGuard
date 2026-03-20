// Fixture: Express app with security misconfigurations
// Expected issues: missing helmet, SQL injection, missing rate limiting, XSS

import express from "express";
import { Pool } from "pg";

const app = express();  // line 6 — no helmet(), no rate limiter registered
app.use(express.json());

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

app.get("/user", async (req, res) => {
  const userId = req.query.id;
  // line 13 — SQL injection: user input concatenated directly into query
  const result = await pool.query("SELECT * FROM users WHERE id = " + userId);
  res.json(result.rows[0]);
});

app.post("/search", async (req, res) => {
  const term = req.body.term;
  // line 20 — XSS: raw user input reflected into HTML response
  res.send(`<h1>Results for: ${term}</h1>`);
});

app.delete("/admin/user/:id", async (req, res) => {
  const id = req.params.id;
  // line 25 — no authorization check before destructive operation
  await pool.query(`DELETE FROM users WHERE id = ${id}`);
  res.json({ deleted: id });
});

app.listen(3000);
