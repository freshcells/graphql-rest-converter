import _ from 'lodash'
import express, { RequestHandler, NextFunction, IRouter } from 'express'
import bodyParser from 'body-parser'
import { OpenAPIV3 } from 'openapi-types'
import { parse, buildSchema, DocumentNode, GraphQLSchema, print, ExecutionResult } from 'graphql'
import OpenAPIRequestCoercer from 'openapi-request-coercer'
import OpenAPIRequestValidator from 'openapi-request-validator'
import OpenAPIResponseValidator from 'openapi-response-validator'
import OpenAPISchemaValidator from 'openapi-schema-validator'
import { PartialDeep } from 'type-fest'
import { getBridgeOperations } from './graphql'
import { pathTemplateToExpressRoute } from './pathTemplate'
import { createOpenAPISchemaFromOperations } from './openApi'
import { CustomProperties, BridgeOperation, BridgeOperations, SchemaComponents } from './types'
import { GraphQLExecutor, GraphQLExecutorArgs } from './graphQLExecutor'

const middlewareToPromise =
  (middleware: RequestHandler) =>
  (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
    return new Promise<ReturnType<RequestHandler>>((resolve, reject) => {
      const next = (x: any) => (x ? reject(x) : resolve())
      middleware(req, res, next)
    })
  }

const promiseToHandler =
  (
    handler: (
      req: Parameters<RequestHandler>[0],
      res: Parameters<RequestHandler>[1]
    ) => Promise<ReturnType<RequestHandler>>
  ) =>
  (...args: Parameters<RequestHandler>) => {
    const result = handler(args[0], args[1])
    result.catch(args[2] as NextFunction)
  }

const jsonBodyParserPromise = middlewareToPromise(bodyParser.json())

const resolveSchemaComponents = (schema: any, schemaComponents: SchemaComponents) => {
  if (typeof schema !== 'object' || schema === null) {
    return
  }
  if ('$ref' in schema) {
    const refTarget = schema.$ref as string
    delete schema.$ref
    for (const [k, v] of Object.entries(
      schemaComponents[refTarget.replace('#/components/schemas/', '')]
    )) {
      schema[k] = _.cloneDeep(v)
    }
  }
  for (const value of Object.values(schema)) {
    resolveSchemaComponents(value, schemaComponents)
  }
}

const addOperation = (
  router: IRouter,
  operation: BridgeOperation,
  schemaComponents: SchemaComponents,
  executor: GraphQLExecutor,
  config: CreateMiddlewareConfig
) => {
  const route = pathTemplateToExpressRoute(operation.path)

  // Resolving `$ref`, at least OpenAPIRequestValidator cannot handle them properly
  const parameters_ = _.cloneDeep(operation.openAPIOperation.parameters || [])
  resolveSchemaComponents(parameters_, schemaComponents)

  const requestCoercer = new OpenAPIRequestCoercer({
    parameters: parameters_,
  })

  const requestValidator =
    typeof config.validateRequest !== 'boolean' || config.validateRequest
      ? new OpenAPIRequestValidator({ parameters: parameters_ })
      : undefined

  const responseValidator = config.validateResponse
    ? new OpenAPIResponseValidator({
        // Type in `openapi-response-validator` seems wrong
        responses: operation.openAPIOperation.responses as any,
        components: { schemas: schemaComponents },
      })
    : undefined

  const graphqlDocument_ = print(operation.graphqlDocument)

  router[operation.httpMethod](
    route,
    promiseToHandler(async (req, res) => {
      if (operation.requestBodyVariable) {
        await jsonBodyParserPromise(req, res)
      }

      const req_ = {
        ...req,
        cookies: { ...req.cookies },
        headers: { ...req.headers },
        params: { ...req.params },
        query: { ...req.query },
        body: req.body,
      }

      // TODO: Cookies not supported
      requestCoercer.coerce(req_)

      const errors = requestValidator ? requestValidator.validateRequest(req_) : null

      if (errors) {
        res.status(400).json(errors)
        return
      }

      const variables: Record<string, any> = {}
      for (const parameter of operation.openAPIOperation
        .parameters as OpenAPIV3.ParameterObject[]) {
        const variableName = operation.variableMap[parameter.name] || parameter.name
        if (parameter.in === 'path') {
          variables[variableName] = req_.params[parameter.name]
        }
        if (parameter.in === 'query') {
          variables[variableName] = req_.query[parameter.name]
        }
        if (parameter.in === 'header') {
          variables[variableName] = req_.headers[parameter.name]
        }
      }
      if (operation.requestBodyVariable) {
        variables[operation.requestBodyVariable] = req_.body
      }

      const request = {
        document: graphqlDocument_,
        variables,
      }
      const result = await executor(request)
      let statusCode = 200
      let contentType: string | undefined = 'application/json'
      let data: string | Buffer | undefined = JSON.stringify(result.data)
      let isTransformed = false

      if (config.responseTransformer) {
        const response_ = config.responseTransformer({
          result,
          request,
          openAPISchema: {
            operation: operation.openAPIOperation,
            method: operation.httpMethod,
            path: operation.path,
          },
        })
        if (response_) {
          statusCode = response_.statusCode
          contentType = response_.contentType
          data = response_.data
          // TODO: The validation can only handle JSON for now
          isTransformed = true
        }
      }

      if (responseValidator && !isTransformed) {
        const responseValidationErrors = responseValidator.validateResponse(statusCode, result.data)
        if (responseValidationErrors) {
          throw new Error(JSON.stringify(responseValidationErrors))
        }
      }

      if (contentType) {
        res.set('Content-Type', contentType)
      }
      res.status(statusCode)
      if (data) {
        res.send(data)
      }
      res.end()
    })
  )
}

export type ResponseTransformerArgs = {
  result: ExecutionResult
  request: GraphQLExecutorArgs
  openAPISchema: {
    operation: OpenAPIV3.OperationObject
    method: OpenAPIV3.HttpMethods
    path: string
  }
}

export type ResponseTransformerResult = {
  statusCode: number
  contentType?: string
  data?: string | Buffer
}

export type ResponseTransformer = (
  args: ResponseTransformerArgs
) => ResponseTransformerResult | undefined

export type CreateMiddlewareConfig = {
  responseTransformer?: ResponseTransformer
  /**
   * Default is `true`
   */
  validateRequest?: boolean
  /**
   * Default is `false`
   */
  validateResponse?: boolean
}

const createExpressMiddleware = (
  operations: BridgeOperations,
  executor: GraphQLExecutor,
  config: CreateMiddlewareConfig
) => {
  // TODO: Avoid depending on express directly?
  const router = express.Router()

  for (const operation of operations.operations) {
    addOperation(router, operation, operations.schemaComponents, executor, config)
  }

  return router
}

type OperationCustomProperties = {
  [CustomProperties.Operation]?: string
}

const getVariableMapFromParameters = (parameters: OpenAPIV3.ParameterObject[]) => {
  const variableMap: Record<string, string> = {}
  for (const parameter of parameters) {
    const variableName = (parameter as any)[CustomProperties.VariableName]
    if (variableName) {
      variableMap[parameter.name] = variableName
    }
  }
  return variableMap
}

const getBridgeOperationsFromOpenAPISchema = (
  schema: OpenAPIV3.Document<OperationCustomProperties>
) => {
  const operations: Array<BridgeOperation> = []
  for (const [path, pathItem] of Object.entries(schema.paths)) {
    if (!pathItem) {
      continue
    }
    for (const [httpMethod, operation] of Object.entries(pathItem)) {
      if (!(operation as any)[CustomProperties.Operation]) {
        continue
      }
      const requestBodyVariable =
        (operation as any)?.requestBody?.[CustomProperties.VariableName] ?? null
      operations.push({
        openAPIOperation: operation as OpenAPIV3.OperationObject,
        path,
        httpMethod: httpMethod as OpenAPIV3.HttpMethods,
        graphqlDocument: parse((operation as any)[CustomProperties.Operation]),
        variableMap: getVariableMapFromParameters((operation as any).parameters || []),
        requestBodyVariable,
      })
    }
  }

  const schemaComponents = (schema?.components?.schemas as SchemaComponents) || {}

  return {
    operations,
    schemaComponents,
  }
}

export const createExpressMiddlewareFromOpenAPISchema = (
  schema: OpenAPIV3.Document<OperationCustomProperties>,
  executor: GraphQLExecutor,
  config: CreateMiddlewareConfig
) => {
  const operations = getBridgeOperationsFromOpenAPISchema(schema)
  return createExpressMiddleware(operations, executor, config)
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
      if (typeof operation !== 'object' || operation === null) {
        continue
      }
      delete (operation as any)[CustomProperties.Operation]
      for (const parameter of (operation as any).parameters || []) {
        delete parameter[CustomProperties.VariableName]
      }
    }
  }
  return schemaClone
}

export type CreateOpenAPISchemaConfig = {
  baseSchema: PartialDeep<OpenAPIV3.Document>
  validate?: boolean
}

const createOpenAPISchemaWithValidate = (
  operations: BridgeOperations,
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
  graphqlSchema: GraphQLSchema | string
  graphqlDocument: DocumentNode | string
  customScalars?: (scalarTypeName: string) => OpenAPIV3.SchemaObject
}

export const createOpenAPIGraphQLBridge = (config: CreateOpenAPIGraphQLBridgeConfig) => {
  const { graphqlSchema, graphqlDocument, customScalars } = config

  const graphqlSchema_ =
    typeof graphqlSchema === 'string' ? buildSchema(graphqlSchema) : graphqlSchema

  const graphqlDocument_ =
    typeof graphqlDocument === 'string' ? parse(graphqlDocument) : graphqlDocument

  const operations = getBridgeOperations(graphqlSchema_, graphqlDocument_, customScalars)

  return {
    getExpressMiddleware: (executor: GraphQLExecutor, config: CreateMiddlewareConfig) =>
      createExpressMiddleware(operations, executor, config),
    getOpenAPISchema: (
      config: CreateOpenAPISchemaConfig
    ): OpenAPIV3.Document<OperationCustomProperties> =>
      createOpenAPISchemaWithValidate(operations, config),
  }
}
