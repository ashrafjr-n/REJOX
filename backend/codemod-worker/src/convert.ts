/**
 * Conversion orchestrator.
 *
 * Composes the individually-testable transforms over one source file and emits
 * the RN code plus structured warnings and the `unhandled` list (AI Resolution Engine residue).
 * The transform order matters:
 *   links → events → elements → text → imports → TODO header.
 */

import { IndentationText, Project, QuoteKind } from 'ts-morph';
import type { ConvertResult, Ctx, Options } from './types';
import { transformLinks } from './transforms/links';
import { transformEvents } from './transforms/events';
import { transformElements } from './transforms/elements';
import { transformText } from './transforms/text';
import { transformImports } from './transforms/imports';

function newProject(): Project {
  return new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { jsx: 4 /* react-jsx */, allowJs: true },
    manipulationSettings: {
      indentationText: IndentationText.TwoSpaces,
      quoteKind: QuoteKind.Single,
    },
  });
}

function renderTodoHeader(ctx: Ctx): string {
  if (ctx.todos.length === 0) return '';
  const lines = ctx.todos.map((t) => `// REJOX-TODO(${t.code}): ${t.message}`);
  return (
    `// ===== REJOX-TODO: ${ctx.todos.length} item(s) need manual/AI attention =====\n` +
    lines.join('\n') +
    '\n'
  );
}

/** Insert the TODO header after the import block (or at the top). */
function withTodoHeader(sf: ReturnType<Project['createSourceFile']>, ctx: Ctx): void {
  const header = renderTodoHeader(ctx);
  if (!header) return;
  const imports = sf.getImportDeclarations();
  if (imports.length > 0) {
    const last = imports[imports.length - 1];
    sf.insertText(last.getEnd(), `\n\n${header.replace(/\n$/, '')}`);
  } else {
    sf.insertText(0, `${header}\n`);
  }
}

/** Convert one file's source text into RN code + diagnostics. */
export function convert(
  filePath: string,
  source: string,
  _options: Options,
): ConvertResult {
  const project = newProject();
  const sf = project.createSourceFile('input.tsx', source, { overwrite: true });

  const ctx: Ctx = { warnings: [], unhandled: [], todos: [], rnUsed: new Set() };

  transformLinks(sf, ctx);
  transformEvents(sf, ctx);
  transformElements(sf, ctx);
  transformText(sf, ctx);
  transformImports(sf, ctx);
  withTodoHeader(sf, ctx);

  sf.formatText();

  return {
    file: filePath,
    code: sf.getFullText(),
    warnings: ctx.warnings,
    unhandled: ctx.unhandled,
  };
}

/**
 * Re-parse `code` and return the count of syntactic errors. The worker uses
 * this to guarantee the "output must be syntactically valid TS" contract.
 */
export function syntacticErrorCount(code: string): number {
  const project = newProject();
  const sf = project.createSourceFile('check.tsx', code, { overwrite: true });
  return project
    .getProgram()
    .compilerObject.getSyntacticDiagnostics(sf.compilerNode).length;
}
