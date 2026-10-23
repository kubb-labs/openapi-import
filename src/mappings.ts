import ts from '@typescript/typescript6'

/**
 * A span map segment in the tuple form TypeScript reads:
 * `[virtualStart, virtualLength, originalStart, originalLength, kind, features]`.
 */
export type Segment = [number, number, number, number, number, number]

/**
 * What the build saw, keyed by the names `@kubb/plugin-ts` emitted.
 */
export type Targets = {
  /**
   * Emitted type name to the `components.schemas` key it came from.
   */
  schemas: Map<string, string>
  /**
   * Emitted operation name prefix (such as `GetPetById`) to its path and method.
   */
  operations: Map<string, { path: string; method: string }>
}

type Locate = (pointer: string) => { start: number; end: number } | undefined

/**
 * Finds a spec key (`locate`) or the scalar value of a key (`locateValue`) from a JSON pointer.
 */
export type Locators = { locate: Locate; locateValue: Locate }

const kindVerbatim = 0
const kindAlias = 2
// Hover, Definition, TypeDefinition, Implementation, References, DocumentHighlights.
const features = 1 | 8 | 16 | 32 | 64 | 128
// Only schema names rename into the spec. A stale `$ref` shows as an error, but a stale `required` entry fails silently.
const renameFeature = 256

const refPrefix = '#/components/schemas/'

const escapeToken = (token: string) => token.replaceAll('~', '~0').replaceAll('/', '~1')

/**
 * Narrows an operation type to the part of the operation it was generated from, by the suffix
 * `@kubb/plugin-ts` appends to the operation name.
 */
function operationPointer(base: string, suffix: string): string {
  const status = /^Status(\d{3}|Default)/.exec(suffix)?.[1]
  if (status) return `${base}/responses/${status === 'Default' ? 'default' : status}`
  if (/^(Path|Query|Header)/.test(suffix)) return `${base}/parameters`
  if (/^(Body|Request|MutationRequest)/.test(suffix)) return `${base}/requestBody`
  return base
}

const longestPrefix = (keys: Iterable<string>, name: string) => [...keys].filter((key) => name.startsWith(key)).sort((a, b) => b.length - a.length)[0]

/**
 * Pointers to try for one declaration, most specific first. Enums extracted from a schema property
 * (`OrderStatusEnumKey`, `orderStatusEnum`) point at that property, then at the schema.
 */
function declarationPointers(name: string, { schemas, operations }: Targets): Array<string> {
  const schema = schemas.get(name)
  if (schema) return [`#/components/schemas/${escapeToken(schema)}`]

  const schemaPrefix = longestPrefix(schemas.keys(), name)
  const operationPrefix = longestPrefix(operations.keys(), name)

  if (schemaPrefix !== undefined && (operationPrefix === undefined || schemaPrefix.length > operationPrefix.length)) {
    const base = `#/components/schemas/${escapeToken(schemas.get(schemaPrefix)!)}`
    const property = name.slice(schemaPrefix.length).replace(/(Enum)?Key$|Enum$/, '')
    return property ? [`${base}/properties/${escapeToken(property[0]!.toLowerCase() + property.slice(1))}`, base] : [base]
  }
  if (operationPrefix === undefined) return []

  const { path, method } = operations.get(operationPrefix)!
  return [operationPointer(`#/paths/${escapeToken(path)}/${method.toLowerCase()}`, name.slice(operationPrefix.length))]
}

/**
 * The name a type refers to, looking through `T[]`, `Array<T>` and `T | null`.
 */
function referencedName(type: ts.TypeNode | undefined): { name: ts.Identifier; items: boolean } | undefined {
  if (!type) return undefined
  if (ts.isUnionTypeNode(type)) {
    const members = type.types.filter((member) => !(ts.isLiteralTypeNode(member) && member.literal.kind === ts.SyntaxKind.NullKeyword))
    return members.length === 1 ? referencedName(members[0]) : undefined
  }
  if (ts.isArrayTypeNode(type)) {
    const element = referencedName(type.elementType)
    return element && !element.items ? { ...element, items: true } : undefined
  }
  if (!ts.isTypeReferenceNode(type)) return undefined
  if (ts.isIdentifier(type.typeName) && type.typeName.text === 'Array' && type.typeArguments?.length === 1) {
    const element = referencedName(type.typeArguments[0])
    return element && !element.items ? { ...element, items: true } : undefined
  }
  return ts.isIdentifier(type.typeName) && !type.typeArguments ? { name: type.typeName, items: false } : undefined
}

/**
 * The object literal a property type describes, looking through `T[]` and `Array<T>`.
 */
function objectLiteral(type: ts.TypeNode | undefined): { node: ts.TypeLiteralNode; items: boolean } | undefined {
  if (!type) return undefined
  if (ts.isTypeLiteralNode(type)) return { node: type, items: false }
  if (ts.isArrayTypeNode(type) && ts.isTypeLiteralNode(type.elementType)) return { node: type.elementType, items: true }
  if (ts.isTypeReferenceNode(type) && type.typeName.getText() === 'Array' && type.typeArguments?.[0] && ts.isTypeLiteralNode(type.typeArguments[0])) {
    return { node: type.typeArguments[0], items: true }
  }
  return undefined
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
 */
export function createMappings(text: string, content: string, { locate, locateValue }: Locators, targets: Targets): Array<Segment> {
  const sourceFile = ts.createSourceFile('index.ts', text, ts.ScriptTarget.Latest, true)
  const segments: Array<Segment> = []

  const add = (name: ts.Node, rename: boolean, ...pointers: Array<string>) => {
    const range = pointers.map(locate).find(Boolean)
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
  const addRef = (type: ts.TypeNode | undefined, pointer: string) => {
    const reference = referencedName(type)
    if (!reference || !targets.schemas.has(reference.name.text)) return
    const range = locateValue(`${pointer}${reference.items ? '/items' : ''}/$ref`)
    if (!range) return
    const name = reference.name.text
    // The `$ref` value may be quoted, so count the name back from the end of its text.
    const start = range.start + content.slice(range.start, range.end).replace(/['"]$/, '').length - name.length
    if (content.slice(start - refPrefix.length, start + name.length) !== refPrefix + name) return
    segments.push([reference.name.getStart(sourceFile), reference.name.getWidth(sourceFile), start, name.length, kindVerbatim, features | renameFeature])
  }

  const addMembers = (members: ts.NodeArray<ts.TypeElement>, pointer: string) => {
    for (const member of members) {
      if (!ts.isPropertySignature(member) || !(ts.isIdentifier(member.name) || ts.isStringLiteral(member.name))) continue
      const propertyPointer = `${pointer}/properties/${escapeToken(member.name.text)}`
      add(member.name, false, propertyPointer)
      addRef(member.type, propertyPointer)
      const literal = objectLiteral(member.type)
      if (literal) addMembers(literal.node.members, literal.items ? `${propertyPointer}/items` : propertyPointer)
    }
  }

  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      // Enum objects (`export const orderStatusEnum = { ... } as const`) match like their `Key` type.
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const name = declaration.name.text
        add(declaration.name, false, ...declarationPointers(name, targets), ...declarationPointers(name[0]!.toUpperCase() + name.slice(1), targets))
      }
      continue
    }
    if (!ts.isTypeAliasDeclaration(statement) && !ts.isInterfaceDeclaration(statement)) continue
    const pointers = declarationPointers(statement.name.text, targets)
    const isSchema = targets.schemas.has(statement.name.text)
    add(statement.name, isSchema, ...pointers)

    // Property names only resolve under a schema, not under operation parameters or responses.
    const pointer = pointers[0]
    if (!pointer || !isSchema) continue
    const members = typeMembers(statement)
    if (members) addMembers(members, pointer)
    else if (ts.isTypeAliasDeclaration(statement)) addRef(statement.type, pointer)
  }

  return segments.sort((a, b) => a[0] - b[0])
}
