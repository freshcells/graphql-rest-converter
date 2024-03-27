/* eslint-disable @typescript-eslint/ban-ts-comment */
import { IncomingMessage, ServerResponse } from 'node:http'
import {
  BridgeOperation,
  BridgeOperations,
  CreateMiddlewareConfig,
  CustomOperationProps,
  SchemaComponents,
} from './types.js'
import { ExecutionResult, print } from 'graphql'
import { resolveSchemaComponents } from './utils.js'
import { OpenAPIV3 } from 'openapi-types'
import RequestBodyObject = OpenAPIV3.RequestBodyObject
import OpenAPIRequestCoercerImport from 'openapi-request-coercer'
import OpenAPIRequestValidatorImport from 'openapi-request-validator'
import OpenAPIResponseValidatorImport from 'openapi-response-validator'
import { transformBodyVariablesFromOperation, transformRequest } from './multipart.js'
import { GraphQLExecutor } from './graphQLExecutor.js'
import { InvalidResponseError } from './errors.js'

// @ts-ignore
const OpenAPIRequestCoercer = OpenAPIRequestCoercerImport.default || OpenAPIRequestCoercerImport
const OpenAPIRequestValidator =
  // @ts-ignore
  OpenAPIRequestValidatorImport.default || OpenAPIRequestValidatorImport
const OpenAPIResponseValidator =
  // @ts-ignore
  OpenAPIResponseValidatorImport.default || OpenAPIResponseValidatorImport

interface ErrorResult {
  errors: { message: string }[]
}

interface RequestHandler<
  Req extends IncomingMessage,
  Res extends ServerResponse,
  CustomProps extends CustomOperationProps = CustomOperationProps,
> {
  registerRoute(
    operation: BridgeOperation<CustomProps>,
    handleRequest: (
      req: Req,
      res: Res,
    ) => Promise<{
      code: number
      contentType?: string
      result?: null | string | Buffer | ErrorResult | ExecutionResult<Record<string, unknown>>
    }>,
  ): void

  transformJsonBody(req: Req, res: Res): Promise<void>

  transformFormBody(req: Req, res: Res): Promise<void>
}

const innerRequestHandler = <
  Req extends IncomingMessage,
  Res extends ServerResponse,
  CustomProps extends CustomOperationProps = CustomOperationProps,
>(
  operation: BridgeOperation<CustomProps>,
  schemaComponents: SchemaComponents,
  handler: RequestHandler<Req, Res, CustomProps>,
  executor: GraphQLExecutor<Req, Res>,
  config?: CreateMiddlewareConfig<Req, Res>,
) => {
  // Resolving `$ref`, at least OpenAPIRequestValidator cannot handle them properly
  const parameters_ = structuredClone(operation.openAPIOperation.parameters || [])
  const requestBody_ = structuredClone(operation.openAPIOperation.requestBody) as
    | RequestBodyObject
    | undefined

  resolveSchemaComponents(parameters_, schemaComponents)
  resolveSchemaComponents(requestBody_, schemaComponents)

  const requestCoercer = new OpenAPIRequestCoercer({
    parameters: parameters_,
    requestBody: operation.requestBodyFormData === 'FORM_DATA' ? requestBody_ : undefined,
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
  const allRequestBodyVariables = Object.keys(operation.requestBodyVariableMap)
  const supportedContentTypes = Object.keys(
    (operation.openAPIOperation.requestBody as OpenAPIV3.RequestBodyObject)?.content || {},
  )
  return async (req: Req, res: Res) => {
    if (operation.requestBodyFormData === 'JSON') {
      try {
        await handler.transformJsonBody(req, res)
      } catch (e) {
        return {
          code: 400,
          result: {
            errors: [{ message: `SyntaxError: Unable to parse JSON body` }],
          },
        }
      }
    }
    if (operation.requestBodyFormData === 'FORM_DATA') {
      await handler.transformFormBody(req, res)
    }
    if (
      req.method &&
      ['POST', 'PUT', 'PATCH'].includes(req.method) &&
      supportedContentTypes.length > 0 &&
      !supportedContentTypes.some((ct) => req.is(ct))
    ) {
      return {
        code: 415,
        result: {
          errors: [
            {
              message: `Only "${supportedContentTypes.join(', ')}" supported`,
            },
          ],
        },
      }
    }
    const req_ = {
      ...req,
      cookies: { ...req.cookies },
      headers: { ...req.headers },
      params: { ...req.params },
      query: { ...req.query },
      body: req.body,
    }

    requestCoercer.coerce(req_)

    const validationResult = requestValidator ? requestValidator.validateRequest(req_) : null

    if (validationResult) {
      return {
        code: 400,
        result: { errors: validationResult.errors },
      }
    }

    let variables: Record<string, unknown> = {}
    for (const parameter of operation.openAPIOperation.parameters as OpenAPIV3.ParameterObject[]) {
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
          (req_.body as Record<string, unknown>)?.[
            operation.requestBodyVariableMap[requestBodyVariable]
          ] || (operation.requestBodyIsSingleInput ? req_.body : undefined)
      }
    }
    if (operation.requestBodyFormData === 'FORM_DATA') {
      for (const requestBodyVariable of allRequestBodyVariables) {
        variables[requestBodyVariable] =
          (req_.body as Record<string, unknown>)?.[
            operation.requestBodyVariableMap[requestBodyVariable]
          ] || undefined
      }
    }

    if (operation.requestBodyFormData === 'MULTIPART_FORM_DATA') {
      variables = {
        ...variables,
        ...transformRequest(
          req,
          graphqlDocument_,
          allRequestBodyVariables,
          transformBodyVariablesFromOperation(operation),
        ),
      }
    }

    // make sure we do not pass `undefined` variables
    const thisVariables = Object.fromEntries(
      Object.entries(variables).filter(([, value]) => value !== undefined),
    )

    const request = {
      document: graphqlDocument_,
      variables: thisVariables,
      request: req,
      response: res,
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
        return {
          code: statusCode,
          result: data,
          contentType,
        }
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
          result.errors,
        )
      }
    }
    // 2. If no response validation is enabled, we will return (possibly) both the errors and a (partial) result
    if (result.errors) {
      return {
        code: 500,
        result,
      }
    }
    return {
      code: 200,
      result: result.data,
    }
  }
}

export const createRequestHandler = <
  Req extends IncomingMessage,
  Res extends ServerResponse,
  CustomProps extends CustomOperationProps = CustomOperationProps,
>(
  bridge: BridgeOperations<CustomProps>,
  handler: RequestHandler<Req, Res, CustomProps>,
  executor: GraphQLExecutor<Req, Res>,
  config?: CreateMiddlewareConfig<Req, Res>,
) => {
  for (const operation of bridge.operations) {
    handler.registerRoute(
      operation,
      innerRequestHandler(operation, bridge.schemaComponents, handler, executor, config),
    )
  }
}
