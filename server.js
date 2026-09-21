const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_EXTRACTED = 1024 * 1024 * 1024;
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD, files: 1 },
  fileFilter: (_, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.zip') return cb(new Error('Only .zip files are supported.'));
    cb(null, true);
  }
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/healthz', (_req, res) => res.json({ ok: true }));

function safeArchivePath(name) {
  const normalized = path.posix.normalize(String(name).replaceAll('\\', '/'));
  return normalized !== '..' && !normalized.startsWith('../') && !path.posix.isAbsolute(normalized) && !normalized.includes('\0');
}

async function extractZip(zipPath, destination) {
  let extracted = 0;
  const directory = await unzipper.Open.file(zipPath);
  for (const entry of directory.files) {
    if (!safeArchivePath(entry.path)) throw new Error('The ZIP contains an unsafe path.');
    if (entry.type === 'Directory') continue;
    extracted += Number(entry.uncompressedSize || 0);
    if (extracted > MAX_EXTRACTED) throw new Error('The extracted project is too large (1 GB maximum).');
    const target = path.resolve(destination, entry.path);
    if (!target.startsWith(path.resolve(destination) + path.sep)) throw new Error('The ZIP contains an unsafe path.');
    await fsp.mkdir(path.dirname(target), { recursive: true });
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(target);
      output.on('finish', resolve);
      output.on('error', reject);
      entry.stream().on('error', reject).pipe(output);
    });
  }
}

async function findProjectRoot(base) {
  const queue = [{ dir: base, depth: 0 }];
  let fallback = null;
  while (queue.length) {
    const { dir, depth } = queue.shift();
    const names = await fsp.readdir(dir, { withFileTypes: true });
    const hasGradleRoot = names.some(item => ['settings.gradle', 'settings.gradle.kts', 'gradlew', 'gradlew.bat'].includes(item.name));
    if (hasGradleRoot) return dir;
    const hasBuildFile = names.some(item => ['build.gradle', 'build.gradle.kts'].includes(item.name));
    if (hasBuildFile && !fallback) fallback = dir;
    if (depth < 4) {
      for (const item of names) {
        if (!item.isDirectory() || item.name === 'node_modules' || item.name === '.git' || item.name.startsWith('.')) continue;
        queue.push({ dir: path.join(dir, item.name), depth: depth + 1 });
      }
    }
  }
  if (fallback) return fallback;
  throw new Error('No Android Gradle project was found. Include settings.gradle or build.gradle in the ZIP.');
}

function run(command, args, cwd, timeoutMs = 12 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const resolvedCommand = command.startsWith('/') ? command : path.join(cwd, command);
    const child = spawn(resolvedCommand, args, { cwd, env: { ...process.env, CI: 'true', GRADLE_OPTS: '-Dorg.gradle.daemon=false' }, shell: false });
    let output = '';
    const collect = data => { output += data.toString(); if (output.length > 12000) output = output.slice(-12000); };
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Build timed out after 12 minutes.')); }, timeoutMs);
    child.once('error', error => { clearTimeout(timer); reject(error.code === 'ENOENT' ? new Error('Gradle is unavailable. Redeploy the latest Docker image.') : error); });
    child.once('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Gradle exited with code ${code}.\n${output}`)); });
  });
}

async function locateApk(root) {
  const found = [];
  async function walk(dir) {
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      if (item.name === '.gradle' || item.name === '.git' || item.name === 'build' && dir === root) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full); else if (item.name.toLowerCase().endsWith('.apk')) found.push(full);
    }
  }
  await walk(root);
  const apk = found.find(file => /debug/i.test(file)) || found[0];
  if (!apk) throw new Error('Build succeeded but no APK was found. The ZIP needs an Android application module.');
  return apk;
}

app.post('/api/convert', upload.single('project'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload one Android project ZIP.' });
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-apk-'));
  try {
    const zipPath = path.join(work, 'project.zip');
    await fsp.rename(req.file.path, zipPath);
    const source = path.join(work, 'source');
    await fsp.mkdir(source);
    await extractZip(zipPath, source);
    const root = await findProjectRoot(source);
    const wrapper = path.join(root, 'gradlew');
    const command = fs.existsSync(wrapper) ? './gradlew' : 'gradle';
    if (command === './gradlew') await fsp.chmod(wrapper, 0o755);
    await run(command, ['assembleDebug', '--no-daemon', '--stacktrace'], root);
    const apk = await locateApk(root);
    res.download(apk, path.basename(apk));
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(422).json({ error: error.message || 'Conversion failed.' });
  } finally {
    if (req.file?.path) fsp.rm(req.file.path, { force: true }).catch(() => {});
    setTimeout(() => fsp.rm(work, { recursive: true, force: true }).catch(() => {}), 30_000);
  }
});
app.use((err, _req, res, _next) => {
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  res.status(status).json({ error: err.message || 'Invalid upload.' });
});
app.listen(PORT, '0.0.0.0', () => console.log(`ZIP-to-APK converter listening on port ${PORT}`));
