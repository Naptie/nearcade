const fs = require('fs');
const path = require('path');

const envVar = process.env.GSAK_BASE64;
const filePath = path.join(__dirname, 'google-sak.json');

if (envVar) {
  if (!fs.existsSync(filePath)) {
    const decoded = Buffer.from(envVar, 'base64').toString('utf8');
    fs.writeFileSync(filePath, decoded, { encoding: 'utf8' });
    console.log('google-sak.json created.');
  } else {
    console.log('google-sak.json already exists.');
  }
} else {
  console.log('Environment variable GSAK_BASE64 not found.');
}
