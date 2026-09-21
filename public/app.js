const form = document.querySelector('#form');
const file = document.querySelector('#file');
const drop = document.querySelector('#drop');
const fileName = document.querySelector('#file-name');
const button = document.querySelector('#button');
const status = document.querySelector('#status');
let busy = false;
function setStatus(type, message) { status.className = type; status.textContent = message; }
function showFile(selected) {
  if (!selected) return;
  if (!selected.name.toLowerCase().endsWith('.zip')) { file.value = ''; setStatus('error', 'Please choose a .zip file.'); return; }
  fileName.textContent = selected.name; drop.classList.add('has-file'); drop.querySelector('.drop-title').textContent = 'Project ZIP selected'; setStatus('', '');
}
file.addEventListener('change', () => showFile(file.files[0]));
['dragenter', 'dragover'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('active'); }));
['dragleave', 'drop'].forEach(type => drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('active'); }));
drop.addEventListener('drop', event => { if (event.dataTransfer.files[0]) { file.files = event.dataTransfer.files; showFile(file.files[0]); } });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  if (!file.files[0]) return setStatus('error', 'Choose a project ZIP first.');
  busy = true; button.disabled = true; setStatus('working', 'Building your APK… this may take a few minutes.');
  try {
    const response = await fetch('/api/convert', { method: 'POST', body: new FormData(form) });
    if (!response.ok) {
      const type = response.headers.get('content-type') || '';
      let message = type.includes('application/json') ? (await response.json()).error : await response.text();
      throw new Error(message || `Conversion failed (${response.status})`);
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('The server returned an empty APK.');
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = 'app-debug.apk'; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000); setStatus('success', 'Ready — your APK download has started.');
  } catch (error) { setStatus('error', error.message || 'Conversion failed.'); }
  finally { busy = false; button.disabled = false; }
});
