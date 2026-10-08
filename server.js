const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");

const app = express();
const PORT = 3000;
const ROOT = __dirname;
// Keep writable user data outside Program Files when packaged.
const DATA_ROOT = process.env.FB_MULTI_PAGE_DATA_DIR || path.join(ROOT, "data");
const PROFILE = path.join(DATA_ROOT, "facebook-profile");
const MEDIA = path.join(DATA_ROOT, "media");
const JOB_FILE = path.join(DATA_ROOT, "jobs.json");

for (const d of [DATA_ROOT, path.dirname(PROFILE), MEDIA]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(JOB_FILE)) fs.writeFileSync(JOB_FILE, "[]");

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(ROOT, "public")));

const upload = multer({
  dest: MEDIA,
  limits: { fileSize: 1024 * 1024 * 1024 }
});

let browser = null;
let context = null;
let page = null;
let busy = false;

function jobs() {
  try { return JSON.parse(fs.readFileSync(JOB_FILE, "utf8")); } catch { return []; }
}
function saveJobs(x) { fs.writeFileSync(JOB_FILE, JSON.stringify(x, null, 2)); }
function newid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function findBundledChromium() {
  const roots = [
    path.join(process.resourcesPath || "", "playwright-browsers"),
    path.join(ROOT, "playwright-browsers"),
    path.join(ROOT, "node_modules", "playwright-core", ".local-browsers")
  ];
  const exeNames = process.platform === "win32"
    ? ["chrome.exe"]
    : process.platform === "darwin"
      ? ["Chromium.app/Contents/MacOS/Chromium"]
      : ["chrome"];
  function walk(dir, depth=0) {
    if (!dir || depth > 5 || !fs.existsSync(dir)) return null;
    let entries=[];
    try { entries=fs.readdirSync(dir,{withFileTypes:true}); } catch { return null; }
    for (const e of entries) {
      const full=path.join(dir,e.name);
      if (e.isFile() && exeNames.some(n => e.name === path.basename(n))) return full;
      if (e.isDirectory()) {
        const hit=walk(full, depth+1); if(hit) return hit;
      }
    }
    return null;
  }
  for (const r of roots) { const hit=walk(r); if(hit) return hit; }
  return null;
}

async function ensureBrowser() {
  if (context && !context.browser().isConnected()) {
    context = null; page = null;
  }
  if (!context) {
    const executablePath = findBundledChromium();
    browser = await chromium.launch({ headless: false, ...(executablePath ? { executablePath } : {}) });
    context = await browser.newContext({
      storageState: undefined,
      viewport: { width: 1400, height: 900 },
      locale: "vi-VN"
    });
    page = await context.newPage();
  }
  return page;
}

async function openFacebook() {
  const p = await ensureBrowser();
  await p.goto("https://www.facebook.com/", { waitUntil: "domcontentloaded", timeout: 60000 }).catch(()=>{});
  return p;
}

async function isLoggedIn(p) {
  return await p.locator('input[name="email"], input[name="pass"]').count() === 0;
}

async function discoverPages() {
  const p = await ensureBrowser();
  await p.goto("https://www.facebook.com/pages/?category=your_pages", {
    waitUntil: "domcontentloaded", timeout: 60000
  }).catch(()=>{});
  await p.waitForTimeout(2500);

  const links = await p.locator('a[href*="/"]').evaluateAll(els => els.map(a => ({
    text: (a.innerText || "").trim(),
    href: a.href
  })).filter(x => x.text && x.href && x.href.includes("facebook.com/")));

  const seen = new Set(), out = [];
  for (const x of links) {
    const key = x.href.split("?")[0];
    if (seen.has(key)) continue;
    if (!/facebook\.com\/(pages\/|[^/]+$)/i.test(key)) continue;
    if (/facebook\.com\/(home|watch|marketplace|groups|friends|notifications|messages|settings|help|login|privacy)/i.test(key)) continue;
    seen.add(key);
    out.push({ id: key, name: x.text.slice(0, 100), url: key });
  }
  return out.slice(0, 100);
}

async function firstVisibleButton(p, labels) {
  for (const label of labels) {
    const loc = p.getByRole("button", { name: new RegExp(label, "i") }).filter({ visible: true }).first();
    if (await loc.count()) return loc;
  }
  return null;
}

async function clickCreatePost(p) {
  const labels = [
    "Tạo bài viết", "Create post", "Tạo bài", "Create a post",
    "Bạn đang nghĩ gì", "What's on your mind"
  ];
  for (const label of labels) {
    const l = p.getByText(new RegExp(label, "i")).filter({ visible: true }).first();
    if (await l.count()) {
      await l.click({ timeout: 5000 }).catch(()=>{});
      await p.waitForTimeout(1200);
      return true;
    }
  }
  return false;
}

async function fillComposer(p, text, file) {
  const dialog = p.getByRole("dialog").filter({ visible: true }).last();
  const scope = await dialog.count() ? dialog : p;

  // Contenteditable is used by Facebook's composer.
  const editor = scope.locator('[contenteditable="true"]').filter({ visible: true }).last();
  if (await editor.count()) {
    await editor.click();
    await editor.fill(text || "");
  } else if (text) {
    throw new Error("Không tìm thấy ô nhập nội dung bài viết.");
  }

  if (file) {
    const inputs = scope.locator('input[type="file"]');
    if (await inputs.count()) {
      await inputs.last().setInputFiles(file);
    } else {
      // Click photo/video control to reveal the file input.
      const mediaBtn = await firstVisibleButton(p, [
        "Ảnh/video", "Photo/video", "Add photo", "Add video",
        "Thêm ảnh", "Thêm video"
      ]);
      if (mediaBtn) await mediaBtn.click().catch(()=>{});
      await p.waitForTimeout(700);
      const allInputs = p.locator('input[type="file"]');
      if (!(await allInputs.count())) throw new Error("Không tìm thấy ô tải ảnh/video của Facebook.");
      await allInputs.last().setInputFiles(file);
    }
    await p.waitForTimeout(1800);
  }
}

async function publishOnPage(job) {
  const p = await ensureBrowser();
  await p.goto(job.pageUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
  await p.waitForTimeout(1800);

  if (!await isLoggedIn(p)) throw new Error("Facebook chưa đăng nhập trong phiên của tool.");

  const created = await clickCreatePost(p);
  if (!created) throw new Error("Không tìm thấy nút Tạo bài viết trên Page. Facebook có thể đã thay đổi giao diện.");

  await fillComposer(p, job.message, job.mediaPath);

  const publish = await firstVisibleButton(p, ["Đăng", "Post", "Publish", "Chia sẻ ngay", "Share now"]);
  if (!publish) throw new Error("Không tìm thấy nút Đăng.");

  await publish.click({ timeout: 10000 });
  await p.waitForTimeout(2500);
}

async function runJob(job) {
  if (busy) return;
  busy = true;
  const all = jobs();
  const current = all.find(x => x.id === job.id);
  if (!current) { busy = false; return; }
  current.status = "running";
  current.results = current.results || [];
  saveJobs(all);

  for (const target of current.pages) {
    try {
      await publishOnPage({
        pageUrl: target.url,
        message: current.message,
        mediaPath: current.mediaPath
      });
      current.results.push({ page: target.name, ok: true, at: new Date().toISOString() });
    } catch (e) {
      current.results.push({ page: target.name, ok: false, error: e.message, at: new Date().toISOString() });
    }
    saveJobs(jobs().map(x => x.id === current.id ? current : x));
    await new Promise(r => setTimeout(r, 1800));
  }

  current.status = "done";
  current.finishedAt = new Date().toISOString();
  saveJobs(jobs().map(x => x.id === current.id ? current : x));
  busy = false;
}

setInterval(() => {
  if (busy) return;
  const now = Date.now();
  const pending = jobs().find(x => x.status === "scheduled" && new Date(x.runAt).getTime() <= now);
  if (pending) runJob(pending).catch(console.error);
}, 5000);

app.post("/api/login", async (req, res) => {
  try {
    const p = await openFacebook();
    res.json({ ok: true, loggedIn: await isLoggedIn(p) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get("/api/status", async (req, res) => {
  try {
    const p = await ensureBrowser();
    res.json({ ok: true, loggedIn: await isLoggedIn(p), busy });
  } catch (e) { res.json({ ok: false, loggedIn: false, busy }); }
});

app.get("/api/pages", async (req, res) => {
  try {
    const p = await ensureBrowser();
    if (!await isLoggedIn(p)) return res.status(401).json({ error: "Hãy đăng nhập Facebook trước." });
    res.json({ pages: await discoverPages() });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post("/api/post", upload.single("media"), async (req, res) => {
  try {
    const pages = JSON.parse(req.body.pages || "[]");
    const message = (req.body.message || "").trim();
    const runAt = req.body.runAt ? new Date(req.body.runAt) : new Date();

    if (!pages.length) return res.status(400).json({ error: "Chưa chọn Page." });
    if (!message && !req.file) return res.status(400).json({ error: "Cần nội dung hoặc ảnh/video." });
    if (Number.isNaN(runAt.getTime())) return res.status(400).json({ error: "Thời gian không hợp lệ." });

    const job = {
      id: newid(),
      pages,
      message,
      mediaPath: req.file ? req.file.path : null,
      mediaName: req.file ? req.file.originalname : null,
      runAt: runAt.toISOString(),
      createdAt: new Date().toISOString(),
      status: runAt.getTime() <= Date.now() ? "queued" : "scheduled",
      results: []
    };
    const list = jobs(); list.push(job); saveJobs(list);

    if (job.status === "queued") runJob(job).catch(console.error);
    res.json({ ok: true, job });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.get("/api/jobs", (req, res) => res.json(jobs().sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt))));

app.post("/api/cancel/:id", (req,res) => {
  const list = jobs(), job = list.find(x=>x.id===req.params.id);
  if (!job) return res.status(404).json({error:"Không tìm thấy lịch."});
  if (!["scheduled","queued"].includes(job.status)) return res.status(400).json({error:"Bài đã chạy hoặc hoàn tất."});
  job.status="cancelled";
  if (job.mediaPath && fs.existsSync(job.mediaPath)) fs.unlinkSync(job.mediaPath);
  saveJobs(list); res.json({ok:true});
});

app.get("*splat", (req,res)=>res.sendFile(path.join(ROOT,"public","index.html")));

app.listen(PORT, ()=>console.log(`Facebook Multi-Page: http://localhost:${PORT}`));
