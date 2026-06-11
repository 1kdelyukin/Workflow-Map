// Import orchestration: file picker, window-wide drag & drop, validation feedback, install.
import { parseImportText } from './transfer.js';
import { state, installProject, openProject, emit } from './state.js';
import { toast, openModal, esc } from './ui.js';
import { icon } from './icons.js';

export function openImportPicker() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,.md,application/json,text/markdown';
  input.multiple = true;
  input.addEventListener('change', () => importFiles(input.files));
  input.click();
}

export async function importFiles(fileList) {
  const files = [...(fileList || [])];
  if (!files.length) return;
  const installed = [];
  const allWarnings = [];

  for (const file of files) {
    let text;
    try { text = await file.text(); } catch {
      toast(`Couldn't read “${file.name}”.`, { type: 'error' });
      continue;
    }
    try {
      const { kind, projects, warnings } = parseImportText(text, file.name);
      for (const p of projects) {
        const inst = await installProject(p, { silent: true });
        installed.push(inst);
      }
      allWarnings.push(...warnings);
      if (kind === 'backup') toast(`Restored ${projects.length} project${projects.length === 1 ? '' : 's'} from backup.`, { type: 'ok' });
    } catch (e) {
      toast(e.message || `Couldn't import “${file.name}”.`, { type: 'error', timeout: 8000 });
    }
  }

  if (!installed.length) return;
  emit('projects');

  if (allWarnings.length) {
    toast(`Imported with ${allWarnings.length} warning${allWarnings.length === 1 ? '' : 's'}.`, {
      type: 'warn', timeout: 8000,
      action: { label: 'Details', fn: () => showWarnings(allWarnings) },
    });
  }

  if (installed.length === 1) {
    const p = installed[0];
    const layers = new Set(p.nodes.filter((n) => p.nodes.some((m) => m.parentId === n.id)).map((n) => n.id));
    toast(`Imported “${p.name}” — ${p.nodes.length} components, ${p.edges.length} connections${layers.size ? `, ${layers.size} container${layers.size === 1 ? '' : 's'}` : ''}.`, { type: 'ok', timeout: 6000 });
    if (state.mode === 'library') openProject(p.id);
  }
}

function showWarnings(warnings) {
  const shown = warnings.slice(0, 14);
  openModal({
    title: 'Import notes',
    width: 520,
    content: `
      <div class="confirm-body">The import succeeded; a few things were repaired along the way:</div>
      <ul class="warn-list">${shown.map((w) => `<li>${icon('warn')}<span>${esc(w)}</span></li>`).join('')}</ul>
      ${warnings.length > shown.length ? `<div class="confirm-body">…and ${warnings.length - shown.length} more.</div>` : ''}`,
  });
}

/* window-wide drag & drop */
export function wireDropImport() {
  const overlay = document.createElement('div');
  overlay.className = 'dropzone';
  overlay.hidden = true;
  overlay.innerHTML = `<div class="dropzone-card">${icon('upload')}<div class="dz-title">Drop to import</div><div class="dz-sub">.agentmap.json project · backup · handoff .md</div></div>`;
  document.body.appendChild(overlay);

  let depth = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');

  window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    overlay.hidden = false;
  });
  window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener('dragleave', (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.hidden = true;
  });
  window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0;
    overlay.hidden = true;
    importFiles(e.dataTransfer.files);
  });
}
