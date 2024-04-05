import _ from 'lodash'
import {
  ASTNode,
  buildASTSchema,
  DocumentNode,
  GraphQLDirective,
  GraphQLSchema,
  Kind,
  OperationDefinitionNode,
  OperationTypeNode,
  print,
  validate,
  visit,
  printSourceLocation,
} from 'graphql'
import { mergeSchemas } from '@graphql-tools/schema'
import { gql } from 'graphql-tag'
import { OpenAPIV3 } from 'openapi-types'
import { getVariablesFromPathTemplate } from './pathTemplate.js'
import {
  createFragmentMap,
  getDependencyClosure,
  getDirective,
  getDirectiveArguments,
  getFragmentDependencies,
  getReferencedFragments,
  isOperationDefinitionNode,
} from './graphqlUtils.js'
import {
  BridgeOperation,
  CustomOperationProps,
  CustomProperties,
  JSON_CONTENT_TYPE,
  OAType,
  MediaTypeMap,
} from './types.js'
import {
  getReferenceableFragments,
  GraphQLTypeToOpenAPITypeSchemaConverter,
} from './typeConverter.js'
import { isNullable } from './openApi.js'
import { gqlValidationRules } from './validationRules.js'

const DIRECTIVE_DEFINITION = gql`
  input OAExternalDocsInput {
    url: String!
    description: String
  }

  # see https://swagger.io/docs/specification/authentication/
  input SecurityDefinitionInput {
    schema: String!
    scopes: [String!]
  }

  enum HttpMethod {
    GET
    POST
    PUT
    DELETE
  }

  enum ParameterSource {
    PATH
    QUERY
    HEADER
  }

  enum BodyContentType {
    JSON
    FORM_DATA
    MULTIPART_FORM_DATA
  }

  directive @OAOperation(
    path: String!
    tags: [String!]
    summary: String
    security: [SecurityDefinitionInput]
    description: String
    externalDocs: OAExternalDocsInput
    deprecated: Boolean
    method: HttpMethod
  ) on QUERY | MUTATION

  directive @OAParam(
    in: ParameterSource
    deprecated: Boolean
    description: String
    name: String
  ) on VARIABLE_DEFINITION

  directive @OABody(
    description: String
    path: String
    contentType: BodyContentType = JSON
  ) on VARIABLE_DEFINITION

  directive @OADescription(description: String) on FRAGMENT_DEFINITION | FIELD
`

export enum OpenAPIDirectives {
  Operation = 'OAOperation',
  Param = 'OAParam',
  Body = 'OABody',
  Description = 'OADescription',
}

const graphqlOperationDirectiveDataToOpenAPIOperation = (
  requestConfig: OpenAPIOperationDirectiveData,
) => {
  const { tags, summary, description, externalDocs, security, deprecated } = requestConfig
  return {
    ...(tags?.length ? { tags } : {}),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof externalDocs?.url === 'string' ? { externalDocs } : {}),
    ...(deprecated ? { deprecated } : {}),
    ...(security
      ? {
          security: security.map((item) => {
            if (item === null) {
              return {}
            }
            return { [item.schema]: item.scopes || [] }
          }),
        }
      : {}),
  }
}

const getOpenAPIParameters = (
  variablesSchema: Record<string, OAType>,
  path: string,
  paramsDirectiveData: Record<string, OpenAPIParamDirectiveData>,
) => {
  const parameters: OpenAPIV3.ParameterObject[] = []
  const variableMap: Record<string, string> = {}

  const pathVariables = new Set(getVariablesFromPathTemplate(path))

  for (const [variableName, paramDirectiveData] of Object.entries(paramsDirectiveData)) {
    let parameterName = variableName
    const nameOverride = paramDirectiveData.name
    if (nameOverride) {
      parameterName = nameOverride
    }
    const paramDirectiveDataIn = paramDirectiveData.in?.toLowerCase()

    if (paramDirectiveDataIn && paramDirectiveDataIn === 'header') {
      parameterName = parameterName.toLowerCase()
    }
    if (parameterName !== variableName) {
      variableMap[parameterName] = variableName
    }

    const in_ = pathVariables.has(parameterName)
      ? 'path'
      : paramDirectiveDataIn && ['header'].includes(paramDirectiveDataIn)
        ? paramDirectiveDataIn
        : 'query'
    const deprecated = paramDirectiveData.deprecated
    const description = paramDirectiveData.description
    const schema = variablesSchema[variableName]
    const defaultValue = 'default' in schema ? schema.default : undefined

    parameters.push({
      in: in_,
      name: parameterName,
      schema,
      ...(!isNullable(schema) && defaultValue === undefined ? { required: true } : {}),
      ...(deprecated === true ? { deprecated } : {}),
      ...(description ? { description } : {}),
      ...{ [CustomProperties.VariableName]: variableName },
    })
  }

  return {
    parameters,
    variableMap,
  }
}

const getOpenAPIRequestBody = (
  variablesSchema: Record<string, OAType>,
  bodyDirectives: Record<string, OpenAPIBodyDirectiveData>,
) => {
  const bodyVariables = Object.keys(bodyDirectives)
  if (bodyVariables.length === 0) {
    return null
  }

  const variableName = bodyVariables?.[0]
  const firstSchema = variablesSchema[variableName]

  const contentType = MediaTypeMap[bodyDirectives[variableName]?.contentType || 'JSON']
  const requestBodyFormData = bodyDirectives[variableName]?.contentType || 'JSON'

  let additionalMedia = {}
  if (contentType === 'multipart/form-data') {
    const onlyNullable = Object.values(variablesSchema).filter((type) => {
      return (type as OpenAPIV3.BaseSchemaObject).nullable
    })
    // in case we only have nullable bodies, we support also posting only json
    if (bodyVariables.length > 0 && onlyNullable.length === bodyVariables.length) {
      additionalMedia = {
        [MediaTypeMap.JSON]: {
          schema: {
            type: 'object',
            nullable: true,
          },
        },
      }
    }
  }
  // if our only body argument is a scalar type, we wrap it into an object
  if (bodyVariables.length > 1 || (firstSchema as OpenAPIV3.SchemaObject).type !== 'object') {
    const requestBodyVariableMap = Object.fromEntries(
      Object.entries(bodyDirectives).map(([variableName, directive]) => {
        const requestBodyVariableName =
          (variablesSchema[variableName] as OpenAPIV3.SchemaObject).type === 'array'
            ? `${directive.path || variableName}[]`
            : directive.path || variableName
        return [[variableName], requestBodyVariableName]
      }),
    )
    const requiredKeys = Object.entries(bodyDirectives)
      .filter(([key]) => !(variablesSchema[key] as OpenAPIV3.SchemaObject).nullable)
      .map(([key, directive]) => directive.path || key)

    return {
      requestBodyVariableMap,
      requestBodyFormData,
      requestBodyIsSingleInput: false,
      schema: {
        content: {
          [contentType]: {
            schema: {
              type: 'object',
              ...(requiredKeys.length > 0 ? { required: requiredKeys } : {}),
              properties: Object.fromEntries(
                Object.entries(bodyDirectives).map(([key, directive]) => {
                  return [
                    [directive.path || key],
                    {
                      ...variablesSchema[key],
                      ...(directive.description ? { description: directive.description } : {}),
                      [CustomProperties.VariableName]: key,
                    },
                  ]
                }),
              ),
            } as OpenAPIV3.NonArraySchemaObject,
          },
          ...additionalMedia,
        },
      },
    }
  }

  const description = bodyDirectives[variableName].description

  return {
    requestBodyVariableMap: { [variableName]: variableName },
    requestBodyIsSingleInput: true,
    requestBodyFormData,
    schema: {
      content: {
        [contentType]: {
          schema: {
            ...firstSchema,
            [CustomProperties.VariableName]: variableName,
          },
        },
        ...additionalMedia,
      },
      ...(description ? { description } : {}),
    },
  }
}

type OpenAPIOperationDirectiveData = {
  path: string
  tags?: [string]
  summary?: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
  security?: [
    {
      schema: string
      scopes: string[]
    } | null,
  ]
  deprecated?: boolean
  method: OpenAPIV3.HttpMethods
}

type OpenAPIParamDirectiveData = {
  in?: string
  deprecated?: boolean
  description?: string
  name?: string
}

type OpenAPIBodyDirectiveData = {
  description?: string
  path?: string
  contentType: 'JSON' | 'FORM_DATA' | 'MULTIPART_FORM_DATA'
}

const createOpenAPIOperation = <T extends CustomOperationProps = CustomOperationProps>(
  operationId: string | null,
  operationSource: string,
  parameters: OpenAPIV3.ParameterObject[],
  requestBody: OpenAPIV3.RequestBodyObject | null,
  resultSchema: OAType,
  operationDirectiveData: OpenAPIOperationDirectiveData,
) => {
  const responses = {
    '200': {
      description: 'Success',
      content: {
        [JSON_CONTENT_TYPE]: {
          schema: resultSchema,
        },
      },
    },
    '400': {
      description: 'Invalid request',
      content: {
        [JSON_CONTENT_TYPE]: {
          schema: {
            type: 'object',
            properties: {
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    errorCode: { type: 'string' },
                    location: { type: 'string' },
                    message: { type: 'string' },
                    path: { type: 'string' },
                  },
                },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
      },
    },
    '500': {
      description: 'Internal Server Error',
      content: {
        [JSON_CONTENT_TYPE]: {
          schema: {
            type: 'object',
            properties: {
              data: {
                ...resultSchema,
                nullable: true,
                description: 'Branch of data that does not contain errors',
              },
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    locations: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          line: { type: 'integer' },
                          column: { type: 'integer' },
                        },
                      },
                    },
                    message: { type: 'string' },
                    path: { type: 'array', items: { type: 'string' } },
                  },
                },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
      },
    },
    '415': {
      description: 'Unsupported Media Type',
      content: {
        [JSON_CONTENT_TYPE]: {
          schema: {
            type: 'object',
            properties: {
              errors: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    message: { type: 'string' },
                  },
                },
              },
            },
          } as OpenAPIV3.SchemaObject,
        },
      },
    },
  }
  return Object.freeze({
    ...(operationId !== null ? { operationId } : {}),
    [CustomProperties.Operation]: operationSource,
    ...graphqlOperationDirectiveDataToOpenAPIOperation(operationDirectiveData),
    parameters,
    ...(requestBody !== null ? { requestBody } : {}),
    responses,
  }) as OpenAPIV3.OperationObject<CustomOperationProps> as OpenAPIV3.OperationObject<T>
}

const getVariablesDirectiveData = (
  paramDirectiveDefinition: GraphQLDirective,
  bodyDirectiveDefinition: GraphQLDirective,
  operation: OperationDefinitionNode,
) => {
  const paramsDirectiveData: Record<string, OpenAPIParamDirectiveData> = {}
  const bodiesDirectiveData: Record<string, OpenAPIBodyDirectiveData> = {}

  for (const variableDefinition of operation.variableDefinitions || []) {
    const bodyDirective = getDirective(variableDefinition, OpenAPIDirectives.Body)
    if (bodyDirective) {
      bodiesDirectiveData[variableDefinition.variable.name.value] = getDirectiveArguments(
        bodyDirectiveDefinition,
        bodyDirective,
      ) as OpenAPIBodyDirectiveData
      continue
    }
    const paramDirective = getDirective(variableDefinition, OpenAPIDirectives.Param)
    paramsDirectiveData[variableDefinition.variable.name.value] = paramDirective
      ? (getDirectiveArguments(
          paramDirectiveDefinition,
          paramDirective,
        ) as OpenAPIParamDirectiveData)
      : {}
  }

  return {
    paramsDirectiveData,
    bodiesDirectiveData,
  }
}

const directiveSchema = buildASTSchema(DIRECTIVE_DEFINITION)

export const getBridgeOperations = <T extends CustomOperationProps = CustomOperationProps>(
  schema: GraphQLSchema,
  document: DocumentNode,
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject,
  transform?: (operation: OpenAPIV3.OperationObject<T>) => OpenAPIV3.OperationObject<T>,
) => {
  const bridgeOperations: Array<BridgeOperation<T>> = []

  const fragmentMap = createFragmentMap(document.definitions)

  const fragmentDependencies = getFragmentDependencies(fragmentMap)

  const referencableFragments = getReferenceableFragments(schema, fragmentMap, document)

  const typeConverter = new GraphQLTypeToOpenAPITypeSchemaConverter(
    schema,
    customScalars,
    fragmentMap,
    referencableFragments,
  )
  const validationResult = validate(
    mergeSchemas({ schemas: [directiveSchema, schema] }),
    document,
    gqlValidationRules,
  )
  if (validationResult.length > 0) {
    const errors = validationResult
      .map(
        (error) =>
          `${error.message} Source: ${
            error.locations && error.source
              ? printSourceLocation(error.source, error.locations[0])
              : 'unknown'
          }`,
      )
      .join(', ')
    throw new Error(`Schema validation error(s): ${errors}`)
  }

  for (const operation of document.definitions) {
    if (!isOperationDefinitionNode(operation)) {
      continue
    }

    const operationDirective = getDirective(operation, OpenAPIDirectives.Operation)
    if (!operationDirective) {
      continue
    }

    // # Extract all directives

    const operationDirectiveData = getDirectiveArguments(
      directiveSchema.getDirective(OpenAPIDirectives.Operation)!,
      operationDirective,
    ) as OpenAPIOperationDirectiveData

    const { paramsDirectiveData, bodiesDirectiveData } = getVariablesDirectiveData(
      directiveSchema.getDirective(OpenAPIDirectives.Param)!,
      directiveSchema.getDirective(OpenAPIDirectives.Body)!,
      operation,
    )

    // ## Remove custom directives

    const operationFragmentDependencies = getDependencyClosure(
      getReferencedFragments(operation),
      fragmentDependencies,
    )

    // ## Include dependency fragments
    const referencedFragments = Object.values(
      _.pickBy(fragmentMap, (v, k) => operationFragmentDependencies.has(k)),
    )

    const singleOperationDocument = {
      kind: Kind.DOCUMENT,
      definitions: [operation, ...referencedFragments],
    } as DocumentNode

    const operationId = operation.name ? operation.name.value : null

    // # Extract types from GraphQL operation

    const variablesSchema = typeConverter.variablesFromOperation(operation)

    const resultSchema = typeConverter.resultFromOperation(operation)

    // # Build OpenAPI schema

    // ## Build OpenAPI schema: Parameters

    const { parameters, variableMap } = getOpenAPIParameters(
      variablesSchema,
      operationDirectiveData.path,
      paramsDirectiveData,
    )

    // ## Build OpenAPI schema: Request body

    const requestBody = getOpenAPIRequestBody(variablesSchema, bodiesDirectiveData)

    const graphqlDocument = removeOpenAPIDirectives(singleOperationDocument)
    const operationSource = print(graphqlDocument)

    // ## Build OpenAPI schema: Operation

    const openAPIOperation = createOpenAPIOperation<T>(
      operationId,
      operationSource,
      parameters,
      requestBody?.schema || null,
      resultSchema,
      operationDirectiveData,
    )

    // # Build bridge operation

    const defaultHttpMethod =
      operation.operation === OperationTypeNode.MUTATION
        ? OpenAPIV3.HttpMethods.POST
        : OpenAPIV3.HttpMethods.GET

    const httpMethod =
      (operationDirectiveData.method?.toLowerCase() as OpenAPIV3.HttpMethods | undefined) ??
      defaultHttpMethod

    const thisOpenAPIOperation = Object.freeze({
      ...openAPIOperation,
      [CustomProperties.Operation]: operationSource,
    }) as OpenAPIV3.OperationObject<T>

    const bridgeOperation = Object.freeze({
      openAPIOperation: transform ? transform(thisOpenAPIOperation) : thisOpenAPIOperation,
      path: operationDirectiveData.path,
      httpMethod,
      graphqlDocument,
      graphqlDocumentSource: operationSource,
      variableMap,
      requestBodyVariableMap: requestBody?.requestBodyVariableMap || {},
      requestBodyIsSingleInput: requestBody?.requestBodyIsSingleInput,
      requestBodyFormData: requestBody?.requestBodyFormData,
    })

    bridgeOperations.push(bridgeOperation)
  }

  return {
    operations: bridgeOperations,
    schemaComponents: typeConverter.getSchemaComponents(),
  }
}

export const removeOpenAPIDirectives = <T extends ASTNode>(node: T): T => {
  return visit(node, {
    Directive: {
      enter(node) {
        if (Object.values(OpenAPIDirectives).includes(node.name.value as OpenAPIDirectives)) {
          return null
        }
      },
    },
  })
}
