/** One problem found while validating a settings file. */
export interface ConfigProblem<Code extends string = string> {
  code: Code;
  /** JSON-pointer-like location inside the document. */
  path: string;
  message: string;
}
