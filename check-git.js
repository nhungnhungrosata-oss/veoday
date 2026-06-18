const cp = require('child_process');
console.log(cp.execSync('git ls-tree -r HEAD --name-only').toString());
