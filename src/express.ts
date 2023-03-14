import _ from 'lodash'
import express, { RequestHandler, NextFunction, IRouter, Request } from 'express'
import bodyParser from 'body-parser'
import { OpenAPIV3 } from 'openapi-types'
import { parse, buildSchema, print } from 'graphql'
import OpenAPIRequestCoercer from 'openapi-request-coercer'
import OpenAPIRequestValidator from 'openapi-request-validator'
import OpenAPIResponseValidator from 'openapi-response-validator'
import { getBridgeOperations } from './graphql'
import { pathTemplateToExpressRoute } from './pathTemplate'
import {
  BridgeOperation,
  BridgeOperations,
  SchemaComponents,
  CustomOperationProps,
  CreateOpenAPIGraphQLBridgeConfig,
  CreateOpenAPISchemaConfig,
  CreateMiddlewareConfig,
} from './types'
import { GraphQLExecutor } from './graphQLExecutor'
import RequestBodyObject = OpenAPIV3.RequestBodyObject
import { InvalidResponseError } from './errors'
import { createOpenAPISchemaWithValidate, resolveSchemaComponents } from './utils'

const middlewareToPromise =
  (middleware: RequestHandler) =>
  (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
    return new Promise<ReturnType<RequestHandler>>((resolve, reject) => {
      const next = (x: unknown) => (x ? reject(x) : resolve())
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

const addOperation = <
  T extends CustomOperationProps = CustomOperationProps,
  R extends Request = Request
>(
  router: IRouter,
  operation: BridgeOperation<T>,
  schemaComponents: SchemaComponents,
  executor: GraphQLExecutor<R>,
  config?: CreateMiddlewareConfig<R>
) => {
  const route = pathTemplateToExpressRoute(operation.path)

  // Resolving `$ref`, at least OpenAPIRequestValidator cannot handle them properly
  const parameters_ = _.cloneDeep(operation.openAPIOperation.parameters || [])
  const requestBody_ = _.cloneDeep(operation.openAPIOperation.requestBody) as
    | RequestBodyObject
    | undefined

  resolveSchemaComponents(parameters_, schemaComponents)
  resolveSchemaComponents(requestBody_, schemaComponents)

  const requestCoercer = new OpenAPIRequestCoercer({
    parameters: parameters_,
    // TODO: For the future to support application/x-www-form-urlencoded
    // requestBody: requestBody_,
  })

  const requestValidator =
    typeof config?.validateRequest !== 'boolean' || config.validateRequest
      ? new OpenAPIRequestValidator({
          parameters: parameters_,
          requestBody: requestBody_,
        })
      : undefined

  const responseValidator = config?.validateResponse
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

      const validationResult = requestValidator ? requestValidator.validateRequest(req_) : null

      if (validationResult) {
        res.status(400).json({ errors: validationResult.errors })
        return
      }

      const variables: Record<string, unknown> = {}
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
        request: req as R,
      }
      const result = await executor(request)

      if (config?.responseTransformer) {
        const response_ = await config.responseTransformer({
          result,
          request,
          openAPISchema: {
            operation: operation.openAPIOperation,
            method: operation.httpMethod,
            path: operation.path,
          },
        })
        if (response_) {
          const { statusCode, contentType, data } = response_
          if (contentType) {
            res.contentType(contentType)
          }
          res.status(statusCode).send(data).end()
          return
        }
      }

      // There are 2 cases of errors handled here;

      // 1. If responseValidation is enabled, it will throw in both cases
      // - If there is a response validation problem
      // - If there are any graphql errors
      if (responseValidator) {
        const responseValidationErrors = responseValidator.validateResponse(200, result.data)
        if (responseValidationErrors || result.errors) {
          throw new InvalidResponseError(
            responseValidationErrors?.message || 'GraphQL Error',
            responseValidationErrors?.errors || [],
            result.errors
          )
        }
      }
      // 2. If no response validation is enabled, we will return (possibly) both the errors and a (partial) result
      if (result.errors) {
        res.status(500).json(result).end()
        return
      }
      res.status(200).json(result.data).end()
    })
  )
}

const createExpressMiddleware = <
  T extends CustomOperationProps = CustomOperationProps,
  R extends Request = Request
>(
  operations: BridgeOperations<T>,
  executor: GraphQLExecutor<R>,
  config?: CreateMiddlewareConfig<R>
) => {
  // TODO: Avoid depending on express directly?
  const router = express.Router()

  for (const operation of operations.operations) {
    addOperation(router, operation, operations.schemaComponents, executor, config)
  }

  return router
}

export const createOpenAPIGraphQLBridge = <
  R extends Request = Request,
  T extends CustomOperationProps = CustomOperationProps
>(
  config: CreateOpenAPIGraphQLBridgeConfig
) => {
  const { graphqlSchema, graphqlDocument, customScalars } = config

  const graphqlSchema_ =
    typeof graphqlSchema === 'string' ? buildSchema(graphqlSchema) : graphqlSchema

  const graphqlDocument_ =
    typeof graphqlDocument === 'string' ? parse(graphqlDocument) : graphqlDocument

  const operations = getBridgeOperations<T>(graphqlSchema_, graphqlDocument_, customScalars)

  return {
    getExpressMiddleware: (executor: GraphQLExecutor<R>, config?: CreateMiddlewareConfig) =>
      createExpressMiddleware(operations, executor, config),
    getOpenAPISchema: (config: CreateOpenAPISchemaConfig<T>): OpenAPIV3.Document<T> =>
      createOpenAPISchemaWithValidate<T>(operations, config),
  }
}
