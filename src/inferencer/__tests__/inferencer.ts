import { mockContext } from '../../mocks/context'
import { listPrelude } from '../../stdlib/list.prelude'
import { parse } from '../../parser/parser'
import { analyse } from '../inferencer'
import { TypeAnnotatedNode } from '../../types'
import * as es from 'estree'
import { typeToString } from '../../utils/stringify'
import { parseError } from '../../index'
import { validateAndAnnotate } from '../../validator/validator'

function topLevelTypesToString(program: TypeAnnotatedNode<es.Program>) {
  return program.body
    .filter(node => ['VariableDeclaration', 'FunctionDeclaration'].includes(node.type))
    .map(
      (
        node: TypeAnnotatedNode<es.VariableDeclaration> | TypeAnnotatedNode<es.FunctionDeclaration>
      ) => {
        const id =
          node.type === 'VariableDeclaration'
            ? (node.declarations[0].id as es.Identifier).name
            : node.id?.name!
        const type =
          node.typability === 'Untypable' ? "Couldn't infer type" : typeToString(node.inferredType!)
        return `${id}: ${type}`
      }
    )
    .join('\n')
}

test('Type inference of list prelude', async () => {
  const code = listPrelude
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`
"Line 17: A type mismatch was detected in the binary expression:
  x === y
The binary operator (===) expected two operands with types:
  Addable1 === Addable1
but instead it received two operands of types:
  [T1, T1] === [T1, T1]
Line 72: A type mismatch was detected in the function call:
  list_to_string(tail(xs))
The function expected an argument of type:
  T1
but instead received an argument of type:
  List<T1>"
`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"is_list: List<T1> -> T2
equal: Couldn't infer type
length: List<T1> -> number
map: (T1 -> T2, List<T1>) -> List<T2>
build_list: (number, number -> T1) -> List<T1>
for_each: (T1 -> T2, List<T1>) -> boolean
list_to_string: Couldn't infer type
reverse: List<T1> -> List<T1>
append: (List<T1>, List<T1>) -> List<T1>
member: (Addable1, List<Addable1>) -> List<Addable1>
remove: (Addable1, List<Addable1>) -> List<Addable1>
remove_all: (Addable1, List<Addable1>) -> List<Addable1>
filter: (T1 -> boolean, List<T1>) -> List<T1>
enum_list: (number, number) -> List<number>
list_ref: (List<T1>, number) -> T1
accumulate: ((T1, T2) -> T2, T2, List<T1>) -> T2"
`)
})

test('Type inference of permutation', async () => {
  const code = `function accumulate(op, init, xs) {
    return is_null(xs) ? init : op(head(xs), accumulate(op, init, xs));
}
function map(f, xs) {
    return is_null(xs) ? null : pair(f(head(xs)), map(f, tail(xs)));
}
function append(xs, ys) {
  return is_null(xs) ? ys : pair(head(xs), append(tail(xs), ys));
}
function remove(v, xs) {
  return is_null(xs) ? null : v === head(xs) ? tail(xs) : pair(head(xs), remove(v, tail(xs)));
}
const xs = pair(1, pair(2, null));
function flatmap(f, seq) {
    return accumulate(append, null, map(f, seq));
}
function permutations(s) {
    return is_null(s) ? pair(null, null)
           : flatmap(x => map(p => pair(x, p), permutations(remove(x, s))), s);
}

const ps = permutations(xs); `
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`""`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"accumulate: ((T1, T2) -> T2, T2, List<T1>) -> T2
map: (T1 -> T2, List<T1>) -> List<T2>
append: (List<T1>, List<T1>) -> List<T1>
remove: (Addable1, List<Addable1>) -> List<Addable1>
xs: List<number>
flatmap: (T1 -> List<T2>, List<T1>) -> List<T2>
permutations: List<Addable1> -> List<List<Addable1>>
ps: List<List<number>>"
`)
})

test('Type inference of using pair for lists and pairs', async () => {
  const code = `
function make_rat(n, d) {
    return pair(n, d);
}
function numer(x) {
    return head(x);
}
function denom(x) {
    return tail(x);
}

function map(f, xs) {
    return is_null(xs) ? null : pair(f(head(xs)), map(f, tail(xs)));
}

function add_rat(x, y) {
    return make_rat(numer(x) * denom(y) + numer(y) * denom(x),
                    denom(x) * denom(y));
}
function sub_rat(x, y) {
    return make_rat(numer(x) * denom(y) - numer(y) * denom(x),
                    denom(x) * denom(y));
}
function mul_rat(x, y) {
    return make_rat(numer(x) * numer(y),
                    denom(x) * denom(y));
}
function div_rat(x, y) {
    return make_rat(numer(x) * denom(y),
                    denom(x) * numer(y));
}
function equal_rat(x, y) {
    return numer(x) * denom(y) === numer(y) * denom(x);
}

function fourth(data) {
  return head(tail(tail(tail(data))));
}

// lists can't be used as pairs!
const listof3 = pair(1, pair(2, pair(3, pair(4, null))));
const double = add_rat(listof3, listof3);

// pairs can't be used as lists!
const mapped = map(x=>x, make_rat(1, 2));

// but lists or pairs can both be used for arbitrary structures like fourth
const aList = null;
const aPair = pair(1, pair(2, pair(3, pair(4, 5))));

const list4th = fourth(aList);
const pair4th = fourth(aPair);

// unfortunately fourth will throw a runtime error on lists, since we do not know their length
// but for pairs, we can check their structure! a pair without the correct structure will throw a type errpr:
const tooshortpair = pair(1, pair(2, pair(3, 4)));
const tooshortpair4th = fourth(tooshortpair);

  `
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`
"Line 42: A type mismatch was detected in the function call:
  add_rat(listof3, listof3)
The function expected 2 arguments of types:
  [number, number], [number, number]
but instead received 2 arguments of types:
  List<number>, List<number>
Line 45: A type mismatch was detected in the function call:
  map(x => x, make_rat(1, 2))
The function expected 2 arguments of types:
  number -> number, List<number>
but instead received 2 arguments of types:
  number -> number, [number, number]
Line 57: A type mismatch was detected in the function call:
  fourth(tooshortpair)
The function expected an argument of type:
  [number, [number, [number, [T1, T2]]]]
but instead received an argument of type:
  [number, [number, [number, number]]]"
`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"make_rat: (number, number) -> [number, number]
numer: [number, number] -> number
denom: [number, number] -> number
map: (T1 -> T2, List<T1>) -> List<T2>
add_rat: ([number, number], [number, number]) -> [number, number]
sub_rat: ([number, number], [number, number]) -> [number, number]
mul_rat: ([number, number], [number, number]) -> [number, number]
div_rat: ([number, number], [number, number]) -> [number, number]
equal_rat: ([number, number], [number, number]) -> boolean
fourth: [T1, [T2, [T3, [T4, T5]]]] -> T4
listof3: List<number>
double: Couldn't infer type
mapped: Couldn't infer type
aList: List<T1>
aPair: [number, [number, [number, [number, number]]]]
list4th: T1
pair4th: number
tooshortpair: [number, [number, [number, number]]]
tooshortpair4th: Couldn't infer type"
`)
})

test('Test monomorphic and polymorphic phase part 2', async () => {
  const code = `
function id(x) { return x; }

const num = id(1);
const bool = id(true); // these work, because they both create fresh copy of id.

`
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`""`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"id: T1 -> T1
num: number
bool: boolean"
`)
})

test('Test higher order functions', async () => {
  const code = `
const zero = f => x => x;
const succ = n => f => x => n(f)(f(x));
const one = succ(zero);
const two = succ(one);

`
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`""`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"zero: T1 -> T2 -> T2
succ: ((T1 -> T2) -> T2 -> T3) -> (T1 -> T2) -> T1 -> T3
one: (T1 -> T2) -> T1 -> T2
two: (T1 -> T1) -> T1 -> T1"
`)
})

test('Test operators and function application errors', async () => {
  const code = `
  1 + "";
  -true;
  "" * "";

  pair();
  pair(1);
  pair(1, 2, 3);

  const one = () => 1;

  one();
  one(1);
  one(1, 2, 3);

  1 ? true : true;
  const validCondNum = true ? () => 1 : () => 3;
  true ? x => 1 : () => 1;

  function invalidIf() {
    if (true) {
      return 1;
    } else { }
  }

  if (1) {
  } else {
  }
  `
  const context = mockContext(2)
  const program = parse(code, context)!
  expect(program).not.toBeUndefined()
  validateAndAnnotate(program, context)
  analyse(program, context)
  expect(program).toMatchSnapshot()
  expect(parseError(context.errors)).toMatchInlineSnapshot(`
"Line 2: A type mismatch was detected in the binary expression:
  1 + \\"\\"
The binary operator (+) expected two operands with types:
  number + number
but instead it received two operands of types:
  number + string
Line 3: A type mismatch was detected in the unary expression:
  - true
The unary operator (-) expected its operand to be of type:
  number
but instead it received an operand of type:
  boolean
Line 4: A type mismatch was detected in the binary expression:
  \\"\\" * \\"\\"
The binary operator (*) expected two operands with types:
  number * number
but instead it received two operands of types:
  string * string
Line 6: A type mismatch was detected in the function call:
  pair()
The function expected 2 arguments of types:
  T1, T1
but instead received no arguments,
Line 7: A type mismatch was detected in the function call:
  pair(1)
The function expected 2 arguments of types:
  T1, T1
but instead received an argument of type:
  number
Line 8: A type mismatch was detected in the function call:
  pair(1, 2, 3)
The function expected 2 arguments of types:
  T1, T1
but instead received 3 arguments of types:
  number, number, number
Line 13: A type mismatch was detected in the function call:
  one(1)
The function expected no arguments,
but instead received an argument of type:
  number
Line 14: A type mismatch was detected in the function call:
  one(1, 2, 3)
The function expected no arguments,
but instead received 3 arguments of types:
  number, number, number
Line 16: Expected the test part of the conditional expression:
  1 ? ... : ...
to have type boolean, but instead it is type:
  number
Line 18: The two branches of the conditional expression:
  true ? ... : ...
produce different types!
The true branch has type:
  T1 -> number
but the false branch has type:
  () -> number
Line 21: The two branches of the if statement:
  if (true) { ... } else { ... }
produce different types!
The true branch has type:
  number
but the false branch has type:
  undefined
Line 26: Expected the test part of the if statement:
  if (1) { ... } else { ... }
to have type boolean, but instead it is type:
  number"
`)
  expect(topLevelTypesToString(program!)).toMatchInlineSnapshot(`
"one: () -> number
validCondNum: () -> number
invalidIf: Couldn't infer type"
`)
})