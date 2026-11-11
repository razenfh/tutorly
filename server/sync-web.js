'use strict';
// Копирует board.js и live.js из программы на страницу ученика. Запускайте после изменений доски: npm run sync
const fs = require('fs');
const path = require('path');
['board.js', 'live.js'].forEach((f) => {
  fs.copyFileSync(path.join(__dirname, '..', 'renderer', f), path.join(__dirname, 'public', f));
  console.log('скопирован', f);
});
