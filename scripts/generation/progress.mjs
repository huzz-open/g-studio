export async function withProgress(label, action, detail = () => "still running", interval = 5000) {
  const started = performance.now();
  const elapsed = () => `${Math.round((performance.now() - started) / 1000)}s`;
  console.log(`[generation] ${label}: starting`);
  const timer = setInterval(() => {
    console.log(`[generation] ${label}: ${detail()} (elapsed ${elapsed()})`);
  }, interval);
  timer.unref();
  try {
    const result = await action();
    console.log(`[generation] ${label}: complete (elapsed ${elapsed()})`);
    return result;
  } catch (error) {
    console.error(`[generation] ${label}: failed (elapsed ${elapsed()})`);
    throw error;
  } finally {
    clearInterval(timer);
  }
}
