import ts from '@typescript/typescript6'

/**
 * A span map segment in the tuple form TypeScript reads:
 * `[virtualStart, virtualLength, originalStart, originalLength, kind, features]`.
 */
export type Segment = [number, number, number, number, number, number]

type Locate = (pointer: string) => { start: number; end: number } | undefined

/**
 * Finds a spec key (`locate`) or the scalar value of a key (`locateValue`) from a JSON pointer.
 */
type Locators = { locate: Locate; locateValue: Locate }

const kindVerbatim = 0
const kindAlias = 2
// Hover, Definition, TypeDefinition, Implementation, References, DocumentHighlights.
const features = 1 | 8 | 16 | 32 | 64 | 128
// Only schema names rename into the spec. A stale `$ref` shows as an error, but a stale `required` entry fails silently.
const renameFeature = 256

const refPrefix = '#/components/schemas/'

const escapeToken = (token: string) => token.replaceAll('~', '~0').replaceAll('/', '~1')

// A schema type's own key: `#/components/schemas/Pet`, not a property or an operation part under it.
const isSchemaPointer = (pointer: string | undefined): pointer is string => !!pointer?.startsWith(refPrefix) && !pointer.slice(refPrefix.length).includes('/')

/**
 * A property type without `| null` and one level of `T[]` or `Array<T>`, which the spec writes under `items`.
 */
function unwrap(type: ts.TypeNode | undefined): { type: ts.TypeNode; items: boolean } | undefined {
  const members =
    type && ts.isUnionTypeNode(type)
      ? type.types.filter((member) => !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword))
      : [type]
  const [single] = members.length === 1 ? members : []
  if (!single) return undefined
  if (ts.isArrayTypeNode(single)) return { type: single.elementType, items: true }
  if (ts.isTypeReferenceNode(single) && single.typeName.getText() === 'Array' && single.typeArguments?.length === 1)
    return { type: single.typeArguments[0]!, items: true }
  return { type: single, items: false }
}

/**
 * The members of an interface, or of a type alias for an object literal.
 */
function typeMembers(statement: ts.TypeAliasDeclaration | ts.InterfaceDeclaration): ts.NodeArray<ts.TypeElement> | undefined {
  if (ts.isInterfaceDeclaration(statement)) return statement.members
  return ts.isTypeLiteralNode(statement.type) ? statement.type.members : undefined
}

/**
 * Links generated names to the spec keys they came from: schemas and their (nested) properties,
 * and operation types to the operation, parameters, request body or response. A schema type named
 * exactly like its key is verbatim, so a rename in TypeScript renames the key. A reference to a
 * schema type maps to the end of the `$ref` that points at that schema, so the rename updates it too.
 * `pointers` maps each emitted declaration name to the JSON pointer it came from.
 */
export function createMappings(text: string, content: string, { locate, locateValue }: Locators, pointers: Map<string, string>): Array<Segment> {
  const sourceFile = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true)
  const segments: Array<Segment> = []

  const add = (name: ts.Node, rename: boolean, pointer: string | undefined) => {
    const range = pointer ? locate(pointer) : undefined
    if (!range) return
    const verbatim = rename && content.slice(range.start, range.end) === name.getText(sourceFile)
    segments.push([
      name.getStart(sourceFile),
      name.getWidth(sourceFile),
      range.start,
      range.end - range.start,
      verbatim ? kindVerbatim : kindAlias,
      verbatim ? features | renameFeature : features,
    ])
  }

  // Only a reference whose `$ref` ends in the same text renames; anything else would break the spec.
  const addRef = (inner: ReturnType<typeof unwrap>, pointer: string) => {
    if (!inner || !ts.isTypeReferenceNode(inner.type) || !ts.isIdentifier(inner.type.typeName)) return
    const reference = inner.type.typeName
    const name = reference.text
    if (!isSchemaPointer(pointers.get(name))) return
    const range = locateValue(`${pointer}${inner.items ? '/items' : ''}/$ref`)
    if (!range) return
    // The `$ref` value may be quoted, so count the name back from the end of its text.
    const start = range.start + content.slice(range.start, range.end).replace(/['"]$/, '').length - name.length
    if (content.slice(start - refPrefix.length, start + name.length) !== refPrefix + name) return
    segments.push([reference.getStart(sourceFile), reference.getWidth(sourceFile), start, name.length, kindVerbatim, features | renameFeature])
  }

  const addMembers = (members: ts.NodeArray<ts.TypeElement>, pointer: string) => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) continue
      const propertyPointer = `${pointer}/properties/${escapeToken(member.name.text)}`
      add(member.name, false, propertyPointer)
      const inner = unwrap(member.type)
      addRef(inner, propertyPointer)
      if (inner && ts.isTypeLiteralNode(inner.type)) addMembers(inner.type.members, inner.items ? `${propertyPointer}/items` : propertyPointer)
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      // Enum objects (`export const orderStatusEnum = { ... } as const`) carry their own pointer.
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) add(declaration.name, false, pointers.get(declaration.name.text))
      }
      continue
    }
    if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue
    const pointer = pointers.get(statement.name.text)
    const isSchema = isSchemaPointer(pointer)
    add(statement.name, isSchema, pointer)

    // Property names only resolve under a schema, not under operation parameters or responses.
    if (!isSchema) continue
    const members = typeMembers(statement)
    if (members) addMembers(members, pointer)
    else if (ts.isTypeAliasDeclaration(statement)) addRef(unwrap(statement.type), pointer)
  }

  return segments
}
