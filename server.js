const express = require('express');
const multer = require('multer');
const unzipper = require('unzipper');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_UPLOAD = 200 * 1024 * 1024;
const MAX_EXTRACTED = 1024 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD, files: 1 },
  fileFilter: (_, file, cb) => cb(null, path.extname(file.originalname).toLowerCase() === '.zip')
});
app.use(express.static(path.join(__dirname, 'public')));

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
      entry.stream().pipe(fs.createWriteStream(target)).on('finish', resolve).on('error', reject);
    });
  }
}

async function findProjectRoot(base) {
  const queue = [{ dir: base, depth: 0 }];
  while (queue.length) {
    const { dir, depth } = queue.shift();
    const names = await fsp.readdir(dir);
    if (names.includes('settings.gradle') || names.includes('settings.gradle.kts') || names.includes('build.gradle') || names.includes('build.gradle.kts')) return dir;
    if (depth < 3) for (const name of names) {
      if (name === 'node_modules' || name === '.git' || name.startsWith('.')) continue;
      const full = path.join(dir, name);
      if ((await fsp.stat(full)).isDirectory()) queue.push({ dir: full, depth: depth + 1 });
    }
  }
  throw new Error('No Android Gradle project was found. Include settings.gradle or build.gradle in the ZIP.');
}

function run(command, args, cwd, timeoutMs = 12 * 60 * 1000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, CI: 'true' }, shell: false });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('Build timed out after 12 minutes.')); }, timeoutMs);
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); code === 0 ? resolve(output) : reject(new Error(`Gradle exited with code ${code}.\n${output.slice(-6000)}`)); });
  });
}

async function locateApk(root) {
  const found = [];
  async function walk(dir) {
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      if (item.name === '.gradle' || (item.name === 'build' && dir === root)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) await walk(full); else if (item.name.endsWith('.apk')) found.push(full);
    }
  }
  await walk(root);
  const debug = found.find(file => /debug/i.test(file));
  if (!debug && !found[0]) throw new Error('The build completed, but no APK was found. Try a project with an Android application module.');
  return debug || found[0];
}

app.post('/api/convert', upload.single('project'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Upload one .zip Android project.' });
  const work = await fsp.mkdtemp(path.join(os.tmpdir(), 'zip-apk-'));
  try {
    const zipPath = path.join(work, 'project.zip');
    // Multer uses memoryStorage, so req.file.path is not available. Persist the
    // uploaded buffer inside the per-request temporary directory instead.
    await fsp.writeFile(zipPath, req.file.buffer);
    const source = path.join(work, 'source');
    await fsp.mkdir(source);
    await extractZip(zipPath, source);
    const root = await findProjectRoot(source);
    const wrapper = path.join(root, process.platform === 'win32' ? 'gradlew.bat' : 'gradlew');
    let command = fs.existsSync(wrapper) ? wrapper : 'gradle';
    if (command !== 'gradle') await fsp.chmod(wrapper, 0o755);
    await run(command, ['assembleDebug', '--no-daemon', '--stacktrace'], root);
    const apk = await locateApk(root);
    res.download(apk, path.basename(apk), err => { if (err && !res.headersSent) res.status(500).json({ error: err.message }); });
  } catch (error) {
    console.error(error);
    if (!res.headersSent) res.status(422).json({ error: error.message || 'Conversion failed.' });
  } finally {
    setTimeout(() => fsp.rm(work, { recursive: true, force: true }).catch(() => {}), 30_000);
  }
});
app.use((err, _req, res, _next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: err.message || 'Invalid upload.' }));
app.listen(PORT, '0.0.0.0', () => console.log(`ZIP-to-APK converter listening on port ${PORT}`));
