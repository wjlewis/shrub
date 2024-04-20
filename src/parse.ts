import Lexer, { Type as TT } from './Lexer';

// Program = Item*{";"}
// Item = Def | Term
// Def = Ident [ "(" Pattern*{","} ")" ] "=" Term
//
// Term  = Term1 [ ":" Term ]*
// Term1 = (Atom | QuotedAtom | Ident) [ "(" Term*{","} ")" ]
//       | String
//       | "[" Term*{","} "]"
//       | "(" Term ")"
//       | "match" Term+{","} "{" MatchClause*{","} "}"
//
// MatchClause = Pattern "=>" Term
//
// Pattern  = Pattern1 [ ":" Pattern ]*
// Pattern1 = (Atom | QuotedAtom) [ "(" Pattern*{","} ")" ]
//          | "_"
//          | Ident [ "@" Pattern ]
//          | String
//          | "[" Pattern*{","} "]"
//          | "(" Pattern ")"

export type Item = Def | Term;

export interface Def {
  type: Type.def;
  name: string;
  patterns: Pattern[];
  body: Term;
}

export type Term =
  | TreeTerm
  | VarTerm
  | AppTerm
  | ConsTerm
  | StringTerm
  | ListTerm
  | MatchTerm;

export type Pattern =
  | TreePattern
  | WildcardPattern
  | VarPattern
  | AsPattern
  | ConsPattern
  | StringPattern
  | ListPattern;

export interface TreeTerm {
  type: Type.treeTerm;
  functor: string;
  children: Term[];
}

export interface VarTerm {
  type: Type.varTerm;
  text: string;
}

export interface AppTerm {
  type: Type.appTerm;
  opName: string;
  rands: Term[];
}

export interface ConsTerm {
  type: Type.consTerm;
  head: Term;
  tail: Term;
}

export interface StringTerm {
  type: Type.stringTerm;
  text: string;
}

export interface ListTerm {
  type: Type.listTerm;
  elts: Term[];
}

export interface MatchTerm {
  type: Type.matchTerm;
  terms: Term[];
  clauses: MatchClause[];
}

export interface MatchClause {
  patterns: Pattern[];
  body: Term;
}

export interface TreePattern {
  type: Type.treePattern;
  functor: string;
  children: Pattern[];
}

export interface VarPattern {
  type: Type.varPattern;
  text: string;
}

export interface WildcardPattern {
  type: Type.wildcardPattern;
}

export interface AsPattern {
  type: Type.asPattern;
  name: string;
  pattern: Pattern;
}

export interface ConsPattern {
  type: Type.consPattern;
  head: Pattern;
  tail: Pattern;
}

export interface StringPattern {
  type: Type.stringPattern;
  text: string;
}

export interface ListPattern {
  type: Type.listPattern;
  elts: Pattern[];
}

export enum Type {
  def = 'def',

  treeTerm = 'treeTerm',
  varTerm = 'varTerm',
  appTerm = 'appTerm',
  consTerm = 'consTerm',
  stringTerm = 'stringTerm',
  listTerm = 'listTerm',
  matchTerm = 'matchTerm',

  treePattern = 'treePattern',
  varPattern = 'varPattern',
  wildcardPattern = 'wildcardPattern',
  asPattern = 'asPattern',
  consPattern = 'consPattern',
  stringPattern = 'stringPattern',
  listPattern = 'listPattern',
}

export function parseProgram(l: Lexer): Item[] {
  const items: Item[] = [];

  while (l.hasMore()) {
    items.push(parseItem(l));
    l.expect(TT.semi);
  }

  return items;
}

export function parseItem(l: Lexer): Item {
  if (l.peek().type === TT.letKw) {
    return parseDef(l);
  } else {
    return parseTerm(l);
  }
}

export function parseDef(l: Lexer): Def {
  l.expect(TT.letKw);
  const name = l.expect(TT.ident).text;

  let patterns: Pattern[] = [];
  if (l.hasMore() && l.peek().type === TT.lParen) {
    l.pop();
    patterns = parseCommaSep(l, parsePattern, [TT.rParen]);
    l.expect(TT.rParen);
  }

  l.expect(TT.eq);

  const body = parseTerm(l);

  return {
    type: Type.def,
    patterns,
    name,
    body,
  };
}

export function parseTerm(l: Lexer): Term {
  let term = parseTerm1(l);

  while (l.hasMore() && l.peek().type === TT.colon) {
    l.pop();
    term = {
      type: Type.consTerm,
      head: term,
      tail: parseTerm(l),
    };
  }

  return term;
}

function parseTerm1(l: Lexer): Term {
  const peeked = l.peek();

  if ([TT.bareAtom, TT.quotedAtom, TT.ident].includes(peeked.type)) {
    return parseTreeOrVarOrApp(l);
  } else if (peeked.type === TT.string) {
    return {
      type: Type.stringTerm,
      text: getStringText(l.pop().text),
    };
  } else if (peeked.type === TT.lBracket) {
    l.pop();
    const elts = parseCommaSep(l, parseTerm, [TT.rBracket]);
    l.expect(TT.rBracket);
    return {
      type: Type.listTerm,
      elts,
    };
  } else if (peeked.type === TT.lParen) {
    l.pop();
    const inner = parseTerm(l);
    l.expect(TT.rParen);
    return inner;
  } else if (peeked.type === TT.matchKw) {
    return parseMatchTerm(l);
  } else {
    throw new Error('expected a term');
  }
}

function parseTreeOrVarOrApp(l: Lexer): Term {
  const start = l.expect(TT.bareAtom, TT.quotedAtom, TT.ident);
  const text =
    start.type === TT.quotedAtom ? getStringText(start.text) : start.text;

  let terms: Term[] = [];
  if (l.hasMore() && l.peek().type === TT.lParen) {
    l.pop();
    terms = parseCommaSep(l, parseTerm, [TT.rParen]);
    l.expect(TT.rParen);
  }

  if (start.type === TT.ident) {
    if (terms.length > 0) {
      return {
        type: Type.appTerm,
        opName: text,
        rands: terms,
      };
    } else {
      return {
        type: Type.varTerm,
        text,
      };
    }
  } else {
    return {
      type: Type.treeTerm,
      functor: text,
      children: terms,
    };
  }
}

function parseMatchTerm(l: Lexer): Term {
  l.expect(TT.matchKw);
  const terms = parseCommaSep(l, parseTerm, [TT.lCurly]);
  l.expect(TT.lCurly);
  const clauses = parseCommaSep(l, parseMatchClause, [TT.rCurly]);
  l.expect(TT.rCurly);

  return {
    type: Type.matchTerm,
    terms,
    clauses,
  };
}

function parseMatchClause(l: Lexer): MatchClause {
  const patterns = parseCommaSep(l, parsePattern, [TT.arrow]);
  l.expect(TT.arrow);
  const body = parseTerm(l);

  return { patterns, body };
}

export function parsePattern(l: Lexer): Pattern {
  let pat = parsePattern1(l);

  while (l.hasMore() && l.peek().type === TT.colon) {
    l.pop();
    pat = {
      type: Type.consPattern,
      head: pat,
      tail: parsePattern(l),
    };
  }

  return pat;
}

function parsePattern1(l: Lexer): Pattern {
  const peeked = l.peek();

  if ([TT.bareAtom, TT.quotedAtom].includes(peeked.type)) {
    return parseTreePattern(l);
  } else if (peeked.type === TT.wildcard) {
    l.pop();
    return { type: Type.wildcardPattern };
  } else if (peeked.type === TT.ident) {
    return parseVarOrAsPattern(l);
  } else if (peeked.type === TT.string) {
    return {
      type: Type.stringPattern,
      text: getStringText(l.pop().text),
    };
  } else if (peeked.type === TT.lBracket) {
    l.pop();
    const elts = parseCommaSep(l, parsePattern, [TT.rBracket]);
    l.expect(TT.rBracket);
    return {
      type: Type.listPattern,
      elts,
    };
  } else if (peeked.type === TT.lParen) {
    l.pop();
    const inner = parsePattern(l);
    l.expect(TT.rParen);
    return inner;
  } else {
    throw new Error('expected a pattern');
  }
}

function parseTreePattern(l: Lexer): Pattern {
  const start = l.expect(TT.bareAtom, TT.quotedAtom);
  const text =
    start.type === TT.quotedAtom ? getStringText(start.text) : start.text;

  let children: Pattern[] = [];
  if (l.hasMore() && l.peek().type === TT.lParen) {
    l.pop();
    children = parseCommaSep(l, parsePattern, [TT.rParen]);
    l.expect(TT.rParen);
  }

  return {
    type: Type.treePattern,
    functor: text,
    children,
  };
}

function parseVarOrAsPattern(l: Lexer): Pattern {
  const text = l.expect(TT.ident).text;

  if (l.hasMore() && l.peek().type === TT.amp) {
    l.pop();
    return {
      type: Type.asPattern,
      name: text,
      pattern: parsePattern(l),
    };
  } else {
    return {
      type: Type.varPattern,
      text,
    };
  }
}

function parseCommaSep<T>(
  l: Lexer,
  parseElt: (l: Lexer) => T,
  stopSet: TT[]
): T[] {
  const elts: T[] = [];

  if (!l.hasMore() || stopSet.includes(l.peek().type)) {
    return elts;
  }

  elts.push(parseElt(l));
  while (l.hasMore()) {
    if (stopSet.includes(l.peek().type)) {
      break;
    }
    l.expect(TT.comma);
    if (!l.hasMore() || stopSet.includes(l.peek().type)) {
      break;
    }
    elts.push(parseElt(l));
  }

  return elts;
}

function getStringText(text: string): string {
  const content = text.substring(1, text.length - 1);
  if (text.startsWith("'")) {
    return content.replace(/\\'/g, "'");
  } else {
    return content.replace(/\\\"/g, '"');
  }
}
