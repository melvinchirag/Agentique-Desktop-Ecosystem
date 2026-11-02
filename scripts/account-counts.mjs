const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_KEY in the environment.');
  process.exit(2);
}

try {
  const names = ['installs_total', 'daily_active', 'weekly_active'];
  const counts = await Promise.all(names.map(async name => {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${name}?select=count`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('Counts request failed.');
    const rows = await response.json();
    if (!Array.isArray(rows) || rows.length !== 1 || !Number.isFinite(Number(rows[0].count)))
      throw new Error('Counts response was invalid.');
    return Number(rows[0].count);
  }));
  console.log(`${new Date().toISOString().slice(0, 10)}  Installs: ${counts[0]}  DAU: ${counts[1]}  WAU: ${counts[2]}`);
} catch {
  console.error('Could not read account counts.');
  process.exitCode = 1;
}
