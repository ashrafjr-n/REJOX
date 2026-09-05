/**
 * Browser-globals guard (runs last, over the fully-transformed file).
 *
 * This exists because the Validator structurally cannot catch this family.
 * `expo/tsconfig.base` sets `lib: ["DOM", "ESNext"]`, so every browser global
 * type-checks, and Metro bundles them because they are valid JavaScript. An
 * app can pass `tsc` AND `expo export` and still die on its first render —
 * which is exactly how a `localStorage` read reached a simulator.
 *
 * Dropping `DOM` from the emitted tsconfig was measured against the 11-project
 * benchmark and rejected: it catches 31 real bugs and invents 66 false ones on
 * globals React Native genuinely provides (`setTimeout` alone is 48). A gate
 * that fails working code teaches people to ignore it.
 *
 * So this is a CLOSED LIST, maintained here rather than by the compiler:
 * `setTimeout` is not on it and therefore can never be flagged. Each entry
 * carries its own message and its own severity, because these globals are not
 * broken in the same way — see `WEB_GLOBALS` below.
 *
 * `localStorage`/`sessionStorage` are deliberately absent: the storage
 * transform owns them and says something far more specific about each call
 * site. Listing them here too would report every one of them twice.
 */

import { SyntaxKind, type SourceFile } from 'ts-morph';
import type { Ctx } from '../types';
import {
  GLOBAL_HOSTS,
  declaresName,
  isGlobalIdentifier,
  propertyHost,
  recordUnhandled,
  recordWarning,
} from '../util';

interface GlobalRule {
  /** `residue` = it will break and needs a design decision; `warning` = it works. */
  kind: 'residue' | 'warning';
  message: string;
}

const WEB_GLOBALS: Record<string, GlobalRule> = {
  // Absent outright: the first read throws.
  document: {
    kind: 'residue',
    message:
      'document is not defined in React Native — there is no DOM. Reading or ' +
      'querying it throws; express the intent with component state or a ref.',
  },
  history: {
    kind: 'residue',
    message:
      'history is not defined in React Native. Navigation history belongs to ' +
      'React Navigation (navigation.goBack() / navigation.reset()).',
  },
  location: {
    kind: 'residue',
    message:
      'location is not defined in React Native — a native app has no URL bar. ' +
      'The current screen and its params are navigation state (useRoute()).',
  },
  // Present, but WITHOUT the DOM surface — the hardest of the family to spot,
  // because the identifier resolves and nothing throws until a property comes
  // back undefined.
  window: {
    kind: 'residue',
    message:
      'window exists in React Native but carries none of its DOM properties: ' +
      'innerWidth/scrollTo/addEventListener are undefined, so this fails ' +
      'silently rather than loudly. Use useWindowDimensions()/Dimensions, or ' +
      'the matching RN API.',
  },
  navigator: {
    kind: 'residue',
    message:
      'navigator exists in React Native but only as a stub: clipboard/' +
      'geolocation/userAgent are not the DOM ones. Use the Expo module for ' +
      'the capability (expo-clipboard, expo-location).',
  },
  // Present AND working — reported, but never as residue. Claiming this one
  // crashes would be as wrong as missing the others.
  alert: {
    kind: 'warning',
    message:
      'React Native polyfills the global alert(), so this works — but prefer ' +
      "Alert.alert() from 'react-native' (confirm/prompt have no polyfill).",
  },
};

export function transformGlobals(sf: SourceFile, ctx: Ctx): void {
  for (const id of sf.getDescendantsOfKind(SyntaxKind.Identifier)) {
    const name = id.getText();
    const rule = WEB_GLOBALS[name];
    if (!rule) continue;
    if (!isGlobalIdentifier(id)) continue;

    const host = propertyHost(id);
    // `router.location` is someone's field; `window.location` is the global.
    if (host !== undefined && !GLOBAL_HOSTS.has(host)) continue;
    // A file that declares the name itself never meant the global.
    if (host === undefined && declaresName(sf, name)) continue;

    const snippet = id.getParent()?.getText() ?? name;
    if (rule.kind === 'warning') {
      recordWarning(ctx, 'WEB_GLOBAL', rule.message, id.getStartLineNumber());
    } else {
      recordUnhandled(ctx, 'WEB_GLOBAL', rule.message, snippet);
    }
  }
}
