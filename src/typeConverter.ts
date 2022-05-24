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
  isTypeSubTypeOf,
  isWrappingType,
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  typeFromAST,
  valueFromAST,
} from 'graphql'
import { OAType, SchemaComponents } from './types'
import { isFragmentDefinitionNode } from './graphqlUtils'

const hasDirective = (node: ASTNode, directiveName: string | string[]) =>
  (('directives' in node && node.directives) || []).some((directive) =>
    (typeof directiveName === 'string' ? [directiveName] : directiveName).includes(
      directive.name.value
    )
  )

const hasOptionalDirective = (node: ASTNode) => hasDirective(node, ['include', 'skip'])

const mergeDefaultValueToOpenAPISchema = (defaultValue: unknown, openAPISchema: OAType) => {
  // Since components are shared we cannot merge default values in
  //
  if ('$ref' in openAPISchema) {
    if (typeof defaultValue === 'object' && defaultValue !== null) {
      // We lose the default value information here, but the component cannot be mutated
      // Alternatives would be:
      // 1. Inline the component
      // 2. Create a new modified component and adjust the reference
    } else {
      const componentPath = openAPISchema.$ref
      for (const prop of Object.keys(openAPISchema)) {
        // @ts-ignore
        delete openAPISchema[prop]
      }
      // @ts-ignore
      openAPISchema.default = defaultValue
      // @ts-ignore
      openAPISchema.allOf = [{ $ref: componentPath }]
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

// A subset of fragments that can be referenced
export const getReferenceableFragments = (
  schema: GraphQLSchema,
  fragmentMap: any,
  document: DocumentNode
) => {
  const referenceableFragments = new Map()

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
            isTypeSubTypeOf(schema, type, schema.getType(selection.typeCondition.name.value)!))
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
    if (!isTypeSubTypeOf(schema, type, fragmentType)) {
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

const isNullable = (schema: OAType) => {
  return 'nullable' in schema && schema.nullable
}

export class GraphQLTypeToOpenAPITypeSchemaConverter {
  #schemaComponents: SchemaComponents = {}

  constructor(
    private graphqlSchema: GraphQLSchema,
    private customScalars: (scalarTypeName: string) => OpenAPIV3.SchemaObject = (
      scalarTypeName
    ) => {
      throw new Error('Unknown custom scalar: ' + scalarTypeName)
    },
    private fragmentMap: Record<string, FragmentDefinitionNode> = {},
    private referenceableFragments: Set<string> = new Set()
  ) {}

  public fromDocument(document: DocumentNode) {
    document.definitions.flatMap((definition) =>
      definition.kind === Kind.OPERATION_DEFINITION ? [this.fromOperation(definition)] : []
    )
  }

  public fromOperation(operation: OperationDefinitionNode) {
    return {
      name: operation.name?.value || null,
      parameters: this.parametersFromOperation(operation),
      response: this.responseSchemaFromOperation(operation),
      schemaComponents: this.#schemaComponents,
    }
  }

  public parametersFromOperation(
    operation: OperationDefinitionNode
  ): Omit<OpenAPIV3.ParameterObject, 'in'>[] {
    if (!operation.variableDefinitions?.length) {
      return []
    }
    return operation.variableDefinitions.map((variable) => {
      const inputType = typeFromAST(this.graphqlSchema, variable.type as any)! as GraphQLInputType
      const typeSchema = this.fromType(inputType)
      if (variable.defaultValue) {
        mergeDefaultValueToOpenAPISchema(valueFromAST(variable.defaultValue, inputType), typeSchema)
      }
      return {
        name: variable.variable.name.value,
        schema: typeSchema,
        ...(isNullable(typeSchema) ? {} : { required: true }),
      }
    })
  }

  public responseSchemaFromOperation(operation: OperationDefinitionNode) {
    return this.fromType(this.graphqlSchema.getQueryType()!, operation.selectionSet, true)
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

  public fromType(type: GraphQLType, selectionSet?: SelectionSetNode, root = false): OAType {
    if (root) {
      return this.fromTypeNonNull(type, selectionSet)
    }
    if (type instanceof GraphQLNonNull) {
      return this.fromTypeNonNull(type.ofType, selectionSet)
    }
    const typeSchema = this.fromTypeNonNull(type, selectionSet)
    // NOTE: Interaction between `$ref` and `nullable`
    // Following the suggestion here: https://stackoverflow.com/questions/40920441/how-to-specify-a-property-can-be-null-or-a-reference-with-swagger
    // There is a lot of discussion about this topic:
    // * https://github.com/OAI/OpenAPI-Specification/issues/1368
    // * https://github.com/OAI/OpenAPI-Specification/blob/main/proposals/2019-10-31-Clarify-Nullable.md
    // TODO: Will be easier in OpenAPI v3.1
    const nonNullableTypeSchema =
      '$ref' in typeSchema
        ? {
            allOf: [typeSchema],
            nullable: true,
          }
        : {
            ...typeSchema,
            nullable: true,
          }
    return nonNullableTypeSchema
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
      properties[field.name] = propertyType
    }

    return {
      type: 'object',
      properties,
      ...(required.length ? { required: _.uniq(required) } : {}),
    }
  }

  public getPossibleTypes(type: GraphQLCompositeType) {
    return type instanceof GraphQLObjectType
      ? [type.name]
      : this.graphqlSchema.getPossibleTypes(type).map((possibleType) => possibleType.name)
  }

  public getTypenameSchema = this.fromReference<GraphQLCompositeType>(
    (type) => `${type.name}|__typename`,
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
    return this.fromType(type_.getFields()[fieldName].type, selectionSet)
  }

  public fromFragment = this.fromReference<FragmentDefinitionNode>(
    (fragment) => `${fragment.typeCondition.name.value}|${fragment.name.value}`,
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
      return {
        type: 'object',
        ...(!_.isEmpty(properties) ? { properties } : {}),
        ...(allOf.length ? { allOf } : {}),
        ...(required.length ? { required: _.uniq(required) } : {}),
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
        properties[fieldAlias] = this.fromField(type, fieldName, selection.selectionSet)
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
          !isTypeSubTypeOf(this.graphqlSchema, type, fragmentType)

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
          !isTypeSubTypeOf(this.graphqlSchema, type, fragmentType)

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
    }
  }

  public fromEnum = this.fromReference<GraphQLEnumType>(
    (type) => type.name,
    (type) => ({
      type: 'string',
      // TODO: OpenAPI 3.1: The metadata (name, description, deprecated) can be expressed with oneOf and const
      enum: type.getValues().map((x) => x.value),
      ...(type.description ? { description: type.description } : {}),
    })
  )

  public fromCustomScalar = this.fromReference<GraphQLScalarType>(
    (type) => type.name,
    (type) => this.customScalars(type.name)
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
