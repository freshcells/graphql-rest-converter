/* eslint-disable @typescript-eslint/ban-ts-comment */
import express, { RequestHandler, Request, Response } from 'express'
import { OpenAPIV3 } from 'openapi-types'
import { parse, buildSchema } from 'graphql'
import { getBridgeOperations } from './graphql.js'
import { pathTemplateToExpressRoute } from './pathTemplate.js'
import {
  BridgeOperation,
  BridgeOperations,
  CustomOperationProps,
  CreateOpenAPIGraphQLBridgeConfig,
  CreateOpenAPISchemaConfig,
  CreateMiddlewareConfig,
} from './types.js'
import { GraphQLExecutor } from './graphQLExecutor.js'
import { createOpenAPISchemaWithValidate } from './utils.js'
import { createRequestHandler } from './createRequestHandler.js'

const middlewareToPromise =
  (middleware: RequestHandler) =>
  (req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) => {
    return new Promise<ReturnType<RequestHandler>>((resolve, reject) => {
      const next = (x: unknown) => (x ? reject(x) : resolve())
      middleware(req, res, next)
    })
  }

const jsonBodyParserPromise = middlewareToPromise(express.json())
const formBodyParserPromise = middlewareToPromise(express.urlencoded({ extended: true }))

const createExpressMiddleware = <
  CustomProps extends CustomOperationProps = CustomOperationProps,
  ThisRequest extends Request = Request,
  ThisResponse extends Response = Response,
>(
  operations: BridgeOperations<CustomProps>,
  executor: GraphQLExecutor<ThisRequest, ThisResponse>,
  config?: CreateMiddlewareConfig<ThisRequest, ThisResponse>,
) => {
  const router = express.Router()
  createRequestHandler<ThisRequest, ThisResponse, CustomProps>(
    operations,
    {
      async transformJsonBody(req, res) {
        await jsonBodyParserPromise(req, res)
      },
      async transformFormBody(req, res) {
        await formBodyParserPromise(req, res)
      },
      registerRoute(operation: BridgeOperation<CustomProps>, handleRequest) {
        const route = pathTemplateToExpressRoute(operation.path)
        router[operation.httpMethod](route, async (req, res, next) => {
          try {
            const handlerResult = await handleRequest(req as ThisRequest, res as ThisResponse)
            const { contentType, code, result } = handlerResult
            if (typeof result === 'object') {
              res.status(code).json(result)
              return
            }
            if (contentType) {
              res.contentType(contentType)
            }
            res.status(code).send(result)
          } catch (e) {
            next(e)
          }
        })
      },
    },
    executor,
    config,
  )

  return router
}

export const createOpenAPIGraphQLBridge = <
  ThisRequest extends Request = Request,
  ThisResponse extends Response = Response,
  T extends CustomOperationProps = CustomOperationProps,
>(
  config: CreateOpenAPIGraphQLBridgeConfig<T>,
) => {
  const { graphqlSchema, graphqlDocument, customScalars, transform } = config

  const graphqlSchema_ =
    typeof graphqlSchema === 'string' ? buildSchema(graphqlSchema) : graphqlSchema

  const graphqlDocument_ =
    typeof graphqlDocument === 'string' ? parse(graphqlDocument) : graphqlDocument

  const operations = getBridgeOperations<T>(
    graphqlSchema_,
    graphqlDocument_,
    customScalars,
    transform,
  )

  return {
    getExpressMiddleware: (
      executor: GraphQLExecutor<ThisRequest, ThisResponse>,
      config?: CreateMiddlewareConfig,
    ) => createExpressMiddleware(operations, executor, config),
    getOpenAPISchema: (config: CreateOpenAPISchemaConfig<T>): OpenAPIV3.Document<T> =>
      createOpenAPISchemaWithValidate<T>(operations, config),
  }
}
