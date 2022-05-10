import _ from 'lodash'
import express, { RequestHandler, NextFunction, IRouter } from 'express'
import { OpenAPIV3 } from 'openapi-types'
import { parse } from 'graphql'
import { request as graphqlRequest } from 'graphql-request'
import { DocumentNode, GraphQLSchema } from 'graphql'
import OpenAPIRequestCoercer from 'openapi-request-coercer'
import OpenAPIRequestValidator, { OpenAPIRequestValidatorArgs } from 'openapi-request-validator'
import OpenAPIResponseValidator from 'openapi-response-validator'
import OpenAPISchemaValidator from 'openapi-schema-validator'
import { PartialDeep } from 'type-fest'
import { getOpenAPIGraphQLOperations } from './graphql'
import { pathTemplateToExpressRoute } from './pathTemplate'
import { createOpenAPISchemaFromOperations } from './openapi'
import { CustomProperties, OpenAPIGraphQLOperation } from './types'

export const asyncHandler =
  (handler: RequestHandler) =>
  (...args: Parameters<RequestHandler>) => {
    const result = handler(...args)
    return Promise.resolve(result).catch(args[args.length - 1] as NextFunction)
  }

const addOperation = (
  router: IRouter,
  operation: OpenAPIGraphQLOperation,
  config: CreateMiddlewareConfig
) => {
  const route = pathTemplateToExpressRoute(operation.path)

  const requestCoercer = new OpenAPIRequestCoercer({
    parameters: operation.openAPIOperation.parameters || [],
  })

  const requestValidator =
    typeof config.validateRequest !== 'boolean' || config.validateRequest
      ? new OpenAPIRequestValidator(operation.openAPIOperation as OpenAPIRequestValidatorArgs)
      : undefined

  const responseValidator = config.validateResponse
    ? // @ts-ignore
      new OpenAPIResponseValidator(operation.openAPIOperation)
    : undefined

  router[operation.httpMethod](
    route,
    asyncHandler(async (req, res) => {
      const reqClone = {
        ...req,
        headers: { ...req.headers },
        params: { ...req.params },
        query: { ...req.query },
      }
      requestCoercer.coerce(reqClone)
      const errors = requestValidator ? requestValidator.validateRequest(reqClone) : null
      if (errors) {
        res.status(400).json(errors)
        return
      }
      const parameters = { ...reqClone.params, ...reqClone.query }

      const data = await graphqlRequest({
        url: config.graphqlEndpoint,
        document: operation.graphqlDocument,
        variables: parameters,
        requestHeaders: {},
      })

      if (responseValidator) {
        const responseValidationErrors = responseValidator.validateResponse(200, data)
        if (responseValidationErrors) {
          throw new Error(JSON.stringify(responseValidationErrors))
        }
      }

      res.json(data)
    })
  )
}

export type CreateMiddlewareConfig = {
  graphqlEndpoint: string
  validateRequest?: boolean
  validateResponse?: boolean
}

export const createExpressMiddleware = (
  operations: Array<OpenAPIGraphQLOperation>,
  config: CreateMiddlewareConfig
) => {
  // TODO: Avoid depending on express directly?
  const router = express.Router()

  for (const operation of operations) {
    addOperation(router, operation, config)
  }

  return router
}

type OperationCustomProperties = {
  [CustomProperties.Operation]?: string
}

const getGraphQLOpenAPIOperationsFromOpenAPISchema = (
  schema: OpenAPIV3.Document<OperationCustomProperties>
) => {
  const operations: Array<OpenAPIGraphQLOperation> = []
  for (const [path, pathItem] of Object.entries(schema.paths)) {
    if (!pathItem) {
      continue
    }
    for (const [httpMethod, operation] of Object.entries(pathItem)) {
      // @ts-ignore
      if (!operation[CustomProperties.Operation]) {
        continue
      }
      operations.push({
        openAPIOperation: operation as OpenAPIV3.OperationObject,
        path,
        httpMethod: httpMethod as OpenAPIV3.HttpMethods,
        // @ts-ignore
        graphqlDocument: parse(operation[CustomProperties.Operation]),
      })
    }
  }
  return operations
}

export const createExpressMiddlewareFromOpenAPISchema = (
  schema: OpenAPIV3.Document<OperationCustomProperties>,
  config: CreateMiddlewareConfig
) => {
  const operations = getGraphQLOpenAPIOperationsFromOpenAPISchema(schema)
  return createExpressMiddleware(operations, config)
}

export const removeCustomProperties = (
  schema: OpenAPIV3.Document<OperationCustomProperties>
): OpenAPIV3.Document => {
  const schemaClone = _.cloneDeep(schema)
  for (const pathItem of Object.values(schemaClone.paths)) {
    if (!pathItem) {
      continue
    }
    for (const operation of Object.values(pathItem)) {
      if (typeof operation !== 'object') {
        continue
      }
      // @ts-ignore
      delete operation[CustomProperties.Operation]
    }
  }
  return schemaClone
}

export type CreateOpenAPISchemaConfig = {
  baseSchema: PartialDeep<OpenAPIV3.Document>
  validate?: boolean
}

const createOpenAPISchemaWithValidate = (
  operations: Array<OpenAPIGraphQLOperation>,
  config: CreateOpenAPISchemaConfig
) => {
  const openAPISchema = createOpenAPISchemaFromOperations(config.baseSchema, operations)
  if (config.validate) {
    const schemaValidator = new OpenAPISchemaValidator({ version: 3 })
    const schemaValidationErrors = schemaValidator.validate(openAPISchema)
    if (schemaValidationErrors?.errors?.length) {
      throw new Error(JSON.stringify(schemaValidationErrors))
    }
  }
  return openAPISchema
}

export type CreateOpenAPIGraphQLBridgeConfig = {
  graphqlSchema: GraphQLSchema
  graphqlDocument: DocumentNode
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
}

export const createOpenAPIGraphQLBridge = (config: CreateOpenAPIGraphQLBridgeConfig) => {
  const { graphqlSchema, graphqlDocument, customScalars } = config

  const operations = getOpenAPIGraphQLOperations(graphqlSchema, graphqlDocument, customScalars)

  return {
    getExpressMiddleware: (config: CreateMiddlewareConfig) =>
      createExpressMiddleware(operations, config),
    getOpenAPISchema: (
      config: CreateOpenAPISchemaConfig
    ): OpenAPIV3.Document<OperationCustomProperties> =>
      createOpenAPISchemaWithValidate(operations, config),
  }
}
