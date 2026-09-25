/**
 * Single entry point for the bundled codemod-worker (`codemod.js`):
 *
 *   node codemod.js <convert|check|apply|css|cssmodule> …args
 *
 * One bundle carries ts-morph + TypeScript once instead of once per command.
 * The command is spliced out of argv so each module sees the arguments it
 * always has (`process.argv[2]` onwards) and runs exactly as `dist/<cmd>.js`.
 */

const command = process.argv.splice(2, 1)[0];

switch (command) {
  case 'convert':
    require('./index');
    break;
  case 'check':
    require('./check');
    break;
  case 'apply':
    require('./apply');
    break;
  case 'css':
    require('./css');
    break;
  case 'cssmodule':
    require('./cssmodule');
    break;
  default:
    process.stderr.write(`Unknown codemod command: ${command ?? '(none)'}\n`);
    process.exit(1);
}
