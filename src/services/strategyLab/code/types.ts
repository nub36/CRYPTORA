export const CODE_LIMITS = Object.freeze({ maxSourceLength: 32 * 1024, maxTokens: 2048 });
export type CodePosition = { line: number; column: number };
export type CodeError = CodePosition & { message: string };
export type Expr = { kind: 'identifier'; name: string } | { kind: 'number'; value: number } | { kind: 'call'; callee: string; args: Expr[] };
export type Statement = { kind: 'const'; name: string; expression: Expr } | { kind: 'action'; action: 'LONG'|'SHORT'|'STOP'|'TAKE_PROFIT'; expression: Expr };
export type Program = { name: string; statements: Statement[] };
export type ParseResult = { ok: true; program: Program } | { ok: false; errors: CodeError[] };
