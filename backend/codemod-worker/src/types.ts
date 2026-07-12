/** Types for the codemod worker. */

/** Answered Ask-stage options that steer the conversion. */
export interface Options {
  projectType?: string;
  stylingEngine?: string;
  navigationLibrary?: string;
  [key: string]: unknown;
}

export interface Warning {
  code: string;
  message: string;
  line: number;
}

/** Something the deterministic codemod could not safely resolve — Part 2 (LLM). */
export interface Unhandled {
  code: string;
  snippet: string;
}

export interface ConvertResult {
  file: string;
  code: string;
  warnings: Warning[];
  unhandled: Unhandled[];
}

/** Mutable state threaded through the transforms. */
export interface Ctx {
  warnings: Warning[];
  unhandled: Unhandled[];
  /** TODO lines rendered into the output header block. */
  todos: { code: string; message: string }[];
  /** RN components that must be imported from 'react-native'. */
  rnUsed: Set<string>;
}
