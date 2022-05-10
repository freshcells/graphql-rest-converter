import {
  DirectiveNode,
  DocumentNode,
  GraphQLSchema,
  visit,
  print,
  Kind,
  ASTNode,
  buildASTSchema,
} from 'graphql'
import { gql } from 'graphql-tag'
import { OpenAPIV3 } from 'openapi-types'
import { getVariablesFromPathTemplate } from './pathTemplate'
import {
  createFragmentMap,
  getDirectiveArguments,
  inlineFragments,
  isOperationDefinitionNode,
} from './graphqlUtils'
import { CustomProperties, OpenAPIGraphQLOperation } from './types'
import { GraphQLTypeToOpenAPITypeSchemaConverter } from './typeConverter'

const DIRECTIVE_DEFINITION = gql`
  input OAExternalDocsInput {
    url: String!
    description: String
  }
  directive @OAQuery(
    path: String!
    tags: [String!]
    summary: String
    description: String
    externalDocs: OAExternalDocsInput
    deprecated: Boolean
  ) on QUERY
`

enum OpenAPIDirectives {
  Query = 'OAQuery',
}

const graphqlQueryDirectiveDataToOpenAPIOperation = (requestConfig: OpenAPIQueryDirectiveData) => {
  const { tags, summary, description, externalDocs, deprecated } = requestConfig
  return {
    ...(tags?.length ? { tags } : {}),
    ...(typeof summary === 'string' ? { summary } : {}),
    ...(typeof description === 'string' ? { description } : {}),
    ...(typeof externalDocs?.url === 'string' ? { externalDocs } : {}),
    ...(deprecated ? { deprecated } : {}),
  }
}

const assignParameterTypes = (parameters: any, path: string) => {
  const pathVariables = new Set(getVariablesFromPathTemplate(path))

  return parameters.map((parameter: any) => ({
    ...parameter,
    in: pathVariables.has(parameter.name) ? 'path' : 'query',
  }))
}

type OpenAPIQueryDirectiveData = {
  path: string
  tags?: [string]
  summary?: string
  description?: string
  externalDocs?: {
    url: string
    description?: string
  }
  deprecated?: boolean
}

const createOpenAPIOperation = (
  operationId: string | null,
  operationSource: string,
  parameters: Omit<OpenAPIV3.ParameterObject, 'in'>[],
  responseSchema: OpenAPIV3.SchemaObject,
  directiveData: OpenAPIQueryDirectiveData
) => {
  const responses = {
    '200': {
      description: 'Success',
      content: {
        'application/json': {
          schema: responseSchema,
        },
      },
    },
    '400': {
      description: 'Invalid request',
      content: {
        'application/json': {},
      },
    },
  }
  return {
    ...(operationId !== null ? { operationId } : {}),
    [CustomProperties.Operation]: operationSource,
    ...graphqlQueryDirectiveDataToOpenAPIOperation(directiveData),
    parameters: assignParameterTypes(parameters, directiveData.path),
    responses,
  }
}

export const getOpenAPIGraphQLOperations = (
  schema: GraphQLSchema,
  document: DocumentNode,
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
) => {
  const result: Array<OpenAPIGraphQLOperation> = []

  const fragmentMap = createFragmentMap(document.definitions)

  const typeConverter = new GraphQLTypeToOpenAPITypeSchemaConverter(schema, customScalars)

  const directiveSchema = buildASTSchema(DIRECTIVE_DEFINITION)

  for (const operation of document.definitions) {
    if (!isOperationDefinitionNode(operation)) {
      continue
    }

    const queryDirective = (operation.directives || []).find(
      (directive: DirectiveNode) => directive.name.value === OpenAPIDirectives.Query
    )
    if (!queryDirective) {
      continue
    }

    const directiveData = getDirectiveArguments(
      directiveSchema.getDirective(OpenAPIDirectives.Query)!,
      queryDirective
    ) as OpenAPIQueryDirectiveData

    const operation_ = removeOpenAPIDirectives(inlineFragments(operation, fragmentMap))

    const singleOperationDocument = {
      kind: Kind.DOCUMENT,
      definitions: [operation_],
    }

    const operationId = operation_.name ? operation_.name.value : null

    const parametersSchema = typeConverter.parametersFromOperation(operation_)

    const responseSchema = typeConverter.responseSchemaFromOperation(operation_)

    const operationSource = print(singleOperationDocument)

    const openAPIOperation = createOpenAPIOperation(
      operationId,
      operationSource,
      parametersSchema,
      responseSchema,
      directiveData
    )

    const graphqlOpenAPIOperation = {
      openAPIOperation,
      httpMethod: OpenAPIV3.HttpMethods.GET,
      graphqlDocument: singleOperationDocument,
      path: directiveData.path,
    }
    result.push(graphqlOpenAPIOperation)
  }

  return result
}

const removeOpenAPIDirectives = (node: ASTNode) => {
  return visit(node, {
    Directive: {
      enter(node) {
        if (node.name.value === OpenAPIDirectives.Query) {
          return null
        }
      },
    },
  })
}
