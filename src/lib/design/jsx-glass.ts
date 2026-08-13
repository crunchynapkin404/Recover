/**
 * A real, AST-based check for `.glass` rendered inside `.glass` (C2,
 * whole-branch review 2, 2026-08-13).
 *
 * `tests/glass-contrast-guard.test.ts`'s `GROUNDS` comment asserted, in
 * prose, that glass never sits on glass — "verified against the tree". It
 * was not: `src/app/train/page.tsx` nested a `glass` `<section>` around
 * `EmptyState`, whose own root also carries `glass`, and nothing checked
 * for it. This module makes the prose a real, non-vacuous assertion.
 *
 * METHOD. Regex cannot see JSX nesting — "glass" on one line and "glass" on
 * another line says nothing about which contains which. This parses every
 * `.tsx` file with the TypeScript compiler's own parser (already a
 * dependency; no new one added) and walks the real AST in two passes:
 *
 *  1. `buildGlassRegistry` finds every component whose OWN top-level return
 *     produces a JSX root carrying the literal class `glass` (e.g.
 *     `EmptyState`) — so a `<EmptyState />` call site can be recognised as
 *     glass without re-parsing that component's body at every call site.
 *  2. `findGlassNestingViolations` walks each file's JSX tree with a stack
 *     of currently-open glass ancestors. Any element — native (`<section
 *     className="glass …">`) or a component name in the registry
 *     (`<EmptyState />`) — that is itself glass AND has a glass ancestor on
 *     the stack is a violation.
 *
 * "STATICALLY DETERMINABLE" IS THE SCOPE, ON PURPOSE. `className` values
 * assembled from string literals, template literals, `cn(...)`/`clsx(...)`
 * calls, ternaries and `&&` are all resolved. A `className` that is a bare
 * variable or the result of an unknown function call cannot be resolved
 * without running the program, and is skipped rather than guessed — the
 * same "never a false negative from a guess, only from something outside
 * the scan's stated reach" posture `type-scale-patterns.ts` and
 * `tokens.ts`'s `readScaleTokens` already take. Likewise a component whose
 * root is not a single statically-visible JSX element (e.g. it delegates
 * to another function, or every branch is dynamic) is simply not
 * registered as glass-rooted — the conservative direction to be wrong in
 * for a check whose job is to fail loudly, not to pass unnoticed.
 *
 * PROVEN NOT VACUOUS. `tests/glass-contrast-guard.test.ts` feeds this
 * module synthetic fixtures — a native glass-in-glass nesting and a
 * component-root glass-in-glass nesting — and asserts both are caught,
 * plus a sibling case that must NOT be flagged. A check that only ever ran
 * against the real tree, which is supposed to be clean, could pass by
 * being broken; the fixtures make it prove it can fail before trusting
 * that it currently doesn't.
 */
import ts from "typescript";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

type JsxNode = ts.JsxElement | ts.JsxSelfClosingElement;

export interface GlassSourceFile {
  /** Repo-relative path, used only for reporting. */
  path: string;
  text: string;
}

export interface GlassNestingViolation {
  file: string;
  outerLine: number;
  outerTag: string;
  innerLine: number;
  innerTag: string;
}

function isJsxNode(node: ts.Node): node is JsxNode {
  return ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node);
}

function openingOf(
  node: JsxNode
): ts.JsxOpeningElement | ts.JsxSelfClosingElement {
  return ts.isJsxElement(node) ? node.openingElement : node;
}

function tagNameOf(node: JsxNode, sourceFile: ts.SourceFile): string {
  return openingOf(node).tagName.getText(sourceFile);
}

function attributesOf(node: JsxNode): ts.JsxAttributes {
  return openingOf(node).attributes;
}

/**
 * Recursively collects every string that a `className` expression could
 * statically produce — one entry per literal reached, not concatenated —
 * which is all `hasGlassToken` needs, since it only asks whether any
 * reachable piece contains the whole word "glass".
 */
function collectStrings(node: ts.Node | undefined, out: string[]): void {
  if (!node) return;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    out.push(node.text);
    return;
  }
  if (ts.isTemplateExpression(node)) {
    if (node.head.text) out.push(node.head.text);
    for (const span of node.templateSpans) {
      collectStrings(span.expression, out);
      if (span.literal.text) out.push(span.literal.text);
    }
    return;
  }
  if (ts.isParenthesizedExpression(node)) {
    collectStrings(node.expression, out);
    return;
  }
  if (ts.isConditionalExpression(node)) {
    collectStrings(node.whenTrue, out);
    collectStrings(node.whenFalse, out);
    return;
  }
  if (ts.isBinaryExpression(node)) {
    // Covers `cond && "glass …"` and string concatenation with `+`.
    collectStrings(node.left, out);
    collectStrings(node.right, out);
    return;
  }
  if (ts.isCallExpression(node)) {
    // cn(...) / clsx(...) / any call — resolve every argument.
    for (const arg of node.arguments) collectStrings(arg, out);
    return;
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const el of node.elements) collectStrings(el, out);
    return;
  }
  if (ts.isObjectLiteralExpression(node)) {
    // clsx({ glass: cond }) object form: keys ARE candidate class names,
    // checked regardless of the condition's value (conservative).
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) {
        if (ts.isIdentifier(prop.name)) out.push(prop.name.text);
        else if (ts.isStringLiteral(prop.name)) out.push(prop.name.text);
        collectStrings(prop.initializer, out);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        out.push(prop.name.text);
      }
    }
    return;
  }
  // Identifier, PropertyAccess, unresolvable call, etc. — not statically
  // determinable. Skipped, not guessed.
}

function hasGlassToken(strings: string[]): boolean {
  return strings.some((s) => s.split(/\s+/).includes("glass"));
}

function classNameHasGlass(
  attrs: ts.JsxAttributes,
  sourceFile: ts.SourceFile
): boolean {
  for (const prop of attrs.properties) {
    if (!ts.isJsxAttribute(prop)) continue;
    if (prop.name.getText(sourceFile) !== "className") continue;
    const init = prop.initializer;
    if (!init) return false;
    if (ts.isStringLiteral(init)) {
      return init.text.split(/\s+/).includes("glass");
    }
    if (ts.isJsxExpression(init) && init.expression) {
      const strings: string[] = [];
      collectStrings(init.expression, strings);
      return hasGlassToken(strings);
    }
    return false;
  }
  return false;
}

/** Return-statement expressions that belong to `fn` itself, not to any function nested inside it. */
function ownReturnExpressions(
  fn: ts.FunctionLikeDeclarationBase
): ts.Expression[] {
  const body = fn.body;
  if (!body) return [];
  if (!ts.isBlock(body)) return [body as ts.Expression]; // arrow implicit return

  const results: ts.Expression[] = [];
  function visit(node: ts.Node): void {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node)
    ) {
      return; // do not descend into a nested function/component's own returns
    }
    if (ts.isReturnStatement(node) && node.expression) {
      results.push(node.expression);
    }
    ts.forEachChild(node, visit);
  }
  ts.forEachChild(body, visit);
  return results;
}

/** Unwraps an expression down to whatever JSX root(s) it statically, unconditionally produces. */
function jsxRootsOf(expr: ts.Expression | undefined, out: JsxNode[]): void {
  if (!expr) return;
  if (ts.isParenthesizedExpression(expr)) {
    jsxRootsOf(expr.expression, out);
    return;
  }
  if (isJsxNode(expr)) {
    out.push(expr);
    return;
  }
  if (ts.isJsxFragment(expr)) {
    for (const child of expr.children) {
      if (isJsxNode(child)) out.push(child);
    }
    return;
  }
  if (ts.isConditionalExpression(expr)) {
    jsxRootsOf(expr.whenTrue, out);
    jsxRootsOf(expr.whenFalse, out);
    return;
  }
  if (
    ts.isBinaryExpression(expr) &&
    expr.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
  ) {
    jsxRootsOf(expr.right, out);
    return;
  }
  // A call to another function/component, `null`, a bare identifier, etc. —
  // not a statically-resolvable JSX root. Skipped: this component is
  // simply not registered as glass-rooted, never guessed to be.
}

function isCapitalized(name: string): boolean {
  return /^[A-Z]/.test(name);
}

function registerIfGlassRooted(
  name: string,
  fn: ts.FunctionLikeDeclarationBase,
  sourceFile: ts.SourceFile,
  registry: Set<string>
): void {
  const roots: JsxNode[] = [];
  for (const ret of ownReturnExpressions(fn)) jsxRootsOf(ret, roots);
  for (const root of roots) {
    if (classNameHasGlass(attributesOf(root), sourceFile)) {
      registry.add(name);
    }
  }
}

function buildGlassRegistry(
  parsed: { sourceFile: ts.SourceFile }[]
): Set<string> {
  const registry = new Set<string>();
  for (const { sourceFile } of parsed) {
    function visit(node: ts.Node): void {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        isCapitalized(node.name.text)
      ) {
        registerIfGlassRooted(node.name.text, node, sourceFile, registry);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (
            ts.isIdentifier(decl.name) &&
            isCapitalized(decl.name.text) &&
            decl.initializer &&
            (ts.isArrowFunction(decl.initializer) ||
              ts.isFunctionExpression(decl.initializer))
          ) {
            registerIfGlassRooted(
              decl.name.text,
              decl.initializer,
              sourceFile,
              registry
            );
          }
        }
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
  }
  return registry;
}

function isGlassElement(
  node: JsxNode,
  sourceFile: ts.SourceFile,
  registry: Set<string>
): boolean {
  if (classNameHasGlass(attributesOf(node), sourceFile)) return true;
  const tag = tagNameOf(node, sourceFile);
  // Only a bare identifier tag (a custom component, not `<Foo.Bar>` or an
  // intrinsic like `<div>`) participates in the cross-file registry.
  return (
    /^[A-Za-z_$][\w$]*$/.test(tag) && isCapitalized(tag) && registry.has(tag)
  );
}

/**
 * Core, pure entry point — takes source text directly so it can be run
 * against real files OR synthetic fixtures (see the self-tests this feeds).
 */
export function findGlassNestingViolations(
  files: GlassSourceFile[]
): GlassNestingViolation[] {
  const parsed = files.map(({ path, text }) => ({
    path,
    sourceFile: ts.createSourceFile(
      path,
      text,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      ts.ScriptKind.TSX
    ),
  }));
  const registry = buildGlassRegistry(parsed);
  const violations: GlassNestingViolation[] = [];

  for (const { path, sourceFile } of parsed) {
    const stack: JsxNode[] = [];
    function visit(node: ts.Node): void {
      if (isJsxNode(node)) {
        const glass = isGlassElement(node, sourceFile, registry);
        if (glass && stack.length > 0) {
          const outer = stack[stack.length - 1];
          const outerLine = sourceFile.getLineAndCharacterOfPosition(
            outer.getStart(sourceFile)
          ).line;
          const innerLine = sourceFile.getLineAndCharacterOfPosition(
            node.getStart(sourceFile)
          ).line;
          violations.push({
            file: path,
            outerLine: outerLine + 1,
            outerTag: tagNameOf(outer, sourceFile),
            innerLine: innerLine + 1,
            innerTag: tagNameOf(node, sourceFile),
          });
        }
        if (glass) stack.push(node);
        ts.forEachChild(node, visit);
        if (glass) stack.pop();
        return;
      }
      ts.forEachChild(node, visit);
    }
    ts.forEachChild(sourceFile, visit);
  }
  return violations;
}

const SRC = join(process.cwd(), "src");

function walkTsx(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walkTsx(full, out);
    else if (/\.tsx$/.test(full) && !/\.test\.tsx$/.test(full)) out.push(full);
  }
  return out;
}

/** Runs the check against the real tree — what the guard test actually asserts on. */
export function findGlassNestingViolationsInSrc(): GlassNestingViolation[] {
  const files = walkTsx(SRC).map((p) => ({
    path: relative(process.cwd(), p),
    text: readFileSync(p, "utf8"),
  }));
  return findGlassNestingViolations(files);
}
