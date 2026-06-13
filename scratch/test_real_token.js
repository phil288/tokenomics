const fs = require('fs');
const path = require('path');

const settingsPath = path.join(__dirname, '..', 'data', 'settings.json');
let token = '';
try {
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  token = settings.CURSOR_ACCESS_TOKEN;
} catch (e) {
  console.error('Error reading settings.json:', e.message);
}

if (!token) {
  console.log('No token found in settings.json.');
  process.exit(0);
}

console.log('Using token from settings.json. Length:', token.length);

async function testEndpoint(url, headers) {
  try {
    const res = await fetch(url, { headers });
    console.log(`URL: ${url}`);
    console.log(`Status: ${res.status}`);
    const text = await res.text();
    console.log(`Response snippet:`, text.substring(0, 800));
    return res.status === 200;
  } catch (e) {
    console.error('Error:', e.message);
    return false;
  }
}

async function run() {
  const headers = {
    'Authorization': 'Basic ' + Buffer.from(token + ':').toString('base64'),
    'Accept': 'application/json'
  };

  await testEndpoint('https://api.cursor.com/analytics/team/plans', headers);
  await testEndpoint('https://api.cursor.com/analytics/team/leaderboard', headers);
}

run();
