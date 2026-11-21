'use strict';
// Копирует board.js, live.js и theme.js из программы на страницу ученика. Запускайте после изменений доски или темы: npm run sync
const fs = require('fs');
const path = require('path');
['board.js', 'live.js', 'theme.js'].forEach((f) => {
  fs.copyFileSync(path.join(__dirname, '..', 'renderer', f), path.join(__dirname, 'public', f));
  console.log('скопирован', f);
});
