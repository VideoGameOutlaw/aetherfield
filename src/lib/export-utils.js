export function createExportFilename(settings, extension, date = new Date()) {
  const seed = String(settings.seed)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'field';
  const preset = String(settings.preset).replace(/[^a-z0-9-]/gi, '') || 'untitled';
  const suffix = String(extension).replace(/[^a-z0-9]/gi, '').toLowerCase();
  const timestamp = date.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
  return `aetherfield-${preset}-${seed}-${timestamp}.${suffix}`;
}

export function selectRecorderMimeType(isTypeSupported) {
  return [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4',
  ].find((type) => isTypeSupported(type)) ?? '';
}
