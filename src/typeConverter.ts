import _ from 'lodash'
import { OpenAPIV3 } from 'openapi-types'
import {
  ASTNode,
  DocumentNode,
  GraphQLBoolean,
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
  Kind,
  OperationDefinitionNode,
  SelectionSetNode,
  typeFromAST,
  valueFromAST,
} from 'graphql'

const hasDirective = (node: ASTNode, directiveName: string | string[]) =>
  (('directives' in node && node.directives) || []).some((directive) =>
    (typeof directiveName === 'string' ? [directiveName] : directiveName).includes(
      directive.name.value
    )
  )

const hasOptionalDirective = (node: ASTNode) => hasDirective(node, ['include', 'skip'])

const mergeDefaultValueToOpenAPISchema = (
  defaultValue: unknown,
  openAPISchema: OpenAPIV3.SchemaObject
) => {
  if (typeof defaultValue === 'object' && defaultValue !== null) {
    for (const [key, value] of Object.entries(defaultValue)) {
      mergeDefaultValueToOpenAPISchema(
        value,
        openAPISchema.properties![key] as OpenAPIV3.SchemaObject
      )
    }
  } else {
    openAPISchema.default = defaultValue
  }
}

type GraphQLTypeWithFields = GraphQLObjectType | GraphQLInterfaceType | GraphQLUnionType

export class GraphQLTypeToOpenAPITypeSchemaConverter {
  constructor(
    private graphqlSchema: GraphQLSchema,
    private customScalars: (scalarTypeName: string) => OpenAPIV3.SchemaObject = (
      scalarTypeName
    ) => {
      throw new Error('Unknown custom scalar: ' + scalarTypeName)
    }
  ) {}

  public fromDocument(document: DocumentNode) {
    const result = []
    for (const operation of document.definitions) {
      if (operation.kind !== Kind.OPERATION_DEFINITION) {
        continue
      }
      result.push(this.fromOperation(operation))
    }
    return result
  }

  public fromOperation(operation: OperationDefinitionNode) {
    return {
      name: operation.name?.value || null,
      parameters: this.parametersFromOperation(operation),
      response: this.responseSchemaFromOperation(operation),
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
        ...(typeSchema.nullable ? {} : { required: true }),
      }
    })
  }

  public responseSchemaFromOperation(operation: OperationDefinitionNode) {
    return this.fromType(this.graphqlSchema.getQueryType()!, operation.selectionSet, true)
  }

  public fromTypeNonNull(
    type: GraphQLNullableType,
    selectionSet?: SelectionSetNode
  ): OpenAPIV3.SchemaObject {
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
      return this.customScalars(type.name)
    } else if (type instanceof GraphQLEnumType) {
      return {
        type: 'string',
        // TODO: OpenAPI 3.1: The metadata (name, description, deprecated) can be expressed with oneOf and const
        enum: type.getValues().map((x) => x.value),
      }
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
      return this.fromTypeWithFields(type, selectionSet!)
    } else if (type instanceof GraphQLInputObjectType) {
      return this.fromInputObjectType(type)
    } else {
      throw new Error('Unhandled type')
    }
  }

  public fromType(
    type: GraphQLType,
    selectionSet?: SelectionSetNode,
    root = false
  ): OpenAPIV3.SchemaObject {
    if (root) {
      return this.fromTypeNonNull(type, selectionSet)
    }
    if (type instanceof GraphQLNonNull) {
      return this.fromTypeNonNull(type.ofType, selectionSet)
    }
    const typeSchema = this.fromTypeNonNull(type, selectionSet)
    typeSchema.nullable = true
    return typeSchema
  }

  public fromInputObjectType(type: GraphQLInputObjectType): OpenAPIV3.SchemaObject {
    const properties: Record<string, OpenAPIV3.SchemaObject> = {}
    const required = []

    for (const field of Object.values(type.getFields())) {
      const propertyType = this.fromType(field.type)
      if (!propertyType.nullable) {
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

  public getTypenameSchema(type: GraphQLTypeWithFields): OpenAPIV3.SchemaObject {
    return {
      type: 'string',
      enum:
        type instanceof GraphQLObjectType
          ? [type.name]
          : this.graphqlSchema.getPossibleTypes(type).map((possibleType) => possibleType.name),
    }
  }

  public fromField(
    type: GraphQLTypeWithFields,
    fieldName: string,
    selectionSet?: SelectionSetNode
  ): OpenAPIV3.SchemaObject {
    if (fieldName === '__typename') {
      return this.getTypenameSchema(type)
    }
    return this.fromType((type as GraphQLObjectType).getFields()[fieldName].type, selectionSet)
  }

  private addSelectionSet(
    properties: Record<string, OpenAPIV3.SchemaObject>,
    required: string[],
    isOptional: boolean,
    type: GraphQLTypeWithFields,
    selectionSet: SelectionSetNode
  ) {
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FRAGMENT_SPREAD) {
        throw new Error('Non-inline fragments not supported')
      }

      if (selection.kind === Kind.FIELD) {
        const fieldName = selection.name.value
        const fieldAlias = selection.alias?.value || fieldName
        properties[fieldAlias] = this.fromField(type, fieldName, selection.selectionSet)
        const isFieldOptional = isOptional || hasOptionalDirective(selection)
        if (!isFieldOptional) {
          required.push(fieldAlias)
        }
      }

      if (selection.kind === Kind.INLINE_FRAGMENT) {
        let fragmentType: GraphQLTypeWithFields = type
        if (selection.typeCondition) {
          const typeFromConditionName = selection.typeCondition.name.value
          const typeFromCondition = this.graphqlSchema.getType(typeFromConditionName)
          if (!typeFromCondition) {
            throw new Error('Type could not be found: ' + typeFromConditionName)
          }
          fragmentType = typeFromCondition as GraphQLTypeWithFields
        }

        const isSelectionSetOptional =
          isOptional || hasOptionalDirective(selection) || fragmentType.name !== type.name

        this.addSelectionSet(
          properties,
          required,
          isSelectionSetOptional,
          fragmentType,
          selection.selectionSet
        )
      }
    }
  }

  public fromTypeWithFields(
    type: GraphQLTypeWithFields,
    selectionSet: SelectionSetNode
  ): OpenAPIV3.SchemaObject {
    const properties: Record<string, OpenAPIV3.SchemaObject> = {}
    const required: string[] = []
    this.addSelectionSet(properties, required, false, type, selectionSet)
    return {
      type: 'object',
      properties,
      ...(required.length ? { required: _.uniq(required) } : {}),
    }
  }
}
