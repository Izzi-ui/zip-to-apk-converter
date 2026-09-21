const form = document.querySelector('#form');
const file = document.querySelector('#file');
const drop = document.querySelector('#drop');
const fileName = document.querySelector('#file-name');
const button = document.querySelector('#button');
const status = document.querySelector('#status');

function showFile(selected) {
  if (!selected) return;
  fileName.textContent = selected.name;
  drop.classList.add('has-file');
  drop.querySelector('.drop-title').textContent = 'Project ZIP selected';
}
file.addEventListener('change', () => showFile(file.files[0]));
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('active'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('active'); }));
drop.addEventListener('drop', event => { if (event.dataTransfer.files[0]) { file.files = event.dataTransfer.files; showFile(file.files[0]); } });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!file.files[0]) return;
  button.disabled = true;
  status.className = 'working';
  status.textContent = 'Building your APK… this may take a few minutes.';
  try {
    const response = await fetch('/api/convert', { method: 'POST', body: new FormData(form) });
    if (!response.ok) {
      const type = response.headers.get('content-type') || '';
      const message = type.includes('application/json') ? (await response.json()).error : await response.text();
      throw new Error(message || `Conversion failed (${response.status})`);
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement('a'); link.href = url; link.download = 'app-debug.apk'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.className = 'success'; status.textContent = 'Ready — your APK download has started.';
  } catch (error) { status.className = 'error'; status.textContent = error.message || 'Conversion failed.'; }
  finally { button.disabled = false; }
});
