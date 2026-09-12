const fs = require('fs');
const path = require('path');
const OUT = 'c:\\Users\\Administrator\\Webstrom\\NEOP\\_logs\\hello.txt';
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `HELLO from ${process.cwd()} at ${new Date().toISOString()}\n` + JSON.stringify(process.argv));
