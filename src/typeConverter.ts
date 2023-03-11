import _ from 'lodash'
import { OpenAPIV3 } from 'openapi-types'
import {
  ASTNode,
  DocumentNode,
  FragmentDefinitionNode,
  GraphQLBoolean,
  GraphQLCompositeType,
  GraphQLEnumType,
  GraphQLFloat,
  GraphQLID,
  GraphQLInputObjectType,
  GraphQLInputType,
  GraphQLInt,
  GraphQLInterfaceType,
  GraphQLList,
  GraphQLNonNull,
  GraphQLNullableType,
  GraphQLObjectType,
  GraphQLScalarType,
  GraphQLSchema,
  GraphQLString,
  GraphQLType,
  GraphQLUnionType,
  isCompositeType,
  isWrappingType,
  Kind,
  OperationDefinitionNode,
  OperationTypeNode,
  SelectionSetNode,
  typeFromAST,
  valueFromAST,
} from 'graphql'
import { OAType, SchemaComponents } from './types'
import {
  getDirective,
  getDirectiveArgumentsUntyped,
  hasDirective,
  isFragmentDefinitionNode,
} from './graphqlUtils'
import { isNullable } from './openApi'
import { OpenAPIDirectives } from './graphql'

const hasOptionalDirective = (node: ASTNode) => hasDirective(node, ['include', 'skip'])

const getDescriptionFromNode = (node?: ASTNode) => {
  const descriptionDirective = node ? getDirective(node, OpenAPIDirectives.Description) : null
  return descriptionDirective
    ? (getDirectiveArgumentsUntyped(descriptionDirective)?.['description'] as string)
    : undefined
}

const mergeDefaultValueToOpenAPISchema = (defaultValue: unknown, openAPISchema: OAType) => {
  // Since components are shared we cannot merge default values in
  if ('$ref' in openAPISchema) {
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      // We lose the default value information here, but the component cannot be mutated
      // Alternatives would be:
      // 1. Inline the component
      // 2. Create a new modified component and adjust the reference
    } else {
      const componentPath = openAPISchema.$ref
      for (const prop of Object.keys(openAPISchema)) {
        delete (openAPISchema as any)[prop]
      }
      ;(openAPISchema as any).default = defaultValue as any
      ;(openAPISchema as any).allOf = [{ $ref: componentPath }]
    }
  } else {
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      for (const [key, value] of Object.entries(defaultValue)) {
        const fieldSchema = openAPISchema?.properties?.[key]
        if (fieldSchema) {
          mergeDefaultValueToOpenAPISchema(value, openAPISchema.properties![key] as OAType)
        }
      }
    } else {
      openAPISchema.default = defaultValue
    }
  }
}

const getPossibleTypes = (schema: GraphQLSchema, type: GraphQLCompositeType) =>
  type instanceof GraphQLObjectType
    ? [type.name]
    : schema.getPossibleTypes(type).map((possibleType) => possibleType.name)

// NOTE: `isSubType` alternative
// There is function with a similar functionality available from the GraphQL schema.
// The check here is broader, as it uses an extensional definition.
export const possibleTypesSubsetChecker = (schema: GraphQLSchema) => {
  const cache = new Map()
  return (typeA: GraphQLCompositeType, typeB: GraphQLCompositeType) => {
    const cacheKey = JSON.stringify([typeA.name, typeB.name])
    if (cache.has(cacheKey)) {
      return cache.get(cacheKey)
    }
    const possibleTypesA = getPossibleTypes(schema, typeA)
    const possibleTypesB = new Set(getPossibleTypes(schema, typeB))
    let result = true
    if (possibleTypesA.length > possibleTypesB.size) {
      result = false
    } else {
      for (const possibleType of possibleTypesA) {
        if (!possibleTypesB.has(possibleType)) {
          result = false
          break
        }
      }
    }
    cache.set(cacheKey, result)
    return result
  }
}

// A subset of fragments that can be referenced
export const getReferenceableFragments = (
  schema: GraphQLSchema,
  fragmentMap: any,
  document: DocumentNode
) => {
  const referenceableFragments = new Map()
  const isPossibleTypesSubset = possibleTypesSubsetChecker(schema)

  const checkSelectionSet = (
    selectionSet: SelectionSetNode,
    type: GraphQLCompositeType,
    isOptional: boolean
  ) => {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const isOptional_ = isOptional || hasOptionalDirective(selection)
        if (isOptional_ || !checkFragment(fragmentMap[selection.name.value], type)) {
          return false
        }
      }
      if (selection.kind === Kind.INLINE_FRAGMENT) {
        const isOptional_ =
          isOptional ||
          hasOptionalDirective(selection) ||
          (selection.typeCondition !== undefined &&
            isPossibleTypesSubset(
              type,
              schema.getType(selection.typeCondition.name.value)! as GraphQLCompositeType
            ))
        if (!checkSelectionSet(selection.selectionSet, type, isOptional_)) {
          return false
        }
      }
      if (selection.kind === Kind.FIELD) {
        let fieldType = (type instanceof GraphQLUnionType ? type.getTypes()[0] : type).getFields()[
          selection.name.value
        ].type
        while (isWrappingType(fieldType)) {
          fieldType = fieldType.ofType
        }
        if (
          isCompositeType(fieldType) &&
          selection.selectionSet &&
          !checkSelectionSet(selection.selectionSet, fieldType, false)
        ) {
          return false
        }
      }
    }
    return true
  }

  const checkFragment = (definition: FragmentDefinitionNode, type: GraphQLCompositeType) => {
    const fragmentType = schema.getType(definition.typeCondition.name.value) as GraphQLCompositeType
    if (!isPossibleTypesSubset(type, fragmentType)) {
      return false
    }
    const fragmentName = definition.name.value
    if (!referenceableFragments.has(fragmentName)) {
      referenceableFragments.set(
        fragmentName,
        checkSelectionSet(definition.selectionSet, fragmentType, false)
      )
    }
    return referenceableFragments.get(fragmentName)
  }

  for (const definition of document.definitions) {
    if (isFragmentDefinitionNode(definition)) {
      checkFragment(
        definition,
        schema.getType(definition.typeCondition.name.value) as GraphQLCompositeType
      )
    }
  }

  return new Set([...referenceableFragments].flatMap(([k, v]) => (v ? [k] : [])))
}

export class GraphQLTypeToOpenAPITypeSchemaConverter {
  #schemaComponents: SchemaComponents = {}

  #isPossibleTypesSubset: (typeA: GraphQLCompositeType, typeB: GraphQLCompositeType) => boolean

  constructor(
    private graphqlSchema: GraphQLSchema,
    private customScalars: (scalarTypeName: string) => OpenAPIV3.SchemaObject = (
      scalarTypeName
    ) => {
      throw new Error(`Unknown custom scalar "${scalarTypeName}"`)
    },
    private fragmentMap: Record<string, FragmentDefinitionNode> = {},
    private referenceableFragments: Set<string> = new Set()
  ) {
    this.#isPossibleTypesSubset = possibleTypesSubsetChecker(graphqlSchema)
  }

  public fromDocument(document: DocumentNode) {
    document.definitions.flatMap((definition) =>
      definition.kind === Kind.OPERATION_DEFINITION ? [this.fromOperation(definition)] : []
    )
  }

  public fromOperation(operation: OperationDefinitionNode) {
    return {
      name: operation.name?.value || null,
      variables: this.variablesFromOperation(operation),
      result: this.resultFromOperation(operation),
      schemaComponents: this.#schemaComponents,
    }
  }

  public variablesFromOperation(operation: OperationDefinitionNode) {
    const result: Record<string, OAType> = {}
    for (const variable of operation.variableDefinitions || []) {
      const inputType = typeFromAST(this.graphqlSchema, variable.type as any)! as GraphQLInputType
      const typeSchema = this.fromType(inputType)
      if (variable.defaultValue) {
        mergeDefaultValueToOpenAPISchema(valueFromAST(variable.defaultValue, inputType), typeSchema)
      }
      result[variable.variable.name.value] = typeSchema
    }
    return result
  }

  public resultFromOperation(operation: OperationDefinitionNode) {
    return this.fromType(
      operation.operation === OperationTypeNode.MUTATION
        ? this.graphqlSchema.getMutationType()!
        : this.graphqlSchema.getQueryType()!,
      operation.selectionSet,
      true
    )
  }

  public fromTypeNonNull(type: GraphQLNullableType, selectionSet?: SelectionSetNode): OAType {
    if (type === GraphQLInt) {
      return {
        type: 'integer',
        format: 'int32',
      }
    } else if (type === GraphQLFloat) {
      return {
        type: 'number',
        format: 'double',
      }
    } else if (type === GraphQLString) {
      return {
        type: 'string',
      }
    } else if (type === GraphQLBoolean) {
      return {
        type: 'boolean',
      }
    } else if (type === GraphQLID) {
      return {
        type: 'string',
      }
    } else if (type instanceof GraphQLScalarType) {
      return this.fromCustomScalar(type)
    } else if (type instanceof GraphQLEnumType) {
      return this.fromEnum(type)
    } else if (type instanceof GraphQLList) {
      return {
        type: 'array',
        items: this.fromType(type.ofType, selectionSet),
      }
    } else if (
      type instanceof GraphQLObjectType ||
      type instanceof GraphQLInterfaceType ||
      type instanceof GraphQLUnionType
    ) {
      return this.fromCompositeType(type, selectionSet!)
    } else if (type instanceof GraphQLInputObjectType) {
      return this.fromInputObjectType(type)
    } else {
      throw new Error('Unhandled type')
    }
  }

  // NOTE: Interaction between `$ref` and `nullable`
  // There is a lot of discussion about this topic:
  // * https://github.com/OAI/OpenAPI-Specification/issues/1368
  // * https://github.com/OAI/OpenAPI-Specification/blob/main/proposals/2019-10-31-Clarify-Nullable.md
  // The strategy here is to define all schema components as nullable,
  // because that gives the choice to keep them nullable or make them non-nullable when wrapping them,
  // which doesn't seem possible when defining the schema components as non-nullable
  // TODO: With OpenAPI 3.1 this should become easier
  public setNullable(typeSchema: OAType, nullable: boolean): OAType {
    if ('$ref' in typeSchema) {
      const typeSchemaType = this.#schemaComponents[typeSchema.$ref.split('/').slice(-1)[0]].type
      // TODO: Cannot use `nullable` without `type`
      if (typeSchemaType) {
        return {
          type: typeSchemaType as OpenAPIV3.NonArraySchemaObjectType,
          allOf: [typeSchema],
          // `nullable: false` should be a no-op, but it seems to help some tooling
          nullable,
        }
      }
      // TODO: Cannot use `nullable` without `type`
    } else if (nullable && typeSchema.type) {
      return {
        ...typeSchema,
        nullable: true,
      }
    }
    return typeSchema
  }

  public fromType(type: GraphQLType, selectionSet?: SelectionSetNode, root = false): OAType {
    if (root) {
      return this.setNullable(this.fromTypeNonNull(type, selectionSet), false)
    }
    if (type instanceof GraphQLNonNull) {
      return this.setNullable(this.fromTypeNonNull(type.ofType, selectionSet), false)
    }
    const typeSchema = this.fromTypeNonNull(type, selectionSet)

    return this.setNullable(typeSchema, true)
  }

  public fromInputObjectType(type: GraphQLInputObjectType): OpenAPIV3.SchemaObject {
    const properties: Record<string, OAType> = {}
    const required = []

    for (const field of Object.values(type.getFields())) {
      const propertyType = this.fromType(field.type)
      if (!isNullable(propertyType)) {
        required.push(field.name)
      }
      if (field.defaultValue) {
        mergeDefaultValueToOpenAPISchema(field.defaultValue, propertyType)
      }
      properties[field.name] = {
        ...(field.description ? { description: field.description } : {}),
        ...propertyType,
      }
    }

    return {
      type: 'object',
      properties,
      ...(required.length ? { required: _.uniq(required) } : {}),
      ...(type.description ? { description: type.description } : {}),
    }
  }

  public getPossibleTypes(type: GraphQLCompositeType) {
    return getPossibleTypes(this.graphqlSchema, type)
  }

  public getTypenameSchema = this.fromReference<GraphQLCompositeType>(
    (type) => `${type.name}.__typename`,
    (type) => ({
      type: 'string',
      enum: this.getPossibleTypes(type),
    })
  )

  public fromField(
    type: GraphQLCompositeType,
    fieldName: string,
    selectionSet?: SelectionSetNode
  ): OAType {
    if (fieldName === '__typename') {
      return this.getTypenameSchema(type)
    }
    const type_ = type instanceof GraphQLUnionType ? type.getTypes()[0] : type
    const field = type_.getFields()[fieldName]
    if (!field) {
      // TODO: Use location aware error?
      throw new Error(`Unknown field "${fieldName}" on type "${type.name}"`)
    }
    return {
      ...this.fromType(field.type, selectionSet),
      ...(field.description ? { description: field.description } : {}),
    }
  }

  public fromFragment = this.fromReference<FragmentDefinitionNode>(
    (fragment) => `${fragment.typeCondition.name.value}.${fragment.name.value}`,
    (fragment) => {
      const typeFromConditionName = fragment.typeCondition.name.value
      const typeFromCondition = this.graphqlSchema.getType(typeFromConditionName)!

      const properties: SchemaComponents = {}
      const required: string[] = []
      const allOf: OpenAPIV3.ReferenceObject[] = []
      this.addSelectionSet(
        properties,
        required,
        allOf,
        false,
        typeFromCondition as GraphQLCompositeType,
        fragment.selectionSet
      )

      const description = getDescriptionFromNode(fragment)

      return {
        type: 'object',
        ...(!_.isEmpty(properties) ? { properties } : {}),
        ...(allOf.length ? { allOf } : {}),
        ...(required.length ? { required: _.uniq(required) } : {}),
        ...(description ? { description } : {}),
        nullable: true,
      }
    }
  )

  private addSelectionSet(
    properties: Record<string, OAType>,
    required: string[],
    allOf: OpenAPIV3.ReferenceObject[],
    isOptional: boolean,
    type: GraphQLCompositeType,
    selectionSet: SelectionSetNode
  ) {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        const fieldName = selection.name.value
        const fieldAlias = selection.alias?.value || fieldName
        const maybeDescription = getDescriptionFromNode(selection)

        properties[fieldAlias] = {
          ...this.fromField(type, fieldName, selection.selectionSet),
          ...(maybeDescription ? { description: maybeDescription } : {}),
        }
        const isFieldOptional = isOptional || hasOptionalDirective(selection)
        if (!isFieldOptional) {
          required.push(fieldAlias)
        }
      }

      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        const fragmentName = selection.name.value
        const fragment = this.fragmentMap[fragmentName]!
        const typeFromConditionName = fragment.typeCondition.name.value
        const fragmentType = this.graphqlSchema.getType(typeFromConditionName)!

        const isSelectionSetOptional =
          isOptional ||
          hasOptionalDirective(selection) ||
          !this.#isPossibleTypesSubset(type, fragmentType as GraphQLCompositeType)

        if (!isSelectionSetOptional || this.referenceableFragments.has(fragmentName)) {
          allOf.push(this.fromFragment(fragment))
        } else {
          this.addSelectionSet(
            properties,
            required,
            allOf,
            isSelectionSetOptional,
            fragmentType as GraphQLCompositeType,
            fragment.selectionSet
          )
        }
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        let fragmentType: GraphQLCompositeType = type
        if (selection.typeCondition) {
          const typeFromConditionName = selection.typeCondition.name.value
          const typeFromCondition = this.graphqlSchema.getType(typeFromConditionName)!
          fragmentType = typeFromCondition as GraphQLCompositeType
        }

        const isSelectionSetOptional =
          isOptional ||
          hasOptionalDirective(selection) ||
          !this.#isPossibleTypesSubset(type, fragmentType)

        this.addSelectionSet(
          properties,
          required,
          allOf,
          isSelectionSetOptional,
          fragmentType,
          selection.selectionSet
        )
      }
    }
  }

  public fromCompositeType(type: GraphQLCompositeType, selectionSet: SelectionSetNode): OAType {
    const properties: SchemaComponents = {}
    const required: string[] = []
    const allOf: OpenAPIV3.ReferenceObject[] = []
    this.addSelectionSet(properties, required, allOf, false, type, selectionSet)
    return {
      type: 'object',
      ...(!_.isEmpty(properties) ? { properties } : {}),
      ...(allOf.length ? { allOf } : {}),
      ...(required.length ? { required: _.uniq(required) } : {}),
      ...(type?.description ? { description: type?.description } : {}),
    }
  }

  public fromEnum = this.fromReference<GraphQLEnumType>(
    (type) => type.name,
    (type) => ({
      type: 'string',
      // TODO: OpenAPI 3.1: The metadata (name, description, deprecated) can be expressed with oneOf and const
      enum: type.getValues().map((x) => x.value),
      ...(type.description ? { description: type.description } : {}),
      nullable: true,
    })
  )

  public fromCustomScalar = this.fromReference<GraphQLScalarType>(
    (type) => type.name,
    (type) => {
      const typeSchema = this.customScalars(type.name)
      if (!typeSchema) {
        throw new Error(
          `Expected a valid schema for scalar "${type.name}", but got undefined. Check your scalar provider function.`
        )
      }
      const description = type.description
      // TODO: Cannot use `nullable` without `type`
      return typeSchema.type
        ? {
            ...typeSchema,
            nullable: true,
            ...(description ? { description } : {}),
          }
        : {
            ...typeSchema,
            ...(description ? { description } : {}),
          }
    }
  )

  private fromReference<T>(
    nameCreator: (type: T) => string,
    schemaCreator: (type: T) => OpenAPIV3.SchemaObject
  ) {
    return (type: T) => {
      const name = nameCreator(type)
      if (!this.#schemaComponents[name]) {
        this.#schemaComponents[name] = schemaCreator(type)
      }
      return {
        $ref: `#/components/schemas/${name}`,
      }
    }
  }

  public getSchemaComponents() {
    return this.#schemaComponents
  }

  public resetSchemaComponents() {
    this.#schemaComponents = {}
  }
}
