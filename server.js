import express from 'express';
import session from 'express-session';
import bcrypt from 'bcrypt';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { db, init as initDB } from './db.js';
import { parseDocxToTemplate } from './parseDocx.js';
import sanitizeHtml from 'sanitize-html';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

initDB();

// Inicialização: cria admin se não existir
function ensureAdminUser() {
  const admin = db.prepare('SELECT * FROM users WHERE username = ?').get('admin');
  if (!admin) {
    const hash = bcrypt.hashSync('admin', 10);
    db.prepare('INSERT INTO users (username,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,datetime("now"))')
      .run('admin','Administrador', null, 'admin', hash);
    console.log('>> Usuário admin (admin/admin) criado.');
  }
}
ensureAdminUser();

// Sessão (para demo, MemoryStore). Para produção, use um store persistente.
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax' }
}));

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

// Uploads
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
const upload = multer({ dest: uploadDir, limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB

// Utils
function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'Não autenticado' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
  next();
}
function safeText(s) {
  return sanitizeHtml(s || '', { allowedTags: [], allowedAttributes: {} }).trim();
}

// Email (opcional)
let transporter = null;
if (process.env.SMTP_URL && process.env.SMTP_URL.trim()) {
  transporter = nodemailer.createTransport(process.env.SMTP_URL.trim());
}

// Auth
app.post('/api/auth/login', (req,res) => {
  const { username, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(safeText(username));
  if (!user) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: 'Usuário ou senha inválidos' });
  req.session.user = { id: user.id, username: user.username, name: user.name, role: user.role };
  res.json({ ok: true, user: req.session.user });
});
app.post('/api/auth/logout', (req,res) => {
  req.session.destroy(() => res.json({ ok: true }));
});
app.get('/api/auth/me', (req,res) => {
  res.json({ user: req.session.user || null });
});

// Settings (grades toggle)
app.get('/api/settings/grades-enabled', requireAuth, (req,res) => {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('grades_enabled');
  res.json({ enabled: row?.value === '1' });
});
app.post('/api/settings/grades-enabled', requireAdmin, (req,res) => {
  const { enabled } = req.body;
  db.prepare('INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)').run('grades_enabled', enabled ? '1' : '0');
  res.json({ ok: true, enabled: !!enabled });
});

// Users CRUD
app.get('/api/users', requireAdmin, (req,res) => {
  const users = db.prepare('SELECT id,username,name,email,role,created_at FROM users ORDER BY id').all();
  res.json({ users });
});
app.post('/api/users', requireAdmin, (req,res) => {
  const { username, name, email, role, password } = req.body;
  if (!username || !name || !password) return res.status(400).json({ error: 'username, name e password são obrigatórios' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const info = db.prepare('INSERT INTO users (username,name,email,role,password_hash,created_at) VALUES (?,?,?,?,?,datetime("now"))')
      .run(safeText(username), safeText(name), safeText(email), role === 'admin' ? 'admin' : 'member', hash);
    res.json({ ok: true, id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: 'Falha ao criar usuário (talvez username duplicado?)' });
  }
});
app.patch('/api/users/:id', requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const { name, email, role } = req.body;
  db.prepare('UPDATE users SET name = COALESCE(?,name), email = COALESCE(?,email), role = COALESCE(?,role) WHERE id = ?')
    .run(name ? safeText(name) : null, email ? safeText(email) : null, (role==='admin'||role==='member')?role:null, id);
  res.json({ ok: true });
});
app.post('/api/users/:id/reset-password', requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  const { newPassword } = req.body;
  const hash = bcrypt.hashSync(newPassword || '123456', 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, id);
  res.json({ ok: true });
});
app.delete('/api/users/:id', requireAdmin, (req,res) => {
  const id = Number(req.params.id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ ok: true });
});

// Communications: announcements & polls
app.post('/api/comms/announcements', requireAdmin, (req,res) => {
  const { title, content } = req.body;
  const stmt = db.prepare('INSERT INTO communications (type,title,content,created_by,created_at) VALUES (?,?,?,?,datetime("now"))');
  const info = stmt.run('announcement', safeText(title), safeText(content), req.session.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.post('/api/comms/polls', requireAdmin, (req,res) => {
  const { title, options } = req.body;
  if (!Array.isArray(options) || options.length < 2) return res.status(400).json({ error: 'forneça pelo menos 2 opções' });
  const options_json = JSON.stringify(options.map(safeText));
  const stmt = db.prepare('INSERT INTO communications (type,title,options_json,created_by,created_at) VALUES (?,?,?,?,datetime("now"))');
  const info = stmt.run('poll', safeText(title), options_json, req.session.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.get('/api/comms', requireAuth, (req,res) => {
  const rows = db.prepare('SELECT * FROM communications ORDER BY id DESC').all();
  const enriched = rows.map(r => {
    const o = { ...r, options: r.options_json ? JSON.parse(r.options_json) : null };
    delete o.options_json;
    return o;
  });
  res.json({ items: enriched });
});
app.post('/api/comms/polls/:id/vote', requireAuth, (req,res) => {
  const poll_id = Number(req.params.id);
  const { option_index } = req.body;
  try {
    db.prepare('INSERT INTO poll_votes (poll_id,user_id,option_index,created_at) VALUES (?,?,?,datetime("now"))')
      .run(poll_id, req.session.user.id, Number(option_index));
  } catch (e) {
    return res.status(400).json({ error: 'voto já registrado ou inválido' });
  }
  res.json({ ok: true });
});
app.get('/api/comms/polls/:id/results', requireAuth, (req,res) => {
  const poll_id = Number(req.params.id);
  const poll = db.prepare('SELECT * FROM communications WHERE id = ? AND type = "poll"').get(poll_id);
  if (!poll) return res.status(404).json({ error: 'enquete não encontrada' });
  const options = JSON.parse(poll.options_json);
  const counts = options.map((_,i) => db.prepare('SELECT COUNT(*) as c FROM poll_votes WHERE poll_id = ? AND option_index = ?').get(poll_id, i).c);
  res.json({ poll: { id: poll.id, title: poll.title, options }, counts });
});

// Evaluations
app.post('/api/evaluations/import-docx', requireAdmin, upload.single('file'), async (req,res) => {
  if (!req.file) return res.status(400).json({ error: 'arquivo .docx é obrigatório' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const template = await parseDocxToTemplate(buf);
    res.json({ ok: true, template });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Falha ao processar .docx' });
  } finally {
    try { fs.unlinkSync(req.file.path); } catch (_) {}
  }
});
app.post('/api/evaluations', requireAdmin, upload.single('file'), async (req,res) => {
  const { title, template } = req.body;
  let templateObj = null;
  try {
    templateObj = typeof template === 'string' ? JSON.parse(template) : template;
  } catch (e) {
    return res.status(400).json({ error: 'template inválido' });
  }
  let filename = null, mime=null, size=0, savedPath=null;
  if (req.file) {
    filename = req.file.originalname;
    mime = req.file.mimetype;
    size = req.file.size;
    const finalPath = path.join('uploads', req.file.filename + '-' + filename);
    fs.renameSync(req.file.path, path.join(__dirname, finalPath));
    savedPath = finalPath;
  }
  const stmt = db.prepare('INSERT INTO evaluations (title,original_filename,original_mime,original_size,original_doc_path,template_json,created_by,created_at) VALUES (?,?,?,?,?,?,?,datetime("now"))');
  const info = stmt.run(safeText(title), filename, mime, size, savedPath, JSON.stringify(templateObj), req.session.user.id);
  res.json({ ok: true, id: info.lastInsertRowid });
});
app.get('/api/evaluations', requireAuth, (req,res) => {
  const rows = db.prepare('SELECT id,title,created_at FROM evaluations ORDER BY id DESC').all();
  res.json({ items: rows });
});
app.get('/api/evaluations/:id', requireAuth, (req,res) => {
  const id = Number(req.params.id);
  const row = db.prepare('SELECT * FROM evaluations WHERE id = ?').get(id);
  if (!row) return res.status(404).json({ error: 'avaliação não encontrada' });
  const tpl = JSON.parse(row.template_json);
  res.json({ id: row.id, title: row.title, template: tpl, original_doc_path: row.original_doc_path });
});
app.post('/api/evaluations/:id/submit', requireAuth, (req,res) => {
  const id = Number(req.params.id);
  const { answers } = req.body;
  if (!answers) return res.status(400).json({ error: 'answers é obrigatório' });
  const stmt = db.prepare('INSERT INTO evaluation_submissions (evaluation_id,user_id,answers_json,submitted_at) VALUES (?,?,?,datetime("now"))');
  const info = stmt.run(id, req.session.user.id, JSON.stringify(answers));
  res.json({ ok: true, submissionId: info.lastInsertRowid });
});

// Notas (grading)
app.get('/api/grades', requireAuth, (req,res) => {
  // Admin vê todas; membro vê suas
  if (req.session.user.role === 'admin') {
    const rows = db.prepare(`
      SELECT es.id as submission_id, es.evaluation_id, e.title, u.id as user_id, u.name, es.submitted_at, es.grade, es.feedback, es.graded_at
      FROM evaluation_submissions es
      JOIN users u ON u.id = es.user_id
      JOIN evaluations e ON e.id = es.evaluation_id
      ORDER BY es.submitted_at DESC
    `).all();
    res.json({ items: rows });
  } else {
    const rows = db.prepare(`
      SELECT es.id as submission_id, es.evaluation_id, e.title, es.submitted_at, es.grade, es.feedback, es.graded_at
      FROM evaluation_submissions es
      JOIN evaluations e ON e.id = es.evaluation_id
      WHERE es.user_id = ?
      ORDER BY es.submitted_at DESC
    `).all(req.session.user.id);
    res.json({ items: rows });
  }
});
app.patch('/api/grades/:submissionId', requireAdmin, (req,res) => {
  const id = Number(req.params.submissionId);
  const { grade, feedback, notify } = req.body;
  db.prepare('UPDATE evaluation_submissions SET grade = ?, feedback = ?, graded_by = ?, graded_at = datetime("now") WHERE id = ?')
    .run(grade != null ? Number(grade) : null, safeText(feedback), req.session.user.id, id);

  // Notificação interna
  const sub = db.prepare('SELECT * FROM evaluation_submissions WHERE id = ?').get(id);
  const user = db.prepare('SELECT id,name,email FROM users WHERE id = ?').get(sub.user_id);
  const evalRow = db.prepare('SELECT title FROM evaluations WHERE id = ?').get(sub.evaluation_id);
  db.prepare('INSERT INTO notifications (user_id,type,title,message,payload_json,created_at) VALUES (?,?,?,?,?,datetime("now"))')
    .run(user.id, 'grade', `Nota atualizada - ${evalRow.title}`, `Sua nota foi atualizada: ${grade != null ? grade : 'N/A'}`, JSON.stringify({ submissionId: id }));

  // Email (opcional)
  if (notify && transporter && user.email) {
    transporter.sendMail({
      from: 'no-reply@plataforma.local',
      to: user.email,
      subject: `Nota atualizada - ${evalRow.title}`,
      text: `Olá ${user.name},\nSua nota foi atualizada: ${grade != null ? grade : 'N/A'}\nFeedback: ${feedback || '-'}\n`,
    }).catch(err => console.error('Falha ao enviar email:', err.message));
  }

  res.json({ ok: true });
});

// Notifications (inbox simples)
app.get('/api/notifications', requireAuth, (req,res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC').all(req.session.user.id);
  rows.forEach(r => { if (r.payload_json) { r.payload = JSON.parse(r.payload_json); delete r.payload_json; } });
  res.json({ items: rows });
});
app.patch('/api/notifications/:id/read', requireAuth, (req,res) => {
  const id = Number(req.params.id);
  db.prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(id, req.session.user.id);
  res.json({ ok: true });
});

// Arquivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

// Fallback para SPA simples (index.html)
app.get('*', (req,res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

if (process.argv.includes('--initdb')) {
  console.log('Banco inicializado.');
  process.exit(0);
}

app.listen(PORT, () => console.log(`Servidor ouvindo http://localhost:${PORT}`));