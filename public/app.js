const form = document.querySelector('#form');
const file = document.querySelector('#file');
const drop = document.querySelector('#drop');
const button = document.querySelector('#button');
const status = document.querySelector('#status');
file.addEventListener('change', () => { if (file.files[0]) { drop.querySelector('strong').textContent = file.files[0].name; drop.querySelector('small').textContent = 'Ready to build'; } });
['dragenter', 'dragover'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.add('active'); }));
['dragleave', 'drop'].forEach(event => drop.addEventListener(event, e => { e.preventDefault(); drop.classList.remove('active'); }));
drop.addEventListener('drop', e => { if (e.dataTransfer.files[0]) { file.files = e.dataTransfer.files; file.dispatchEvent(new Event('change')); } });
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (!file.files[0]) return;
  button.disabled = true;
  status.className = 'working';
  status.textContent = 'Building… this can take several minutes.';
  try {
    const response = await fetch('/api/convert', { method: 'POST', body: new FormData(form) });
    if (!response.ok) {
      const type = response.headers.get('content-type') || '';
      const message = type.includes('application/json') ? (await response.json()).error : await response.text();
      throw new Error(message || `Conversion failed (${response.status})`);
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'app-debug.apk';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.className = 'success';
    status.textContent = 'Done — your APK download has started.';
  } catch (error) {
    status.className = 'error';
    status.textContent = error.message || 'Conversion failed.';
  } finally { button.disabled = false; }
});
