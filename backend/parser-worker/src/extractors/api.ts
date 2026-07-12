/**
 * API-layer extraction.
 *
 * Detects HTTP clients and the endpoints they call:
 *   - Axios: `axios.create({ baseURL })` instances and direct `axios.*` usage.
 *   - fetch: global `fetch(url, ...)` calls.
 *
 * Endpoints are only recorded for calls whose target is a known axios instance
 * (or `fetch`) and whose URL is a static string / template literal. Dynamic
 * URLs that can't be read statically are left as null, never guessed.
 */

import { Node, SyntaxKind, type SourceFile } from 'ts-morph';
import { isHttpMethod } from '../util';
import type { ApiClient, Endpoint } from '../types';

export interface FileApiInfo {
  clients: ApiClient[];
  /** Local identifiers in this file that refer to an axios instance. */
  axiosInstanceNames: string[];
  usesFetch: boolean;
  definesAxiosClient: boolean;
}

export function clientId(file: string, label: string): string {
  return `${file}#${label}`;
}

/** Reconstruct a display URL from a string or template literal, else null. */
function readUrl(node: Node | undefined): string | null {
  if (!node) return null;
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) {
    return node.getLiteralText();
  }
  if (Node.isTemplateExpression(node)) {
    let out = node.getHead().getLiteralText();
    for (const span of node.getTemplateSpans()) {
      out += '${' + span.getExpression().getText() + '}';
      out += span.getLiteral().getLiteralText();
    }
    return out;
  }
  return null;
}

/** Local names bound to axios's default export in this file. */
function axiosDefaultNames(sourceFile: SourceFile): Set<string> {
  const names = new Set<string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    if (imp.getModuleSpecifierValue() !== 'axios') continue;
    const def = imp.getDefaultImport();
    if (def) names.add(def.getText());
  }
  return names;
}

export function extractApiFile(
  sourceFile: SourceFile,
  fileRel: string,
): FileApiInfo {
  const axiosNames = axiosDefaultNames(sourceFile);
  const instanceNames = new Set<string>(axiosNames);
  const clients: ApiClient[] = [];
  let definesAxiosClient = false;

  // axios.create({ baseURL }) instances.
  for (const decl of sourceFile.getVariableDeclarations()) {
    const init = decl.getInitializer();
    if (!init || !Node.isCallExpression(init)) continue;
    const callee = init.getExpression();
    if (!Node.isPropertyAccessExpression(callee)) continue;
    if (callee.getName() !== 'create') continue;
    const obj = callee.getExpression();
    if (!Node.isIdentifier(obj) || !axiosNames.has(obj.getText())) continue;

    definesAxiosClient = true;
    instanceNames.add(decl.getName());

    let baseURL: string | null = null;
    const arg = init.getArguments()[0];
    if (arg && Node.isObjectLiteralExpression(arg)) {
      const prop = arg.getProperty('baseURL');
      if (prop && Node.isPropertyAssignment(prop)) {
        baseURL = readUrl(prop.getInitializer());
      }
    }
    clients.push({
      id: clientId(fileRel, decl.getName()),
      library: 'axios',
      file: fileRel,
      baseURL,
    });
  }

  // fetch usage.
  let usesFetch = false;
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression();
    if (Node.isIdentifier(expr) && expr.getText() === 'fetch') {
      usesFetch = true;
      break;
    }
  }
  if (usesFetch) {
    clients.push({
      id: clientId(fileRel, 'fetch'),
      library: 'fetch',
      file: fileRel,
      baseURL: null,
    });
  }

  return {
    clients,
    axiosInstanceNames: [...instanceNames],
    usesFetch,
    definesAxiosClient,
  };
}

export function extractEndpoints(
  sourceFile: SourceFile,
  fileRel: string,
  axiosNames: Set<string>,
): Endpoint[] {
  const endpoints: Endpoint[] = [];

  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const callee = call.getExpression();
    const args = call.getArguments();

    // axiosInstance.<method>(url, ...)
    if (Node.isPropertyAccessExpression(callee)) {
      const obj = callee.getExpression();
      const method = callee.getName();
      if (
        Node.isIdentifier(obj) &&
        axiosNames.has(obj.getText()) &&
        isHttpMethod(method)
      ) {
        endpoints.push({
          method: method.toUpperCase(),
          url: readUrl(args[0]),
          file: fileRel,
        });
      }
      continue;
    }

    // fetch(url, { method })
    if (Node.isIdentifier(callee) && callee.getText() === 'fetch') {
      let method = 'GET';
      const opts = args[1];
      if (opts && Node.isObjectLiteralExpression(opts)) {
        const m = opts.getProperty('method');
        if (m && Node.isPropertyAssignment(m)) {
          const v = readUrl(m.getInitializer());
          if (v) method = v.toUpperCase();
        }
      }
      endpoints.push({ method, url: readUrl(args[0]), file: fileRel });
    }
  }

  return endpoints;
}
