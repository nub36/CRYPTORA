const fs = require('fs');
const path = require('path');

const jsPath = path.resolve(__dirname, '../node_modules/playwright/jsx-runtime.js');
const mjsPath = path.resolve(__dirname, '../node_modules/playwright/jsx-runtime.mjs');

if (fs.existsSync(path.dirname(jsPath))) {
  fs.writeFileSync(jsPath, "module.exports = require('react/jsx-runtime');\n");
  fs.writeFileSync(
    mjsPath,
    "import * as jsxRuntime from 'react/jsx-runtime';\nexport const { jsx, jsxs, Fragment } = jsxRuntime;\nexport default jsxRuntime;\n"
  );
  console.log('[patch-playwright-jsx] Successfully patched playwright jsx-runtime to use react/jsx-runtime');
}
