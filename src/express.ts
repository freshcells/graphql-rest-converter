/* eslint-disable @typescript-eslint/ban-ts-comment */
import _ from 'lodash'
import express, { RequestHandler, NextFunction, IRouter, Request, Response } from 'express'
import bodyParser from 'body-parser'
import { OpenAPIV3 } from 'openapi-types'
import { parse, buildSchema, print } from 'graphql'
import OpenAPIRequestCoercer from 'openapi-request-coercer'
import OpenAPIRequestValidator from 'openapi-request-validator'
import OpenAPIResponseValidator from 'openapi-response-validator'
import { getBridgeOperations } from './graphql.js'
import { pathTemplateToExpressRoute } from './pathTemplate.js'
import {
  BridgeOperation,
  BridgeOperations,
  SchemaComponents,
  CustomOperationProps,
  CreateOpenAPIGraphQLBridgeConfig,
  CreateOpenAPISchemaConfig,
  CreateMiddlewareConfig,
} from './types.js'
import { GraphQLExecutor } from './graphQLExecutor.js'
import RequestBodyObject = OpenAPIV3.RequestBodyObject
import { InvalidResponseError } from './errors.js'
import { createOpenAPISchemaWithValidate, resolveSchemaComponents } from './utils.js'
import { transformRequest } from './multipart.js'

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
const formBodyParserPromise = middlewareToPromise(bodyParser.urlencoded())

const addOperation = <
  T extends CustomOperationProps = CustomOperationProps,
  Req extends Request = Request,
  Res extends Response = Response
>(
  router: IRouter,
  operation: BridgeOperation<T>,
  schemaComponents: SchemaComponents,
  executor: GraphQLExecutor<Req, Res>,
  config?: CreateMiddlewareConfig<Req, Res>
) => {
  const route = pathTemplateToExpressRoute(operation.path)

  // Resolving `$ref`, at least OpenAPIRequestValidator cannot handle them properly
  const parameters_ = _.cloneDeep(operation.openAPIOperation.parameters || [])
  const requestBody_ = _.cloneDeep(operation.openAPIOperation.requestBody) as
    | RequestBodyObject
    | undefined

  resolveSchemaComponents(parameters_, schemaComponents)
  resolveSchemaComponents(requestBody_, schemaComponents)

  const requestCoercer = new OpenAPIRequestCoercer.default({
    parameters: parameters_,
    requestBody: operation.requestBodyFormData === 'FORM_DATA' ? requestBody_ : undefined,
  })

  const requestValidator =
    typeof config?.validateRequest !== 'boolean' || config.validateRequest
      ? new OpenAPIRequestValidator.default({
          parameters: parameters_,
          requestBody: requestBody_,
        })
      : undefined

  const responseValidator = config?.validateResponse
    ? new OpenAPIResponseValidator.default({
        // Type in `openapi-response-validator` seems wrong
        responses: operation.openAPIOperation.responses as any,
        components: { schemas: schemaComponents },
      })
    : undefined

  const graphqlDocument_ = print(operation.graphqlDocument)

  router[operation.httpMethod](
    route,
    promiseToHandler(async (req, res) => {
      const allRequestBodyVariables = Object.keys(operation.requestBodyVariableMap)

      if (operation.requestBodyFormData === 'JSON') {
        await jsonBodyParserPromise(req, res)
      }

      if (operation.requestBodyFormData === 'FORM_DATA') {
        await formBodyParserPromise(req, res)
      }

      const supportedContentTypes = Object.keys(
        (operation.openAPIOperation.requestBody as OpenAPIV3.RequestBodyObject)?.content || {}
      )
      if (
        ['POST', 'PUT', 'PATCH'].includes(req.method) &&
        supportedContentTypes.length > 0 &&
        !supportedContentTypes.includes(req.headers['content-type'] || '')
      ) {
        res.status(415).json({
          errors: [
            {
              message: `Only "${supportedContentTypes.join(', ')}" supported`,
            },
          ],
        })
        return
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

      let variables: Record<string, unknown> = {}
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
      if (operation.requestBodyFormData === 'JSON') {
        for (const requestBodyVariable of allRequestBodyVariables) {
          variables[requestBodyVariable] =
            req_.body[operation.requestBodyVariableMap[requestBodyVariable]] ||
            (operation.requestBodyIsSingleInput ? req_.body : null)
        }
      }

      if (operation.requestBodyFormData === 'FORM_DATA') {
        for (const requestBodyVariable of allRequestBodyVariables) {
          variables[requestBodyVariable] =
            req_.body[operation.requestBodyVariableMap[requestBodyVariable]] || null
        }
      }

      if (operation.requestBodyFormData === 'MULTIPART_FORM_DATA') {
        variables = {
          ...variables,
          ...transformRequest(
            req,
            graphqlDocument_,
            allRequestBodyVariables,
            operation.requestBodyVariableMap
          ),
        }
      }

      const request = {
        document: graphqlDocument_,
        variables,
        request: req as Req,
        response: res as Res,
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
  ThisRequest extends Request = Request,
  ThisResponse extends Response = Response
>(
  operations: BridgeOperations<T>,
  executor: GraphQLExecutor<ThisRequest, ThisResponse>,
  config?: CreateMiddlewareConfig<ThisRequest, ThisResponse>
) => {
  // TODO: Avoid depending on express directly?
  const router = express.Router()

  for (const operation of operations.operations) {
    addOperation(router, operation, operations.schemaComponents, executor, config)
  }

  return router
}

export const createOpenAPIGraphQLBridge = <
  ThisRequest extends Request = Request,
  ThisResponse extends Response = Response,
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
    getExpressMiddleware: (
      executor: GraphQLExecutor<ThisRequest, ThisResponse>,
      config?: CreateMiddlewareConfig
    ) => createExpressMiddleware(operations, executor, config),
    getOpenAPISchema: (config: CreateOpenAPISchemaConfig<T>): OpenAPIV3.Document<T> =>
      createOpenAPISchemaWithValidate<T>(operations, config),
  }
}
