import "dotenv/config";
import express from "express";
import cors from "cors";
import mysql from "mysql2/promise";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import { randomUUID } from "node:crypto";

const fileDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(fileDir, "..");
const app = express();
const port = Number(process.env.API_PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || (process.env.NODE_ENV === "production" ? "" : "local-development-only-secret-change-me");
const uploadsDir = path.resolve(process.env.UPLOAD_DIR || path.join(rootDir, "uploads", "products"));
fs.mkdirSync(uploadsDir, { recursive: true });

const production = process.env.NODE_ENV === "production";
const allowedOrigins = (process.env.CLIENT_ORIGIN || (production ? "" : "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174"))
  .split(",").map(origin => origin.trim()).filter(Boolean);
if (production && !allowedOrigins.length) throw new Error("CLIENT_ORIGIN must list the production frontend origin(s).");
if (production) app.set("trust proxy", 1);
app.use(cors({
  origin(origin, callback) { callback(null, !origin || allowedOrigins.includes(origin)); },
  credentials: true
}));
app.use((_req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), geolocation=()");
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use("/uploads/products", express.static(uploadsDir, { fallthrough: false, maxAge: "7d" }));
app.use("/api", (req, res, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin && !allowedOrigins.includes(req.headers.origin)) {
    return res.status(403).json({ error: "This website is not allowed to make changes to this account." });
  }
  next();
});

const pool = mysql.createPool({
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME || "sakhibiz",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  decimalNumbers: true
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
    ? cb(null, true)
    : cb(Object.assign(new Error("Choose a JPEG, PNG, or WebP image."), { status: 400, publicMessage: "Choose a JPEG, PNG, or WebP image." }))
});

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const db = async () => {
  try { return await pool.getConnection(); }
  catch (error) { error.status = 503; error.publicMessage = "MySQL is unavailable. Start MySQL Server and check the DB_HOST, DB_USER, DB_PASSWORD and DB_NAME values in .env."; throw error; }
};
const tokenFor = user => jwt.sign({ sub: user.user_id, email: user.email }, jwtSecret, { expiresIn: "7d" });
const sessionCookie = token => `sakhibiz_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${production ? "; Secure" : ""}`;
const clearSessionCookie = `sakhibiz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${production ? "; Secure" : ""}`;
const sessionTokenFrom = req => {
  const cookie = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith("sakhibiz_session="));
  if (!cookie) return null;
  try { return decodeURIComponent(cookie.slice("sakhibiz_session=".length)); }
  catch { return null; }
};
const auth = (req, res, next) => {
  const token = sessionTokenFrom(req);
  if (!token) return res.status(401).json({ error: "Sign in to continue." });
  try { req.user = jwt.verify(token, jwtSecret); next(); }
  catch { return res.status(401).json({ error: "Your session expired. Please sign in again." }); }
};
const authAttempts = new Map();
app.use(["/api/auth/login", "/api/auth/register"], (req, res, next) => {
  const key = req.ip || req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (entry && entry.resetAt <= now) authAttempts.delete(key);
  const current = authAttempts.get(key);
  if (current?.count >= 10) return res.status(429).json({ error: "Too many sign-in attempts. Wait 15 minutes and try again." });
  const nextEntry = current || { count: 0, resetAt: now + 15 * 60 * 1000 };
  nextEntry.count += 1;
  authAttempts.set(key, nextEntry);
  req.authAttemptKey = key;
  next();
});
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const wrapConnection = asyncRoute(async (req, res, next) => { req.db = await db(); try { await next(); } finally { req.db.release(); } });

app.get("/api/health", asyncRoute(async (_req, res) => {
  const connection = await db();
  try { await connection.ping(); res.json({ status: "ok", database: "connected" }); }
  finally { connection.release(); }
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const language = req.body.preferred_language === "en" ? "en" : "mr";
  if (name.length < 2 || name.length > 100) return res.status(400).json({ error: "Enter a name between 2 and 100 characters." });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: "Enter a valid email address." });
  if (password.length < 8 || password.length > 72) return res.status(400).json({ error: "Use a password with at least 8 characters." });
  const connection = await db();
  try {
    const [result] = await connection.execute("INSERT INTO users (name,email,password_hash,preferred_language) VALUES (?,?,?,?)", [name, email, await bcrypt.hash(password, 12), language]);
    const user = { user_id: result.insertId, name, email, preferred_language: language, village: "" };
    authAttempts.delete(req.authAttemptKey);
    res.append("Set-Cookie", sessionCookie(tokenFor(user)));
    res.status(201).json({ user });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") return res.status(409).json({ error: "An account already uses this email." });
    throw error;
  } finally { connection.release(); }
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  const connection = await db();
  try {
    const [[user]] = await connection.execute("SELECT user_id,name,email,password_hash,preferred_language,village FROM users WHERE email=?", [email]);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) return res.status(401).json({ error: "Email or password is incorrect." });
    delete user.password_hash;
    authAttempts.delete(req.authAttemptKey);
    res.append("Set-Cookie", sessionCookie(tokenFor(user)));
    res.json({ user });
  } finally { connection.release(); }
}));
app.get("/api/auth/session", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try {
    const [[user]] = await connection.execute("SELECT user_id,name,email,preferred_language,village FROM users WHERE user_id=?", [req.user.sub]);
    if (!user) return res.status(401).json({ error: "Sign in to continue." });
    res.json({ user });
  } finally { connection.release(); }
}));
app.post("/api/auth/logout", (_req, res) => { res.append("Set-Cookie", clearSessionCookie); res.status(204).end(); });

app.get("/api/profile", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try {
    const [[user]] = await connection.execute("SELECT user_id,name,email,preferred_language,village,coach_interests,coach_skills,starting_budget,hours_available,created_at FROM users WHERE user_id=?", [req.user.sub]);
    if (!user) return res.status(404).json({ error: "Profile not found." });
    res.json(user);
  } finally { connection.release(); }
}));
app.patch("/api/profile", auth, asyncRoute(async (req, res) => {
  const allowed = { name: 100, village: 120, preferred_language: 2 };
  const updates = Object.keys(allowed).filter(key => req.body[key] !== undefined);
  if (!updates.length) return res.status(400).json({ error: "There are no profile fields to update." });
  for (const key of updates) if (String(req.body[key]).length > allowed[key] || (key === "preferred_language" && !["mr", "en"].includes(req.body[key]))) return res.status(400).json({ error: `Invalid ${key}.` });
  const connection = await db();
  try {
    await connection.execute(`UPDATE users SET ${updates.map(key => `${key}=?`).join(",")},updated_at=NOW() WHERE user_id=?`, [...updates.map(key => req.body[key]), req.user.sub]);
    const [[user]] = await connection.execute("SELECT user_id,name,email,preferred_language,village,coach_interests,coach_skills,starting_budget,hours_available FROM users WHERE user_id=?", [req.user.sub]);
    res.json(user);
  } finally { connection.release(); }
}));

app.get("/api/lessons", asyncRoute(async (_req, res) => {
  const connection = await db();
  try { const [rows] = await connection.execute("SELECT lesson_id,title,mr_title,category,minutes,level,body,mr_body FROM lessons WHERE active=1 ORDER BY sort_order,lesson_id"); res.json(rows); }
  finally { connection.release(); }
}));
app.get("/api/progress", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try { const [rows] = await connection.execute("SELECT lesson_id,completed,completed_at FROM lesson_progress WHERE user_id=?", [req.user.sub]); res.json(rows); }
  finally { connection.release(); }
}));
app.post("/api/progress", auth, asyncRoute(async (req, res) => {
  if (!positiveId(req.body.lesson_id)) return res.status(400).json({ error: "A valid lesson_id is required." });
  const completed = req.body.completed !== false;
  const connection = await db();
  try {
    await connection.execute("INSERT INTO lesson_progress(user_id,lesson_id,completed,completed_at) VALUES(?,?,?,IF(?,NOW(),NULL)) ON DUPLICATE KEY UPDATE completed=VALUES(completed),completed_at=IF(VALUES(completed),NOW(),NULL)", [req.user.sub, req.body.lesson_id, completed, completed]);
    res.status(200).json({ lesson_id: Number(req.body.lesson_id), completed });
  } finally { connection.release(); }
}));

app.post("/api/quizzes/submit", auth, asyncRoute(async (req, res) => {
  const ids = req.body.question_ids;
  const answers = req.body.answers;
  if (!Array.isArray(ids) || !Array.isArray(answers) || ids.length < 1 || ids.length !== answers.length || ids.length > 30) return res.status(400).json({ error: "Provide matching question_ids and answers." });
  const connection = await db();
  try {
    const [questions] = await connection.execute(`SELECT question_id,correct_option FROM quiz_questions WHERE question_id IN (${ids.map(() => "?").join(",")})`, ids);
    const correct = new Map(questions.map(row => [row.question_id, Number(row.correct_option)]));
    const score = ids.reduce((sum, id, index) => sum + (correct.has(Number(id)) && Number(answers[index]) === correct.get(Number(id)) ? 1 : 0), 0);
    const [result] = await connection.execute("INSERT INTO quiz_results(user_id,score,total_questions,answers_json) VALUES(?,?,?,?)", [req.user.sub, score, ids.length, JSON.stringify({ question_ids: ids, answers })]);
    res.status(201).json({ attempt_id: result.insertId, score, total: ids.length });
  } finally { connection.release(); }
}));

app.get("/api/business-plans", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try { const [rows] = await connection.execute("SELECT * FROM business_plans WHERE user_id=? ORDER BY updated_at DESC", [req.user.sub]); res.json(rows); }
  finally { connection.release(); }
}));
app.post("/api/business-plans", auth, asyncRoute(async (req, res) => {
  const { business_name = "", product = "", target_customers = "", startup_budget = 0, selling_price = 0, estimated_cost = 0, marketing = "", first_goal = "" } = req.body;
  if (String(business_name).length > 150 || String(product).length > 200 || Number(startup_budget) < 0 || Number(selling_price) < 0 || Number(estimated_cost) < 0) return res.status(400).json({ error: "Check the plan values and try again." });
  const connection = await db();
  try { const [result] = await connection.execute("INSERT INTO business_plans(user_id,business_name,product,target_customers,startup_budget,selling_price,estimated_cost,marketing,first_goal) VALUES(?,?,?,?,?,?,?,?,?)", [req.user.sub,business_name,product,target_customers,Number(startup_budget),Number(selling_price),Number(estimated_cost),marketing,first_goal]); res.status(201).json({ plan_id: result.insertId, ...req.body }); }
  finally { connection.release(); }
}));
app.put("/api/business-plans/:id", auth, asyncRoute(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: "Invalid plan ID." });
  const p = req.body;
  const connection = await db();
  try { const [result] = await connection.execute("UPDATE business_plans SET business_name=?,product=?,target_customers=?,startup_budget=?,selling_price=?,estimated_cost=?,marketing=?,first_goal=?,updated_at=NOW() WHERE plan_id=? AND user_id=?", [p.business_name||"",p.product||"",p.target_customers||"",Number(p.startup_budget)||0,Number(p.selling_price)||0,Number(p.estimated_cost)||0,p.marketing||"",p.first_goal||"",req.params.id,req.user.sub]); if (!result.affectedRows) return res.status(404).json({ error: "Plan not found." }); res.json({ plan_id:Number(req.params.id),...p }); }
  finally { connection.release(); }
}));
app.delete("/api/business-plans/:id", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try { const [result] = await connection.execute("DELETE FROM business_plans WHERE plan_id=? AND user_id=?", [req.params.id, req.user.sub]); if (!result.affectedRows) return res.status(404).json({ error: "Plan not found." }); res.status(204).end(); }
  finally { connection.release(); }
}));

app.get("/api/products", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try { const [rows] = await connection.execute("SELECT * FROM products WHERE user_id=? ORDER BY created_at DESC", [req.user.sub]); res.json(rows); }
  finally { connection.release(); }
}));
app.post("/api/products", auth, upload.single("image"), asyncRoute(async (req, res) => {
  const name = String(req.body.product_name || "").trim();
  const price = Number(req.body.selling_price);
  if (!name || name.length > 180 || !Number.isFinite(price) || price < 0) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: "Provide a product name and valid selling price." }); }
  const imageUrl = req.file ? `/uploads/products/${path.basename(req.file.path)}` : null;
  let connection;
  try { connection=await db();const [result] = await connection.execute("INSERT INTO products(user_id,plan_id,product_name,description,selling_price,image_url) VALUES(?,?,?,?,?,?)", [req.user.sub, positiveId(req.body.plan_id) ? req.body.plan_id : null, name, String(req.body.description||"").slice(0,2000), price, imageUrl]); res.status(201).json({ product_id:result.insertId,user_id:req.user.sub,product_name:name,description:req.body.description||"",selling_price:price,image_url:imageUrl }); }
  catch(error){if(req.file&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);throw error;}
  finally { connection?.release(); }
}));
app.put("/api/products/:id", auth, upload.single("image"), asyncRoute(async (req, res) => {
  if (!positiveId(req.params.id)) return res.status(400).json({ error: "Invalid product ID." });
  const p=req.body, name=String(p.product_name||"").trim(), price=Number(p.selling_price);
  if(!name||name.length>180||!Number.isFinite(price)||price<0){if(req.file)fs.unlinkSync(req.file.path);return res.status(400).json({error:"Provide a product name and valid selling price."});}
  let connection,oldImage=null;
  try { connection=await db();const [[current]]=await connection.execute("SELECT image_url FROM products WHERE product_id=? AND user_id=?",[req.params.id,req.user.sub]);if(!current){if(req.file)fs.unlinkSync(req.file.path);return res.status(404).json({error:"Product not found."});}oldImage=current.image_url;
    const imageUrl=req.file?`/uploads/products/${path.basename(req.file.path)}`:oldImage;
    await connection.execute("UPDATE products SET product_name=?,description=?,selling_price=?,image_url=?,updated_at=NOW() WHERE product_id=? AND user_id=?",[name,String(p.description||"").slice(0,2000),price,imageUrl,req.params.id,req.user.sub]);
    if(req.file&&oldImage){const oldPath=path.join(uploadsDir,path.basename(oldImage));if(fs.existsSync(oldPath))fs.unlinkSync(oldPath);}
    res.json({product_id:Number(req.params.id),product_name:name,description:String(p.description||""),selling_price:price,image_url:imageUrl});
  } catch(error){if(req.file&&fs.existsSync(req.file.path))fs.unlinkSync(req.file.path);throw error;} finally { connection?.release(); }
}));
app.delete("/api/products/:id", auth, asyncRoute(async (req, res) => {
  const connection = await db();
  try { const [[product]]=await connection.execute("SELECT image_url FROM products WHERE product_id=? AND user_id=?",[req.params.id,req.user.sub]);if(!product)return res.status(404).json({error:"Product not found."});await connection.execute("DELETE FROM products WHERE product_id=? AND user_id=?",[req.params.id,req.user.sub]);if(product.image_url){const file=path.join(uploadsDir,path.basename(product.image_url));if(fs.existsSync(file))fs.unlinkSync(file);}res.status(204).end();}
  finally { connection.release(); }
}));

app.get("/api/expenses", auth, asyncRoute(async (req, res) => { const c=await db();try{const [rows]=await c.execute("SELECT * FROM expenses WHERE user_id=? ORDER BY expense_date DESC,expense_id DESC",[req.user.sub]);res.json(rows);}finally{c.release();} }));
app.post("/api/expenses", auth, asyncRoute(async (req, res) => {
  const amount=Number(req.body.amount);const label=String(req.body.label||"").trim();if(!label||label.length>160||!Number.isFinite(amount)||amount<=0)return res.status(400).json({error:"Enter a description and a positive expense amount."});const c=await db();try{const [r]=await c.execute("INSERT INTO expenses(user_id,plan_id,product_id,label,amount,category,expense_date) VALUES(?,?,?,?,?,?,?)",[req.user.sub,positiveId(req.body.plan_id)?req.body.plan_id:null,positiveId(req.body.product_id)?req.body.product_id:null,label,amount,String(req.body.category||"other").slice(0,60),req.body.expense_date||new Date().toISOString().slice(0,10)]);res.status(201).json({expense_id:r.insertId,...req.body,amount});}finally{c.release();}
}));

function promotionText({ product, price, details, contact, language }) {
  if (language === "en") return `🌸 ${product} 🌸\n${details || "Discover our handmade product!"}\nPrice: ₹${price}${contact ? `\nContact: ${contact}` : ""}\nMessage us to place your order!`;
  return `🌸 ${product} 🌸\n${details || "आमच्या खास उत्पादनाची खरेदी करा!"}\nकिंमत: ₹${price}${contact ? `\nसंपर्क: ${contact}` : ""}\nआजच ऑर्डर करा!`;
}
app.post("/api/promotions/generate", auth, asyncRoute(async (req, res) => {
  const product=String(req.body.product||"").trim();const price=Number(req.body.price);if(!product||!Number.isFinite(price)||price<0)return res.status(400).json({error:"Provide a product name and valid price."});const language=req.body.language==="en"?"en":"mr";const content=promotionText({...req.body,product,price,language});const c=await db();try{const [r]=await c.execute("INSERT INTO promotions(user_id,product_id,language,content) VALUES(?,?,?,?)",[req.user.sub,positiveId(req.body.product_id)?req.body.product_id:null,language,content]);res.status(201).json({promotion_id:r.insertId,content,language});}finally{c.release();}
}));
const defaultActionTasks=[
  ["Choose an idea with Sakhi Saathi","सखी साथीच्या मदतीने कल्पना निवडा"],
  ["Learn the basics","मूलभूत गोष्टी शिका"],
  ["Write down your business plan","व्यवसाय योजना लिहा"],
  ["Work out costs and a fair price","खर्च आणि योग्य किंमत ठरवा"],
  ["Create a product listing","उत्पादन सूची तयार करा"],
  ["Prepare a customer message","ग्राहकांसाठी संदेश तयार करा"],
  ["Practise with a quiz","चाचणीद्वारे सराव करा"]
];
app.get("/api/action-tasks", auth, asyncRoute(async (req, res) => {const c=await db();try{const [existing]=await c.execute("SELECT title FROM action_tasks WHERE user_id=?",[req.user.sub]);for(const [title,mrTitle] of defaultActionTasks)if(!existing.some(row=>row.title===title))await c.execute("INSERT INTO action_tasks(user_id,title,mr_title) VALUES(?,?,?)",[req.user.sub,title,mrTitle]);const [rows]=await c.execute("SELECT task_id,title,mr_title,completed,due_date FROM action_tasks WHERE user_id=? ORDER BY completed,due_date,task_id",[req.user.sub]);res.json(rows);}finally{c.release();}}));
app.post("/api/action-tasks", auth, asyncRoute(async (req,res)=>{const title=String(req.body.title||"").trim();if(!title||title.length>200)return res.status(400).json({error:"A task title is required."});const c=await db();try{const [r]=await c.execute("INSERT INTO action_tasks(user_id,title,mr_title) VALUES(?,?,?)",[req.user.sub,title,String(req.body.mr_title||"").slice(0,200)]);res.status(201).json({task_id:r.insertId,title,mr_title:req.body.mr_title||"",completed:0});}finally{c.release();}}));
app.patch("/api/action-tasks/:id", auth, asyncRoute(async (req,res)=>{if(!positiveId(req.params.id)||typeof req.body.completed!=="boolean")return res.status(400).json({error:"Provide a valid task and completion state."});const c=await db();try{const [r]=await c.execute("UPDATE action_tasks SET completed=? WHERE task_id=? AND user_id=?",[req.body.completed,req.params.id,req.user.sub]);if(!r.affectedRows)return res.status(404).json({error:"Task not found."});res.json({task_id:Number(req.params.id),completed:req.body.completed});}finally{c.release();}}));

app.post("/api/coach/recommend", auth, asyncRoute(async (req,res)=>{
  const budget=Math.max(0,Number(req.body.budget)||0);const category=String(req.body.interests||"food");const ideas={food:{en:"Small-batch snacks or pickles",mr:"लहान प्रमाणातील फराळ किंवा लोणची"},craft:{en:"Made-to-order local crafts",mr:"मागणीनुसार स्थानिक हस्तकला"},stitch:{en:"Alterations and simple stitching",mr:"कपड्यांची दुरुस्ती आणि सोपे शिवणकाम"},service:{en:"A neighbourhood service offer",mr:"शेजारासाठी उपयुक्त सेवा"}};const idea=ideas[category]||ideas.food;const language=req.body.language==="en"?"en":"mr";const recommendation=budget<500?(language==="en"?"Start with samples or a service that needs little stock.":"नमुने किंवा कमी साठा लागणाऱ्या सेवेतून सुरुवात करा."):budget<2500?(language==="en"?"Test demand with a small first batch and keep some money for packaging.":"छोट्या पहिल्या बॅचने मागणी तपासा आणि पॅकिंगसाठी काही रक्कम ठेवा."):(language==="en"?"Keep a reserve; spend in stages after customers show interest.":"काही राखीव रक्कम ठेवा; ग्राहकांचा प्रतिसाद पाहून टप्प्याटप्प्याने खर्च करा.");const c=await db();try{await c.execute("UPDATE users SET coach_interests=?,coach_skills=?,starting_budget=?,hours_available=? WHERE user_id=?",[category,String(req.body.skills||"").slice(0,1000),budget,Math.min(16,Math.max(1,Number(req.body.hours)||2)),req.user.sub]);}finally{c.release();}res.json({idea:idea[language],budget,skills:String(req.body.skills||"").slice(0,1000),available_hours:Math.min(16,Math.max(1,Number(req.body.hours)||2)),recommendation});
}));
app.get("/api/dashboard", auth, asyncRoute(async(req,res)=>{const c=await db();try{const [[profile]] = await c.execute("SELECT user_id,name,email,preferred_language,village FROM users WHERE user_id=?",[req.user.sub]);const [[progress]]=await c.execute("SELECT COUNT(*) AS completed_lessons FROM lesson_progress WHERE user_id=? AND completed=1",[req.user.sub]);const [[plans]]=await c.execute("SELECT COUNT(*) AS saved_plans FROM business_plans WHERE user_id=?",[req.user.sub]);const [[products]]=await c.execute("SELECT COUNT(*) AS products FROM products WHERE user_id=?",[req.user.sub]);const [[quiz]]=await c.execute("SELECT COALESCE(MAX(score),0) AS best_quiz_score FROM quiz_results WHERE user_id=?",[req.user.sub]);res.json({profile,progress,saved_plans:plans.saved_plans,products:products.products,best_quiz_score:quiz.best_quiz_score});}finally{c.release();}}));

app.get("/api/community/groups", auth, asyncRoute(async(req,res)=>{const c=await db();try{const [groups]=await c.execute("SELECT g.group_id,g.name,g.description,g.created_at,COUNT(DISTINCT m.user_id) AS member_count,MAX(m.user_id=?) AS is_member,MAX(IF(m.user_id=?,m.role,NULL)) AS my_role FROM community_groups g LEFT JOIN community_memberships m ON m.group_id=g.group_id GROUP BY g.group_id ORDER BY g.created_at DESC LIMIT 100",[req.user.sub,req.user.sub]);res.json(groups);}finally{c.release();}}));
app.post("/api/community/groups", auth, asyncRoute(async(req,res)=>{const name=String(req.body.name||"").trim(),description=String(req.body.description||"").trim();if(name.length<3||name.length>120||description.length<10||description.length>800)return res.status(400).json({error:"Use a group name of 3–120 characters and a description of 10–800 characters."});const c=await db();try{await c.beginTransaction();const [r]=await c.execute("INSERT INTO community_groups(name,description,created_by) VALUES(?,?,?)",[name,description,req.user.sub]);await c.execute("INSERT INTO community_memberships(group_id,user_id,role) VALUES(?,?,'moderator')",[r.insertId,req.user.sub]);await c.commit();res.status(201).json({group_id:r.insertId,name,description,member_count:1,is_member:1,my_role:"moderator"});}catch(error){await c.rollback();throw error;}finally{c.release();}}));
app.post("/api/community/groups/:id/join", auth, asyncRoute(async(req,res)=>{if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid group ID."});const c=await db();try{const [[group]]=await c.execute("SELECT group_id FROM community_groups WHERE group_id=?",[req.params.id]);if(!group)return res.status(404).json({error:"Group not found."});await c.execute("INSERT IGNORE INTO community_memberships(group_id,user_id) VALUES(?,?)",[req.params.id,req.user.sub]);res.json({group_id:Number(req.params.id),is_member:true});}finally{c.release();}}));
app.get("/api/community/groups/:id/posts", auth, asyncRoute(async(req,res)=>{if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid group ID."});const c=await db();try{const [[member]]=await c.execute("SELECT role FROM community_memberships WHERE group_id=? AND user_id=?",[req.params.id,req.user.sub]);if(!member)return res.status(403).json({error:"Join this group to view its posts."});const [posts]=await c.execute("SELECT p.post_id,p.group_id,p.user_id,p.body,p.status,p.created_at,u.name,COALESCE(pm.post_type,'story') AS post_type,COALESCE(pm.title,'') AS title,pm.link_url,EXISTS(SELECT 1 FROM community_reports cr WHERE cr.post_id=p.post_id AND cr.reporter_id=? AND cr.status='open') AS has_reported FROM community_posts p JOIN users u ON u.user_id=p.user_id LEFT JOIN community_post_meta pm ON pm.post_id=p.post_id WHERE p.group_id=? AND (p.status='visible' OR p.user_id=? OR ?='moderator') ORDER BY p.created_at DESC LIMIT 100",[req.user.sub,req.params.id,req.user.sub,member.role]);res.json(posts);}finally{c.release();}}));
app.get("/api/community/discovery", auth, asyncRoute(async(req,res)=>{const c=await db();try{const [posts]=await c.execute("SELECT p.post_id,p.group_id,p.body,p.created_at,g.name AS group_name,u.name,pm.post_type,pm.title,pm.link_url FROM community_posts p JOIN community_post_meta pm ON pm.post_id=p.post_id JOIN community_groups g ON g.group_id=p.group_id JOIN community_memberships m ON m.group_id=p.group_id AND m.user_id=? JOIN users u ON u.user_id=p.user_id WHERE p.status='visible' AND pm.post_type IN ('opportunity','workshop','resource') ORDER BY p.created_at DESC LIMIT 100",[req.user.sub]);res.json(posts);}finally{c.release();}}));
app.post("/api/community/groups/:id/posts", auth, asyncRoute(async(req,res)=>{const body=String(req.body.body||"").trim(),type=String(req.body.post_type||"story"),title=String(req.body.title||"").trim(),link=String(req.body.link_url||"").trim();if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid group ID."});if(!body||body.length>3000)return res.status(400).json({error:"A post must contain between 1 and 3000 characters."});if(!["story","product","opportunity","workshop","resource"].includes(type)||title.length>160||(type!=="story"&&(title.length<3||!body)))return res.status(400).json({error:"Choose a post type and provide a title between 3 and 160 characters."});if(link){try{const parsed=new URL(link);if(parsed.protocol!=="https:")throw new Error();}catch{return res.status(400).json({error:"Resource links must be valid HTTPS URLs."});}if(link.length>1000)return res.status(400).json({error:"The resource link is too long."});}const c=await db();try{const [[member]]=await c.execute("SELECT user_id FROM community_memberships WHERE group_id=? AND user_id=?",[req.params.id,req.user.sub]);if(!member)return res.status(403).json({error:"Join this group before posting."});await c.beginTransaction();const [r]=await c.execute("INSERT INTO community_posts(group_id,user_id,body,status) VALUES(?,?,?,'under_review')",[req.params.id,req.user.sub,body]);await c.execute("INSERT INTO community_post_meta(post_id,post_type,title,link_url) VALUES(?,?,?,?)",[r.insertId,type,title||body.slice(0,100),link||null]);await c.execute("INSERT INTO community_moderation_log(actor_id,post_id,action,to_status,notes) VALUES(?,?,'submitted','under_review',?)",[req.user.sub,r.insertId,type]);await c.commit();res.status(201).json({post_id:r.insertId,group_id:Number(req.params.id),body,status:"under_review",post_type:type,title:title||body.slice(0,100),link_url:link||null,name:"You",created_at:new Date().toISOString()});}catch(error){await c.rollback();throw error;}finally{c.release();}}));
app.post("/api/community/posts/:id/report", auth, asyncRoute(async(req,res)=>{const reason=String(req.body.reason||"").trim();if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid post ID."});if(reason.length<5||reason.length>300)return res.status(400).json({error:"Describe the concern in 5 to 300 characters."});const c=await db();try{const [[post]]=await c.execute("SELECT post_id,group_id,user_id,status FROM community_posts WHERE post_id=?",[req.params.id]);if(!post)return res.status(404).json({error:"Post not found."});if(Number(post.user_id)===Number(req.user.sub))return res.status(400).json({error:"You cannot report your own post."});const [[member]]=await c.execute("SELECT user_id FROM community_memberships WHERE group_id=? AND user_id=?",[post.group_id,req.user.sub]);if(!member)return res.status(403).json({error:"Join this circle before reporting a post."});const [[existing]]=await c.execute("SELECT report_id FROM community_reports WHERE post_id=? AND reporter_id=? AND status='open' LIMIT 1",[req.params.id,req.user.sub]);if(existing)return res.status(409).json({error:"You already reported this post."});await c.beginTransaction();const [r]=await c.execute("INSERT INTO community_reports(post_id,reporter_id,reason) VALUES(?,?,?)",[req.params.id,req.user.sub,reason]);if(post.status==='visible')await c.execute("UPDATE community_posts SET status='under_review' WHERE post_id=?",[req.params.id]);await c.execute("INSERT INTO community_moderation_log(actor_id,post_id,report_id,action,from_status,to_status,notes) VALUES(?,?,?,'reported',?,'under_review',?)",[req.user.sub,req.params.id,r.insertId,post.status,reason.slice(0,500)]);await c.commit();res.status(201).json({report_id:r.insertId,status:"open"});}catch(error){await c.rollback();throw error;}finally{c.release();}}));
app.get("/api/community/groups/:id/reports", auth, asyncRoute(async(req,res)=>{if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid group ID."});const c=await db();try{const [[moderator]]=await c.execute("SELECT user_id FROM community_memberships WHERE group_id=? AND user_id=? AND role='moderator'",[req.params.id,req.user.sub]);if(!moderator)return res.status(403).json({error:"Only group moderators can view reports."});const [rows]=await c.execute("SELECT cr.report_id,cr.post_id,cr.reason,cr.status AS report_status,cr.created_at AS reported_at,p.body,p.status AS post_status,pm.post_type,pm.title,u.name AS author,r.name AS reporter FROM community_reports cr JOIN community_posts p ON p.post_id=cr.post_id JOIN users u ON u.user_id=p.user_id JOIN users r ON r.user_id=cr.reporter_id LEFT JOIN community_post_meta pm ON pm.post_id=p.post_id WHERE p.group_id=? AND cr.status='open' ORDER BY cr.created_at ASC LIMIT 100",[req.params.id]);res.json(rows);}finally{c.release();}}));
app.patch("/api/community/posts/:id/moderation", auth, asyncRoute(async(req,res)=>{const status=req.body.status;if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid post ID."});if(!["visible","removed","under_review"].includes(status))return res.status(400).json({error:"Invalid moderation status."});const c=await db();try{await c.beginTransaction();const [[post]]=await c.execute("SELECT p.group_id,p.status FROM community_posts p JOIN community_memberships m ON m.group_id=p.group_id AND m.user_id=? AND m.role='moderator' WHERE p.post_id=? FOR UPDATE",[req.user.sub,req.params.id]);if(!post){await c.rollback();return res.status(403).json({error:"Only a group moderator can review this post."});}await c.execute("UPDATE community_posts SET status=? WHERE post_id=?",[status,req.params.id]);await c.execute("INSERT INTO community_moderation_log(actor_id,post_id,action,from_status,to_status) VALUES(?,?,'post_status_changed',?,?)",[req.user.sub,req.params.id,post.status,status]);await c.commit();res.json({post_id:Number(req.params.id),status});}catch(error){await c.rollback();throw error;}finally{c.release();}}));
app.patch("/api/community/reports/:id", auth, asyncRoute(async(req,res)=>{const status=req.body.status;if(!positiveId(req.params.id))return res.status(400).json({error:"Invalid report ID."});if(!["reviewed","dismissed"].includes(status))return res.status(400).json({error:"Invalid report status."});const c=await db();try{await c.beginTransaction();const [[report]]=await c.execute("SELECT cr.status,cr.post_id,p.group_id FROM community_reports cr JOIN community_posts p ON p.post_id=cr.post_id JOIN community_memberships m ON m.group_id=p.group_id AND m.user_id=? AND m.role='moderator' WHERE cr.report_id=? FOR UPDATE",[req.user.sub,req.params.id]);if(!report){await c.rollback();return res.status(403).json({error:"Only a group moderator can resolve reports."});}await c.execute("UPDATE community_reports SET status=? WHERE report_id=?",[status,req.params.id]);await c.execute("INSERT INTO community_moderation_log(actor_id,post_id,report_id,action,from_status,to_status) VALUES(?,?,?,'report_resolved',?,?)",[req.user.sub,report.post_id,req.params.id,report.status,status]);await c.commit();res.json({report_id:Number(req.params.id),status});}catch(error){await c.rollback();throw error;}finally{c.release();}}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
const distDir=path.join(rootDir,"dist");
if(fs.existsSync(path.join(distDir,"index.html"))){
  app.use(express.static(distDir,{index:false}));
  app.get(/.*/, (req,res,next)=>{
    if(req.method!=="GET"||req.path.startsWith("/uploads/"))return next();
    res.sendFile(path.join(distDir,"index.html"));
  });
}
app.use((error, _req, res, _next) => {
  if ((error.status || 500) >= 500) console.error(error);
  const status = error.status || (error instanceof multer.MulterError ? 400 : 500);
  const message=error.publicMessage || (error.code === "ER_NO_SUCH_TABLE" || error.code === "ECONNREFUSED" ? "MySQL is not ready. Create the database with database/schema.sql and check .env." : status>=500 ? "Unexpected server error." : error.message || "The request could not be completed.");
  res.status(status).json({ error: message });
});

if (!jwtSecret) throw new Error("JWT_SECRET must be set in production.");
app.listen(port, process.env.HOST || "0.0.0.0", () => console.log(`SakhiBiz server listening on port ${port}`));
