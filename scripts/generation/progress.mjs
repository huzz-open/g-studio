export function formatDuration(seconds) {
  const value = Math.max(0, Math.round(seconds));
  return value >= 60 ? `${Math.floor(value / 60)}m ${String(value % 60).padStart(2, '0')}s` : `${value}s`;
}

export function fitProgress(detail, width) {
  const available = Math.max(1, width - 1);
  let line = `  ${detail}`;
  if (line.length > available) line = `  ${detail.replace(/^\[[#-]+\]\s*/, '')}`;
  return line.slice(0, available);
}

export async function withProgress(label, action, detail, interval = 200, stream = process.stderr) {
  const started = performance.now();
  const elapsed = () => formatDuration((performance.now() - started) / 1000);
  console.log(`[generation] ${label}: starting`);
  // Child processes own their terminal progress. Only render our own measured
  // progress when a detail callback is supplied, and never animate log files.
  const clear = () => stream.write('\r\x1b[2K');
  const interactive = stream.isTTY || (stream === process.stderr && process.env.GEN_PROGRESS === '1');
  const timer = detail && interactive ? setInterval(() => {
    // The stage heading already contains the full filename. Reserve the live
    // line for measurements, dropping the bar first on narrow terminals.
    const line = fitProgress(detail(), stream.columns || Number(process.env.COLUMNS) || 100);
    clear();
    stream.write(line);
  }, interval) : undefined;
  timer?.unref();
  const stop = () => { clearInterval(timer); if (timer) clear(); };
  try {
    const result = await action();
    stop();
    console.log(`[generation] ${label}: complete | ${elapsed()}`);
    return result;
  } catch (error) {
    stop();
    console.error(`[generation] ${label}: failed | ${elapsed()}`);
    throw error;
  } finally {
    clearInterval(timer);
  }
}
